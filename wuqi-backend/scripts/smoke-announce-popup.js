/* 冒烟测试：公告弹窗显示（popup_type）
 *  1. createAnnouncement：四种 popup_type 持久化 / 缺省 none / 非法值报错
 *  2. getPopupAnnouncements：仅生效中的弹窗公告；本门店+全平台口径；不传 store_id 仅全平台
 *  3. 排序：重要>永久>一般；同优先级发布时间倒序
 *  4. updateAnnouncement 修改 popup_type（含非法值报错）；下架/删除后从弹窗列表消失
 *  5. 存量老公告（无 popup_type 字段）不出现且不报错
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。
 * 用法：node scripts/smoke-announce-popup.js
 */
process.env.MONGODB_URI = 'mongodb://localhost:27017/wuqi_dance_smoke_test';
process.env.JWT_SECRET = 'smoke-test-secret';

const mongoose = require('mongoose');

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

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  for (const c of await db.listCollections().toArray()) await db.dropCollection(c.name);

  const Announcement = require('../src/models/Announcement');
  const Store = require('../src/models/Store');
  const User = require('../src/models/User');
  const announcementService = require('../src/services/announcement.service');

  const storeA = await Store.create({ name: '冒烟门店A', address: '测试街1号', phone: '10000000001' });
  const storeB = await Store.create({ name: '冒烟门店B', address: '测试街2号', phone: '10000000002' });
  // operator_id 需为合法 ObjectId（OperationLog 校验），用真实超管用户
  const admin = await User.create({
    username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin',
    user_type: 'admin', member_status: 'official', store_ids: [],
  });
  const adminUser = admin;
  const operatorId = admin._id.toString();
  const operatorName = admin.real_name;

  // ---- 1. 创建：四种类型 + 缺省 ----
  const imp1 = await announcementService.createAnnouncement({ title: '重要公告旧', content: '内容', store_id: null, popup_type: 'important' }, operatorId, operatorName, adminUser);
  const imp2 = await announcementService.createAnnouncement({ title: '重要公告新', content: '内容', store_id: null, popup_type: 'important' }, operatorId, operatorName, adminUser);
  const alw = await announcementService.createAnnouncement({ title: '永久公告', content: '内容', store_id: null, popup_type: 'always' }, operatorId, operatorName, adminUser);
  const normA = await announcementService.createAnnouncement({ title: '门店A一般公告', content: '内容', store_id: storeA._id.toString(), popup_type: 'normal' }, operatorId, operatorName, adminUser);
  const normB = await announcementService.createAnnouncement({ title: '门店B一般公告', content: '内容', store_id: storeB._id.toString(), popup_type: 'normal' }, operatorId, operatorName, adminUser);
  const none = await announcementService.createAnnouncement({ title: '普通公告', content: '内容', store_id: null }, operatorId, operatorName, adminUser);

  check('创建 important 回读', imp1.popup_type === 'important', imp1.popup_type);
  check('创建 always 回读', alw.popup_type === 'always', alw.popup_type);
  check('创建 normal 回读', normA.popup_type === 'normal', normA.popup_type);
  check('缺省 popup_type 为 none', none.popup_type === 'none', none.popup_type);

  await expectThrow('创建非法 popup_type 被拒',
    () => announcementService.createAnnouncement({ title: 'x', content: 'y', popup_type: 'xyz' }, operatorId, operatorName, adminUser),
    '无效的弹窗显示类型');
  await expectThrow('更新非法 popup_type 被拒',
    () => announcementService.updateAnnouncement(imp1._id.toString(), { popup_type: 'xyz' }, operatorId, operatorName, adminUser),
    '无效的弹窗显示类型');

  // ---- 2. 固定 created_at，构造确定排序：imp2(4000) > alw(2500) > imp1(2000) > normA(1000) > normB(500) ----
  const base = Date.now() - 100000;
  await Announcement.findByIdAndUpdate(imp2._id, { created_at: new Date(base + 4000) });
  await Announcement.findByIdAndUpdate(alw._id, { created_at: new Date(base + 2500) });
  await Announcement.findByIdAndUpdate(imp1._id, { created_at: new Date(base + 2000) });
  await Announcement.findByIdAndUpdate(normA._id, { created_at: new Date(base + 1000) });
  await Announcement.findByIdAndUpdate(normB._id, { created_at: new Date(base + 500) });

  // ---- 3. 弹窗列表（门店A口径）----
  const resA = await announcementService.getPopupAnnouncements({ store_id: storeA._id.toString() });
  const idsA = resA.list.map(a => String(a._id));
  check('门店A弹窗列表共4条（全平台3+门店A1）', idsA.length === 4, idsA);
  check('优先级：更旧的 important 排在更新的 always 之前', idsA.indexOf(String(imp1._id)) < idsA.indexOf(String(alw._id)), idsA);
  check('同优先级：新的 important 在前', idsA.indexOf(String(imp2._id)) < idsA.indexOf(String(imp1._id)), idsA);
  check('门店B的公告不出现', !idsA.includes(String(normB._id)), idsA);
  check('不弹窗的公告不出现', !idsA.includes(String(none._id)), idsA);

  // ---- 4. 不传 store_id：仅全平台 ----
  const resAll = await announcementService.getPopupAnnouncements({});
  const idsAll = resAll.list.map(a => String(a._id));
  check('不传 store_id 仅返回全平台弹窗公告（3条）', idsAll.length === 3 && !idsAll.includes(String(normA._id)), idsAll);

  // ---- 5. 存量老公告（无 popup_type 字段）----
  await db.collection('announcements').insertOne({ title: '老公告', content: '旧数据', store_id: null, status: 'active', created_at: new Date() });
  const resOld = await announcementService.getPopupAnnouncements({ store_id: storeA._id.toString() });
  check('无 popup_type 的老公告不出现且不报错',
    resOld.list.length === 4 && !resOld.list.some(a => a.title === '老公告'),
    resOld.list.map(a => a.title));

  // ---- 6. 下架 / 删除 / 改类型 ----
  await announcementService.updateAnnouncement(alw._id.toString(), { status: 'inactive' }, operatorId, operatorName, adminUser);
  const resOff = await announcementService.getPopupAnnouncements({ store_id: storeA._id.toString() });
  check('下架后从弹窗列表消失', !resOff.list.map(a => String(a._id)).includes(String(alw._id)), resOff.list.map(a => a.title));

  await announcementService.updateAnnouncement(none._id.toString(), { popup_type: 'normal' }, operatorId, operatorName, adminUser);
  const resType = await announcementService.getPopupAnnouncements({ store_id: storeA._id.toString() });
  check('none 改为 normal 后进入弹窗列表', resType.list.some(a => String(a._id) === String(none._id)), resType.list.map(a => a.title));

  await announcementService.deleteAnnouncement(imp2._id.toString(), operatorId, operatorName, adminUser);
  const resDel = await announcementService.getPopupAnnouncements({});
  check('删除后从弹窗列表消失', !resDel.list.map(a => String(a._id)).includes(String(imp2._id)), resDel.list.map(a => a.title));

  console.log(`\n===== 冒烟结果：${passed} 通过, ${failed} 失败 =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('冒烟脚本异常:', err);
  process.exit(1);
});
