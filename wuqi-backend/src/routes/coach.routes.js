const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkModulePermission } = require('../middleware/permission');
const coachService = require('../services/coach.service');
const { success, paginate } = require('../utils/response');

// GET /api/v1/coaches/admin - 管理端获取教练列表（必须在 /:id 之前，避免路由冲突）
router.get('/admin', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const result = await coachService.getCoachList({ ...req.query, include_disabled: true });
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coaches - 获取教练列表
router.get('/', async (req, res, next) => {
  try {
    const result = await coachService.getCoachList(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/coaches/:id - 获取教练详情
router.get('/:id', async (req, res, next) => {
  try {
    const coach = await coachService.getCoachById(req.params.id);
    if (!coach) {
      return res.status(404).json({ code: 404, message: '教练不存在' });
    }
    res.json(success(coach));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coaches - 新增教练
router.post('/', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const coach = await coachService.createCoach(req.body);
    res.json(success(coach, '创建教练成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coaches/:id - 编辑教练
router.put('/:id', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const coach = await coachService.updateCoach(req.params.id, req.body);
    res.json(success(coach, '编辑教练成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coaches/:id/status - 启用/禁用教练
router.put('/:id/status', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const coach = await coachService.toggleCoachStatus(req.params.id, status);
    res.json(success(coach, status === 'active' ? '启用成功' : '禁用成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coaches/:id - 删除教练
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    await coachService.deleteCoach(req.params.id);
    res.json(success(null, '删除教练成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/coaches/:id/avatar - 更新教练头像
router.put('/:id/avatar', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const { avatar_url } = req.body;
    const coach = await coachService.updateCoach(req.params.id, { avatar_url });
    res.json(success(coach, '头像更新成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/coaches/:id/gallery - 添加相册照片
router.post('/:id/gallery', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ code: 400, message: '请提供图片地址' });
    const coach = await coachService.addGalleryPhoto(req.params.id, url);
    res.json(success(coach, '添加照片成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coaches/:id/gallery - 按URL删除相册照片（前端调用方式）
router.delete('/:id/gallery', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ code: 400, message: '请提供图片地址' });
    const coach = await coachService.removeGalleryPhotoByUrl(req.params.id, url);
    res.json(success(coach, '删除照片成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/coaches/:id/gallery/:index - 按索引删除相册照片（保留兼容）
router.delete('/:id/gallery/:index', auth, checkModulePermission('coach'), async (req, res, next) => {
  try {
    const index = parseInt(req.params.index);
    const coach = await coachService.removeGalleryPhoto(req.params.id, index);
    res.json(success(coach, '删除照片成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
