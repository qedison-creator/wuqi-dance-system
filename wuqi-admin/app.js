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
    deviceFingerprint: ''
  },
  onLaunch() {
    this.silenceUnsupportedApi();
    this.registerPrivacyHandler();
    // 延迟初始化设备指纹，不阻塞启动

    setTimeout(() => this.initDeviceFingerprint(), 0);
    const token = wx.getStorageSync('admin_token');
    if (token) {
      this.globalData.token = token;
      this.getUserInfo();
      this.getStoreList();
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
    for (let i = 0; i < unsupportedList.length; i++) {
      const key = unsupportedList[i];
      if (typeof wx[key] !== 'function') {
        try { wx[key] = noop; } catch (e) {}
      }
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
        console.log('[Privacy] 触发隐私授权弹窗, eventInfo:', JSON.stringify(eventInfo));
        this.globalData.privacyResolve = resolve;
        wx.showModal({
          title: '隐私政策提示',
          content: '在使用本小程序前，需要您阅读并同意《用户协议》和《隐私政策》。我们将严格按照法律法规保护您的个人信息安全。',
          cancelText: '暂不使用',
          confirmText: '同意',
          success: (res) => {
            if (res.confirm) {
              if (this.globalData.privacyResolve) {
                this.globalData.privacyResolve({
                  buttonId: 'agree',
                  event: 'agree'
                });
              }
            } else {
              if (this.globalData.privacyResolve) {
                this.globalData.privacyResolve({
                  buttonId: 'disagree',
                  event: 'disagree'
                });
              }
            }
            this.globalData.privacyResolve = null;
          }
        });
      });
    }
  },
  getUserInfo() {
    const { request } = require('./utils/request');
    request({
      url: '/auth/me',
      method: 'GET'
    }).then(res => {
      const userInfo = res.data;
      // 规范化avatar_url

      if (userInfo) {
        this.normalizeAvatarUrl(userInfo);
        this.globalData.userInfo = userInfo;
      }
    }).catch(err => {
      console.error('获取管理员信息失败', err);
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
  getStoreList() {
    const { request } = require('./utils/request');
    request({
      url: '/stores',
      method: 'GET'
    }).then(res => {
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      this.globalData.storeList = list;
    }).catch(err => {
      console.error('获取门店列表失败', err);
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
