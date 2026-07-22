const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { UPLOAD_LIMITS } = require('../config/constants');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/gif'];
const DOC_EXTENSIONS = ['.txt', '.docx', '.zip'];

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

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

module.exports = { imageUpload, docUpload, UPLOAD_DIR };
