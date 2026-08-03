const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    currentStore: null,
    isAdmin: false,
    isStoreManager: false,
    permSchedule: false,
    permCoach: false,
    permImage: false,
    permSalary: false,
    permPackageLog: false,
    permBanner: false,
    permHoliday: false,
    permCheckin: false,
    permAnnouncement: false,
    permStore: false,
    permExemption: false,
    // 门店选择器
    showStoreSwitcher: false,
    storeList: [],
    selectedStoreId: '',
    selectedStoreName: '全部门店',
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.loadUserInfo();
  },

  async loadUserInfo() {
    try {
      let userInfo = app.globalData.userInfo;

      if (!userInfo) {
        const res = await request({ url: '/auth/me', method: 'GET' });
        userInfo = res.data;
        app.globalData.userInfo = userInfo;
      }

      const isAdmin = userInfo && userInfo.role === 'super_admin';
      const isStoreManager = userInfo && userInfo.role === 'store_manager';

      this.setData({
        currentStore: app.globalData.currentStore || null,
        isAdmin,
        isStoreManager,
        permSchedule: app.hasPermission('schedule'),
        permCoach: app.hasPermission('coach'),
        permImage: app.hasPermission('image'),
        permSalary: app.hasPermission('salary'),
        permPackageLog: app.hasPermission('package_log'),
        permBanner: app.hasPermission('banner'),
        permHoliday: app.hasPermission('holiday'),
        permCheckin: app.hasPermission('checkin'),
        permAnnouncement: app.hasPermission('announcement'),
        permStore: app.hasPermission('store'),
        permExemption: app.hasPermission('exemption'),
      });

      // 初始化门店选择器
      this.initStoreSwitcher();
    } catch (err) {
      console.error('加载用户信息失败', err);
    }
  },

  // 初始化门店选择器
  async initStoreSwitcher() {
    const isSingle = app.isSingleStoreRole();
    if (isSingle) {
      // 单门店角色：固定所属门店，不显示选择器
      const defaultStoreId = app.getDefaultStoreId();
      app.globalData.shopStoreId = defaultStoreId;
      this.setData({
        showStoreSwitcher: false,
        selectedStoreId: defaultStoreId,
        selectedStoreName: '',
      });
      return;
    }

    // 多门店角色/超管：显示选择器
    try {
      let storeList = app.globalData.storeList || [];
      if (storeList.length === 0) {
        const res = await request({ url: '/stores', method: 'GET' });
        storeList = app.filterStoresForUser(res.data || []);
        app.globalData.storeList = storeList;
      }

      // 恢复上次选择，否则默认"全部门店"
      const savedStoreId = app.globalData.shopStoreId || '';
      let selectedStoreId = '';
      let selectedStoreName = '全部门店';

      if (savedStoreId) {
        const matched = storeList.find(s => String(s._id) === String(savedStoreId));
        if (matched) {
          selectedStoreId = String(matched._id);
          selectedStoreName = matched.name;
        }
      }

      this.setData({
        showStoreSwitcher: true,
        storeList,
        selectedStoreId,
        selectedStoreName,
      });
      app.globalData.shopStoreId = selectedStoreId;
    } catch (err) {
      console.error('加载门店列表失败', err);
    }
  },

  // 点击门店选择器
  onStoreSwitcherTap() {
    if (!this.data.storeList.length) return;
    const items = ['全部门店', ...this.data.storeList.map(s => s.name)];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx === 0) {
          // 全部门店
          this.setData({ selectedStoreId: '', selectedStoreName: '全部门店' });
          app.globalData.shopStoreId = '';
        } else {
          const store = this.data.storeList[idx - 1];
          this.setData({ selectedStoreId: String(store._id), selectedStoreName: store.name });
          app.globalData.shopStoreId = String(store._id);
        }
      }
    });
  },

  onGoToStoreMaintenance() {
    wx.navigateTo({ url: '/package-shop/pages/shop/store-maintenance/store-maintenance' });
  },

  onGoToSchedule() {
    wx.navigateTo({ url: '/package-schedule/pages/schedule/schedule' });
  },

  onGoToBookingWindow() {
    wx.navigateTo({ url: '/package-shop/pages/shop/booking-window/booking-window' });
  },

  onGoToSalary() {
    wx.navigateTo({ url: '/package-shop/pages/salary/salary' });
  },

  onGoToPackageLogs() {
    wx.navigateTo({ url: '/package-shop/pages/package-logs/package-logs' });
  },

  onGoToCoaches() {
    wx.navigateTo({ url: '/package-shop/pages/coaches/coaches' });
  },

  onGoToImages() {
    wx.navigateTo({ url: '/package-shop/pages/images/images' });
  },

  onGoToBanner() {
    wx.navigateTo({ url: '/package-shop/pages/banner/banner' });
  },

  onGoToHolidays() {
    wx.navigateTo({ url: '/package-shop/pages/holidays/holidays' });
  },

  onGoToExemption() {
    wx.navigateTo({ url: '/package-settings/pages/settings/exemption/exemption' });
  },

  onGoToAnnouncements() {
    wx.navigateTo({ url: '/package-shop/pages/announcements/announcements' });
  },
});
