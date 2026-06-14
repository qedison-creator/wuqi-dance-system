const config = require('../config/index.js');

const request = (options) => {
  return new Promise((resolve, reject) => {
    const app = getApp();
    const token = wx.getStorageSync('token') || (app && app.globalData && app.globalData.token) || '';
    const baseUrl = (app && app.globalData && app.globalData.baseUrl) || config.baseUrl;
    const silent = options.silent || false;

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
            wx.removeStorageSync('token');
            if (app && app.globalData) {
              app.globalData.token = '';
              app.globalData.userInfo = null;
            }
            if (!silent) {
              wx.showToast({ title: '请重新登录', icon: 'none' });
            }
            reject(res.data);
          } else {
            // 只在401登录失效时自动提示，其他错误让业务代码处理
            reject(res.data);
          }
        } else {
          const errMsg = (res.data && res.data.message) || `请求失败(${res.statusCode})`;
          // 500等HTTP错误也让业务代码自己处理提示
          reject({ code: res.statusCode, message: errMsg, data: (res.data && res.data.data) || null });
        }
      },
      fail: (err) => {
        if (!silent) {
          const isTimeout = err.errMsg && err.errMsg.indexOf('timeout') !== -1;
          wx.showToast({
            title: isTimeout ? '请求超时，请重试' : '网络连接失败',
            icon: 'none'
          });
        }
        reject(err);
      }
    });
  });
};

module.exports = { request };