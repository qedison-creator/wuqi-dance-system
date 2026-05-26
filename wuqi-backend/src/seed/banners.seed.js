/**
 * Banner轮播图初始化种子数据
 * 运行方式: node src/seed/banners.seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Banner = require('../models/Banner');

const connectDB = require('../config/database');

const defaultBanners = [
  {
    title: '新会员首单立减',
    subtitle: '注册即享8折优惠',
    image_url: 'https://images.unsplash.com/photo-1508700929628-666bc8bd84ea?w=800&h=400&fit=crop',
    link_url: '/pages/package/package',
    sort_order: 1,
    status: 'active'
  },
  {
    title: '爵士舞体验课',
    subtitle: '专业教练一对一指导',
    image_url: 'https://images.unsplash.com/photo-1547153760-18fc86324498?w=800&h=400&fit=crop',
    link_url: '/pages/booking/booking',
    sort_order: 2,
    status: 'active'
  },
  {
    title: '暑期集训营',
    subtitle: '限时报名享特惠',
    image_url: 'https://images.unsplash.com/photo-1518834107812-67b0b7c58434?w=800&h=400&fit=crop',
    link_url: '/pages/booking/booking',
    sort_order: 3,
    status: 'active'
  }
];

async function seedBanners() {
  try {
    await connectDB();
    console.log('数据库连接成功');

    // 检查是否已有 banner 数据
    const existingCount = await Banner.countDocuments();
    if (existingCount > 0) {
      console.log(`已有 ${existingCount} 个 banner，跳过初始化`);
      console.log('如需重新初始化，请先清空 Banner 集合');
      process.exit(0);
    }

    // 插入默认 banner
    const result = await Banner.insertMany(defaultBanners);
    console.log(`成功初始化 ${result.length} 个 banner:`);
    result.forEach(b => {
      console.log(`  - ${b.title}`);
    });

    console.log('\nBanner 初始化完成！');
  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedBanners();
