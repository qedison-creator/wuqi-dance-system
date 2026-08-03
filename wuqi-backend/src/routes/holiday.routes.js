const router = require('express').Router();
const auth = require('../middleware/auth');
const { optionalAuth } = auth;
const { checkModulePermission } = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const checkRecordOwnership = require('../middleware/checkRecordOwnership');
const Holiday = require('../models/Holiday');
const holidayService = require('../services/holiday.service');
const { success } = require('../utils/response');

// 放假记录归属校验中间件实例
const checkHolidayOwnership = checkRecordOwnership(Holiday, {
  recordName: '放假记录',
});

// GET /api/v1/holidays - 获取放假列表
// 使用 optionalAuth：会员端首页在 token 失效竞态（如重新编译后数分钟无操作）时，
// 其他并发请求的 401 会清除 token，导致延迟发起的 /holidays 请求无 token 可带。
// 放假信息是公开数据，无 token 时仍应返回（仅全门店放假），有 token 时按门店过滤。
// storeFilter 对未认证用户自动跳过，对已认证管理员按角色注入门店过滤。
router.get('/', optionalAuth, storeFilter(), async (req, res, next) => {
  try {
    const result = await holidayService.getHolidays(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/holidays - 新增放假
router.post('/', auth, checkModulePermission('holiday'), storeFilter(), async (req, res, next) => {
  try {
    const operatorId = req.user.id;
    const operatorName = req.user.username || req.user.nick_name || '管理员';
    const result = await holidayService.createHoliday(req.body, operatorId, operatorName);
    res.json(success(result, '添加放假成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/holidays/:id - 编辑放假
router.put('/:id', auth, checkModulePermission('holiday'), storeFilter(), checkHolidayOwnership, async (req, res, next) => {
  try {
    const operatorId = req.user.id;
    const operatorName = req.user.username || req.user.nick_name || '管理员';
    const result = await holidayService.updateHoliday(req.params.id, req.body, operatorId, operatorName);
    res.json(success(result, '编辑放假成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/holidays/:id/cancel - 撤销放假
router.put('/:id/cancel', auth, checkModulePermission('holiday'), storeFilter(), checkHolidayOwnership, async (req, res, next) => {
  try {
    const operatorId = req.user.id;
    const operatorName = req.user.username || req.user.nick_name || '管理员';
    const result = await holidayService.cancelHoliday(req.params.id, operatorId, operatorName);
    res.json(success(result, '撤销放假成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/holidays/:id - 删除放假
router.delete('/:id', auth, checkModulePermission('holiday'), storeFilter(), checkHolidayOwnership, async (req, res, next) => {
  try {
    const operatorId = req.user.id;
    const operatorName = req.user.username || req.user.nick_name || '管理员';
    const result = await holidayService.deleteHoliday(req.params.id, operatorId, operatorName);
    res.json(success(result, '删除放假成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
