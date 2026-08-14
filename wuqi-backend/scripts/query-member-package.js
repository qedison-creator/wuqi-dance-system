/**
 * 查询指定会员的套餐数据（用于数据修复前置查询）
 * 使用方式：node scripts/query-member-package.js 钟妙兰
 */
require('dotenv').config();
const mongoose = require('mongoose');
const UserPackage = require('../src/models/UserPackage');
const PackageChange = require('../src/models/PackageChange');
const User = require('../src/models/User');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;

if (!MONGODB_URI) {
  console.error('错误：未配置 MONGODB_URI 环境变量');
  process.exit(1);
}

const keyword = process.argv[2];

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`\n查询会员：${keyword}\n`);

  // 1. 查询会员
  const users = await User.find({
    $or: [
      { real_name: { $regex: keyword, $options: 'i' } },
      { nick_name: { $regex: keyword, $options: 'i' } },
      { reserve_phone: { $regex: keyword } },
      { wechat_phone: { $regex: keyword } }
    ]
  }).lean();

  if (users.length === 0) {
    console.log('未找到匹配的会员');
    return;
  }

  for (const user of users) {
    console.log('========== 会员信息 ==========');
    console.log(`_id: ${user._id}`);
    console.log(`real_name: ${user.real_name || ''}`);
    console.log(`nick_name: ${user.nick_name || ''}`);
    console.log(`reserve_phone: ${user.reserve_phone || ''}`);
    console.log(`wechat_phone: ${user.wechat_phone || ''}`);
    console.log(`store_id: ${user.store_id || ''}`);

    // 2. 查询该会员的次卡套餐
    const packages = await UserPackage.find({
      user_id: user._id,
      package_type: 'count_card'
    }).lean();

    console.log(`\n次卡套餐数量: ${packages.length}`);
    for (const pkg of packages) {
      console.log('\n---------- 套餐 ----------');
      console.log(`套餐ID (_id): ${pkg._id}`);
      console.log(`total_credits (当前总次数): ${pkg.total_credits}`);
      console.log(`original_total_credits (原始录入值): ${pkg.original_total_credits === undefined ? '【不存在】' : pkg.original_total_credits}`);
      console.log(`remaining_credits (剩余次数): ${pkg.remaining_credits}`);
      console.log(`is_activated: ${pkg.is_activated}`);
      console.log(`status: ${pkg.status}`);
      console.log(`store_id: ${pkg.store_id}`);
      console.log(`user_id: ${pkg.user_id}`);
      console.log(`created_by: ${pkg.created_by || '无'}`);
      console.log(`created_at: ${pkg.created_at}`);
      console.log(`member_snapshot: ${JSON.stringify(pkg.member_snapshot || {})}`);

      // 3. 查询该套餐的变更记录
      const changes = await PackageChange.find({
        user_package_id: pkg._id
      }).lean();
      console.log(`变更记录数量: ${changes.length}`);
      for (const ch of changes) {
        console.log(`  - [${ch.created_at}] 操作人:${ch.operator_name}, 变更:${JSON.stringify(ch.changes)}`);
      }
    }
    console.log('\n');
  }
}

main().catch(console.error).finally(() => mongoose.disconnect());
