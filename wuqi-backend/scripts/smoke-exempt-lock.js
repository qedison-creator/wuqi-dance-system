/* 冒烟测试：豁免取消双重拦截（人数保底 / 管理员禁用 / 不稳定补约堵漏）+ 单节开关接口
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。
 * 前置：后端已以同库同 JWT_SECRET 启动在 3900 端口（用例 8 走 HTTP 验证新路由）。
 * 用法：node scripts/smoke-exempt-lock.js
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

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

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

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  for (const c of await db.listCollections().toArray()) await db.dropCollection(c.name);

  const Store = require('../src/models/Store');
  const DanceStyle = require('../src/models/DanceStyle');
  const Coach = require('../src/models/Coach');
  const User = require('../src/models/User');
  const Schedule = require('../src/models/Schedule');
  const Booking = require('../src/models/Booking');
  const bookingService = require('../src/services/booking.service');
  const scheduleService = require('../src/services/schedule.service');

  const store = await Store.create({ name: '冒烟门店', address: '测试街1号', phone: '10000000000' });
  const style = await DanceStyle.create({ name: '冒烟舞种' });
  const coach = await Coach.create({ name: '冒烟教练', store_ids: [store._id] });
  const superAdmin = await User.create({
    username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin',
    user_type: 'admin', member_status: 'official', store_ids: [],
  });

  let userSeq = 0;
  async function makeUser() {
    userSeq += 1;
    return User.create({
      openid: `smoke-exempt-${Date.now()}-${userSeq}`,
      real_name: `会员${userSeq}`,
      member_status: 'official',
      exemption_count: 2,
    });
  }

  // 开课前 startInMin 分钟开课的排课；cancelDeadline 分钟为豁免窗口线
  async function makeSchedule({ startInMin = 30, cancelDeadline = 60, bookingDeadline = 120, minBookings = 5, locked = false } = {}) {
    const start = dayjs().tz(BJ).add(startInMin, 'minute');
    return Schedule.create({
      coach_id: coach._id,
      dance_style_id: style._id,
      store_id: store._id,
      date: start.format('YYYY-MM-DD'),
      start_time: start.format('HH:mm'),
      end_time: start.add(75, 'minute').format('HH:mm'),
      max_bookings: 20,
      min_bookings: minBookings,
      current_bookings: 0,
      status: 'available',
      booking_deadline: bookingDeadline,
      cancel_deadline: cancelDeadline,
      credits_cost: 1,
      exempt_cancel_locked: locked,
    });
  }

  async function addBooking(user, schedule, opts = {}) {
    const booking = await Booking.create({
      user_id: user._id,
      schedule_id: schedule._id,
      coach_id: schedule.coach_id,
      dance_style_id: schedule.dance_style_id,
      store_id: schedule.store_id,
      booking_date: schedule.date,
      booking_time: schedule.start_time,
      status: 'booked',
      credits_deducted: 1,
      is_late_booking: !!opts.late,
      ...(opts.createdMinutesAgo !== undefined
        ? { created_at: dayjs().subtract(opts.createdMinutesAgo, 'minute').toDate() }
        : {}),
    });
    // 镜像线上 createBooking 行为：同步维护 current_bookings 计数器
    await Schedule.findByIdAndUpdate(schedule._id, { $inc: { current_bookings: 1 } });
    return booking;
  }

  async function expectThrow(name, fn, keyword) {
    try {
      await fn();
      check(name, false, '未抛出错误');
    } catch (err) {
      check(name, err.message && err.message.includes(keyword), { actual: err.message });
    }
  }

  // ---- [1] 人数保底：5/5（恰好最低成班）→ 豁免取消被拦 ----
  console.log('\n[1] 人数保底：有效人数=最低成班人数 → 拦截 min_bookings');
  {
    const sched = await makeSchedule({ minBookings: 5 });
    const users = [await makeUser(), await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    const bookings = [];
    for (const u of users) bookings.push(await addBooking(u, sched));
    await expectThrow('cancelBooking 被拦截', () => bookingService.cancelBooking(users[0]._id, bookings[0]._id), '最低成班人数');
    const detail = await bookingService.getBookingById(bookings[0]._id);
    check('cancel_phase=exempt_blocked', detail.cancel_phase === 'exempt_blocked', detail.cancel_phase);
    check('exempt_block_reason=min_bookings', detail.exempt_block_reason === 'min_bookings', detail.exempt_block_reason);
    check('can_cancel=false', detail.can_cancel === false, detail.can_cancel);
    const u1 = await User.findById(users[0]._id);
    check('豁免次数未扣', u1.exemption_count === 2, u1.exemption_count);
    const b1 = await Booking.findById(bookings[0]._id);
    check('预约仍为 booked', b1.status === 'booked', b1.status);
  }

  // ---- [2] 补员到 6 人 → 豁免取消放行，扣次数退课时 ----
  console.log('\n[2] 有效人数 > 最低成班人数 → 豁免取消放行');
  {
    const sched = await makeSchedule({ minBookings: 5 });
    const users = [];
    for (let i = 0; i < 6; i += 1) users.push(await makeUser());
    const bookings = [];
    for (const u of users) bookings.push(await addBooking(u, sched));
    const detailBefore = await bookingService.getBookingById(bookings[0]._id);
    check('cancel_phase=exempt（可取消）', detailBefore.cancel_phase === 'exempt' && detailBefore.can_cancel === true, detailBefore.cancel_phase);
    const cancelled = await bookingService.cancelBooking(users[0]._id, bookings[0]._id);
    check('cancel_type=exempt', cancelled.cancel_type === 'exempt', cancelled.cancel_type);
    const u1 = await User.findById(users[0]._id);
    check('豁免次数扣 1（2→1）', u1.exemption_count === 1, u1.exemption_count);
    check('课时已退', cancelled.credits_refunded === 1, cancelled.credits_refunded);
    const fresh = await Schedule.findById(sched._id);
    check('人数 -1（6→5）', fresh.current_bookings === 5, fresh.current_bookings);
  }

  // ---- [3] 不稳定补约堵漏：窗口内补约不计入保底 ----
  console.log('\n[3] 漏洞堵截：5 正常 + 1 窗口内补约 → 有效保底 5 → 拦截；补约满 5 分钟后放行');
  {
    const sched = await makeSchedule({ minBookings: 5 });
    const users = [];
    for (let i = 0; i < 6; i += 1) users.push(await makeUser());
    const bookings = [];
    for (let i = 0; i < 5; i += 1) bookings.push(await addBooking(users[i], sched));
    bookings.push(await addBooking(users[5], sched, { late: true }));
    await expectThrow('补约 5 分钟窗口内：cancelBooking 被拦截', () => bookingService.cancelBooking(users[0]._id, bookings[0]._id), '最低成班人数');
    const detail = await bookingService.getBookingById(bookings[0]._id);
    check('窗口内 phase=exempt_blocked', detail.cancel_phase === 'exempt_blocked' && detail.exempt_block_reason === 'min_bookings', { phase: detail.cancel_phase, reason: detail.exempt_block_reason });
    // 补约超时变稳定名额（created_at 是 Mongoose immutable 字段，走原生驱动绕过）
    await Booking.collection.updateOne(
      { _id: bookings[5]._id },
      { $set: { created_at: dayjs().subtract(6, 'minute').toDate() } }
    );
    const cancelled = await bookingService.cancelBooking(users[0]._id, bookings[0]._id);
    check('补约稳定后豁免取消放行', cancelled.cancel_type === 'exempt', cancelled.cancel_type);
  }

  // ---- [4] 管理员禁用：单节开关拦截与恢复 ----
  console.log('\n[4] 管理员禁用：locked → 拦截 admin_locked；恢复后放行');
  {
    const sched = await makeSchedule({ minBookings: 1, locked: true });
    const u1 = await makeUser();
    const u2 = await makeUser();
    const b1 = await addBooking(u1, sched);
    await addBooking(u2, sched);
    await expectThrow('cancelBooking 被拦截', () => bookingService.cancelBooking(u1._id, b1._id), '不可使用豁免取消');
    const detail = await bookingService.getBookingById(b1._id);
    check('phase=exempt_blocked / reason=admin_locked', detail.cancel_phase === 'exempt_blocked' && detail.exempt_block_reason === 'admin_locked', { phase: detail.cancel_phase, reason: detail.exempt_block_reason });
    await scheduleService.setExemptCancelLock(sched._id, false, superAdmin._id);
    const cancelled = await bookingService.cancelBooking(u1._id, b1._id);
    check('恢复后豁免取消放行', cancelled.cancel_type === 'exempt', cancelled.cancel_type);
  }

  // ---- [5] 快速取消不受影响：5/5 且自己是窗口内补约 → 5 分钟内快速取消成功 ----
  console.log('\n[5] 快速取消通道不受拦截影响');
  {
    const sched = await makeSchedule({ minBookings: 5 });
    const u1 = await makeUser();
    const users = [u1];
    for (let i = 0; i < 4; i += 1) users.push(await makeUser());
    const b1 = await addBooking(u1, sched, { late: true });
    for (let i = 1; i < 5; i += 1) await addBooking(users[i], sched);
    const cancelled = await bookingService.cancelBooking(u1._id, b1._id);
    check('快速取消成功 type=quick', cancelled.cancel_type === 'quick', cancelled.cancel_type);
    const fresh = await User.findById(u1._id);
    check('快速取消不扣豁免次数', fresh.exemption_count === 2, fresh.exemption_count);
  }

  // ---- [6] 正常取消不受影响：5/5 且在 cancel_deadline 前 ----
  console.log('\n[6] 正常取消通道不受拦截影响');
  {
    const sched = await makeSchedule({ startInMin: 90, cancelDeadline: 60, minBookings: 5 });
    const users = [];
    for (let i = 0; i < 5; i += 1) users.push(await makeUser());
    const bookings = [];
    for (const u of users) bookings.push(await addBooking(u, sched));
    const detail = await bookingService.getBookingById(bookings[0]._id);
    check('phase=normal', detail.cancel_phase === 'normal', detail.cancel_phase);
    const cancelled = await bookingService.cancelBooking(users[0]._id, bookings[0]._id);
    check('正常取消成功 type=normal', cancelled.cancel_type === 'normal', cancelled.cancel_type);
    const fresh = await User.findById(users[0]._id);
    check('正常取消不扣豁免次数', fresh.exemption_count === 2, fresh.exemption_count);
  }

  // ---- [7] 开关服务：状态守卫与编辑白名单 ----
  console.log('\n[7] setExemptCancelLock / updateSchedule');
  {
    const sched = await makeSchedule({ minBookings: 1 });
    const locked = await scheduleService.setExemptCancelLock(sched._id, true, superAdmin._id);
    check('开启后 locked=true', locked.exempt_cancel_locked === true, locked.exempt_cancel_locked);
    const unlocked = await scheduleService.setExemptCancelLock(sched._id, false, superAdmin._id);
    check('关闭后 locked=false', unlocked.exempt_cancel_locked === false, unlocked.exempt_cancel_locked);
    const started = await makeSchedule({ startInMin: -10, minBookings: 1 });
    await expectThrow('已开始课程不可设置', () => scheduleService.setExemptCancelLock(started._id, true, superAdmin._id), '课程已开始');
    // 已有预约的排课：updateSchedule 白名单应放行 exempt_cancel_locked
    const sched2 = await makeSchedule({ minBookings: 1 });
    const u1 = await makeUser();
    await addBooking(u1, sched2);
    await scheduleService.updateSchedule(sched2._id, { exempt_cancel_locked: true }, superAdmin._id);
    const fresh = await Schedule.findById(sched2._id);
    check('有预约排课经 updateSchedule 修改白名单字段', fresh.exempt_cancel_locked === true, fresh.exempt_cancel_locked);
  }

  // ---- [8] HTTP 路由：PUT /schedules/:id/exempt-lock ----
  console.log('\n[8] HTTP 新路由（鉴权 + 参数校验 + 开关生效）');
  {
    const token = jwt.sign({ id: superAdmin._id.toString(), role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const sched = await makeSchedule({ minBookings: 1 });
    const on = await api('PUT', `/schedules/${sched._id}/exempt-lock`, { locked: true }, token);
    check('开启返回 200', on.status === 200, { status: on.status, json: on.json });
    check('返回数据 locked=true', on.json.data && on.json.data.exempt_cancel_locked === true, on.json.data);
    const off = await api('PUT', `/schedules/${sched._id}/exempt-lock`, { locked: false }, token);
    check('关闭返回 200 且 locked=false', off.status === 200 && off.json.data.exempt_cancel_locked === false, off.json);
    const bad = await api('PUT', `/schedules/${sched._id}/exempt-lock`, {}, token);
    check('缺 locked 参数返回 400', bad.status === 400, { status: bad.status });
    const noAuth = await api('PUT', `/schedules/${sched._id}/exempt-lock`, { locked: true });
    check('未登录返回 401', noAuth.status === 401, { status: noAuth.status });
  }

  console.log(`\n===== 冒烟结果：${passed} 通过, ${failed} 失败 =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('冒烟脚本异常:', err);
  process.exit(1);
});
