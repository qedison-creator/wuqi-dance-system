// 自定义 TabBar：随皮肤切换配色（classic 原样 / paper / volt）
const skin = require('../utils/skin.js');

Component({
  data: {
    selected: 0,
    active: 'index',
    skinId: 'classic'
  },

  pageLifetimes: {
    show() {
      // 每次宿主页面显示时同步皮肤（切皮肤后立即生效，无需重启）
      this.syncSkin();
    }
  },

  lifetimes: {
    attached() {
      this.syncSkin();
    }
  },

  methods: {
    syncSkin() {
      const id = skin.getSkinId();
      if (id !== this.data.skinId) {
        this.setData({ skinId: id });
      }
    },

    switchTab(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      wx.switchTab({ url });
    },

    onTabTap(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      const index = data.index || 0;
      const activeMap = { 0: 'index', 1: 'booking', 2: 'profile' };

      wx.switchTab({ url });
      this.setData({
        selected: index,
        active: activeMap[index] || 'index'
      });
    }
  }
});
