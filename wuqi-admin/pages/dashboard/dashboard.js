const app = getApp();
const { request } = require('../../utils/request');
const config = require('../../config/index.js');

function getCurrentDate() {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const w = weekdays[now.getDay()];
  return `${y}年${m}月${d}日 ${w}`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8)    return { text: '晨安', emoji: '🌅', sub: '新的一天，好运满满，今日客户多多上门' };
  if (hour >= 8 && hour < 12)   return { text: '上午好', emoji: '☀️', sub: '营业前的时光，养足精神，今天报名一定多' };
  if (hour >= 12 && hour < 14)  return { text: '午安', emoji: '☕', sub: '午后开门迎客，祝生意兴隆，会员源源不断' };
  if (hour >= 14 && hour < 17)  return { text: '下午好', emoji: '🌟', sub: '午后时光，客户陆续上门，财运滚滚而来' };
  if (hour >= 17 && hour < 19)  return { text: '傍晚好', emoji: '🌆', sub: '晚间高峰即将到来，迎接来报名的客户，多多成交' };
  if (hour >= 19 && hour < 22)  return { text: '晚上好', emoji: '🌙', sub: '课程进行中，舞蹈教室正热闹着呢' };
  return { text: '夜深了', emoji: '🌃', sub: '今日课程已结束，好好休息，明天继续成交收钱' };
}

function getTheme() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8)    return 'sunrise';
  if (hour >= 8 && hour < 12)   return 'morning';
  if (hour >= 12 && hour < 14)  return 'noon';
  if (hour >= 14 && hour < 17)  return 'afternoon';
  if (hour >= 17 && hour < 19)  return 'sunset';
  if (hour >= 19 && hour < 22)  return 'night';
  return 'late-night';
}

Page({
  data: {
    storeList: [],
    currentStoreIndex: 0,
    currentStore: null,
    currentStoreName: '全部门店',
    showStoreModal: false,
    userRoleName: '管理员',
    currentDate: '',
    greeting: { text: '', emoji: '', sub: '' },
    theme: 'morning',
    stats: {
      todaySchedules: 0,
      totalMembers: 0,
      waitlistCount: 0,
      pendingReviews: 0
    },
    banners: [],
    scheduleEndAlert: {
      visible: false,
      weeksLeft: 0,
      daysLeft: 0
    },
    todos: [],
    todoList: [],
    loadingSkeleton: true,
    showDetailModal: false,
    detailTitle: '',
    detailList: [],
    systemConfigs: {},
    heroBackgroundUrl: ''
  },

  onLoad() {
    const theme = getTheme();
    this.applyHeroBackground(theme);
    this.setData({
      currentDate: getCurrentDate(),
      greeting: getGreeting(),
      theme: theme
    });
    this.loadUserInfo();
    this.loadStores();
  },

  onHeroImageError() {
    // 服务器图片加载失败，隐藏图片（hero区域有渐变色背景）
    console.log('服务器背景图加载失败');
    this.setData({ heroBackgroundUrl: '' });
  },

  onShow() {
    if (app.checkAuth && !app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.setData({ greeting: getGreeting(), theme: getTheme() });
    this.loadUserInfo();
    this.loadAllData();
  },

  loadUserInfo() {
    if (!app.globalData.userInfo) {
      request({ url: '/auth/me', method: 'GET' }).then(res => {
        const data = res.data || {};
        app.globalData.userInfo = data;
        this.applyUserInfo(data.admin ? data.admin : data);
      }).catch(() => {});
      return;
    }
    const raw = app.globalData.userInfo;
    const userInfo = raw.admin ? raw.admin : raw;
    this.applyUserInfo(userInfo);
  },

  applyUserInfo(userInfo) {
    const roleNameMap = {
      'super_admin': '超级管理员',
      'store_manager': '店长',
      'staff': '员工'
    };
    this.setData({
      userInfo,
      userRoleName: roleNameMap[userInfo.role] || '管理员'
    });
  },

  async loadStores() {
    try {
      const res = await request({
        url: '/stores',
        method: 'GET'
      });
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      const storeList = [{ _id: '', name: '全部门店' }].concat(list);
      const currentStore = this.data.currentStore;
      let currentStoreIndex = 0;
      let currentStoreName = '全部门店';
      if (currentStore && currentStore._id) {
        const idx = storeList.findIndex(s => s._id === currentStore._id);
        if (idx >= 0) {
          currentStoreIndex = idx;
          currentStoreName = storeList[idx].name;
        }
      }
      this.setData({
        storeList,
        currentStoreIndex,
        currentStoreName,
        currentStore: currentStoreIndex > 0 ? storeList[currentStoreIndex] : null
      }, () => {
        this.loadAllData();
      });
    } catch (err) {
      console.error('加载门店列表失败', err);
      this.loadAllData();
    }
  },

  async loadStats(homeData) {
    const data = homeData || {};
    const statsData = data.stats || {};
    this.setData({
      stats: {
        todaySchedules: statsData.today_schedules || 0,
        totalMembers: statsData.total_members || 0,
        waitlistCount: this.data.stats.waitlistCount || 0,
        pendingReviews: data.pending_review || 0
      }
    });
  },

  buildTodos(homeData, statsData) {
    const todoList = [];

    if (homeData) {
      if (homeData.pending_review > 0) {
        todoList.push({
          _id: 'member_audit',
          title: '会员审核',
          type: 'member_audit',
          urgent: true,
          count: homeData.pending_review,
          unit: '人'
        });
      }

      if (homeData.stats && homeData.stats.today_schedules > 0) {
        todoList.push({
          _id: 'today_schedule',
          title: '今日课程',
          type: 'schedule',
          urgent: false,
          count: homeData.stats.today_schedules,
          unit: '节'
        });
      }
    }

    if (statsData) {
      if (statsData.expiring_time_cards && statsData.expiring_time_cards.length > 0) {
        todoList.push({
          _id: 'expiring_cards',
          title: '时间卡到期',
          type: 'schedule_extend',
          urgent: true,
          count: statsData.expiring_time_cards.length,
          unit: '人'
        });
      }

      if (statsData.count_card_alerts && statsData.count_card_alerts.length > 0) {
        todoList.push({
          _id: 'count_card_alert',
          title: '次卡跟进',
          type: 'expiring_packages',
          urgent: true,
          count: statsData.count_card_alerts.length,
          unit: '人'
        });
      }

      if (statsData.upcoming_schedules && statsData.upcoming_schedules.length > 0) {
        todoList.push({
          _id: 'upcoming_schedule',
          title: '近期课程',
          type: 'schedule',
          urgent: false,
          count: statsData.upcoming_schedules.length,
          unit: '节'
        });
      }
    }

    return todoList;
  },

  async loadSystemConfigs() {
    try {
      // 优先使用默认图，不依赖接口
      this.applyHeroBackground({});
      
      // 尝试加载后端配置（如果后端可能还没部署，暂时静默尝试
      try {
        const res = await request({ url: '/system/configs', method: 'GET', silent: true });
        const configs = res.data || {};
        this.setData({ systemConfigs: configs });
        // 如果成功拿到配置，再应用一次背景
        if (Object.keys(configs).length > 0) {
          this.applyHeroBackground(configs);
        }
      } catch (e) {
        // 接口暂时不可用，不做任何处理
        console.log('后端系统配置接口还未部署，使用默认背景图');
      }
    } catch (err) {
      // 完全静默
    }
  },

  applyHeroBackground(themeOrConfigs) {
    let theme;
    let bgUrl = '';

    if (typeof themeOrConfigs === 'string') {
      theme = themeOrConfigs;
    } else if (themeOrConfigs && typeof themeOrConfigs === 'object') {
      theme = this.data.theme;
      // 参照会员端banner方式：优先使用后端API返回的图片URL
      if (themeOrConfigs.hero_background_url) {
        bgUrl = themeOrConfigs.hero_background_url;
        // 参照会员端avatar_url处理：相对路径拼接serverBase，完整URL直接使用
        if (!bgUrl.startsWith('http')) {
          bgUrl = config.serverBase + bgUrl;
        }
      }
    } else {
      theme = this.data.theme;
    }

    // 没有后端配置URL时，使用默认路径拼接
    if (!bgUrl) {
      bgUrl = config.serverBase + '/uploads/hero/hero-' + theme + '.jpg';
    }

    this.setData({ heroBackgroundUrl: bgUrl });
  },

  async loadAllData() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';

      this.loadSystemConfigs();

      const [homeRes, statsRes, bannersRes] = await Promise.allSettled([
        request({ url: '/home/admin', method: 'GET' }),
        request({ url: '/stats/dashboard', method: 'GET', data: { store_id: storeId } }).catch(() => ({ data: {} })),
        request({ url: '/banners', method: 'GET', data: {} }).catch(() => ({ data: [] }))
      ]);

      const homeData = homeRes.status === 'fulfilled' ? (homeRes.value.data || {}) : {};
      const statsData = statsRes.status === 'fulfilled' ? (statsRes.value.data || {}) : {};

      this.loadStats(homeData);

      const todoList = this.buildTodos(homeData, statsData);
      this.setData({ todos: todoList, todoList });

      const expiringCards = statsData.expiring_time_cards || [];
      this.setData({
        scheduleEndAlert: {
          visible: expiringCards.length > 0,
          weeksLeft: 0,
          daysLeft: expiringCards.length
        }
      });

      const banners = bannersRes.status === 'fulfilled'
        ? (Array.isArray(bannersRes.value.data.list) ? bannersRes.value.data.list : (Array.isArray(bannersRes.value.data) ? bannersRes.value.data : []))
        : [];
      this.setData({ banners });

    } catch (err) {
      console.error('加载数据失败', err);
    }
    this.setData({ loadingSkeleton: false });
  },

  onRefresh() {
    wx.showLoading({ title: '刷新中...', mask: true });
    this.setData({ loadingSkeleton: true });
    this.loadAllData().finally(() => {
      wx.hideLoading();
      wx.stopPullDownRefresh();
    });
  },

  onOpenStoreModal() {
    this.setData({ showStoreModal: true });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  onSelectStore(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const storeList = this.data.storeList;
    const store = storeList[index];
    this.setData({
      currentStoreIndex: index,
      currentStore: store && store._id ? store : null,
      currentStoreName: store ? store.name : '全部门店',
      showStoreModal: false,
      loadingSkeleton: true
    }, () => {
      this.loadAllData();
    });
  },

  onStoreChange(e) {
    const index = parseInt(e.detail.value);
    const storeList = this.data.storeList;
    const store = storeList[index];
    this.setData({
      currentStoreIndex: index,
      currentStore: store && store._id ? store : null,
      currentStoreName: store ? store.name : '全部门店',
      loadingSkeleton: true
    }, () => {
      this.loadAllData();
    });
  },

  onStatTap(e) {
    const type = e.currentTarget.dataset.type;
    switch (type) {
      case 'today':
        this.onGoToSchedule();
        break;
      case 'members':
        this.onGoToMembers();
        break;
      case 'waitlist':
        wx.navigateTo({ url: '/pages/waitlist/waitlist' });
        break;
      case 'reviews':
        wx.navigateTo({ url: '/pages/members/member-review/member-review' });
        break;
    }
  },

  onTodoTap(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const todo = this.data.todoList.find(t => t._id === item._id) || item;
    switch (todo.type) {
      case 'member_audit':
        wx.switchTab({ url: '/pages/members/members' });
        break;
      case 'schedule':
        wx.navigateTo({ url: '/pages/schedule/schedule' });
        break;
      case 'schedule_extend':
        this.showScheduleExtendModal();
        break;
      case 'expiring_packages':
        wx.switchTab({ url: '/pages/members/members' });
        break;
      default:
        break;
    }
  },

  showScheduleExtendModal() {
    this.setData({
      showDetailModal: true,
      detailTitle: '排课到期提醒',
      detailList: []
    });
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    request({
      url: '/stats/dashboard',
      method: 'GET',
      data: { store_id: storeId }
    }).then(res => {
      const data = res.data || {};
      const list = data.expiring_time_cards || data.count_card_alerts || [];
      this.setData({ detailList: list });
    }).catch(err => {
      console.error('加载排课到期详情失败', err);
    });
  },

  onViewSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  onGoToSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  onGoToMembers() {
    wx.switchTab({ url: '/pages/members/members' });
  },

  onGoToBookings() {
    wx.navigateTo({ url: '/pages/booking-summary/booking-summary' });
  },

  onGoToCheckIn() {
    wx.navigateTo({ url: '/pages/check-in/check-in' });
  },

  onScanSignIn() {
    wx.navigateTo({ url: '/pages/check-in/check-in' });
  },

  onGoToVideos() {
    wx.navigateTo({ url: '/pages/videos/videos' });
  },

  onViewAllTodos() {
    wx.navigateTo({ url: '/pages/todo-list/todo-list' });
  },

  onCloseDetail() {
    this.setData({ showDetailModal: false });
  },

  onDetailTap() {}
});