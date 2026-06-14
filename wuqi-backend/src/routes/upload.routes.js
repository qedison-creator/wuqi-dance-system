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

/**
 * FFmpeg 生成视频首帧缩略图
 * 截取视频第1秒画面，保存为 JPEG
 * @param {string} inputPath - 视频文件路径
 * @returns {string|null} - 缩略图文件名，失败返回 null
 */
async function generateVideoThumbnail(inputPath) {
  const { execFile } = require('child_process');
  const thumbFilename = path.basename(inputPath, path.extname(inputPath)) + '_thumb.jpg';
  const thumbPath = path.join(path.dirname(inputPath), thumbFilename);

  return new Promise((resolve) => {
    const args = [
      '-threads', '1',
      '-i', inputPath,
      '-ss', '00:00:01',     // 截取第1秒
      '-vframes', '1',        // 只取1帧
      '-q:v', '5',            // 高质量 (2-31, 越小越好)
      '-y',
      thumbPath
    ];

    execFile('ffmpeg', args, { timeout: 30000 }, (err) => {
      if (err) {
        console.error('[FFmpeg] 缩略图生成失败:', err.message);
        return resolve(null);
      }
      try {
        if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
          console.log(`[FFmpeg] 缩略图已生成: ${thumbFilename}`);
          resolve(thumbFilename);
        } else {
          console.warn('[FFmpeg] 缩略图文件为空');
          resolve(null);
        }
      } catch (e) {
        console.error('[FFmpeg] 缩略图文件检查失败:', e.message);
        resolve(null);
      }
    });
  });
}

/**
 * 后端 FFmpeg 视频压缩
 * 参数：720p 1280×720, H.264, 25fps, CRF 23, preset fast, AAC 128kbps
 * 如果压缩后反而更大，保留原文件
 */
async function compressVideo(inputPath) {
  const { execFile } = require('child_process');
  const outputPath = inputPath.replace(/(\.\w+)$/, '_compressed$1');

  return new Promise((resolve, reject) => {
    const args = [
      '-threads', '1',          // 限制单线程，避免CPU 100%
      '-i', inputPath,
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-r', '25',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    execFile('ffmpeg', args, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[FFmpeg] 压缩失败:', stderr ? stderr.substring(0, 300) : err.message);
        return resolve(null); // 压缩失败，用原文件
      }
      try {
        const originalSize = fs.statSync(inputPath).size;
        const compressedSize = fs.statSync(outputPath).size;
        console.log(`[FFmpeg] 压缩完成: ${(originalSize/1024/1024).toFixed(1)}MB → ${(compressedSize/1024/1024).toFixed(1)}MB`);

        if (compressedSize < originalSize) {
          // 用压缩版替换原文件
          fs.unlinkSync(inputPath);
          fs.renameSync(outputPath, inputPath);
          resolve(compressedSize);
        } else {
          // 压缩后更大，删除压缩版，保留原文件
          fs.unlinkSync(outputPath);
          resolve(null);
        }
      } catch (e) {
        console.error('[FFmpeg] 文件操作失败:', e.message);
        resolve(null);
      }
    });
  });
}

router.post('/video', auth, checkPermission(['super_admin', 'store_manager', 'staff']), videoUpload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择视频文件', data: null });
    }

    const subDir = req._uploadSubDir || 'general';
    const filename = req.file.filename;
    const relativePath = `/uploads/${subDir}/${filename}`;

    let finalSize = req.file.size;

    // FFmpeg 生成首帧缩略图（同步，确保响应中包含 thumbnail_url）
    const thumbFilename = await generateVideoThumbnail(req.file.path);
    let thumbnailUrl = null;
    if (thumbFilename) {
      thumbnailUrl = `/uploads/${subDir}/${thumbFilename}`;
    }

    // 服务端 FFmpeg 压缩（异步，不阻塞响应）
    compressVideo(req.file.path).then(compressedSize => {
      if (compressedSize) {
        console.log(`[Upload] 视频已服务端压缩: ${relativePath}`);
      }
    }).catch(() => {});

    res.json(success({
      filename: filename,
      url: relativePath,
      path: relativePath,
      thumbnail_url: thumbnailUrl,
      size: finalSize,
      mimetype: req.file.mimetype,
    }, '视频上传成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
