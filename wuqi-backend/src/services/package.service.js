const Package = require('../models/Package');
const UserPackage = require('../models/UserPackage');
const PackageActivation = require('../models/PackageActivation');
const PackageExtension = require('../models/PackageExtension');
const Booking = require('../models/Booking');
const User = require('../models/User');
const logService = require('./log.service');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const BEIJING_TZ = 'Asia/Shanghai';

/**
 * 统一计算套餐起止时间：
 * - start 取开始日期当天的 00:00（北京时间）
 * - end = start + duration - 1 天，并取最后一天的 23:59:59.999（北京时间）
 * 这样无论激活/录入时间几点，服务有效期都按自然日显示，且最后一天全天有效。
 */
function calculateValidityDates(startMoment, durationValue, durationUnit) {
  const start = startMoment.tz(BEIJING_TZ).startOf('day');
  let end;
  if (durationUnit === 'month') {
    end = start.add(durationValue, 'month').subtract(1, 'day').endOf('day');
  } else if (durationUnit === 'year') {
    end = start.add(durationValue, 'year').subtract(1, 'day').endOf('day');
  } else {
    end = start.add(durationValue, 'day').subtract(1, 'day').endOf('day');
  }
  return { start_date: start.toDate(), end_date: end.toDate() };
}

exports.getMyPackage = async (userId) => {
  // 先刷新套餐状态（将已过期的 active 标记为 expired）
  await exports.refreshPackageStatus(userId);

  let packages = await UserPackage.find({ user_id: userId })
    .populate('store_id', 'name')
    .populate('extra_store_ids', 'name')
    .sort({ created_at: 1 });

  // 强制修正：已激活且过期的 active 套餐必须标记为 expired，避免前端/后端状态不同步
  const now = new Date();
  const toSave = [];
  packages = packages.map(pkg => {
    if (pkg.status === 'active' && pkg.is_activated && pkg.end_date && now > new Date(pkg.end_date)) {
      pkg.status = 'expired';
      toSave.push(pkg.save());
    }
    // 兜底：老会员预建档套餐可能未存 duration_value/duration_unit，由起止日期临时计算（仅展示用，不写库）
    if ((!pkg.duration_value || Number(pkg.duration_value) <= 0) && pkg.start_date && pkg.end_date) {
      try {
        const sD = new Date(pkg.start_date);
        const eD = new Date(pkg.end_date);
        if (!isNaN(sD.getTime()) && !isNaN(eD.getTime()) && eD > sD) {
          const totalDays = Math.round((eD - sD) / (1000 * 60 * 60 * 24));
          const months = Math.round(totalDays / 30.44);
          if (months >= 1) {
            pkg.duration_value = months;
            pkg.duration_unit = 'month';
          } else if (totalDays > 0) {
            pkg.duration_value = totalDays;
            pkg.duration_unit = 'day';
          }
        }
      } catch (e) {
        // 计算失败静默忽略，不影响主流程
      }
    }
    return pkg;
  });
  if (toSave.length > 0) {
    await Promise.all(toSave);
  }

  const activePackage = packages.find(p => p.status === 'active' && !p.is_suspended);
  const pendingPackages = packages.filter(p => p.status === 'pending');
  const suspendedPackages = packages.filter(p => p.status === 'active' && p.is_suspended);

  let timeCardUsage = null;
  if (activePackage && activePackage.package_type === 'time_card') {
    timeCardUsage = await calcTimeCardUsage(activePackage);
  }

  return {
    current: activePackage || null,
    pending: pendingPackages,
    suspended: suspendedPackages.length > 0 ? suspendedPackages : null,
    hasSuspended: suspendedPackages.length > 0,
    history: packages,
    timeCardUsage,
  };
};

async function calcTimeCardUsage(userPackage) {
  const now = dayjs().tz(BEIJING_TZ);
  const result = {
    weekly_used: null, weekly_limit: null, weekly_remaining: null,
    daily_used: null, daily_limit: null, daily_remaining: null,
    next_week_used: null, next_week_remaining: null,
    next_week_start: null, next_week_end: null,
  };

  if (userPackage.weekly_limit) {
    const weekStart = now.startOf('isoWeek');
    const weekEnd = now.endOf('isoWeek');
    const usedThisWeek = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: { $gte: weekStart.format('YYYY-MM-DD'), $lte: weekEnd.format('YYYY-MM-DD') },
      status: { $in: ['booked', 'completed'] },
    });
    result.weekly_used = usedThisWeek;
    result.weekly_limit = userPackage.weekly_limit;
    result.weekly_remaining = Math.max(0, userPackage.weekly_limit - usedThisWeek);

    const nextWeekStart = now.add(1, 'week').startOf('isoWeek');
    const nextWeekEnd = now.add(1, 'week').endOf('isoWeek');
    const usedNextWeek = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: { $gte: nextWeekStart.format('YYYY-MM-DD'), $lte: nextWeekEnd.format('YYYY-MM-DD') },
      status: { $in: ['booked', 'completed'] },
    });
    result.next_week_used = usedNextWeek;
    result.next_week_remaining = Math.max(0, userPackage.weekly_limit - usedNextWeek);
    result.next_week_start = nextWeekStart.format('YYYY-MM-DD');
    result.next_week_end = nextWeekEnd.format('YYYY-MM-DD');
  }

  if (userPackage.daily_limit) {
    const todayStr = now.format('YYYY-MM-DD');
    const usedToday = await Booking.countDocuments({
      user_id: userPackage.user_id,
      user_package_id: userPackage._id,
      booking_date: todayStr,
      status: { $in: ['booked', 'completed'] },
    });
    result.daily_used = usedToday;
    result.daily_limit = userPackage.daily_limit;
    result.daily_remaining = Math.max(0, userPackage.daily_limit - usedToday);
  }

  return result;
}

// 录入套餐(为用户分配套餐) — 不自动过期旧套餐，新套餐状态为pending
exports.createPackage = async (data, operatorId) => {
  const { user_id, package_id, store_id, extra_store_ids, package_type, total_credits, duration_value, duration_unit, daily_limit, weekly_limit, remark } = data;

  if (!user_id) throw new Error('用户ID不能为空');
  if (!package_type) throw new Error('套餐类型不能为空');

  const existingActive = await UserPackage.findOne({ user_id, status: 'active' });

  const autoActivateAt = new Date();
  autoActivateAt.setMonth(autoActivateAt.getMonth() + 2);

  const userPackage = await UserPackage.create({
    user_id,
    package_id: package_id || null,
    store_id: store_id || null,
    extra_store_ids: extra_store_ids || [],
    package_type,
    total_credits: total_credits || 0,
    remaining_credits: total_credits || 0,
    duration_value: duration_value || null,
    duration_unit: duration_unit || 'month',
    daily_limit: daily_limit || null,
    weekly_limit: weekly_limit || null,
    is_activated: false,
    activated_at: null,
    auto_activate_at: autoActivateAt,
    status: 'pending',
    remark: remark || '',
    created_by: operatorId,
  });

  // 记录操作日志
  const durationText = package_type === 'time_card'
    ? `${duration_value}${duration_unit === 'month' ? '个月' : '天'}`
    : `${total_credits}课时`;
  const existingNote = existingActive ? `（当前有使用中的套餐，新套餐待激活）` : '（首个套餐，待激活）';
  await logService.createLog({
    operator_id: operatorId,
    action: 'create',
    module: 'package',
    target_id: userPackage._id,
    detail: `为用户(${user_id})录入${package_type === 'count_card' ? '次卡' : '时间卡'}: ${durationText}${existingNote}, 2个月后自动激活`,
  });

  return userPackage;
};

// 激活指定套餐（按ID激活）
exports.activatePackageById = async (packageId, userId, options = {}) => {
  try {
    console.log('[Package] 开始激活套餐, packageId:', packageId, 'userId:', userId, 'options:', options);
    const pkg = await UserPackage.findById(packageId);
    if (!pkg) throw new Error('套餐不存在');
    if (pkg.status !== 'pending') throw new Error('该套餐状态不可激活');
    if (pkg.user_id.toString() !== userId.toString()) throw new Error('无权操作');

    const now = new Date();
    pkg.is_activated = true;
    pkg.activated_at = now;
    pkg.status = 'active';

    // 统一按北京时间自然日计算起止时间
    const startMoment = dayjs(now).tz(BEIJING_TZ);
    pkg.start_date = startMoment.startOf('day').toDate();
    if (pkg.duration_value) {
      const { end_date } = calculateValidityDates(startMoment, pkg.duration_value, pkg.duration_unit);
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    } else {
      const { end_date } = calculateValidityDates(startMoment, 1, 'year');
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    }

    await pkg.save();
    console.log('[Package] 套餐保存成功');

    try {
      await PackageActivation.create({
        user_package_id: pkg._id,
        user_id: userId,
        package_id: pkg.package_id || null,
        store_id: pkg.store_id || null,
        activation_type: options.activation_type || options.activationType || 'manual_force',
        booking_id: options.booking_id || null,
        activated_by: options.activated_by || userId,
        activated_at: now,
        remark: options.remark || '',
      });
    } catch (actErr) {
      console.error('[Package] 记录激活日志失败:', actErr.message);
    }

    try {
      await logService.createLog({
        operator_id: userId,
        action: 'activate',
        module: 'package',
        target_id: pkg._id,
        detail: `用户(${userId})套餐已激活, 有效期至: ${pkg.end_date.toISOString().split('T')[0]}`,
      });
    } catch (logErr) {
      console.error('[Package] 记录激活日志失败:', logErr.message);
    }

    try {
      const wechatMessageService = require('./wechat-message.service');
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (user && user.openid) {
        const packageName = pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`;
        const endDate = pkg.end_date ? dayjs(pkg.end_date).format('YYYY年MM月DD日') : '长期有效';
        await wechatMessageService.sendPackageActivated(user, packageName, endDate);
      }
    } catch (notifyErr) {
      console.error('[Package] 发送套餐激活通知失败:', notifyErr.message);
    }

    console.log('[Package] 套餐激活成功');
    return pkg;
  } catch (err) {
    console.error('[Package] 激活套餐失败:', err);
    console.error('[Package] 错误堆栈:', err.stack);
    throw err;
  }
};

// 激活用户的下一个pending套餐（按录入顺序）
exports.activateNextPackage = async (userId) => {
  const pkg = await UserPackage.findOne({
    user_id: userId,
    status: 'pending',
  }).sort({ created_at: 1 });

  if (!pkg) return null;
  return exports.activatePackageById(pkg._id, userId);
};

// 检查并自动激活pending套餐（定时任务调用）
exports.checkAutoActivation = async () => {
  const now = new Date();
  const packages = await UserPackage.find({
    is_activated: false,
    auto_activate_at: { $lte: now },
    status: 'pending',
  });

  for (const pkg of packages) {
    // 检查该用户是否有active套餐（如果有active套餐，不自动激活pending）
    const hasActive = await UserPackage.findOne({
      user_id: pkg.user_id,
      status: 'active',
    });
    if (hasActive) continue; // 有active套餐，跳过自动激活

    pkg.is_activated = true;
    pkg.activated_at = now;
    pkg.status = 'active';

    // 统一按北京时间自然日计算起止时间
    const startMoment = dayjs(now).tz(BEIJING_TZ);
    pkg.start_date = startMoment.startOf('day').toDate();
    if (pkg.duration_value) {
      const { end_date } = calculateValidityDates(startMoment, pkg.duration_value, pkg.duration_unit);
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    } else {
      const { end_date } = calculateValidityDates(startMoment, 1, 'year');
      pkg.end_date = end_date;
      pkg.original_end_date = new Date(end_date);
    }

    await pkg.save();

    try {
      await PackageActivation.create({
        user_package_id: pkg._id,
        user_id: pkg.user_id,
        package_id: pkg.package_id || null,
        store_id: pkg.store_id || null,
        activation_type: 'manual_force',
        activated_by: null,
        activated_at: now,
        remark: '自动激活(超时未使用)',
      });
    } catch (actErr) {
      console.error('[Package] 记录自动激活日志失败:', actErr.message);
    }

    try {
      await logService.createLog({
        operator_id: null,
        action: 'auto_activate',
        module: 'package',
        target_id: pkg._id,
        detail: `用户(${pkg.user_id})套餐已自动激活(超时未使用), 有效期至: ${pkg.end_date.toISOString().split('T')[0]}`,
      });
    } catch (logErr) {
      console.error('[Package] 记录自动激活日志失败:', logErr.message);
    }

    try {
      // 自动激活时，如果是凌晨（0-8点），则不发送消息（用户在睡觉，收到也没用）
      const currentHour = new Date().getHours();
      if (currentHour >= 8) {
        const wechatMessageService = require('./wechat-message.service');
        const User = require('../models/User');
        const user = await User.findById(pkg.user_id);
        if (user && user.openid) {
          const packageName = pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`;
          const endDate = pkg.end_date ? dayjs(pkg.end_date).format('YYYY年MM月DD日') : '长期有效';
          await wechatMessageService.sendPackageActivated(user, packageName, endDate);
        }
      } else {
        console.log(`[Package] 自动激活跳过消息发送(凌晨${currentHour}点): ${pkg._id}`);
      }
    } catch (notifyErr) {
      console.error('[Package] 发送自动激活通知失败:', notifyErr.message);
    }
  }

  return { activated_count: packages.length };
};

// 编辑套餐(支持修改套餐类型、课时数、有效期、限制次数等)
exports.updatePackage = async (id, data) => {
  const userPackage = await UserPackage.findById(id);
  if (!userPackage) throw new Error('套餐记录不存在');

  // 已激活的套餐只允许修改部分字段
  const isActivated = userPackage.is_activated;
  const allowedFields = isActivated
    ? ['remaining_credits', 'end_date', 'daily_limit', 'weekly_limit', 'status', 'remark', 'extra_store_ids']
    : ['package_type', 'total_credits', 'remaining_credits', 'duration_value', 'duration_unit', 'daily_limit', 'weekly_limit', 'status', 'remark', 'extra_store_ids'];

  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      userPackage[key] = data[key];
    }
  }

  // 如果修改了有效期，重新计算 end_date
  if (!isActivated && data.duration_value && data.duration_unit) {
    // pending 套餐不计算 end_date，激活时计算
  } else if (isActivated && data.duration_value && data.duration_unit) {
    const startMoment = dayjs(userPackage.start_date || new Date()).tz(BEIJING_TZ);
    const { start_date, end_date } = calculateValidityDates(startMoment, data.duration_value, data.duration_unit);
    userPackage.start_date = start_date;
    userPackage.end_date = end_date;
    userPackage.original_end_date = new Date(end_date);
  }

  await userPackage.save();
  return userPackage;
};

// 删除用户套餐
exports.deleteUserPackage = async (id, operatorId) => {
  const userPackage = await UserPackage.findById(id);
  if (!userPackage) throw new Error('套餐记录不存在');

  // 记录日志
  await logService.createLog({
    operator_id: operatorId,
    action: 'delete',
    module: 'package',
    target_id: userPackage._id,
    detail: `删除用户(${userPackage.user_id})的${userPackage.package_type === 'count_card' ? '次卡' : '时间卡'}套餐`,
  });

  await UserPackage.findByIdAndDelete(id);
  return { success: true };
};

// 获取套餐列表(管理端 - 套餐模板)
exports.getPackageList = async (query) => {
  const { status, page = 1, pageSize = 20 } = query;
  const filter = {};
  if (status) filter.status = status;
  else filter.status = 'active';

  const list = await Package.find(filter)
    .populate('dance_styles', 'name')
    .sort({ sort_order: 1, created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Package.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取套餐模板详情
exports.getPackageById = async (id) => {
  const pkg = await Package.findById(id).populate('dance_styles', 'name');
  if (!pkg) throw new Error('套餐不存在');
  return pkg;
};

// 创建套餐模板
exports.createPackageTemplate = async (data) => {
  if (!data.name) throw new Error('套餐名称不能为空');
  if (!data.class_count || data.class_count <= 0) throw new Error('课时数必须大于0');
  if (!data.price || data.price < 0) throw new Error('价格不能为负数');
  if (!data.duration_days || data.duration_days <= 0) throw new Error('有效期天数必须大于0');

  const pkg = await Package.create(data);
  return pkg;
};

// 更新套餐模板
exports.updatePackageTemplate = async (id, data) => {
  const pkg = await Package.findById(id);
  if (!pkg) throw new Error('套餐不存在');

  const allowedFields = ['name', 'description', 'class_count', 'price', 'original_price', 'duration_days', 'dance_styles', 'is_popular', 'sort_order', 'status'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      pkg[key] = data[key];
    }
  }

  await pkg.save();
  return pkg;
};

// 删除套餐模板
exports.checkPackageUsable = async (userId) => {
  const packages = await UserPackage.find({ user_id: userId }).sort({ created_at: 1 });
  const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
  const pendingPackages = packages.filter(p => p.status === 'pending');

  if (activePackages.length > 0) {
    const reasons = [];
    for (const pkg of activePackages) {
      if (pkg.end_date && new Date() > pkg.end_date) {
        reasons.push('套餐已过期');
      } else if (pkg.package_type === 'count_card' && pkg.remaining_credits <= 0) {
        reasons.push('剩余次数不足');
      }
    }
    if (reasons.length > 0 && reasons.length === activePackages.length) {
      return { isUsable: false, memberPackageStatus: 'active', reasons };
    }
    return { isUsable: true, memberPackageStatus: 'active', reasons: [] };
  }

  if (pendingPackages.length > 0) {
    return { isUsable: false, memberPackageStatus: 'pending', reasons: ['套餐待激活'] };
  }

  return { isUsable: false, memberPackageStatus: 'none', reasons: ['暂无有效套餐'] };
};

exports.deletePackage = async (id) => {
  const pkg = await Package.findById(id);
  if (!pkg) throw new Error('套餐不存在');
  await Package.findByIdAndDelete(id);
  return { success: true };
};

exports.getActivationRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id } = query;

  const activationCount = await PackageActivation.countDocuments();
  const activatedPkgCount = await UserPackage.countDocuments({
    is_activated: true,
    status: { $in: ['active', 'expired', 'exhausted'] },
  });
  if (activationCount < activatedPkgCount) {
    await exports.backfillActivationRecords();
  }

  const filter = {};
  if (store_id) filter.store_id = store_id;

  const list = await PackageActivation.find(filter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('user_package_id', 'package_type total_credits duration_value duration_unit start_date end_date')
    .populate('package_id', 'name')
    .populate('activated_by', 'nick_name username')
    .populate('store_id', 'name')
    .sort({ activated_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await PackageActivation.countDocuments(filter);

  const records = list.map(r => {
    const user = r.user_id || {};
    const pkg = r.user_package_id || {};
    const operator = r.activated_by || {};
    const typeMap = { first_booking: 'booking', manual_force: 'manual' };
    return {
      _id: r._id,
      user_name: user.nick_name || user.real_name || '未知会员',
      user_real_name: user.real_name || '',
      user_nick_name: user.nick_name || '',
      user_phone: user.phone || '',
      package_name: r.package_id ? (r.package_id.name || '') : (pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`),
      type: typeMap[r.activation_type] || r.activation_type,
      activation_type: r.activation_type,
      effective_date: pkg.start_date || r.activated_at,
      expire_date: pkg.end_date || null,
      created_at: r.created_at,
      activated_at: r.activated_at,
      operator_name: operator.nick_name || operator.username || '',
      remark: r.remark || '',
    };
  });

  return { list: records, total, page: Number(page), pageSize: Number(pageSize) };
};

exports.getExtensionRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id } = query;
  const filter = {};
  if (store_id) filter.store_id = store_id;
  filter.operation_type = 'extend';

  const list = await PackageExtension.find(filter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('user_package_id', 'package_type total_credits duration_value duration_unit end_date')
    .populate('package_id', 'name')
    .populate('operated_by', 'nick_name username')
    .populate('store_id', 'name')
    .populate('holiday_id', 'name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await PackageExtension.countDocuments(filter);

  const records = list.map(r => {
    const user = r.user_id || {};
    const pkg = r.package_id || {};
    const operator = r.operated_by || {};
    const holiday = r.holiday_id || {};
    const typeMap = { extend: 'manual', revoke: 'system' };
    let displayType = typeMap[r.operation_type] || 'manual';
    if (holiday && holiday.name) displayType = 'holiday';
    return {
      _id: r._id,
      user_name: user.nick_name || user.real_name || '未知会员',
      user_real_name: user.real_name || '',
      user_nick_name: user.nick_name || '',
      user_phone: user.phone || '',
      package_name: pkg.name || '',
      type: displayType,
      operation_type: r.operation_type,
      extend_days: r.extend_days || 0,
      original_expire: r.original_expire_at,
      new_expire: r.new_expire_at,
      holiday_name: holiday.name || '',
      created_at: r.created_at,
      operator_name: operator.nick_name || operator.username || '',
      remark: r.remark || r.reason || '',
    };
  });

  return { list: records, total, page: Number(page), pageSize: Number(pageSize) };
};

exports.extendPackage = async (packageId, extendDays, operatorId, operatorName, options = {}) => {
  const userPackage = await UserPackage.findById(packageId);
  if (!userPackage) throw new Error('套餐不存在');
  if (!userPackage.is_activated) throw new Error('未激活的套餐不能延长');
  if (userPackage.status === 'expired' || userPackage.status === 'exhausted') throw new Error('已过期或已用完的套餐不能延长');

  const originalEnd = userPackage.end_date || new Date();
  const newEnd = new Date(originalEnd.getTime() + extendDays * 24 * 60 * 60 * 1000);

  userPackage.end_date = newEnd;
  if (userPackage.original_end_date) {
    userPackage.original_end_date = new Date(newEnd);
  }
  await userPackage.save();

  await PackageExtension.create({
    user_package_id: packageId,
    user_id: userPackage.user_id,
    package_id: userPackage.package_id || userPackage._id,
    store_id: userPackage.store_id || options.store_id,
    operation_type: 'extend',
    extend_days: extendDays,
    original_expire_at: originalEnd,
    new_expire_at: newEnd,
    holiday_id: options.holiday_id || null,
    operated_by: operatorId,
    reason: options.reason || '',
    remark: options.remark || '',
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'extend',
    module: 'package',
    target_id: packageId,
    detail: `延长用户(${userPackage.user_id})套餐${extendDays}天, ${originalEnd.toISOString().split('T')[0]} → ${newEnd.toISOString().split('T')[0]}`,
  });

  return userPackage;
};

exports.revokePackageExtension = async (extensionId, operatorId, operatorName, reason) => {
  const ext = await PackageExtension.findById(extensionId);
  if (!ext) throw new Error('延长记录不存在');
  if (ext.operation_type !== 'extend') throw new Error('只能撤销延长操作');

  const userPackage = await UserPackage.findById(ext.user_package_id);
  if (!userPackage) throw new Error('关联套餐不存在');

  const currentEnd = userPackage.end_date;
  const newEnd = new Date(currentEnd.getTime() - ext.extend_days * 24 * 60 * 60 * 1000);
  userPackage.end_date = newEnd;
  if (userPackage.original_end_date) {
    userPackage.original_end_date = new Date(newEnd);
  }
  await userPackage.save();

  await PackageExtension.create({
    user_package_id: ext.user_package_id,
    user_id: ext.user_id,
    package_id: ext.package_id,
    store_id: ext.store_id,
    operation_type: 'revoke',
    extend_days: ext.extend_days,
    original_expire_at: currentEnd,
    new_expire_at: newEnd,
    revoked_extension_id: ext._id,
    operated_by: operatorId,
    reason: reason || '撤销延长',
    remark: reason || '',
  });

  await logService.createLog({
    operator_id: operatorId,
    action: 'revoke_extension',
    module: 'package',
    target_id: ext.user_package_id,
    detail: `撤销用户(${ext.user_id})套餐延长${ext.extend_days}天`,
  });

  return userPackage;
};

exports.getMemberPackageStatus = async (userId) => {
  const packages = await UserPackage.find({ user_id: userId }).sort({ created_at: 1 });
  const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
  const pendingPackages = packages.filter(p => p.status === 'pending');
  const suspendedPackages = packages.filter(p => p.is_suspended);
  const expiredPackages = packages.filter(p => p.status === 'expired' || p.status === 'exhausted');

  return {
    total: packages.length,
    active: activePackages.length,
    pending: pendingPackages.length,
    suspended: suspendedPackages.length,
    expired: expiredPackages.length,
    packages: packages.map(p => ({
      _id: p._id,
      package_type: p.package_type,
      status: p.status,
      is_activated: p.is_activated,
      is_suspended: p.is_suspended,
      start_date: p.start_date,
      end_date: p.end_date,
      remaining_credits: p.remaining_credits,
      total_credits: p.total_credits,
    })),
  };
};

exports.refreshPackageStatus = async (userId) => {
  const now = new Date();
  const packages = await UserPackage.find({ user_id: userId, is_activated: true });

  let updated = 0;
  for (const pkg of packages) {
    if (pkg.status === 'active') {
      if (pkg.end_date && now > pkg.end_date) {
        pkg.status = 'expired';
        await pkg.save();
        updated++;
      } else if (pkg.package_type === 'count_card' && pkg.remaining_credits <= 0) {
        pkg.status = 'exhausted';
        await pkg.save();
        updated++;
      }
    }
  }

  return { updated, message: `更新了${updated}个套餐状态` };
};

exports.backfillActivationRecords = async () => {
  const existingActivations = await PackageActivation.find({}, 'user_package_id');
  const existingSet = new Set(existingActivations.map(a => a.user_package_id.toString()));

  const activatedPackages = await UserPackage.find({
    is_activated: true,
    status: { $in: ['active', 'expired', 'exhausted'] },
  });

  let created = 0;
  let skipped = 0;

  for (const pkg of activatedPackages) {
    if (existingSet.has(pkg._id.toString())) {
      skipped++;
      continue;
    }

    const activationType = pkg.activated_at ? 'first_booking' : 'manual_force';

    await PackageActivation.create({
      user_package_id: pkg._id,
      user_id: pkg.user_id,
      package_id: pkg.package_id || null,
      store_id: pkg.store_id || null,
      activation_type: activationType,
      activated_by: null,
      activated_at: pkg.activated_at || pkg.start_date || pkg.created_at,
      remark: '系统补录',
    });
    created++;
  }

  return { created, skipped, total: activatedPackages.length };
};

// 获取套餐录入记录
exports.getEntryRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id } = query;
  const filter = { created_by: { $ne: null } }; // 只显示有人为录入的
  if (store_id) filter.store_id = store_id;

  const list = await UserPackage.find(filter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('package_id', 'name')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name username')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await UserPackage.countDocuments(filter);

  const records = list.map(userPackage => {
    const user = userPackage.user_id || {};
    const pkg = userPackage.package_id || {};
    const operator = userPackage.created_by || {};
    return {
      _id: userPackage._id,
      user_name: user.nick_name || user.real_name || '未知会员',
      user_real_name: user.real_name || '',
      user_nick_name: user.nick_name || '',
      user_phone: user.phone || '',
      package_name: pkg.name || (userPackage.package_type === 'count_card' ? `${userPackage.total_credits}次卡` : `${userPackage.duration_value || ''}${userPackage.duration_unit === 'month' ? '个月' : '天'}时间卡`),
      package_type: userPackage.package_type,
      total_credits: userPackage.total_credits,
      duration_value: userPackage.duration_value,
      duration_unit: userPackage.duration_unit,
      created_at: userPackage.created_at,
      operator_name: operator.nick_name || operator.username || '',
      remark: userPackage.remark || '',
      status: userPackage.status,
    };
  });

  return { list: records, total, page: Number(page), pageSize: Number(pageSize) };
};
