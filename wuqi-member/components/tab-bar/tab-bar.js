Component({
  properties: {
    selected: {
      type: Number,
      value: 0
    }
  },
  data: {
    list: [
      { icon: '🏠', text: '首页', path: '/pages/index/index' },
      { icon: '📅', text: '预约', path: '/pages/booking/booking' },
      { icon: '👤', text: '我的', path: '/pages/profile/profile' }
    ]
  },
  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    }
  }
});
