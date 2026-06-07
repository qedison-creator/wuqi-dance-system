const config = require('../config/index.js');

const request = (options) => {
  return new Promise((resolve, reject) => {
    const app = getApp();
    const appData = app && app.globalData ? app.globalData : {};
    const token = wx.getStorageSync('admin_token') || appData.token || '';
    const baseUrl = appData.baseUrl || config.baseUrl;

    wx.request({
      url: baseUrl + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: options.timeout || 15000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        if (res.statusCode === 200) {
          if (res.data.code === 200) {
            resolve(res.data);
          } else if (res.data.code === 401) {
            wx.removeStorageSync('admin_token');
            if (appData) {
              appData.token = '';
              appData.userInfo = null;
            }
            wx.showToast({ title: res.data.message || '请重新登录', icon: 'none', duration: 2500 });
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/login/login' });
            }, 2000);
            reject(res.data);
          } else {
            wx.showToast({ title: res.data.message || '请求失败', icon: 'none' });
            reject(res.data);
          }
        } else {
          const errorMsg = res.data?.message || `服务器错误(${res.statusCode})`;
          wx.showToast({ title: errorMsg, icon: 'none' });
          reject({ ...res.data, statusCode: res.statusCode, message: errorMsg });
        }
      },
      fail: (err) => {
        wx.showToast({ title: '网络连接失败', icon: 'none' });
        reject(err);
      }
    });
  });
};

module.exports = { request };
