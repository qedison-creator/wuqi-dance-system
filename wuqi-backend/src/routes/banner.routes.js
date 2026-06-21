const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const Banner = require('../models/Banner');
const { success, paginate } = require('../utils/response');

// GET /api/v1/banners - 获取轮播图列表(公开)
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const list = await Banner.find(filter)
      .sort({ sort_order: 1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));

    const total = await Banner.countDocuments(filter);
    
    // 处理图片 URL，确保返回完整路径
    const protocol = req.protocol;
    const host = req.get('host');
    const processedList = list.map(banner => {
      const bannerObj = banner.toObject();
      if (bannerObj.image_url && !bannerObj.image_url.startsWith('http')) {
        bannerObj.image_url = `${protocol}://${host}${bannerObj.image_url}`;
      }
      return bannerObj;
    });
    
    res.json(success(paginate(processedList, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/banners - 新增轮播图
router.post('/', auth, checkModulePermission('banner'), async (req, res, next) => {
  try {
    const banner = await Banner.create(req.body);
    res.json(success(banner, '创建轮播图成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/banners/:id - 编辑轮播图
router.put('/:id', auth, checkModulePermission('banner'), async (req, res, next) => {
  try {
    const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    res.json(success(banner, '编辑轮播图成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/banners/:id/status - 启用/禁用轮播图
router.put('/:id/status', auth, checkModulePermission('banner'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const banner = await Banner.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' });
    res.json(success(banner, status === 'active' ? '启用成功' : '禁用成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/banners/:id - 删除轮播图
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ code: 404, message: '轮播图不存在', data: null });
    }
    if (banner.image_url) {
      const filePath = path.join(__dirname, '../../uploads', path.basename(banner.image_url));
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('删除轮播图文件失败:', err.message);
        }
      });
    }
    await Banner.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除轮播图成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
