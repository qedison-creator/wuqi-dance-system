const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { success } = require('../utils/response');

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  // sharp 未安装，压缩功能将静默跳过
}

const IMAGE_OPTIMIZE_CONFIG = {
  // 课程封面：16:9展示，800px宽足够，渐进式JPEG加快首屏
  course: { maxWidth: 800, quality: 82, progressive: true },
  // 教练头像：圆形小图，400px宽足够
  coach_avatar: { maxWidth: 400, quality: 88, progressive: true },
  // 教练相册：详情页大图展示，保留更多细节
  coach_album: { maxWidth: 1200, quality: 85, progressive: true },
  // Banner轮播图：全宽展示，需要较高清晰度
  banner: { maxWidth: 1400, quality: 82, progressive: true },
  // 用户头像：小图，400px宽足够
  user_avatar: { maxWidth: 400, quality: 88, progressive: true },
  // 通用默认
  _default: { maxWidth: 1200, quality: 82, progressive: true },
};

function getOptimizeConfig(type) {
  return IMAGE_OPTIMIZE_CONFIG[type] || IMAGE_OPTIMIZE_CONFIG._default;
}

async function optimizeImage(filePath, type) {
  if (!sharp) return null;

  try {
    const config = getOptimizeConfig(type);
    const metadata = await sharp(filePath).metadata();
    const isPng = metadata.format === 'png';
    const isGif = metadata.format === 'gif';

    // GIF 不压缩（会丢失动画）
    if (isGif) return null;

    let pipeline = sharp(filePath).resize({ width: config.maxWidth, withoutEnlargement: true });

    if (isPng) {
      // PNG 保持 PNG 格式（透明通道），使用高压缩级别
      pipeline = pipeline.png({ quality: config.quality, compressionLevel: 8, effort: 8 });
    } else {
      // JPEG/WebP 等统一输出为渐进式 JPEG
      pipeline = pipeline.jpeg({
        quality: config.quality,
        progressive: config.progressive !== false,
        mozjpeg: true,  // 使用 mozjpeg 获得更好的压缩率
      });
    }

    const buffer = await pipeline.toBuffer();
    fs.writeFileSync(filePath, buffer);
    return buffer.length;
  } catch (e) {
    // 压缩失败，静默跳过
    return null;
  }
}

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const SUB_DIRS = {
  coach_avatar: 'avatars',
  coach_album: 'images',
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

router.post('/image', auth, checkPermission(['super_admin', 'store_manager', 'staff']), imageUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择图片文件', data: null });
    }

    const subDir = req._uploadSubDir || 'general';
    const filename = req.file.filename;
    const relativePath = `/uploads/${subDir}/${filename}`;
    const type = req.query.type || (req.body && req.body.type) || 'general';

    let finalSize = req.file.size;
    let optimizedSize = null;

    const compressedSize = await optimizeImage(req.file.path, type);
    if (compressedSize !== null) {
      optimizedSize = compressedSize;
      finalSize = compressedSize;
    }

    res.json(success({
      filename: filename,
      url: relativePath,
      path: relativePath,
      size: finalSize,
      optimized_size: optimizedSize,
      mimetype: req.file.mimetype,
    }, '图片上传成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
