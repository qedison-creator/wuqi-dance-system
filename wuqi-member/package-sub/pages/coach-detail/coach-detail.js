const app = getApp();
const { request } = require('../../../utils/request');
const { checkLogin } = require('../../../utils/auth');
const auth = require('../../../utils/auth');
const config = require('../../../config/index.js');
const { normalizeImageUrl } = require('../../../utils/util');

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekday(dateStr) {
  const d = new Date(dateStr);
  return WEEKDAYS[d.getDay()];
}

function getDanceTagColor(styleName) {
  if (!styleName) return { bg: '#9B89FF', text: '#FFFFFF' };
  if (styleName.indexOf('古典舞') !== -1 || styleName === '古典舞') {
    return { bg: '#F8D57E', text: '#6B5B2E' };
  }
  if (styleName.indexOf('韩舞') !== -1 || styleName === '韩舞') {
    return { bg: '#FF9EC5', text: '#FFFFFF' };
  }
  if (styleName.indexOf('街舞') !== -1 || styleName === '街舞') {
    return { bg: '#FF8A7A', text: '#FFFFFF' };
  }
  if (styleName.indexOf('流行舞') !== -1 || styleName === '流行舞') {
    return { bg: '#A0D4FF', text: '#FFFFFF' };
  }
  var hash = 0;
  for (var i = 0; i < styleName.length; i++) {
    hash = ((hash << 5) - hash) + styleName.charCodeAt(i);
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  var TAG_COLORS = [
    '#9B89FF',
    '#8DD0C9',
    '#D4A6FF',
    '#FFCE8A',
    '#A0D4FF',
    '#B8E5A8',
    '#FFC4D0',
    '#C8C6FF'
  ];
  return { bg: TAG_COLORS[hash % TAG_COLORS.length], text: '#FFFFFF' };
}

const SERVER_BASE = config.serverBase;

Page({
  data: {
    coachId: '',
    coach: null,
    danceStyleText: '',
    courses: [],
    loading: true,
    isOfficial: false,
    showBookingModal: false,
    bookingModalText: '',
    bookingModalCourse: null,
    isLoggedInShowing: false,
    imageErrors: {},
    images: [],
    bookedScheduleIds: [],
    waitlistedScheduleIds: [],
    showWaitlistModal: false,
    waitlistCourse: null,
    waitlistModalText: '',
    canViewCapacity: false,
    isPackageSuspended: false,
    bookingWindowDays: 7,
    completedScheduleIds: [],
    isRestrictedUser: false,
    restrictedReason: '',
    memberPackageStoreIds: []
  },

  onLoad(options) {
    const userInfo = app.globalData.userInfo || {};
    const isOfficial = userInfo.member_status === 'official';
    const { checkLogin } = require('../../../utils/auth');
    const isLoggedIn = checkLogin();
    this.setData({ 
      isOfficial,
      isRestrictedUser: !isLoggedIn || !isOfficial,
      restrictedReason: !isLoggedIn ? '您不是正式会员，请联系门店办理' : (!isOfficial ? '您不是正式会员，请联系门店办理' : '')
    });
    if (options.id) {
      this.setData({ coachId: options.id });
      this.loadCoachDetail(options.id);
      this.loadUserPackages();
    }
  },

  onShow() {
    // 预加载消息模板（网络请求），确保点击预约时 requestBookingSubscribe 使用缓存模板
    // 避免点击时的网络请求破坏微信 tap gesture 上下文导致授权弹窗静默失败
    const { fetchTemplates } = require('../../../utils/subscribe-message');
    fetchTemplates(true).catch(() => {});

    if (this.data.coach && this.data.coach.name) {
      wx.setNavigationBarTitle({ title: this.data.coach.name });
    }
  },

  loadUserPackages() {
    const { checkLogin } = require('../../../utils/auth');
    if (!checkLogin()) {
      this.setData({ 
        isRestrictedUser: true, 
        restrictedReason: '您不是正式会员，请联系门店办理' 
      });
      return;
    }
    Promise.all([
      request({ url: '/packages/my' }),
      request({ url: '/auth/me', silent: true })
    ]).then(([pkgRes, authRes]) => {
      const data = pkgRes.data || {};
      const hasActive = data.current;
      const hasPending = data.pending && data.pending.length > 0;
      const isSuspended = data.hasSuspended && !hasActive;
      this.setData({ 
        isPackageSuspended: isSuspended,
        canViewCapacity: hasActive || hasPending
      });
      // 计算受限用户状态和原因
      const authData = authRes && authRes.data ? authRes.data : app.globalData.userInfo;
      const isOfficial = authData && authData.member_status === 'official';
      this.setData({ isOfficial });
      const restrictedReason = this._computeRestrictedReason(authData, data);
      const isRestrictedUser = !!restrictedReason;
      this.setData({ isRestrictedUser, restrictedReason });
      // 保存套餐门店列表
      const packages = data.history || [];
      const storeIds = new Set();
      packages.forEach(pkg => {
        if (pkg.store_id) {
          const sid = typeof pkg.store_id === 'string' ? pkg.store_id : (pkg.store_id._id || pkg.store_id);
          if (sid) storeIds.add(String(sid));
        }
        // 附加门店（跨店使用）
        if (Array.isArray(pkg.extra_store_ids)) {
          pkg.extra_store_ids.forEach(eid => {
            const sid = typeof eid === 'string' ? eid : (eid._id || eid);
            if (sid) storeIds.add(String(sid));
          });
        }
      });
      this.setData({ memberPackageStoreIds: Array.from(storeIds) });
      // 套餐门店列表加载完成后，重新校准已加载课程列表的 courseStoreMatched 字段
      // 解决 onLoad 中 loadCoachDetail 与 loadUserPackages 并行调用导致 memberPackageStoreIds 为空时计算错误的问题
      this._recalcCoursesStoreMatched();
      this.loadCompletedBookings();
    }).catch(() => {});
  },

  // 重新校准已加载课程的门店匹配状态（解决并行加载导致 memberPackageStoreIds 滞后的问题）
  _recalcCoursesStoreMatched() {
    const courses = this.data.courses;
    if (!courses || courses.length === 0) return;
    const storeIds = this.data.memberPackageStoreIds || [];
    const updated = courses.map(course => {
      const courseStoreId = course.store_id ? (typeof course.store_id === 'string' ? course.store_id : (course.store_id._id || course.store_id)) : '';
      return {
        ...course,
        courseStoreMatched: !courseStoreId || storeIds.includes(String(courseStoreId))
      };
    });
    this.setData({ courses: updated });
  },

  // 计算受限用户原因（空字符串表示不受限）
  _computeRestrictedReason(authData, pkgData) {
    if (!authData || authData.member_status !== 'official') {
      return '您不是正式会员，请联系门店办理';
    }
    if (pkgData.hasSuspended && !pkgData.current) {
      return '您的套餐暂停使用中';
    }
    const packages = pkgData.history || [];
    if (packages.length === 0) {
      return '您暂无可用套餐，请联系门店开通';
    }
    const hasValid = packages.some(pkg => {
      if (pkg.status === 'pending') return true;
      if (pkg.status !== 'active' || pkg.is_suspended) return false;
      if (pkg.is_activated && pkg.end_date && new Date() > new Date(pkg.end_date)) return false;
      if (pkg.package_type === 'count_card' && (pkg.remaining_credits || 0) === 0) return false;
      return true;
    });
    if (hasValid) {
      // 时间卡周期限制检查：只有时间卡套餐且周期次数用完时阻止预约
      const timeCardUsage = pkgData.timeCardUsage;
      if (timeCardUsage) {
        const hasOtherValidPackage = packages.some(pkg => {
          if (pkg.package_type === 'time_card') return false;
          if (pkg.status === 'pending') return true;
          if (pkg.status !== 'active' || pkg.is_suspended) return false;
          if (pkg.is_activated && pkg.end_date && new Date() > new Date(pkg.end_date)) return false;
          if (pkg.package_type === 'count_card' && (pkg.remaining_credits || 0) === 0) return false;
          return true;
        });
        if (!hasOtherValidPackage) {
          const dailyExhausted = timeCardUsage.daily_remaining === 0 && timeCardUsage.daily_limit > 0;
          const weeklyExhausted = timeCardUsage.weekly_remaining === 0 && timeCardUsage.weekly_limit > 0;
          if (dailyExhausted) return '今日次数已用完，请明天再约';
          if (weeklyExhausted) return '本周次数已用完，请下周再约';
        }
      }
      return '';
    }
    const hasExpired = packages.some(pkg => {
      if (pkg.status !== 'active') return false;
      if (pkg.is_suspended) return false;
      return pkg.is_activated && pkg.end_date && new Date() > new Date(pkg.end_date);
    });
    if (hasExpired) return '您的套餐已过期，请续费或联系门店';
    const hasCountCardUsedUp = packages.some(pkg => {
      if (pkg.status !== 'active') return false;
      if (pkg.is_suspended) return false;
      if (pkg.package_type !== 'count_card') return false;
      return (pkg.remaining_credits || 0) === 0;
    });
    if (hasCountCardUsedUp) return '您的次卡次数已用完，请购买新套餐';
    return '您暂无可用套餐，请联系门店开通';
  },

  // 加载已完成的课程记录
  loadCompletedBookings() {
    if (!this.data.isOfficial) {
      this.setData({ completedScheduleIds: [] });
      return;
    }
    request({ url: '/bookings/my?type=completed&pageSize=100', silent: true }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const completedScheduleIds = list.map(b => {
        if (b.schedule_id) {
          return String(b.schedule_id._id || b.schedule_id);
        }
        return null;
      }).filter(Boolean);
      this.setData({ completedScheduleIds });
    }).catch(() => {
      this.setData({ completedScheduleIds: [] });
    });
  },

  onPullDownRefresh() {
    if (this.data.coachId) {
      this.loadCoachDetail(this.data.coachId).then(() => {
        wx.stopPullDownRefresh();
      }).catch(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  loadMyBookings() {
    if (!this.data.isOfficial) {
      this.setData({ bookedScheduleIds: [] });
      return;
    }
    request({ url: '/bookings/my?type=booked&pageSize=50', silent: true }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const bookedScheduleIds = list.map(b => {
        if (b.schedule_id) {
          return String(b.schedule_id._id || b.schedule_id);
        }
        return null;
      }).filter(Boolean);
      this.setData({ bookedScheduleIds });
    }).catch(() => {
      this.setData({ bookedScheduleIds: [] });
    });
  },

  loadMyWaitlists() {
    if (!this.data.isOfficial) {
      this.setData({ waitlistedScheduleIds: [] });
      return;
    }
    request({ url: '/bookings/waitlist/my', silent: true }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const waitlistedScheduleIds = list.map(w => {
        if (w.schedule_id) {
          return String(w.schedule_id._id || w.schedule_id);
        }
        return null;
      }).filter(Boolean);
      this.setData({ waitlistedScheduleIds });
    }).catch(() => {
      this.setData({ waitlistedScheduleIds: [] });
    });
  },

  cmpContains(arr, id) {
    if (!arr || !arr.length) return false;
    return arr.indexOf(String(id)) !== -1;
  },

  loadCoachDetail(id) {
    this.setData({ loading: true });

    // 获取预约开放窗口配置
    const bookingWindowPromise = request({ url: '/config/public/booking-window', method: 'GET', silent: true }).then(res => {
      const days = (res.data && res.data.booking_window_days) ? parseInt(res.data.booking_window_days, 10) : 7;
      this.setData({ bookingWindowDays: days || 7 });
      return days || 7;
    }).catch(() => 7);

    const coachPromise = request({ url: `/coaches/${id}` }).then(res => {
      const coachData = res.data || {};
      const coach = {
        _id: coachData._id || '',
        name: coachData.name || '未知教练',
        avatar_url: normalizeImageUrl(coachData.avatar_url, SERVER_BASE) || '/images/default-avatar.svg',
        dance_styles: coachData.dance_styles || [],
        introduction: coachData.introduction || ''
      };
      const danceStyleNames = coach.dance_styles
        ? coach.dance_styles.map(ds => ds.name || '未知舞种')
        : [];
      const danceStyleText = danceStyleNames.join(' / ');

      this.setData({ coach, danceStyleText });

      wx.setNavigationBarTitle({ title: coach.name });

      return coach;
    }).catch((err) => {
      console.error('[CoachDetail] 获取教练详情失败:', err);
      wx.showToast({ title: '获取教练信息失败', icon: 'none' });
      return null;
    });

    const today = formatDate(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    const endDateStr = formatDate(endDate);
    
    // 当前分钟数（用于判断课程状态）
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    const schedulesPromise = Promise.all([bookingWindowPromise, request({ url: '/schedules', data: { coach_id: id, status: 'all', start_date: today, end_date: endDateStr, limit: 50 } })]).then(([bookingWindowDays, res]) => {
      const data = res.data || {};
      const allSchedules = data.list || (Array.isArray(data) ? data : []);
      const courses = allSchedules.filter(s => {
        if (!s.date) return false;
        if (s.status === 'cancelled' || s.status === 'offline') return false;
        return s.date >= today && s.date <= endDateStr;
      }).map(schedule => {
        const danceStyleName = schedule.dance_style_id && schedule.dance_style_id.name ? schedule.dance_style_id.name : '';
        const tagColor = getDanceTagColor(danceStyleName);
        const weekday = getWeekday(schedule.date);
        // 使用年月日构造日期对象，消除时分秒对天数差计算的干扰
        const scheduleParts = schedule.date.split('-');
        const target = new Date(parseInt(scheduleParts[0]), parseInt(scheduleParts[1]) - 1, parseInt(scheduleParts[2]));
        const todayParts = today.split('-');
        const todayDate = new Date(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2]));
        const diffDays = Math.floor((target - todayDate) / (1000 * 60 * 60 * 24));
        // 计算课程状态
        const isToday = schedule.date === todayStr;
        let startMin = null;
        let endMin = null;
        if (schedule.start_time) {
          const s = String(schedule.start_time).split(':');
          if (s.length >= 2) startMin = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
        }
        if (schedule.end_time) {
          const e = String(schedule.end_time).split(':');
          if (e.length >= 2) endMin = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
        }
        const _started = isToday && startMin !== null && currentMin >= startMin;
        const _ended = isToday && endMin !== null && currentMin >= endMin;
        const _ongoing = _started && !_ended;
        // 判断课程门店是否匹配会员套餐门店
        const courseStoreId = schedule.store_id ? (typeof schedule.store_id === 'string' ? schedule.store_id : (schedule.store_id._id || schedule.store_id)) : '';
        const courseStoreMatched = !courseStoreId || this.data.memberPackageStoreIds.includes(String(courseStoreId));
        // 归一化已预约会员头像 URL
        const rawBookedUsers = Array.isArray(schedule.booked_users) ? schedule.booked_users : [];
        const booked_users = rawBookedUsers.map(u => ({
          user_id: String(u.user_id || u._id || ''),
          avatar_url: u.avatar_url ? normalizeImageUrl(u.avatar_url, SERVER_BASE) : '/images/default-avatar.svg'
        }));
        return {
          ...schedule,
          _id: String(schedule._id),
          danceStyleName,
          danceTagBg: tagColor.bg,
          danceTagText: tagColor.text,
          weekday,
          bookingOpen: diffDays >= 0 && diffDays < bookingWindowDays,
          _started,
          _ended,
          _ongoing,
          courseStoreMatched,
          booked_users
        };
      });
      this.setData({ courses });
      return courses;
    }).catch((err) => {
      console.error('[CoachDetail] 获取课程列表失败:', err);
      return [];
    });
    
    this.loadMyBookings();
    this.loadMyWaitlists();
    this.loadCoachImages(id);

    return Promise.all([coachPromise, schedulesPromise])
      .then(() => {
        this.setData({ loading: false });
      })
      .catch((err) => {
        console.error('[CoachDetail] 加载数据出错:', err);
        this.setData({ loading: false });
      });
  },

  loadCoachImages(coachId) {
    request({ url: `/images?coach_id=${coachId}&pageSize=100`, silent: true }).then(res => {
      const data = res.data || {};
      const list = data.list || (Array.isArray(data) ? data : []);
      const images = list.map(img => ({
        ...img,
        image_url: normalizeImageUrl(img.image_url, SERVER_BASE),
        thumbnail_url: normalizeImageUrl(img.thumbnail_url, SERVER_BASE)
      }));
      this.setData({ images, imageUrls: images.map(i => i.image_url) });
    }).catch(() => {
      this.setData({ images: [] });
    });
  },

  onCourseTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/package-sub/pages/course-detail/course-detail?id=${id}`
    });
  },

  onPhotoTap(e) {
    this.onPreviewGallery(e);
  },

  onBookTap(e) {
    // 受限用户点击"不可预约"按钮，提示对应原因
    if (this.data.isRestrictedUser) {
      const { checkLogin } = require('../../../utils/auth');
      if (!checkLogin()) {
        this.setData({ isLoggedInShowing: true });
        return;
      }
      const course = e.currentTarget.dataset.course;
      const courseId = course ? String(course._id) : '';
      // 已预约的课程：提示用户进入课程详情页取消
      if (courseId && this.cmpContains(this.data.bookedScheduleIds, course._id)) {
        wx.showToast({ title: '您已预约该课程。如需取消，请在课程详情页面中操作', icon: 'none', duration: 2500 });
        return;
      }
      wx.showModal({
        title: '无法预约',
        content: this.data.restrictedReason,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#D4786E'
      });
      return;
    }

    if (!auth.requireLogin()) return;
    auth.requireMember(() => {
      const course = e.currentTarget.dataset.course;
      if (!course) return;
      
      // 套餐停卡中，拦截预约
      if (this.data.isPackageSuspended) {
        wx.showModal({
          title: '无法预约',
          content: '您的套餐暂停使用中，不能进行预约课程操作。',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#D4786E'
        });
        return;
      }
      
      // 门店不匹配
      if (course.courseStoreMatched === false) {
        wx.showModal({
          title: '提示',
          content: '您未办理该门店的套餐，无法预约此课程。',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#D4786E'
        });
        return;
      }
      
      // 未开放预约
      if (course && !course.bookingOpen) {
        return;
      }
      
      if (this.cmpContains(this.data.bookedScheduleIds, course._id)) {
        wx.showToast({ title: '您已预约该课程。如需取消，请在课程详情页面中操作', icon: 'none' });
        return;
      }
      
      if (course.status === 'full') {
        this.setData({
          showWaitlistModal: true,
          waitlistCourse: course,
          waitlistModalText: `确认加入「${course.course_name}」的候补队列？\n时间：${course.date} ${course.start_time} - ${course.end_time}\n教练：${course.coach_id ? course.coach_id.name : '待定'}`
        });
        return;
      }
      
      // 判断是否为补约场景：当前时间已过预约截止时间（开课前 booking_deadline 分钟）
      let lateBookingTip = '';
      if (course.date && course.start_time) {
        const classStart = new Date(`${course.date} ${course.start_time}`.replace(/-/g, '/'));
        const bookingDeadlineMin = course.booking_deadline || 120;
        const deadline = new Date(classStart.getTime() - bookingDeadlineMin * 60000);
        if (new Date() > deadline) {
          lateBookingTip = '\n\n本课程已过预约截止时间，属补约。预约后5分钟内可取消（退课时），超时需使用豁免权取消。';
        }
      }
      this.setData({
        showBookingModal: true,
        bookingModalCourse: course,
        bookingModalText: `确认预约「${course.course_name}」？\n时间：${course.date} ${course.start_time} - ${course.end_time}\n教练：${course.coach_id ? course.coach_id.name : '待定'}${lateBookingTip}`
      });
    });
  },



  onConfirmWaitlist() {
    const course = this.data.waitlistCourse;
    if (!course || !course._id) return;
    this.setData({ showWaitlistModal: false });
    wx.showLoading({ title: '加入候补...' });
    request({
      url: '/bookings/waitlist',
      method: 'POST',
      data: { schedule_id: course._id }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已加入候补队列', icon: 'success' });
      this.loadMyWaitlists();
    }).catch(err => {
      wx.hideLoading();
      const errMsg = err.message || '加入候补失败';
      if (errMsg.includes('已在候补')) {
        wx.showToast({ title: '您已在候补队列中', icon: 'none' });
      } else {
        wx.showToast({ title: errMsg, icon: 'none' });
      }
    });
  },

  onCancelWaitlist() {
    this.setData({ showWaitlistModal: false, waitlistCourse: null, waitlistModalText: '' });
  },

  onConfirmBookingModal() {
    const course = this.data.bookingModalCourse;
    this.setData({ showBookingModal: false, bookingModalCourse: null, bookingModalText: '' });
    if (course && course._id) {
      this.doBook(course._id);
    }
  },

  onCancelBookingModal() {
    this.setData({ showBookingModal: false, bookingModalCourse: null, bookingModalText: '' });
  },

  onModalTap() {},

  onCancelLoginModal() {
    this.setData({ isLoggedInShowing: false });
  },

  onGoLogin() {
    this.setData({ isLoggedInShowing: false });
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  onPreviewGallery(e) {
    const index = e.currentTarget.dataset.index;
    const current = this.data.images[index];
    if (!current) return;
    wx.previewImage({
      current: current.image_url,
      urls: this.data.imageUrls
    });
  },

  async doBook(scheduleId) {
    try {
      // 检查是否有待激活套餐，如果有则连同套餐激活通知一起授权
      let hasPendingPackage = false;
      try {
        const pkgCheck = await request({ url: '/packages/my', silent: true });
        const pkgData = (pkgCheck && pkgCheck.data) ? pkgCheck.data : {};
        const pending = pkgData.pending || [];
        const active = pkgData.active || [];
        hasPendingPackage = pending.length > 0 && active.length === 0;
      } catch (e) { /* 忽略检查失败 */ }

      // 先弹消息授权弹窗，确保订阅先生效（避免后端提前发送通知导致 43101 错误）
      const { requestBookingSubscribe, requestBookingAndActivationSubscribe, getAcceptedTemplates } = require('../../../utils/subscribe-message');
      const subscribeFn = hasPendingPackage ? requestBookingAndActivationSubscribe : requestBookingSubscribe;
      const subscribeResult = await subscribeFn();
      const acceptedTemplates = getAcceptedTemplates(subscribeResult);

      // 授权完成后再发起API请求
      await request({
        url: '/bookings',
        method: 'POST',
        data: { schedule_id: scheduleId }
      });

      // 更新页面数据和按钮状态
      await this.refreshCourses();
      this.loadUserPackages();

      // 最后弹成功提示
      if (acceptedTemplates.length > 0) {
        wx.showModal({
          title: '预约成功',
          content: '已为您开启上课提醒，课程开始前将收到通知',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#D4786E'
        });
      } else {
        wx.showToast({ title: '预约成功', icon: 'success' });
      }
    } catch (err) {
      wx.showToast({ title: err.message || '预约失败', icon: 'none' });
    }
  },

  refreshCourses() {
    const { coachId } = this.data;
    if (!coachId) return Promise.resolve();

    const today = formatDate(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    const endDateStr = formatDate(endDate);
    
    // 当前分钟数（用于判断课程状态）
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    return request({ url: '/schedules', data: { coach_id: coachId, limit: 50 } }).then(res => {
      const data = res.data || {};
      const allSchedules = data.list || (Array.isArray(data) ? data : []);
      const courses = allSchedules.filter(s => {
        if (!s.date) return false;
        if (s.status === 'cancelled' || s.status === 'offline') return false;
        return s.date >= today && s.date <= endDateStr;
      }).map(schedule => {
        const danceStyleName = schedule.dance_style_id && schedule.dance_style_id.name ? schedule.dance_style_id.name : '';
        const tagColor = getDanceTagColor(danceStyleName);
        const weekday = getWeekday(schedule.date);
        // 计算课程状态
        const isToday = schedule.date === todayStr;
        let startMin = null;
        let endMin = null;
        if (schedule.start_time) {
          const s = String(schedule.start_time).split(':');
          if (s.length >= 2) startMin = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
        }
        if (schedule.end_time) {
          const e = String(schedule.end_time).split(':');
          if (e.length >= 2) endMin = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
        }
        const _started = isToday && startMin !== null && currentMin >= startMin;
        const _ended = isToday && endMin !== null && currentMin >= endMin;
        const _ongoing = _started && !_ended;
        // 判断课程门店是否匹配
        const courseStoreId = schedule.store_id ? (typeof schedule.store_id === 'string' ? schedule.store_id : (schedule.store_id._id || schedule.store_id)) : '';
        const courseStoreMatched = !courseStoreId || this.data.memberPackageStoreIds.includes(String(courseStoreId));
        return {
          ...schedule,
          _id: String(schedule._id),
          danceStyleName,
          danceTagBg: tagColor.bg,
          danceTagText: tagColor.text,
          weekday,
          _started,
          _ended,
          _ongoing,
          courseStoreMatched
        };
      });
      this.setData({ courses });
      this.loadMyBookings();
      this.loadMyWaitlists();
      return courses;
    }).catch((err) => {
      console.error('[CoachDetail] 刷新课程列表失败:', err);
      return [];
    });
  },

  onShareAppMessage() {
    const { coach } = this.data;
    return {
      title: coach ? `${coach.name} - 舞栖舞蹈社` : '教练详情',
      path: `/package-sub/pages/coach-detail/coach-detail?id=${this.data.coachId}`
    };
  },

  onImgError(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (!type || !id) return;
    this.setData({ ['imageErrors.' + type + '_' + id]: true });
  }
});
