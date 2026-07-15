const router = require('express').Router();
const auth = require('../middleware/auth');
const Banner = require('../models/Banner');
const Coach = require('../models/Coach');
const DanceStyle = require('../models/DanceStyle');
const Schedule = require('../models/Schedule');
const Package = require('../models/Package');
const Image = require('../models/Image');
const User = require('../models/User');
const Booking = require('../models/Booking');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const { success } = require('../utils/response');
const fs = require('fs');
const path = require('path');

// GET /api/v1/home/member - 会员端首页数据
router.get('/member', async (req, res, next) => {
  try {
    const today = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');

    // 轮播图
    const banners = await Banner.find({ status: 'active' })
      .sort({ sort_order: 1 })
      .limit(5);

    // 热门教练（按排序，只展示开启首页可见的，不限制数量）
    const hotCoaches = await Coach.find({ status: 'active', show_on_home: { $ne: false }, is_deleted: { $ne: true } })
      .populate('dance_styles', 'name')
      .sort({ sort_order: 1, created_at: -1 });

    // 热门课程(今日及以后的排课)
    const hotCourseDocs = await Schedule.find({
      date: { $gte: today },
      status: { $in: ['available', 'full'] },
    })
      .populate('store_id', 'name')
      .populate('coach_id', 'name avatar_url')
      .populate('dance_style_id', 'name icon_url')
      .sort({ date: 1, start_time: 1 })
      .limit(10);

    // 转为普通对象并处理封面图片URL
    const host = `${req.protocol}://${req.get('host')}`;
    const hotCourses = hotCourseDocs.map(course => {
      const obj = course.toObject ? course.toObject() : course;
      if (obj.cover && !obj.cover.startsWith('http')) {
        obj.cover = `${host}${obj.cover}`;
      }
      return obj;
    });

    // 舞种列表
    const danceStyles = await DanceStyle.find({ status: 'active' })
      .sort({ sort_order: 1 });

    // 套餐列表
    const packages = await Package.find({ status: 'active', is_popular: true })
      .sort({ sort_order: 1 })
      .limit(4);

    res.json(success({ banners, hotCoaches, hotCourses, danceStyles, packages }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/admin - 管理端首页数据
router.get('/admin', auth, async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const today = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
    const thisMonthStart = dayjs().tz('Asia/Shanghai').startOf('month').format('YYYY-MM-DD');

    const storeFilter = {};
    if (store_id) storeFilter.store_id = store_id;

    // 统计数据
    const totalMembers = await User.countDocuments({ user_type: 'member', member_status: 'official', ...storeFilter });
    const officialMembers = await User.countDocuments({ user_type: 'member', member_status: 'official', ...storeFilter });
    // 今日课程数：统计今日有效排课（排除已删除和已取消，避免数量虚高）
    const todaySchedules = await Schedule.countDocuments({ ...storeFilter, date: today, status: { $nin: ['deleted', 'cancelled'] } });
    const todayBookings = await Booking.countDocuments({
      ...storeFilter,
      booking_date: today,
      status: 'booked',
    });

    // 本月预约统计
    const monthBookings = await Booking.countDocuments({
      booking_date: { $gte: thisMonthStart },
    });
    const monthCompleted = await Booking.countDocuments({
      booking_date: { $gte: thisMonthStart },
      status: 'completed',
    });
    const monthCancelled = await Booking.countDocuments({
      booking_date: { $gte: thisMonthStart },
      status: 'cancelled',
    });

    // 待办事项
    const pendingReview = await User.countDocuments({
      user_type: 'member',
      member_status: 'registered',
    });

    // 今日排课列表（排除已删除和已取消，带动态状态修正）
    const todayScheduleDocs = await Schedule.find({
      ...storeFilter,
      date: today,
      status: { $nin: ['deleted', 'cancelled'] },
    })
      .populate('coach_id', 'name')
      .populate('dance_style_id', 'name')
      .populate('store_id', 'name')
      .sort({ start_time: 1 });

    // 动态状态修正（与 getScheduleList 保持一致）
    // 注意：必须使用北京时间，不能使用 dayjs() 默认的服务器本地时间
    const now = dayjs().tz('Asia/Shanghai');
    const todayScheduleList = todayScheduleDocs.map(doc => {
      const s = doc.toObject ? doc.toObject() : doc;
      // 终态保持不变
      if (['cancelled', 'offline', 'deleted', 'completed'].includes(s.status)) {
        return s;
      }
      if (s.date && s.start_time && s.end_time) {
        const startDateTime = dayjs.tz(s.date + ' ' + s.start_time, 'Asia/Shanghai');
        const endDateTime = dayjs.tz(s.date + ' ' + s.end_time, 'Asia/Shanghai');
        if (endDateTime.isValid() && now.isAfter(endDateTime)) {
          // 已过下课时间 → 已完成
          s.status = 'completed';
        } else if (startDateTime.isValid() && now.isAfter(startDateTime) && s.status !== 'in_progress') {
          // 已过开课时间但未过下课时间 → 进行中
          s.status = 'in_progress';
        }
      }
      return s;
    });

    // 处理hero背景图URL（参照banners处理方式）
    const protocol = req.protocol;
    const host = req.get('host');
    const uploadsDir = path.join(__dirname, '../../uploads');
    const hour = dayjs().tz('Asia/Shanghai').hour();
    let theme;
    if (hour >= 5 && hour < 8) theme = 'sunrise';
    else if (hour >= 8 && hour < 12) theme = 'morning';
    else if (hour >= 12 && hour < 14) theme = 'noon';
    else if (hour >= 14 && hour < 17) theme = 'afternoon';
    else if (hour >= 17 && hour < 19) theme = 'sunset';
    else if (hour >= 19 && hour < 22) theme = 'night';
    else theme = 'late-night';

    let heroBackgroundUrl = '';
    const heroPath = `/uploads/hero/hero-${theme}.jpg`;
    if (fs.existsSync(path.join(uploadsDir, `hero/hero-${theme}.jpg`))) {
      heroBackgroundUrl = `${protocol}://${host}${heroPath}`;
    }

    res.json(success({
      stats: {
        total_members: totalMembers,
        official_members: officialMembers,
        today_schedules: todaySchedules,
        today_bookings: todayBookings,
        month_bookings: monthBookings,
        month_completed: monthCompleted,
        month_cancelled: monthCancelled,
      },
      pending_review: pendingReview,
      today_schedules: todayScheduleList,
      hero_background_url: heroBackgroundUrl,
    }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/banners - 获取首页轮播图
router.get('/banners', async (req, res, next) => {
  try {
    const banners = await Banner.find({ status: 'active' })
      .sort({ sort_order: 1 })
      .limit(10);
    
    // 处理图片 URL，确保返回完整路径
    const protocol = req.protocol;
    const host = req.get('host');
    const processedBanners = banners.map(banner => {
      const bannerObj = banner.toObject();
      if (bannerObj.image_url && !bannerObj.image_url.startsWith('http')) {
        bannerObj.image_url = `${protocol}://${host}${bannerObj.image_url}`;
      }
      return bannerObj;
    });
    
    res.json(success(processedBanners));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/dance-styles - 获取首页舞种列表
router.get('/dance-styles', async (req, res, next) => {
  try {
    const danceStyles = await DanceStyle.find({ status: 'active' })
      .sort({ sort_order: 1 });
    res.json(success(danceStyles));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/coaches - 获取首页教练列表
router.get('/coaches', async (req, res, next) => {
  try {
    const { store_id, limit = 10 } = req.query;
    let filter = { status: 'active', is_deleted: { $ne: true } };

    let coaches = [];
    
    if (store_id) {
      filter.store_id = store_id;
      coaches = await Coach.find(filter)
        .populate('dance_styles', 'name')
        .sort({ sort_order: 1, created_at: -1 })
        .limit(Number(limit));
    }
    
    if (coaches.length === 0) {
      filter = { status: 'active', is_deleted: { $ne: true } };
      coaches = await Coach.find(filter)
        .populate('dance_styles', 'name')
        .sort({ sort_order: 1, created_at: -1 })
        .limit(Number(limit));
    }
    
    res.json(success(coaches));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/packages - 获取首页套餐列表
router.get('/packages', async (req, res, next) => {
  try {
    const packages = await Package.find({ status: 'active' })
      .populate('dance_styles', 'name')
      .sort({ sort_order: 1 });
    res.json(success(packages));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/images - 获取首页图片列表
router.get('/images', async (req, res, next) => {
  try {
    const { limit } = req.query;
    let query = Image.find({ show_on_home: true })
      .populate('coach_ids', 'name avatar_url')
      .sort({ sort_order: -1, created_at: -1 });
    if (limit && Number(limit) > 0) {
      query = query.limit(Number(limit));
    }
    const images = await query.exec();
    res.json(success(images));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/courses - 获取课程列表（会员端课程列表页）
router.get('/courses', async (req, res, next) => {
  try {
    const { store_id } = req.query;
    const today = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
    const filter = {
      date: { $gte: today },
      status: { $in: ['available', 'full'] },
    };
    if (store_id) filter.store_id = store_id;

    const courseDocs = await Schedule.find(filter)
      .populate('store_id', 'name')
      .populate('coach_id', 'name avatar_url')
      .populate('dance_style_id', 'name icon_url')
      .sort({ date: 1, start_time: 1 });

    const host = `${req.protocol}://${req.get('host')}`;
    const courses = courseDocs.map(course => {
      const obj = course.toObject ? course.toObject() : course;
      if (obj.cover && !obj.cover.startsWith('http')) {
        obj.cover = `${host}${obj.cover}`;
      }
      return obj;
    });

    res.json(success(courses));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
