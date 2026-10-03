/**
 * 数据中心路由（v7 看板版）
 * 权限：汇总接口（总览/趋势/热门课程/热门教练）三类角色可见；
 *       会员维度接口（会员排行/提醒/课时账单）审核员 403（与全局脱敏双保险）；
 *       门店隔离走 storeFilter。
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const storeFilter = require('../middleware/storeFilter');
const checkPermission = require('../middleware/permission');
const { success, error } = require('../utils/response');
const datacenterService = require('../services/datacenter.service');

// 门店取值：storeFilter 中间件已校验归属合法性，这里只负责取值
const getStoreId = (req) => (req.query && req.query.store_id) || (req.body && req.body.store_id) || null;

// 明细类接口：审核员一律 403
const noReviewer = (req, res, next) => {
  if (req.user && req.user.role === 'reviewer') {
    return res.status(403).json(error(403, '审核员仅可查看汇总数据'));
  }
  next();
};

// ---- 汇总 ----
router.get('/overview', auth, checkPermission(['super_admin', 'store_manager', 'staff', 'reviewer']), storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getOverview({
      storeId: getStoreId(req), period: req.query.period, startDate: req.query.start_date, endDate: req.query.end_date,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.get('/trend', auth, checkPermission(['super_admin', 'store_manager', 'staff', 'reviewer']), storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getTrend({
      storeId: getStoreId(req), period: req.query.period, startDate: req.query.start_date, endDate: req.query.end_date,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.get('/hot-courses', auth, checkPermission(['super_admin', 'store_manager', 'staff', 'reviewer']), storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getHotCourses({
      storeId: getStoreId(req), period: req.query.period, startDate: req.query.start_date, endDate: req.query.end_date,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.get('/hot-coaches', auth, checkPermission(['super_admin', 'store_manager', 'staff', 'reviewer']), storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getHotCoaches({
      storeId: getStoreId(req), period: req.query.period, startDate: req.query.start_date, endDate: req.query.end_date,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

// ---- 会员维度（审核员禁用）----
router.get('/member-rank', auth, noReviewer, storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getMemberRank({
      storeId: getStoreId(req), period: req.query.period, startDate: req.query.start_date, endDate: req.query.end_date, role: req.user.role,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.get('/reminders', auth, noReviewer, storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getReminders({ storeId: getStoreId(req), role: req.user.role });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.post('/reminders/followup', auth, noReviewer, storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.markReminderDone({
      storeId: getStoreId(req), memberId: req.body.member_id, alertType: req.body.alert_type,
      periodKey: req.body.period_key, operator: { id: req.user.id, name: req.user.real_name || req.user.nick_name || '' },
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.delete('/reminders/followup', auth, noReviewer, async (req, res, next) => {
  try {
    const result = await datacenterService.undoReminderDone({
      memberId: req.query.member_id, alertType: req.query.alert_type, periodKey: req.query.period_key,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

router.get('/member-bill', auth, noReviewer, storeFilter(), async (req, res, next) => {
  try {
    const result = await datacenterService.getMemberBill({
      storeId: getStoreId(req), search: req.query.search, period: req.query.period,
      startDate: req.query.start_date, endDate: req.query.end_date, role: req.user.role,
    });
    res.json(success(result));
  } catch (err) { next(err); }
});

module.exports = router;
