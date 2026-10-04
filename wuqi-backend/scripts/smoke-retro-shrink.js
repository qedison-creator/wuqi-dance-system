/* 冒烟测试：migrate-timecard-retro-shrink（时间卡按天口径历史缩期追溯）
 *  1. 改版前（created_at < 分界）不限次卡 2 课时 booked/completed 预约 → 套餐 end_date 缩短 shrink_days 之和
 *  2. 改版前 1 课时预约不缩期；改版前已取消（cancelled）预约不缩期
 *  3. 改版后（created_at ≥ 分界）预约视为已缩期，不再二次缩短
 *  4. 每周限制卡（非按天口径）不处理
 *  5. 幂等：重跑 affectedPackages=0，end_date 不变
 *  6. 恢复一致性：追溯缩期后取消该预约，restoreTimeCardShrink 能把天数加回
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。用法：node scripts/smoke-retro-shrink.js
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

// 分界：与脚本默认一致（V1.1.6 提交时间）
const CUTOFF = new Date('2026-10-03T21:32:18+08:00');

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
  const { runMigration } = require('../scripts/migrate-timecard-retro-shrink');

  const store = await Store.create({ name: '冒烟门店', address: '测试街1号', phone: '10000000000' });
  let seq = 0;
  async function makeMember() {
    seq += 1;
    return User.create({
      openid: `smoke-retro-${Date.now()}-${seq}`,
      real_name: `会员${seq}`, phone: `136000${String(10000 + seq).slice(-5)}`, gender: 1,
      member_status: 'official', user_type: 'member', store_id: store._id, info_completed: true,
    });
  }
  // 固定截止日 2027-09-28（便于断言天数）
  const BASE_END = dayjs.tz('2027-09-28 23:59:59.999', BJ).toDate();
  function pkg(user, fields) {
    return UserPackage.create({
      user_id: user._id, store_id: store._id, package_type: 'time_card',
      total_credits: 10002, remaining_credits: 10002, created_by: user._id,
      is_activated: true, status: 'active',
      start_date: dayjs.tz('2026-09-29 00:00:00', BJ).toDate(),
      end_date: BASE_END, original_end_date: BASE_END,
      ...fields,
    });
  }
  async function booking(user, userPackage, credits, status, createdAt, extra) {
    const b = await Booking.create({
      user_id: user._id, schedule_id: new mongoose.Types.ObjectId(),
      coach_id: new mongoose.Types.ObjectId(), dance_style_id: new mongoose.Types.ObjectId(),
      store_id: store._id, booking_date: '2026-09-30', booking_time: '20:00',
      status: status || 'booked', credits_deducted: credits, user_package_id: userPackage._id, ...extra,
    });
    // mongoose 时间戳会覆盖 created_at，用原生驱动补写为指定历史时刻
    await Booking.collection.updateOne({ _id: b._id }, { $set: { created_at: createdAt } });
    return b;
  }
  const PRE = new Date('2026-09-30T12:00:00+08:00');   // 改版前
  const POST = new Date('2026-10-04T12:00:00+08:00');  // 改版后

  // 会员1：不限次卡，改版前 2课时(booked) + 2课时(completed) → 应缩 4 天
  const m1 = await makeMember();
  const pUnlimited = await pkg(m1, {});
  await booking(m1, pUnlimited, 2, 'booked', PRE, { shrink_days: 2 });
  await booking(m1, pUnlimited, 2, 'completed', PRE, { shrink_days: 2 });
  await booking(m1, pUnlimited, 1, 'booked', PRE);                        // 1课时不缩期
  await booking(m1, pUnlimited, 2, 'cancelled', PRE, { shrink_days: 2 }); // 已取消不缩期

  // 会员2：每天1节卡，改版前 2课时 → 应缩 2 天
  const m2 = await makeMember();
  const pDailyOne = await pkg(m2, { daily_limit: 1 });
  await booking(m2, pDailyOne, 2, 'completed', PRE, { shrink_days: 2 });

  // 会员3：不限次卡，仅改版后预约（已缩期）→ 不动
  const m3 = await makeMember();
  const pPost = await pkg(m3, {});
  await booking(m3, pPost, 2, 'booked', POST, { shrink_days: 2 }); // created_at 改版后 → 视为已缩期

  // 会员4：每周限制卡（非按天口径）→ 不动
  const m4 = await makeMember();
  const pWeekly = await pkg(m4, { weekly_limit: 3 });
  await booking(m4, pWeekly, 2, 'booked', PRE, { shrink_days: 2 });

  // ===== 预览（dry-run）=====
  const dry = await runMigration({ apply: false, before: CUTOFF });
  check('预览：候选历史预约=3 条（2课时booked+2课时completed+每天1节2课时）', dry.candidateBookings === 3, dry.candidateBookings);
  check('预览：受影响套餐=2 个', dry.affectedPackages === 2, dry.affectedPackages);
  check('预览：合计缩短=6 天（不限次4 + 每天1节2）', dry.totalDays === 6, dry.totalDays);
  check('预览不写库：套餐 end_date 未变', (await UserPackage.findById(pUnlimited._id)).end_date.getTime() === BASE_END.getTime());

  // ===== 写库 =====
  const r = await runMigration({ apply: true, before: CUTOFF });
  check('写库：成功 2 个套餐', r.appliedPackages === 2, r.appliedPackages);

  const pU = await UserPackage.findById(pUnlimited._id);
  const pD = await UserPackage.findById(pDailyOne._id);
  const pPostAfter = await UserPackage.findById(pPost._id);
  const pWeeklyAfter = await UserPackage.findById(pWeekly._id);

  check('不限次卡 end_date 缩短 4 天 → 2027-09-24', dayjs(pU.end_date).tz(BJ).format('YYYY-MM-DD') === '2027-09-24',
    dayjs(pU.end_date).tz(BJ).format('YYYY-MM-DD'));
  check('每天1节卡 end_date 缩短 2 天 → 2027-09-26', dayjs(pD.end_date).tz(BJ).format('YYYY-MM-DD') === '2027-09-26',
    dayjs(pD.end_date).tz(BJ).format('YYYY-MM-DD'));
  check('不限次卡标记 retro_shrink_applied_days=4', pU.retro_shrink_applied_days === 4, pU.retro_shrink_applied_days);
  check('每天1节卡标记 retro_shrink_applied_days=2', pD.retro_shrink_applied_days === 2, pD.retro_shrink_applied_days);

  check('改版后预约的套餐不动（end_date=原值）', pPostAfter.end_date.getTime() === BASE_END.getTime(),
    dayjs(pPostAfter.end_date).tz(BJ).format('YYYY-MM-DD'));
  check('改版后预约的套餐无追溯标记', pPostAfter.retro_shrink_applied_days === undefined || pPostAfter.retro_shrink_applied_days === null, pPostAfter.retro_shrink_applied_days);
  check('每周限制卡不动（end_date=原值）', pWeeklyAfter.end_date.getTime() === BASE_END.getTime(),
    dayjs(pWeeklyAfter.end_date).tz(BJ).format('YYYY-MM-DD'));

  // ===== 幂等 =====
  const r2 = await runMigration({ apply: true, before: CUTOFF });
  check('幂等：重跑受影响套餐=0', r2.affectedPackages === 0, r2.affectedPackages);
  const pU2 = await UserPackage.findById(pUnlimited._id);
  check('幂等：end_date 不再变化', pU2.end_date.getTime() === pU.end_date.getTime(),
    dayjs(pU2.end_date).tz(BJ).format('YYYY-MM-DD'));

  // ===== 取消恢复一致性 =====
  // 取一条已缩期的历史预约（会员1的 booked 2课时），取消后应把 2 天加回
  const bookedRec = await Booking.findOne({ user_package_id: pUnlimited._id, status: 'booked', shrink_days: 2 });
  const restored = await bookingService.restoreTimeCardShrink(bookedRec);
  const expectRestored = dayjs(pU.end_date).tz(BJ).add(2, 'day').endOf('day').toDate();
  check('取消恢复：按 shrink_days 加回 2 天', restored && restored.getTime() === expectRestored.getTime(),
    restored ? dayjs(restored).tz(BJ).format('YYYY-MM-DD') : restored);

  console.log(`\n===== 结果: ${passed} passed, ${failed} failed =====`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(async err => {
  console.error('冒烟脚本异常:', err);
  try { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } catch (e) { /* ignore */ }
  process.exit(1);
});