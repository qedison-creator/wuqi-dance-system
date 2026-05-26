const router = require('express').Router();
const auth = require('../middleware/auth');
const { checkModulePermission } = require('../middleware/permission');
const holidayService = require('../services/holiday.service');
const { success } = require('../utils/response');

// GET /api/v1/holidays - 获取放假列表
router.get('/', async (req, res, next) => {
  try {
    const result = await holidayService.getHolidays(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/holidays - 新增放假
router.post('/', auth, checkModulePermission('holiday'), async (req, res, next) => {
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
router.put('/:id', auth, checkModulePermission('holiday'), async (req, res, next) => {
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
router.put('/:id/cancel', auth, checkModulePermission('holiday'), async (req, res, next) => {
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
router.delete('/:id', auth, checkModulePermission('holiday'), async (req, res, next) => {
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
