const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const statsService = require('../services/stats.service');
const { success } = require('../utils/response');

// GET /api/v1/stats/overview - 数据概览
router.get('/overview', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getOverview(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/booking-trend - 预约趋势
router.get('/booking-trend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { store_id, period, start_date, end_date } = req.query;
    const result = await statsService.getBookingTrend(store_id, period, start_date, end_date);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/course-ranking - 课程排行
router.get('/course-ranking', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { store_id, period, limit } = req.query;
    const result = await statsService.getCourseRanking(store_id, period, limit);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/bookings - 预约统计
router.get('/bookings', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const result = await statsService.getBookingStats(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/members - 会员统计
router.get('/members', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getMemberStats(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/revenue - 营收统计
router.get('/revenue', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const result = await statsService.getRevenueStats(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/coaches - 教练统计
router.get('/coaches', auth, checkPermission(['super_admin', 'store_manager']), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getCoachStats(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/dashboard - 数据看板
router.get('/dashboard', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getDashboardData(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
