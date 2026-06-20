const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    particleList: [],
    loadingProgress: 0,
    loadingText: '正在加载...'
  },

  _loadingTimer: null,
  _destroyed: false,

  onLoad() {
    this._destroyed = false;
    this.initParticles();
    this.startLoading();
  },

  initParticles() {
    const particles = [];
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: Math.random() * 5,
        duration: 5 + Math.random() * 5
      });
    }
    this.setData({ particleList: particles });
  },

  startLoading() {
    const loadingTexts = [
      '正在加载...',
      '连接服务器...',
      '获取数据...',
      '准备就绪...'
    ];

    let progress = 0;
    this._loadingTimer = setInterval(() => {
      if (this._destroyed) {
        clearInterval(this._loadingTimer);
        this._loadingTimer = null;
        return;
      }
      progress += Math.random() * 15 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(this._loadingTimer);
        this._loadingTimer = null;
        this.setData({
          loadingProgress: progress,
          loadingText: '即将进入...'
        });
        setTimeout(() => {
          if (!this._destroyed) {
            this.navigateToTarget();
          }
        }, 500);
      } else {
        const textIndex = Math.floor(progress / 30);
        this.setData({
          loadingProgress: progress,
          loadingText: loadingTexts[Math.min(textIndex, loadingTexts.length - 1)]
        });
      }
    }, 200);
  },

  async navigateToTarget() {
    const token = wx.getStorageSync('admin_token');
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    // 有token，验证是否有效
    try {
      await request({ url: '/auth/me', method: 'GET' });
      // token有效，直接进入首页

      wx.switchTab({ url: '/pages/dashboard/dashboard' });
    } catch (err) {
      // token无效，清除并跳转登录

      wx.removeStorageSync('admin_token');
      app.globalData.token = '';
      app.globalData.userInfo = null;
      wx.redirectTo({ url: '/pages/login/login' });
    }
  },

  onUnload() {
    this._destroyed = true;
    if (this._loadingTimer) {
      clearInterval(this._loadingTimer);
      this._loadingTimer = null;
    }
  }
});