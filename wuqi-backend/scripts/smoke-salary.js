/* 冒烟测试：薪酬体系 V2（费率版本化 + 课薪台账 + 教练删除零影响）
 * 连接 wuqi_dance_smoke_test 测试库，跑完即清库。
 * 启动后端：cd wuqi-backend && PORT=3900 NODE_ENV=development \
 *   MONGODB_URI="mongodb://localhost:27017/wuqi_dance_smoke_test" JWT_SECRET=smoke node server.js
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
const dateOnlyStr = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
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
  const User = require('../src/models/User');
  const DanceStyle = require('../src/models/DanceStyle');
  const Schedule = require('../src/models/Schedule');
  const Attendance = require('../src/models/Attendance');
  const CoachSalaryStat = require('../src/models/CoachSalaryStat');
  const CoachSalary = require('../src/models/CoachSalary');
  const SalaryBill = require('../src/models/SalaryBill');

  // ================= 基础数据 =================
  const storeA = await Store.create({ name: '门店A', address: 'A街1号', phone: '10000000001' });
  const storeB = await Store.create({ name: '门店B', address: 'B街2号', phone: '10000000002' });
  const style = await DanceStyle.create({ name: '爵士' });

  const coachX = await Coach.create({ name: '张三', store_ids: [storeA._id] }); // 门店独占
  const coachS = await Coach.create({ name: '李四', store_ids: [] });           // 多门店执教

  await User.create([
    { username: 'sa', password: 'admin123', real_name: '超管', role: 'super_admin', user_type: 'admin', member_status: 'official', store_ids: [] },
    { username: 'mgrA', password: 'admin123', real_name: '店长A', role: 'store_manager', user_type: 'admin', member_status: 'official', store_ids: [storeA._id], permissions: ['salary'] },
    { username: 'mgrB', password: 'admin123', real_name: '店长B', role: 'store_manager', user_type: 'admin', member_status: 'official', store_ids: [storeB._id], permissions: ['salary'] },
  ]);
  const members = await User.create([
    { nickname: '会员1', user_type: 'member', member_status: 'official', store_id: storeA._id },
    { nickname: '会员2', user_type: 'member', member_status: 'official', store_id: storeA._id },
    { nickname: '会员3', user_type: 'member', member_status: 'official', store_id: storeA._id },
    { nickname: '会员4', user_type: 'member', member_status: 'official', store_id: storeB._id },
    { nickname: '会员5', user_type: 'member', member_status: 'official', store_id: storeB._id },
  ]);

  const mkSchedule = (date, coach, store, duration, courseName) => Schedule.create({
    coach_id: coach._id, dance_style_id: style._id, store_id: store._id,
    date, start_time: '10:00', end_time: '11:15', duration, status: 'completed',
    course_name: courseName, max_bookings: 20, min_bookings: 2,
  });
  const sch1 = await mkSchedule('2026-08-10', coachX, storeA, 75, '爵士基础');
  const sch2 = await mkSchedule('2026-08-20', coachX, storeB, 75, '爵士基础');
  const sch3 = await mkSchedule('2026-08-25', coachX, storeA, 60, '拉伸课');
  const sch4 = await mkSchedule('2026-09-05', coachX, storeA, 75, '爵士提高');
  const sch5 = await mkSchedule('2026-08-15', coachS, storeA, 75, '韩舞课');

  const mkAtt = (schedule, userIdx, extra = {}) => Attendance.create({
    schedule_id: schedule._id, user_id: members[userIdx]._id,
    store_id: schedule.store_id, coach_id: schedule.coach_id,
    check_in_method: 'scan', source: 'booking',
    date: schedule.date, course_name: schedule.course_name,
    duration: schedule.duration, start_time: '10:00', end_time: '11:15', ...extra,
  });
  await mkAtt(sch1, 0); await mkAtt(sch1, 1); await mkAtt(sch1, 2);   // 3人
  await mkAtt(sch2, 0); await mkAtt(sch2, 3);                          // 2人
  await mkAtt(sch3, 1);                                                // 1人
  await mkAtt(sch4, 2); await mkAtt(sch4, 4);                          // 2人
  await mkAtt(sch5, 0); await mkAtt(sch5, 1);                          // 2人
  // 孤儿签到：排课已被物理删除
  const { ObjectId } = mongoose.Types;
  await Attendance.create({
    schedule_id: new ObjectId(), user_id: members[0]._id, store_id: storeA._id, coach_id: coachX._id,
    check_in_method: 'scan', date: '2026-08-30', course_name: '幽灵课', duration: 75,
  });

  const login = async (u, p) => (await api('POST', '/auth/admin-login', { username: u, password: p })).json.data.token;
  const tokenSA = await login('sa', 'admin123');
  const tokenA = await login('mgrA', 'admin123');
  const tokenB = await login('mgrB', 'admin123');
  check('三个账号登录', !!tokenSA && !!tokenA && !!tokenB);

  // ================= [1] 薪酬配置创建与权限 =================
  console.log('\n[1] 薪酬配置创建与权限');
  const r1 = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 200, effective_from: '2026-08-01' }, tokenA);
  check('店长A为本店教练创建配置（门店自动注入）', r1.json.code === 200 && r1.json.data.store_id && String(r1.json.data.store_id._id || r1.json.data.store_id) === String(storeA._id), r1.json);
  const cfgXA75 = r1.json.data._id;

  const r1b = await api('POST', '/coach-salaries', { coach_id: coachS._id, duration: 75, salary_rate: 100 }, tokenA);
  check('店长A不能为多门店执教教练配置', r1b.json.code !== 200, r1b.json);

  const r1c = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 100, store_id: storeB._id }, tokenB);
  check('店长B不能为非本店教练配置', r1c.json.code !== 200, r1c.json);

  const r1d = await api('POST', '/coach-salaries', { coach_id: coachS._id, duration: 75, salary_rate: 180, effective_from: '2026-08-01' }, tokenSA);
  check('超管创建多门店通用配置（store_id=null）', r1d.json.code === 200 && r1d.json.data.store_id === null, r1d.json);

  const r1e = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 999, effective_from: '2026-08-01', store_id: storeA._id }, tokenSA);
  check('同一生效日期重复设价被拒绝（提示改那一期）', r1e.json.code !== 200, r1e.json);

  const r1f = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 250, effective_from: '2026-08-01', store_id: storeB._id }, tokenSA);
  check('超管为教练创建B店专属配置（同教练不同店不同价）', r1f.json.code === 200, r1f.json);

  // ================= [2] 课时统计 =================
  console.log('\n[2] 课时统计（按年，聚合核心）');
  const hours = await api('GET', '/coach-salaries/stats/class-hours?year=2026', null, tokenSA);
  check('统计成功', hours.json.code === 200, hours.json);
  const hAug = hours.json.data.months.find(m => m.monthKey === '08');
  const hSep = hours.json.data.months.find(m => m.monthKey === '09');
  const hAugX = hAug && hAug.coaches.find(c => c.coach_name === '张三');
  const hAugXStoreA = hAugX && hAugX.stores.find(s => s.store_name === '门店A');
  const hAugXStoreB = hAugX && hAugX.stores.find(s => s.store_name === '门店B');
  check('8月张三共3节', hAugX && hAugX.total_classes === 3, hAug && hAug.coaches);
  check('8月张三A店2节（含60分钟1节）', hAugXStoreA && hAugXStoreA.total_classes === 2 && hAugXStoreA.durations.some(d => d.duration === 60), hAugXStoreA);
  check('8月张三B店1节', hAugXStoreB && hAugXStoreB.total_classes === 1, hAugXStoreB);
  check('9月张三1节', hSep && hSep.coaches.find(c => c.coach_name === '张三').total_classes === 1, hSep);
  check('全年合计5节', hours.json.data.summary.total_classes === 5, hours.json.data.summary);
  check('孤儿签到不计入（orphan_count=1）', hours.json.data.orphan_count === 1, hours.json.data.orphan_count);
  check('孤儿清单含幽灵课', hours.json.data.orphans.some(o => o.course_name === '幽灵课' && o.reason === 'schedule_missing'), hours.json.data.orphans);

  const hoursA = await api('GET', '/coach-salaries/stats/class-hours?year=2026', null, tokenA);
  const hAAug = hoursA.json.data.months.find(m => m.monthKey === '08');
  const hAAugX = hAAug && hAAug.coaches.find(c => c.coach_name === '张三');
  check('店长A门店隔离：8月张三只见A店2节', hAAugX && hAAugX.total_classes === 2 && hAAugX.stores.length === 1, hAAug);
  check('店长A全年合计4节（B店课不可见）', hoursA.json.data.summary.total_classes === 4, hoursA.json.data.summary);

  const detail = await api('GET', `/coach-salaries/stats/class-hours/detail?year=2026&month=08&coach_id=${coachX._id}`, null, tokenA);
  check('课时明细懒加载：2条记录', detail.json.code === 200 && detail.json.data.records.length === 2, detail.json);
  check('明细含签到人数', detail.json.data.records.every(r => r.attendance_count > 0) && detail.json.data.records.some(r => r.attendance_count === 3), detail.json.data.records);

  // ================= [3] 月度薪酬（按上课日期匹配费率） =================
  console.log('\n[3] 月度薪酬明细');
  const monthly = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const mAug = monthly.json.data.months.find(m => m.monthKey === '08');
  const mAugX = mAug && mAug.coaches.find(c => c.coach_name === '张三');
  const mAugS = mAug && mAug.coaches.find(c => c.coach_name === '李四');
  check('8月张三=A店200+B店250+60分钟未配置0 = 450', mAugX && mAugX.total_amount === 450, mAugX);
  check('张三60分钟课标红警告（duration_mismatch）', mAugX && mAugX.warnings.length === 1 && mAugX.durations.some(d => d.matched === 'duration_mismatch'), mAugX);
  check('李四通用配置180', mAugS && mAugS.total_amount === 180, mAugS);
  const mSep = monthly.json.data.months.find(m => m.monthKey === '09');
  check('9月张三按当时费率200', mSep && mSep.coaches.find(c => c.coach_name === '张三').total_amount === 200, mSep);

  const monthlyA = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenA);
  const mAAugX = monthlyA.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  check('店长A门店隔离：8月张三只算A店=200', mAAugX && mAAugX.total_amount === 200, mAAugX);
  check('店长A视角无B店费率行', mAAugX && !mAAugX.durations.some(d => d.store_name === '门店B'), mAAugX);

  // ================= [4] 单价时间线：加一期/改价/删除 =================
  console.log('\n[4] 单价时间线管理');
  // 追加新一期（正常调价）：当前期关闭，新期从 09-01 起
  const tl1 = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 220, effective_from: '2026-09-01', store_id: storeA._id }, tokenSA);
  check('追加一期成功（09-01起220）', tl1.json.code === 200 && tl1.json.data.is_active === true, tl1.json);
  const rowR2 = tl1.json.data._id;

  const tlA = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const tlAugX = tlA.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  const tlSepX = tlA.json.data.months.find(m => m.monthKey === '09').coaches.find(c => c.coach_name === '张三');
  check('历史月份金额不变（8月仍450）', tlAugX && tlAugX.total_amount === 450, tlAugX);
  check('9月按新费率220', tlSepX && tlSepX.total_amount === 220, tlSepX);

  const tl2 = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 999, effective_from: '2026-09-01', store_id: storeA._id }, tokenSA);
  check('同一生效日期重复设价被拒绝', tl2.json.code !== 200, tl2.json);

  // 改历史期的价：直接改那一行，该期薪酬随之变
  const tl3 = await api('PUT', `/coach-salaries/${cfgXA75}`, { salary_rate: 210 }, tokenA);
  check('修改历史期单价成功（200→210，行不变）', tl3.json.code === 200 && tl3.json.data.salary_rate === 210 && tl3.json.data._id === cfgXA75, tl3.json);
  const tlB = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const tlAugX2 = tlB.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  check('8月按改后单价重算（210+250=460）', tlAugX2 && tlAugX2.total_amount === 460, tlAugX2);

  // 改当前期的价
  const tl4 = await api('PUT', `/coach-salaries/${rowR2}`, { salary_rate: 230 }, tokenA);
  check('修改当前期单价成功（220→230）', tl4.json.code === 200 && tl4.json.data.salary_rate === 230, tl4.json);
  const tlC = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const tlSepX2 = tlC.json.data.months.find(m => m.monthKey === '09').coaches.find(c => c.coach_name === '张三');
  check('9月按改后单价重算（230）', tlSepX2 && tlSepX2.total_amount === 230, tlSepX2);

  // 前插更早的历史期（2026-07-01 起 180）
  const tl5 = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 180, effective_from: '2026-07-01', store_id: storeA._id }, tokenSA);
  check('前插历史期成功（07-01起180）', tl5.json.code === 200 && tl5.json.data.is_active === false, tl5.json);

  // 在历史期区间内插一期 → 自动拆分
  const tl6 = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 205, effective_from: '2026-08-15', store_id: storeA._id }, tokenSA);
  check('区间内插期自动拆分（08-15起205）', tl6.json.code === 200 && tl6.json.data.is_active === false && tl6.json.data.effective_to, tl6.json);
  const rowSplit = tl6.json.data._id;

  // 删除拆分期 → 前一期自动衔接回 08-01~09-01
  const tl7 = await api('DELETE', `/coach-salaries/${rowSplit}`, null, tokenSA);
  check('删除无入账的历史期成功', tl7.json.code === 200, tl7.json);
  const rowsA75a = await CoachSalary.find({ coach_id: coachX._id, duration: 75, store_id: storeA._id }).sort({ effective_from: 1 }).lean();
  check('删除后前一版自动衔接（3行，08-01行截止09-01）', rowsA75a.length === 3 && rowsA75a[1].effective_to && dateOnlyStr(rowsA75a[1].effective_to) === '2026-09-01', rowsA75a.map(r => [r.salary_rate, r.effective_from, r.effective_to]));

  // 删除当前期 → 前一期重新开放
  const tl8 = await api('DELETE', `/coach-salaries/${rowR2}`, null, tokenSA);
  check('删除当前期成功（无入账）', tl8.json.code === 200, tl8.json);
  const tlD = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const tlSepX3 = tlD.json.data.months.find(m => m.monthKey === '09').coaches.find(c => c.coach_name === '张三');
  const rowsA75b = await CoachSalary.find({ coach_id: coachX._id, duration: 75, store_id: storeA._id }).sort({ effective_from: 1 }).lean();
  check('删除当前期后前一期重新开放（2行，08-01行生效中）', rowsA75b.length === 2 && rowsA75b[1].is_active === true && !rowsA75b[1].effective_to, rowsA75b.map(r => [r.salary_rate, r.is_active]));
  check('9月按重新开放的210计', tlSepX3 && tlSepX3.total_amount === 210, tlSepX3);

  // 重新追加 09-01 @220，恢复后续账单测试的基线
  const tl9 = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 75, salary_rate: 220, effective_from: '2026-09-01', store_id: storeA._id }, tokenSA);
  check('重新追加09-01期', tl9.json.code === 200, tl9.json);
  const rowR2b = tl9.json.data._id;
  const rowsA75c = await CoachSalary.find({ coach_id: coachX._id, duration: 75, store_id: storeA._id }).sort({ effective_from: 1 }).lean();
  check('最终时间线：07-01@180 / 08-01~09-01@210 / 09-01~@220', rowsA75c.length === 3 &&
    rowsA75c[0].salary_rate === 180 && rowsA75c[1].salary_rate === 210 && rowsA75c[2].salary_rate === 220 && rowsA75c[2].is_active, rowsA75c.map(r => [r.salary_rate, r.is_active]));

  // 编辑时期的起止日期
  const de1 = await api('PUT', `/coach-salaries/${cfgXA75}`, { effective_from: '2026-08-10' }, tokenSA);
  check('编辑开始日期（08-01→08-10）', de1.json.code === 200 && dateOnlyStr(de1.json.data.effective_from) === '2026-08-10', de1.json);
  const de2 = await api('PUT', `/coach-salaries/${cfgXA75}`, { effective_from: '2026-08-01', effective_to: '2026-08-20' }, tokenSA);
  check('编辑结束日期留出空档（09-01→08-20）', de2.json.code === 200 && dateOnlyStr(de2.json.data.effective_to) === '2026-08-20', de2.json);
  const de3 = await api('PUT', `/coach-salaries/${cfgXA75}`, { effective_to: '2026-09-05' }, tokenSA);
  check('结束日期不能超过下一期开始', de3.json.code !== 200, de3.json);
  const de4 = await api('PUT', `/coach-salaries/${cfgXA75}`, { effective_to: '2026-08-01' }, tokenSA);
  check('结束日期必须晚于开始日期', de4.json.code !== 200, de4.json);
  const de5 = await api('PUT', `/coach-salaries/${cfgXA75}`, { effective_from: '2026-09-10' }, tokenSA);
  check('开始日期不能晚于下一期开始', de5.json.code !== 200, de5.json);
  const de6 = await api('PUT', `/coach-salaries/${rowR2b}`, { effective_to: '2026-10-01' }, tokenSA);
  check('最后一期设置结束日期→关闭长期有效', de6.json.code === 200 && de6.json.data.is_active === false, de6.json);
  const de7 = await api('PUT', `/coach-salaries/${rowR2b}`, { effective_to: null }, tokenSA);
  check('重新设为长期有效', de7.json.code === 200 && de7.json.data.is_active === true, de7.json);
  const de8 = await api('PUT', `/coach-salaries/${cfgXA75}`, { effective_to: '2026-09-01' }, tokenSA);
  check('恢复结束日期09-01（衔接下一期）', de8.json.code === 200 && dateOnlyStr(de8.json.data.effective_to) === '2026-09-01', de8.json);

  // ================= [5] 账单：预览→生成→去重 =================
  console.log('\n[5] 账单生成与去重');
  const pv = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-08-01', end_date: '2026-08-31', preview: true }, tokenSA);
  const pvBill = pv.json.data.bill;
  check('预览：2位教练', pvBill.length === 2, pvBill);
  const pvX = pvBill.find(c => c.coach_name === '张三');
  check('预览：张三=A店210+B店250=460（按上课日期费率）', pvX && pvX.total_amount === 460, pvX);
  check('预览：60分钟未配置→警告且不计入', pv.json.data.warnings.length === 1 && pv.json.data.unresolved_count === 1 && pv.json.data.total_amount === 640, pv.json.data);

  const gaps1 = await api('GET', '/coach-salaries/stats/rate-gaps?year=2026', null, tokenSA);
  check('空档检测：60分钟有课未配价（张三1节）', gaps1.json.data.gaps.some(g => g.duration === 60 && g.coach_name === '张三' && g.count === 1), gaps1.json.data.gaps);

  check('未入账分组结构化返回（张三60分钟1节）', pv.json.data.unresolved_groups && pv.json.data.unresolved_groups.length === 1 &&
    pv.json.data.unresolved_groups[0].count === 1 && pv.json.data.unresolved_groups[0].duration === 60 &&
    pv.json.data.unresolved_groups[0].from === '2026-08-25', pv.json.data.unresolved_groups);

  const gen1 = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-08-01', end_date: '2026-08-31', preview: false }, tokenSA);
  check('生成账单成功', gen1.json.code === 200 && gen1.json.data.bill.length === 2 && gen1.json.data.total_amount === 640, gen1.json.data);
  const bill1Id = (await SalaryBill.findOne({ total_amount: 640 }))._id;
  const ledger1 = await CoachSalaryStat.countDocuments({ status: 'active' });
  check('课薪台账写入3条（sch1/sch2/sch5）', ledger1 === 3, ledger1);
  const ledSch1 = await CoachSalaryStat.findOne({ schedule_id: sch1._id, status: 'active' });
  check('台账记录费率快照+配置版本引用', ledSch1 && ledSch1.salary_rate === 210 && ledSch1.salary_config_id && ledSch1.bill_id, ledSch1);

  const genDup = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-08-01', end_date: '2026-08-31', preview: true }, tokenSA);
  check('重复生成：已入账课程跳过（skipped=3），金额0', genDup.json.data.skipped_count === 3 && genDup.json.data.total_amount === 0, genDup.json.data);

  const genSep = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-09-01', end_date: '2026-09-30', preview: false }, tokenSA);
  check('9月账单按新费率220', genSep.json.data.total_amount === 220, genSep.json.data);
  const bill2Id = (await SalaryBill.findOne({ total_amount: 220 }))._id;

  const genCross = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-08-01', end_date: '2026-09-30', preview: true }, tokenSA);
  check('跨期生成：4节已入账全部跳过', genCross.json.data.skipped_count === 4 && genCross.json.data.total_amount === 0, genCross.json.data);

  // ================= [6] 账单权限与删除 =================
  console.log('\n[6] 账单权限与删除');
  const billsB = await api('GET', '/coach-salaries/stats/bills', null, tokenB);
  check('店长B看不到超管的跨店账单', billsB.json.data.total === 0, billsB.json.data);
  const bill1DetailB = await api('GET', `/coach-salaries/stats/bills/${bill1Id}`, null, tokenB);
  check('店长B不能查看他人跨店账单', bill1DetailB.json.code !== 200, bill1DetailB.json);
  const delByB = await api('DELETE', `/coach-salaries/stats/bills/${bill2Id}`, null, tokenB);
  check('店长B不能删除他人账单', delByB.json.code !== 200, delByB.json);

  const del2 = await api('DELETE', `/coach-salaries/stats/bills/${bill2Id}`, null, tokenSA);
  check('超管删除9月账单', del2.json.code === 200, del2.json);
  const ledSch4 = await CoachSalaryStat.findOne({ schedule_id: sch4._id });
  check('删除账单→台账作废（voided）', ledSch4 && ledSch4.status === 'voided', ledSch4);
  const regenSep = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-09-01', end_date: '2026-09-30', preview: true }, tokenSA);
  check('作废后课程恢复可生成（金额220）', regenSep.json.data.total_amount === 220 && regenSep.json.data.skipped_count === 0, regenSep.json.data);

  // 删除8月账单，让店长B能生成自己的B店账单
  await api('DELETE', `/coach-salaries/stats/bills/${bill1Id}`, null, tokenSA);
  const genB = await api('POST', '/coach-salaries/stats/generate', { start_date: '2026-08-01', end_date: '2026-08-31', preview: false }, tokenB);
  check('店长B生成B店账单（250，门店归属B）', genB.json.data.total_amount === 250, genB.json.data);
  const billB = await SalaryBill.findOne({ total_amount: 250 });
  check('账单带store_id快照', billB && billB.store_id && String(billB.store_id) === String(storeB._id), billB);
  const billsB2 = await api('GET', '/coach-salaries/stats/bills', null, tokenB);
  check('店长B能看到本店账单', billsB2.json.data.total === 1, billsB2.json.data);

  // ================= [7] 教练删除零影响 + 历史费率补配 =================
  console.log('\n[7] 教练删除零影响');
  coachX.is_deleted = true; coachX.status = 'disabled'; await coachX.save();

  const hoursAfterDel = await api('GET', '/coach-salaries/stats/class-hours?year=2026', null, tokenSA);
  check('删除教练后课时统计不变（5节）', hoursAfterDel.json.data.summary.total_classes === 5, hoursAfterDel.json.data.summary);
  check('已删教练名字仍在统计中', hoursAfterDel.json.data.months.some(m => m.coaches.some(c => c.coach_name === '张三')), hoursAfterDel.json.data.months);

  const monthly3 = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const m3AugX = monthly3.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  check('删除教练后月度薪酬不变（8月仍460）', m3AugX && m3AugX.total_amount === 460, m3AugX);

  const cfgListA = await api('GET', '/coach-salaries', null, tokenA);
  const cfgGroupX = cfgListA.json.data.list.find(l => (l.coach_id && l.coach_id.name) === '张三');
  check('配置列表标记教练已删除', cfgGroupX && cfgGroupX.coach_id.is_deleted === true, cfgListA.json.data.list);

  const suppByMgr = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 60, salary_rate: 150 }, tokenA);
  check('店长不能为已删除教练补配', suppByMgr.json.code !== 200, suppByMgr.json);

  const suppBySA = await api('POST', '/coach-salaries', { coach_id: coachX._id, duration: 60, salary_rate: 150, effective_from: '2026-08-01', store_id: storeA._id }, tokenSA);
  check('超管可为已删除教练补配历史费率', suppBySA.json.code === 200, suppBySA.json);

  const tlM3 = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const m4AugX = tlM3.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  check('补配后8月张三=210+250+150=610（历史课补上薪酬）', m4AugX && m4AugX.total_amount === 610, m4AugX);
  check('补配后警告消除', m4AugX && m4AugX.warnings.length === 0, m4AugX);

  const gaps2 = await api('GET', '/coach-salaries/stats/rate-gaps?year=2026', null, tokenSA);
  check('补配后空档消除（张三无空档）', !gaps2.json.data.gaps.some(g => g.coach_name === '张三'), gaps2.json.data.gaps);

  // ================= [8] 迁移脚本 dry-run 冒烟 =================
  console.log('\n[8] 迁移脚本可用性（在本测试库 dry-run）');
  const { execSync } = require('child_process');
  let migOk = false;
  try {
    const out = execSync('node scripts/migrate-salary-v2.js', { cwd: require('path').resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env } });
    migOk = out.includes('dry-run');
    console.log('  ' + out.split('\n').filter(l => l.includes('[')).join('\n  '));
  } catch (e) {
    console.log('  migrate output:', e.stdout || e.message);
  }
  check('迁移脚本 dry-run 正常执行', migOk);

  // ================= [9] 改价重算（修改历史期单价 → 该时期薪酬与账单随之更新） =================
  console.log('\n[9] 改价重算');
  const cfgB75 = r1f.json.data._id; // B店75分钟（250，生效中，sch2 已入账 250）
  const cor1 = await api('PUT', `/coach-salaries/${cfgB75}`, { salary_rate: 260 }, tokenSA);
  check('修改当前期单价成功（250→260）', cor1.json.code === 200 && cor1.json.data.salary_rate === 260, cor1.json);
  const ledB = await CoachSalaryStat.findOne({ schedule_id: sch2._id, status: 'active' });
  check('已入账台账按新单价重算', ledB && ledB.salary_rate === 260 && ledB.total_salary === 260, ledB);
  const billAfterCor = await SalaryBill.findById(billB._id);
  check('已生成账单金额按新单价重算（250→260）', billAfterCor && billAfterCor.total_amount === 260, billAfterCor && billAfterCor.total_amount);
  const mCor = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const mCorAugX = mCor.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  check('月度薪酬随之更正（210+260+150=620）', mCorAugX && mCorAugX.total_amount === 620, mCorAugX);

  // 修改历史期（08-01~09-01 那期）单价 → 历史月份重算
  const cor2 = await api('PUT', `/coach-salaries/${cfgXA75}`, { salary_rate: 215 }, tokenSA);
  check('修改历史期单价成功（210→215）', cor2.json.code === 200 && cor2.json.data.salary_rate === 215, cor2.json);
  const mCor2 = await api('GET', '/coach-salaries/stats/monthly-salary?year=2026', null, tokenSA);
  const mCor2AugX = mCor2.json.data.months.find(m => m.monthKey === '08').coaches.find(c => c.coach_name === '张三');
  check('历史月份按改后单价重算（215+260+150=625）', mCor2AugX && mCor2AugX.total_amount === 625, mCor2AugX);

  // 有已入账课程的期不能删除
  const cor3 = await api('DELETE', `/coach-salaries/${cfgB75}`, null, tokenSA);
  check('有入账课程的期拒绝删除（提示改价）', cor3.json.code !== 200, cor3.json);

  const listAll = await api('GET', '/coach-salaries?is_active=all&coach_id=' + coachX._id, null, tokenSA);
  check('is_active=all 返回全部期（5行：A75三条+B75+A60）', listAll.json.data.list.length === 5, listAll.json.data.list.length);

  // ================= 汇总 =================
  console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('冒烟脚本异常:', err);
  process.exit(1);
});
