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
    } catch (err) {
      console.error('加载用户信息失败', err);
    }
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