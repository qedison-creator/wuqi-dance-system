const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    currentStore: null,
    isAdmin: false,
    isStoreManager: false,
    permSchedule: false,
    permCoach: false,
    permVideo: false,
    permSalary: false,
    permPackage: false,
    permWaitlist: false,
    permBanner: false,
    permHoliday: false,
    permCheckin: false,
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
        permVideo: app.hasPermission('video'),
        permSalary: app.hasPermission('salary'),
        permPackage: app.hasPermission('package'),
        permWaitlist: app.hasPermission('waitlist'),
        permBanner: app.hasPermission('banner'),
        permHoliday: app.hasPermission('holiday'),
        permCheckin: app.hasPermission('checkin'),
      });
    } catch (err) {
      console.error('加载用户信息失败', err);
    }
  },

  onGoToStoreMaintenance() {
    wx.navigateTo({ url: '/pages/shop/store-maintenance/store-maintenance' });
  },

  onGoToSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  onGoToWaitlist() {
    wx.navigateTo({ url: '/pages/waitlist/waitlist' });
  },

  onGoToSalary() {
    wx.navigateTo({ url: '/pages/salary/salary' });
  },

  onGoToPackageLogs() {
    wx.navigateTo({ url: '/pages/package-logs/package-logs' });
  },

  onGoToCoaches() {
    wx.navigateTo({ url: '/pages/coaches/coaches' });
  },

  onGoToVideos() {
    wx.navigateTo({ url: '/pages/videos/videos' });
  },

  onGoToBanner() {
    wx.navigateTo({ url: '/pages/banner/banner' });
  },

  onGoToHolidays() {
    wx.navigateTo({ url: '/pages/holidays/holidays' });
  },

  onGoToExemption() {
    wx.navigateTo({ url: '/pages/settings/exemption/exemption' });
  },

  onGoToAnnouncements() {
    wx.navigateTo({ url: '/pages/announcements/announcements' });
  },
});