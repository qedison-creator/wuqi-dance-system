const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    ready: false
  },

  onLoad() {
    // 等待 app.js 初始化完成后立即跳转首页（与会员端一致）
    // 不再使用固定时长的假进度动画，避免无谓等待
    this.waitAppReady();
  },

  waitAppReady() {
    // app.js 中 onLaunch 会设置 globalData._initPromise
    const initPromise = app.globalData._initPromise || Promise.resolve();

    // 验证 token 有效性（有 token 时）
    const token = wx.getStorageSync('admin_token');
    const verifyToken = token
      ? request({ url: '/auth/me', method: 'GET' }).then(() => true).catch(() => false)
      : Promise.resolve(false);

    Promise.all([initPromise, verifyToken]).then(([, hasValidToken]) => {
      // 保留极短的 logo 淡入动画（500ms），让用户感知到品牌过渡
      this.setData({ ready: true });
      setTimeout(() => {
        this.navigateToTarget(hasValidToken);
      }, 500);
    }).catch(() => {
      this.navigateToTarget(false);
    });
  },

  navigateToTarget(hasValidToken) {
    const token = wx.getStorageSync('admin_token');
    if (!token || !hasValidToken) {
      // 无 token 或 token 失效，清除并跳转登录
      wx.removeStorageSync('admin_token');
      if (app.globalData) {
        app.globalData.token = '';
        app.globalData.userInfo = null;
      }
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    // token 有效，直接进入首页
    wx.switchTab({ url: '/pages/dashboard/dashboard' });
  }
});
