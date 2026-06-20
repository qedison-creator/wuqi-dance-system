/**
 * 存量 Attendance 补全课程快照字段
 * 执行：node scripts/migrate-attendance-snapshots.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi-dance';
const BATCH_SIZE = 500;

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('[migrate-attendance] 连接数据库成功');

  const Attendance = require('../src/models/Attendance');
  const Schedule = require('../src/models/Schedule');
  const Coach = require('../src/models/Coach');
  const Store = require('../src/models/Store');

  const total = await Attendance.countDocuments({ start_time: { $exists: false } });
  console.log(`[migrate-attendance] 待补全 Attendance 数: ${total}`);

  let updated = 0, skipped = 0, errors = 0;

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const attendances = await Attendance.find({ start_time: { $exists: false } })
      .skip(offset).limit(BATCH_SIZE)
      .select('_id schedule_id');

    for (const a of attendances) {
      try {
        const sch = await Schedule.findById(a.schedule_id);
        if (!sch) { skipped++; continue; }

        const coach = sch.coach_id ? await Coach.findById(sch.coach_id).select('name') : null;
        const store = sch.store_id ? await Store.findById(sch.store_id).select('name') : null;

        await Attendance.updateOne({ _id: a._id }, { $set: {
          start_time: sch.start_time || '',
          end_time: sch.end_time || '',
          duration: sch.duration || 0,
          coach_name: coach?.name || '',
          store_name: store?.name || '',
        }});
        updated++;
      } catch (err) {
        errors++;
        console.error(`[migrate-attendance] 失败 _id=${a._id}:`, err.message);
      }
    }
    console.log(`[migrate-attendance] 进度: ${Math.min(offset + BATCH_SIZE, total)}/${total}, 已补全: ${updated}, 跳过: ${skipped}`);
  }

  console.log(`[migrate-attendance] 完成! 补全: ${updated}, 跳过(无Schedule): ${skipped}, 失败: ${errors}`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('[migrate-attendance] 迁移失败:', err);
  process.exit(1);
});
