const app = getApp();

Page({
  data: {
    particleList: [],
    loadingProgress: 0,
    loadingText: '正在加载...'
  },

  onLoad() {
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
          this.navigateToLogin();
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

  navigateToLogin() {
    wx.redirectTo({
      url: '/pages/login/login'
    });
  },

  onUnload() {
    if (this._loadingTimer) {
      clearInterval(this._loadingTimer);
      this._loadingTimer = null;
    }
  }
});