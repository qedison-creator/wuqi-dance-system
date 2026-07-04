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

const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate, getWeekDay, normalizeImageUrl } = require('../../../utils/util');
const auth = require('../../../utils/auth');
const config = require('../../../config/index.js');
const SERVER_BASE = config.serverBase;

Page({
  data: {
    courseId: '',
    course: null,
    loading: true,
    userPackages: null,
    userBookings: [],
    showActivationModal: false,
    showBookingModal: false,
    showCancelModal: false,
    showWaitlistModal: false,
    showLeaveWaitlistModal: false,
    bookingModalText: '',
    isOfficial: false,
    isBooked: false,
    isWaitlisted: false,
    waitlistPosition: 0,
    currentBookingId: null,
    currentWaitlistId: null,
    showLimitModal: false,
    limitModalText: '',
    showLoginModal: false,
    imageErrors: {},
    isLoggedIn: !!getApp().globalData.token,
    isPackageSuspended: false,
    canViewCapacity: false,
    bookingWindowOpen: true,
    canCancel: true,
    cancelPhase: '',
    exemptionCount: 0,
    completedScheduleIds: [],
    isRestrictedUser: false,
    restrictedReason: '',
    memberPackageStoreIds: [],
    courseStoreMatched: true,
    isCompleted: false,
    isEnded: false,
    isOngoing: false,
    isCancelled: false
  },

  async onLoad(options) {
    if (options.id) {
      const courseId = options.id;
      this.setData({ courseId });
      // 首次加载标记，跳过紧随其后的 onShow 重复请求
      this._firstLoad = true;
      // 先加载课程详情（最优先），再串行加载用户数据，避免冷启动并发请求过多导致 ERR_CONNECTION_RESET
      await this.loadCourseDetail(courseId);
      await this.loadUserBookingsInit();
      this.loadUserPackages();
      this.loadWaitlistStatus();
    }
  },

  onShow() {
    const { checkLogin } = require('../../../utils/auth');
    const isLoggedIn = checkLogin();
    this.setData({ isLoggedIn });
    if (isLoggedIn) {
      request({ url: '/auth/me', silent: true }).then(res => {
        if (res.data) {
          app.globalData.userInfo = res.data;
          this.setData({ isOfficial: res.data.member_status === 'official' });
        }
      }).catch(() => {
        const userInfo = app.globalData.userInfo || {};
        this.setData({ isOfficial: userInfo.member_status === 'official' });
      });
    } else {
      this.setData({ 
        isOfficial: false,
        isRestrictedUser: true,
        restrictedReason: '您不是正式会员，请联系门店办理'
      });
    }
    // 跳过 onLoad 后的首次 onShow，避免重复请求
    if (this._firstLoad) {
      this._firstLoad = false;
      return;
    }
    this.loadUserPackages();
    this.loadUserBookings();
    this.loadWaitlistStatus();
  },

  loadCourseDetail(id) {
    this.setData({ loading: true });
    request({ url: `/schedules/${id}` }).then(res => {
      const course = res.data || {};
      course.dateStr = formatDate(course.date, 'YYYY-MM-DD');
      course.weekDayStr = getWeekDay(course.date);
      course.name = course.course_name || '课程名称';
      course.coachName = course.coach_id && course.coach_id.name ? course.coach_id.name : '待定';
      course.startTime = course.start_time || '';
      course.endTime = course.end_time || '';
      course.room = course.classroom || '待定';
      course.bookedCount = course.current_bookings || 0;
      course.maxCount = course.max_bookings || 20;
      course.minBookings = course.min_bookings || 0;
      course.isFull = course.status === 'full';
      course.danceStyle = course.dance_style_id && course.dance_style_id.name ? course.dance_style_id.name : '舞蹈';
      const tagColor = getDanceTagColor(course.danceStyle);
      course.danceTagBg = tagColor.bg;
      course.danceTagText = tagColor.text;
      course.creditsCost = course.credits_cost || 1;
      // 规范化封面图URL
      course.cover = normalizeImageUrl(course.cover, SERVER_BASE);
      course.storeName = course.store_id && course.store_id.name ? course.store_id.name : '';
      // 标记课程是否已开始（用于按钮状态）
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentMin = now.getHours() * 60 + now.getMinutes();
      let _started = false;
      if (course.dateStr === todayStr && course.start_time) {
        const s = String(course.start_time).split(':');
        if (s.length >= 2) {
          const startMin = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
          _started = currentMin >= startMin;
        }
      }
      course._started = _started;
      // 计算课程结束/进行中/已取消状态
      let _ended = false;
      let _ongoing = false;
      if (course.dateStr === todayStr && course.end_time) {
        const e = String(course.end_time).split(':');
        if (e.length >= 2) {
          const endMin = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
          _ended = currentMin >= endMin;
        }
        _ongoing = _started && !_ended;
      }
      // 课程日期 < 今日也算已结束
      if (course.dateStr < todayStr) {
        _ended = true;
      }
      const _cancelled = course.status === 'cancelled';
      this.setData({ 
        course, 
        loading: false,
        isEnded: _ended,
        isOngoing: _ongoing,
        isCancelled: _cancelled
      });
      this._checkBookingWindow(course.dateStr);
      this._updateCourseStoreMatched();
      this._updateCompletedStatus();
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  _checkBookingWindow(dateStr) {
    request({ url: '/config/public/booking-window', method: 'GET', silent: true }).then(res => {
      const days = (res.data && res.data.booking_window_days) ? parseInt(res.data.booking_window_days, 10) : 7;
      const today = new Date();
      // 使用年月日构造日期对象，消除时分秒对天数差计算的干扰
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const parts = dateStr.split('-');
      const target = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const diffDays = Math.floor((target - todayDate) / (1000 * 60 * 60 * 24));
      this.setData({ bookingWindowOpen: diffDays >= 0 && diffDays < days });
    }).catch(() => {
      this.setData({ bookingWindowOpen: true });
    });
  },

  loadUserPackages() {
    const { checkLogin } = require('../../../utils/auth');
    if (!checkLogin()) {
      this.setData({
        isLoggedIn: false,
        isRestrictedUser: true,
        restrictedReason: '您不是正式会员，请联系门店办理'
      });
      return;
    }
    this.setData({ isLoggedIn: true });
    Promise.all([
      request({ url: '/packages/my' }),
      request({ url: '/auth/me', silent: true })
    ]).then(([pkgRes, authRes]) => {
      const data = pkgRes.data || {};
      const hasActive = data.current;
      const hasPending = data.pending && data.pending.length > 0;
      this.setData({ 
        userPackages: data,
        isPackageSuspended: data.hasSuspended && !hasActive,
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
      });
      this.setData({ memberPackageStoreIds: Array.from(storeIds) });
      // 重新计算课程门店匹配
      this._updateCourseStoreMatched();
      this.loadCompletedBookings();
    }).catch((err) => {
      console.error('加载套餐信息失败:', err);
    });
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
    if (hasValid) return '';
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
      this._updateCompletedStatus();
    }).catch(() => {
      this.setData({ completedScheduleIds: [] });
    });
  },

  // 更新课程门店匹配状态
  _updateCourseStoreMatched() {
    const { course, memberPackageStoreIds } = this.data;
    if (!course || !memberPackageStoreIds.length) {
      this.setData({ courseStoreMatched: true });
      return;
    }
    const courseStoreId = course.store_id ? (typeof course.store_id === 'string' ? course.store_id : (course.store_id._id || course.store_id)) : '';
    const matched = !courseStoreId || memberPackageStoreIds.includes(String(courseStoreId));
    this.setData({ courseStoreMatched: matched });
  },

  // 更新已完成状态
  _updateCompletedStatus() {
    const { courseId, completedScheduleIds } = this.data;
    const isCompleted = completedScheduleIds.indexOf(String(courseId)) !== -1;
    this.setData({ isCompleted });
  },

  loadUserBookingsInit() {
    const { checkLogin } = require('../../../utils/auth');
    if (!checkLogin()) {
      return Promise.resolve();
    }
    return request({ url: '/bookings/my?type=booked&pageSize=20' }).then(res => {
      const bookings = res.data && res.data.list ? res.data.list : [];
      this.setData({ userBookings: bookings });
      this.checkIsBooked();
    }).catch((err) => {
      console.error('加载预约记录失败:', err);
    });
  },

  loadUserBookings() {
    const { checkLogin } = require('../../../utils/auth');
    if (!checkLogin()) {
      return;
    }
    request({ url: '/bookings/my?type=booked&pageSize=20' }).then(res => {
      const bookings = res.data && res.data.list ? res.data.list : [];
      this.setData({ userBookings: bookings });
      this.checkIsBooked();
    }).catch((err) => {
      console.error('加载预约记录失败:', err);
    });
  },

  checkIsBooked() {
    const { courseId, userBookings } = this.data;
    const activeBookings = userBookings.filter(b => {
      const status = (b.status || '').toLowerCase();
      return status !== 'cancelled';
    });
    const isBooked = activeBookings.some(booking => {
      if (!booking.schedule_id) return false;
      const sid = typeof booking.schedule_id === 'string'
        ? booking.schedule_id
        : (booking.schedule_id._id || booking.schedule_id);
      return String(sid) === String(courseId);
    });
    const currentBooking = activeBookings.find(booking => {
      if (!booking.schedule_id) return false;
      const sid = typeof booking.schedule_id === 'string'
        ? booking.schedule_id
        : (booking.schedule_id._id || booking.schedule_id);
      return String(sid) === String(courseId);
    });
    // 同步后端返回的取消相关字段：can_cancel / cancel_phase / exemption_count
    const canCancel = currentBooking ? (currentBooking.can_cancel !== false) : true;
    const cancelPhase = currentBooking && currentBooking.cancel_phase ? currentBooking.cancel_phase : '';
    const exemptionCount = currentBooking && typeof currentBooking.exemption_count === 'number'
      ? currentBooking.exemption_count
      : 0;
    this.setData({ 
      isBooked, 
      currentBookingId: currentBooking ? currentBooking._id : null,
      canCancel,
      cancelPhase,
      exemptionCount
    });
  },

  loadWaitlistStatus() {
    const { checkLogin } = require('../../../utils/auth');
    if (!checkLogin()) {
      return;
    }
    const api = require('../../utils/api');
    api.bookings.getWaitlistMy().then(res => {
      const list = res.data || [];
      const { courseId } = this.data;
      const myWaitlist = list.find(w => w.schedule_id && (w.schedule_id._id === courseId || w.schedule_id === courseId));
      if (myWaitlist && (myWaitlist.status === 'waiting' || myWaitlist.status === 'notified')) {
        this.setData({
          isWaitlisted: true,
          waitlistPosition: myWaitlist.position || 0,
          currentWaitlistId: myWaitlist._id
        });
      } else {
        this.setData({
          isWaitlisted: false,
          waitlistPosition: 0,
          currentWaitlistId: null
        });
      }
    }).catch(() => {
      this.setData({
        isWaitlisted: false,
        waitlistPosition: 0,
        currentWaitlistId: null
      });
    });
  },

  onWaitlistTap() {
    if (!auth.requireLogin(() => this.setData({ showLoginModal: true }))) return;
    auth.requireMember(() => {
      const { course, isPackageSuspended } = this.data;
      if (isPackageSuspended) {
        wx.showModal({
          title: '无法加入候补',
          content: '您的套餐暂停使用中，不能进行预约课程操作。',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#D4786E'
        });
        return;
      }

      // 未开放预约
      if (!this.data.bookingWindowOpen) {
        return;
      }

      this.setData({
        showWaitlistModal: true,
        bookingModalText: `课程已满员，是否加入候补排队？\n课程：${course.course_name}\n时间：${course.dateStr} ${course.weekDayStr} ${course.start_time}-${course.end_time}\n\n有人取消预约时，将按排队顺序通知您`
      });
    });
  },

  onConfirmWaitlist() {
    this.setData({ showWaitlistModal: false });
    this.doJoinWaitlist();
  },

  onCancelWaitlistModal() {
    this.setData({ showWaitlistModal: false });
  },

  async doJoinWaitlist() {
    let loadingShown = false;
    try {
      // 检查是否有可用套餐（已激活或待激活）
      const { userPackages, course } = this.data;
      const hasActivePackage = userPackages && userPackages.current;
      const hasPendingPackage = userPackages && userPackages.pending && userPackages.pending.length > 0;
      if (!hasActivePackage && !hasPendingPackage) {
        wx.showModal({
          title: '无法加入候补',
          content: '您当前没有可用套餐，请先购买套餐后再加入候补排队。',
          confirmText: '去购买',
          confirmColor: '#D4786E',
          showCancel: true,
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/package-list/package-list' });
            }
          }
        });
        return;
      }

      // 次卡用户检查剩余次数（如有已激活的次卡）
      if (hasActivePackage && userPackages.current.package_type === 'count_card') {
        const remaining = userPackages.current.remaining_credits || 0;
        const creditsCost = course.creditsCost || 1;
        if (remaining < creditsCost) {
          wx.showModal({
            title: '次数不足',
            content: `您的次卡剩余${remaining}次，不足以预约本课程（需要${creditsCost}次）。请先购买新套餐或联系门店处理。`,
            confirmText: '去购买',
            confirmColor: '#D4786E',
            showCancel: true,
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: '/pages/package-list/package-list' });
              }
            }
          });
          return;
        }
      }

      const { fetchTemplates, requestWaitlistAndBookingSubscribe, getAcceptedTemplates } = require('../../../utils/subscribe-message');
      await fetchTemplates();
      // 候补通知 + 预约相关通知合并授权（只弹1次窗）
      const subscribeResult = await requestWaitlistAndBookingSubscribe();
      const acceptedTemplates = getAcceptedTemplates(subscribeResult);

      wx.showLoading({ title: '加入候补...' });
      loadingShown = true;

      const api = require('../../utils/api');
      await api.bookings.joinWaitlist({ schedule_id: this.data.courseId });

      wx.hideLoading();
      loadingShown = false;
      wx.showToast({ title: '已加入候补排队', icon: 'success' });

      this.loadWaitlistStatus();
      this.loadCourseDetail(this.data.courseId);
      this.loadUserBookings();
      this.loadUserPackages();
    } catch (err) {
      if (loadingShown) {
        wx.hideLoading();
      }
      wx.showToast({ title: err.message || '加入候补失败', icon: 'none' });
    }
  },

  onLeaveWaitlistTap() {
    const { course, waitlistPosition } = this.data;
    this.setData({
      showLeaveWaitlistModal: true,
      bookingModalText: `确认退出候补排队？\n课程：${course.course_name}\n当前排队位置：第${waitlistPosition}位\n\n退出后需要重新排队`
    });
  },

  onConfirmLeaveWaitlist() {
    this.setData({ showLeaveWaitlistModal: false });
    this.doLeaveWaitlist();
  },

  onCancelLeaveWaitlist() {
    this.setData({ showLeaveWaitlistModal: false });
  },

  async doLeaveWaitlist() {
    const { currentWaitlistId } = this.data;
    if (!currentWaitlistId) {
      wx.showToast({ title: '无法退出候补', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '退出中...' });
    try {
      const api = require('../../utils/api');
      await api.bookings.leaveWaitlist(currentWaitlistId);

      wx.hideLoading();
      wx.showToast({ title: '已退出候补', icon: 'success' });

      this.loadWaitlistStatus();
      this.loadCourseDetail(this.data.courseId);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '退出失败', icon: 'none' });
    }
  },

  onBookTap() {
    // 受限用户点击"不可预约"按钮，提示对应原因
    if (this.data.isRestrictedUser) {
      if (!auth.requireLogin(() => this.setData({ showLoginModal: true }))) return;
      wx.showModal({
        title: '无法预约',
        content: this.data.restrictedReason,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#D4786E'
      });
      return;
    }

    if (!auth.requireLogin(() => this.setData({ showLoginModal: true }))) return;
    auth.requireMember(() => {
      const { course, isPackageSuspended, courseStoreMatched } = this.data;
      
      // 套餐停卡中，拦截预约
      if (isPackageSuspended) {
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
      if (courseStoreMatched === false) {
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
      if (!this.data.bookingWindowOpen) {
        return;
      }

      // 客户端兜底校验：课程已开始不再允许预约
      if (course && course.dateStr && course.start_time) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (course.dateStr === todayStr) {
          const s = String(course.start_time).split(':');
          if (s.length >= 2) {
            const startMin = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
            const currentMin = now.getHours() * 60 + now.getMinutes();
            if (currentMin >= startMin) {
              wx.showToast({ title: '课程已开始，无法预约', icon: 'none' });
              return;
            }
          }
        }
      }
      const { userPackages } = this.data;
      const hasPendingPackage = userPackages && userPackages.pending && userPackages.pending.length > 0;
      const hasActivePackage = userPackages && userPackages.current;

      if (hasPendingPackage && !hasActivePackage) {
        this.setData({ showActivationModal: true });
        return;
      }

      const creditsCost = course.creditsCost || 1;

      // 判断是否为补约场景：当前时间已过预约截止时间（开课前 booking_deadline 分钟）
      let lateBookingTip = '';
      if (course.dateStr && course.start_time) {
        const classStart = new Date(`${course.dateStr} ${course.start_time}`.replace(/-/g, '/'));
        const bookingDeadlineMin = course.booking_deadline || 120;
        const deadline = new Date(classStart.getTime() - bookingDeadlineMin * 60000);
        if (new Date() > deadline) {
          lateBookingTip = '本课程已过预约截止时间，属补约。预约后5分钟内可取消（退课时），超时需使用豁免取消权益。';
        }
      }
      const bookingSections = [
        `确认预约「${course.course_name}」？`,
        `时间：${course.dateStr} ${course.weekDayStr} ${course.start_time}-${course.end_time}`,
        `教练：${course.coach_id ? course.coach_id.name : '未指定'}`,
        course.classroom ? `教室：${course.classroom}` : '',
        `消耗次数：${creditsCost}次`,
        lateBookingTip
      ].filter(s => s);
      this.setData({
        showBookingModal: true,
        bookingModalText: bookingSections.join('\n')
      });
    });
  },

  onCancelTap() {
    const { course, canCancel, cancelPhase, exemptionCount } = this.data;
    // 后端判定不可取消，直接提示，不弹出确认框
    if (canCancel === false) {
      let lockTip = '已超过可取消时限，不能取消';
      if (cancelPhase === 'locked') {
        // 补约5分钟超时且无豁免次数，或过 cancel_deadline
        lockTip = '已超过可取消时限，无法取消';
      }
      wx.showToast({ title: lockTip, icon: 'none' });
      return;
    }
    let phaseTip = '';
    if (cancelPhase === 'quick') {
      // 补约5分钟内快速取消：退课时，不扣豁免
      phaseTip = '本次为补约快速取消（5分钟内），将退还课时，不消耗豁免次数';
    } else if (cancelPhase === 'exempt') {
      phaseTip = `您正在使用豁免取消权益（退课时），取消将消耗 1 次豁免次数，剩余 ${exemptionCount} 次，请珍惜使用`;
    } else if (cancelPhase === 'normal') {
      phaseTip = '取消预约将退还课时';
    }
    const cancelSections = [
      `确认取消预约「${course.course_name}」？`,
      `时间：${course.dateStr} ${course.weekDayStr} ${course.start_time}-${course.end_time}`,
      phaseTip
    ].filter(s => s);
    this.setData({
      showCancelModal: true,
      cancelModalSections: cancelSections
    });
  },

  onConfirmCancel() {
    this.setData({ showCancelModal: false });
    this.doCancel();
  },

  onCancelCancel() {
    this.setData({ showCancelModal: false });
  },

  async doCancel() {
    const { currentBookingId } = this.data;
    if (!currentBookingId) {
      wx.showToast({ title: '无法取消预约', icon: 'none' });
      return;
    }

    // 请求取消通知订阅授权
    try {
      const { fetchTemplates, requestCancelSubscribe } = require('../../../utils/subscribe-message');
      await fetchTemplates();
      await requestCancelSubscribe();
    } catch (e) {
      console.log('[CourseDetail] 请求取消通知授权失败，继续取消流程:', e.message);
    }

    wx.showLoading({ title: '取消中...' });
    
    try {
      await request({
        url: `/bookings/${currentBookingId}/cancel`,
        method: 'PUT'
      });
      
      wx.hideLoading();
      wx.showToast({ title: '已取消预约', icon: 'success' });
      
      this.loadCourseDetail(this.data.courseId);
      this.loadUserBookings();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '取消失败，请重试', icon: 'none' });
    }
  },

  onConfirmActivation() {
    this.setData({ showActivationModal: false });
    // 继续预约流程，后端会自动激活套餐
    const { course } = this.data;
    this.setData({
      showBookingModal: true,
      bookingModalText: `预约将自动激活您的套餐\n\n确认预约「${course.course_name}」？\n时间：${course.dateStr} ${course.weekDayStr} ${course.start_time}-${course.end_time}`
    });
  },

  onCancelActivation() {
    this.setData({ showActivationModal: false });
  },

  onConfirmBooking() {
    this.setData({ showBookingModal: false });
    this.doBook();
  },

  onCancelBooking() {
    this.setData({ showBookingModal: false });
  },

  async doBook() {
    let loadingShown = false;
    try {
      // 先请求订阅消息授权（在预约成功前请求）
      const { fetchTemplates, requestBookingSubscribe, getAcceptedTemplates } = require('../../../utils/subscribe-message');
      await fetchTemplates();
      const subscribeResult = await requestBookingSubscribe();
      const acceptedTemplates = getAcceptedTemplates(subscribeResult);

      wx.showLoading({ title: '预约中...' });
      loadingShown = true;
      
      // 执行预约
      await request({
        url: '/bookings',
        method: 'POST',
        data: { schedule_id: this.data.courseId }
      });
      
      wx.hideLoading();
      loadingShown = false;
      
      // 显示预约成功，并提示用户已开启消息提醒
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
      
      this.loadCourseDetail(this.data.courseId);
      this.loadUserBookings();
      this.loadUserPackages();
    } catch (err) {
      if (loadingShown) {
        wx.hideLoading();
      }
      const errMsg = err.message || '预约失败，请重试';
      if (errMsg.includes('已达上限') || errMsg.includes('套餐状态') || errMsg.includes('无可用套餐') || errMsg.includes('已过期') || errMsg.includes('已用完') || errMsg.includes('剩余次数不足')) {
        this.setData({
          showLimitModal: true,
          limitModalText: errMsg
        });
      } else if (errMsg.includes('完善个人信息')) {
        wx.showModal({
          title: '提示',
          content: errMsg,
          confirmText: '去完善',
          confirmColor: '#D4786E',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/profile/profile' });
            }
          }
        });
      } else {
        wx.showToast({ title: errMsg, icon: 'none' });
      }
    }
  },



  onCoachTap() {
    const { course } = this.data;
    if (course && course.coach_id && course.coach_id._id) {
      wx.navigateTo({
        url: `/package-sub/pages/coach-detail/coach-detail?id=${course.coach_id._id}`
      });
    }
  },

  onModalTap() {},

  onCloseLimitModal() {
    this.setData({ showLimitModal: false, limitModalText: '' });
  },

  onShareAppMessage() {
    const { course } = this.data;
    return {
      title: course ? course.course_name : '场次详情',
      path: `/package-sub/pages/course-detail/course-detail?id=${this.data.courseId}`
    };
  },

  onCoverImgError() {
    this.setData({ imageErrors: { cover: true } });
  },

  onLoginModalClose() {
    this.setData({ showLoginModal: false });
  },

  onLoginSuccess() {
    this.setData({ showLoginModal: false, isLoggedIn: true });
    this.loadCourseDetail(this.data.courseId);
  }
});
