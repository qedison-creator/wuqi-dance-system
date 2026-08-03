const mongoose = require('mongoose');
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

  // 为所有 active 且未停卡的套餐构建统计信息（支持次卡+时间卡同时展示）
  const activePackages = packages.filter(p => p.status === 'active' && !p.is_suspended);
  const activeStats = await Promise.all(activePackages.map(async (pkg) => {
    const stat = {
      _id: pkg._id,
      package_type: pkg.package_type,
      package_name: pkg.remark || (pkg.package_type === 'count_card' ? '次卡' : '时间卡'),
    };
    if (pkg.package_type === 'count_card') {
      stat.remaining = pkg.remaining_credits || 0;
      stat.label = '次卡剩余';
      stat.isUnlimited = false;
    } else if (pkg.package_type === 'time_card') {
      const usage = await calcTimeCardUsage(pkg);
      if (pkg.daily_limit) {
        stat.remaining = usage.daily_remaining !== null ? usage.daily_remaining : pkg.daily_limit;
        stat.label = '今日剩余';
        stat.isUnlimited = false;
      } else if (pkg.weekly_limit) {
        stat.remaining = usage.weekly_remaining !== null ? usage.weekly_remaining : pkg.weekly_limit;
        stat.label = '本周剩余';
        stat.isUnlimited = false;
      } else {
        stat.remaining = -1;
        stat.label = '不限次数';
        stat.isUnlimited = true;
      }
    }
    return stat;
  }));

  return {
    current: activePackage || null,
    pending: pendingPackages,
    suspended: suspendedPackages.length > 0 ? suspendedPackages : null,
    hasSuspended: suspendedPackages.length > 0,
    history: packages,
    timeCardUsage,
    activeStats,
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
// 辅助函数：为激活记录/延长记录构建会员和套餐快照
// 优先使用 UserPackage 自身的 member_snapshot/package_snapshot（录入时保存），
// 缺失时实时查询 User 和 Package 填充
exports._buildActivationSnapshot = async (userPackage) => {
  let memberSnapshot = {};
  let packageSnapshot = {};

  // 会员快照：优先用 UserPackage 已有快照
  if (userPackage.member_snapshot && (userPackage.member_snapshot.real_name || userPackage.member_snapshot.nick_name)) {
    memberSnapshot = {
      real_name: userPackage.member_snapshot.real_name || '',
      nick_name: userPackage.member_snapshot.nick_name || '',
      phone: userPackage.member_snapshot.phone || '',
      wechat_phone: userPackage.member_snapshot.wechat_phone || '',
      member_code: userPackage.member_snapshot.member_code || '',
    };
  } else {
    // 快照缺失时实时查询
    try {
      const memberDoc = await User.findById(userPackage.user_id).select('real_name nick_name phone wechat_phone member_code').lean();
      if (memberDoc) {
        memberSnapshot = {
          real_name: memberDoc.real_name || '',
          nick_name: memberDoc.nick_name || '',
          phone: memberDoc.phone || '',
          wechat_phone: memberDoc.wechat_phone || '',
          member_code: memberDoc.member_code || '',
        };
      }
    } catch (e) { /* 静默忽略 */ }
  }

  // 套餐快照：优先用 UserPackage 已有快照，再查 Package
  let packageName = '';
  if (userPackage.package_snapshot && userPackage.package_snapshot.name) {
    packageName = userPackage.package_snapshot.name;
  } else if (userPackage.package_id) {
    try {
      const packageDoc = await Package.findById(userPackage.package_id).select('name').lean();
      if (packageDoc) packageName = packageDoc.name || '';
    } catch (e) { /* 静默忽略 */ }
  }
  packageSnapshot = {
    name: packageName,
    package_type: userPackage.package_type || '',
    total_credits: userPackage.total_credits || 0,
    duration_value: userPackage.duration_value || 0,
    duration_unit: userPackage.duration_unit || '',
    start_date: userPackage.start_date || null,
    end_date: userPackage.end_date || null,
  };

  return { member_snapshot: memberSnapshot, package_snapshot: packageSnapshot };
};

exports.createPackage = async (data, operatorId) => {
  const { user_id, package_id, store_id, extra_store_ids, package_type, total_credits, duration_value, duration_unit, daily_limit, weekly_limit, remark } = data;

  if (!user_id) throw new Error('用户ID不能为空');
  if (!package_type) throw new Error('套餐类型不能为空');

  const existingActive = await UserPackage.findOne({ user_id, status: 'active' });

  const autoActivateAt = new Date();
  autoActivateAt.setMonth(autoActivateAt.getMonth() + 2);

  // 保存会员和套餐快照，即使后续被删除记录信息也不丢失
  const [memberDoc, packageDoc] = await Promise.all([
    User.findById(user_id).select('real_name nick_name phone wechat_phone member_code').lean(),
    package_id ? Package.findById(package_id).select('name').lean() : null,
  ]);
  const memberSnapshot = memberDoc ? {
    real_name: memberDoc.real_name || '',
    nick_name: memberDoc.nick_name || '',
    phone: memberDoc.phone || '',
    wechat_phone: memberDoc.wechat_phone || '',
    member_code: memberDoc.member_code || '',
  } : {};
  const packageSnapshot = packageDoc ? { name: packageDoc.name || '' } : {};

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
    member_snapshot: memberSnapshot,
    package_snapshot: packageSnapshot,
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

    // 构建激活记录快照（优先使用 UserPackage 已有快照，缺失时实时查询）
    const activationSnapshot = await exports._buildActivationSnapshot(pkg);

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
        member_snapshot: activationSnapshot.member_snapshot,
        package_snapshot: activationSnapshot.package_snapshot,
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

    // 构建激活记录快照
    const autoActivationSnapshot = await exports._buildActivationSnapshot(pkg);

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
        member_snapshot: autoActivationSnapshot.member_snapshot,
        package_snapshot: autoActivationSnapshot.package_snapshot,
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

  // 回填历史记录中缺失的快照数据（幂等，已修复的记录快速跳过）
  try {
    await exports.repairActivationSnapshots();
  } catch (e) {
    // 忽略修复失败，不影响查询
  }

  const filter = {};
  if (store_id) filter.store_id = store_id;

  const list = await PackageActivation.find(filter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('user_package_id', 'member_snapshot package_snapshot package_type total_credits duration_value duration_unit start_date end_date created_by remark')
    .populate('package_id', 'name')
    .populate('activated_by', 'nick_name username')
    .populate('store_id', 'name')
    .sort({ activated_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await PackageActivation.countDocuments(filter);

  const records = list.map(r => {
    const user = r.user_id;
    const pkg = r.user_package_id;
    const operator = r.activated_by || {};
    const typeMap = { first_booking: 'booking', manual_force: 'manual', default: 'default' };
    // 预建档/批量导入的会员套餐由管理员创建（created_by 存在），
    // backfill 时被误标为 first_booking + "系统补录"，
    // 此处修正为"默认激活" + "管理员录入"
    let displayType = typeMap[r.activation_type] || r.activation_type;
    let displayRemark = r.remark || '';
    if (r.remark === '系统补录' && pkg && pkg.created_by) {
      displayType = 'default';
      displayRemark = '管理员录入';
    }
    // 会员自主激活（first_booking 且 activated_by 是会员自己）：不显示操作人
    // 会员自主激活无需多此一举标注操作人，谁都知道是用户自主激活的
    const isSelfActivated = r.activation_type === 'first_booking'
      && r.activated_by && user && String(r.activated_by._id) === String(user._id);
    const operatorName = isSelfActivated ? '' : (operator.nick_name || operator.username || '');
    // 会员信息：user_id populate > UserPackage.member_snapshot > PackageActivation.member_snapshot > UserPackage.remark提取
    const snapshot = r.member_snapshot || {};
    const pkgSnapshot = r.package_snapshot || {};
    const upMemberSnapshot = (pkg && pkg.member_snapshot) ? pkg.member_snapshot : {};
    const upPkgSnapshot = (pkg && pkg.package_snapshot) ? pkg.package_snapshot : {};
    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (upMemberSnapshot.real_name || upMemberSnapshot.nick_name || snapshot.real_name || snapshot.nick_name || '');
    // 兜底：从 UserPackage.remark 提取（格式："张三 的套餐（会员已删除）"）
    if (!userRealName && pkg && pkg.remark) {
      const nameMatch = pkg.remark.match(/^(.+?)\s*的套餐/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
        userRealName = nameMatch[1].trim();
      }
    }
    if (!userRealName) userRealName = '未知会员';
    const userDeleted = !user;
    // 套餐信息：populate 失败时回退到快照
    let packageName = '';
    let effectiveDate = null;
    let expireDate = null;
    if (pkg) {
      // UserPackage 存在时，优先使用 package_id populate 的名称，再回退到快照
      packageName = (r.package_id && r.package_id.name) ? r.package_id.name : (upPkgSnapshot.name || pkgSnapshot.name || '');
      if (!packageName) {
        packageName = pkg.package_type === 'count_card' ? `${pkg.total_credits}次卡` : `${pkg.duration_value || ''}${pkg.duration_unit === 'month' ? '个月' : '天'}时间卡`;
      }
      effectiveDate = pkg.start_date || r.activated_at;
      expireDate = pkg.end_date || null;
    } else {
      // UserPackage 也不存在，使用快照
      packageName = pkgSnapshot.name || (pkgSnapshot.package_type === 'count_card' ? `${pkgSnapshot.total_credits}次卡` : `${pkgSnapshot.duration_value || ''}${pkgSnapshot.duration_unit === 'month' ? '个月' : '天'}时间卡`);
      effectiveDate = pkgSnapshot.start_date || r.activated_at;
      expireDate = pkgSnapshot.end_date || null;
    }
    return {
      _id: r._id,
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (upMemberSnapshot.real_name || snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (upMemberSnapshot.nick_name || snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (upMemberSnapshot.phone || snapshot.phone || ''),
      user_deleted: userDeleted,
      package_name: packageName,
      type: displayType,
      activation_type: r.activation_type,
      effective_date: effectiveDate,
      expire_date: expireDate,
      created_at: r.created_at,
      activated_at: r.activated_at,
      operator_name: operatorName,
      remark: displayRemark,
    };
  });

  return { list: records, total, page: Number(page), pageSize: Number(pageSize) };
};

exports.getExtensionRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id } = query;
  const filter = {};
  if (store_id) filter.store_id = store_id;
  filter.operation_type = 'extend';

  // 回填历史记录中缺失的快照数据（幂等，已修复的记录快速跳过）
  try {
    await exports.repairExtensionSnapshots();
  } catch (e) {
    // 忽略修复失败，不影响查询
  }

  const list = await PackageExtension.find(filter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('user_package_id', 'member_snapshot package_snapshot package_type total_credits duration_value duration_unit end_date remark')
    .populate('package_id', 'name')
    .populate('operated_by', 'nick_name username')
    .populate('store_id', 'name')
    .populate('holiday_id', 'name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await PackageExtension.countDocuments(filter);

  const records = list.map(r => {
    const user = r.user_id;
    const pkg = r.package_id;
    const up = r.user_package_id;
    const operator = r.operated_by || {};
    const holiday = r.holiday_id || {};
    const typeMap = { extend: 'manual', revoke: 'system' };
    let displayType = typeMap[r.operation_type] || 'manual';
    if (holiday && holiday.name) displayType = 'holiday';
    // 会员信息：user_id populate > UserPackage.member_snapshot > PackageExtension.member_snapshot > UserPackage.remark提取
    const snapshot = r.member_snapshot || {};
    const pkgSnapshot = r.package_snapshot || {};
    const upMemberSnapshot = (up && up.member_snapshot) ? up.member_snapshot : {};
    const upPkgSnapshot = (up && up.package_snapshot) ? up.package_snapshot : {};
    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (upMemberSnapshot.real_name || upMemberSnapshot.nick_name || snapshot.real_name || snapshot.nick_name || '');
    // 兜底：从 UserPackage.remark 提取（格式："张三 的套餐（会员已删除）"）
    if (!userRealName && up && up.remark) {
      const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
        userRealName = nameMatch[1].trim();
      }
    }
    if (!userRealName) userRealName = '未知会员';
    // 套餐名：package_id populate > UserPackage.package_snapshot > PackageExtension.package_snapshot
    let packageName = (pkg && pkg.name) ? pkg.name : (upPkgSnapshot.name || pkgSnapshot.name || '');
    if (!packageName && up) {
      packageName = up.package_type === 'count_card' ? `${up.total_credits}次卡` : `${up.duration_value || ''}${up.duration_unit === 'month' ? '个月' : '天'}时间卡`;
    }
    return {
      _id: r._id,
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (upMemberSnapshot.real_name || snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (upMemberSnapshot.nick_name || snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (upMemberSnapshot.phone || snapshot.phone || ''),
      user_deleted: !user,
      package_name: packageName,
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

  // 构建延长记录快照
  const extendSnapshot = await exports._buildActivationSnapshot(userPackage);

  // 延长原始输入值与单位（day/month），便于前端准确还原显示
  const extendValue = Number(options.extend_value) || extendDays;
  const extendUnit = options.extend_unit === 'month' ? 'month' : 'day';

  await PackageExtension.create({
    user_package_id: packageId,
    user_id: userPackage.user_id,
    package_id: userPackage.package_id || userPackage._id,
    store_id: userPackage.store_id || options.store_id,
    operation_type: 'extend',
    extend_days: extendDays,
    extend_value: extendValue,
    extend_unit: extendUnit,
    original_expire_at: originalEnd,
    new_expire_at: newEnd,
    holiday_id: options.holiday_id || null,
    operated_by: operatorId,
    reason: options.reason || '',
    remark: options.remark || '',
    member_snapshot: extendSnapshot.member_snapshot,
    package_snapshot: {
      name: extendSnapshot.package_snapshot.name,
      package_type: extendSnapshot.package_snapshot.package_type,
      total_credits: extendSnapshot.package_snapshot.total_credits,
    },
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
    // 构建激活记录快照
    const backfillSnapshot = await exports._buildActivationSnapshot(pkg);

    await PackageActivation.create({
      user_package_id: pkg._id,
      user_id: pkg.user_id,
      package_id: pkg.package_id || null,
      store_id: pkg.store_id || null,
      activation_type: activationType,
      activated_by: null,
      activated_at: pkg.activated_at || pkg.start_date || pkg.created_at,
      remark: '系统补录',
      member_snapshot: backfillSnapshot.member_snapshot,
      package_snapshot: backfillSnapshot.package_snapshot,
    });
    created++;
  }

  return { created, skipped, total: activatedPackages.length };
};

// 清理历史遗留的虚假 UserPackage 记录（由旧版 repairDeletedUserPackages 创建）
// 这些记录 status='expired'、remaining_credits=0、remark='已删除会员套餐记录恢复'，
// 数据不真实，且套餐录入已改为从 PackageActivation 日志表查询，不再需要这些记录
exports.cleanupFakeRepairRecords = async () => {
  try {
    const result = await UserPackage.deleteMany({
      remark: '已删除会员套餐记录恢复'
    });
    if (result.deletedCount > 0) {
      console.log(`[cleanupFakeRepairRecords] 清理了 ${result.deletedCount} 条虚假恢复记录`);
    }
    return { deleted: result.deletedCount };
  } catch (err) {
    console.error('[cleanupFakeRepairRecords] 清理失败:', err);
    return { deleted: 0 };
  }
};

// 修复历史 PackageActivation 记录中缺失的快照数据
// 从关联的 UserPackage 记录中回填 member_snapshot 和 package_snapshot
// UserPackage 在创建时就保存了会员和套餐快照，是真实数据源
// 注意：MongoDB 查询 { 'member_snapshot.real_name': '' } 不匹配 member_snapshot 字段不存在的旧文档，
// 必须同时用 $exists: false 捕获这些记录
exports.repairActivationSnapshots = async () => {
  const BATCH_SIZE = 100;
  let repairedMember = 0;
  let repairedPackage = 0;
  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const records = await PackageActivation.find({
      $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' },
        { 'package_snapshot': { $exists: false } },
        { 'package_snapshot.name': '', 'package_snapshot.package_type': '' },
      ]
    })
    .limit(BATCH_SIZE)
    .skip(skip)
    .lean();

    if (records.length === 0) {
      hasMore = false;
      break;
    }

    const upIds = records.map(r => r.user_package_id).filter(Boolean);
    const userIds = records.map(r => r.user_id).filter(Boolean);
    const [userPackages, users] = await Promise.all([
      UserPackage.find({ _id: { $in: upIds } })
        .select('member_snapshot package_snapshot package_type total_credits duration_value duration_unit remark')
        .lean(),
      User.find({ _id: { $in: userIds } })
        .select('real_name nick_name phone wechat_phone member_code')
        .lean()
    ]);
    const upMap = {};
    userPackages.forEach(up => { upMap[String(up._id)] = up; });
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = u; });

    const bulkOps = [];
    for (const record of records) {
      const upId = record.user_package_id ? String(record.user_package_id) : '';
      const up = upMap[upId];
      const updateFields = {};

      const hasMemberSnapshot = record.member_snapshot && (record.member_snapshot.real_name || record.member_snapshot.nick_name);
      const hasPackageSnapshot = record.package_snapshot && (record.package_snapshot.name || record.package_snapshot.package_type);

      // 回填 member_snapshot
      if (!hasMemberSnapshot) {
        let memberData = null;

        // 优先级1: UserPackage.member_snapshot（创建套餐时保存的快照）
        if (up && up.member_snapshot && (up.member_snapshot.real_name || up.member_snapshot.nick_name)) {
          memberData = up.member_snapshot;
        }
        // 优先级2: User 表直查（会员可能未被物理删除，或软删除仍保留数据）
        if (!memberData) {
          const uid = record.user_id ? String(record.user_id) : '';
          const userDoc = userMap[uid];
          if (userDoc && (userDoc.real_name || userDoc.nick_name)) {
            memberData = {
              real_name: userDoc.real_name || '',
              nick_name: userDoc.nick_name || '',
              phone: userDoc.phone || '',
              wechat_phone: userDoc.wechat_phone || '',
              member_code: userDoc.member_code || '',
            };
          }
        }
        // 优先级3: 从 UserPackage.remark 提取会员名（删除会员时 remark 格式："张三 的套餐（会员已删除）"）
        if (!memberData && up && up.remark) {
          const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
          if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
            memberData = {
              real_name: nameMatch[1].trim(),
              nick_name: '',
              phone: '',
              wechat_phone: '',
              member_code: '',
            };
          }
        }

        if (memberData) {
          updateFields['member_snapshot'] = memberData;
          repairedMember++;
        }
      }

      // 回填 package_snapshot
      if (!hasPackageSnapshot && up) {
        const upPs = up.package_snapshot || {};
        updateFields['package_snapshot'] = {
          name: upPs.name || '',
          package_type: up.package_type || upPs.package_type || '',
          total_credits: up.total_credits || upPs.total_credits || 0,
          duration_value: up.duration_value || upPs.duration_value || 0,
          duration_unit: up.duration_unit || upPs.duration_unit || '',
        };
        repairedPackage++;
      }

      if (Object.keys(updateFields).length > 0) {
        bulkOps.push({
          updateOne: {
            filter: { _id: record._id },
            update: { $set: updateFields }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await PackageActivation.bulkWrite(bulkOps);
    }

    skip += BATCH_SIZE;
  }

  console.log(`[repairActivationSnapshots] 回填完成: member_snapshot=${repairedMember}, package_snapshot=${repairedPackage}`);
  return { repaired_member_snapshot: repairedMember, repaired_package_snapshot: repairedPackage };
};

// 修复历史 PackageExtension 记录中缺失的快照数据
// 从关联的 UserPackage 记录中回填 member_snapshot 和 package_snapshot
// 注意：MongoDB 查询 { 'member_snapshot.real_name': '' } 不匹配 member_snapshot 字段不存在的旧文档
exports.repairExtensionSnapshots = async () => {
  const BATCH_SIZE = 100;
  let repairedMember = 0;
  let repairedPackage = 0;
  let hasMore = true;
  let skip = 0;

  while (hasMore) {
    const records = await PackageExtension.find({
      $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' },
        { 'package_snapshot': { $exists: false } },
        { 'package_snapshot.name': '', 'package_snapshot.package_type': '' },
      ]
    })
    .limit(BATCH_SIZE)
    .skip(skip)
    .lean();

    if (records.length === 0) {
      hasMore = false;
      break;
    }

    const upIds = records.map(r => r.user_package_id).filter(Boolean);
    const userIds = records.map(r => r.user_id).filter(Boolean);
    const [userPackages, users] = await Promise.all([
      UserPackage.find({ _id: { $in: upIds } })
        .select('member_snapshot package_snapshot package_type total_credits remark')
        .lean(),
      User.find({ _id: { $in: userIds } })
        .select('real_name nick_name phone wechat_phone member_code')
        .lean()
    ]);
    const upMap = {};
    userPackages.forEach(up => { upMap[String(up._id)] = up; });
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = u; });

    const bulkOps = [];
    for (const record of records) {
      const upId = record.user_package_id ? String(record.user_package_id) : '';
      const up = upMap[upId];
      const updateFields = {};

      const hasMemberSnapshot = record.member_snapshot && (record.member_snapshot.real_name || record.member_snapshot.nick_name);
      const hasPackageSnapshot = record.package_snapshot && (record.package_snapshot.name || record.package_snapshot.package_type);

      // 回填 member_snapshot
      if (!hasMemberSnapshot) {
        let memberData = null;

        // 优先级1: UserPackage.member_snapshot
        if (up && up.member_snapshot && (up.member_snapshot.real_name || up.member_snapshot.nick_name)) {
          memberData = up.member_snapshot;
        }
        // 优先级2: User 表直查
        if (!memberData) {
          const uid = record.user_id ? String(record.user_id) : '';
          const userDoc = userMap[uid];
          if (userDoc && (userDoc.real_name || userDoc.nick_name)) {
            memberData = {
              real_name: userDoc.real_name || '',
              nick_name: userDoc.nick_name || '',
              phone: userDoc.phone || '',
              wechat_phone: userDoc.wechat_phone || '',
              member_code: userDoc.member_code || '',
            };
          }
        }
        // 优先级3: 从 UserPackage.remark 提取
        if (!memberData && up && up.remark) {
          const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
          if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
            memberData = {
              real_name: nameMatch[1].trim(),
              nick_name: '',
              phone: '',
              wechat_phone: '',
              member_code: '',
            };
          }
        }

        if (memberData) {
          updateFields['member_snapshot'] = memberData;
          repairedMember++;
        }
      }

      // 回填 package_snapshot
      if (!hasPackageSnapshot && up) {
        const upPs = up.package_snapshot || {};
        updateFields['package_snapshot'] = {
          name: upPs.name || '',
          package_type: up.package_type || upPs.package_type || '',
          total_credits: up.total_credits || upPs.total_credits || 0,
        };
        repairedPackage++;
      }

      if (Object.keys(updateFields).length > 0) {
        bulkOps.push({
          updateOne: {
            filter: { _id: record._id },
            update: { $set: updateFields }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await PackageExtension.bulkWrite(bulkOps);
    }

    skip += BATCH_SIZE;
  }

  console.log(`[repairExtensionSnapshots] 回填完成: member_snapshot=${repairedMember}, package_snapshot=${repairedPackage}`);
  return { repaired_member_snapshot: repairedMember, repaired_package_snapshot: repairedPackage };
};

// 修复历史 UserPackage 记录中缺失的 member_snapshot
// 从 User 表（存在则取真实数据）或 remark 字段（已删除会员）回填会员快照
// 确保即使会员被删除，套餐录入记录也能显示真实会员姓名
exports.repairUserPackageMemberSnapshots = async () => {
  const BATCH_SIZE = 100;
  let repaired = 0;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const userPackages = await UserPackage.find({
      $or: [
        { 'member_snapshot': { $exists: false } },
        { 'member_snapshot.real_name': '', 'member_snapshot.nick_name': '' }
      ]
    })
    .select('user_id member_snapshot remark')
    .skip(skip)
    .limit(BATCH_SIZE)
    .lean();

    if (userPackages.length === 0) {
      hasMore = false;
      break;
    }

    const userIds = userPackages.map(up => up.user_id).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select('real_name nick_name phone wechat_phone member_code')
      .lean();
    const userMap = {};
    users.forEach(u => { userMap[String(u._id)] = u; });

    const bulkOps = [];
    for (const up of userPackages) {
      const uid = up.user_id ? String(up.user_id) : '';
      const user = userMap[uid];
      let memberData = null;

      if (user && (user.real_name || user.nick_name)) {
        // 用户存在：使用真实数据
        memberData = {
          real_name: user.real_name || '',
          nick_name: user.nick_name || '',
          phone: user.phone || '',
          wechat_phone: user.wechat_phone || '',
          member_code: user.member_code || '',
        };
      } else if (up.remark) {
        // 用户已删除：从 remark 提取会员名（格式："张三 的套餐（会员已删除）"）
        const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
        if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
          memberData = {
            real_name: nameMatch[1].trim(),
            nick_name: '',
            phone: '',
            wechat_phone: '',
            member_code: '',
          };
        }
      }

      if (memberData) {
        bulkOps.push({
          updateOne: {
            filter: { _id: up._id },
            update: { $set: { member_snapshot: memberData } }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      const result = await UserPackage.bulkWrite(bulkOps);
      repaired += result.modifiedCount;
    }

    skip += BATCH_SIZE;
  }

  console.log(`[repairUserPackageMemberSnapshots] 修复了 ${repaired} 条UserPackage记录的member_snapshot`);
  return { repaired };
};

// 获取套餐录入记录
// 直接从 UserPackage 表查询：UserPackage 每条记录就是一次套餐录入，包含完整的真实数据
// （package_type, total_credits, duration_value, created_at, created_by, member_snapshot 等）
// UserPackage 记录不会被删除（删除会员时仅标记为 expired），数据完整可靠
exports.getEntryRecords = async (query) => {
  const { page = 1, pageSize = 20, store_id } = query;

  // 清理历史遗留的虚假记录（幂等，无虚假记录时快速返回）
  try {
    await exports.cleanupFakeRepairRecords();
  } catch (e) {
    // 忽略清理失败，不影响查询
  }

  // 回填缺失的 member_snapshot（幂等，已修复则快速跳过）
  try {
    await exports.repairUserPackageMemberSnapshots();
  } catch (e) {
    console.error('[getEntryRecords] repairUserPackageMemberSnapshots 失败:', e.message);
  }

  // 直接从 UserPackage 表查询，排除已被 cleanupFakeRepairRecords 清理的虚假记录
  const filter = { remark: { $ne: '已删除会员套餐记录恢复' } };
  if (store_id) {
    // 将 store_id 字符串转为 ObjectId，确保与 MongoDB 中 ObjectId 类型字段匹配
    filter.store_id = mongoose.isValidObjectId(store_id) ? new mongoose.Types.ObjectId(store_id) : store_id;
  }

  const list = await UserPackage.find(filter)
    .populate('user_id', 'nick_name real_name phone')
    .populate('package_id', 'name')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name username')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await UserPackage.countDocuments(filter);

  const records = list.map(up => {
    const user = up.user_id;
    const pkg = up.package_id;
    const operator = up.created_by || {};
    const snapshot = up.member_snapshot || {};
    const pkgSnapshot = up.package_snapshot || {};

    // 会员名称优先级：user_id populate > member_snapshot > remark提取
    let userRealName = (user && (user.real_name || user.nick_name))
      ? (user.real_name || user.nick_name)
      : (snapshot.real_name || snapshot.nick_name || '');
    // 兜底：从 remark 提取（格式："张三 的套餐（会员已删除）"）
    if (!userRealName && up.remark) {
      const nameMatch = up.remark.match(/^(.+?)\s*的套餐/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== '已删除会员') {
        userRealName = nameMatch[1].trim();
      }
    }
    if (!userRealName) userRealName = '未知会员';

    // 套餐名称优先级：package_id populate > package_snapshot.name > 从字段拼接
    let packageName = (pkg && pkg.name) ? pkg.name : (pkgSnapshot.name || '');
    if (!packageName) {
      if (up.package_type === 'count_card') {
        packageName = `${up.total_credits || 0}次卡`;
      } else if (up.package_type === 'time_card') {
        packageName = `${up.duration_value || ''}${up.duration_unit === 'month' ? '个月' : '天'}时间卡`;
      }
    }

    // 套餐类型/课时/时长：直接从 UserPackage 字段获取（真实数据）
    const packageType = up.package_type || '';
    const totalCredits = up.total_credits || 0;
    const durationValue = up.duration_value || 0;
    const durationUnit = up.duration_unit || '';

    return {
      _id: up._id,
      user_name: userRealName,
      user_real_name: (user && user.real_name) ? user.real_name : (snapshot.real_name || ''),
      user_nick_name: (user && user.nick_name) ? user.nick_name : (snapshot.nick_name || ''),
      user_phone: (user && user.phone) ? user.phone : (snapshot.phone || ''),
      user_deleted: !user,
      package_name: packageName,
      package_type: packageType,
      total_credits: totalCredits,
      duration_value: durationValue,
      duration_unit: durationUnit,
      created_at: up.created_at,  // 录入时间=UserPackage创建时间
      operator_name: operator.nick_name || operator.username || '',
      remark: up.remark || '',
      status: up.status || 'active',
    };
  });

  return { list: records, total, page: Number(page), pageSize: Number(pageSize) };
};
