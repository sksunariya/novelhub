const multer = require('multer');
const path = require('path');
const { UPLOAD_LIMITS } = require('../config/constants');

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/gif'];
const DOC_EXTENSIONS = ['.txt', '.docx', '.zip'];

// In-memory storage: handlers receive the file buffer and forward it to the
// storage service (S3, or local-disk fallback). No temp files are written here.
const storage = multer.memoryStorage();

const imageUpload = multer({
  storage,
  limits: { fileSize: UPLOAD_LIMITS.IMAGE_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  },
});

const docUpload = multer({
  storage,
  limits: { fileSize: UPLOAD_LIMITS.DOC_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (DOC_EXTENSIONS.includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Only .txt, .docx and .zip files are allowed'));
  },
});

module.exports = { imageUpload, docUpload };
