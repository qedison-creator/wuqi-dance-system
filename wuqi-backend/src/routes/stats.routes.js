const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const storeFilter = require('../middleware/storeFilter');
const statsService = require('../services/stats.service');
const { success } = require('../utils/response');

// GET /api/v1/stats/overview - 数据概览
router.get('/overview', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getOverview(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/booking-trend - 预约趋势
router.get('/booking-trend', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id, period, start_date, end_date } = req.query;
    const result = await statsService.getBookingTrend(store_id, period, start_date, end_date);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/course-ranking - 课程排行
router.get('/course-ranking', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id, period, limit } = req.query;
    const result = await statsService.getCourseRanking(store_id, period, limit);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/bookings - 预约统计
router.get('/bookings', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const result = await statsService.getBookingStats(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/members - 会员统计
router.get('/members', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getMemberStats(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/revenue - 营收统计
router.get('/revenue', auth, checkPermission(['super_admin', 'store_manager']), storeFilter(), async (req, res, next) => {
  try {
    const result = await statsService.getRevenueStats(req.query);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/dashboard - 数据看板
router.get('/dashboard', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getDashboardData(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/package-status - 会员套餐状态管理页：四类会员名单（时间卡到期/次卡到期/次卡次数不足/久未到店）
router.get('/package-status', auth, checkPermission(['super_admin', 'store_manager', 'staff']), storeFilter(), async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const result = await statsService.getPackageStatusList(store_id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/stats/package-status-config - 读取套餐状态提醒阈值配置
router.get('/package-status-config', auth, checkPermission(['super_admin', 'store_manager', 'staff']), async (req, res, next) => {
  try {
    const config = await statsService.getPackageStatusRemindConfig();
    res.json(success(config));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/stats/package-status-config - 保存套餐状态提醒阈值配置（仅超级管理员）
router.put('/package-status-config', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ code: 403, message: '仅超级管理员可修改提醒阈值设置', data: null });
    }
    const Config = require('../models/Config');
    const { time_card_expire, count_card_expire, count_card_low, inactive_days } = req.body || {};

    // 字段校验：days/count/percent 需为 0-100 的整数
    const validNum = (v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && n >= 0 && n <= 100 ? n : null;
    };
    const buildSection = (obj, fields) => {
      const out = {};
      fields.forEach(f => {
        const n = validNum(obj && obj[f]);
        if (n === null) throw new Error(`参数不合法：${f} 需为 0-100 的整数`);
        out[f] = n;
      });
      return out;
    };
    const value = {
      time_card_expire: buildSection(time_card_expire, ['days', 'percent']),
      count_card_expire: buildSection(count_card_expire, ['days', 'percent']),
      count_card_low: buildSection(count_card_low, ['count', 'percent']),
      inactive_days: buildSection(inactive_days, ['days']),
    };

    // 提醒方式二选一校验（mode）：三类各自只允许两种取值之一
    const MODE_ENUM = {
      time_card_expire: ['days', 'percent'],
      count_card_expire: ['days', 'percent'],
      count_card_low: ['count', 'percent'],
    };
    Object.keys(MODE_ENUM).forEach(k => {
      const section = req.body[k] || {};
      if (MODE_ENUM[k].indexOf(section.mode) < 0) {
        throw new Error(`参数不合法：${k}.mode 需为 ${MODE_ENUM[k].join(' 或 ')}`);
      }
      value[k].mode = section.mode;
    });

    await Config.findOneAndUpdate(
      { key: 'package_status_remind_config' },
      { $set: { value, description: '会员套餐状态提醒阈值（首页待办同源）', category: 'stats' } },
      { upsert: true, new: true }
    );
    res.json(success(value, '保存成功'));
  } catch (err) {
    if (err.message && err.message.startsWith('参数不合法')) {
      return res.status(400).json({ code: 400, message: err.message, data: null });
    }
    next(err);
  }
});

module.exports = router;
