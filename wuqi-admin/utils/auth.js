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
  getApp().globalData.token = '';
  getApp().globalData.userInfo = null;
  wx.reLaunch({ url: '/pages/login/login' });
};

module.exports = { adminLogin, checkAuth, logout };