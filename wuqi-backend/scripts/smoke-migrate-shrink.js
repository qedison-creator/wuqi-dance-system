/* 冒烟测试：存量迁移 migrate-shrink-days（旧"占天"→"缩有效期"规则）
 *  1. 清除 Booking.occupied_dates（旧规则死数据）
 *  2. 按天口径时间卡（不限次/每日1节）N≥2 课时历史预约回填 shrink_days = credits_deducted
 *  3. N=1 的预约不标记；每周限制卡/次卡预约不标记
 *  4. 幂等：重复执行零回填
 *  5. 回填后 getMyBookings 能返回 deduct_days（双端展示生效）
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。用法：node scripts/smoke-migrate-shrink.js
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

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  for (const c of await db.listCollections().toArray()) await db.dropCollection(c.name);

  const Store = require('../src/models/Store');
  const User = require('../src/models/User');
  const UserPackage = require('../src/models/UserPackage');
  const Booking = require('../src/models/Booking');
  const bookingService = require('../src/services/booking.service');
  const { runMigration } = require('../scripts/migrate-shrink-days');

  const store = await Store.create({ name: '冒烟门店', address: '测试街1号', phone: '10000000000' });
  let seq = 0;
  async function makeMember() {
    seq += 1;
    return User.create({
      openid: `smoke-mig-${Date.now()}-${seq}`,
      real_name: `会员${seq}`, phone: `135000${String(10000 + seq).slice(-5)}`, gender: 1,
      member_status: 'official', user_type: 'member', store_id: store._id, info_completed: true,
    });
  }
  function pkg(user, fields) {
    return UserPackage.create({
      user_id: user._id, store_id: store._id, package_type: 'time_card',
      total_credits: 10002, remaining_credits: 10002, created_by: user._id,
      is_activated: true, status: 'active',
      end_date: dayjs().tz(BJ).add(365, 'day').endOf('day').toDate(),
      ...fields,
    });
  }
  function booking(user, userPackage, credits, status, extra) {
    return Booking.create({
      user_id: user._id, schedule_id: new (require('mongoose').Types.ObjectId)(),
      coach_id: new (require('mongoose').Types.ObjectId)(), dance_style_id: new (require('mongoose').Types.ObjectId)(),
      store_id: store._id, booking_date: '2026-10-10', booking_time: '20:00',
      status: status || 'booked', credits_deducted: credits, user_package_id: userPackage._id, ...extra,
    });
  }

  // 造旧规则数据：N≥2 的带 occupied_dates（此前生产回填过），无 shrink_days
  const m1 = await makeMember();
  const pUnlimited = await pkg(m1, {});
  const pDailyOne = await pkg(m1, { daily_limit: 1 });
  const pWeekly = await pkg(m1, { weekly_limit: 2 });
  const m2 = await makeMember();
  const pCount = await UserPackage.create({
    user_id: m2._id, store_id: store._id, package_type: 'count_card',
    total_credits: 10, remaining_credits: 10, created_by: m2._id, is_activated: true, status: 'active',
  });

  const b1 = await booking(m1, pUnlimited, 2, 'booked');
  const b2 = await booking(m1, pUnlimited, 1, 'completed');
  const b3 = await booking(m1, pDailyOne, 2, 'cancelled');
  const b4 = await booking(m1, pWeekly, 2, 'booked');
  const b5 = await booking(m2, pCount, 2, 'booked');

  // 用原生驱动补写旧规则字段 occupied_dates（新 schema 已移除该字段，mongoose 会静默丢弃——这正是要迁移的场景）
  for (const [b, dates] of [[b1, ['2026-10-10', '2026-10-11']], [b3, ['2026-10-10', '2026-10-11']], [b4, ['2026-10-10', '2026-10-11']], [b5, ['2026-10-10', '2026-10-11']]]) {
    await Booking.collection.updateOne({ _id: b._id }, { $set: { occupied_dates: dates } });
  }
  const occBefore = await Booking.countDocuments({ occupied_dates: { $exists: true, $nin: [null, []] } });
  check('前置：4 条旧字段数据已就位', occBefore === 4, occBefore);

  const r = await runMigration({ apply: true });

  const doc1 = await Booking.findById(b1._id);
  const doc2 = await Booking.findById(b2._id);
  const doc3 = await Booking.findById(b3._id);
  const doc4 = await Booking.findById(b4._id);
  const doc5 = await Booking.findById(b5._id);

  check('occupied_dates 全部清除', !doc1.occupied_dates && !doc5.occupied_dates, { b1: doc1.occupied_dates, b5: doc5.occupied_dates });
  check('清除数量统计=4', r.clearCandidates === 4, r.clearCandidates);
  check('不限次卡2课时回填 shrink_days=2', doc1.shrink_days === 2, doc1.shrink_days);
  check('不限次卡1课时不标记', doc2.shrink_days === undefined || doc2.shrink_days === null, doc2.shrink_days);
  check('每日1节卡已取消的2课时也回填（展示"已恢复"）', doc3.shrink_days === 2, doc3.shrink_days);
  check('每周限制卡不标记', doc4.shrink_days === undefined || doc4.shrink_days === null, doc4.shrink_days);
  check('次卡不标记', doc5.shrink_days === undefined || doc5.shrink_days === null, doc5.shrink_days);
  check('回填统计=2（b1+b3）', r.backfilled === 2, r.backfilled);

  // 幂等 + 原生驱动复核（mongoose 文档读取会屏蔽 schema 外字段，必须用原生 count 验证）
  const occAfter = await Booking.collection.countDocuments({ occupied_dates: { $exists: true, $nin: [null, []] } });
  check('occupied_dates 已真正清除（原生驱动复核）', occAfter === 0, occAfter);
  const r2 = await runMigration({ apply: true });
  check('幂等：重跑零回填', r2.backfillCandidates === 0, r2.backfillCandidates);
  check('幂等：重跑零清除', r2.clearCandidates === 0, r2.clearCandidates);

  // 回填后展示生效
  const myBookings = await bookingService.getMyBookings(m1._id, 'all', 1, 20);
  const rec1 = myBookings.list.find(b => String(b._id) === String(b1._id));
  const rec3 = myBookings.list.find(b => String(b._id) === String(b3._id));
  check('getMyBookings 历史2课时 deduct_days=2', rec1 && rec1.deduct_days === 2, rec1 && rec1.deduct_days);
  check('getMyBookings 已取消历史 deduct_days=2', rec3 && rec3.status === 'cancelled' && rec3.deduct_days === 2, rec3 && { status: rec3.status, deduct_days: rec3.deduct_days });

  console.log(`\n===== 结果: ${passed} passed, ${failed} failed =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async err => {
  console.error('冒烟脚本异常:', err);
  try { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } catch (e) { /* ignore */ }
  process.exit(1);
});
