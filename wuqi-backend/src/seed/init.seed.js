/**
 * 完整初始化种子数据脚本
 * 运行方式: node src/seed/init.seed.js
 * 按顺序初始化所有基础数据
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Store = require('../models/Store');
const DanceStyle = require('../models/DanceStyle');
const Package = require('../models/Package');
const Coach = require('../models/Coach');
const User = require('../models/User');
const Banner = require('../models/Banner');

const connectDB = require('../config/database');

async function seedAll() {
  try {
    await connectDB();
    console.log('='.repeat(50));
    console.log('开始初始化舞栖舞蹈社系统数据...');
    console.log('='.repeat(50));

    // 1. 初始化门店
    console.log('\n[1/7] 初始化门店...');
    const storeCount = await Store.countDocuments();
    if (storeCount === 0) {
      const stores = await Store.insertMany([
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
      ]);
      console.log(`  ✓ 成功创建 ${stores.length} 个门店`);
    } else {
      console.log(`  - 跳过 (已有 ${storeCount} 个门店)`);
    }

    // 2. 初始化舞种
    console.log('\n[2/7] 初始化舞种...');
    const danceStyleCount = await DanceStyle.countDocuments();
    if (danceStyleCount === 0) {
      const danceStyles = await DanceStyle.insertMany([
        { name: '爵士舞', sort_order: 1, description: '爵士舞是一种充满活力与创造性的舞蹈' },
        { name: '古典舞', sort_order: 2, description: '中国古典舞蹈，融合传统身韵与技巧' },
        { name: '街舞', sort_order: 3, description: 'Street Dance，包含Breaking、Popping等风格' },
        { name: '韩舞', sort_order: 4, description: 'K-Pop舞蹈，韩国流行音乐舞蹈' },
        { name: '中国舞', sort_order: 5, description: '中国民族民间舞蹈，包含各民族舞蹈' },
        { name: '流行舞', sort_order: 6, description: '流行音乐舞蹈，时尚潮流舞蹈' },
        { name: '抖音舞', sort_order: 7, description: '抖音热门舞蹈，短视频流行舞' }
      ]);
      console.log(`  ✓ 成功创建 ${danceStyles.length} 个舞种`);
    } else {
      console.log(`  - 跳过 (已有 ${danceStyleCount} 个舞种)`);
    }

    // 3. 初始化套餐模板
    console.log('\n[3/7] 初始化套餐模板...');
    const packageCount = await Package.countDocuments();
    if (packageCount === 0) {
      const packages = await Package.insertMany([
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
      ]);
      console.log(`  ✓ 成功创建 ${packages.length} 个套餐模板`);
    } else {
      console.log(`  - 跳过 (已有 ${packageCount} 个套餐模板)`);
    }

    // 4. 初始化教练
    console.log('\n[4/7] 初始化教练...');
    const stores = await Store.find();
    const coachCount = await Coach.countDocuments();
    if (coachCount === 0 && stores.length > 0) {
      const coaches = await Coach.insertMany([
        {
          name: '李老师',
          phone: '13900139001',
          gender: 1,
          avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
          store_id: stores[0]._id,
          dance_styles: ['爵士舞', '韩舞'],
          description: '从事舞蹈教学5年，擅长爵士舞和韩舞',
          sort_order: 1,
          status: 'active'
        },
        {
          name: '王老师',
          phone: '13900139002',
          gender: 2,
          avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
          store_id: stores[0]._id,
          dance_styles: ['古典舞', '中国舞'],
          description: '专业舞蹈学院毕业，擅长中国古典舞',
          sort_order: 2,
          status: 'active'
        },
        {
          name: '张老师',
          phone: '13900139003',
          gender: 1,
          avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
          store_id: stores[1]._id,
          dance_styles: ['街舞', '流行舞'],
          description: '街舞教练，擅长Breaking和Popping',
          sort_order: 1,
          status: 'active'
        }
      ]);
      console.log(`  ✓ 成功创建 ${coaches.length} 个教练`);
    } else {
      console.log(`  - 跳过 (已有 ${coachCount} 个教练)`);
    }

    // 5. 初始化管理员账号
    console.log('\n[5/7] 初始化管理员账号...');
    const adminCount = await User.countDocuments({ user_type: 'admin' });
    if (adminCount === 0 && stores.length > 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = await User.create({
        username: 'admin',
        password: hashedPassword,
        user_type: 'admin',
        role: 'super_admin',
        real_name: '超级管理员',
        phone: '13800138000',
        member_status: 'official',
        status: 'active',
        store_id: stores[0]._id
      });
      console.log(`  ✓ 成功创建超级管理员`);
      console.log(`    账号: admin`);
      console.log(`    密码: admin123`);
      console.log(`    ⚠️  请登录后立即修改密码！`);
    } else {
      console.log(`  - 跳过 (已有管理员账号)`);
    }

    // 6. 初始化店长和店员账号
    console.log('\n[6/7] 初始化门店管理账号...');
    const staffCount = await User.countDocuments({ 
      user_type: 'admin', 
      role: { $in: ['store_manager', 'staff'] } 
    });
    if (staffCount === 0 && stores.length > 0) {
      const hashedPassword = await bcrypt.hash('123456', 10);
      const staffAccounts = [];
      
      // 为每个门店创建店长和店员
      for (const store of stores) {
        staffAccounts.push({
          username: `${store.code}_manager`,
          password: hashedPassword,
          user_type: 'admin',
          role: 'store_manager',
          real_name: `${store.name}店长`,
          phone: `13800138${stores.indexOf(store) + 10}`,
          member_status: 'official',
          status: 'active',
          store_id: store._id
        });
        staffAccounts.push({
          username: `${store.code}_staff`,
          password: hashedPassword,
          user_type: 'admin',
          role: 'staff',
          real_name: `${store.name}店员`,
          phone: `13800138${stores.indexOf(store) + 20}`,
          member_status: 'official',
          status: 'active',
          store_id: store._id
        });
      }
      
      await User.insertMany(staffAccounts);
      console.log(`  ✓ 成功创建 ${staffAccounts.length} 个门店管理账号`);
      staffAccounts.forEach(a => {
        console.log(`    - ${a.username} / 123456`);
      });
    } else {
      console.log(`  - 跳过 (已有门店管理账号)`);
    }

    // 7. 初始化Banner
    console.log('\n[7/7] 初始化Banner...');
    const bannerCount = await Banner.countDocuments();
    if (bannerCount === 0) {
      const banners = await Banner.insertMany([
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
      ]);
      console.log(`  ✓ 成功创建 ${banners.length} 个Banner`);
    } else {
      console.log(`  - 跳过 (已有 ${bannerCount} 个Banner)`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ 系统数据初始化完成！');
    console.log('='.repeat(50));
    console.log('\n快速开始:');
    console.log('  1. 启动服务: npm run dev');
    console.log('  2. 管理端登录: admin / admin123');
    console.log('  3. 创建会员、排课等业务数据');
    console.log('\n' + '='.repeat(50));

  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedAll();
