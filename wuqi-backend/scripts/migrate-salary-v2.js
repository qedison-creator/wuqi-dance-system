/* 薪酬体系 V2 迁移脚本（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 内容：
 *  1. CoachSalary 索引迁移：删除旧的全局唯一索引 {coach_id, store_id, duration}，
 *     换成部分唯一索引（仅 is_active:true）——费率版本化的前提（改价=关旧行+开新行）
 *  2. 旧课薪台账清退：现有 CoachSalaryStat（pending/settled/cancelled）全部置 voided，
 *     旧 SalaryBill 保留只读（历史凭证），不再参与去重
 *  3. Attendance 快照回填：从 Schedule 补 store_id/coach_id/duration/course_name/
 *     coach_name/store_name/start_time/end_time（缺快照的历史签到会被门店过滤漏掉）
 *
 * 用法：
 *  MONGODB_URI="mongodb://localhost:27017/wuqi_dance" node scripts/migrate-salary-v2.js          # 预览
 *  MONGODB_URI="mongodb://localhost:27017/wuqi_dance" node scripts/migrate-salary-v2.js --apply  # 执行
 */
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const mongoose = require('mongoose');
const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[migrate] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  // ---------- 1. CoachSalary 索引迁移 ----------
  console.log('\n[1] CoachSalary 索引迁移');
  const col = db.collection('coachsalaries');
  const indexes = await col.indexes();
  for (const idx of indexes) {
    const keys = JSON.stringify(idx.key);
    const isOldUnique = idx.unique &&
      idx.key.coach_id === 1 && idx.key.store_id === 1 && idx.key.duration === 1 &&
      !idx.partialFilterExpression;
    if (isOldUnique) {
      console.log(`  - 发现旧全局唯一索引 "${idx.name}" ${keys}，需删除（改用部分唯一索引）`);
      if (APPLY) {
        await col.dropIndex(idx.name);
        console.log(`    已删除 ${idx.name}`);
      }
    } else if (idx.name === 'uniq_active_coach_store_duration') {
      console.log(`  - 新部分唯一索引已存在，跳过`);
    }
  }
  if (APPLY) {
    const CoachSalary = require('../src/models/CoachSalary');
    await CoachSalary.syncIndexes();
    const after = (await col.indexes()).map(i => i.name);
    console.log(`  syncIndexes 完成，当前索引: ${after.join(', ')}`);
    if (!after.includes('uniq_active_coach_store_duration')) {
      throw new Error('部分唯一索引创建失败，中止！');
    }
  }

  // ---------- 2. 旧课薪台账清退 ----------
  console.log('\n[2] 旧课薪台账清退（CoachSalaryStat → voided）');
  const statCol = db.collection('coachsalarystats');
  // 旧链路的状态枚举是 pending/settled/cancelled；新链路是 active/voided
  const oldStats = await statCol.countDocuments({ status: { $in: ['pending', 'settled', 'cancelled'] } });
  console.log(`  待清退旧台账记录: ${oldStats} 条${oldStats > 0 ? '（置 voided，旧账单保留只读）' : ''}`);
  if (APPLY && oldStats > 0) {
    const r = await statCol.updateMany(
      { status: { $in: ['pending', 'settled', 'cancelled'] } },
      { $set: { status: 'voided', remark: 'V2迁移：旧链路台账清退（原记录保留数据）' } }
    );
    console.log(`  已清退 ${r.modifiedCount} 条`);
  }

  // ---------- 3. Attendance 快照回填 ----------
  console.log('\n[3] Attendance 快照回填（从 Schedule 补齐缺失字段）');
  const attCol = db.collection('attendances');
  const schCol = db.collection('schedules');

  const missing = await attCol.aggregate([
    { $match: { schedule_id: { $ne: null } } },
    { $group: { _id: '$schedule_id', n: { $sum: 1 } } },
  ]).toArray();
  console.log(`  涉及排课的签到记录分组: ${missing.length} 个 schedule`);

  const scheduleIds = missing.map(m => m._id);
  const schedules = await schCol.find({ _id: { $in: scheduleIds } }).toArray();
  const schMap = new Map(schedules.map(s => [String(s._id), s]));

  const snapshotFields = ['store_id', 'coach_id', 'duration', 'course_name', 'coach_name', 'store_name', 'start_time', 'end_time'];
  let touchedSchedules = 0;
  let touchedAttendances = 0;
  const orphanScheduleIds = [];

  for (const m of missing) {
    const sid = String(m._id);
    const sch = schMap.get(sid);
    if (!sch) {
      orphanScheduleIds.push(m._id);
      continue;
    }
    const patch = {};
    if (sch.store_id) patch.store_id = sch.store_id;
    if (sch.coach_id) patch.coach_id = sch.coach_id;
    if (sch.duration) patch.duration = sch.duration;
    if (sch.course_name) patch.course_name = sch.course_name;
    if (sch.date) patch.date = sch.date;
    if (sch.start_time) patch.start_time = sch.start_time;
    if (sch.end_time) patch.end_time = sch.end_time;
    if (sch.store_id) {
      // store_name 需要查门店
      const store = await db.collection('stores').findOne({ _id: sch.store_id });
      if (store) patch.store_name = store.name;
    }
    const coach = sch.coach_id ? await db.collection('coaches').findOne({ _id: sch.coach_id }) : null;
    if (coach) patch.coach_name = coach.name;

    if (Object.keys(patch).length === 0) continue;
    touchedSchedules += 1;

    // 只更新缺字段的签到（快照已有值的不覆盖）
    const or = Object.keys(patch).map(f => ({ $or: [{ [f]: { $exists: false } }, { [f]: null }, { [f]: '' }] }));
    const filter = { schedule_id: m._id, $or: or.length > 1 ? or : or[0].$or };
    if (APPLY) {
      const r = await attCol.updateMany(filter, { $set: patch });
      touchedAttendances += r.modifiedCount;
    } else {
      const n = await attCol.countDocuments(filter);
      touchedAttendances += n;
    }
  }

  const orphanCount = orphanScheduleIds.reduce(async (accP, sid) => {
    const acc = await accP;
    return acc + await attCol.countDocuments({ schedule_id: sid });
  }, Promise.resolve(0));

  console.log(`  需回填的排课: ${touchedSchedules} 个，涉及签到: ${touchedAttendances} 条`);
  const orphanTotal = await orphanCount;
  if (orphanTotal > 0) {
    console.log(`  ⚠ ${orphanTotal} 条签到指向已物理删除的排课（无法回填）——课时统计中会列入"异常数据"，不计薪`);
  }

  console.log(`\n[migrate] ${APPLY ? '迁移完成' : 'dry-run 结束（未写库）'}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[migrate] 失败:', err);
  process.exit(1);
});
