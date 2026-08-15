// The media pipeline.
//
// ORDER IS THE SECURITY PROPERTY. Nothing may reach a public S3 key before it
// has been scanned:
//
//   multer (live byte caps, mime allowlist)     ← middlewares/dynamicUpload
//   validateFiles (per-type bytes, totals, dimensions)
//   ── daily quota
//   ── CSAM hash match ──── on match ──→ quarantine to the PRIVATE prefix,
//   ──                                   open an incident, refuse. Never
//   ──                                   touches a public key.
//   ── EXIF strip
//   ── thumbnail
//   ── upload original + thumb to S3
//   ── MediaAsset ledger row
//
// The scan is a throw, not a boolean. A caller who forgets to check a returned
// flag publishes the image, and that failure mode is not acceptable here.

const mongoose = require('mongoose');
const MediaAsset = require('../../models/MediaAsset');
const ChildSafetyIncident = require('../../models/ChildSafetyIncident');
const storage = require('../storage');
const hashMatch = require('../safety/hashMatchService');
const counterService = require('../counterService');
const mediaKeys = require('./mediaKeys');

const fail = (message, status = 400, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Optional image processing.
 *
 * `sharp` is not currently a dependency. Without it the byte and count caps
 * still apply (multer and validateFiles enforce those), but EXIF is NOT
 * stripped and no thumbnail is produced — so this reports what it did rather
 * than silently degrading.
 *
 * EXIF matters: an unstripped phone photo carries GPS coordinates, which for a
 * community post means publishing someone's home address.
 */
const loadSharp = () => {
  try {
    // eslint-disable-next-line global-require
    return require('sharp');
  } catch (error) {
    return null;
  }
};

const processImage = async (buffer, { mime, limits }) => {
  const sharp = loadSharp();
  if (!sharp) {
    return {
      buffer,
      thumb: null,
      width: 0,
      height: 0,
      exifStripped: false,
      degraded: 'sharp is not installed: EXIF not stripped, no thumbnail generated',
    };
  }

  const image = sharp(buffer, { failOn: 'error' });
  const meta = await image.metadata();

  // Animation must survive. Re-encoding a GIF frame-by-frame through the still
  // path silently turns it into a static image.
  const animated = mime === 'image/gif' && (meta.pages || 1) > 1;

  let output = buffer;
  if (limits.stripExif && !animated) {
    // Re-encoding without withMetadata() drops EXIF, including GPS.
    output = await sharp(buffer).rotate().toBuffer(); // rotate() applies EXIF orientation first
  }

  let thumb = null;
  if (limits.generateThumbnails && !animated) {
    thumb = await sharp(buffer)
      .rotate()
      .resize({ width: limits.thumbnailWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  }

  return {
    buffer: output,
    thumb,
    width: meta.width || 0,
    height: meta.height || 0,
    exifStripped: Boolean(limits.stripExif && !animated),
    animated,
    degraded: null,
  };
};

/** Enforce the per-user daily byte allowance. */
const checkDailyQuota = async (user, incomingBytes, limits) => {
  const cap = limits.maxDailyBytesPerUser;
  if (!cap) return;
  const since = new Date(Date.now() - 86400_000);
  const used = await MediaAsset.bytesSince(user._id, since);
  if (used + incomingBytes > cap) {
    throw fail(
      `You have reached your daily upload limit of ${mb(cap)}. Try again tomorrow.`,
      429
    );
  }
};

/**
 * Quarantine a match.
 *
 * The bytes go to the PRIVATE prefix under `spaces/quarantine/`, which has no
 * public read policy — preserved as § 2258A requires, reachable only through a
 * presigned URL issued to a safety reviewer.
 *
 * The incident row is created first so the object key can reference its id, and
 * so a failure to store the bytes still leaves a record that something matched.
 */
const quarantineMatch = async ({ scanResult, buffer, file, user, space, req }) => {
  const incident = await hashMatch.quarantine({
    scanResult,
    buffer,
    uploader: user,
    req,
    space,
    mime: file.mimetype,
  });

  const key = mediaKeys.quarantine({ incidentId: incident._id, mime: file.mimetype });

  try {
    const stored = await storage.uploadBuffer({
      buffer,
      key,
      contentType: file.mimetype,
      visibility: 'private',
      metadata: { incident: String(incident._id), sha256: scanResult.sha256 },
    });
    if (stored) await ChildSafetyIncident.updateOne({ _id: incident._id }, { $set: { storageKey: stored.key } });
  } catch (error) {
    // The incident record is the thing that must survive. Log and continue —
    // losing the bytes is bad, losing the record is worse.
    console.error(`[safety] incident ${incident._id}: quarantine storage failed:`, error.message);
  }

  return incident;
};

/**
 * Upload one file.
 *
 * @param {object} options
 * @param {object} options.file    a multer file with `.buffer`
 * @param {object} options.user
 * @param {object} options.space   null for a draft with no space chosen yet
 * @param {object} options.post    null while drafting
 * @param {object} options.limits  from req.mediaLimits (dynamicUpload)
 * @param {object} options.req     for the incident's IP and user agent
 */
const uploadOne = async ({ file, user, space = null, post = null, limits, req = null }) => {
  // Refuses outright when no scanning provider is configured. "Not configured"
  // must never behave like "clean".
  hashMatch.assertReady();

  await checkDailyQuota(user, file.size, limits);

  // BEFORE any public key is written.
  const scanResult = await hashMatch.scan(file.buffer, { mime: file.mimetype });

  if (!scanResult.available) {
    throw fail('Uploads are temporarily unavailable', 503, {
      internal: 'scanner unavailable — refused rather than published unscanned',
    });
  }

  if (scanResult.matched) {
    await quarantineMatch({ scanResult, buffer: file.buffer, file, user, space, req });
    // Deliberately vague. Confirming a match tells someone probing the system
    // exactly which files evade it.
    throw fail('That file could not be uploaded', 400, { internal: 'csam match — incident opened' });
  }

  const processed = await processImage(file.buffer, { mime: file.mimetype, limits });

  if (processed.width && limits.maxWidth) {
    if (processed.width > limits.maxWidth || processed.height > limits.maxHeight) {
      throw fail(
        `"${file.originalname}" is ${processed.width}×${processed.height}. The limit is ${limits.maxWidth}×${limits.maxHeight}.`,
        413
      );
    }
  }

  const assetId = new mongoose.Types.ObjectId();
  const isDraft = !post;

  const key = isDraft
    ? mediaKeys.draftMedia({ userId: user._id, assetId, mime: file.mimetype })
    : mediaKeys.postMedia({ spaceId: space._id, postId: post._id, assetId, mime: file.mimetype });

  const stored = await storage.uploadBuffer({
    buffer: processed.buffer,
    key,
    contentType: file.mimetype,
    cacheControl: mediaKeys.CACHE_CONTROL,
  });

  let thumbStored = null;
  if (processed.thumb) {
    const thumbKey = isDraft
      ? mediaKeys.draftMediaThumb({ userId: user._id, assetId, mime: 'image/webp' })
      : mediaKeys.postMediaThumb({ spaceId: space._id, postId: post._id, assetId, mime: 'image/webp' });
    thumbStored = await storage.uploadBuffer({
      buffer: processed.thumb,
      key: thumbKey,
      contentType: 'image/webp',
      cacheControl: mediaKeys.CACHE_CONTROL,
    });
  }

  const asset = await MediaAsset.create({
    _id: assetId,
    uploader: user._id,
    space: space ? space._id : null,
    post: post ? post._id : null,
    key: stored.key,
    thumbKey: thumbStored ? thumbStored.key : '',
    url: stored.url,
    thumbUrl: thumbStored ? thumbStored.url : '',
    mime: file.mimetype,
    bytes: processed.buffer.length,
    width: processed.width,
    height: processed.height,
    sha256: scanResult.sha256,
    status: isDraft ? 'draft' : 'attached',
    attachedAt: isDraft ? null : new Date(),
  });

  return {
    id: asset._id,
    url: asset.url,
    thumbUrl: asset.thumbUrl,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    alt: '',
    degraded: processed.degraded,
  };
};

/** Upload a gallery. Sequential so the daily quota is checked against reality. */
const uploadMany = async ({ files, user, space, post, limits, req }) => {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (limits.maxTotalPostBytes && total > limits.maxTotalPostBytes) {
    throw fail(`Those files total ${mb(total)}. The limit is ${mb(limits.maxTotalPostBytes)} per post.`, 413);
  }

  const results = [];
  for (const file of files) {
    results.push(await uploadOne({ file, user, space, post, limits, req }));
  }
  return results;
};

/**
 * Attach draft assets to a post on submit.
 *
 * The objects are NOT moved. An S3 copy of every image on every submit is
 * latency and cost for no benefit — the key is opaque and the URL is stored on
 * the post, so where the bytes live does not matter. Only the ledger row is
 * updated, which is what makes the orphan sweep skip them.
 */
const claimForPost = async ({ assetIds, post, space, user }) => {
  if (!assetIds || !assetIds.length) return [];

  const assets = await MediaAsset.find({
    _id: { $in: assetIds },
    uploader: user._id, // never let one user claim another's upload
    status: 'draft',
  });

  await MediaAsset.updateMany(
    { _id: { $in: assets.map((a) => a._id) } },
    { $set: { post: post._id, space: space._id, status: 'attached', attachedAt: new Date() } }
  );

  return assets.map((asset) => ({
    url: asset.url,
    thumbUrl: asset.thumbUrl,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    alt: '',
    order: 0,
  }));
};

/**
 * Sweep unclaimed drafts.
 *
 * Marked `orphaned` on the first pass and deleted on the next, so a bug in the
 * claim path costs one cycle rather than a user's images.
 */
const sweepOrphans = async ({ graceHours = 24 } = {}) => {
  const cutoff = new Date(Date.now() - graceHours * 3600_000);

  const marked = await MediaAsset.updateMany(
    { status: 'draft', createdAt: { $lt: cutoff } },
    { $set: { status: 'orphaned' } }
  );

  const doomed = await MediaAsset.find({
    status: 'orphaned',
    createdAt: { $lt: new Date(cutoff.getTime() - graceHours * 3600_000) },
  }).select('key thumbKey');

  if (doomed.length) {
    const keys = doomed.flatMap((a) => [a.key, a.thumbKey].filter(Boolean));
    await storage.removeKeys(keys);
    await MediaAsset.deleteMany({ _id: { $in: doomed.map((a) => a._id) } });
  }

  return { marked: marked.modifiedCount || 0, deleted: doomed.length };
};

/** Delete every object for a post. Called when a post is hard-deleted. */
const purgePost = async (postId) => {
  const assets = await MediaAsset.find({ post: postId }).select('key thumbKey');
  if (!assets.length) return { deleted: 0 };
  await storage.removeKeys(assets.flatMap((a) => [a.key, a.thumbKey].filter(Boolean)));
  await MediaAsset.deleteMany({ post: postId });
  return { deleted: assets.length };
};

/** Delete every object for a space. One prefix, by design — see mediaKeys.js. */
const purgeSpace = async (spaceId) => {
  const assets = await MediaAsset.find({ space: spaceId }).select('key thumbKey');
  if (!assets.length) return { deleted: 0 };
  await storage.removeKeys(assets.flatMap((a) => [a.key, a.thumbKey].filter(Boolean)));
  await MediaAsset.deleteMany({ space: spaceId });
  await counterService.increment('space', spaceId, {});
  return { deleted: assets.length };
};

const registerJobs = (dispatcher) => {
  dispatcher.register('media.sweepOrphans', async () => sweepOrphans());
  dispatcher.register('media.purgePost', async ({ postId }) => purgePost(postId));
  dispatcher.register('media.purgeSpace', async ({ spaceId }) => purgeSpace(spaceId));
};

module.exports = {
  uploadOne,
  uploadMany,
  claimForPost,
  sweepOrphans,
  purgePost,
  purgeSpace,
  processImage,
  checkDailyQuota,
  registerJobs,
  loadSharp,
};
