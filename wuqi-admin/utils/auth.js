const { request } = require('./request');

const adminLogin = (username, password) => {
  return request({
    url: '/auth/admin-login',
    method: 'POST',
    data: { username, password }
  });
};

const checkAuth = () => {
  return !!wx.getStorageSync('admin_token');
};

const logout = () => {
  wx.removeStorageSync('admin_token');
  const app = getApp();
  app.globalData.token = '';
  app.globalData.userInfo = null;
  app.globalData.currentStoreId = '';
  app.globalData.currentStore = null;
  app.globalData.shopStoreId = '';
  wx.reLaunch({ url: '/pages/login/login' });
};

module.exports = { adminLogin, checkAuth, logout };
