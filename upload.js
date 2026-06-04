const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { upload: uploadConfig } = require('../config');

const storage = multer.diskStorage({
  destination: uploadConfig.dir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (uploadConfig.allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported audio format: ${file.mimetype}`), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: uploadConfig.maxSizeMb * 1024 * 1024 },
});

module.exports = upload;
