const express = require('express');
const { uploadDraftMedia, claimMedia, uploadSpaceImage } = require('../controllers/mediaController');
const { protect } = require('../middlewares/auth');
const { dynamicUpload, validateFiles } = require('../middlewares/dynamicUpload');
const { uploadLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// dynamicUpload builds multer per request from live settings, so a size cap
// changed in the admin portal applies to the very next upload. validateFiles
// then checks per-type bytes, request totals and pixel dimensions with the
// buffer in hand.

// The limiter runs BEFORE multer on purpose: a rejected request must not first
// pay for parsing the multipart body it was rejected for sending.
router.post(
  '/draft',
  protect,
  uploadLimiter,
  dynamicUpload({ field: 'images', multiple: true }),
  validateFiles,
  uploadDraftMedia
);

router.post('/claim/:slug', protect, claimMedia);

// Icons and banners have their own caps, which are much smaller than post media.
router.post(
  '/space/:slug/:kind',
  protect,
  uploadLimiter,
  dynamicUpload({ field: 'image', multiple: false, maxBytesKey: 'spaces.media.bannerMaxBytes' }),
  validateFiles,
  uploadSpaceImage
);

module.exports = router;
