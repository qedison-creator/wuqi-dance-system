/**
 * 门店初始化种子数据脚本
 * 运行方式: node src/seed/stores.seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Store = require('../models/Store');

const connectDB = require('../config/database');

const defaultStores = [
  {
    name: '福永店',
    code: 'FY',
    address: '深圳市宝安区福永街道xxx路xxx号',
    phone: '13800138001',
    sort_order: 1,
    status: 'active'
  },
  {
    name: '固戍店',
    code: 'GS',
    address: '深圳市宝安区固戍街道xxx路xxx号',
    phone: '13800138002',
    sort_order: 2,
    status: 'active'
  }
];

async function seedStores() {
  try {
    await connectDB();
    console.log('数据库连接成功');

    const existingCount = await Store.countDocuments();
    if (existingCount > 0) {
      console.log(`已有 ${existingCount} 个门店，跳过初始化`);
      console.log('如需重新初始化，请先清空 Store 集合');
      process.exit(0);
    }

    const result = await Store.insertMany(defaultStores);
    console.log(`成功初始化 ${result.length} 个门店:`);
    result.forEach(s => {
      console.log(`  - ${s.name} (编码: ${s.code})`);
    });

    console.log('\n门店初始化完成！');
  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedStores();
