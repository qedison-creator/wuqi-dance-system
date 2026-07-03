// 临时数据检查脚本：查询已认领但 claimed_at 缺失的用户
// 用法: node check-data.js
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi';

async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[DB] 已连接');

    const User = mongoose.model('User', new mongoose.Schema({
      member_status: String,
      member_identity: String,
      claimed_at: Date,
      real_name: String,
      reserve_phone: String,
      created_at: Date
    }));

    // 查询已认领但 claimed_at 缺失的用户
    const count = await User.countDocuments({
      member_status: 'official',
      claimed_at: { $exists: false },
      member_identity: { $in: ['new', 'old'] }
    });
    console.log('[结果] 已认领但 claimed_at 缺失的用户数量:', count);

    if (count > 0) {
      const users = await User.find({
        member_status: 'official',
        claimed_at: { $exists: false },
        member_identity: { $in: ['new', 'old'] }
      }).select('real_name reserve_phone member_identity member_status created_at').lean();
      console.log('[详情] 这些用户是:');
      users.forEach(u => {
        console.log(`  - ${u.real_name || '无名'} | phone: ${u.reserve_phone || '无'} | identity: ${u.member_identity} | created: ${u.created_at}`);
      });
    }

    // 额外统计：预建档已认领（有 claimed_at）的用户数量
    const claimedCount = await User.countDocuments({
      member_status: 'official',
      claimed_at: { $exists: true, $ne: null }
    });
    console.log('[统计] 预建档已认领用户数量:', claimedCount);

    process.exit(0);
  } catch (err) {
    console.error('[错误]', err.message);
    process.exit(1);
  }
}

main();
