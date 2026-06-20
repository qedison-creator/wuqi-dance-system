const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const bookingService = require('../services/booking.service');
const coachSalaryService = require('../services/coach-salary.service');
const { success, paginate } = require('../utils/response');

// ========== 具体命名路由（必须在 /:id 参数化路由之前） ==========

// POST /api/v1/bookings - 创建预约(member)
router.post('/', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { schedule_id } = req.body;
    if (!schedule_id) {
      return res.status(400).json({ code: 400, message: '缺少schedule_id参数', data: null });
    }
    const booking = await bookingService.createBooking(req.user.id, schedule_id);
    res.json(success(booking, '预约成功'));
  } catch (err) {
    // 捕获时间卡限额已满、有待激活次卡的特殊情况
    if (err.code === 'TIME_CARD_LIMIT_REACHED') {
      // 清理错误消息中的 TIME_CARD_LIMIT_REACHED: 前缀，保留纯文本
      const cleanMessage = err.message.replace(/^TIME_CARD_LIMIT_REACHED:\s*/, '');
      return res.status(200).json({
        code: 'TIME_CARD_LIMIT_REACHED',
        message: cleanMessage,
        data: err.data || null
      });
    }
    next(err);
  }
});

// PUT /api/v1/bookings/:id/cancel - 取消预约(member)
router.put('/:id/cancel', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const booking = await bookingService.cancelBooking(req.user.id, req.params.id);
    res.json(success(booking, '取消预约成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/my - 获取我的预约记录(member)
router.get('/my', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { type, page = 1, pageSize = 20, store_id } = req.query;
    const result = await bookingService.getMyBookings(req.user.id, type, page, pageSize, store_id);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/my-attendance - 获取我的出勤记录(member)
router.get('/my-attendance', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = await bookingService.getMyAttendance(req.user.id, page, pageSize);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings - 管理端获取预约记录
router.get('/', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await bookingService.getBookingList(req.query);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookings/waitlist - 加入候补
router.post('/waitlist', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { schedule_id } = req.body;
    if (!schedule_id) {
      return res.status(400).json({ code: 400, message: '缺少schedule_id参数', data: null });
    }
    const waitlist = await bookingService.joinWaitlist(req.user.id, schedule_id);
    res.json(success(waitlist, '加入候补成功'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/waitlist/my - 获取我的候补列表
router.get('/waitlist/my', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const list = await bookingService.getMyWaitlist(req.user.id);
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/waitlist/summary - 获取候补汇总（管理端）
router.get('/waitlist/summary', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const storeId = req.query.store_id || null;
    const result = await bookingService.getWaitlistSummary(storeId);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/bookings/waitlist/confirm/:id - 候补确认预约
router.put('/waitlist/confirm/:id', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const result = await bookingService.confirmWaitlistBooking(req.user.id, req.params.id);
    res.json(success(result, '候补确认预约成功'));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/bookings/waitlist/:id/promote - 候补转正（管理端）
router.put('/waitlist/:id/promote', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await bookingService.promoteWaitlist(req.params.id, req.user.id);
    res.json(success(result, '候补转正成功'));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/bookings/waitlist/:id - 取消候补(member)
router.delete('/waitlist/:id', auth, checkPermission(['member', 'super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    if (['super_admin', 'store_manager', 'staff'].includes(req.user.role)) {
      const result = await bookingService.adminRemoveWaitlist(req.params.id, req.user.id);
      res.json(success(result, '删除候补成功'));
    } else {
      const waitlist = await bookingService.cancelWaitlist(req.user.id, req.params.id);
      res.json(success(waitlist, '取消候补成功'));
    }
  } catch (err) {
    next(err);
  }
});

// 签到相关路由

const { verifyToken } = require('../utils/crypto');
const attendanceService = require('../services/attendance.service');

// POST /api/v1/bookings/check-in - 扫码签到（支持正常签到 + 现场临时签到 + 批量）
router.post('/check-in', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { schedule_ids, schedule_id, user_id, encrypted_token, onsite } = req.body;

    let userId = user_id;

    if (encrypted_token) {
      const result = verifyToken(encrypted_token);
      if (!result.valid) {
        return res.status(401).json({ code: 401, message: result.error || '无效的签到码', data: null });
      }
      const rawMemberCode = result.memberCode;
      userId = rawMemberCode.includes('|') ? rawMemberCode.split('|')[0] : rawMemberCode;
    }

    if (!userId) {
      return res.status(400).json({ code: 400, message: '缺少user_id参数', data: null });
    }

    const ids = schedule_ids || (schedule_id ? [schedule_id] : []);
    if (ids.length === 0) {
      return res.status(400).json({ code: 400, message: '缺少schedule_id参数', data: null });
    }

    const results = [];
    for (const sid of ids) {
      const booking = await bookingService.checkIn(sid, userId, req.user.id, !!onsite);
      results.push(booking);
    }

    res.json(success(results, '签到成功'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookings/batch-check-in - 批量签到
router.post('/batch-check-in', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { schedule_id, user_ids } = req.body;
    if (!schedule_id || !user_ids || !Array.isArray(user_ids)) {
      return res.status(400).json({ code: 400, message: '参数错误', data: null });
    }
    const results = await bookingService.batchCheckIn(schedule_id, user_ids, req.user.id);
    res.json(success(results, '批量签到完成'));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/check-in-records/:schedule_id - 获取课程签到记录
router.get('/check-in-records/:schedule_id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const records = await bookingService.getCheckInRecords(req.params.schedule_id);
    res.json(success(records));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookings/check-low-attendance - 检查并取消低人数课程
router.post('/check-low-attendance', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { schedule_id } = req.body;
    const result = await bookingService.checkAndCancelLowAttendance(schedule_id, req.user.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookings/batch-check-low-attendance - 批量检查低人数课程
router.post('/batch-check-low-attendance', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { hours_before = 2 } = req.body;
    const results = await bookingService.batchCheckLowAttendance(hours_before);
    res.json(success(results, '批量检查完成'));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookings/auto-check-in/:schedule_id - 手动触发自动签到（管理端）
router.post('/auto-check-in/:schedule_id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await bookingService.autoCheckIn(req.params.schedule_id);
    res.json(success(result, `自动签到完成: 处理${result.processed}个预约, ${result.checked_in}个已签到`));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/export - 导出预约记录
router.get('/export', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id, start_date, end_date } = req.query;
    const data = await bookingService.exportBookings(store_id, start_date, end_date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=bookings_${Date.now()}.csv`);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/export/attendance - 导出上课记录
router.get('/export/attendance', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id, start_date, end_date } = req.query;
    const data = await bookingService.exportAttendance(store_id, start_date, end_date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${Date.now()}.csv`);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/check-in-status/:user_id - 会员端轮询签到状态
router.get('/check-in-status/:user_id', async (req, res, next) => {
  try {
    const status = await attendanceService.getCheckInStatus(req.params.user_id);
    res.json(success(status));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookings/onsite-check-in - 线下现场签到（无预约也可补签，即时扣课时）
router.post('/onsite-check-in', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { schedule_id, user_id, user_package_id } = req.body;
    if (!schedule_id || !user_id) {
      return res.status(400).json({ code: 400, message: '缺少 schedule_id 或 user_id 参数', data: null });
    }
    const result = await bookingService.onsiteCheckIn(schedule_id, user_id, req.user.id, user_package_id);
    res.json(success(result, '现场签到成功'));
  } catch (err) {
    next(err);
  }
});

// ========== 参数化路由（必须放在最后，避免拦截具体命名路由） ==========

// GET /api/v1/bookings/:schedule_id/waitlist - 管理端获取指定排课的候补名单
router.get('/:schedule_id/waitlist', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const list = await bookingService.getScheduleWaitlist(req.params.schedule_id);
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/bookings/:id - 获取预约详情
router.get('/:id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id);
    res.json(success(booking));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/bookings/:id/admin-cancel - 管理员手动取消
router.put('/:id/admin-cancel', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const booking = await bookingService.adminCancelBooking(req.params.id, reason, req.user.id);
    res.json(success(booking, '管理员取消预约成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
