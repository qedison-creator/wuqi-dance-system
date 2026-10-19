// 启动页：随皮肤的品牌开场（paper 纸底朱砂章 / volt 墨底青柠章 / classic 白底）
const app = getApp();
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

Page({
  data: {
    ready: false,
    skinId: 'classic',
    sp: {}
  },

  onLoad() {
    // 读取皮肤偏好并应用启动页配色（纯前端偏好）
    let skinId = 'classic';
    try {
      const v = wx.getStorageSync('member_skin_id');
      skinId = (v === 'paper' || v === 'volt') ? v : 'classic';
    } catch (e) { /* 忽略 */ }
    const sp = this.splashStyle(skinId);
    this.setData({ skinId: skinId, sp: sp });
    if (skinId === 'paper') {
      // 启动页期间预热思源宋体加载（内部有去重，后续页面 pageState 再调不会重复加载）
      require('../../utils/skin.js').ensurePaperFont();
    }
    try {
      wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: sp.bg, fail: function () {} });
    } catch (e) { /* 忽略 */ }
    this.waitAppReady();
  },

  splashStyle(id) {
    if (id === 'volt') return { bg: '#111310', sealBg: '#D7FF3B', sealColor: '#111310', nameColor: '#F2F1ED', enColor: '#77786F' };
    if (id === 'paper') return { bg: '#F5F1E8', sealBg: '#B93A26', sealColor: '#FCF7EE', nameColor: '#221D15', enColor: '#A79D89' };
    return { bg: '#FFFFFF', sealBg: '#D4786E', sealColor: '#FFFFFF', nameColor: '#2A2122', enColor: '#B5A5A5' };
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
