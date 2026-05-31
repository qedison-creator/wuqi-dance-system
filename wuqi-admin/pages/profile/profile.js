const app = getApp();
const { logout } = require('../../utils/auth');
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: null,
    currentStore: null,
    isAdmin: false,
    isStoreManager: false,
    permAccount: false,
    permConfig: false,
    permLog: false,
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      this.setData({
        userInfo: userInfo,
        currentStore: app.globalData.currentStore || null,
        isAdmin: userInfo.role === 'super_admin',
        isStoreManager: userInfo.role === 'store_manager',
        permAccount: app.hasPermission('account'),
        permConfig: app.hasPermission('config'),
        permLog: app.hasPermission('log'),
      });
    } else {
      this.loadUserInfo();
    }
  },

  async loadUserInfo() {
    try {
      const res = await request({ url: '/auth/me', method: 'GET' });
      const userInfo = res.data;
      app.globalData.userInfo = userInfo;
      this.setData({
        userInfo: userInfo,
        currentStore: app.globalData.currentStore || null,
        isAdmin: userInfo.role === 'super_admin',
        isStoreManager: userInfo.role === 'store_manager',
        permAccount: app.hasPermission('account'),
        permConfig: app.hasPermission('config'),
        permLog: app.hasPermission('log'),
      });
    } catch (err) {
      console.error('获取用户信息失败', err);
    }
  },

  onManageAccounts() {
    wx.navigateTo({ url: '/pages/settings/accounts/accounts' });
  },

  onGoToConfig() {
    wx.navigateTo({ url: '/pages/settings/config/config' });
  },

  onGoToSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  onSystemReset() {
    wx.navigateTo({ url: '/pages/system-reset/system-reset' });
  },

  onOperationLog() {
    wx.navigateTo({ url: '/pages/logs/logs' });
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确认退出登录？',
      success: (res) => {
        if (res.confirm) {
          logout();
        }
      }
    });
  }
});
