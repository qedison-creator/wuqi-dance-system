const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BEIJING_TZ = 'Asia/Shanghai';
const Config = require('../models/Config');
const UserPackage = require('../models/UserPackage');
const Booking = require('../models/Booking');
const { sendByTemplateKey } = require('../services/wechat-message.service');

const DEFAULT_EXPIRE_REMIND_DAYS = 8;
const DEFAULT_LOW_COUNT_REMIND = 5;
const DEFAULT_INACTIVE_DAYS = 10;
const DEFAULT_EXPIRE_REMIND_INTERVAL = 2;
const DEFAULT_LOW_COUNT_REMIND_INTERVAL = 3;
const DEFAULT_INACTIVE_REMIND_INTERVAL = 5;

async function getConfig(key, defaultValue) {
  const config = await Config.findOne({ key });
  return config ? parseInt(config.value) : defaultValue;
}

// ========== 套餐到期提醒 ==========
async function sendPackageExpireReminder(user, packageInfo, daysLeft) {
  try {
    const packageName = packageInfo.package_type === 'count_card'
      ? `${packageInfo.total_credits}次卡`
      : `${packageInfo.duration_value || ''}${packageInfo.duration_unit === 'month' ? '个月' : '天'}时间卡`;
    const expireDate = packageInfo.end_date ? dayjs(packageInfo.end_date).format('YYYY年MM月DD日') : '即将到期';

    const ok = await sendByTemplateKey(user.openid, 'packageExpiring', {
      packageType: packageName,
      remindType: '到期提醒',
      remindReason: `您的套餐将于${expireDate}到期`,
      tipMessage: `套餐还有${daysLeft}天到期，记得续费哦`
    }, 'pages/profile/profile');

    if (!ok) {
      console.warn(`[Reminder] 套餐到期提醒发送失败(未授权/配额耗尽/模板未配置): 会员 ${user._id}, 套餐 ${packageInfo._id}`);
      return false;
    }
    console.log(`[Reminder] 发送套餐到期提醒给会员 ${user._id}, 套餐: ${packageInfo._id}, 剩余${daysLeft}天`);
    return true;
  } catch (err) {
    console.error('[Reminder] 发送套餐到期提醒失败:', err);
    return false;
  }
}

// ========== 次卡低次数提醒 ==========
async function sendLowCountReminder(user, packageInfo) {
  try {
    const packageName = `${packageInfo.total_credits}次卡`;
    const remainCount = String(packageInfo.remaining_credits || 0);

    const ok = await sendByTemplateKey(user.openid, 'countCardLowRemind', {
      packageType: `${packageInfo.total_credits}次卡`,
      remindType: '套餐额度',
      remindReason: `剩余次数仅剩${packageInfo.remaining_credits}次`,
      tipMessage: '跳舞次数快用完啦，赶紧囤卡哟'
    }, 'pages/profile/profile');

    if (!ok) {
      console.warn(`[Reminder] 次卡低次数提醒发送失败(未授权/配额耗尽/模板未配置): 会员 ${user._id}, 套餐 ${packageInfo._id}`);
      return false;
    }
    console.log(`[Reminder] 发送次卡低次数提醒给会员 ${user._id}, 套餐: ${packageInfo._id}, 剩余${packageInfo.remaining_credits}次`);
    return true;
  } catch (err) {
    console.error('[Reminder] 发送次卡低次数提醒失败:', err);
    return false;
  }
}

// ========== 会员不活跃提醒 ==========
async function sendInactiveReminder(user, daysInactive, packageInfo) {
  try {
    const memberNickname = user.nick_name || user.real_name || '会员';
    const packageType = packageInfo
      ? (packageInfo.package_type === 'count_card'
        ? `${packageInfo.total_credits}次卡`
        : `${packageInfo.duration_value || ''}${packageInfo.duration_unit === 'month' ? '个月' : '天'}时间卡`)
      : '会员卡';

    const ok = await sendByTemplateKey(user.openid, 'memberInactiveRemind', {
      packageType,
      remindType: '久未跳舞',
      remindReason: `您已超过${daysInactive}天未预约课程`,
      tipMessage: '舞蹈社想你啦，快来跳支舞吧'
    }, 'pages/booking/booking');

    if (!ok) {
      console.warn(`[Reminder] 不活跃提醒发送失败(未授权/配额耗尽/模板未配置): 会员 ${user._id}`);
      return false;
    }
    console.log(`[Reminder] 发送不活跃提醒给会员 ${user._id}, 已${daysInactive}天未预约`);
    return true;
  } catch (err) {
    console.error('[Reminder] 发送不活跃提醒失败:', err);
    return false;
  }
}

// ========== 批量检查：套餐到期提醒 ==========
// 规则：到期前N天开始，每N天最多提醒1次

async function checkPackageExpireReminders() {
  const expireRemindDays = await getConfig('package_expire_remind_days', DEFAULT_EXPIRE_REMIND_DAYS);
  const expireRemindInterval = await getConfig('expire_remind_interval', DEFAULT_EXPIRE_REMIND_INTERVAL);
  const today = dayjs().tz(BEIJING_TZ).startOf('day');
  const todayDate = today.toDate();
  const expireDate = today.add(expireRemindDays, 'day').endOf('day');

  const packages = await UserPackage.find({
    status: 'active',
    end_date: { $gte: todayDate, $lte: expireDate.toDate() }
  }).populate('user_id');

  let sentCount = 0;
  for (const pkg of packages) {
    if (!pkg.user_id || !pkg.user_id.openid) continue;

    if (pkg.user_id.status === 'disabled') continue;
    if (pkg.is_suspended) continue;
    if (pkg.status !== 'active') continue;

    // 去重：如果间隔时间内已提醒过，跳过
    if (pkg.last_expire_reminded_at) {
      const lastReminded = dayjs(pkg.last_expire_reminded_at).tz(BEIJING_TZ);
      if (today.diff(lastReminded, 'day') < expireRemindInterval) {
        continue;
      }
    }

    const daysLeft = dayjs(pkg.end_date).tz(BEIJING_TZ).diff(today, 'day');

    if (pkg.package_type === 'time_card') {
      const sent = await sendPackageExpireReminder(pkg.user_id, pkg, daysLeft);
      if (sent) {
        pkg.last_expire_reminded_at = new Date();
        await pkg.save();
        sentCount++;
      }
    } else if (pkg.package_type === 'count_card') {
      if (pkg.remaining_credits > 0) {
        const sent = await sendPackageExpireReminder(pkg.user_id, pkg, daysLeft);
        if (sent) {
          pkg.last_expire_reminded_at = new Date();
          await pkg.save();
          sentCount++;
        }
      }
    }
  }

  console.log(`[Reminder] 套餐到期提醒检查完成，共发送 ${sentCount} 条提醒`);
  return sentCount;
}

// ========== 批量检查：次卡低次数提醒 ==========
// 规则：剩余≤N次开始，每N天最多提醒1次

async function checkCountCardLowReminders() {
  const lowCount = await getConfig('count_card_low_remind', DEFAULT_LOW_COUNT_REMIND);
  const lowCountRemindInterval = await getConfig('low_count_remind_interval', DEFAULT_LOW_COUNT_REMIND_INTERVAL);
  const today = dayjs().tz(BEIJING_TZ).startOf('day');

  console.log(`[Reminder] 次卡低次数检查参数: lowCount=${lowCount}, interval=${lowCountRemindInterval}, today=${today.format('YYYY-MM-DD')}`);

  const packages = await UserPackage.find({
    package_type: 'count_card',
    status: 'active',
    remaining_credits: { $gt: 0, $lte: lowCount },
    end_date: { $gte: today.toDate() }
  }).populate('user_id');

  console.log(`[Reminder] 次卡低次数查询结果: ${packages.length}个套餐`);

  let sentCount = 0;
  for (const pkg of packages) {
    if (!pkg.user_id || !pkg.user_id.openid) {
      console.log(`[Reminder] 跳过套餐 ${pkg._id}: 用户无openid, userId=${pkg.user_id?._id}`);
      continue;
    }

    if (pkg.user_id.status === 'disabled') {
      console.log(`[Reminder] 跳过套餐 ${pkg._id}: 用户已禁用`);
      continue;
    }
    if (pkg.is_suspended) {
      console.log(`[Reminder] 跳过套餐 ${pkg._id}: 套餐已暂停`);
      continue;
    }

    // 去重：如果间隔时间内已提醒过，跳过
    if (pkg.last_low_count_reminded_at) {
      const lastReminded = dayjs(pkg.last_low_count_reminded_at).tz(BEIJING_TZ);
      if (today.diff(lastReminded, 'day') < lowCountRemindInterval) {
        console.log(`[Reminder] 跳过套餐 ${pkg._id}: ${today.diff(lastReminded, 'day')}天内已提醒过`);
        continue;
      }
    }

    console.log(`[Reminder] 准备发送次卡低次数提醒: 套餐=${pkg._id}, 剩余=${pkg.remaining_credits}次, openid=${pkg.user_id.openid?.substring(0,8)}...`);
    const sent = await sendLowCountReminder(pkg.user_id, pkg);
    if (sent) {
      pkg.last_low_count_reminded_at = new Date();
      await pkg.save();
      sentCount++;
    }
  }

  console.log(`[Reminder] 次卡低次数提醒检查完成，共发送 ${sentCount} 条提醒`);
  return sentCount;
}

// ========== 批量检查：不活跃会员提醒 ==========
// 规则：连续N天未预约开始提醒，之后每N天最多提醒1次

async function checkInactiveMemberReminders() {
  const inactiveDays = await getConfig('inactive_remind_days', DEFAULT_INACTIVE_DAYS);
  const inactiveRemindInterval = await getConfig('inactive_remind_interval', DEFAULT_INACTIVE_REMIND_INTERVAL);
  const cutoffDate = dayjs().tz(BEIJING_TZ).subtract(inactiveDays, 'day').endOf('day');
  const today = dayjs().tz(BEIJING_TZ).startOf('day');

  const activeUserIds = await UserPackage.find({
    status: 'active'
  }).distinct('user_id');

  const recentBookerIds = await Booking.find({
    status: { $in: ['booked', 'completed'] },
    created_at: { $gte: cutoffDate.toDate() }
  }).distinct('user_id');

  const inactiveUserIds = activeUserIds.filter(id => !recentBookerIds.includes(id.toString()));

  const User = require('../models/User');
  const users = await User.find({
    _id: { $in: inactiveUserIds },
    openid: { $exists: true, $ne: '' },
    status: { $ne: 'disabled' }
  });

  let sentCount = 0;
  for (const user of users) {
    // 去重：如果5天内已提醒过，跳过
    if (user.last_inactive_reminded_at) {
      const lastReminded = dayjs(user.last_inactive_reminded_at).tz(BEIJING_TZ);
      if (today.diff(lastReminded, 'day') < inactiveRemindInterval) {
        continue;
      }
    }

    const activePackage = await UserPackage.findOne({
      user_id: user._id,
      status: 'active',
      is_suspended: { $ne: true }
    });
    if (!activePackage) continue;

    const lastBooking = await Booking.findOne({
      user_id: user._id,
      status: { $in: ['booked', 'completed'] }
    }).sort({ created_at: -1 });

    let daysInactive = inactiveDays;
    if (lastBooking) {
      daysInactive = dayjs().tz(BEIJING_TZ).diff(dayjs(lastBooking.created_at), 'day');
    }

    if (daysInactive >= inactiveDays) {
      const sent = await sendInactiveReminder(user, daysInactive, activePackage);
      if (sent) {
        user.last_inactive_reminded_at = new Date();
        await user.save();
        sentCount++;
      }
    }
  }

  console.log(`[Reminder] 不活跃会员提醒检查完成，共发送 ${sentCount} 条提醒`);
  return sentCount;
}

async function runAllReminders() {
  console.log('[Reminder] 开始执行所有套餐提醒任务...');

  const results = {
    expireReminders: await checkPackageExpireReminders(),
    lowCountReminders: await checkCountCardLowReminders(),
    inactiveReminders: await checkInactiveMemberReminders()
  };

  console.log('[Reminder] 所有套餐提醒任务执行完成:', results);
  return results;
}

module.exports = {
  checkPackageExpireReminders,
  checkCountCardLowReminders,
  checkInactiveMemberReminders,
  runAllReminders
};