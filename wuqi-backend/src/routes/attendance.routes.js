const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const attendanceService = require('../services/attendance.service');
const { success, paginate, error } = require('../utils/response');
const { assertMemberAccessibleForCheckin } = require('../utils/storeOwnership');

router.get('/schedule/:schedule_id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const records = await attendanceService.getAttendanceBySchedule(req.params.schedule_id);
    res.json(success(records));
  } catch (err) {
    next(err);
  }
});

router.get('/my', auth, checkPermission(['member']), async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = await attendanceService.getMyAttendance(req.user.id, page, pageSize);
    res.json(success(paginate(result.list, result.total, result.page, result.pageSize)));
  } catch (err) {
    next(err);
  }
});

router.get('/checkin-profile/:user_id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const access = await assertMemberAccessibleForCheckin(req.params.user_id, req.user);
    if (!access.ok) {
      return res.status(403).json(error(403, access.reason));
    }
    const profile = await attendanceService.getMemberCheckinProfile(req.params.user_id);
    res.json(success(profile));
  } catch (err) {
    next(err);
  }
});

router.get('/check-in-status/:user_id', async (req, res, next) => {
  try {
    const status = await attendanceService.getCheckInStatus(req.params.user_id);
    res.json(success(status));
  } catch (err) {
    next(err);
  }
});

// 管理端：按会员ID获取上课记录
router.get('/member/:user_id', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const access = await assertMemberAccessibleForCheckin(req.params.user_id, req.user);
    if (!access.ok) {
      return res.status(403).json(error(403, access.reason));
    }
    const result = await attendanceService.getAttendanceByUser(req.params.user_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

router.get('/export', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const records = await attendanceService.exportAttendance(req.query);
    res.json(success(records));
  } catch (err) {
    next(err);
  }
});

module.exports = router;