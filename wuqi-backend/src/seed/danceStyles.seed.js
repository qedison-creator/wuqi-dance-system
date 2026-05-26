/**
 * 舞种初始化种子数据脚本
 * 运行方式: node src/seed/danceStyles.seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const DanceStyle = require('../models/DanceStyle');

const connectDB = require('../config/database');

const defaultDanceStyles = [
  { name: '爵士舞', sort_order: 1, description: '爵士舞是一种充满活力与创造性的舞蹈' },
  { name: '古典舞', sort_order: 2, description: '中国古典舞蹈，融合传统身韵与技巧' },
  { name: '街舞', sort_order: 3, description: 'Street Dance，包含Breaking、Popping等风格' },
  { name: '韩舞', sort_order: 4, description: 'K-Pop舞蹈，韩国流行音乐舞蹈' },
  { name: '中国舞', sort_order: 5, description: '中国民族民间舞蹈，包含各民族舞蹈' },
  { name: '流行舞', sort_order: 6, description: '流行音乐舞蹈，时尚潮流舞蹈' },
  { name: '抖音舞', sort_order: 7, description: '抖音热门舞蹈，短视频流行舞' }
];

async function seedDanceStyles() {
  try {
    await connectDB();
    console.log('数据库连接成功');

    // 检查是否已有舞种数据
    const existingCount = await DanceStyle.countDocuments();
    if (existingCount > 0) {
      console.log(`已有 ${existingCount} 个舞种，跳过初始化`);
      console.log('如需重新初始化，请先清空 DanceStyle 集合');
      process.exit(0);
    }

    // 插入默认舞种
    const result = await DanceStyle.insertMany(defaultDanceStyles);
    console.log(`成功初始化 ${result.length} 个舞种:`);
    result.forEach(ds => {
      console.log(`  - ${ds.name} (排序: ${ds.sort_order})`);
    });

    console.log('\n舞种初始化完成！');
  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedDanceStyles();
