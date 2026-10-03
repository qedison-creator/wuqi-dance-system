/* 冒烟测试：数据中心看板（v7 重构版 datacenter.service）
 *  1. 总览：消耗课时/节数/会员数/到课率/较上期
 *  2. 每日趋势：按天序列与结论
 *  3. 热门课程（按课时+人数）/ 热门教练（按到课人次）
 *  4. 会员排行双榜：消耗 TOP / 当月取消 TOP
 *  5. 提醒三类（同源阈值）+ 标记已联系/恢复
 *  6. 课时账单：按会员明细字段完整（日期/星期/时间/课时/课程/舞种/教练/签到方式）
 *     + 手机号搜索 + 会员删除后快照兜底 + 审核员 403
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。纯 service 层调用。
 * 用法：node scripts/smoke-datacenter.js
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
  if (cond) { passed += 1; console.log(`  PASS ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); }
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
  const Booking = require('../src/models/Booking');
  const CoachAttendance = require('../src/models/CoachAttendance');
  const CoachSalaryStat = require('../src/models/CoachSalaryStat');
  const bookingService = require('../src/services/booking.service');
  const scheduleService = require('../src/services/schedule.service');
  const dc = require('../src/services/datacenter.service');

  const store = await Store.create({ name: '冒烟门店', address: '测试街1号', phone: '10000000000' });
  const styleJazz = await DanceStyle.create({ name: '冒烟爵士' });
  const styleBallet = await DanceStyle.create({ name: '冒烟芭蕾' });
  const coach = await Coach.create({ name: '冒烟教练A', store_ids: [store._id] });
  const admin = await User.create({
    username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin',
    user_type: 'admin', member_status: 'official', store_ids: [],
  });

  let seq = 0;
  async function makeMember(name, phoneSuffix) {
    seq += 1;
    return User.create({
      openid: `smoke-dc-${Date.now()}-${seq}`,
      real_name: name || `会员${seq}`, phone: `135000${String(10000 + seq).slice(-5)}`, gender: 1,
      member_status: 'official', user_type: 'member', store_id: store._id, info_completed: true,
      member_code: `DC${String(2000 + seq)}`,
    });
  }
  async function makeSchedule(dateStr, credits, danceStyle) {
    const isJazz = (danceStyle || styleJazz) === styleJazz || danceStyle === null;
    return Schedule.create({
      coach_id: coach._id, dance_style_id: (danceStyle || styleJazz)._id, store_id: store._id,
      date: dateStr, start_time: '20:00', end_time: '21:15',
      course_name: isJazz ? '冒烟爵士课' : '冒烟芭蕾课',
      max_bookings: 20, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30,
      credits_cost: credits || 1,
    });
  }
  function timePkg(user, fields) {
    return UserPackage.create({
      user_id: user._id, store_id: store._id, package_type: 'time_card',
      total_credits: 10002, remaining_credits: 10002, created_by: admin._id,
      is_activated: true, status: 'active',
      end_date: dayjs().tz(BJ).add(365, 'day').endOf('day').toDate(),
      member_snapshot: { real_name: user.real_name, member_code: user.member_code, phone: user.phone },
      package_snapshot: { name: '时间卡' },
      ...fields,
    });
  }
  function countPkg(user, credits, fields) {
    return UserPackage.create({
      user_id: user._id, store_id: store._id, package_type: 'count_card',
      total_credits: credits, remaining_credits: credits, created_by: admin._id,
      is_activated: true, status: 'active',
      end_date: dayjs().tz(BJ).add(365, 'day').endOf('day').toDate(),
      member_snapshot: { real_name: user.real_name, member_code: user.member_code, phone: user.phone },
      package_snapshot: { name: `${credits}次卡` },
      ...fields,
    });
  }

  // 测试区间：未来第1~10天（排课都造在这里）
  const start = futureDate(0);
  const end = futureDate(9);

  // ---- 造数据 ----
  const mA = await makeMember('甲会员');
  const mB = await makeMember('乙会员');
  await timePkg(mA, {});
  await timePkg(mB, {});
  const s1 = await makeSchedule(futureDate(0), 2, styleJazz);   // 明天 爵士 2课时
  const s2 = await makeSchedule(futureDate(1), 1, styleBallet); // 后天 芭蕾 1课时
  await bookingService.createBooking(mA._id, s1._id);
  await bookingService.createBooking(mB._id, s1._id);
  await bookingService.createBooking(mA._id, s2._id);

  // 签到消课（走 markAttendance → 触发 datacenter_update 广播路径）
  await scheduleService.markAttendance(s1._id, [mA._id, mB._id], admin._id);
  // s2 只到课甲（乙 booked 未到 → 爽约 1 节）
  await scheduleService.markAttendance(s2._id, [mA._id], admin._id);

  // ---- [1] 总览 ----
  console.log('\n[1] 课时消耗总览');
  const overview = await dc.getOverview({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end });
  check('消耗课时=5（2+2+1）', overview.consumed_credits === 5, overview);
  check('节数=3', overview.sessions === 3, overview);
  check('会员数=2', overview.members === 2, overview);
  check('取消率=0%（此时尚无取消，3 个总预约）', overview.cancel_rate === 0 && overview.total_bookings === 3, JSON.stringify(overview));
  check('对比期无数据 → diff_pct=null', overview.diff_pct === null, overview.diff_pct);

  // ---- [2] 每日趋势 ----
  console.log('\n[2] 每日趋势');
  const trend = await dc.getTrend({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end });
  check('趋势覆盖完整区间天数', trend.days.length === 10, trend.days.length);
  const day0 = trend.days.find(d => d.date === futureDate(0));
  check('第一日消耗=4 课时', day0 && day0.credits === 4, day0);
  check('趋势结论含最热一天', trend.insight.includes('最热的一天'), trend.insight);

  // ---- [3] 热门课程 ----
  console.log('\n[3] 热门课程');
  const hot = await dc.getHotCourses({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end });
  check('热门课程第一名=冒烟爵士课(4课时)', hot.list[0] && hot.list[0].name === '冒烟爵士课' && hot.list[0].credits === 4, hot.list);
  check('热门课程附上课人数', hot.list[0] && hot.list[0].people === 2, hot.list[0]);

  // ---- [4] 热门教练（到课人次） ----
  console.log('\n[4] 热门教练');
  await CoachAttendance.create({
    coach_id: coach._id, schedule_id: null, store_id: store._id, course_name: '冒烟爵士', dance_style_name: '冒烟爵士',
    course_date: futureDate(0), start_time: '20:00', end_time: '21:15', duration: 75, checked_in_count: 3,
    coach_name: '冒烟教练A', store_name: '冒烟门店',
  });
  const hotCoaches = await dc.getHotCoaches({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end });
  check('教练到课人次=3', hotCoaches.list.length === 1 && hotCoaches.list[0].visits === 3, hotCoaches.list);
  check('教练节数=1', hotCoaches.list[0].sessions === 1, hotCoaches.list[0]);

  // ---- [5] 会员排行双榜 ----
  console.log('\n[5] 会员排行');
  const mC = await makeMember('丙会员');
  await countPkg(mC, 10, {});
  for (let i = 0; i < 3; i++) {
    const s = await makeSchedule(futureDate(2 + i), 1, styleJazz);
    const r = await bookingService.createBooking(mC._id, s._id);
    await bookingService.cancelBooking(mC._id, r.booking._id);
  }
  const rank = await dc.getMemberRank({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end, role: 'super_admin' });
  check('消耗榜第一名=甲会员(3课时2节)', rank.consume_top[0] && rank.consume_top[0].name === '甲会员' && rank.consume_top[0].credits === 3 && rank.consume_top[0].sessions === 2, rank.consume_top);
  check('取消榜第一名=丙会员(3次)', rank.cancel_top[0] && rank.cancel_top[0].name === '丙会员' && rank.cancel_top[0].cancel_count === 3, rank.cancel_top);

  // 取消率跟随所选区间：取消产生后总览重算（3 取消 / 6 总预约 = 50%）
  const overviewAfter = await dc.getOverview({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end });
  check('取消率=50%（3 取消 / 6 总预约）', overviewAfter.cancel_rate === 50 && overviewAfter.cancel_sessions === 3 && overviewAfter.total_bookings === 6, JSON.stringify(overviewAfter));

  // ---- [6] 提醒三类 ----
  console.log('\n[6] 提醒');
  const mD = await makeMember('丁会员');
  await timePkg(mD, { end_date: dayjs().tz(BJ).add(5, 'day').endOf('day').toDate() }); // 快到期
  const mE = await makeMember('戊会员');
  await countPkg(mE, 10, { remaining_credits: 2 });                                    // 次数不足
  const mF = await makeMember('己会员');
  await timePkg(mF, {});                                                               // 无上课记录 → 不算沉睡（未上过课）
  await require('../src/models/Attendance').collection.insertOne({
    user_id: mF._id, schedule_id: null, store_id: store._id, check_in_time: new Date(Date.now() - 40 * 86400000),
    check_in_method: 'scan', status: 'completed', created_at: new Date(),
  });
  const reminders = await dc.getReminders({ storeId: String(store._id), role: 'super_admin' });
  check('快到期提醒命中丁会员', reminders.groups.expiring.some(x => x.user_name === '丁会员'), reminders.groups.expiring.map(x => x.user_name));
  check('次数不足提醒命中戊会员', reminders.groups.low_credits.some(x => x.user_name === '戊会员'), reminders.groups.low_credits.map(x => x.user_name));
  check('很久没来提醒命中己会员(40天)', reminders.groups.dormant.some(x => x.user_name === '己会员'), reminders.groups.dormant.map(x => x.user_name));
  const dItem = reminders.groups.expiring.find(x => x.user_name === '丁会员');
  await dc.markReminderDone({ storeId: String(store._id), memberId: dItem.member_id, alertType: 'expiring', periodKey: reminders.period_key, operator: { id: admin._id, name: '超管' } });
  const reminders2 = await dc.getReminders({ storeId: String(store._id), role: 'super_admin' });
  const doneItem = reminders2.groups.expiring.find(x => x.user_name === '丁会员');
  check('标记已联系生效且带操作痕迹', doneItem && doneItem.followup_done && doneItem.followup_info.operator_name === '超管', doneItem);
  await dc.undoReminderDone({ memberId: dItem.member_id, alertType: 'expiring', periodKey: reminders.period_key });
  const reminders3 = await dc.getReminders({ storeId: String(store._id), role: 'super_admin' });
  check('恢复提醒生效', reminders3.groups.expiring.find(x => x.user_name === '丁会员').followup_done === false, '');

  // ---- [7] 课时账单 ----
  console.log('\n[7] 课时账单');
  const bill = await dc.getMemberBill({ storeId: String(store._id), startDate: start, endDate: end, role: 'super_admin' });
  const zhang = bill.members.find(m => m.name === '甲会员');
  check('账单按会员汇总：甲会员 3 课时/2 节', zhang && zhang.credits === 3 && zhang.sessions === 2, zhang);
  const zhangBill = zhang.bills.find(b => b.date === futureDate(0));
  check('明细含签到方式', zhangBill && zhangBill.check_in_label === '扫码签到', zhangBill && zhangBill.check_in_label);
  check('明细含舞种快照', zhangBill && zhangBill.dance_name === '冒烟爵士', zhangBill && zhangBill.dance_name);
  check('明细含教练快照', zhangBill && zhangBill.coach_name === '冒烟教练A', zhangBill && zhangBill.coach_name);
  check('明细含星期', zhangBill && typeof zhangBill.weekday === 'string' && zhangBill.weekday.length === 2, zhangBill && zhangBill.weekday);
  check('按日期分组存在', bill.by_date.length > 0, bill.by_date.length);

  // 手机号搜索
  const billByPhone = await dc.getMemberBill({ storeId: String(store._id), search: mA.phone, startDate: start, endDate: end, role: 'super_admin' });
  check('手机号搜索命中', billByPhone.members.length === 1 && billByPhone.members[0].name === '甲会员', billByPhone.members.map(m => m.name));

  // 会员删除后快照兜底
  const mG = await makeMember('被删会员');
  await timePkg(mG, {});
  const s7 = await makeSchedule(futureDate(5), 2, styleJazz);
  await bookingService.createBooking(mG._id, s7._id);
  await scheduleService.markAttendance(s7._id, [mG._id], admin._id);
  await User.deleteOne({ _id: mG._id });
  const billAfterDelete = await dc.getMemberBill({ storeId: String(store._id), startDate: start, endDate: end, role: 'super_admin' });
  const deletedRow = billAfterDelete.members.find(m => m.name === '被删会员');
  check('会员删除后账单姓名靠快照保留', !!deletedRow, billAfterDelete.members.map(m => m.name));

  // 取消率跨周期口径：更宽的自定义区间重算（爽约注入已移除，取消率指标于前轮迭代替代到课率）
  const overviewWide = await dc.getOverview({ storeId: String(store._id), period: 'custom', startDate: futureDate(-2), endDate: end });
  check('宽区间重算仍正确（消耗=7 课时）', overviewWide.consumed_credits === 7, JSON.stringify(overviewWide));

  // ---- [8] 权限 ----
  console.log('\n[8] 权限');
  const tryReviewer = (fn) => fn().then(() => false).catch(e => e.statusCode === 403 || String(e.message).includes('审核员') ? true : false);
  check('reviewer 访问会员排行 403', await tryReviewer(() => dc.getMemberRank({ storeId: String(store._id), period: 'month', role: 'reviewer' })));
  check('reviewer 访问提醒 403', await tryReviewer(() => dc.getReminders({ storeId: String(store._id), role: 'reviewer' })));
  check('reviewer 访问课时账单 403', await tryReviewer(() => dc.getMemberBill({ storeId: String(store._id), startDate: start, endDate: end, role: 'reviewer' })));
  const overviewReviewer = await dc.getOverview({ storeId: String(store._id), period: 'custom', startDate: start, endDate: end });
  check('reviewer 可见总览汇总（service 不拦）', overviewReviewer.consumed_credits === 7, overviewReviewer.consumed_credits);

  console.log(`\n===== 结果: ${passed} passed, ${failed} failed =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async err => {
  console.error('冒烟脚本异常:', err);
  try { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } catch (e) { /* ignore */ }
  process.exit(1);
});
