/**
 * 存量 Booking 补全课程快照字段
 * 执行：node scripts/migrate-booking-snapshots.js
 * 安全：仅补全缺失字段，不修改已有数据
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi-dance';
const BATCH_SIZE = 500;

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('[migrate-booking] 连接数据库成功');

  const Booking = require('../src/models/Booking');
  const Schedule = require('../src/models/Schedule');
  const Coach = require('../src/models/Coach');
  const Store = require('../src/models/Store');

  const total = await Booking.countDocuments({ course_name: { $exists: false } });
  console.log(`[migrate-booking] 待补全 Booking 数: ${total}`);

  let updated = 0, skipped = 0, errors = 0;

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const bookings = await Booking.find({ course_name: { $exists: false } })
      .skip(offset).limit(BATCH_SIZE)
      .select('_id schedule_id');

    for (const b of bookings) {
      try {
        const sch = await Schedule.findById(b.schedule_id);
        if (!sch) { skipped++; continue; }

        const coach = sch.coach_id ? await Coach.findById(sch.coach_id).select('name') : null;
        const store = sch.store_id ? await Store.findById(sch.store_id).select('name') : null;

        await Booking.updateOne({ _id: b._id }, { $set: {
          course_name: sch.course_name || '',
          schedule_date: sch.date || '',
          schedule_start_time: sch.start_time || '',
          schedule_end_time: sch.end_time || '',
          schedule_duration: sch.duration || 0,
          coach_name: coach?.name || '',
          store_name: store?.name || '',
          dance_style_name: '',
          classroom: sch.classroom || '',
          credits_cost: sch.credits_cost || 0,
          max_bookings: sch.max_bookings || 0,
        }});
        updated++;
      } catch (err) {
        errors++;
        console.error(`[migrate-booking] 失败 _id=${b._id}:`, err.message);
      }
    }
    console.log(`[migrate-booking] 进度: ${Math.min(offset + BATCH_SIZE, total)}/${total}, 已补全: ${updated}, 跳过: ${skipped}`);
  }

  console.log(`[migrate-booking] 完成! 补全: ${updated}, 跳过(无Schedule): ${skipped}, 失败: ${errors}`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('[migrate-booking] 迁移失败:', err);
  process.exit(1);
});
