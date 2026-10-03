/* 冒烟测试：套餐「可用星期」限制（weekday_limit）
 *  1. createPackage/updatePackage 持久化与规范化
 *  2. 会员自助预约：受限日拦截 / 可用日放行 / 多套餐自动选择 / 待激活套餐过滤
 *  3. joinWaitlist 受限日拦截；promoteWaitlist（管理端路径）不受限
 *  4. 批量导入 16 列模板：可用星期解析与非法值报错（HTTP multipart）
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。
 * 前置：后端已以同库同 JWT_SECRET 启动在 3900 端口。
 * 用法：node scripts/smoke-weekday-limit.js
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/wuqi_dance_smoke_test';
process.env.JWT_SECRET = 'smoke-test-secret';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BJ = 'Asia/Shanghai';
const BASE = 'http://localhost:3900/api/v1';

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

// 找到未来的指定星期几（getDay 口径：0=周日…6=周六），返回 YYYY-MM-DD
function nextWeekday(targetDay) {
  let d = dayjs().tz(BJ).add(1, 'day');
  while (d.day() !== targetDay) d = d.add(1, 'day');
  return d.format('YYYY-MM-DD');
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  for (const c of await db.listCollections().toArray()) await db.dropCollection(c.name);

  const Store = require('../src/models/Store');
  const DanceStyle = require('../src/models/DanceStyle');
  const Coach = require('../src/models/Coach');  // createBooking populate coach_id 需要注册该模型
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const Schedule = require('../src/models/Schedule');
  const Waitlist = require('../src/models/Waitlist');
  const packageService = require('../src/services/package.service');
  const bookingService = require('../src/services/booking.service');
  const preMemberService = require('../src/services/preMember.service');

  const store = await Store.create({ name: '冒烟门店', address: '测试街1号', phone: '10000000000' });
  const style = await DanceStyle.create({ name: '冒烟舞种' });
  const coach = await Coach.create({ name: '冒烟教练', store_ids: [store._id] });
  const admin = await User.create({
    username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin',
    user_type: 'admin', member_status: 'official', store_ids: [],
  });
  const token = jwt.sign({ id: admin._id.toString(), role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  let seq = 0;
  async function makeMember() {
    seq += 1;
    return User.create({
      openid: `smoke-weekday-${Date.now()}-${seq}`,
      real_name: `会员${seq}`, phone: `138000${String(10000 + seq).slice(-5)}`, gender: 1,
      member_status: 'official', user_type: 'member', store_id: store._id, info_completed: true,
    });
  }
  // 开课时间 20:00，确保未开课；booking_deadline 0 兜底（若当天已过截止则属补约路径，同样被测）
  async function makeSchedule(dateStr) {
    return Schedule.create({
      coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
      date: dateStr, start_time: '20:00', end_time: '21:15',
      max_bookings: 20, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30, credits_cost: 1,
    });
  }
  function pkg(user, fields) {
    return UserPackage.create({
      user_id: user._id, store_id: store._id, package_type: 'count_card',
      total_credits: 10, remaining_credits: 10, created_by: admin._id,
      is_activated: true, status: 'active', ...fields,
    });
  }

  // ---- [1] 创建/更新持久化与规范化 ----
  console.log('\n[1] createPackage / updatePackage');
  {
    const m = await makeMember();
    const created = await packageService.createPackage({
      user_id: m._id, store_id: store._id, package_type: 'count_card', total_credits: 10,
      weekday_limit: [3, 1, 9, 1], activate_mode: 'active', start_date: '2026-01-01', end_date: '2027-01-01',
    }, admin._id);
    check('规范化：去重升序、过滤非法值', JSON.stringify(created.weekday_limit) === '[1,3]', created.weekday_limit);

    const updated = await packageService.updatePackage(created._id, { weekday_limit: [0, 6] }, admin._id);
    check('更新 weekday_limit 生效', updated.weekday_limit.length === 2 && updated.weekday_limit.includes(0), updated.weekday_limit);
    const normalized = await packageService.updatePackage(created._id, { weekday_limit: 'bad' }, admin._id);
    check('非法输入 → 空数组（整周可用）', Array.isArray(normalized.weekday_limit) && normalized.weekday_limit.length === 0, normalized.weekday_limit);
  }

  // ---- [2] 会员自助预约：拦截 / 放行 / 多套餐自动选择 ----
  console.log('\n[2] createBooking 星期拦截');
  {
    const m1 = await makeMember();
    await pkg(m1, { weekday_limit: [1, 3] });  // 仅周一/周三
    const mondaySchedule = await makeSchedule(nextWeekday(1));
    const tuesdaySchedule = await makeSchedule(nextWeekday(2));
    const ok = await bookingService.createBooking(m1._id, mondaySchedule._id);
    check('可用日（周一）预约成功', ok && ok.booking && ok.booking.status === 'booked', ok && ok.booking && ok.booking.status);
    await expectThrow('受限日（周二）拦截并提示可用星期', () => bookingService.createBooking(m1._id, tuesdaySchedule._id), '仅可在');

    const m2 = await makeMember();
    await pkg(m2, { package_type: 'time_card', total_credits: 10002, remaining_credits: 10002, weekday_limit: [1] });   // 时间卡仅周一
    const m2CountCard = await pkg(m2, {});                               // 次卡整周可用
    const sundaySchedule = await makeSchedule(nextWeekday(0));
    const ok2 = await bookingService.createBooking(m2._id, sundaySchedule._id);
    check('多套餐：周日预约成功', ok2 && ok2.booking && ok2.booking.status === 'booked', ok2 && ok2.booking && ok2.booking.status);
    check('选中的是次卡（避开仅周一的时间卡）', ok2 && String(ok2.usedPackage._id) === String(m2CountCard._id), ok2 && ok2.usedPackage && ok2.usedPackage._id);

    const m3 = await makeMember();
    await UserPackage.create({
      user_id: m3._id, store_id: store._id, package_type: 'count_card',
      total_credits: 10, remaining_credits: 10, created_by: admin._id,
      is_activated: false, status: 'pending', weekday_limit: [1],
    });
    const ok3 = await bookingService.createBooking(m3._id, mondaySchedule._id);
    check('待激活套餐可用日自动激活并预约', ok3 && ok3.booking && ok3.booking.status === 'booked', !!ok3);
    const reloaded = await UserPackage.findOne({ user_id: m3._id });
    check('套餐已激活', reloaded.status === 'active' && reloaded.is_activated, reloaded.status);
  }

  // ---- [3] 候补：加入拦截 / 转正不受限 ----
  console.log('\n[3] joinWaitlist / promoteWaitlist');
  {
    const m4 = await makeMember();
    await pkg(m4, { weekday_limit: [1] });
    const tuesdaySchedule = await makeSchedule(nextWeekday(2));
    await expectThrow('候补加入：受限日拦截', () => bookingService.joinWaitlist(m4._id, tuesdaySchedule._id), '仅可在');

    // 管理端候补转正不受星期限制（课程满员场景）
    // 注意：joinWaitlist 现在会拦受限日，故这里直接种子化候补记录，
    // 模拟"会员排队后才被设置星期限制"的历史候补
    const m5 = await makeMember();
    await pkg(m5, { weekday_limit: [1] });
    const fullSchedule = await Schedule.create({
      coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
      date: nextWeekday(2), start_time: '20:00', end_time: '21:15',
      max_bookings: 1, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30, credits_cost: 1,
    });
    await Waitlist.create({
      user_id: m5._id, schedule_id: fullSchedule._id, store_id: store._id,
      status: 'waiting', position: 1,
      course_name: '冒烟课程', schedule_date: fullSchedule.date,
      start_time: '20:00', end_time: '21:15',
      coach_name: '冒烟教练', store_name: '冒烟门店',
    });
    const wl = await Waitlist.findOne({ user_id: m5._id, schedule_id: fullSchedule._id });
    await bookingService.promoteWaitlist(wl._id, admin._id);
    const Booking = require('../src/models/Booking');
    const promoted = await Booking.findOne({ user_id: m5._id, schedule_id: fullSchedule._id, status: 'booked' });
    check('管理端转正不受星期限制', !!promoted, !!promoted);
  }

  // ---- [3.5] 可用时段（双边界）----
  console.log('\n[3.5] createBooking 可用时段拦截');
  {
    const m6 = await makeMember();
    await pkg(m6, { usable_after: '18:00' });   // 仅 18:00 后
    const early = await Schedule.create({
      coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
      date: nextWeekday(3), start_time: '10:00', end_time: '11:15',
      max_bookings: 20, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30, credits_cost: 1,
    });
    const late = await Schedule.create({
      coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
      date: nextWeekday(3), start_time: '18:00', end_time: '19:15',
      max_bookings: 20, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30, credits_cost: 1,
    });
    await expectThrow('时段前（10:00）拦截', () => bookingService.createBooking(m6._id, early._id), '仅可预约');
    const okLate = await bookingService.createBooking(m6._id, late._id);
    check('边界含等于（18:00 开课）放行', okLate && okLate.booking && okLate.booking.status === 'booked', !!okLate);

    const m7 = await makeMember();
    await pkg(m7, { usable_before: '20:30', usable_after: '18:00' });  // 双边界
    const inWin = await Schedule.create({
      coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
      date: nextWeekday(4), start_time: '19:30', end_time: '20:45',
      max_bookings: 20, min_bookings: 1, current_bookings: 0,
      status: 'available', booking_deadline: 0, cancel_deadline: 30, credits_cost: 1,
    });
    const okWin = await bookingService.createBooking(m7._id, inWin._id);
    check('双边界窗口内（19:30）放行', okWin && okWin.booking && okWin.booking.status === 'booked', !!okWin);

    const m8 = await makeMember();
    await UserPackage.create({
      user_id: m8._id, store_id: store._id, package_type: 'count_card',
      total_credits: 10, remaining_credits: 10, created_by: admin._id,
      is_activated: false, status: 'pending', usable_before: '20:30',
    });
    const ok8 = await bookingService.createBooking(m8._id, early._id);
    check('待激活套餐时段过滤后自动激活并预约（10:00 ≤ 20:30）', ok8 && ok8.booking && ok8.booking.status === 'booked', !!ok8);

    // 候补加入：时段拦截
    const m9 = await makeMember();
    await pkg(m9, { usable_before: '12:00' });
    await expectThrow('候补加入：时段外拦截', () => bookingService.joinWaitlist(m9._id, late._id), '仅可预约');

    // normalizeTimeLimit：双边界倒置报错
    await expectThrow('双边界倒置（后≥前）报错', () => packageService.createPackage({
      user_id: m9._id, store_id: store._id, package_type: 'count_card', total_credits: 10,
      usable_before: '10:00', usable_after: '18:00', activate_mode: 'active', start_date: '2026-01-01', end_date: '2027-01-01',
    }, admin._id), '时段后');

    // 多套餐或：受限时间卡 + 不限次卡 → 上午课自动走次卡
    const m10 = await makeMember();
    await pkg(m10, { package_type: 'time_card', total_credits: 10002, remaining_credits: 10002, usable_after: '18:00' });
    const m10CountCard = await pkg(m10, {});
    const ok10 = await bookingService.createBooking(m10._id, early._id);
    check('多套餐：上午课自动选用不限时段的次卡', ok10 && ok10.booking && String(ok10.usedPackage._id) === String(m10CountCard._id), ok10 && ok10.usedPackage);
  }

  // ---- [4] 批量导入 16 列模板 ----
  console.log('\n[4] 导入模板：可用星期解析');
  {
    const xlsx = require('xlsx');
    const rows = [
      ['序号', '门店名称', '会员姓名', '预留手机号', '性别', '套餐类型', '激活方式', '有效期开始日期', '有效期结束日期', '次卡总次数', '时间卡周期限制方式', '时间卡限制次数', '附加门店（用逗号分隔）', '舞种限制（用逗号分隔，留空=不限）', '可用星期（用逗号分隔，如：周一,周三；留空=整周）', '可用时段（如：20:30前 / 18:00后 / 18:00后,22:30前；留空=不限）', '备注'],
      [1, '冒烟门店', '导入甲', '13811112222', '女', '次卡', '已激活', '2026-01-01', '2027-01-01', '20', '', '', '', '', '周一,周三', '20:30前', ''],
      [2, '冒烟门店', '导入乙', '13811113333', '男', '次卡', '已激活', '2026-01-01', '2027-01-01', '20', '', '', '', '', '周八', '', '非法星期'],
      [3, '冒烟门店', '导入丙', '13811114444', '女', '次卡', '已激活', '2026-01-01', '2027-01-01', '20', '', '', '', '', '', '18:00后,22:30前', '双边界'],
      [4, '冒烟门店', '导入丁', '13811115555', '女', '次卡', '已激活', '2026-01-01', '2027-01-01', '20', '', '', '', '', '', '25:00后', '非法时段'],
    ];
    const ws = xlsx.utils.aoa_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '预建档导入模板');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');
    const res = await fetch(`${BASE}/pre-members/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    const data = json.data || {};
    check('导入接口 200', res.status === 200, { status: res.status, json });

    const okRow = (data.validRows || []).find(r => r.real_name === '导入甲');
    check('周一,周三 → [1,3]', okRow && JSON.stringify(okRow._weekday_limit) === '[1,3]', okRow && okRow._weekday_limit);
    const okTime = (data.validRows || []).find(r => r.real_name === '导入甲');
    check('可用时段「20:30前」解析', okTime && okTime._time_limit && okTime._time_limit.usable_before === '20:30' && okTime._time_limit.usable_after === '', okTime && okTime._time_limit);
    const dualRow = (data.validRows || []).find(r => r.real_name === '导入丙');
    check('双边界「18:00后,22:30前」解析', dualRow && dualRow._time_limit && dualRow._time_limit.usable_after === '18:00' && dualRow._time_limit.usable_before === '22:30', dualRow && dualRow._time_limit);
    const badTime = (data.errors || []).find(e => String(e.reason).includes('可用时段'));
    check('非法时段「25:00后」按行报错', !!badTime, data.errors);
    const badRow = (data.errors || []).find(e => String(e.reason).includes('可用星期'));
    check('非法星期「周八」按行报错', !!badRow, data.errors);
  }

  console.log(`\n===== 冒烟结果：${passed} 通过, ${failed} 失败 =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('冒烟脚本异常:', err);
  process.exit(1);
});
