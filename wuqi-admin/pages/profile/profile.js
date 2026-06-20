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
    avatarRetryCount: 0,
    avatarSrc: '',
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    // 每次进入页面重置头像加载状态，允许重新尝试加载
    this.setData({ avatarLoadFailed: false, avatarRetryCount: 0 });
    // 始终从服务端拉取最新用户信息，避免本地缓存过期导致头像失效
    this.loadUserInfo();
  },

  async loadUserInfo() {
    try {
      const res = await request({ url: '/auth/me', method: 'GET' });
      const userInfo = res.data;
      if (userInfo) {
        this.normalizeAvatarUrl(userInfo);
        app.globalData.userInfo = userInfo;
        // 构造头像地址，附带时间戳避免缓存导致加载失败
        const avatarSrc = this._buildAvatarSrc(userInfo.avatar_url);
        this.setData({
          userInfo: userInfo,
          avatarSrc,
          currentStore: app.globalData.currentStore || null,
          isAdmin: userInfo.role === 'super_admin',
          isStoreManager: userInfo.role === 'store_manager',
          permAccount: app.hasPermission('account'),
          permConfig: app.hasPermission('config'),
          permLog: app.hasPermission('log'),
        });
      }
    } catch (err) {
      console.error('获取用户信息失败', err);
      // 请求失败时降级使用本地缓存的 userInfo
      const userInfo = app.globalData.userInfo;
      if (userInfo) {
        this.normalizeAvatarUrl(userInfo);
        const avatarSrc = this._buildAvatarSrc(userInfo.avatar_url);
        this.setData({
          userInfo,
          avatarSrc,
          currentStore: app.globalData.currentStore || null,
          isAdmin: userInfo.role === 'super_admin',
          isStoreManager: userInfo.role === 'store_manager',
          permAccount: app.hasPermission('account'),
          permConfig: app.hasPermission('config'),
          permLog: app.hasPermission('log'),
        });
      }
    }
  },

  /**
   * 构造头像 src：附带时间戳防缓存，最多重试 3 次
   */
  _buildAvatarSrc(rawUrl) {
    if (!rawUrl) return '';
    const sep = rawUrl.indexOf('?') >= 0 ? '&' : '?';
    return rawUrl + sep + '_t=' + Date.now();
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
    const retryCount = this.data.avatarRetryCount || 0;
    // 最多重试 3 次，避免无限重试
    if (retryCount < 3) {
      const rawUrl = (this.data.userInfo && this.data.userInfo.avatar_url) || '';
      if (rawUrl) {
        const sep = rawUrl.indexOf('?') >= 0 ? '&' : '?';
        const newSrc = rawUrl + sep + '_retry=' + (retryCount + 1) + '&_t=' + Date.now();
        console.log('[Profile] 头像加载失败，第 ' + (retryCount + 1) + ' 次重试');
        this.setData({ avatarRetryCount: retryCount + 1, avatarSrc: newSrc });
        return;
      }
    }
    // 重试耗尽或无 URL，使用本地默认头像兜底
    console.log('[Profile] 头像加载失败，使用本地默认头像');
    this.setData({ avatarLoadFailed: true });
  },

  onManageAccounts() {
    wx.navigateTo({ url: '/package-settings/pages/settings/accounts/accounts' });
  },

  onAccountSecurity() {
    wx.navigateTo({ url: '/package-common/pages/profile/account-security/account-security' });
  },

  onGoToConfig() {
    wx.navigateTo({ url: '/package-settings/pages/settings/config/config' });
  },

  onGoToSettings() {
    wx.navigateTo({ url: '/package-settings/pages/settings/settings' });
  },

  onSystemReset() {
    wx.navigateTo({ url: '/package-settings/pages/system-reset/system-reset' });
  },

  onOperationLog() {
    wx.navigateTo({ url: '/package-common/pages/logs/logs' });
  },

  onAbout() {
    wx.navigateTo({ url: '/package-common/pages/about/about' });
  },

  onPrivacy() {
    wx.navigateTo({ url: '/package-common/pages/privacy/privacy' });
  },

  onAgreement() {
    wx.navigateTo({ url: '/package-common/pages/agreement/agreement' });
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
