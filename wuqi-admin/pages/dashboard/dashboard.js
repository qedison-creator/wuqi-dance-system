const app = getApp();
const { request } = require('../../utils/request');

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
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

Page({
  data: {
    storeList: [],
    currentStoreIndex: 0,
    currentStore: null,
    currentStoreName: '全部门店',
    userRoleName: '管理员',
    currentDate: '',
    greeting: '',
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
    detailList: []
  },

  onLoad() {
    this.setData({
      currentDate: getCurrentDate(),
      greeting: getGreeting()
    });
    this.loadUserInfo();
    this.loadStores();
  },

  onShow() {
    if (app.checkAuth && !app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
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

  async loadAllData() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';

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
    wx.navigateTo({ url: '/pages/bookings/bookings' });
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