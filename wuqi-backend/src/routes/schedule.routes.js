const router = require('express').Router();
const auth = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const scheduleService = require('../services/schedule.service');
const { broadcastCourseUpdate } = require('../services/websocket.service');
const { success, paginate } = require('../utils/response');

// GET /api/v1/schedules - 获取排课列表(会员可匿名浏览)
router.get('/', storeFilter(), async (req, res, next) => {
  try {
    const result = await scheduleService.getScheduleList(req.query, req);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/schedules/weekly/:storeId - 获取周课程表
router.get('/weekly/:storeId', auth, async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const { start_date, end_date } = req.query;
    const result = await scheduleService.getWeeklySchedule(storeId, start_date, end_date);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/schedules/copy-week - 复制周排课
router.post('/copy-week', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await scheduleService.copyScheduleWeeks(req.body, req.user.id);
    // 复制排课成功后广播课程更新
    if (result.created_count > 0) {
      broadcastCourseUpdate({ action: 'copy', count: result.created_count });
    }
    res.json(success(result, `复制排课成功，共创建${result.created_count}节课`));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/schedules/batch-delete - 批量删除排课
router.post('/batch-delete', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const result = await scheduleService.batchDeleteSchedules(req.body, req.user.id);
    res.json(success(result, `批量删除完成，共删除${result.deleted_count}节课`));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/schedules/batch-cancel - 批量取消排课
router.post('/batch-cancel', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const result = await scheduleService.batchCancelSchedules(req.body, req.user.id);
    res.json(success(result, `批量取消完成，共取消${result.cancelled_count}节课`));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/schedules/:id - 获取排课详情(游客可浏览)
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const schedule = await scheduleService.getScheduleById(req.params.id, req);
    res.json(success(schedule));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/schedules - 新增排课
router.post('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const schedule = await scheduleService.createSchedule(req.body, req.user.id);
    // 排课写入数据库成功后，通过 WebSocket 广播课程更新事件
    broadcastCourseUpdate({ action: 'create', scheduleId: schedule._id, storeId: schedule.store_id });
    res.json(success(schedule, '创建排课成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/schedules/batch-create - 批量创建排课
router.post('/batch-create', auth, checkPermission(['super_admin', 'store_manager']), async (req, res) => {
  try {
    const { schedules } = req.body;
    if (!schedules || !Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供排课数据数组' });
    }

    const result = await scheduleService.batchCreateSchedules(schedules, req.user.id);
    // 批量创建成功后广播课程更新
    if (result.created.length > 0) {
      broadcastCourseUpdate({ action: 'batch-create', count: result.created.length });
    }
    res.json({
      code: 200,
      data: {
        createdCount: result.created.length,
        skippedCount: result.skipped.length,
        created: result.created,
        skipped: result.skipped,
      },
      message: `成功创建${result.created.length}节排课${result.skipped.length > 0 ? `，${result.skipped.length}节跳过` : ''}`,
    });
  } catch (err) {
    console.error('批量创建排课失败:', err);
    res.status(500).json({ code: 500, message: '批量创建排课失败', error: err.message });
  }
});

// PUT /api/v1/schedules/:id - 编辑排课
router.put('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const schedule = await scheduleService.updateSchedule(req.params.id, req.body, req.user.id);
    res.json(success(schedule, '编辑排课成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/schedules/:id/cancel - 取消排课
router.put('/:id/cancel', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const schedule = await scheduleService.cancelSchedule(req.params.id, req.user.id, reason);
    res.json(success(schedule, '取消排课成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/schedules/:id/offline - 下架排课
router.put('/:id/offline', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const schedule = await scheduleService.offlineSchedule(req.params.id, reason, req.user.id);
    res.json(success(schedule, '下架排课成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/schedules/:id - 删除排课
router.delete('/:id', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const result = await scheduleService.deleteSchedule(req.params.id, req.user.id);
    res.json(success(result, '删除排课成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/schedules/:id/bookings - 获取预约名单
router.get('/:id/bookings', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const bookings = await scheduleService.getScheduleBookings(req.params.id);
    res.json(success(bookings));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/schedules/:id/check-in - 标记上课
router.put('/:id/check-in', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { user_ids } = req.body;
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要签到的用户ID列表', data: null });
    }
    const updates = await scheduleService.markAttendance(req.params.id, user_ids, req.user.id);
    res.json(success(updates, `签到成功，共${updates.length}人`));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
