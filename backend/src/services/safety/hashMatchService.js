// Perceptual hash matching for child sexual abuse material.
//
// THIS IS A LEGAL CONTROL, NOT A MODERATION FEATURE. US electronic service
// providers must report apparent CSAM to NCMEC's CyberTipline as soon as
// reasonably possible after obtaining actual knowledge, and must preserve the
// material and its context (18 U.S.C. § 2258A / REPORT Act).
//
// NO USER-UPLOADED IMAGE MAY BECOME PUBLICLY READABLE BEFORE THIS RUNS.
// That ordering is the whole point — scanning after publication means the
// window between upload and detection is a window of distribution.
//
// PROVIDER MODEL: this file owns the pipeline, the quarantine and the incident
// record. It does NOT implement matching — that is PhotoDNA (free to qualifying
// platforms via Microsoft) or Thorn's Safer, installed with `setProvider`.
//
// WITH NO PROVIDER INSTALLED, `scan()` returns `available: false`. It does NOT
// return "clean". Callers must treat the two differently: an unscanned upload
// is not a safe upload, and `spaces.media.enabled` should stay off until a
// provider is configured. That distinction is enforced by `assertReady()`.

const crypto = require('crypto');
const mongoose = require('mongoose');
const ChildSafetyIncident = require('../../models/ChildSafetyIncident');

const nullProvider = {
  name: 'none',
  available: false,
  match: async () => ({ matched: false, available: false }),
};

let provider = nullProvider;

/**
 * Install a matching provider.
 *
 *   hashMatchService.setProvider({
 *     name: 'photodna',
 *     match: async (buffer, { sha256 }) => ({ matched: bool, confidence, hash }),
 *   });
 */
const setProvider = (impl) => {
  if (!impl || typeof impl.match !== 'function') {
    throw new Error('A hash match provider needs a match(buffer, context) function');
  }
  provider = { available: true, ...impl };
  return provider;
};

const resetProvider = () => {
  provider = nullProvider;
};

const getProvider = () => ({ name: provider.name, available: provider.available });

/**
 * Refuse to run an image pipeline with no scanner behind it.
 *
 * Called at the top of the media upload path. Failing loudly at configuration
 * time is far better than discovering months later that nothing was ever
 * scanned — which is the realistic failure mode when a "not configured" state
 * silently behaves like "clean".
 */
const assertReady = ({ allowUnscanned = process.env.ALLOW_UNSCANNED_UPLOADS === 'true' } = {}) => {
  if (provider.available || allowUnscanned) return true;
  throw Object.assign(
    new Error(
      'Image uploads are disabled: no CSAM scanning provider is configured. ' +
        'Install a provider via hashMatchService.setProvider, or set ' +
        'ALLOW_UNSCANNED_UPLOADS=true to override in a development environment.'
    ),
    { status: 503 }
  );
};

const sha256Of = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Scan a buffer.
 *
 * Checks the exact-hash index first: a file already recorded as an incident
 * must be caught without a vendor round trip, both for speed and because the
 * same file being re-uploaded is itself a signal worth recording.
 *
 * A provider failure is NOT treated as clean. It returns `available: false`,
 * and the caller must refuse the upload rather than publish something
 * unscanned.
 */
const scan = async (buffer, context = {}) => {
  const sha256 = sha256Of(buffer);

  // The known-hash check is an OPTIMIZATION, not the control. It short-circuits
  // a vendor call for a file already on record.
  //
  // It is guarded on the connection state and wrapped, because a mongoose query
  // with no connection BUFFERS rather than failing — which would hang the
  // upload request until the buffer timeout rather than proceeding to the
  // provider that actually decides. A database blip must not stall uploads, and
  // must equally not be a way to skip scanning: if the provider is unavailable
  // too, the result below is still `available: false`.
  try {
    if (mongoose.connection.readyState === 1) {
      const known = await ChildSafetyIncident.findOne({ sha256 }).select('_id status').lean();
      if (known) {
        return {
          available: true,
          matched: true,
          sha256,
          matchType: 'known_hash',
          confidence: 1,
          priorIncident: known._id,
        };
      }
    }
  } catch (error) {
    console.error('[safety] known-hash lookup failed, falling through to provider:', error.message);
  }

  if (!provider.available) return { available: false, matched: false, sha256 };

  try {
    const result = await provider.match(buffer, { ...context, sha256 });
    return {
      available: true,
      matched: Boolean(result && result.matched),
      sha256,
      perceptualHash: (result && result.hash) || '',
      confidence: (result && result.confidence) || 0,
      matchType: provider.name,
    };
  } catch (error) {
    // Never swallow into "clean". An outage at the vendor must fail the upload,
    // not wave it through.
    console.error('[safety] hash provider failed:', error.message);
    return { available: false, matched: false, sha256, error: error.message };
  }
};

/**
 * Quarantine a match and open an incident.
 *
 * Records everything § 2258A requires be preserved. The file is NOT deleted —
 * it is held at a restricted storage key, because deleting it destroys the
 * evidence the law requires be kept and the hash that prevents re-upload.
 */
const quarantine = async ({ scanResult, buffer, uploader, req = null, space = null, post = null, storageKey = '', mime = '' }) => {
  const incident = await ChildSafetyIncident.create({
    status: ChildSafetyIncident.STATUS.DETECTED,
    matchType: scanResult.matchType || 'unknown',
    matchConfidence: scanResult.confidence || 0,
    perceptualHash: scanResult.perceptualHash || '',
    sha256: scanResult.sha256,
    storageKey,
    mime,
    bytes: buffer ? buffer.length : 0,
    uploader: uploader._id,
    uploaderSnapshot: {
      username: uploader.username || '',
      email: uploader.email || '',
      createdAt: uploader.createdAt || null,
    },
    ipAddress: req ? req.ip || '' : '',
    userAgent: req ? req.headers['user-agent'] || '' : '',
    space: space ? space._id : null,
    post: post ? post._id : null,
  });

  // Deliberately terse, and deliberately not to the ordinary admin log. The
  // detail lives in the restricted queue.
  console.error(`[safety] incident ${incident._id} opened — restricted queue`);

  return incident;
};

/**
 * The call the media pipeline makes.
 *
 * Returns `{ safe: true }` or throws. Throwing rather than returning a flag is
 * intentional: a caller that forgets to check a boolean publishes the image,
 * and that failure mode is unacceptable here.
 */
const guardUpload = async ({ buffer, uploader, req, space = null, mime = '' }) => {
  assertReady();

  const result = await scan(buffer, { mime });

  if (!result.available) {
    throw Object.assign(
      new Error('Uploads are temporarily unavailable'),
      { status: 503, internal: 'scanner unavailable — upload refused rather than published unscanned' }
    );
  }

  if (result.matched) {
    await quarantine({ scanResult: result, buffer, uploader, req, space, mime });
    // The uploader is told nothing specific. Confirming a match tells someone
    // testing the system exactly which files evade it.
    throw Object.assign(new Error('That file could not be uploaded'), {
      status: 400,
      internal: 'csam match — incident opened',
    });
  }

  return { safe: true, sha256: result.sha256 };
};

module.exports = {
  scan,
  guardUpload,
  quarantine,
  assertReady,
  setProvider,
  resetProvider,
  getProvider,
  sha256Of,
};
