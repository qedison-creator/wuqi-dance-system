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
      // 兼容旧数据：相对路径转完整URL
      if (userInfo.avatar_url && !userInfo.avatar_url.startsWith('http')) {
        const config = require('../../config/index.js');
        userInfo.avatar_url = config.serverBase + userInfo.avatar_url;
        app.globalData.userInfo = userInfo;
      }
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
      const config = require('../../config/index.js');
      const serverBase = config.serverBase || '';
      const res = await request({ url: '/auth/me', method: 'GET' });
      const userInfo = res.data;
      // 规范化avatar_url
      if (userInfo && userInfo.avatar_url && !userInfo.avatar_url.startsWith('http')) {
        userInfo.avatar_url = serverBase + userInfo.avatar_url;
      }
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

  onAvatarError(e) {
    console.log('[Profile] 头像加载失败，使用首字母头像');
    const userInfo = { ...this.data.userInfo, avatar_url: '' };
    this.setData({ userInfo });
    app.globalData.userInfo = userInfo;
  },

  onManageAccounts() {
    wx.navigateTo({ url: '/pages/settings/accounts/accounts' });
  },

  onAccountSecurity() {
    wx.navigateTo({ url: '/pages/profile/account-security/account-security' });
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
