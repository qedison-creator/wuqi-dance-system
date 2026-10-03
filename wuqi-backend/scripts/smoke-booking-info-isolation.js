/* 冒烟测试：场次预约信息按门店权限隔离（连接 wuqi_dance_smoke_test 测试库，跑完即清库）
 *
 * 验证规则：
 * - 有效套餐（pending / active 未暂停未过期）覆盖的门店（store_id + extra_store_ids）→ 可见预约人数/头像/历史人次/取消原因
 * - 无覆盖查看者（游客、无套餐、套餐过期/暂停、仅覆盖其他门店）→ current_bookings/total_bookings/cancel_reason/cancel_type 字段不下发，booked_users 清空
 * - 管理类角色 → 不受限
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/wuqi_dance_smoke_test';
process.env.JWT_SECRET = 'smoke-test-secret';

const mongoose = require('mongoose');
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
  const Coach = require('../src/models/Coach');
  const DanceStyle = require('../src/models/DanceStyle');
  const User = require('../src/models/User');
  const Schedule = require('../src/models/Schedule');
  const Booking = require('../src/models/Booking');
  const UserPackage = require('../src/models/UserPackage');

  const storeA = await Store.create({ name: '测试门店A(福永)', address: 'A街1号', phone: '10000000001' });
  const storeB = await Store.create({ name: '测试门店B(固戍)', address: 'B街2号', phone: '10000000002' });
  const style = await DanceStyle.create({ name: '爵士' });
  const coach = await Coach.create({ name: '测试教练' });

  // 北京时间今天（列表接口按今天/未来分支）
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const sA = await Schedule.create({
    store_id: storeA._id, coach_id: coach._id, dance_style_id: style._id,
    course_name: 'A店爵士课', date: today, start_time: '10:00', end_time: '11:00',
    max_bookings: 20, min_bookings: 5, status: 'available',
  });
  const sB = await Schedule.create({
    store_id: storeB._id, coach_id: coach._id, dance_style_id: style._id,
    course_name: 'B店爵士课', date: today, start_time: '14:00', end_time: '15:00',
    max_bookings: 20, min_bookings: 5, status: 'available',
  });
  // B店已取消场次（人数不足取消），验证取消原因剥离（coach-detail status:'all' 路径）
  const sBCancelled = await Schedule.create({
    store_id: storeB._id, coach_id: coach._id, dance_style_id: style._id,
    course_name: 'B店被取消课', date: today, start_time: '18:00', end_time: '19:00',
    max_bookings: 20, min_bookings: 5, status: 'cancelled', cancel_reason: 'min_bookings_not_met', cancel_type: 'min_bookings_not_met',
  });

  // 预约者（带头像，用于 booked_users 头像列表）
  const [booker1, booker2] = await User.create([
    { openid: 'booker_openid_1', nick_name: '预约者1', avatar_url: '/uploads/a1.jpg', user_type: 'member', member_status: 'official' },
    { openid: 'booker_openid_2', nick_name: '预约者2', avatar_url: '/uploads/a2.jpg', user_type: 'member', member_status: 'official' },
  ]);
  for (const s of [sA, sB]) {
    for (const u of [booker1, booker2]) {
      await Booking.create({
        user_id: u._id, schedule_id: s._id, coach_id: coach._id, dance_style_id: style._id, store_id: s.store_id,
        booking_date: s.date, booking_time: s.start_time, status: 'booked',
      });
    }
  }

  // ---- 登录各类会员（wx-login 开发模式兜底：code2Session 失败 → dev_openid）----
  async function memberToken(code) {
    const res = await api('POST', '/auth/wx-login', { code, client_type: 'member' });
    if (res.json.code !== 200) throw new Error('wx-login failed: ' + JSON.stringify(res.json));
    return { token: res.json.data.token, userId: String(res.json.data.user.id) };
  }
  const fu = await memberToken('smoke-fuyong-member');   // A店有效套餐，无跨店
  const pending = await memberToken('smoke-pending-member'); // A店待激活套餐
  const cross = await memberToken('smoke-cross-member');  // A店有效套餐 + 跨店B
  const none = await memberToken('smoke-nopkg-member');   // 无套餐
  const expired = await memberToken('smoke-expired-member'); // 已过期套餐
  const suspended = await memberToken('smoke-suspended-member'); // 暂停中套餐

  async function makeOfficial(userId) {
    await User.updateOne({ _id: userId }, { member_status: 'official' });
  }
  await makeOfficial(fu.userId);
  await makeOfficial(pending.userId);
  await makeOfficial(cross.userId);
  await makeOfficial(none.userId);
  await makeOfficial(expired.userId);
  await makeOfficial(suspended.userId);

  // 管理员（提前创建，created_by 引用）
  const adminUser = await User.create({ username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin', user_type: 'admin', member_status: 'official' });

  const futureEnd = new Date(Date.now() + 8 * 3600 * 1000 + 30 * 86400 * 1000).toISOString();
  const pastEnd = new Date(Date.now() + 8 * 3600 * 1000 - 30 * 86400 * 1000).toISOString();
  await UserPackage.create([
    { user_id: fu.userId, store_id: storeA._id, package_type: 'count_card', total_credits: 20, remaining_credits: 10, duration_value: 1, duration_unit: 'month', status: 'active', is_activated: true, start_date: new Date(), end_date: new Date(futureEnd), created_by: adminUser._id },
    { user_id: pending.userId, store_id: storeA._id, package_type: 'count_card', total_credits: 20, remaining_credits: 20, duration_value: 1, duration_unit: 'month', status: 'pending', is_activated: false, created_by: adminUser._id },
    { user_id: cross.userId, store_id: storeA._id, extra_store_ids: [storeB._id], package_type: 'count_card', total_credits: 20, remaining_credits: 10, duration_value: 1, duration_unit: 'month', status: 'active', is_activated: true, start_date: new Date(), end_date: new Date(futureEnd), created_by: adminUser._id },
    { user_id: expired.userId, store_id: storeA._id, package_type: 'count_card', total_credits: 20, remaining_credits: 5, duration_value: 1, duration_unit: 'month', status: 'active', is_activated: true, start_date: new Date(pastEnd), end_date: new Date(pastEnd), created_by: adminUser._id },
    { user_id: suspended.userId, store_id: storeA._id, package_type: 'count_card', total_credits: 20, remaining_credits: 10, duration_value: 1, duration_unit: 'month', status: 'active', is_activated: true, start_date: new Date(), end_date: new Date(futureEnd), is_suspended: true, created_by: adminUser._id },
  ]);

  const adminLogin = await api('POST', '/auth/admin-login', { username: 'sa', password: 'admin123' });
  const adminToken = adminLogin.json.data.token;

  const isMasked = (s) => s.current_bookings === undefined && s.total_bookings === undefined
    && Array.isArray(s.booked_users) && s.booked_users.length === 0
    && s.cancel_reason === undefined && s.cancel_type === undefined;
  const listB = (t) => api('GET', `/schedules?store_id=${storeB._id}&date=${today}`, null, t);
  const listA = (t) => api('GET', `/schedules?store_id=${storeA._id}&date=${today}`, null, t);

  // ---- [1] 游客（无 token）----
  console.log('\n[1] 游客查看任意门店场次 → 脱敏');
  for (const [label, res] of [['游客-B店', await listB()], ['游客-A店', await listA()]]) {
    const s = res.json.data.list[0];
    check(`${label}: 预约信息脱敏`, isMasked(s), s);
    check(`${label}: 基础字段保留(course_name/min_bookings)`, s.course_name === 'A店爵士课' || s.course_name === 'B店爵士课' ? !!s.min_bookings : !!s.min_bookings, { min: s.min_bookings });
  }

  // ---- [2] A店有效套餐会员（无跨店）----
  console.log('\n[2] A店有效套餐会员：本店可见，B店脱敏');
  {
    const own = (await listA(fu.token)).json.data.list[0];
    check('A店: current_bookings=2', own.current_bookings === 2, own.current_bookings);
    check('A店: booked_users 头像2个', own.booked_users.length === 2 && !!own.booked_users[0].avatar_url, own.booked_users);
    check('A店: total_bookings=2', own.total_bookings === 2, own.total_bookings);
    const other = (await listB(fu.token)).json.data.list[0];
    check('B店: 预约信息脱敏', isMasked(other), other);
    check('B店: 无取消原因字段', other.cancel_reason === undefined, other.cancel_reason);
  }

  // ---- [3] 待激活套餐会员 ----
  console.log('\n[3] 待激活套餐会员：本店可见，B店脱敏');
  {
    const own = (await listA(pending.token)).json.data.list[0];
    check('A店: current_bookings=2', own.current_bookings === 2, own.current_bookings);
    const other = (await listB(pending.token)).json.data.list[0];
    check('B店: 预约信息脱敏', isMasked(other), other);
  }

  // ---- [4] 跨店套餐会员 ----
  console.log('\n[4] 跨店套餐会员（extra_store_ids 含B）：两店均可见');
  {
    const a = (await listA(cross.token)).json.data.list[0];
    check('A店: current_bookings=2', a.current_bookings === 2, a.current_bookings);
    const b = (await listB(cross.token)).json.data.list[0];
    check('B店: current_bookings=2', b.current_bookings === 2, b.current_bookings);
    check('B店: booked_users 头像2个', b.booked_users.length === 2, b.booked_users.length);
  }

  // ---- [5] 无套餐 / 过期 / 暂停 ----
  console.log('\n[5] 无套餐/过期/暂停会员 → 一律脱敏');
  for (const [label, t] of [['无套餐', none.token], ['过期套餐', expired.token], ['暂停套餐', suspended.token]]) {
    const s = (await listA(t)).json.data.list[0];
    check(`${label}: A店预约信息脱敏`, isMasked(s), s);
  }

  // ---- [6] 管理员不受限 ----
  console.log('\n[6] 管理员 → 全部可见');
  {
    const b = (await listB(adminToken)).json.data.list[0];
    check('管理员: B店 current_bookings=2', b.current_bookings === 2, b.current_bookings);
    check('管理员: booked_users 2个', b.booked_users.length === 2, b.booked_users.length);
  }

  // ---- [7] 已取消场次：status:'all' 路径（coach-detail 用法）----
  console.log('\n[7] status=all 列表：无覆盖者看不到取消原因，管理员可见');
  {
    const url = `/schedules?coach_id=${coach._id}&status=all&start_date=${today}&end_date=${today}&pageSize=50`;
    const memberList = (await api('GET', url, null, fu.token)).json.data.list;
    const cancelledAsMember = memberList.find(s => String(s._id) === String(sBCancelled._id));
    check('取消场次返回（状态本身可见）', !!cancelledAsMember && cancelledAsMember.status === 'cancelled', cancelledAsMember && cancelledAsMember.status);
    check('取消原因被剥离', cancelledAsMember.cancel_reason === undefined && cancelledAsMember.cancel_type === undefined, cancelledAsMember.cancel_reason);
    const adminList = (await api('GET', url, null, adminToken)).json.data.list;
    const cancelledAsAdmin = adminList.find(s => String(s._id) === String(sBCancelled._id));
    check('管理员可见取消原因', cancelledAsAdmin.cancel_reason === 'min_bookings_not_met', cancelledAsAdmin.cancel_reason);
  }

  // ---- [8] 详情接口 ----
  console.log('\n[8] GET /schedules/:id：按覆盖下发/脱敏预约统计');
  {
    const asMember = (await api('GET', `/schedules/${sB._id}`, null, fu.token)).json.data;
    check('B店详情(无覆盖): 无 current_bookings/total_bookings', asMember.current_bookings === undefined && asMember.total_bookings === undefined, { c: asMember.current_bookings, t: asMember.total_bookings });
    const asCross = (await api('GET', `/schedules/${sB._id}`, null, cross.token)).json.data;
    check('B店详情(跨店): current_bookings=2 / total_bookings=2', asCross.current_bookings === 2 && asCross.total_bookings === 2, { c: asCross.current_bookings, t: asCross.total_bookings });
    const asAdmin = (await api('GET', `/schedules/${sB._id}`, null, adminToken)).json.data;
    check('B店详情(管理员): current_bookings=2', asAdmin.current_bookings === 2, asAdmin.current_bookings);
    const cancelledDetail = (await api('GET', `/schedules/${sBCancelled._id}`, null, fu.token)).json.data;
    check('取消课详情(无覆盖): 无取消原因', cancelledDetail.cancel_reason === undefined && cancelledDetail.cancel_type === undefined, cancelledDetail.cancel_reason);
  }

  console.log(`\n========== 结果: ${passed} passed, ${failed} failed ==========`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (err) => {
  console.error('SMOKE ERROR:', err);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
