const app = getApp();
const { request } = require('../../utils/request');
const { getBeijingDate } = require('../../utils/helpers');
const { normalizeImageUrl } = require('../../utils/util');
const config = require('../../config/index.js');
const SERVER_BASE = config.serverBase;
const auth = require('../../utils/auth');

const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getNextDays(count = 7, holidays = []) {
  const dates = [];
  const today = getBeijingDate();
  for (let i = 0; i < count; i++) {
    const d = getBeijingDate(today);
    d.setDate(today.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = d.getDate();
    const weekDay = WEEK_DAYS[d.getDay()];
    const dateStr = `${year}-${month}-${String(dayNum).padStart(2, '0')}`;
    const isHoliday = holidays.some(h => {
      const hEnd = h.end_date || h.date;
      return h.date <= dateStr && hEnd >= dateStr;
    });
    dates.push({
      date: dateStr,
      day: dayNum,
      weekDay,
      displayDay: i === 0 ? '今日' : (i === 1 ? '明天' : weekDay),
      isToday: i === 0,
      isHoliday
    });
  }
  return dates;
}

Page({
  data: {
    isLoggedIn: false,
    storeList: [],
    currentStore: null,
    dates: [],
    selectedDate: '',
    danceStyles: [],
    courses: [],
    loading: false,
    showStoreModal: false,
    showActivateModal: false,
    pendingPackage: null,
    activating: false,
    isOfficial: false,
    bookedScheduleIds: [],
    waitlistedScheduleIds: [],
    memberPackageStoreIds: [],
    canBookCurrentStore: false,
    canViewCapacity: false,
    isPackageSuspended: false,
    showBookingModal: false,
    bookingModalText: '',
    bookingModalCourse: null,
    showLimitModal: false,
    limitModalText: '',
    showStorePicker: false,
    storePickerTitle: '确认所在门店',
    storePickerMode: 'login',
    selectedStoreId: '',
    selectedStoreName: '',
    nearestDistance: null,
    holidays: [],
    selectedDateItem: null,
    weekDays: [],
    weekDaysIndex: 0,
    courseCount: 0,
    sectionTitle: '今日课程',
    imageErrors: {},
    showWaitlistModal: false,
    waitlistCourse: null,
    waitlistModalText: '',
    showCountCardModal: false,
    countCardModalText: '',
    countCardModalPackages: [],
    countCardScheduleId: '',
    isHolidayToday: false,
    showLoginModal: false,
    bookingWindowDays: 7
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, active: 'booking' });
    }
    const storeList = app.globalData.storeList || [];
    const currentStore = app.globalData.currentStore || (storeList.length > 0 ? storeList[0] : null);
    this.setData({ storeList, currentStore });
    const { checkLogin } = require('../../utils/auth');
    if (!checkLogin()) {
      this.setData({ isLoggedIn: false, isOfficial: false });
      this.initPage();
      return;
    }
    this.setData({ isLoggedIn: true });
    this.refreshUserInfo();
  },

  refreshUserInfo() {
    Promise.all([
      request({ url: '/auth/me', silent: true }),
      request({ url: '/packages/my', silent: true })
    ]).then(([authRes, pkgRes]) => {
      let isOfficial = false;
      if (authRes && authRes.data) {
        app.globalData.userInfo = authRes.data;
        isOfficial = authRes.data.member_status === 'official';
      }
      this.setData({ isOfficial });
      if (isOfficial && pkgRes && pkgRes.data) {
        const pkgData = pkgRes.data;
        const isSuspended = pkgData.hasSuspended && !pkgData.current;
        this.setData({ isPackageSuspended: isSuspended });
        this._updatePackageStoreIds(pkgData);
        this._updateCanViewCapacity(authRes.data, pkgData);
      } else if (!isOfficial) {
        this.setData({ memberPackageStoreIds: [], canBookCurrentStore: false, bookedScheduleIds: [], canViewCapacity: false });
      }
      this.initPage();
    }).catch(() => {
      const userInfo = app.globalData.userInfo || {};
      const isOfficial = userInfo.member_status === 'official';
      this.setData({ isOfficial });
      if (isOfficial) {
        this.setData({ memberPackageStoreIds: [], canBookCurrentStore: false, bookedScheduleIds: [], canViewCapacity: false });
      }
      this.initPage();
    });
  },

  _updateCanViewCapacity(userData, pkgData) {
    if (userData.member_status !== 'official') {
      this.setData({ canViewCapacity: false });
      return;
    }
    if (userData.status === 'disabled') {
      this.setData({ canViewCapacity: false });
      return;
    }
    const history = pkgData.history || [];
    const packages = pkgData.packages || history;
    const allPackages = Array.isArray(packages) ? packages : [];
    const hasValidPackage = allPackages.some(pkg => {
      return pkg.status === 'pending' || pkg.status === 'active';
    });
    if (!hasValidPackage) {
      this.setData({ canViewCapacity: false });
      return;
    }
    const hasActivePackage = allPackages.some(pkg => {
      if (pkg.status !== 'active') return false;
      if (pkg.is_suspended) return false;
      return true;
    });
    const hasPendingPackage = allPackages.some(pkg => pkg.status === 'pending');
    this.setData({ canViewCapacity: hasActivePackage || hasPendingPackage });
  },

  _updatePackageStoreIds(pkgData) {
    const packages = pkgData.history || [];
    const storeIds = new Set();
    packages.forEach(pkg => {
      if (pkg.store_id) {
        const sid = typeof pkg.store_id === 'string' ? pkg.store_id : (pkg.store_id._id || pkg.store_id);
        if (sid) storeIds.add(String(sid));
      }
    });
    const packageStoreIds = Array.from(storeIds);
    const currentStoreId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    const canBookCurrentStore = packageStoreIds.includes(currentStoreId);
    this.setData({ memberPackageStoreIds: packageStoreIds, canBookCurrentStore });
    if (!canBookCurrentStore) {
      this.setData({ bookedScheduleIds: [] });
    }
  },

  _updateCanBookForStore() {
    const currentStoreId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    const canBookCurrentStore = this.data.memberPackageStoreIds.includes(currentStoreId);
    const payload = { canBookCurrentStore };
    if (!canBookCurrentStore) {
      payload.bookedScheduleIds = [];
    }
    this.setData(payload);
  },

  onLoad() {
    const isLoggedIn = !!app.globalData.token;
    this.setData({ isLoggedIn });
    if (isLoggedIn) {
      this.initPage();
    }
  },

  initPage() {
    if (this._initPageTimer) {
      clearTimeout(this._initPageTimer);
    }
    this._initPageTimer = setTimeout(() => {
      this._doInitPage();
    }, 300);
  },

  _doInitPage() {
    const storeList = app.globalData.storeList || [];
    const currentStore = app.globalData.currentStore || (storeList.length > 0 ? storeList[0] : null);

    this.setData({ storeList, currentStore });

    this._updateCanBookForStore();

    if (!this.data.dates.length) {
      const dates = getNextDays(7, this.data.holidays);
      this.setData({ dates, selectedDate: dates[0].date });
    }

    this.generateWeekDaysSym();

    if (storeList.length === 0) {
      this.loadStoreList();
    }

    this.loadDanceStyles();
    this.loadHolidays();
    this.loadBookingWindowDays();
    this.loadCourses();
  },

  loadBookingWindowDays() {
    request({ url: '/config/public/booking-window', method: 'GET', silent: true }).then(res => {
      const days = (res.data && res.data.booking_window_days) ? parseInt(res.data.booking_window_days, 10) : 7;
      this.setData({ bookingWindowDays: days || 7 });
    }).catch(() => {
      // 默认 7 天
    });
  },

  _isDateInBookingWindow(dateStr) {
    const today = getBeijingDate();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const target = new Date(dateStr);
    const diffDays = Math.floor((target - today) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays < this.data.bookingWindowDays;
  },

  async loadHolidays() {
    try {
      const res = await request({ url: '/holidays', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const activeHolidays = list.filter(h => h.status === 'active');
      const dates = getNextDays(7, activeHolidays);
      const weekDays = dates;
      const selectedDate = dates[0].date;
      const sectionTitle = dates[0].isToday ? '今日课程' : (this.formatDate(dates[0].date) + ' ' + dates[0].weekDay + ' 课程');
      this.setData({ holidays: activeHolidays, dates, weekDays, selectedDate, weekDaysIndex: 0, sectionTitle });
    } catch (err) {
      console.error('加载假期信息失败', err);
      this.generateWeekDaysSym();
    }
  },

  loadStoreList() {
    request({ url: '/stores', method: 'GET' }).then(res => {
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      if (list.length > 0) {
        const savedStore = wx.getStorageSync('currentStore');
        const store = savedStore || list[0];
        app.globalData.storeList = list;
        app.globalData.currentStore = store;
        this.setData({ storeList: list, currentStore: store });
      }
    }).catch((err) => {
      console.error('加载门店列表失败:', err);
    });
  },

  loadDanceStyles() {
    request({ url: '/dance-styles' }).then(res => {
      const danceStyles = Array.isArray(res.data) ? res.data : [];
      this.setData({ danceStyles });
    }).catch((err) => {
      console.error('加载舞种列表失败:', err);
    });
  },

  loadCourses() {
    const { holidays, selectedDate } = this.data;
    const isHoliday = holidays.some(h => {
      const hEnd = h.end_date || h.date;
      return h.date <= selectedDate && hEnd >= selectedDate;
    });
    if (isHoliday) {
      this.setData({ courses: [], loading: false, courseCount: 0, isHolidayToday: true });
      return Promise.resolve();
    }
    this.setData({ loading: true, isHolidayToday: false });
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    const reqData = {
      store_id: storeId,
      date: this.data.selectedDate
    };

    return request({ url: '/schedules', data: reqData }).then(res => {
      const courses = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      
      // 计算当前分钟数（今日专用）
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const isToday = this.data.selectedDate === todayStr;

      const processedCourses = courses.map(course => {
        const styleName = course.dance_style_id && course.dance_style_id.name ? course.dance_style_id.name : '';
        const styleId = course.dance_style_id && course.dance_style_id._id ? String(course.dance_style_id._id) : (course.dance_style_id || '');
        const tagColor = this._getDanceTagColor(styleName);

        // 解析开始/结束时间（分钟数）
        let startMin = null;
        let endMin = null;
        if (course.start_time) {
          const s = String(course.start_time).split(':');
          if (s.length >= 2) startMin = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
        }
        if (course.end_time) {
          const e = String(course.end_time).split(':');
          if (e.length >= 2) endMin = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
        }

        // 课程状态：是否已经开始 / 是否已超过豁免取消窗口（开始后10分钟）
        const _started = isToday && startMin !== null && currentMin >= startMin;
        const _ended = isToday && endMin !== null && currentMin >= endMin;
        // 豁免取消窗口期 = 10 分钟，过此时间后课程才从列表中移除；已取消/下架课程直接不展示
        const _cancelled = course.status === 'cancelled' || course.status === 'offline' || course.status === 'cancelled_insufficient';
        const _hiddenAfterGrace = _cancelled || (isToday && startMin !== null && currentMin >= startMin + 10);

        // 处理教练头像URL
        const coachAvatar = (course.coach_id && course.coach_id.avatar_url)
          ? normalizeImageUrl(course.coach_id.avatar_url, SERVER_BASE)
          : '';

        return {
          ...course,
          _id: String(course._id),
          danceStyleName: styleName,
          danceStyleId: styleId,
          danceTagBg: tagColor.bg,
          danceTagText: tagColor.text,
          _started,
          _ended,
          _cancelled,
          _hiddenAfterGrace,
          coachAvatar,
          bookingOpen: this._isDateInBookingWindow(course.date)
        };
      });

      // 过滤：已取消的课程，以及今日已超过豁免取消窗口的课程
      let filteredCourses = processedCourses.filter(course => !course._hiddenAfterGrace);
      // 判断当天原本有课（无论何种状态）但都不可预约 → 显示「课程已结束」
      const hasEndedCourses = processedCourses.length > 0 && filteredCourses.length === 0;

      this.setData({
        courses: filteredCourses,
        loading: false,
        courseCount: filteredCourses.length,
        hasEndedCourses
      });
      this.loadMyBookings();
      this.loadMyWaitlists();
    }).catch((err) => {
      console.error('加载课程列表失败:', err);
      this.setData({ loading: false, courseCount: 0 });
    });
  },



  loadMyBookings() {
    if (!this.data.isOfficial) {
      this.setData({ bookedScheduleIds: [] });
      return;
    }
    if (!this.data.canBookCurrentStore) {
      this.setData({ bookedScheduleIds: [] });
      return;
    }
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    let url = '/bookings/my?type=booked&pageSize=50';
    if (storeId) {
      url += '&store_id=' + storeId;
    }
    request({ url, silent: true }).then(res => {
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

  onDateSelect(e) {
    const { date } = e.currentTarget.dataset;
    const dateItem = this.data.dates.find(d => d.date === date);
    const weekDaysIndex = this.data.weekDays.findIndex(d => d.date === date);
    this.setData({
      selectedDate: date,
      selectedDateItem: dateItem || null,
      weekDaysIndex: weekDaysIndex >= 0 ? weekDaysIndex : this.data.weekDaysIndex
    }, () => {
      this.loadCourses();
    });
  },

  onStoreTap() {
    this.setData({ showStoreModal: true });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  onModalTap() {},

  onStoreOptionTap(e) {
    const { id, name, store } = e.currentTarget.dataset;
    if (this.data.showStoreModal) {
      if (!store || !store._id) return;
      app.globalData.currentStore = store;
      wx.setStorageSync('currentStore', store);
      this.setData({
        currentStore: store,
        showStoreModal: false
      }, () => {
        this._updateCanBookForStore();
        this.loadDanceStyles();
        this.loadCourses();
      });
    } else {
      this.setData({
        selectedStoreId: id,
        selectedStoreName: name
      });
    }
  },

  onSelectStore(e) {
    const { store } = e.currentTarget.dataset;
    if (!store || !store._id) {
      return;
    }
    app.globalData.currentStore = store;
    wx.setStorageSync('currentStore', store);
    this.setData({
      currentStore: store,
      showStoreModal: false
    }, () => {
      this._updateCanBookForStore();
      this.loadDanceStyles();
      this.loadCourses();
    });
  },

  async doBook(scheduleId) {
    let loadingShown = false;
    try {
      const { fetchTemplates, requestBookingSubscribe, getAcceptedTemplates } = require('../../utils/subscribe-message');
      await fetchTemplates();
      const subscribeResult = await requestBookingSubscribe();
      const acceptedTemplates = getAcceptedTemplates(subscribeResult);

      wx.showLoading({ title: '预约中...' });
      loadingShown = true;
      
      await request({
        url: '/bookings',
        method: 'POST',
        data: { schedule_id: scheduleId }
      });
      
      wx.hideLoading();
      loadingShown = false;
      
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
      
      this.loadCourses();
    } catch (err) {
      if (loadingShown) {
        wx.hideLoading();
      }
      const errMsg = err.message || '预约失败';
      const errCode = err.code || '';

      if (errCode === 'TIME_CARD_LIMIT_REACHED' && err.data && err.data.availablePackages) {
        // 时间卡限额已满，有待激活次卡，弹窗让会员确认
        const packages = err.data.availablePackages;
        const limitType = err.data.limitType === 'weekly' ? '本周' : '今日';
        const limit = err.data.limit || 0;
        const used = err.data.used || 0;
        const remaining = err.data.remaining || 0;
        let pkgText = packages.map(p => `${p.package_name}(剩余${p.remaining_credits}次)`).join('、');
        this.setData({
          showCountCardModal: true,
          countCardModalText: `您的${limitType}时间卡次数已达上限（${used}/${limit}，剩余${remaining}次）。\n\n继续预约将激活次卡：${pkgText}\n\n激活后服务有效期从今日开始计算，是否确认激活并预约本课程？`,
          countCardModalPackages: packages,
          countCardScheduleId: scheduleId
        });
      } else if (errMsg.includes('套餐') && errMsg.includes('未激活')) {
        this.showActivatePackageModal(scheduleId);
      } else if (errMsg.includes('已达上限') || errMsg.includes('套餐状态') || errMsg.includes('无可用套餐') || errMsg.includes('已过期') || errMsg.includes('已用完') || errMsg.includes('剩余次数不足')) {
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

  async showActivatePackageModal(scheduleId) {
    try {
      const res = await request({
        url: '/packages/my',
        method: 'GET'
      });
      const pendingPackage = (res.data?.pending || res.data?.history || []).find(p => p.status === 'pending');
      
      if (pendingPackage) {
        this.setData({
          showActivateModal: true,
          pendingPackage: pendingPackage,
          pendingScheduleId: scheduleId
        });
      } else {
        wx.showModal({
          title: '无法预约',
          content: '您没有可激活的套餐，请联系管理员',
          showCancel: false
        });
      }
    } catch (err) {
      wx.showToast({ title: '获取套餐信息失败', icon: 'none' });
    }
  },

  onCloseActivateModal() {
    this.setData({ showActivateModal: false, pendingPackage: null, pendingScheduleId: null });
  },

  async onConfirmActivate() {
    const { pendingPackage, pendingScheduleId } = this.data;
    if (!pendingPackage) return;

    // 请求套餐相关订阅授权
    try {
      const { fetchTemplates, requestPackageSubscribe } = require('../../utils/subscribe-message');
      await fetchTemplates();
      await requestPackageSubscribe();
    } catch (e) {
      console.log('[Booking] 请求套餐订阅授权失败，继续激活流程:', e.message);
    }

    this.setData({ activating: true });
    wx.showLoading({ title: '激活中...' });

    try {
      await request({
        url: `/packages/${pendingPackage._id}/activate`,
        method: 'POST',
        data: { activation_type: 'manual_member' }
      });

      wx.hideLoading();
      this.setData({ showActivateModal: false, activating: false, pendingPackage: null });
      
      wx.showToast({ title: '套餐已激活', icon: 'success' });

      if (pendingScheduleId) {
        setTimeout(() => {
          this.doBook(pendingScheduleId);
        }, 500);
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ activating: false });
      wx.showToast({ title: err.message || '激活失败', icon: 'none' });
    }
  },

  onCancelActivate() {
    this.setData({ showActivateModal: false, pendingPackage: null, pendingScheduleId: null });
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

  onCloseLimitModal() {
    this.setData({ showLimitModal: false, limitModalText: '' });
  },

  onCourseTap(e) {
    const course = e.currentTarget.dataset.course;
    if (course && course._id) {
      wx.navigateTo({
        url: `/pages/course-detail/course-detail?id=${course._id}`
      });
    }
  },

  onPullDownRefresh() {
    this.loadCourses().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onLogin() {
    this.setData({ showLoginModal: true });
  },

  onLoginModalClose() {
    this.setData({ showLoginModal: false });
  },

  onLoginSuccess() {
    this.setData({ showLoginModal: false, isLoggedIn: true });
    this.refreshUserInfo();
  },

  onSelectDate(e) {
    const { date, index } = e.currentTarget.dataset;
    const dateItem = this.data.dates.find(d => d.date === date);
    const weekDaysIndex = this.data.weekDays.findIndex(d => d.date === date);
    const idx = weekDaysIndex >= 0 ? weekDaysIndex : this.data.weekDaysIndex;
    const activeDay = this.data.weekDays[idx] || dateItem;
    const sectionTitle = activeDay && activeDay.isToday ? '今日课程' : (this.formatDate(activeDay.date) + ' ' + activeDay.weekDay + ' 课程');
    this.setData({
      selectedDate: date,
      selectedDateItem: dateItem || null,
      weekDaysIndex: idx,
      sectionTitle
    }, () => {
      this.loadCourses();
    });
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
    }
    return dateStr;
  },



  onBookCourse(e) {
    if (!auth.requireLogin(() => this.setData({ showLoginModal: true }))) return;
    
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
    
    if (this.data.isOfficial && !this.data.canBookCurrentStore) {
      const packageStoreNames = this.data.memberPackageStoreIds.map(id => {
        const s = this.data.storeList.find(store => String(store._id) === id);
        return s ? s.name : '';
      }).filter(Boolean).join('、');
      wx.showModal({
        title: '提示',
        content: `您的套餐只能在${packageStoreNames || '对应'}门店进行预约课程，请选择在该门店进行预约。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#D4786E'
      });
      return;
    }
    const course = e.currentTarget.dataset.course;
    if (!course) return;
    
    // 未开放预约，点击无反应
    if (!course.bookingOpen) {
      return;
    }
    
    // 客户端兜底校验：课程已开始不再允许预约
    const { selectedDate } = this.data;
    if (selectedDate) {
      const now2 = new Date();
      const todayStr2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-${String(now2.getDate()).padStart(2, '0')}`;
      if (selectedDate === todayStr2 && course.start_time) {
        const s = String(course.start_time).split(':');
        if (s.length >= 2) {
          const startMin = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
          const currentMin = now2.getHours() * 60 + now2.getMinutes();
          if (currentMin >= startMin) {
            wx.showToast({ title: '课程已开始，无法预约', icon: 'none' });
            return;
          }
        }
      }
    }
    const courseId = String(course._id);
    const bookedIds = this.data.bookedScheduleIds || [];
    const waitlistedIds = this.data.waitlistedScheduleIds || [];
    if (bookedIds.indexOf(courseId) !== -1) {
      wx.showToast({ title: '您已预约该课程。如需取消，请在课程详情页面中操作', icon: 'none', duration: 2500 });
      return;
    }
    if (course.status === 'full') {
      if (waitlistedIds.indexOf(courseId) !== -1) {
        wx.showToast({ title: '您已在候补队列中', icon: 'none' });
        return;
      }
      auth.requireMember(() => {
        this.setData({
          showWaitlistModal: true,
          waitlistCourse: course,
          waitlistModalText: `「${course.course_name}」已达到人数上限，是否加入候补队列？\n\n当有名额释放时，系统会按排队顺序通知您。`
        });
      });
      return;
    }
    if (waitlistedIds.indexOf(courseId) !== -1) {
      wx.showToast({ title: '您已在候补队列中', icon: 'none' });
      return;
    }
    auth.requireMember(() => {
      this.setData({
        showBookingModal: true,
        bookingModalCourse: course,
        bookingModalText: `确认预约「${course.course_name}」？\n时间：${course.start_time}-${course.end_time}\n教练：${course.coach_id && course.coach_id.name || '待定'}`
      });
    });
  },

  generateWeekDaysSym() {
    const dates = this.data.dates;
    if (dates.length > 0) {
      const weekDays = dates;
      const selectedDate = this.data.selectedDate;
      const weekDaysIndex = weekDays.findIndex(d => d.date === selectedDate);
      const idx = weekDaysIndex >= 0 ? weekDaysIndex : 0;
      const activeDay = weekDays[idx];
      const sectionTitle = activeDay && activeDay.isToday ? '今日课程' : (this.formatDate(activeDay.date) + ' ' + activeDay.weekDay + ' 课程');
      this.setData({
        weekDays,
        weekDaysIndex: idx,
        selectedDate: selectedDate || weekDays[0].date,
        sectionTitle
      });
    } else {
      const newDates = getNextDays(7, this.data.holidays);
      const activeDay = newDates[0];
      const sectionTitle = activeDay && activeDay.isToday ? '今日课程' : (this.formatDate(activeDay.date) + ' ' + activeDay.weekDay + ' 课程');
      this.setData({
        dates: newDates,
        weekDays: newDates,
        selectedDate: newDates[0].date,
        weekDaysIndex: 0,
        sectionTitle
      });
    }
  },

  onDatePrev() {
    const { weekDaysIndex, weekDays } = this.data;
    if (weekDaysIndex > 0) {
      const newIndex = weekDaysIndex - 1;
      const dateItem = weekDays[newIndex];
      if (dateItem) {
        const sectionTitle = dateItem.isToday ? '今日课程' : (this.formatDate(dateItem.date) + ' ' + dateItem.weekDay + ' 课程');
        this.setData({
          selectedDate: dateItem.date,
          selectedDateItem: dateItem,
          weekDaysIndex: newIndex,
          sectionTitle
        }, () => {
          this.loadCourses();
        });
      }
    }
  },

  onDateNext() {
    const { weekDaysIndex, weekDays } = this.data;
    if (weekDaysIndex < weekDays.length - 1) {
      const newIndex = weekDaysIndex + 1;
      const dateItem = weekDays[newIndex];
      if (dateItem) {
        const sectionTitle = dateItem.isToday ? '今日课程' : (this.formatDate(dateItem.date) + ' ' + dateItem.weekDay + ' 课程');
        this.setData({
          selectedDate: dateItem.date,
          selectedDateItem: dateItem,
          weekDaysIndex: newIndex,
          sectionTitle
        }, () => {
          this.loadCourses();
        });
      }
    }
  },

  _getDanceTagColor(styleName) {
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
  },

  onCoachImgError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ ['imageErrors.coach_' + id]: true });
  },

  onCourseImgError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ ['imageErrors.cover_' + id]: true });
  },

  onCloseCountCardModal() {
    this.setData({
      showCountCardModal: false,
      countCardModalText: '',
      countCardModalPackages: [],
      countCardScheduleId: ''
    });
  },

  onCancelCountCard() {
    this.setData({
      showCountCardModal: false,
      countCardModalText: '',
      countCardModalPackages: [],
      countCardScheduleId: ''
    });
  },

  async onConfirmCountCard() {
    const { countCardModalPackages, countCardScheduleId } = this.data;
    if (!countCardModalPackages || countCardModalPackages.length === 0) return;

    // 请求套餐相关订阅授权
    try {
      const { fetchTemplates, requestPackageSubscribe } = require('../../utils/subscribe-message');
      await fetchTemplates();
      await requestPackageSubscribe();
    } catch (e) {
      console.log('[Booking] 请求套餐订阅授权失败，继续激活流程:', e.message);
    }

    this.setData({ activating: true });
    wx.showLoading({ title: '激活次卡中...' });

    try {
      // 激活第一个可用次卡套餐（按ID精确激活）
      const pkg = countCardModalPackages[0];
      await request({
        url: `/packages/${pkg._id}/activate`,
        method: 'PUT',
        data: { activation_type: 'manual_member' }
      });

      wx.hideLoading();
      this.setData({
        showCountCardModal: false,
        activating: false,
        countCardModalText: '',
        countCardModalPackages: [],
        countCardScheduleId: ''
      });

      wx.showToast({ title: '次卡已激活', icon: 'success' });

      // 刷新套餐信息
      this.refreshUserInfo();

      // 重新发起预约
      if (countCardScheduleId) {
        setTimeout(() => {
          this.doBook(countCardScheduleId);
        }, 500);
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ activating: false });
      wx.showToast({ title: err.message || '激活次卡失败', icon: 'none' });
    }
  },
});