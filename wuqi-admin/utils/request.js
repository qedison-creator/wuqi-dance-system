const config = require('../config/index.js');

// 判断是否为可重试的网络层错误（连接重置、超时、网络中断等）
const isRetryableNetworkError = (err) => {
  if (!err || !err.errMsg) return false;
  const msg = err.errMsg;
  return msg.indexOf('timeout') !== -1 ||
         msg.indexOf('ERR_CONNECTION_RESET') !== -1 ||
         msg.indexOf('ERR_CONNECTION_CLOSED') !== -1 ||
         msg.indexOf('ERR_INTERNET_DISCONNECTED') !== -1 ||
         msg.indexOf('fail') !== -1; // request:fail / request:fail timeout 等
};

// 单次原始请求
const _rawRequest = (options) => {
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
          // 审核员只读模式：403 提示友好文案，避免审核人误以为功能异常
          const app2 = getApp();
          const role = app2 && app2.globalData && app2.globalData.userInfo && app2.globalData.userInfo.role;
          if (role === 'reviewer' && res.statusCode === 403) {
            wx.showToast({ title: '当前为审核账号，仅可查看', icon: 'none' });
          } else {
            wx.showToast({ title: errorMsg, icon: 'none' });
          }
          reject({ ...res.data, statusCode: res.statusCode, message: errorMsg });
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
};

const request = (options) => {
  const method = (options.method || 'GET').toUpperCase();
  const maxRetry = options.retry !== undefined ? options.retry : (method === 'GET' ? 1 : 0);
  const silent = options.silent || false;

  return new Promise((resolve, reject) => {
    // 全局网络状态检查：断网时直接跳过请求，不发起也不报错
    const app = getApp();
    const isOnline = app && app.globalData && app.globalData.isOnline;
    if (isOnline === false) {
      reject({ errMsg: 'network offline' });
      return;
    }

    let attempt = 0;

    const doRequest = () => {
      _rawRequest(options).then(resolve).catch((err) => {
        // 网络层错误且仍有重试次数 → 延迟后重试（1.5s 给网络恢复时间）
        if (isRetryableNetworkError(err) && attempt < maxRetry) {
          attempt++;
          setTimeout(doRequest, 1500);
          return;
        }
        // 业务错误或重试耗尽 → 提示并拒绝
        // 审核员只读 403：已在 _rawRequest 中处理，此处跳过 toast 避免重复提示
        const app2 = getApp();
        const role = app2 && app2.globalData && app2.globalData.userInfo && app2.globalData.userInfo.role;
        const isReviewer403 = role === 'reviewer' && err && err.statusCode === 403;
        if (!silent && !isReviewer403) {
          const isTimeout = err.errMsg && err.errMsg.indexOf('timeout') !== -1;
          wx.showToast({
            title: isTimeout ? '请求超时，请重试' : '网络连接失败',
            icon: 'none'
          });
        }
        reject(err);
      });
    };

    doRequest();
  });
};

module.exports = { request };
