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
    // 验证 token 有效性（有 token 时）
    // 注意：splash 是启动首屏，请求必须"快速失败"——
    // timeout 8s + 不重试（retry:0）+ silent（失败由 catch 跳登录页处理）。
    // 此前沿用默认配置（15s 超时 × GET 重试 2 次），弱网/服务器响应慢时
    // 本页最长停留约 48s，是"真机经常性白屏"的主要来源。
    const token = wx.getStorageSync('admin_token');
    const verifyToken = token
      ? request({ url: '/auth/me', method: 'GET', timeout: 8000, retry: 0, silent: true })
          .then(() => true).catch(() => false)
      : Promise.resolve(false);

    Promise.all([verifyToken]).then((results) => {
      const hasValidToken = results[0];
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
