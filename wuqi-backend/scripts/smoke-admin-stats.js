/* 冒烟测试：管理端统计三项改动
 *  1. /home/admin 新增 resident_members（在籍会员口径）
 *  2. GET /members/filter-counts 八类筛选计数
 *  3. filter-counts 与 /members 列表 total 逐类别一致性（口径镜像校验）
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。
 * 前置：后端已以同库同 JWT_SECRET 启动在 3900 端口。
 * 用法：node scripts/smoke-admin-stats.js
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/wuqi_dance_smoke_test';
process.env.JWT_SECRET = 'smoke-test-secret';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const BASE = 'http://localhost:3900/api/v1';

async function api(method, path, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');

  const storeA = await Store.create({ name: '冒烟门店A', address: 'A街1号', phone: '10000000001' });
  const storeB = await Store.create({ name: '冒烟门店B', address: 'B街2号', phone: '10000000002' });
  const admin = await User.create({
    username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin',
    user_type: 'admin', member_status: 'official', store_ids: [],
  });
  const token = jwt.sign({ id: admin._id.toString(), role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const now = dayjs();
  const futureEnd = now.add(30, 'day').toDate();
  const pastEnd = now.subtract(10, 'day').toDate();

  let seq = 0;
  async function makeMember(storeId) {
    seq += 1;
    return User.create({
      openid: `smoke-stats-${Date.now()}-${seq}`,
      real_name: `会员${seq}`,
      member_status: 'official',
      user_type: 'member',
      store_id: storeId,
    });
  }
  function pkg(user, fields) {
    return UserPackage.create({
      user_id: user._id,
      store_id: user.store_id,
      package_type: 'count_card',
      total_credits: 10,
      remaining_credits: 10,
      created_by: admin._id,
      is_activated: true,
      status: 'active',
      start_date: now.toDate(),
      end_date: futureEnd,
      ...fields,
    });
  }

  // 门店A种子（见各类别预期）
  const m1 = await makeMember(storeA._id); // 时间卡有效
  await pkg(m1, { package_type: 'time_card', total_credits: 10002, remaining_credits: 10002 });
  const m2 = await makeMember(storeA._id); // 次卡有次
  await pkg(m2, { remaining_credits: 3 });
  const m3 = await makeMember(storeA._id); // 次卡 active 但次数 0 → 不算在籍、算使用中
  await pkg(m3, { remaining_credits: 0 });
  const m4 = await makeMember(storeA._id); // 时间卡停卡中 → 算在籍、算停卡
  await pkg(m4, { package_type: 'time_card', total_credits: 10002, remaining_credits: 10002, is_suspended: true, suspended_at: now.toDate() });
  const m5 = await makeMember(storeA._id); // 次卡已过期
  await pkg(m5, { status: 'expired', end_date: pastEnd, remaining_credits: 5 });
  const m6 = await makeMember(storeA._id); // 次卡已用完
  await pkg(m6, { status: 'exhausted', remaining_credits: 0 });
  const m7 = await makeMember(storeA._id); // 待激活
  await pkg(m7, { status: 'pending', is_activated: false });
  const m8 = await makeMember(storeA._id); // 无任何套餐
  const m9 = await makeMember(storeA._id); // 过期时间卡 + 有效次卡 → 算在籍/使用中，不算过期
  await pkg(m9, { package_type: 'time_card', total_credits: 10002, remaining_credits: 10002, status: 'expired', end_date: pastEnd });
  await pkg(m9, { remaining_credits: 5 });
  const m10 = await makeMember(storeB._id); // B 店会员，时间卡跨店授权到 A → A 店 all/cross_store 计入
  await pkg(m10, { package_type: 'time_card', total_credits: 10002, remaining_credits: 10002, extra_store_ids: [storeA._id] });

  // ---- [1] /home/admin 在籍会员 ----
  console.log('\n[1] GET /home/admin?store_id=A（在籍会员口径）');
  const homeA = await api('GET', `/home/admin?store_id=${storeA._id}`, token);
  check('接口 200', homeA.status === 200, { status: homeA.status });
  const statsA = homeA.json.data && homeA.json.data.stats || {};
  check('会员总数=9（A 店正式会员，跨店会员不计）', statsA.total_members === 9, statsA.total_members);
  // 在籍 = m1(时间卡有效) + m2(次卡有次) + m4(停卡算在籍) + m9(有效次卡) = 4
  check('在籍会员=4', statsA.resident_members === 4, statsA.resident_members);
  const homeB = await api('GET', `/home/admin?store_id=${storeB._id}`, token);
  const statsB = homeB.json.data && homeB.json.data.stats || {};
  check('B 店会员总数=1', statsB.total_members === 1, statsB.total_members);
  check('B 店在籍会员=1', statsB.resident_members === 1, statsB.resident_members);

  // ---- [2] /members/filter-counts 八类计数 ----
  console.log('\n[2] GET /members/filter-counts?store_id=A');
  const fc = await api('GET', `/members/filter-counts?store_id=${storeA._id}`, token);
  check('接口 200', fc.status === 200, { status: fc.status });
  const counts = fc.json.data && fc.json.data.counts || {};
  const expectedA = {
    all: 10,          // A 店 9 人 + 跨店会员 m10（有命中 A 的 active 套餐）
    no_package: 1,    // m8
    active: 5,        // m1 m2 m3 m9 + 跨店会员 m10（其套餐覆盖 A 店，口径与列表一致）
    cross_store: 1,   // m10
    unactivated: 1,   // m7
    suspended: 1,     // m4
    expired: 1,       // m5（m9 有有效套餐排除）
    exhausted: 1,     // m6
  };
  for (const key of Object.keys(expectedA)) {
    check(`counts.${key}=${expectedA[key]}`, counts[key] === expectedA[key], counts[key]);
  }

  // ---- [3] 各类别计数与列表 total 一致性（口径镜像校验） ----
  console.log('\n[3] filter-counts 与 /members 列表 total 一致性');
  const listParams = {
    all: '',
    no_package: '&no_package=true',
    active: '&package_active=true',
    cross_store: '&cross_store=true',
    unactivated: '&package_pending=true',
    suspended: '&package_suspended=true',
    expired: '&package_expired=true',
    exhausted: '&package_exhausted=true',
  };
  for (const [key, extra] of Object.entries(listParams)) {
    const res = await api('GET', `/members?store_id=${storeA._id}&member_status=official&page=1&pageSize=5${extra}`, token);
    const total = res.json.data && res.json.data.total;
    check(`列表 total === counts.${key}`, total === counts[key], { listTotal: total, count: counts[key] });
  }

  console.log(`\n===== 冒烟结果：${passed} 通过, ${failed} 失败 =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('冒烟脚本异常:', err);
  process.exit(1);
});
