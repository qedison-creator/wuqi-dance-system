/**
 * 教练初始化种子数据脚本
 * 运行方式: node src/seed/coaches.seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Coach = require('../models/Coach');
const Store = require('../models/Store');
const DanceStyle = require('../models/DanceStyle');

const connectDB = require('../config/database');

async function seedCoaches() {
  try {
    await connectDB();
    console.log('数据库连接成功');

    const stores = await Store.find();
    if (stores.length === 0) {
      console.log('请先初始化门店数据！运行: node src/seed/stores.seed.js');
      process.exit(1);
    }

    const existingCount = await Coach.countDocuments();
    if (existingCount > 0) {
      console.log(`已有 ${existingCount} 个教练，跳过初始化`);
      console.log('如需重新初始化，请先清空 Coach 集合');
      process.exit(0);
    }

    // 查询舞种并将名称映射为 ObjectId
    const danceStyles = await DanceStyle.find();
    const styleMap = {};
    danceStyles.forEach(s => { styleMap[s.name] = s._id; });

    const defaultCoaches = [
      {
        name: '李老师',
        phone: '13900139001',
        gender: 1,
        avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
        store_id: stores[0]._id,
        dance_styles: [styleMap['爵士舞'], styleMap['韩舞']].filter(Boolean),
        introduction: '从事舞蹈教学5年，擅长爵士舞和韩舞',
        sort_order: 1,
        status: 'active'
      },
      {
        name: '王老师',
        phone: '13900139002',
        gender: 2,
        avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
        store_id: stores[0]._id,
        dance_styles: [styleMap['古典舞'], styleMap['中国舞']].filter(Boolean),
        introduction: '专业舞蹈学院毕业，擅长中国古典舞',
        sort_order: 2,
        status: 'active'
      },
      {
        name: '张老师',
        phone: '13900139003',
        gender: 1,
        avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
        store_id: stores[1]._id,
        dance_styles: [styleMap['街舞'], styleMap['流行舞']].filter(Boolean),
        introduction: '街舞教练，擅长Breaking和Popping',
        sort_order: 1,
        status: 'active'
      }
    ];

    const result = await Coach.insertMany(defaultCoaches);
    console.log(`成功初始化 ${result.length} 个教练:`);
    result.forEach(c => {
      console.log(`  - ${c.name}`);
    });

    console.log('\n教练初始化完成！');
  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedCoaches();
