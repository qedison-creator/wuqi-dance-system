App({
  globalData: {
    userInfo: null,
    token: '',
    currentStore: null,
    currentStoreId: '',
    storeList: [],
    baseUrl: 'http://localhost:3000/api/v1',
    serverBase: 'http://localhost:3000',
    privacyResolve: null
  },
  onLaunch() {
    this.registerPrivacyHandler();
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
    request({
      url: '/auth/me',
      method: 'GET'
    }).then(res => {
      this.globalData.userInfo = res.data;
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
  }
});
