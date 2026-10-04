/* 诊断（只读）：某会员的套餐与预约「按天口径缩期」识别情况
 *
 * 用途：排查某节课为什么显示"2课时"而不是"有效期减N天"——
 *   逐条打印预约的 user_package_id、credits_deducted、shrink_days，以及关联套餐的类型/周期限制，
 *   据此判断：①该预约挂的是不是按天口径卡（不限次/每天1节）；②credits_deducted 是否缺失（显示取自签到记录）。
 *
 * 用法（服务器后端根目录）：
 *   node scripts/diag-member-shrink.js 郭巧仪
 *   node scripts/diag-member-shrink.js 13800000000
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BJ = 'Asia/Shanghai';
const f = d => (d ? dayjs(d).tz(BJ).format('YYYY-MM-DD') : '-');

function pkgCycle(p) {
  const isDay = (!p.daily_limit && !p.weekly_limit && !p.monthly_limit) ||
    (p.daily_limit === 1 && !p.weekly_limit && !p.monthly_limit);
  let label = '不限次';
  if (p.weekly_limit) label = `每周${p.weekly_limit}次`;
  else if (p.monthly_limit) label = `每月${p.monthly_limit}次`;
  else if (p.daily_limit && p.daily_limit !== 1) label = `每天${p.daily_limit}次`;
  return { isDay, label };
}

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const Booking = require('../src/models/Booking');
  const Attendance = require('../src/models/Attendance');

  const kw = process.argv[2];
  if (!kw) { console.log('用法: node scripts/diag-member-shrink.js <姓名或手机号>'); process.exit(1); }

  const users = await User.find({ $or: [{ real_name: kw }, { phone: kw }, { real_name: new RegExp(kw) }] }).select('real_name phone');
  if (!users.length) { console.log('未找到会员:', kw); process.exit(0); }

  for (const u of users) {
    console.log(`\n===== 会员 ${u.real_name} / ${u.phone} (${u._id}) =====`);

    console.log('--- 套餐 ---');
    const pkgs = await UserPackage.find({ user_id: u._id }).sort({ start_date: 1 });
    if (!pkgs.length) console.log('  (无套餐)');
    pkgs.forEach(p => {
      const c = pkgCycle(p);
      console.log(`  [${p._id}] ${p.package_type} | ${c.label} | ${c.isDay ? '★按天口径' : '非按天口径'} | ` +
        `${f(p.start_date)} ~ ${f(p.end_date)} | 剩余课时:${p.remaining_credits} | 追溯标记:${p.retro_shrink_applied_days ?? '-'} | 状态:${p.status}`);
    });

    console.log('--- 预约 / 上课记录（按课程日期倒序）---');
    const bks = await Booking.find({ user_id: u._id }).sort({ booking_date: -1 })
      .select('booking_date status credits_deducted shrink_days user_package_id');
    if (!bks.length) console.log('  (无预约)');
    for (const b of bks) {
      const pkg = b.user_package_id ? await UserPackage.findById(b.user_package_id)
        .select('package_type daily_limit weekly_limit monthly_limit') : null;
      const att = await Attendance.findOne({ booking_id: b._id }).select('credits_cost status');
      const pkgTag = pkg
        ? `${pkg.package_type}(${pkgCycle(pkg).label}${pkgCycle(pkg).isDay ? '/★按天' : ''})`
        : '⚠无关联套餐';
      console.log(`  ${b.booking_date} | ${b.status} | 预约扣课时:${b.credits_deducted} | 签到记:${att ? att.credits_cost : '-'} | ` +
        `shrink_days:${b.shrink_days ?? '-'} | 套餐:${pkgTag} ${b.user_package_id || ''}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error('诊断失败:', err); process.exit(1); });