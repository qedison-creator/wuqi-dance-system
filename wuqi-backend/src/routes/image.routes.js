const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const imageService = require('../services/image.service');
const { success, error } = require('../utils/response');

// 上传临时目录
const uploadDir = path.join(__dirname, '../../uploads/temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 JPG、PNG、WebP、BMP 格式'));
    }
  }
});

// GET /api/v1/images - 管理端列表（支持 coach_id、show_on_home 筛选）
router.get('/', async (req, res, next) => {
  try {
    const result = await imageService.getList(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/images - 上传图片
router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json(error('请选择图片'));
    }
    const image = await imageService.create(req.file, req.body);
    res.json(success(image));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/images/:id - 编辑图片
router.put('/:id', async (req, res, next) => {
  try {
    const image = await imageService.update(req.params.id, req.body);
    if (!image) return res.status(404).json(error('图片不存在'));
    res.json(success(image));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/images/:id - 删除图片
router.delete('/:id', async (req, res, next) => {
  try {
    await imageService.remove(req.params.id);
    res.json(success(null, '删除成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;