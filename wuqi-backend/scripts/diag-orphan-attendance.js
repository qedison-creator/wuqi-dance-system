/* 诊断脚本：列出指向已物理删除排课的签到记录（课时统计中的"异常数据"）
 * 在服务器上运行：node scripts/diag-orphan-attendance.js
 * 只读查询，不写库
 */
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

mongoose.connect(URI).then(async () => {
  const db = mongoose.connection.db;
  console.log(`数据库: ${db.databaseName}\n`);

  const atts = await db.collection('attendances').aggregate([
    { $match: { check_in_method: { $nin: ['exempt_cancel', 'cancelled_after_checkin'] } } },
    {
      $group: {
        _id: '$schedule_id',
        checkins: { $sum: 1 },
        date: { $max: '$date' },
        course: { $max: '$course_name' },
        coach: { $max: '$coach_name' },
        store: { $max: '$store_name' },
        duration: { $max: '$duration' },
        methods: { $addToSet: '$check_in_method' },
        first_checkin: { $min: '$check_in_time' },
        users: { $addToSet: '$user_id' },
      },
    },
  ]).toArray();

  const sids = atts.map(a => a._id).filter(Boolean);
  const existing = new Set(
    (await db.collection('schedules').find({ _id: { $in: sids } }).project({ _id: 1 }).toArray()).map(s => String(s._id))
  );

  const orphans = atts.filter(a => !a._id || !existing.has(String(a._id)));
  console.log(`孤儿签到组数: ${orphans.length}\n`);

  // 查会员昵称，便于人工核对是谁签的到
  const allUserIds = [...new Set(orphans.flatMap(o => o.users || []).map(u => String(u)))];
  const users = await db.collection('users').find({ _id: { $in: allUserIds.map(id => {
    try { return new mongoose.Types.ObjectId(id); } catch { return null; }
  }).filter(Boolean) } }).project({ nick_name: 1, real_name: 1 }).toArray();
  const userMap = new Map(users.map(u => [String(u._id), u.real_name || u.nick_name || u._id]));

  orphans.forEach((o, i) => {
    console.log(`[${i + 1}] ${o.date || '无日期'} ${o.course || '未知课程'} | 教练: ${o.coach || '未知'} | 门店: ${o.store || '未知'} | 时长: ${o.duration || '?'}分钟`);
    console.log(`    签到 ${o.checkins} 人（${(o.methods || []).join('/')}），签到时间 ${o.first_checkin ? new Date(o.first_checkin).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '?'}`);
    console.log(`    签到会员: ${(o.users || []).map(u => userMap.get(String(u)) || String(u)).join('、')}`);
    console.log(`    schedule_id: ${o._id}\n`);
  });

  await mongoose.disconnect();
}).catch(err => {
  console.error('诊断失败:', err.message);
  process.exit(1);
});
