Component({
  data: {
    selected: 0,
    active: 'index'
  },

  methods: {
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