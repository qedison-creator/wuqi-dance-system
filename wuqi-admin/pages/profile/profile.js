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
    avatarLoadFailed: false,
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      // 规范化avatar_url：相对路径按环境拼接，HTTP IP地址转为当前环境地址
      this.normalizeAvatarUrl(userInfo);
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
      // 规范化avatar_url
      if (userInfo) {
        this.normalizeAvatarUrl(userInfo);
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
    } catch (err) {
      console.error('获取用户信息失败', err);
    }
  },

  /**
   * 规范化头像URL：
   * - 相对路径（/uploads/...）：拼接当前环境serverBase
   * - HTTP IP地址（旧数据）：提取相对路径后重新拼接当前环境地址
   * - HTTPS地址：直接使用
   */
  normalizeAvatarUrl(userInfo) {
    if (!userInfo || !userInfo.avatar_url) return;
    const config = require('../../config/index.js');
    const serverBase = config.serverBase || '';
    const url = userInfo.avatar_url;

    if (url.startsWith('https://')) {
      // HTTPS地址直接使用
      return;
    }

    if (url.startsWith('http://')) {
      // HTTP IP地址（旧数据），提取相对路径部分
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      if (match) {
        userInfo.avatar_url = serverBase + match[1];
      }
      app.globalData.userInfo = userInfo;
      return;
    }

    // 相对路径，拼接当前环境地址
    userInfo.avatar_url = serverBase + url;
    app.globalData.userInfo = userInfo;
  },

  onAvatarError(e) {
    console.log('[Profile] 头像加载失败，使用本地默认头像');
    this.setData({ avatarLoadFailed: true });
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
