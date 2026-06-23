const app = getApp();

Page({
  data: {
    ready: false
  },

  onLoad() {
    // 等待 app.js 初始化完成（getUserInfo + getStoreList）后立即跳转首页
    // 不再使用固定时长的假进度动画，避免无谓等待
    this.waitAppReady();
  },

  waitAppReady() {
    // app.js 中 onLaunch 会设置 globalData._initPromise
    // 无 token 时为 Promise.resolve()，有 token 时为 getUserInfo()
    const initPromise = app.globalData._initPromise || Promise.resolve();

    // 同时等待门店列表加载完成（getStoreList 未返回 Promise，需轮询检查）
    const checkStoreList = () => {
      return new Promise((resolve) => {
        if (app.globalData.storeList && app.globalData.storeList.length > 0) {
          resolve();
          return;
        }
        // 最多等待 6 秒，避免门店接口异常时卡死
        let waited = 0;
        const timer = setInterval(() => {
          waited += 200;
          if ((app.globalData.storeList && app.globalData.storeList.length > 0) || waited >= 6000) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    };

    Promise.all([initPromise, checkStoreList()]).then(() => {
      // 保留极短的 logo 淡入动画（500ms），让用户感知到品牌过渡
      this.setData({ ready: true });
      setTimeout(() => {
        this.navigateToHome();
      }, 500);
    }).catch(() => {
      // 即使出错也跳转首页，不阻塞用户
      this.navigateToHome();
    });
  },

  navigateToHome() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
});
