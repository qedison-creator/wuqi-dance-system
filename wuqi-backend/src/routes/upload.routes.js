const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { success } = require('../utils/response');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const SUB_DIRS = {
  coach_avatar: 'coaches',
  coach_album: 'coaches',
  coach_video: 'videos',
  course: 'courses',
  user_avatar: 'users',
  banner: 'banners',
  general: 'general',
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

Object.values(SUB_DIRS).forEach(dir => {
  ensureDir(path.join(UPLOADS_ROOT, dir));
});

function getSubDir(type) {
  const typeStr = String(type || 'general').toLowerCase().trim();
  return SUB_DIRS[typeStr] || 'general';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || (req.body && req.body.type) || 'general';
    const subDir = getSubDir(type);
    const dest = path.join(UPLOADS_ROOT, subDir);
    ensureDir(dest);
    req._uploadSubDir = subDir;
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, filename);
  },
});

const imageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片类型，仅支持jpeg/jpg/png/gif/webp'));
    }
  },
});

const videoUpload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mov|avi|wmv|flv|mkv/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('video/');
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('不支持的视频类型，仅支持mp4/mov/avi/wmv/flv/mkv'));
    }
  },
});

router.post('/image', auth, checkPermission(['super_admin', 'store_manager', 'staff']), imageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择图片文件', data: null });
    }

    const subDir = req._uploadSubDir || 'general';
    const filename = req.file.filename;
    const relativePath = `/uploads/${subDir}/${filename}`;

    res.json(success({
      filename: filename,
      url: relativePath,
      path: relativePath,
      size: req.file.size,
      mimetype: req.file.mimetype,
    }, '图片上传成功'));
  } catch (err) {
    next(err);
  }
});

router.post('/video', auth, checkPermission(['super_admin', 'store_manager', 'staff']), videoUpload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择视频文件', data: null });
    }

    const subDir = req._uploadSubDir || 'general';
    const filename = req.file.filename;
    const relativePath = `/uploads/${subDir}/${filename}`;

    res.json(success({
      filename: filename,
      url: relativePath,
      path: relativePath,
      size: req.file.size,
      mimetype: req.file.mimetype,
    }, '视频上传成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
