// Upload middleware whose limits come from live settings.
//
// `middlewares/upload.js` builds its multer instances once, at require time,
// from the UPLOAD_LIMITS constants. That is fine for admin-only chapter and
// cover uploads, but it means an admin lowering a size cap in the portal
// changes nothing until the process restarts.
//
// Community uploads are user-facing and the caps are a live abuse and cost
// control, so they are read per request: this middleware takes a settings
// snapshot, constructs multer with those numbers, and runs it. A cap changed in
// the admin portal applies to the very next upload.
//
// The cost is one settings read per upload, which is served from the in-process
// cache in settingsService and is not a database round trip.

const multer = require('multer');
const settingsService = require('../services/settingsService');

// Never a real image; always a script-execution vector when served from your
// own origin. Excluded regardless of what the setting says.
const FORBIDDEN_MIMES = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml']);

const MIME_EXTENSIONS = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
};

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Resolve the byte cap for one file. GIFs get their own, larger allowance
 * because they are routinely an order of magnitude bigger than a still.
 */
const limitFor = (mimetype, snapshot) =>
  mimetype === 'image/gif'
    ? snapshot.get('spaces.media.maxGifBytes')
    : snapshot.get('spaces.media.maxImageBytes');

/**
 * Build a multer handler from current settings.
 *
 * @param {object}  options
 * @param {string}  options.field       form field name
 * @param {boolean} options.multiple    array upload vs single file
 * @param {string}  options.maxBytesKey registry key overriding the per-file cap
 *                                      (space icons and banners have their own)
 * @param {string}  options.maxCountKey registry key for the file count cap
 */
const build = (snapshot, { multiple, maxBytesKey, maxCountKey }) => {
  const allowed = new Set(snapshot.get('spaces.media.allowedMimeTypes'));
  const maxCount = maxCountKey ? snapshot.get(maxCountKey) : 1;

  // multer enforces a single fileSize for the whole request, so the ceiling is
  // the largest any one file could legitimately be. The exact per-type cap is
  // then applied in fileFilter, where the mimetype is known.
  const ceiling = maxBytesKey
    ? snapshot.get(maxBytesKey)
    : Math.max(snapshot.get('spaces.media.maxImageBytes'), snapshot.get('spaces.media.maxGifBytes'));

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: ceiling,
      files: multiple ? maxCount : 1,
      fields: 40,
    },
    fileFilter: (req, file, cb) => {
      if (FORBIDDEN_MIMES.has(file.mimetype)) {
        return cb(bad('That file type is not allowed'));
      }
      if (!allowed.has(file.mimetype)) {
        return cb(bad(`${file.mimetype} is not an allowed image type`));
      }
      // Reject a mismatch between the claimed type and the extension. Not a
      // security boundary on its own — the magic-byte check in the controller
      // is — but it catches the honest cases early and cheaply.
      const extensions = MIME_EXTENSIONS[file.mimetype];
      if (extensions && !extensions.some((ext) => file.originalname.toLowerCase().endsWith(ext))) {
        return cb(bad('File extension does not match its type'));
      }
      return cb(null, true);
    },
  });
};

/**
 * Express middleware factory.
 *
 *   router.post('/posts/:id/media', protect, dynamicUpload({ field: 'images', multiple: true }), handler)
 */
const dynamicUpload = ({
  field = 'file',
  multiple = false,
  maxBytesKey = null,
  maxCountKey = 'spaces.media.maxImagesPerPost',
  requireEnabled = true,
} = {}) =>
  async function uploadMiddleware(req, res, next) {
    let snapshot;
    try {
      snapshot = await settingsService.snapshot();
    } catch (error) {
      // Settings are unreadable. Refuse the upload rather than silently
      // falling back to a hardcoded limit an admin thinks they changed.
      return next(Object.assign(new Error('Upload is temporarily unavailable'), { status: 503 }));
    }

    if (requireEnabled && !snapshot.get('spaces.media.enabled')) {
      return next(Object.assign(new Error('Media uploads are disabled'), { status: 403 }));
    }

    const handler = build(snapshot, { multiple, maxBytesKey, maxCountKey });
    const run = multiple
      ? handler.array(field, snapshot.get(maxCountKey || 'spaces.media.maxImagesPerPost'))
      : handler.single(field);

    return run(req, res, (error) => {
      if (!error) {
        req.mediaLimits = {
          maxImageBytes: snapshot.get('spaces.media.maxImageBytes'),
          maxGifBytes: snapshot.get('spaces.media.maxGifBytes'),
          maxTotalPostBytes: snapshot.get('spaces.media.maxTotalPostBytes'),
          maxDailyBytesPerUser: snapshot.get('spaces.media.maxDailyBytesPerUser'),
          maxWidth: snapshot.get('spaces.media.maxImageWidth'),
          maxHeight: snapshot.get('spaces.media.maxImageHeight'),
          stripExif: snapshot.get('spaces.media.stripExif'),
          generateThumbnails: snapshot.get('spaces.media.generateThumbnails'),
          thumbnailWidth: snapshot.get('spaces.media.thumbnailWidth'),
        };
        return next();
      }

      // Translate multer's error codes into messages that name the actual
      // configured limit, so a user knows what to do rather than seeing
      // "LIMIT_FILE_SIZE".
      if (error.code === 'LIMIT_FILE_SIZE') {
        const cap = maxBytesKey ? snapshot.get(maxBytesKey) : snapshot.get('spaces.media.maxImageBytes');
        return next(bad(`That file is too large. The limit is ${mb(cap)}.`, 413));
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        const cap = snapshot.get(maxCountKey || 'spaces.media.maxImagesPerPost');
        return next(bad(`Too many files. The limit is ${cap} per post.`, 400));
      }
      if (!error.status) error.status = 400;
      return next(error);
    });
  };

/**
 * Post-multer checks that need the buffer in hand: per-type byte cap, total
 * bytes across the request, and pixel dimensions.
 *
 * Dimension checking rejects decompression bombs — a 2 KB PNG that expands to
 * gigabytes once decoded. `sharp` is used when available; without it the
 * dimension check is skipped rather than failing the upload, and the byte caps
 * still apply.
 */
const validateFiles = async (req, res, next) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return next();

  const limits = req.mediaLimits;
  if (!limits) return next();

  let total = 0;
  for (const file of files) {
    total += file.size;

    const cap = file.mimetype === 'image/gif' ? limits.maxGifBytes : limits.maxImageBytes;
    if (file.size > cap) {
      return next(bad(`"${file.originalname}" is ${mb(file.size)}. The limit is ${mb(cap)}.`, 413));
    }
  }

  if (limits.maxTotalPostBytes && total > limits.maxTotalPostBytes) {
    return next(bad(`Those files total ${mb(total)}. The limit is ${mb(limits.maxTotalPostBytes)} per post.`, 413));
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch (error) {
    return next(); // not installed: byte caps still applied above
  }

  for (const file of files) {
    try {
      const meta = await sharp(file.buffer).metadata();
      if (!meta.width || !meta.height) {
        return next(bad(`"${file.originalname}" is not a readable image`));
      }
      if (meta.width > limits.maxWidth || meta.height > limits.maxHeight) {
        return next(
          bad(
            `"${file.originalname}" is ${meta.width}×${meta.height}. The limit is ` +
              `${limits.maxWidth}×${limits.maxHeight}.`,
            413
          )
        );
      }
      file.dimensions = { width: meta.width, height: meta.height };
    } catch (error) {
      // sharp refusing to parse it means it is not the image it claims to be.
      return next(bad(`"${file.originalname}" could not be read as an image`));
    }
  }

  return next();
};

module.exports = { dynamicUpload, validateFiles };
