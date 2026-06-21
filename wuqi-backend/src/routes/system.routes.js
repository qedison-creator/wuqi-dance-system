const router = require('express').Router();
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { success } = require('../utils/response');
const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');
const Coach = require('../models/Coach');
const DanceStyle = require('../models/DanceStyle');
const User = require('../models/User');
const UserPackage = require('../models/UserPackage');
const Waitlist = require('../models/Waitlist');
const OperationLog = require('../models/OperationLog');
const CoachSalary = require('../models/CoachSalary');
const ExemptionLog = require('../models/ExemptionLog');
const SystemConfig = require('../models/SystemConfig');

router.get('/stats', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const stats = {
      schedules: await Schedule.countDocuments(),
      bookings: await Booking.countDocuments(),
      coaches: await Coach.countDocuments(),
      danceStyles: await DanceStyle.countDocuments(),
      members: await User.countDocuments({ user_type: 'member' }),
      userPackages: await UserPackage.countDocuments(),
      waitlists: await Waitlist.countDocuments(),
      operationLogs: await OperationLog.countDocuments(),
    };
    res.json(success(stats));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/schedules', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await Schedule.countDocuments();
    await Schedule.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化课程数据，删除${count}条排课记录`,
    });
    res.json(success({ deleted: count }, '课程数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/bookings', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await Booking.countDocuments();
    await Booking.deleteMany({});
    await Waitlist.deleteMany({});
    await Schedule.updateMany({}, { $set: { current_bookings: 0, status: 'available' } });
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化预约数据，删除${count}条预约记录及候补`,
    });
    res.json(success({ deleted: count }, '预约数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/attendance', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    // 同步重置所有签到相关字段（status/checked_in/check_in_time/checked_in_by）
    const result = await Booking.updateMany(
      { $or: [{ status: 'completed' }, { checked_in: true }] },
      {
        $set: {
          status: 'booked',
          checked_in: false,
          check_in_time: null,
          checked_in_by: null,
        },
      }
    );
    // 同步清空 Attendance 集合
    const Attendance = require('../models/Attendance');
    const attResult = await Attendance.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化上课记录，重置${result.modifiedCount}条签到状态，删除${attResult.deletedCount}条签到记录`,
    });
    res.json(success({ modified: result.modifiedCount, attendance_deleted: attResult.deletedCount }, '上课记录已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/coaches', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await Coach.countDocuments();
    await Coach.deleteMany({});
    await CoachSalary.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化教练数据，删除${count}条教练记录及薪资`,
    });
    res.json(success({ deleted: count }, '教练数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/dance-styles', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await DanceStyle.countDocuments();
    await DanceStyle.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化舞种数据，删除${count}条舞种记录`,
    });
    res.json(success({ deleted: count }, '舞种数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/members', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await User.countDocuments({ user_type: 'member' });
    await User.deleteMany({ user_type: 'member' });
    await UserPackage.deleteMany({});
    await Booking.deleteMany({});
    await Waitlist.deleteMany({});
    await ExemptionLog.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化会员数据，删除${count}条会员记录及关联数据`,
    });
    res.json(success({ deleted: count }, '会员数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/packages', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await UserPackage.countDocuments();
    await UserPackage.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化套餐数据，删除${count}条套餐记录`,
    });
    res.json(success({ deleted: count }, '套餐数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/waitlists', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await Waitlist.countDocuments();
    await Waitlist.deleteMany({});
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'reset',
      module: 'system',
      detail: `初始化候补数据，删除${count}条候补记录`,
    });
    res.json(success({ deleted: count }, '候补数据已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/logs', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const count = await OperationLog.countDocuments();
    await OperationLog.deleteMany({});
    res.json(success({ deleted: count }, '操作日志已初始化'));
  } catch (err) {
    next(err);
  }
});

router.post('/reset/all', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const results = {};
    results.schedules = await Schedule.countDocuments();
    results.bookings = await Booking.countDocuments();
    results.coaches = await Coach.countDocuments();
    results.danceStyles = await DanceStyle.countDocuments();
    results.members = await User.countDocuments({ user_type: 'member' });
    results.userPackages = await UserPackage.countDocuments();
    results.waitlists = await Waitlist.countDocuments();
    results.operationLogs = await OperationLog.countDocuments();
    results.coachSalaries = await CoachSalary.countDocuments();
    results.exemptionLogs = await ExemptionLog.countDocuments();

    await Schedule.deleteMany({});
    await Booking.deleteMany({});
    await Coach.deleteMany({});
    await DanceStyle.deleteMany({});
    await User.deleteMany({ user_type: 'member' });
    await UserPackage.deleteMany({});
    await Waitlist.deleteMany({});
    await OperationLog.deleteMany({});
    await CoachSalary.deleteMany({});
    await ExemptionLog.deleteMany({});

    res.json(success(results, '所有业务数据已初始化'));
  } catch (err) {
    next(err);
  }
});

// ==================== 系统配置 ====================

// 获取配置
router.get('/configs', auth, async (req, res, next) => {
  try {
    const configs = await SystemConfig.find({});
    const configMap = {};
    configs.forEach(cfg => {
      configMap[cfg.key] = cfg.value;
    });
    res.json(success(configMap));
  } catch (err) {
    next(err);
  }
});

// 更新配置
router.put('/configs', auth, checkPermission(['super_admin']), async (req, res, next) => {
  try {
    const { key, value, description, group } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ code: 400, message: '参数不完整', data: null });
    }
    const updated = await SystemConfig.findOneAndUpdate(
      { key },
      { value, description: description || '', group: group || 'general' },
      { returnDocument: 'after', upsert: true }
    );
    await OperationLog.create({
      operator_id: req.user.id,
      action: 'update',
      module: 'system_config',
      detail: `更新系统配置 ${key}`,
    });
    res.json(success(updated, '配置已更新'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
