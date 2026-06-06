const config = require('./config/index.js');

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
    this.registerPrivacyHandler();
    this.initDeviceFingerprint();
    const token = wx.getStorageSync('admin_token');
    if (token) {
      this.globalData.token = token;
      this.getUserInfo();
      this.getStoreList();
    }
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
    const config = require('./config/index.js');
    const serverBase = config.serverBase || '';
    request({
      url: '/auth/me',
      method: 'GET'
    }).then(res => {
      const userInfo = res.data;
      // 规范化avatar_url：确保是完整URL
      if (userInfo && userInfo.avatar_url && !userInfo.avatar_url.startsWith('http')) {
        userInfo.avatar_url = serverBase + userInfo.avatar_url;
      }
      this.globalData.userInfo = userInfo;
    }).catch(err => {
      console.error('获取管理员信息失败', err);
    });
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

  // 生成当前设备的指纹（基于硬件信息，换设备会变化）
  getDeviceFingerprint() {
    try {
      const deviceInfo = wx.getDeviceInfo();
      const windowInfo = wx.getWindowInfo();
      const raw = [deviceInfo.model, deviceInfo.brand, deviceInfo.platform, windowInfo.screenWidth, windowInfo.screenHeight].join('|');
      // 简单哈希
      let hash = 0;
      for (let i = 0; i < raw.length; i++) {
        const char = raw.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return 'dev_' + Math.abs(hash).toString(36);
    } catch (e) {
      return '';
    }
  },

  // 初始化设备指纹：首次启动存储，后续启动比对
  initDeviceFingerprint() {
    const currentFingerprint = this.getDeviceFingerprint();
    if (!currentFingerprint) return;
    this.globalData.deviceFingerprint = currentFingerprint;

    const storedFingerprint = wx.getStorageSync('device_fingerprint');
    if (!storedFingerprint) {
      // 首次启动，存储设备指纹
      wx.setStorageSync('device_fingerprint', currentFingerprint);
    } else if (storedFingerprint !== currentFingerprint) {
      // 设备已更换，清除所有登录凭据
      wx.removeStorageSync('admin_token');
      wx.removeStorageSync('saved_username');
      wx.removeStorageSync('saved_password');
      wx.setStorageSync('device_fingerprint', currentFingerprint);
      this.globalData.token = '';
      this.globalData.userInfo = null;
    }
  }
});
