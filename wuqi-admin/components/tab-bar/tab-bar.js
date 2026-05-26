Component({
  properties: {
    current: {
      type: Number,
      value: 0
    }
  },
  data: {
    tabs: [
      { name: '数据首页', icon: '📊', key: 'dashboard' },
      { name: '课程排课', icon: '📅', key: 'schedule' },
      { name: '会员管理', icon: '👥', key: 'members' },
      { name: '个人中心', icon: '👤', key: 'profile' }
    ]
  },
  methods: {
    onTabTap(e) {
      const { index, key } = e.currentTarget.dataset;
      if (index !== this.data.current) {
        this.triggerEvent('change', { index, key });
      }
    }
  }
});