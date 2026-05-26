App({
  globalData: {
    userInfo: null,
    token: '',
    currentStore: null,
    currentStoreId: '',
    storeList: [],
    baseUrl: 'http://localhost:3000/api/v1'
  },
  onLaunch() {
    const token = wx.getStorageSync('admin_token');
    if (token) {
      this.globalData.token = token;
      this.getUserInfo();
      this.getStoreList();
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
