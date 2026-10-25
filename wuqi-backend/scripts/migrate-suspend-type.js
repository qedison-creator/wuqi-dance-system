/* 存量迁移：停卡类型回填（幂等，默认 dry-run，加 --apply 才写库）
 *
 * 背景：新增 suspend_type 区分「请假/伤停停卡（leave）」与「权益冻结（freeze）」。
 *   历史 is_suspended=true 的套餐没有类型，业务代码统一按 leave 处理；
 *   本脚本把历史值显式回填为 'leave'，保证数据层与展示层一致。
 *
 * 用法（自动读后端根目录 .env）：
 *   node scripts/migrate-suspend-type.js           # 预览
 *   node scripts/migrate-suspend-type.js --apply   # 写库
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

  const UserPackage = require('../src/models/UserPackage');

  const filter = {
    is_suspended: true,
    $or: [{ suspend_type: null }, { suspend_type: { $exists: false } }],
  };
  const docs = await UserPackage.find(filter)
    .select('_id user_id status suspend_end_date')
    .lean();
  console.log(`\n[1] 停卡中且缺少 suspend_type 的套餐: ${docs.length} 条`);

  docs.slice(0, 30).forEach((p) => {
    console.log(`  ${p._id} 会员=${p.user_id} 状态=${p.status} 停卡截止=${p.suspend_end_date ? new Date(p.suspend_end_date).toISOString().split('T')[0] : '-'}`);
  });
  if (docs.length > 30) console.log(`  ... 其余 ${docs.length - 30} 条省略`);

  if (APPLY && docs.length > 0) {
    const res = await UserPackage.updateMany(filter, { $set: { suspend_type: 'leave' } });
    console.log(`    已回填 ${res.modifiedCount || res.nModified || 0} 条为 leave`);
  } else {
    console.log(`    待回填 ${docs.length} 条（apply 时统一设为 leave）`);
  }

  if (!APPLY) console.log('\n预览完成。确认无误后加 --apply 执行写库。');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] 执行失败:', err);
  process.exit(1);
});
