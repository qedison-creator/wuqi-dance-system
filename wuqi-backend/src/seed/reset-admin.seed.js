require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Store = require('../models/Store');

const connectDB = require('../config/database');

async function resetAdmin() {
  try {
    await connectDB();
    console.log('数据库连接成功');

    const stores = await Store.find();
    if (stores.length === 0) {
      console.log('请先运行 npm run seed 初始化基础数据');
      process.exit(1);
    }

    // 删除所有管理员
    const deleteResult = await User.deleteMany({ user_type: 'admin' });
    console.log(`已删除 ${deleteResult.deletedCount} 个管理员账号`);

    // 重新创建超级管理员
    const admin = await User.create({
      username: 'admin',
      password: 'admin123',
      user_type: 'admin',
      role: 'super_admin',
      real_name: '超级管理员',
      phone: '13800138000',
      member_status: 'official',
      status: 'active',
      store_id: stores[0]._id
    });

    console.log('\n✅ 超级管理员重置成功！');
    console.log('  账号: admin');
    console.log('  密码: admin123');
    console.log('  ⚠️  请登录后立即修改密码！');

  } catch (err) {
    console.error('重置失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

resetAdmin();
