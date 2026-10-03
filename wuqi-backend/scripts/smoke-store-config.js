/* 冒烟测试：教练按门店排序/任教配置（连接 wuqi_dance_smoke_test 测试库，跑完即清库） */
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
    console.log(`  FAIL ${name}${detail ? ' -> ' + JSON.stringify(detail) : ''}`);
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // 清库重置
  for (const c of await db.listCollections().toArray()) await db.dropCollection(c.name);

  const Store = require('../src/models/Store');
  const Coach = require('../src/models/Coach');
  const User = require('../src/models/User');

  const storeA = await Store.create({ name: '测试门店A', address: 'A街1号', phone: '10000000001' });
  const storeB = await Store.create({ name: '测试门店B', address: 'B街2号', phone: '10000000002' });

  const [coachStoreOnly, coachShared, coachHidden] = await Coach.create([
    { name: '门店独占教练', store_ids: [storeA._id], sort_order: 5 },
    { name: '共享教练', store_ids: [], sort_order: 3 },
    { name: '全局隐藏教练', store_ids: [], sort_order: 1, show_on_home: false },
  ]);

  await User.create([
    { username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin', user_type: 'admin', member_status: 'official', store_ids: [] },
    { username: 'mgrA', password: 'admin123', real_name: '店长A', role: 'store_manager', user_type: 'admin', member_status: 'official', store_ids: [storeA._id], permissions: ['coach'] },
    { username: 'mgrB', password: 'admin123', real_name: '店长B', role: 'store_manager', user_type: 'admin', member_status: 'official', store_ids: [storeB._id], permissions: ['coach'] },
  ]);

  // ---- 1. 管理端列表：合并列表 + store_config ----
  console.log('\n[1] GET /coaches/admin?store_id=A（店长A）');
  const loginA = await api('POST', '/auth/admin-login', { username: 'mgrA', password: 'admin123' });
  check('店长A登录', loginA.json.code === 200, loginA.json);
  const tokenA = loginA.json.data.token;

  const listA = await api('GET', `/coaches/admin?store_id=${storeA._id}&pageSize=50`, null, tokenA);
  const namesA = listA.json.data.list.map(c => c.name);
  check('返回合并列表（含本店+共享）', namesA.includes('门店独占教练') && namesA.includes('共享教练'), namesA);
  check('每条附带 store_config', listA.json.data.list.every(c => c.store_config && c.store_config.store_id === String(storeA._id)));
  check('store_config 回退全局排序', listA.json.data.list.find(c => c.name === '共享教练').store_config.sort_order === 3);
  check('configured=false（未单独配置）', listA.json.data.list.every(c => c.store_config.configured === false));

  // ---- 2. 跨店权限 ----
  console.log('\n[2] 店长B 不可配置门店A的教练');
  const loginB = await api('POST', '/auth/admin-login', { username: 'mgrB', password: 'admin123' });
  const tokenB = loginB.json.data.token;
  const cross = await api('PUT', `/coaches/${coachStoreOnly._id}/store-config`, { store_id: String(storeA._id), is_teaching: false }, tokenB);
  check('店长B 配置A店教练被拒', cross.json.code !== 200, cross.json);

  // ---- 3. 单教练任教开关 ----
  console.log('\n[3] PUT /coaches/:id/store-config 关闭共享教练在A店任教');
  const cfgRes = await api('PUT', `/coaches/${coachShared._id}/store-config`, { store_id: String(storeA._id), is_teaching: false }, tokenA);
  check('任教开关保存成功', cfgRes.json.code === 200 && cfgRes.json.data.is_teaching === false, cfgRes.json);
  check('configured=true', cfgRes.json.data.configured === true, cfgRes.json);

  // ---- 4. 会员端首页：隐藏 + 排序 ----
  console.log('\n[4] GET /home/coaches?store_id=A');
  const homeA = await api('GET', `/home/coaches?store_id=${storeA._id}&limit=10`);
  const namesHomeA = homeA.json.data.map(c => c.name);
  check('共享教练（未任教）不在A店会员端', !namesHomeA.includes('共享教练'), namesHomeA);
  check('门店独占教练正常显示', namesHomeA.includes('门店独占教练'), namesHomeA);
  check('全局 show_on_home=false 的教练不显示', !namesHomeA.includes('全局隐藏教练'), namesHomeA);
  check('响应不含 phone 字段', homeA.json.data.every(c => c.phone === undefined));
  const homeB = await api('GET', `/home/coaches?store_id=${storeB._id}&limit=10`);
  check('B店仍显示共享教练（配置按门店隔离）', homeB.json.data.some(c => c.name === '共享教练'), homeB.json.data.map(c => c.name));

  // ---- 5. 批量重排 ----
  console.log('\n[5] PUT /coaches/store-configs/reorder（A店：独占教练在前，共享教练恢复任教并排最后）');
  const restore = await api('PUT', `/coaches/${coachShared._id}/store-config`, { store_id: String(storeA._id), is_teaching: true }, tokenA);
  check('恢复任教成功', restore.json.code === 200, restore.json);
  const reorder = await api('PUT', '/coaches/store-configs/reorder', { store_id: String(storeA._id), coach_ids: [coachStoreOnly._id, coachShared._id] }, tokenA);
  check('重排成功', reorder.json.code === 200 && reorder.json.data.updated === 2, reorder.json);
  const homeA2 = await api('GET', `/home/coaches?store_id=${storeA._id}&limit=10`);
  const namesA2 = homeA2.json.data.map(c => c.name);
  check('会员端按新顺序返回', JSON.stringify(namesA2) === JSON.stringify(['门店独占教练', '共享教练']), namesA2);

  // ---- 6. 管理端列表 store_config 更新 ----
  console.log('\n[6] 管理端列表反映已配置状态');
  const listA2 = await api('GET', `/coaches/admin?store_id=${storeA._id}&pageSize=50`, null, tokenA);
  const sharedCfg = listA2.json.data.list.find(c => c.name === '共享教练');
  check('store_config.configured=true', sharedCfg.store_config.configured === true, sharedCfg.store_config);
  check('store_config.sort_order=1', sharedCfg.store_config.sort_order === 1, sharedCfg.store_config);

  // B店不受影响
  const listB = await api('GET', `/coaches/admin?store_id=${storeB._id}&pageSize=50`, null, tokenB);
  const sharedInB = listB.json.data.list.find(c => c.name === '共享教练');
  check('B店列表中共享教练仍为未配置（回退全局）', sharedInB && sharedInB.store_config.configured === false && sharedInB.store_config.sort_order === 3, sharedInB && sharedInB.store_config);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('冒烟测试异常:', err);
  process.exit(1);
});
