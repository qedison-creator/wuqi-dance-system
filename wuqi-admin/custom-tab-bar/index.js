Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/dashboard/dashboard',
        text: '首页',
        iconPath: '/images/tabbar/home.svg',
        selectedIconPath: '/images/tabbar/home-active.svg'
      },
      {
        pagePath: '/pages/operations/operations',
        text: '运营',
        iconPath: '/images/tabbar/calendar.svg',
        selectedIconPath: '/images/tabbar/calendar-active.svg'
      },
      {
        pagePath: '/pages/members/members',
        text: '会员',
        iconPath: '/images/tabbar/users.svg',
        selectedIconPath: '/images/tabbar/users-active.svg'
      },
      {
        pagePath: '/pages/shop/shop',
        text: '店务',
        iconPath: '/images/tabbar/shop.svg',
        selectedIconPath: '/images/tabbar/shop-active.svg'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        iconPath: '/images/tabbar/user.svg',
        selectedIconPath: '/images/tabbar/user-active.svg'
      }
    ]
  },
  attached() {
  },
  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      wx.switchTab({ url });
      this.setData({ selected: data.index });
    }
  }
});