/* 清理脚本：删除指向已物理删除排课的孤儿签到记录（课时统计"异常数据"的来源）
 * 流程：找出孤儿签到 → 完整备份到服务器 ~/orphan-attendance-backup-<时间戳>.json → 删除
 * 只删 schedule_id 在 schedules 表中不存在的签到，正常签到不受影响
 * 运行：node scripts/cleanup-orphan-attendance.js
 */
const mongoose = require('mongoose');
const fs = require('fs');

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

mongoose.connect(URI).then(async () => {
  const db = mongoose.connection.db;
  const attCol = db.collection('attendances');
  const schCol = db.collection('schedules');
  console.log(`数据库: ${db.databaseName}`);

  // 与课时统计同口径：排除豁免取消/签到后取消后，按 schedule_id 判断排课是否存在
  const grouped = await attCol.aggregate([
    { $match: { check_in_method: { $nin: ['exempt_cancel', 'cancelled_after_checkin'] } } },
    { $group: { _id: '$schedule_id', n: { $sum: 1 } } },
  ]).toArray();

  const sids = grouped.map(g => g._id).filter(Boolean);
  const existing = new Set(
    (await schCol.find({ _id: { $in: sids } }).project({ _id: 1 }).toArray()).map(s => String(s._id))
  );
  const orphanScheduleIds = sids.filter(sid => !existing.has(String(sid)));
  // schedule_id 为空的散签到同样视为孤儿
  const nullSidDocs = await attCol.find({ schedule_id: null }).project({ _id: 1 }).toArray();

  if (orphanScheduleIds.length === 0 && nullSidDocs.length === 0) {
    console.log('没有孤儿签到，无需清理');
    await mongoose.disconnect();
    return;
  }

  const orphanFilter = {
    $or: [
      { schedule_id: { $in: orphanScheduleIds } },
      ...(nullSidDocs.length > 0 ? [{ schedule_id: null }] : []),
    ],
  };
  const orphans = await attCol.find(orphanFilter).toArray();
  const totalBefore = await attCol.countDocuments({});

  console.log(`\n待删除孤儿签到: ${orphans.length} 条（涉及 ${orphanScheduleIds.length} 个已删除排课）：`);
  orphans.forEach((o, i) => {
    console.log(`  [${i + 1}] ${o.date || '?'} ${o.course_name || '未知课程'} | ${o.coach_name || '教练未知'} | 签到时间 ${o.check_in_time ? new Date(o.check_in_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '?'}`);
  });

  // 备份到服务器家目录（完整文档 + 删除上下文）
  const backupPath = `${process.env.HOME || '.'}/orphan-attendance-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify({
    deleted_at: new Date().toISOString(),
    database: db.databaseName,
    count: orphans.length,
    records: orphans,
  }, null, 2), 'utf8');
  console.log(`\n已备份到: ${backupPath}`);

  const r = await attCol.deleteMany(orphanFilter);
  const totalAfter = await attCol.countDocuments({});

  console.log(`\n已删除 ${r.deletedCount} 条（签到总数 ${totalBefore} → ${totalAfter}）`);
  console.log('完成后刷新管理端课时统计，"课程已不存在"的警告应消失');
  console.log(`如需恢复: mongoimport 之前确认备份文件（联系开发处理）`);

  await mongoose.disconnect();
}).catch(err => {
  console.error('清理失败:', err.message);
  process.exit(1);
});
