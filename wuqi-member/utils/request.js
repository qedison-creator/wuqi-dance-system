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
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          // 账号被删除/禁用、token 过期等认证失败：强制登出并回到启动页
          // 防止被删除会员继续浏览本地缓存数据
          const message = (res.data && res.data.message) || (res.statusCode === 403 ? '无权访问' : '账号已失效，请重新登录');
          if (app && typeof app.forceLogoutAndRedirect === 'function') {
            app.forceLogoutAndRedirect(message, silent);
          } else {
            wx.removeStorageSync('token');
            if (app && app.globalData) {
              app.globalData.token = '';
              app.globalData.userInfo = null;
            }
            if (!silent) {
              wx.showToast({ title: message, icon: 'none' });
            }
          }
          reject({ code: res.statusCode, message });
        } else {
          const errMsg = (res.data && res.data.message) || `请求失败(${res.statusCode})`;
          // 500等HTTP错误也让业务代码自己处理提示
          reject({ code: res.statusCode, message: errMsg, data: (res.data && res.data.data) || null });
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
};

const request = (options) => {
  // GET 请求默认重试 2 次，写操作默认不重试（避免重复提交）
  // 冷启动网络栈未就绪时，2 次重试可覆盖大多数 ERR_CONNECTION_RESET 场景
  const method = (options.method || 'GET').toUpperCase();
  const maxRetry = options.retry !== undefined ? options.retry : (method === 'GET' ? 2 : 0);
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
        // 网络层错误且仍有重试次数 → 延迟后重试
        if (isRetryableNetworkError(err) && attempt < maxRetry) {
          attempt++;
          setTimeout(doRequest, 1500);
          return;
        }
        // 业务错误或重试耗尽 → 提示并拒绝
        if (!silent) {
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
