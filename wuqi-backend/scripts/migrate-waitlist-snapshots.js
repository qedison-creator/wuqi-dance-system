/**
 * 存量 Waitlist 补全课程快照字段
 * 执行：node scripts/migrate-waitlist-snapshots.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi-dance';
const BATCH_SIZE = 500;

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('[migrate-waitlist] 连接数据库成功');

  const Waitlist = require('../src/models/Waitlist');
  const Schedule = require('../src/models/Schedule');
  const Coach = require('../src/models/Coach');
  const Store = require('../src/models/Store');

  const total = await Waitlist.countDocuments({ course_name: { $exists: false } });
  console.log(`[migrate-waitlist] 待补全 Waitlist 数: ${total}`);

  let updated = 0, skipped = 0, errors = 0;

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const waitlists = await Waitlist.find({ course_name: { $exists: false } })
      .skip(offset).limit(BATCH_SIZE)
      .select('_id schedule_id');

    for (const w of waitlists) {
      try {
        const sch = await Schedule.findById(w.schedule_id);
        if (!sch) { skipped++; continue; }

        const coach = sch.coach_id ? await Coach.findById(sch.coach_id).select('name') : null;
        const store = sch.store_id ? await Store.findById(sch.store_id).select('name') : null;

        await Waitlist.updateOne({ _id: w._id }, { $set: {
          course_name: sch.course_name || '',
          schedule_date: sch.date || '',
          start_time: sch.start_time || '',
          end_time: sch.end_time || '',
          coach_name: coach?.name || '',
          store_name: store?.name || '',
        }});
        updated++;
      } catch (err) {
        errors++;
        console.error(`[migrate-waitlist] 失败 _id=${w._id}:`, err.message);
      }
    }
    console.log(`[migrate-waitlist] 进度: ${Math.min(offset + BATCH_SIZE, total)}/${total}, 已补全: ${updated}, 跳过: ${skipped}`);
  }

  console.log(`[migrate-waitlist] 完成! 补全: ${updated}, 跳过(无Schedule): ${skipped}, 失败: ${errors}`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('[migrate-waitlist] 迁移失败:', err);
  process.exit(1);
});
