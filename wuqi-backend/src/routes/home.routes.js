const router = require('express').Router();
const auth = require('../middleware/auth');
const Banner = require('../models/Banner');
const Coach = require('../models/Coach');
const DanceStyle = require('../models/DanceStyle');
const Video = require('../models/Video');
const Schedule = require('../models/Schedule');
const Package = require('../models/Package');
const User = require('../models/User');
const Booking = require('../models/Booking');
const dayjs = require('dayjs');
const { success } = require('../utils/response');

// GET /api/v1/home/member - 会员端首页数据
router.get('/member', async (req, res, next) => {
  try {
    const today = dayjs().format('YYYY-MM-DD');

    // 轮播图
    const banners = await Banner.find({ status: 'active' })
      .sort({ sort_order: 1 })
      .limit(5);

    // 热门教练
    const hotCoaches = await Coach.find({ status: 'active' })
      .populate('dance_styles', 'name')
      .sort({ created_at: -1 })
      .limit(6);

    // 热门课程(今日及以后的排课)
    const hotCourses = await Schedule.find({
      date: { $gte: today },
      status: { $in: ['available', 'full'] },
    })
      .populate('store_id', 'name')
      .populate('coach_id', 'name avatar_url')
      .populate('dance_style_id', 'name icon_url')
      .sort({ date: 1, start_time: 1 })
      .limit(10);

    // 舞种列表
    const danceStyles = await DanceStyle.find({ status: 'active' })
      .sort({ sort_order: 1 });

    // 推荐视频
    const videos = await Video.find({ status: 'active', is_free: true })
      .populate('dance_style_id', 'name')
      .populate('coach_id', 'name')
      .sort({ sort_order: 1, created_at: -1 })
      .limit(6);

    // 套餐列表
    const packages = await Package.find({ status: 'active', is_popular: true })
      .sort({ sort_order: 1 })
      .limit(4);

    res.json(success({ banners, hotCoaches, hotCourses, danceStyles, videos, packages }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/home/admin - 管理端首页数据
router.get('/admin', auth, async (req, res, next) => {
  try {
    const today = dayjs().format('YYYY-MM-DD');
    const thisMonthStart = dayjs().startOf('month').format('YYYY-MM-DD');

    // 统计数据
    const totalMembers = await User.countDocuments({ user_type: 'member' });
    const officialMembers = await User.countDocuments({ user_type: 'member', member_status: 'official' });
    const todaySchedules = await Schedule.countDocuments({ date: today, status: { $in: ['available', 'full'] } });
    const todayBookings = await Booking.countDocuments({
      booking_date: today,
      $or: [{ status: 'booked' }, { booking_status: 'booked' }],
    });

    // 本月预约统计
    const monthBookings = await Booking.countDocuments({
      booking_date: { $gte: thisMonthStart },
    });
    const monthCompleted = await Booking.countDocuments({
      booking_date: { $gte: thisMonthStart },
      $or: [{ status: 'completed' }, { booking_status: 'completed' }],
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

    // 今日排课列表
    const todayScheduleList = await Schedule.find({
      date: today,
      status: { $in: ['available', 'full'] },
    })
      .populate('coach_id', 'name')
      .populate('dance_style_id', 'name')
      .populate('store_id', 'name')
      .sort({ start_time: 1 });

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
    let filter = { status: 'active' };

    let coaches = [];
    
    if (store_id) {
      filter.store_id = store_id;
      coaches = await Coach.find(filter)
        .populate('dance_styles', 'name')
        .sort({ created_at: -1 })
        .limit(Number(limit));
    }
    
    if (coaches.length === 0) {
      filter = { status: 'active' };
      coaches = await Coach.find(filter)
        .populate('dance_styles', 'name')
        .sort({ created_at: -1 })
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

// GET /api/v1/home/videos - 获取首页视频列表
router.get('/videos', async (req, res, next) => {
  try {
    const { dance_style_id, coach_id, limit = 10 } = req.query;
    const filter = { status: 'active' };
    if (dance_style_id) filter.dance_style_id = dance_style_id;
    if (coach_id) filter.coach_id = coach_id;

    const videos = await Video.find(filter)
      .populate('dance_style_id', 'name')
      .populate('coach_id', 'name avatar_url')
      .sort({ sort_order: 1, created_at: -1 })
      .limit(Number(limit));
    res.json(success(videos));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
