const app = getApp();
const { request } = require('../../utils/request');
const { getBeijingDate } = require('../../utils/helpers');
const { normalizeImageUrl } = require('../../utils/util');
const config = require('../../config/index.js');
const SERVER_BASE = config.serverBase;
const auth = require('../../utils/auth');
const wsClient = require('../../utils/websocket-client');

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
      displayDay: i === 0 ? '今天' : (i === 1 ? '明天' : weekDay),
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
    sectionTitle: '今天场次',
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
    bookingWindowDays: 7,
    completedScheduleIds: [],
    isRestrictedUser: false,
    restrictedReason: ''
  },

  onShow() {
    // 预加载消息模板（网络请求），确保点击预约时 requestBookingSubscribe 使用缓存模板
    // 避免点击时的网络请求破坏微信 tap gesture 上下文导致授权弹窗静默失败
    const { fetchTemplates } = require('../../utils/subscribe-message');
    fetchTemplates(true).catch(() => {});

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, active: 'booking' });
    }
    const storeList = app.globalData.storeList || [];
    const currentStore = app.globalData.currentStore || (storeList.length > 0 ? storeList[0] : null);
    this.setData({ storeList, currentStore });
    // 游客无 WebSocket，启动 60s 低频轮询；登录用户的轮询由 onStatusChange 管理
    this._startAutoRefresh(60000);
    const { checkLogin } = require('../../utils/auth');
    if (!checkLogin()) {
      this.setData({ 
        isLoggedIn: false, 
        isOfficial: false,
        isRestrictedUser: true,
        restrictedReason: '您不是正式会员，请联系门店办理'
      });
      this.initPage();
      // 服务号跳转场景：未登录用户自动弹出登录面板，避免白屏/功能异常
      if (app.globalData.fromServiceAccount && !this._serviceLoginPrompted) {
        this._serviceLoginPrompted = true;
        this.setData({ showLoginModal: true });
      }
      return;
    }
    this.setData({ isLoggedIn: true });
    this.refreshUserInfo();
    // 建立 WebSocket 实时推送连接（仅登录用户，游客无 token 无法连接）
    this._connectWebSocket();
  },

  onHide() {
    this._stopAutoRefresh();
    // 离开页面时断开 WebSocket，清理定时器
    wsClient.disconnect();
  },

  onUnload() {
    this._stopAutoRefresh();
    wsClient.disconnect();
  },

  // 建立 WebSocket 连接，接收课程更新推送
  _connectWebSocket() {
    const self = this;
    wsClient.connect({
      onMessage: {
        // 收到课程更新事件，重新加载课程列表
        course_update: () => {
          this.loadCourses(true);
        }
      },
      // WebSocket 连续重连失败后降级为轮询
      onFallback: () => {
        this.loadCourses(true);
      },
      // 连接状态变化：WS 连接成功时停止轮询，断开/降级时启动 60s 轮询兜底
      onStatusChange: (status) => {
        if (status === 'connected') {
          self._stopAutoRefresh();
        } else if (status === 'fallback' || status === 'disconnected') {
          self._startAutoRefresh(60000);
        }
      }
    });
  },

  // 启动自动轮询。interval 默认 30s，WS 降级时传 60000
  _startAutoRefresh(interval) {
    this._stopAutoRefresh();
    this._autoRefreshTimer = setInterval(() => {
      this.loadCourses(true);
    }, interval || 30000);
  },

  _stopAutoRefresh() {
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
  },

  // 全局网络恢复回调（由 app.js 的 onNetworkStatusChange 触发）
  onNetworkRestore() {
    this.loadCourses(true);
  },

  refreshUserInfo() {
    Promise.all([
      request({ url: '/auth/me', silent: true }),
      request({ url: '/packages/my', silent: true })
    ]).then(([authRes, pkgRes]) => {
      let isOfficial = false;
      let authData = null;
      if (authRes && authRes.data) {
        app.globalData.userInfo = authRes.data;
        isOfficial = authRes.data.member_status === 'official';
        authData = authRes.data;
      }
      this.setData({ isOfficial });
      if (isOfficial && pkgRes && pkgRes.data) {
        const pkgData = pkgRes.data;
        const isSuspended = pkgData.hasSuspended && !pkgData.current;
        this.setData({ isPackageSuspended: isSuspended, _packagesData: pkgData });
        this._updatePackageStoreIds(pkgData);
        this._updateCanViewCapacity(authRes.data, pkgData);
        // 计算受限用户状态和原因
        const restrictedReason = this._computeRestrictedReason(authData, pkgData);
        const isRestrictedUser = !!restrictedReason;
        this.setData({ isRestrictedUser, restrictedReason });
      } else if (!isOfficial) {
        this.setData({ 
          memberPackageStoreIds: [], 
          canBookCurrentStore: false, 
          bookedScheduleIds: [], 
          canViewCapacity: false,
          isRestrictedUser: true,
          restrictedReason: '您不是正式会员，请联系门店办理'
        });
      }
      this.initPage();
      this.loadCompletedBookings();
    }).catch(() => {
      const userInfo = app.globalData.userInfo || {};
      const isOfficial = userInfo.member_status === 'official';
      this.setData({ 
        isOfficial,
        isRestrictedUser: true,
        restrictedReason: isOfficial ? '您暂无可用套餐，请联系门店开通' : '您不是正式会员，请联系门店办理'
      });
      if (isOfficial) {
        this.setData({ memberPackageStoreIds: [], canBookCurrentStore: false, bookedScheduleIds: [], canViewCapacity: false });
      }
      this.initPage();
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
    // 检查是否有有效套餐（active且未过期且未用完，或pending）
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
    // 无有效套餐，进一步判断原因
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

  // 加载已完成的课程记录（用于判断"已完成"状态）
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
      if (pkg.status === 'pending') return true;
      if (pkg.status !== 'active' || pkg.is_suspended) return false;
      // 过滤已过期套餐
      if (pkg.is_activated && pkg.end_date && new Date() > new Date(pkg.end_date)) return false;
      return true;
    });
    if (!hasValidPackage) {
      this.setData({ canViewCapacity: false });
      return;
    }
    const hasActivePackage = allPackages.some(pkg => {
      if (pkg.status !== 'active') return false;
      if (pkg.is_suspended) return false;
      // 过滤已过期套餐
      if (pkg.is_activated && pkg.end_date && new Date() > new Date(pkg.end_date)) return false;
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
      // 附加门店（跨店使用）
      if (Array.isArray(pkg.extra_store_ids)) {
        pkg.extra_store_ids.forEach(eid => {
          const sid = typeof eid === 'string' ? eid : (eid._id || eid);
          if (sid) storeIds.add(String(sid));
        });
      }
    });
    const packageStoreIds = Array.from(storeIds);
    const currentStoreId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    const canBookCurrentStore = packageStoreIds.includes(currentStoreId);
    this.setData({ memberPackageStoreIds: packageStoreIds, canBookCurrentStore }, () => {
      this._updateCoursesButtonState();
    });
    if (!canBookCurrentStore) {
      this.setData({ bookedScheduleIds: [] }, () => {
        this._updateCoursesButtonState();
      });
    }
  },

  _updateCanBookForStore() {
    const currentStoreId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    const canBookCurrentStore = this.data.memberPackageStoreIds.includes(currentStoreId);
    const payload = { canBookCurrentStore };
    if (!canBookCurrentStore) {
      payload.bookedScheduleIds = [];
    }
    this.setData(payload, () => {
      this._updateCoursesButtonState();
    });
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
    // 延迟到 app.js 冷启动请求高峰后再初始化，避免并发 ERR_CONNECTION_RESET
    this._initPageTimer = setTimeout(() => {
      this._doInitPage();
    }, 600);
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
    // 使用年月日构造日期对象，消除时分秒对天数差计算的干扰
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const parts = dateStr.split('-');
    const target = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const diffDays = Math.floor((target - todayDate) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays < this.data.bookingWindowDays;
  },

  async loadHolidays() {
    try {
      const res = await request({ url: '/holidays', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const activeHolidays = list.filter(h => h.status === 'active');
      const dates = getNextDays(7, activeHolidays);
      const weekDays = dates;
      // 保留用户已选中的日期（若仍在新日期列表中），避免切回页面时被重置为今日
      const prevSelected = this.data.selectedDate;
      const stillValid = prevSelected && dates.some(d => d.date === prevSelected);
      const selectedDate = stillValid ? prevSelected : dates[0].date;
      const selectedIndex = dates.findIndex(d => d.date === selectedDate);
      const weekDaysIndex = selectedIndex >= 0 ? selectedIndex : 0;
      const selectedDateItem = dates[selectedIndex] || dates[0];
      const sectionTitle = selectedDateItem.isToday ? '今天场次' : (this.formatDate(selectedDateItem.date) + ' ' + selectedDateItem.weekDay);
      this.setData({ holidays: activeHolidays, dates, weekDays, selectedDate, weekDaysIndex, sectionTitle });
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

  loadCourses(silent) {
    const { holidays, selectedDate } = this.data;
    const isHoliday = holidays.some(h => {
      const hEnd = h.end_date || h.date;
      return h.date <= selectedDate && hEnd >= selectedDate;
    });
    if (isHoliday) {
      this.setData({ courses: [], loading: false, courseCount: 0, isHolidayToday: true });
      return Promise.resolve();
    }
    if (!silent) {
      // 已有数据时静默刷新，不显示 loading 动画（避免切 tab 回来一闪而过）
      const hasExistingCourses = this.data.courses && this.data.courses.length > 0;
      this.setData({ loading: !hasExistingCourses, isHolidayToday: false });
    }
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    const reqData = {
      store_id: storeId,
      date: this.data.selectedDate
    };

    // silent: 冷启动网络栈未就绪时失败不弹 toast，避免游客被"网络连接失败"打扰
    return request({ url: '/schedules', data: reqData, silent: true }).then(res => {
      const courses = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);

      // 计算当前分钟数（今日专用）
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const isToday = this.data.selectedDate === todayStr;

      const pageState = {
        isOfficial: this.data.isOfficial,
        isRestrictedUser: this.data.isRestrictedUser,
        canViewCapacity: this.data.canViewCapacity,
        canBookCurrentStore: this.data.canBookCurrentStore,
        bookedScheduleIds: this.data.bookedScheduleIds,
        waitlistedScheduleIds: this.data.waitlistedScheduleIds,
        completedScheduleIds: this.data.completedScheduleIds
      };

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

        // 课程状态：是否已经开始 / 是否已结束 / 是否进行中
        const _started = isToday && startMin !== null && currentMin >= startMin;
        const _ended = isToday && endMin !== null && currentMin >= endMin;
        const _ongoing = _started && !_ended;

        // 处理教练头像URL
        const coachAvatar = (course.coach_id && course.coach_id.avatar_url)
          ? normalizeImageUrl(course.coach_id.avatar_url, SERVER_BASE)
          : '';

        // 预处理已预约用户头像URL（拼接服务器域名，避免小程序当成本地资源加载失败）
        const bookedUsers = Array.isArray(course.booked_users)
          ? course.booked_users.map(u => ({
              ...u,
              avatar_url: u.avatar_url ? normalizeImageUrl(u.avatar_url, SERVER_BASE) : ''
            }))
          : [];

        const baseCourse = {
          ...course,
          _id: String(course._id),
          danceStyleName: styleName,
          danceStyleId: styleId,
          danceTagBg: tagColor.bg,
          danceTagText: tagColor.text,
          _started,
          _ended,
          _ongoing,
          coachAvatar,
          booked_users: bookedUsers,
          bookingOpen: this._isDateInBookingWindow(course.date)
        };

        // 预计算渲染字段，减少 WXML 中的重复计算
        return this._computeCourseRender(baseCourse, pageState);
      });

      // 后端已统一课程状态，已取消/已下线课程不会在列表中返回，前端无需再自行过滤
      this.setData({
        courses: processedCourses,
        loading: false,
        courseCount: processedCourses.length
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
      this.setData({ bookedScheduleIds: [] }, () => {
        this._updateCoursesButtonState();
      });
      return;
    }
    if (!this.data.canBookCurrentStore) {
      this.setData({ bookedScheduleIds: [] }, () => {
        this._updateCoursesButtonState();
      });
      return;
    }
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    let url = '/bookings/my?type=booked&pageSize=20';
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
      this.setData({ bookedScheduleIds }, () => {
        this._updateCoursesButtonState();
      });
    }).catch(() => {
      this.setData({ bookedScheduleIds: [] }, () => {
        this._updateCoursesButtonState();
      });
    });
  },

  loadMyWaitlists() {
    if (!this.data.isOfficial) {
      this.setData({ waitlistedScheduleIds: [] }, () => {
        this._updateCoursesButtonState();
      });
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
      this.setData({ waitlistedScheduleIds }, () => {
        this._updateCoursesButtonState();
      });
    }).catch(() => {
      this.setData({ waitlistedScheduleIds: [] }, () => {
        this._updateCoursesButtonState();
      });
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
    app.globalData.userManuallySelectedStore = true;  // 标记本次运行期间不再自动匹配
    app.globalData.pendingRelocate = false;
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
      const { requestBookingSubscribe, requestBookingAndActivationSubscribe, getAcceptedTemplates } = require('../../utils/subscribe-message');
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
      const sid = String(scheduleId);
      if (this.data.bookedScheduleIds.indexOf(sid) === -1) {
        const bookedScheduleIds = this.data.bookedScheduleIds.concat(sid);
        this.setData({ bookedScheduleIds }, () => {
          this._updateCoursesButtonState();
        });
      }
      request({ url: '/packages/my', silent: true }).then(pkgRes => {
        if (pkgRes && pkgRes.data) {
          const pkgData = pkgRes.data;
          const authData = app.globalData.userInfo || {};
          const restrictedReason = this._computeRestrictedReason(authData, pkgData);
          this.setData({ isRestrictedUser: !!restrictedReason, restrictedReason }, () => {
            this._updateCoursesButtonState();
          });
        }
      }).catch(() => {});
      setTimeout(() => {
        this.loadCourses(true);
      }, 300);

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
      // 先本地更新候补状态，再延迟刷新确认
      const sid = String(course._id);
      if (this.data.waitlistedScheduleIds.indexOf(sid) === -1) {
        const waitlistedScheduleIds = this.data.waitlistedScheduleIds.concat(sid);
        this.setData({ waitlistedScheduleIds }, () => {
          this._updateCoursesButtonState();
        });
      }
      setTimeout(() => {
        this.loadMyWaitlists();
      }, 300);
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
        url: `/package-sub/pages/course-detail/course-detail?id=${course._id}`
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
    const sectionTitle = activeDay && activeDay.isToday ? '今天场次' : (this.formatDate(activeDay.date) + ' ' + activeDay.weekDay);
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
    // 未登录用户：先弹引导登录弹窗，用户点"去登录"后再弹授权弹窗
    if (!this.data.isLoggedIn) {
      if (!auth.requireLogin(() => this.setData({ showLoginModal: true }))) return;
    }

    // 受限用户点击"不可预约"按钮，提示对应原因
    if (this.data.isRestrictedUser) {
      const course = e.currentTarget.dataset.course;
      const courseId = course ? String(course._id) : '';
      const bookedIds = this.data.bookedScheduleIds || [];
      // 已预约的课程：提示用户进入课程详情页取消
      if (courseId && bookedIds.indexOf(courseId) !== -1) {
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

    // WXML 中按钮统一绑定 catchtap，根据预计算类型过滤无响应的按钮，避免已结束/已满等状态触发业务逻辑
    // 加入候补按钮通过 data-action="waitlist" 单独放行
    const action = e.currentTarget.dataset.action;
    const btnType = course.r && course.r.bookBtnType;
    if (action !== 'waitlist' && ['ended', 'cancelled', 'done', 'ongoing', 'not_open', 'waitlisted', 'full'].indexOf(btnType) !== -1) {
      return;
    }

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
      // 判断是否为补约场景：当前时间已过预约截止时间（开课前 booking_deadline 分钟）
      let isLateBooking = false;
      if (course.date && course.start_time) {
        const classStart = new Date(`${course.date} ${course.start_time}`.replace(/-/g, '/'));
        const bookingDeadlineMin = course.booking_deadline || 120;
        const deadline = new Date(classStart.getTime() - bookingDeadlineMin * 60000);
        if (new Date() > deadline) {
          isLateBooking = true;
        }
      }
      let modalText = `确认预约「${course.course_name}」？\n时间：${course.start_time}-${course.end_time}\n教练：${course.coach_id && course.coach_id.name || '待定'}`;
      if (isLateBooking) {
        modalText += '\n\n本课程已过预约截止时间，属补约。预约后5分钟内可取消（退课时），超时需使用豁免权取消。';
      }

      // 检查是否有待激活套餐，提示用户套餐将被激活
      // 通过已有的 packages 数据判断（避免重复请求）
      const pkgData = this.data._packagesData || {};
      const pending = pkgData.pending || [];
      const active = pkgData.active || [];
      if (pending.length > 0 && active.length === 0) {
        const pkgName = pending[0].package_name || '套餐';
        modalText += `\n\n预约将激活您的「${pkgName}」，服务有效期从激活日开始计算。`;
      }
      this.setData({
        showBookingModal: true,
        bookingModalCourse: course,
        bookingModalText: modalText
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
      const sectionTitle = activeDay && activeDay.isToday ? '今天场次' : (this.formatDate(activeDay.date) + ' ' + activeDay.weekDay);
      this.setData({
        weekDays,
        weekDaysIndex: idx,
        selectedDate: selectedDate || weekDays[0].date,
        sectionTitle
      });
    } else {
      const newDates = getNextDays(7, this.data.holidays);
      const activeDay = newDates[0];
      const sectionTitle = activeDay && activeDay.isToday ? '今天场次' : (this.formatDate(activeDay.date) + ' ' + activeDay.weekDay);
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
        const sectionTitle = dateItem.isToday ? '今天场次' : (this.formatDate(dateItem.date) + ' ' + dateItem.weekDay);
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
        const sectionTitle = dateItem.isToday ? '今天场次' : (this.formatDate(dateItem.date) + ' ' + dateItem.weekDay);
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

  // 预计算课程卡片的渲染字段，避免 WXML 中重复进行复杂判断和计算
  _computeCourseRender(course, pageState) {
    const {
      isOfficial = false,
      isRestrictedUser = false,
      canViewCapacity = false,
      canBookCurrentStore = false,
      bookedScheduleIds = [],
      waitlistedScheduleIds = [],
      completedScheduleIds = []
    } = pageState;

    const id = course._id;
    const isBooked = bookedScheduleIds.indexOf(id) !== -1;
    const isWaitlisted = waitlistedScheduleIds.indexOf(id) !== -1;
    const isCompleted = completedScheduleIds.indexOf(id) !== -1;

    let bookBtnType = '';
    let bookBtnText = '';
    let bookBtnClass = '';
    let showWaitlistBtn = false;

    if (isRestrictedUser) {
      if (course._ended) {
        bookBtnType = 'ended';
        bookBtnText = '已结束';
        bookBtnClass = 'disabled';
      } else if (!course.bookingOpen) {
        bookBtnType = 'not_open';
        bookBtnText = '未开放预约';
        bookBtnClass = 'disabled-clickable';
      } else if (isBooked) {
        bookBtnType = 'booked';
        bookBtnText = '已预约';
        bookBtnClass = 'booked';
      } else {
        bookBtnType = 'cannot_book';
        bookBtnText = '不可预约';
        bookBtnClass = 'disabled-clickable';
      }
    } else {
      if (course.status === 'cancelled') {
        bookBtnType = 'cancelled';
        bookBtnText = '已取消';
        bookBtnClass = 'disabled';
      } else if (course._ended && isCompleted) {
        bookBtnType = 'done';
        bookBtnText = '已完成';
        bookBtnClass = 'state-done';
      } else if (course._ended) {
        bookBtnType = 'ended';
        bookBtnText = '已结束';
        bookBtnClass = 'disabled';
      } else if (course._ongoing) {
        bookBtnType = 'ongoing';
        bookBtnText = '进行中';
        bookBtnClass = 'state-ongoing';
      } else if (isBooked) {
        bookBtnType = 'booked';
        bookBtnText = '已预约';
        bookBtnClass = 'booked';
      } else if (isWaitlisted) {
        bookBtnType = 'waitlisted';
        bookBtnText = '候补中';
        bookBtnClass = 'waitlist-btn waitlisted';
      } else if (course.status === 'full') {
        bookBtnType = 'full';
        bookBtnText = '已满';
        bookBtnClass = 'state-full';
        showWaitlistBtn = !isWaitlisted;
      } else if (!course.bookingOpen) {
        bookBtnType = 'not_open';
        bookBtnText = '未开放预约';
        bookBtnClass = 'disabled-clickable';
      } else if (isOfficial && !canBookCurrentStore) {
        bookBtnType = 'cannot_book';
        bookBtnText = '不可预约';
        bookBtnClass = 'disabled-clickable';
      } else {
        bookBtnType = 'book';
        bookBtnText = '预约';
        bookBtnClass = '';
      }
    }

    const bookedUsers = course.booked_users || [];
    return {
      ...course,
      r: {
        coachName: (course.coach_id && course.coach_id.name) || '待定',
        coachAvatar: course.coachAvatar || '',
        time: `${course.start_time || '00:00'} - ${course.end_time || '00:00'}`,
        room: course.room || course.classroom || '',
        danceStyle: course.danceStyleName || '',
        danceTagBg: course.danceTagBg,
        danceTagText: course.danceTagText,
        minCapacity: `最低${course.min_bookings || 5}人成班`,
        capacity: canViewCapacity ? `已约${course.current_bookings || 0}/${course.max_bookings || 20}` : '已约?/?',
        capacityLocked: !canViewCapacity,
        bookBtnType,
        bookBtnText,
        bookBtnClass,
        showWaitlistBtn,
        showAvatars: canViewCapacity && bookedUsers.length > 0,
        avatarList: bookedUsers.slice(0, 10),
        avatarMore: Math.max(0, bookedUsers.length - 10),
        deadlineText: course.booking_deadline_text || '',
        cancelDeadlineText: course.cancel_deadline_text || '',
        showDeadline: isOfficial && !!course.booking_deadline_text,
        showTime: isOfficial,
        showMinCapacity: isOfficial,
        showRoom: !!(course.room || course.classroom)
      }
    };
  },

  // 仅更新课程列表中各卡片的按钮状态（ bookedScheduleIds / waitlistedScheduleIds 变化时调用）
  _updateCoursesButtonState() {
    const { courses, isOfficial, isRestrictedUser, canViewCapacity, canBookCurrentStore, bookedScheduleIds, waitlistedScheduleIds, completedScheduleIds } = this.data;
    if (!courses || courses.length === 0) return;

    const pageState = { isOfficial, isRestrictedUser, canViewCapacity, canBookCurrentStore, bookedScheduleIds, waitlistedScheduleIds, completedScheduleIds };
    const updates = {};
    courses.forEach((course, index) => {
      const rendered = this._computeCourseRender(course, pageState);
      updates[`courses[${index}].r`] = rendered.r;
    });
    this.setData(updates);
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
