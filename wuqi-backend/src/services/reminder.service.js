const dayjs = require('dayjs');
const Config = require('../models/Config');
const UserPackage = require('../models/UserPackage');
const Booking = require('../models/Booking');
const { sendSubscribeMessage } = require('../services/wechat-message.service');
const { getMessageTemplates } = require('../config/messageConfig');

const DEFAULT_EXPIRE_REMIND_DAYS = 8;
const DEFAULT_LOW_COUNT_REMIND = 5;
const DEFAULT_INACTIVE_DAYS = 10;

async function getConfig(key, defaultValue) {
  const config = await Config.findOne({ key });
  return config ? parseInt(config.value) : defaultValue;
}

async function sendPackageExpireReminder(user, packageInfo, daysLeft) {
  try {
    const templates = getMessageTemplates();
    if (!templates.packageExpiringTemplateId) {
      console.log('[Reminder] 套餐到期提醒模板未配置');
      return false;
    }

    const data = {
      thing1: { value: packageInfo.package_type === 'count_card' ? `${packageInfo.total_credits}次卡` : '时间卡' },
      date2: { value: dayjs(packageInfo.end_date).format('YYYY年MM月DD日') },
      thing3: { value: `剩余${daysLeft}天` },
      thing4: { value: packageInfo.package_type === 'count_card' ? `${packageInfo.remaining_credits || 0}次` : '时间卡' }
    };

    await sendSubscribeMessage(
      user.openid,
      templates.packageExpiringTemplateId,
      data,
      'pages/profile/profile'
    );

    console.log(`[Reminder] 发送套餐到期提醒给会员 ${user._id}, 套餐: ${packageInfo._id}, 剩余${daysLeft}天`);
    return true;
  } catch (err) {
    console.error('[Reminder] 发送套餐到期提醒失败:', err);
    return false;
  }
}

async function sendLowCountReminder(user, packageInfo) {
  try {
    const templates = getMessageTemplates();
    if (!templates.countCardLowRemindTemplateId) {
      console.log('[Reminder] 次卡低次数提醒模板未配置');
      return false;
    }

    const data = {
      thing1: { value: `${packageInfo.total_credits}次卡` },
      date2: { value: dayjs().format('YYYY年MM月DD日') },
      thing3: { value: `剩余${packageInfo.remaining_credits || 0}次` },
      thing4: { value: '请及时预约课程' }
    };

    await sendSubscribeMessage(
      user.openid,
      templates.countCardLowRemindTemplateId,
      data,
      'pages/profile/profile'
    );

    console.log(`[Reminder] 发送次卡低次数提醒给会员 ${user._id}, 套餐: ${packageInfo._id}, 剩余${packageInfo.remaining_credits}次`);
    return true;
  } catch (err) {
    console.error('[Reminder] 发送次卡低次数提醒失败:', err);
    return false;
  }
}

async function sendInactiveReminder(user, daysInactive) {
  try {
    const templates = getMessageTemplates();
    if (!templates.memberInactiveRemindTemplateId) {
      console.log('[Reminder] 会员不活跃提醒模板未配置');
      return false;
    }

    const data = {
      thing1: { value: '温馨提醒' },
      date2: { value: dayjs().format('YYYY年MM月DD日') },
      thing3: { value: `您已${daysInactive}天未预约课程` },
      thing4: { value: '快来预约课程吧' }
    };

    await sendSubscribeMessage(
      user.openid,
      templates.memberInactiveRemindTemplateId,
      data,
      'pages/booking/booking'
    );

    console.log(`[Reminder] 发送不活跃提醒给会员 ${user._id}, 已${daysInactive}天未预约`);
    return true;
  } catch (err) {
    console.error('[Reminder] 发送不活跃提醒失败:', err);
    return false;
  }
}

async function checkPackageExpireReminders() {
  const expireRemindDays = await getConfig('package_expire_remind_days', DEFAULT_EXPIRE_REMIND_DAYS);
  const today = dayjs().startOf('day');
  const expireDate = today.add(expireRemindDays, 'day').endOf('day');

  const packages = await UserPackage.find({
    status: 'active',
    end_date: { $gte: today.toDate(), $lte: expireDate.toDate() }
  }).populate('user_id');

  const User = require('../models/User');
  let sentCount = 0;
  for (const pkg of packages) {
    if (!pkg.user_id || !pkg.user_id.openid) continue;

    if (pkg.user_id.status === 'disabled') continue;
    if (pkg.is_suspended) continue;
    if (pkg.status !== 'active') continue;

    const daysLeft = dayjs(pkg.end_date).diff(today, 'day');

    if (pkg.package_type === 'time_card') {
      await sendPackageExpireReminder(pkg.user_id, pkg, daysLeft);
      sentCount++;
    } else if (pkg.package_type === 'count_card') {
      if (pkg.remaining_credits > 0) {
        await sendPackageExpireReminder(pkg.user_id, pkg, daysLeft);
        sentCount++;
      }
    }
  }

  console.log(`[Reminder] 套餐到期提醒检查完成，共发送 ${sentCount} 条提醒`);
  return sentCount;
}

async function checkCountCardLowReminders() {
  const lowCount = await getConfig('count_card_low_remind', DEFAULT_LOW_COUNT_REMIND);
  const today = dayjs().startOf('day');

  const packages = await UserPackage.find({
    package_type: 'count_card',
    status: 'active',
    remaining_credits: { $gt: 0, $lte: lowCount },
    end_date: { $gte: today.toDate() }
  }).populate('user_id');

  let sentCount = 0;
  for (const pkg of packages) {
    if (!pkg.user_id || !pkg.user_id.openid) continue;

    if (pkg.user_id.status === 'disabled') continue;
    if (pkg.is_suspended) continue;

    await sendLowCountReminder(pkg.user_id, pkg);
    sentCount++;
  }

  console.log(`[Reminder] 次卡低次数提醒检查完成，共发送 ${sentCount} 条提醒`);
  return sentCount;
}

async function checkInactiveMemberReminders() {
  const inactiveDays = await getConfig('inactive_remind_days', DEFAULT_INACTIVE_DAYS);
  const cutoffDate = dayjs().subtract(inactiveDays, 'day').endOf('day');

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
      daysInactive = dayjs().diff(dayjs(lastBooking.created_at), 'day');
    }

    if (daysInactive >= inactiveDays) {
      await sendInactiveReminder(user, daysInactive);
      sentCount++;
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
