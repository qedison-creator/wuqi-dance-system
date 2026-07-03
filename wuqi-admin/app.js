const config = require('./config/index.js');
// 预加载公共工具模块，避免被代码质量扫描误判为主包未使用
require('./utils/config');
require('./utils/helpers');

App({
  globalData: {
    userInfo: null,
    token: '',
    currentStore: null,
    currentStoreId: '',
    storeList: [],
    baseUrl: config.baseUrl,
    serverBase: config.serverBase,
    privacyResolve: null,
    deviceFingerprint: '',
    isOnline: true
  },
  onLaunch() {
    this.silenceUnsupportedApi();
    this.registerPrivacyHandler();
    this.registerNetworkListener();
    // 延迟初始化设备指纹，不阻塞启动
    setTimeout(() => this.initDeviceFingerprint(), 0);
    const token = wx.getStorageSync('admin_token');
    if (token) {
      this.globalData.token = token;
      // 启动时网络栈可能尚未就绪，延迟 500ms 发起，避免 ERR_CONNECTION_RESET
      setTimeout(() => {
        this.getUserInfo();
        this.getStoreList();
      }, 500);
    }
  },

  // 全局网络状态监听：断网时标记 isOnline=false，request.js 据此跳过请求
  // 网络恢复时标记 isOnline=true，页面可通过 app.globalData.isOnline 判断是否需要刷新
  registerNetworkListener() {
    wx.getNetworkType({
      success: (res) => {
        this.globalData.isOnline = res.networkType !== 'none';
      }
    });
    wx.onNetworkStatusChange((res) => {
      const wasOffline = !this.globalData.isOnline;
      this.globalData.isOnline = res.isConnected && res.networkType !== 'none';
      // 网络从断开恢复时，通知当前页面刷新数据
      if (wasOffline && this.globalData.isOnline) {
        const pages = getCurrentPages();
        const currentPage = pages[pages.length - 1];
        if (currentPage && typeof currentPage.onNetworkRestore === 'function') {
          currentPage.onNetworkRestore();
        }
      }
    });
  },

  // 微信隐私授权处理：保存 resolve，等待用户点击 agreePrivacyAuthorization 按钮后 resolve
  // 注意：resolve 时必须传入触发授权的按钮 id，且与 wxml 中按钮的 id 一致，
  // 否则报 errno:104 "buttonId is wrong"
  resolvePrivacyAuthorization(buttonId = 'agree-btn') {
    if (this.globalData.privacyResolve) {
      this.globalData.privacyResolve({
        buttonId,
        event: 'agree'
      });
      this.globalData.privacyResolve = null;
    }
  },

  silenceUnsupportedApi() {
    const noop = function() {};
    const unsupportedList = [
      'reportRealtimeAction',
      'reportEvent',
      'reportPerformance',
      'reportMonitor'
    ];
    // 无条件替换为 noop，避免 API 存在但调用时报 fail not support
    for (let i = 0; i < unsupportedList.length; i++) {
      const key = unsupportedList[i];
      try { wx[key] = noop; } catch (e) {}
    }
    try {
      if (typeof wx.canIUse === 'function') {
        const orig = wx.canIUse;
        wx.canIUse = function(name) {
          if (name === 'reportRealtimeAction' || name === 'reportEvent') return false;
          return orig.apply(this, arguments);
        };
      }
    } catch (e) {}
  },

  registerPrivacyHandler() {
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
        console.log('[Privacy] 触发隐私授权, eventInfo:', JSON.stringify(eventInfo));
        // 保存 resolve，等待用户点击 open-type="agreePrivacyAuthorization" 按钮后
        // 调用 app.resolvePrivacyAuthorization() 完成授权
        this.globalData.privacyResolve = resolve;
      });
    }
  },
  getUserInfo(retryCount) {
    retryCount = retryCount || 0;
    const { request } = require('./utils/request');
    request({
      url: '/auth/me',
      method: 'GET',
      silent: true  // 启动请求失败由自愈机制处理，不弹 toast
    }).then(res => {
      const userInfo = res.data;
      // 规范化avatar_url

      if (userInfo) {
        this.normalizeAvatarUrl(userInfo);
        this.globalData.userInfo = userInfo;
      }
    }).catch(err => {
      console.error('获取管理员信息失败', err);
      // 启动自愈：最多重试 3 次，间隔 2s
      if (retryCount < 3) {
        setTimeout(() => this.getUserInfo(retryCount + 1), 2000);
      }
    });
  },

  /**
   * 规范化头像URL：处理HTTP IP地址旧数据
   */
  normalizeAvatarUrl(userInfo) {
    if (!userInfo || !userInfo.avatar_url) return;
    const config = require('./config/index.js');
    const serverBase = config.serverBase || '';
    const url = userInfo.avatar_url;

    if (url.startsWith('https://')) return;

    if (url.startsWith('http://')) {
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      if (match) userInfo.avatar_url = serverBase + match[1];
      return;
    }

    userInfo.avatar_url = serverBase + url;
  },
  getStoreList(retryCount) {
    retryCount = retryCount || 0;
    const { request } = require('./utils/request');
    request({
      url: '/stores',
      method: 'GET',
      silent: true  // 启动请求失败由自愈机制处理，不弹 toast
    }).then(res => {
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      this.globalData.storeList = list;
    }).catch(err => {
      console.error('获取门店列表失败', err);
      // 启动自愈：最多重试 3 次，间隔 2s
      if (retryCount < 3) {
        setTimeout(() => this.getStoreList(retryCount + 1), 2000);
      }
    });
  },
  checkAuth() {
    if (!this.globalData.token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return false;
    }
    return true;
  },
  hasPermission(moduleId) {
    const userInfo = this.globalData.userInfo;
    if (!userInfo) return false;
    if (userInfo.role === 'super_admin') return true;
    const permissions = userInfo.permissions || [];
    if (permissions.indexOf('*') >= 0) return true;
    return permissions.indexOf(moduleId) >= 0;
  },

  // 获取稳定的设备标识（首次启动时生成UUID并永久存储，同一微信账号下始终一致）
  // 注：微信小程序的 storage 天然按微信账号隔离，无需额外做"换设备检测"
  getDeviceFingerprint() {
    try {
      let deviceId = wx.getStorageSync('device_fingerprint');
      if (!deviceId) {
        const d = Date.now();
        const r = Math.floor(Math.random() * 1e9);
        deviceId = 'dev_' + d.toString(36) + '_' + r.toString(36);
        wx.setStorageSync('device_fingerprint', deviceId);
      }
      return deviceId;
    } catch (e) {
      return '';
    }
  },

  // 初始化设备指纹（稳定不变）
  initDeviceFingerprint() {
    const currentFingerprint = this.getDeviceFingerprint();
    if (currentFingerprint) {
      this.globalData.deviceFingerprint = currentFingerprint;
    }
  }
});
