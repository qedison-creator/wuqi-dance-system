const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const Video = require('../models/Video');
const { success, paginate } = require('../utils/response');

// ========== 具体命名路由（必须在 /:id 参数化路由之前） ==========

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, dance_style_id, coach_id } = req.query;
    const filter = { status: 'active', is_free: true };

    if (dance_style_id) filter.dance_style_id = dance_style_id;
    if (coach_id) filter.coach_id = coach_id;

    const list = await Video.find(filter)
      .populate('dance_style_id', 'name')
      .populate('coach_id', 'name avatar_url')
      .sort({ sort_order: 1, created_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));

    const total = await Video.countDocuments(filter);
    res.json(success(paginate(list, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

router.get('/admin', auth, checkModulePermission('video'), async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const list = await Video.find()
      .populate('dance_style_id', 'name')
      .populate('coach_id', 'name avatar_url')
      .sort({ sort_order: 1, created_at: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize));

    const total = await Video.countDocuments();
    res.json(success(paginate(list, total, page, pageSize)));
  } catch (err) {
    next(err);
  }
});

router.post('/', auth, checkModulePermission('video'), async (req, res, next) => {
  try {
    const video = await Video.create(req.body);
    res.json(success(video, '创建视频成功'));
  } catch (err) {
    next(err);
  }
});

router.put('/sort', auth, checkModulePermission('video'), async (req, res, next) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ code: 400, message: 'orders必须是数组', data: null });
    }
    await Promise.all(orders.map(({ id, sort_order }) =>
      Video.findByIdAndUpdate(id, { sort_order })
    ));
    res.json(success(null, '排序更新成功'));
  } catch (err) {
    next(err);
  }
});

// ========== 参数化路由（必须放在最后，避免拦截具体命名路由） ==========

router.put('/:id', auth, checkModulePermission('video'), async (req, res, next) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(success(video, '编辑视频成功'));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', auth, checkModulePermission('video'), async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ code: 404, message: '视频不存在', data: null });
    }
    const filesToDelete = [];
    if (video.video_url) filesToDelete.push(video.video_url);
    if (video.cover_url) filesToDelete.push(video.cover_url);
    for (const fileUrl of filesToDelete) {
      const filePath = path.join(__dirname, '../../uploads', path.basename(fileUrl));
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('删除视频文件失败:', fileUrl, err.message);
        }
      });
    }
    await Video.findByIdAndDelete(req.params.id);
    res.json(success(null, '删除视频成功'));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/status', auth, checkModulePermission('video'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const video = await Video.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json(success(video, status === 'active' ? '启用成功' : '禁用成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
