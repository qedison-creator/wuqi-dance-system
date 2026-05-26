/**
 * 套餐模板初始化种子数据脚本
 * 运行方式: node src/seed/packages.seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Package = require('../models/Package');

const connectDB = require('../config/database');

const defaultPackages = [
  {
    name: '10次体验卡',
    description: '新人专享10次体验课程',
    class_count: 10,
    price: 999,
    original_price: 1299,
    duration_days: 30,
    sort_order: 1,
    status: 'active'
  },
  {
    name: '20次月卡',
    description: '20次课程，有效期30天',
    class_count: 20,
    price: 1899,
    original_price: 2399,
    duration_days: 30,
    sort_order: 2,
    status: 'active'
  },
  {
    name: '50次季卡',
    description: '50次课程，有效期90天',
    class_count: 50,
    price: 3999,
    original_price: 4999,
    duration_days: 90,
    sort_order: 3,
    status: 'active'
  },
  {
    name: '100次年卡',
    description: '100次课程，有效期365天',
    class_count: 100,
    price: 6999,
    original_price: 8999,
    duration_days: 365,
    sort_order: 4,
    status: 'active'
  }
];

async function seedPackages() {
  try {
    await connectDB();
    console.log('数据库连接成功');

    const existingCount = await Package.countDocuments();
    if (existingCount > 0) {
      console.log(`已有 ${existingCount} 个套餐模板，跳过初始化`);
      console.log('如需重新初始化，请先清空 Package 集合');
      process.exit(0);
    }

    const result = await Package.insertMany(defaultPackages);
    console.log(`成功初始化 ${result.length} 个套餐模板:`);
    result.forEach(p => {
      console.log(`  - ${p.name} (¥${p.price}/${p.class_count}次)`);
    });

    console.log('\n套餐模板初始化完成！');
  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedPackages();
