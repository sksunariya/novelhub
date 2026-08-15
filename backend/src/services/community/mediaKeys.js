// S3 key layout for community media.
//
// The layout is a deliberate design, not a convention that emerged. Object keys
// are effectively permanent — they are embedded in URLs users have shared — so
// getting the shape wrong means either living with it or breaking links.
//
// ┌─ public/
// │  └─ spaces/
// │     ├─ <spaceId>/
// │     │  ├─ icon/<sha>.<ext>
// │     │  ├─ banner/<sha>.<ext>
// │     │  └─ posts/<YYYY>/<MM>/<postId>/
// │     │     ├─ <assetId>.<ext>
// │     │     └─ <assetId>_t.<ext>          thumbnail
// │     └─ users/<userId>/avatar/<sha>.<ext>
// └─ private/
//    └─ spaces/quarantine/<YYYY>/<MM>/<incidentId>.<ext>
//
// WHY spaceId FIRST: the dominant bulk operation is "this space was deleted /
// banned / is being purged". With the space at the root, that is one prefix
// delete and one prefix in a cost report. With the date first it would be a
// full-bucket scan.
//
// WHY A DATE PARTITION UNDER posts/: lifecycle rules ("move media older than
// two years to Glacier") and cost attribution per period both operate on
// prefixes. Without it, every such rule has to enumerate the bucket.
//
// WHY postId THEN assetId: a post's images live together, so deleting a post is
// also a prefix delete, and a gallery's objects sit adjacent for range reads.
//
// WHY A CONTENT HASH FOR ICONS AND AVATARS: they are replaced repeatedly and
// the old URL must stop resolving to the new image. A content-addressed name
// means a change produces a new key, so `Cache-Control: immutable` is safe and
// no invalidation is ever needed.
//
// WHY QUARANTINE IS PRIVATE AND DATE-PARTITIONED: it must never be publicly
// readable, and preservation windows are managed per period.

const crypto = require('crypto');

const EXT_FOR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Extension from the MIME type, never from the filename — that is user input. */
const extFor = (mime) => EXT_FOR_MIME[mime] || 'bin';

const datePart = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}`;
};

const shortHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

const ROOT = 'spaces';

/** Post media. `assetId` is the MediaAsset _id, so the object maps to a row. */
const postMedia = ({ spaceId, postId, assetId, mime, at = new Date() }) =>
  `${ROOT}/${spaceId}/posts/${datePart(at)}/${postId}/${assetId}.${extFor(mime)}`;

/** Thumbnail beside its original, so both are one prefix delete. */
const postMediaThumb = ({ spaceId, postId, assetId, mime, at = new Date() }) =>
  `${ROOT}/${spaceId}/posts/${datePart(at)}/${postId}/${assetId}_t.${extFor(mime)}`;

/**
 * Media uploaded before a post exists.
 *
 * The composer uploads as you drag files in, so the post has no id yet. These
 * land in a `drafts/<userId>/` prefix and are either claimed on submit or swept
 * by the orphan job — which is why they are separated rather than written to a
 * guessed post id.
 */
const draftMedia = ({ userId, assetId, mime, at = new Date() }) =>
  `${ROOT}/drafts/${datePart(at)}/${userId}/${assetId}.${extFor(mime)}`;

const draftMediaThumb = ({ userId, assetId, mime, at = new Date() }) =>
  `${ROOT}/drafts/${datePart(at)}/${userId}/${assetId}_t.${extFor(mime)}`;

const spaceIcon = ({ spaceId, buffer, mime }) =>
  `${ROOT}/${spaceId}/icon/${shortHash(buffer)}.${extFor(mime)}`;

const spaceBanner = ({ spaceId, buffer, mime }) =>
  `${ROOT}/${spaceId}/banner/${shortHash(buffer)}.${extFor(mime)}`;

const userAvatar = ({ userId, buffer, mime }) =>
  `${ROOT}/users/${userId}/avatar/${shortHash(buffer)}.${extFor(mime)}`;

/** Private. Never public-readable, never deleted while an incident is open. */
const quarantine = ({ incidentId, mime, at = new Date() }) =>
  `${ROOT}/quarantine/${datePart(at)}/${incidentId}.${extFor(mime)}`;

/** Prefixes for bulk operations. Each is a single S3 list-and-delete. */
const prefixes = {
  space: (spaceId) => `${ROOT}/${spaceId}/`,
  spacePosts: (spaceId) => `${ROOT}/${spaceId}/posts/`,
  post: (spaceId, postId, at = new Date()) => `${ROOT}/${spaceId}/posts/${datePart(at)}/${postId}/`,
  userDrafts: (userId, at = new Date()) => `${ROOT}/drafts/${datePart(at)}/${userId}/`,
  allDrafts: () => `${ROOT}/drafts/`,
  quarantine: () => `${ROOT}/quarantine/`,
};

// Immutable: every key above is content-addressed or carries a unique id, so a
// URL can never point at different bytes.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

module.exports = {
  postMedia,
  postMediaThumb,
  draftMedia,
  draftMediaThumb,
  spaceIcon,
  spaceBanner,
  userAvatar,
  quarantine,
  prefixes,
  extFor,
  datePart,
  shortHash,
  ROOT,
  CACHE_CONTROL,
  EXT_FOR_MIME,
};
