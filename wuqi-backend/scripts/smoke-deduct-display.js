/* 冒烟测试：按天口径「缩短有效期」规则（shrink_days）
 *  1. 不限次卡扣2课时课：预约成功 end_date 立即缩短2天、booking.shrink_days=2；连续双课时课放行并累计缩期
 *  2. 六个列表/出勤接口 deduct_days 断言；取消后 end_date 加回且记录保留标记（前端"已恢复"文案依据）
 *  3. 每日1节卡：1课时课不缩期；当天上过1课时再约2课时被拒（钻空子拦截）；上过2课时再约1课时同样被拒
 *  4. 时间卡当日已满降级次卡：次卡真扣、时间卡不缩期
 *  5. 有效期护栏：剩余有效期不足 N 天时拒绝预约
 *  6. 旧"占天"数据兼容：occupied_dates 不再驱动展示
 *  7. 已过期套餐取消恢复后复活为 active
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。纯 service 层调用，无需起 HTTP 服务。
 * 用法：node scripts/smoke-deduct-display.js
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/wuqi_dance_smoke_test';
process.env.JWT_SECRET = 'smoke-test-secret';

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BJ = 'Asia/Shanghai';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`);
  }
}

async function expectThrow(name, fn, keyword) {
  try {
    await fn();
    check(name, false, '未抛出错误');
  } catch (err) {
    check(name, err.message && err.message.includes(keyword), { actual: err.message });
  }
}

function futureDate(offset) {
  return dayjs().tz(BJ).add(offset + 1, 'day').format('YYYY-MM-DD');
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  for (const c of await db.listCollections().toArray()) await db.dropCollection(c.name);

  const Store = require('../src/models/Store');
  const DanceStyle = require('../src/models/DanceStyle');
  const Coach = require('../src/models/Coach');
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const Schedule = require('../src/models/Schedule');
  const bookingService = require('../src/services/booking.service');
  const scheduleService = require('../src/services/schedule.service');
  const attendanceService = require('../src/services/attendance.service');

  const store = await Store.create({ name: '冒烟门店', address: '测试街1号', phone: '10000000000' });
  const style = await DanceStyle.create({ name: '冒烟舞种' });
  const coach = await Coach.create({ name: '冒烟教练', store_ids: [store._id] });
  const admin = await User.create({
    username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin',
    user_type: 'admin', member_status: 'official', store_ids: [],
  });

  let seq = 0;
  async function makeMember() {
    seq += 1;
    return User.create({
      openid: `smoke-shrink-${Date.now()}-${seq}`,
      real_name: `会员${seq}`, phone: `136000${String(10000 + seq).slice(-5)}`, gender: 1,
      member_status: 'official', user_type: 'member', store_id: store._id, info_completed: true,
    });
  }
  async function makeSchedule(dateStr, creditsCost, startTime, endTime) {
    return Schedule.create({
      coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
      date: dateStr, start_time: startTime || '20:00', end_time: endTime || '21:15',
      max_bookings: 20, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30,
      credits_cost: creditsCost || 1,
    });
  }
  function pkg(user, fields) {
    return UserPackage.create({
      user_id: user._id, store_id: store._id, package_type: 'time_card',
      total_credits: 10002, remaining_credits: 10002, created_by: admin._id,
      is_activated: true, status: 'active',
      end_date: dayjs().tz(BJ).add(365, 'day').endOf('day').toDate(),
      ...fields,
    });
  }
  // 断言 end_date 相对某基准缩短了 expectShrink 天（按整天毫秒差取整，消除毫秒尾数误差）
  function daysBetween(endDate, baseDate) {
    return Math.round(dayjs(endDate).diff(dayjs(baseDate)) / 86400000);
  }

  // ---- [1] 不限次卡：缩期 + 连续双课时放行 ----
  console.log('\n[1] 不限次卡缩期');
  const m1 = await makeMember();
  const p1 = await pkg(m1, {});
  const p1End0 = p1.end_date;
  const s1 = await makeSchedule(futureDate(0), 2);
  const r1 = await bookingService.createBooking(m1._id, s1._id);
  check('预约成功', r1 && r1.booking && r1.booking.status === 'booked', !!r1);
  check('booking.shrink_days=2', r1.booking.shrink_days === 2, r1.booking.shrink_days);
  let p1Now = await UserPackage.findById(p1._id);
  check('end_date 缩短2天', daysBetween(p1Now.end_date, p1End0) === -2, daysBetween(p1Now.end_date, p1End0));

  const s2 = await makeSchedule(futureDate(1), 2); // 次日再上一节双课时（旧规则会被锁卡拒绝）
  const r2 = await bookingService.createBooking(m1._id, s2._id);
  check('连续双课时课放行（无锁卡）', r2 && r2.booking && r2.booking.status === 'booked', r2 && r2.booking && r2.booking.status);
  p1Now = await UserPackage.findById(p1._id);
  check('end_date 累计缩短4天', daysBetween(p1Now.end_date, p1End0) === -4, daysBetween(p1Now.end_date, p1End0));

  // ---- [2] 展示接口 + 取消恢复 ----
  console.log('\n[2] 展示字段与取消恢复');
  const myBookings = await bookingService.getMyBookings(m1._id, 'all', 1, 20);
  const rec1 = myBookings.list.find(b => String(b._id) === String(r1.booking._id));
  const rec2 = myBookings.list.find(b => String(b._id) === String(r2.booking._id));
  check('getMyBookings deduct_days=2（两条均带标记）', rec1 && rec2 && rec1.deduct_days === 2 && rec2.deduct_days === 2, myBookings.list.map(b => b.deduct_days));
  const adminList = await bookingService.getBookingList({ schedule_id: s1._id, page: 1, pageSize: 20 });
  check('getBookingList deduct_days=2', adminList.list[0] && adminList.list[0].deduct_days === 2, adminList.list[0] && adminList.list[0].deduct_days);
  const schedBookings = await scheduleService.getScheduleBookings(s1._id);
  check('getScheduleBookings deduct_days=2', schedBookings[0] && schedBookings[0].deduct_days === 2, schedBookings[0] && schedBookings[0].deduct_days);

  await scheduleService.markAttendance(s1._id, [m1._id], admin._id);
  const myAtt = await attendanceService.getMyAttendance(m1._id, 1, 20);
  const att1 = myAtt.list.find(a => String(a.booking_id || '') === String(r1.booking._id));
  check('getMyAttendance deduct_days=2', att1 && att1.deduct_days === 2, att1 && att1.deduct_days);
  const byUser = await attendanceService.getAttendanceByUser(m1._id);
  check('getAttendanceByUser deduct_days=2', byUser.list.some(a => a.deduct_days === 2), byUser.list.map(a => a.deduct_days));
  const bySched = await attendanceService.getAttendanceBySchedule(s1._id);
  check('getAttendanceBySchedule deduct_days=2', bySched.records.some(r => r.deduct_days === 2), bySched.records.map(r => r.deduct_days));

  // 取消 s2 的预约（开课远未到，走 NORMAL 分支）→ end_date 加回2天，净缩2天
  await bookingService.cancelBooking(m1._id, r2.booking._id);
  p1Now = await UserPackage.findById(p1._id);
  check('取消后 end_date 加回2天（净缩2天）', daysBetween(p1Now.end_date, p1End0) === -2, daysBetween(p1Now.end_date, p1End0));
  const myBookings2 = await bookingService.getMyBookings(m1._id, 'all', 1, 20);
  const rec2After = myBookings2.list.find(b => String(b._id) === String(r2.booking._id));
  check('取消记录保留 shrink_days（前端"有效期已恢复"依据）', rec2After && rec2After.status === 'cancelled' && rec2After.deduct_days === 2, rec2After && { status: rec2After.status, deduct_days: rec2After.deduct_days });

  // ---- [3] 每日1节卡：1课时不缩期 + 当日独占（钻空子拦截）----
  console.log('\n[3] 每日1节卡');
  const m2 = await makeMember();
  const p2 = await pkg(m2, { daily_limit: 1 });
  const p2End0 = p2.end_date;
  const s3 = await makeSchedule(futureDate(0), 1);
  const r3 = await bookingService.createBooking(m2._id, s3._id);
  check('1课时课预约成功且不缩期', r3.booking.status === 'booked' && !r3.booking.shrink_days, r3.booking.shrink_days);
  const s4 = await makeSchedule(futureDate(0), 2);
  await expectThrow('当天上过1课时后再约2课时被拒（每天限1节）', () => bookingService.createBooking(m2._id, s4._id), '每天限约1节');
  let p2Now = await UserPackage.findById(p2._id);
  check('被拒预约不缩期', daysBetween(p2Now.end_date, p2End0) === 0, daysBetween(p2Now.end_date, p2End0));

  const m2b = await makeMember();
  const p2b = await pkg(m2b, { daily_limit: 1 });
  const s4b = await makeSchedule(futureDate(0), 2);
  await bookingService.createBooking(m2b._id, s4b._id);
  const s3b = await makeSchedule(futureDate(0), 1);
  await expectThrow('当天上过2课时后再约1课时同样被拒', () => bookingService.createBooking(m2b._id, s3b._id), '每天限约1节');
  const p2bNow = await UserPackage.findById(p2b._id);
  check('2课时课当天缩期2天', daysBetween(p2bNow.end_date, p2b.end_date) === -2, daysBetween(p2bNow.end_date, p2b.end_date));

  // ---- [4] 时间卡当日已满降级次卡 ----
  console.log('\n[4] 降级次卡');
  const m3 = await makeMember();
  const p3 = await pkg(m3, { daily_limit: 1 });
  const p3Count = await UserPackage.create({
    user_id: m3._id, store_id: store._id, package_type: 'count_card',
    total_credits: 10, remaining_credits: 10, created_by: admin._id,
    is_activated: true, status: 'active',
  });
  const s6 = await makeSchedule(futureDate(0), 1);
  await bookingService.createBooking(m3._id, s6._id);
  const s7 = await makeSchedule(futureDate(0), 2, '18:00', '19:15');  // 与 s6 不同时段，避免同时段冲突校验先拦
  const r7 = await bookingService.createBooking(m3._id, s7._id);
  check('当日已满时降级次卡成功', r7 && String(r7.usedPackage._id) === String(p3Count._id), r7 && r7.usedPackage && r7.usedPackage._id);
  check('降级预约无 shrink_days', !r7.booking.shrink_days, r7.booking.shrink_days);
  const p3CountNow = await UserPackage.findById(p3Count._id);
  check('次卡被扣2次', p3CountNow.remaining_credits === 8, p3CountNow.remaining_credits);
  const p3Now = await UserPackage.findById(p3._id);
  check('时间卡不缩期', daysBetween(p3Now.end_date, p3.end_date) === 0, daysBetween(p3Now.end_date, p3.end_date));

  // ---- [5] 有效期护栏 ----
  console.log('\n[5] 有效期护栏');
  const m4 = await makeMember();
  const shortEnd = dayjs().tz(BJ).add(2, 'day').endOf('day').toDate(); // 距上课日(明天+1)不足2天
  await pkg(m4, { end_date: shortEnd });
  const s8 = await makeSchedule(futureDate(0), 2);
  await expectThrow('剩余有效期不足2天时拒绝约2课时课', () => bookingService.createBooking(m4._id, s8._id), '有效期不足');
  const s9 = await makeSchedule(futureDate(0), 1);
  const r9 = await bookingService.createBooking(m4._id, s9._id);
  check('同状态1课时课可约（不缩期不受护栏影响）', r9 && r9.booking.status === 'booked', !!r9);

  // ---- [6] 旧"占天"数据兼容 ----
  console.log('\n[6] 旧数据兼容');
  const m5 = await makeMember();
  const p5 = await pkg(m5, {});
  const s10 = await makeSchedule(futureDate(0), 2);
  const legacy = await (require('../src/models/Booking')).create({
    schedule_id: s10._id, user_id: m5._id, coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
    booking_date: s10.date, booking_time: s10.start_time, status: 'booked', credits_deducted: 2,
    user_package_id: p5._id, occupied_dates: [futureDate(0), futureDate(1)],
  });
  const myBookings5 = await bookingService.getMyBookings(m5._id, 'all', 1, 20);
  const rec5 = myBookings5.list.find(b => String(b._id) === String(legacy._id));
  check('occupied_dates 不再驱动展示（deduct_days=null）', rec5 && rec5.deduct_days === null, rec5 && rec5.deduct_days);

  // ---- [7] 已过期套餐取消恢复复活 ----
  console.log('\n[7] 过期套餐复活');
  const m6 = await makeMember();
  const p6 = await pkg(m6, {});
  const s11 = await makeSchedule(futureDate(0), 2);
  const r11 = await bookingService.createBooking(m6._id, s11._id);
  // 手动把套餐推到过期（原生驱动绕过 immutable 校验）
  await UserPackage.collection.updateOne({ _id: p6._id }, { $set: { end_date: new Date(Date.now() - 86400000), status: 'expired' } });
  await bookingService.cancelBooking(m6._id, r11.booking._id);
  const p6Now = await UserPackage.findById(p6._id);
  check('取消后有效期加回并复活为 active', p6Now.status === 'active' && new Date(p6Now.end_date) > new Date(), { status: p6Now.status, end: p6Now.end_date });

  console.log(`\n===== 结果: ${passed} passed, ${failed} failed =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async err => {
  console.error('冒烟脚本异常:', err);
  try { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } catch (e) { /* ignore */ }
  process.exit(1);
});
