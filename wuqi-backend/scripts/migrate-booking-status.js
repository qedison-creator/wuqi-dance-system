/**
 * 数据迁移脚本：统一 Booking.status 字段，处理 booking_status 历史遗留数据
 *
 * 使用方法：
 *   1. 停止后端服务（建议低峰期执行）
 *   2. 先执行审计：node scripts/migrate-booking-status.js --audit
 *   3. 查看审计结果，确认无异常后执行迁移：node scripts/migrate-booking-status.js --migrate
 *   4. 迁移后再次审计验证：node scripts/migrate-booking-status.js --audit
 *   5. 确认无误后重启后端服务
 *
 * 说明：
 *   - --audit：只读模式，统计 booking_status 与 status 的一致性，不修改任何数据
 *   - --migrate：将 booking_status 的值回填到 status（仅当两者不一致时），确保 status 为权威值
 *   - 迁移后 booking_status 字段仍保留在数据库中（不删除），作为回滚兜底
 *   - 如需彻底清理 booking_status 字段，确认稳定运行1周后手动执行：
 *     db.bookings.updateMany({}, { $unset: { booking_status: "" } })
 */

const mongoose = require('mongoose');

// ========== 配置 ==========
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi_dance';

// ========== 连接数据库 ==========
async function main() {
  const mode = process.argv[2] || '--audit';
  console.log(`[Migration] 模式: ${mode}`);
  console.log('[Migration] 连接数据库...');
  await mongoose.connect(MONGO_URI);
  console.log('[Migration] 数据库已连接\n');

  const db = mongoose.connection.db;
  const collection = db.collection('bookings');

  if (mode === '--audit') {
    await audit(collection);
  } else if (mode === '--migrate') {
    await migrate(collection);
  } else {
    console.log('用法: node scripts/migrate-booking-status.js [--audit|--migrate]');
    console.log('  --audit   只读审计，不修改数据');
    console.log('  --migrate 执行迁移，将 booking_status 回填到 status');
  }

  await mongoose.disconnect();
  console.log('\n[Migration] 数据库已断开，脚本结束');
}

// ========== 审计函数 ==========
async function audit(collection) {
  console.log('========== 数据审计报告 ==========\n');

  const total = await collection.countDocuments({});
  console.log(`Booking 总数: ${total}`);

  // 统计：两字段都存在且一致
  const bothConsistent = await collection.countDocuments({
    $expr: { $eq: ['$status', '$booking_status'] }
  });
  console.log(`两字段一致: ${bothConsistent}`);

  // 统计：两字段都存在但不一致
  const bothInconsistent = await collection.countDocuments({
    $expr: { $ne: ['$status', '$booking_status'] },
    booking_status: { $exists: true }
  });
  console.log(`两字段不一致: ${bothInconsistent}`);

  // 统计：只有 status（无 booking_status 或为 null）
  const onlyStatus = await collection.countDocuments({
    $or: [
      { booking_status: { $exists: false } },
      { booking_status: null }
    ]
  });
  console.log(`只有 status（无 booking_status）: ${onlyStatus}`);

  // 统计：booking_status 存在但 status 缺失
  const onlyBookingStatus = await collection.countDocuments({
    $or: [
      { status: { $exists: false } },
      { status: null }
    ],
    booking_status: { $exists: true, $ne: null }
  });
  console.log(`只有 booking_status（无 status）: ${onlyBookingStatus}`);

  // 列出不一致的记录详情（最多10条）
  if (bothInconsistent > 0) {
    console.log('\n---------- 不一致记录详情（最多10条）----------');
    const inconsistentDocs = await collection
      .find({
        $expr: { $ne: ['$status', '$booking_status'] },
        booking_status: { $exists: true }
      })
      .limit(10)
      .toArray();

    for (const doc of inconsistentDocs) {
      console.log(`  _id: ${doc._id}, status: ${doc.status}, booking_status: ${doc.booking_status}, schedule_id: ${doc.schedule_id}, user_id: ${doc.user_id}`);
    }

    if (bothInconsistent > 10) {
      console.log(`  ... 还有 ${bothInconsistent - 10} 条未显示`);
    }
  }

  // 按 status 值分布
  console.log('\n---------- status 值分布 ----------');
  const statusDist = await collection.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  for (const item of statusDist) {
    console.log(`  status=${item._id}: ${item.count} 条`);
  }

  // 按 booking_status 值分布
  console.log('\n---------- booking_status 值分布 ----------');
  const bookingStatusDist = await collection.aggregate([
    { $group: { _id: '$booking_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  for (const item of bookingStatusDist) {
    console.log(`  booking_status=${item._id}: ${item.count} 条`);
  }

  console.log('\n========== 审计完成 ==========');
  if (bothInconsistent === 0 && onlyBookingStatus === 0) {
    console.log('结论: 数据一致性良好，可以安全上线新代码。');
  } else {
    console.log('结论: 存在不一致数据，建议先执行 --migrate 迁移后再上线新代码。');
  }
}

// ========== 迁移函数 ==========
async function migrate(collection) {
  console.log('========== 开始数据迁移 ==========\n');

  // 1. 处理"只有 booking_status"的记录：booking_status -> status
  const onlyBookingResult = await collection.updateMany(
    {
      $or: [
        { status: { $exists: false } },
        { status: null }
      ],
      booking_status: { $exists: true, $ne: null }
    },
    [
      { $set: { status: '$booking_status' } }
    ]
  );
  console.log(`步骤1 - 只有 booking_status 的记录: 修改 ${onlyBookingResult.modifiedCount} 条`);

  // 2. 处理两字段不一致的记录：以 booking_status 为准回填 status
  //    裁决规则：booking_status 更可能是后期正确写入的值
  //    但如果 booking_status 是默认值 'booked' 而 status 是 'cancelled'/'completed'，则保留 status
  const inconsistentResult = await collection.updateMany(
    {
      $expr: { $ne: ['$status', '$booking_status'] },
      booking_status: { $exists: true, $ne: null },
      status: { $exists: true, $ne: null }
    },
    [
      {
        $set: {
          status: {
            $cond: {
              // 如果 booking_status 不是默认值 'booked'，以 booking_status 为准
              // 否则保留 status（因为 'booked' 可能只是默认值，不代表真实状态）
              if: { $ne: ['$booking_status', 'booked'] },
              then: '$booking_status',
              else: '$status'
            }
          }
        }
      }
    ]
  );
  console.log(`步骤2 - 两字段不一致的记录: 修改 ${inconsistentResult.modifiedCount} 条`);

  // 3. 验证迁移结果
  console.log('\n---------- 迁移后验证 ----------');
  const stillInconsistent = await collection.countDocuments({
    $expr: { $ne: ['$status', '$booking_status'] },
    booking_status: { $exists: true, $ne: null }
  });
  console.log(`仍不一致的记录: ${stillInconsistent} 条`);

  if (stillInconsistent > 0) {
    console.log('\n警告: 仍有不一致记录，请手动检查：');
    const docs = await collection
      .find({
        $expr: { $ne: ['$status', '$booking_status'] },
        booking_status: { $exists: true, $ne: null }
      })
      .limit(10)
      .toArray();
    for (const doc of docs) {
      console.log(`  _id: ${doc._id}, status: ${doc.status}, booking_status: ${doc.booking_status}`);
    }
  } else {
    console.log('\n迁移成功！所有记录的 status 字段已统一。');
    console.log('注意: booking_status 字段仍保留在数据库中作为回滚兜底。');
    console.log('如需彻底清理，确认稳定运行1周后执行：');
    console.log('  db.bookings.updateMany({}, { $unset: { booking_status: "" } })');
  }

  console.log('\n========== 迁移完成 ==========');
}

// ========== 执行 ==========
main().catch(err => {
  console.error('[Migration] 脚本执行失败:', err);
  process.exit(1);
});
