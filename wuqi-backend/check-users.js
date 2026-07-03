const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';

async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[DB] 已连接到:', MONGODB_URI);

    const User = mongoose.model('User', new mongoose.Schema({
      member_status: String,
      member_identity: String,
      claimed_at: Date,
      real_name: String,
      reserve_phone: String,
      wechat_phone: String,
      openid: String,
      phone: String,
      created_at: Date,
      updated_at: Date,
      user_type: String
    }, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }));

    // 查询 official 用户
    const officials = await User.find({ member_status: 'official' }).lean();
    console.log('[统计] official 用户总数:', officials.length);

    officials.forEach(u => {
      console.log('---');
      console.log('姓名:', u.real_name);
      console.log('phone:', u.phone || '无');
      console.log('wechat_phone:', u.wechat_phone || '无');
      console.log('reserve_phone:', u.reserve_phone || '无');
      console.log('member_status:', u.member_status);
      console.log('member_identity:', u.member_identity);
      console.log('claimed_at:', u.claimed_at || '无');
      console.log('openid:', u.openid ? '有' : '无');
      console.log('created_at:', u.created_at);
      console.log('updated_at:', u.updated_at);
    });

    // 同时查询 pending_claim 数量
    const pendingCount = await User.countDocuments({ member_status: 'pending_claim' });
    console.log('[统计] pending_claim 用户总数:', pendingCount);

    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
