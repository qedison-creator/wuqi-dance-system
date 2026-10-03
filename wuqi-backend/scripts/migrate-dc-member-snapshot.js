/* 数据中心存量迁移：预约记录会员快照回填（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 课时账单要求会员删除后仍完整显示姓名/编号——为历史预约补写 member_snapshot：
 *   - 会员现存的：从 User 回填姓名/编号/手机号
 *   - 会员已删除的：无法回填姓名，账单展示层兜底"已删除会员"（其余字段完整）
 *
 * 用法（自动读后端根目录 .env）：
 *  node scripts/migrate-booking-snapshot.js            # 预览
 *  node scripts/migrate-booking-snapshot.js --apply    # 写库
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

const APPLY = process.argv.includes('--apply');

async function main() {
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`[migrate] 数据库: ${db.databaseName}  模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（仅预览，加 --apply 执行）'}`);

  const Booking = require('../src/models/Booking');
  const User = require('../src/models/User');

  const docs = await Booking.find({
    member_snapshot: { $exists: false },
  }).select('user_id').limit(100000).lean();
  console.log(`\n[1] 缺少会员快照的预约: ${docs.length} 条`);

  const userCache = new Map();
  let patched = 0, missing = 0;
  for (const doc of docs) {
    if (!doc.user_id) { missing += 1; continue; }
    const uid = String(doc.user_id);
    if (!userCache.has(uid)) {
      userCache.set(uid, await User.findById(uid).select('real_name nick_name member_code phone').lean() || null);
    }
    const u = userCache.get(uid);
    if (!u) { missing += 1; continue; }
    if (APPLY) {
      await Booking.collection.updateOne({ _id: doc._id }, {
        $set: { member_snapshot: { real_name: u.real_name || '', nick_name: u.nick_name || '', member_code: u.member_code || '', phone: u.phone || '' } },
      });
    }
    patched += 1;
  }
  console.log(`    回填 ${patched} 条，会员已删除无法回填 ${missing} 条（展示层兜底"已删除会员"）`);

  if (!APPLY) console.log('\n预览完成。确认无误后加 --apply 执行写库。');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[migrate] 执行失败:', err);
  process.exit(1);
});
