// File storage abstraction.
//
// Two visibility tiers, split by S3 key prefix within a single bucket:
//   - PUBLIC  (logos, favicons, covers, editor images) -> served via a public
//     URL. Public read is granted by a bucket policy on the public prefix (or a
//     CDN in front). No per-object ACL is set unless S3_USE_ACL=true.
//   - PRIVATE (chapter source .txt/.docx/.zip files) -> never public. Retrieved
//     only through short-lived presigned GET URLs.
//
// If S3 is not configured (no S3_BUCKET / AWS_REGION), public uploads fall back
// to the local `uploads/` directory (dev convenience) and private uploads are
// skipped. See .env.example for the full configuration + required bucket policy.

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const PUBLIC_BASE_URL = (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const USE_ACL = process.env.S3_USE_ACL === 'true';
const PUBLIC_PREFIX = (process.env.S3_PUBLIC_PREFIX || 'public').replace(/^\/+|\/+$/g, '');
const PRIVATE_PREFIX = (process.env.S3_PRIVATE_PREFIX || 'private').replace(/^\/+|\/+$/g, '');
const SIGNED_URL_TTL = Number(process.env.S3_SIGNED_URL_TTL) || 3600;

const LOCAL_DIR = path.join(__dirname, '..', '..', 'uploads');

const s3Enabled = Boolean(REGION && BUCKET);

let client = null;
let PutObjectCommand;
let DeleteObjectCommand;
let GetObjectCommand;
let getSignedUrl;

if (s3Enabled) {
  const s3 = require('@aws-sdk/client-s3');
  ({ PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = s3);
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  // Omitting `credentials` lets the SDK use its default chain (env vars, shared
  // config, or an attached IAM role) so keys are optional in AWS-hosted envs.
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined;
  client = new s3.S3Client({ region: REGION, ...(credentials ? { credentials } : {}) });
}

const randomName = (originalname) => {
  const ext = path.extname(originalname || '').toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
};

const publicUrlForKey = (key) =>
  PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/${key}` : `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

// Reverse of publicUrlForKey: extract the object key from a stored URL, but only
// for URLs that point at our own bucket/CDN (external URLs return null so we
// never try to delete something we don't own).
const keyFromUrl = (url) => {
  if (typeof url !== 'string') return null;
  const bases = [PUBLIC_BASE_URL, `https://${BUCKET}.s3.${REGION}.amazonaws.com`, `https://${BUCKET}.s3.amazonaws.com`].filter(Boolean);
  for (const base of bases) {
    if (url.startsWith(`${base}/`)) return url.slice(base.length + 1);
  }
  return null;
};

const saveLocalPublic = async (file, folder) => {
  const name = randomName(file.originalname);
  const dir = path.join(LOCAL_DIR, folder);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, name), file.buffer);
  return `/uploads/${folder}/${name}`;
};

// Store a public asset. Returns the URL to persist and render in the frontend.
const uploadPublic = async (file, folder) => {
  if (!s3Enabled) return saveLocalPublic(file, folder);
  const key = `${PUBLIC_PREFIX}/${folder}/${randomName(file.originalname)}`;
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ...(USE_ACL ? { ACL: 'public-read' } : {}),
    })
  );
  return publicUrlForKey(key);
};

// Store a private asset. Returns { key, name, size, contentType } to record, or
// null when S3 is not configured (private archival requires S3).
const uploadPrivate = async (file, folder, displayName) => {
  if (!s3Enabled) return null;
  const key = `${PRIVATE_PREFIX}/${folder}/${randomName(file.originalname)}`;
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return { key, name: displayName || file.originalname, size: file.size, contentType: file.mimetype };
};

// Short-lived presigned GET URL for a private object. Null when S3 is off.
const getSignedDownloadUrl = async (key, expiresIn = SIGNED_URL_TTL) => {
  if (!s3Enabled || !key) return null;
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
};

// Best-effort delete of a public asset by its stored URL (S3 object or local file).
const remove = async (storedUrl) => {
  if (!storedUrl) return;
  try {
    if (storedUrl.startsWith('/uploads/')) {
      await fsp.unlink(path.join(LOCAL_DIR, storedUrl.replace(/^\/uploads\//, ''))).catch(() => {});
      return;
    }
    if (!s3Enabled) return;
    const key = keyFromUrl(storedUrl);
    if (key) await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error('storage.remove failed:', err.message);
  }
};

// Best-effort delete of a private object by key.
const removeKey = async (key) => {
  if (!s3Enabled || !key) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error('storage.removeKey failed:', err.message);
  }
};

module.exports = {
  isEnabled: () => s3Enabled,
  uploadPublic,
  uploadPrivate,
  getSignedDownloadUrl,
  remove,
  removeKey,
};
