const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const packageService = require('../services/package.service');
const { success, paginate } = require('../utils/response');

// ========== 具体命名路由（必须在 /:id 参数化路由之前） ==========

// GET /api/v1/packages/my - 获取我的套餐(official_member)
router.get('/my', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const result = await packageService.getMyPackage(req.user.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/packages/ - 获取套餐模板列表(admin/staff)
router.get('/', auth, checkPermission(['admin', 'staff', 'super_admin', 'store_manager']), storeFilter(), async (req, res, next) => {
  try {
    const result = await packageService.getPackageList(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/packages - 录入套餐/创建套餐模板(admin/staff)
router.post('/', auth, checkPermission(['admin', 'staff', 'super_admin', 'store_manager']), storeFilter(), async (req, res, next) => {
  try {
    const { user_id } = req.body;
    let result;
    if (user_id) {
      result = await packageService.createPackage(req.body, req.user.id);
    } else {
      result = await packageService.createPackageTemplate(req.body);
    }
    res.json(success(result, '创建套餐成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/packages/activate - 激活用户下一个pending套餐(member)
router.put('/activate', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const result = await packageService.activateNextPackage(req.user.id);
    res.json(success(result, '套餐激活成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/packages/user/:id - 删除用户套餐(super_admin/store_manager/staff)
router.delete('/user/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await packageService.deleteUserPackage(req.params.id, req.user.id);
    res.json(success(result, '删除套餐成功'));
  } catch (err) {
    next(err);
  }
});

// ========== 套餐激活记录相关路由 ==========

// GET /api/v1/packages/activation-records - 获取套餐激活记录
router.get('/activation-records', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await packageService.getActivationRecords(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// ========== 套餐延长记录相关路由 ==========

// GET /api/v1/packages/extension-records - 获取套餐延长记录
router.get('/extension-records', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await packageService.getExtensionRecords(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/packages/:id/extend - 延长套餐有效期
router.put('/:id/extend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { extend_days, reason } = req.body;
    if (!extend_days || extend_days <= 0) {
      return res.status(400).json({ code: 400, message: '延长天数必须大于0', data: null });
    }
    const pkg = await packageService.extendPackage(req.params.id, extend_days, req.user.id, req.user.nick_name || req.user.username, { reason });
    res.json(success(pkg, '延长套餐成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/packages/extension-records/:id/revoke - 撤销套餐延长
router.put('/extension-records/:id/revoke', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const pkg = await packageService.revokePackageExtension(req.params.id, req.user.id, req.user.nick_name || req.user.username, reason);
    res.json(success(pkg, '撤销延长成功'));
  } catch (err) {
    next(err);
  }
});

// ========== 会员套餐状态相关路由 ==========

// GET /api/v1/packages/member-status/:user_id - 获取会员套餐状态
router.get('/member-status/:user_id', auth, checkPermission(['super_admin', 'store_manager', 'staff', 'member']), async (req, res, next) => {
  try {
    let userId = req.params.user_id;
    if (req.user.member_status && req.user._id.toString() !== userId && !['super_admin', 'store_manager', 'staff'].includes(req.user.role)) {
      userId = req.user._id;
    }
    const status = await packageService.getMemberPackageStatus(userId);
    res.json(success(status));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/packages/refresh-status - 刷新会员套餐状态
router.put('/refresh-status', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ code: 400, message: '缺少user_id参数', data: null });
    }
    const status = await packageService.refreshPackageStatus(user_id);
    res.json(success(status, '刷新套餐状态成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/packages/backfill-activations - 补录缺失的激活记录
router.post('/backfill-activations', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const result = await packageService.backfillActivationRecords();
    res.json(success(result, `补录完成: 新增${result.created}条, 跳过${result.skipped}条`));
  } catch (err) {
    next(err);
  }
});

// ========== 兼容旧路径的路由 ==========

// GET /api/v1/packages/package-activations - 获取套餐激活记录（兼容旧路径）
router.get('/package-activations', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const query = {
      ...req.query,
      store_id: req.query.store_id
    };
    const result = await packageService.getActivationRecords(query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/packages/package-extensions - 获取套餐延长记录（兼容旧路径）
router.get('/package-extensions', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const query = {
      ...req.query,
      store_id: req.query.store_id
    };
    const result = await packageService.getExtensionRecords(query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// ========== 参数化路由（必须放在最后，避免拦截具体命名路由） ==========

// GET /api/v1/packages/:id - 获取套餐模板详情(admin/staff)
router.get('/:id', auth, checkPermission(['admin', 'staff', 'super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const pkg = await packageService.getPackageById(req.params.id);
    res.json(success(pkg));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/packages/:id - 编辑套餐(admin/staff)
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const pkg = await packageService.updatePackage(req.params.id, req.body);
    res.json(success(pkg, '更新套餐成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/packages/:id - 删除套餐模板(super_admin)
router.delete('/:id', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const result = await packageService.deletePackage(req.params.id);
    res.json(success(result, '删除套餐成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
