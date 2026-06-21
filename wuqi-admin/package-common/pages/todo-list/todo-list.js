const app = getApp();
const { request } = require('../../../utils/request');

Page({
  data: {
    loading: true,
    todoList: [],
    // 分类标签
    currentTab: 'all', // all | urgent | normal
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'urgent', label: '紧急' },
      { key: 'normal', label: '常规' }
    ]
  },

  onLoad() {
    this.loadTodoList();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: -1 });
    }
  },

  async loadTodoList() {
    try {
      this.setData({ loading: true });
      
      // 并行加载各项待办数据

      const [homeRes, statsRes, waitlistRes] = await Promise.allSettled([
        request({ url: '/home/admin', method: 'GET' }),
        request({ 
          url: '/stats/dashboard', 
          method: 'GET',
          data: { store_id: app.globalData.currentStore ? app.globalData.currentStore._id : '' }
        }),
        request({ 
          url: '/bookings/waitlist/summary', 
          method: 'GET',
          data: { store_id: app.globalData.currentStore ? app.globalData.currentStore._id : '' }
        }).catch(() => ({ data: [] }))
      ]);

      const todoList = [];
      
      // 1. 待审核会员

      if (homeRes.status === 'fulfilled' && homeRes.value.data && homeRes.value.data.pending_review > 0) {
        todoList.push({
          id: 'member_audit',
          title: '会员审核',
          desc: `${homeRes.value.data.pending_review} 位会员待审核`,
          type: 'member_audit',
          urgent: true,
          icon: '👥',
          action: '去审核',
          targetUrl: '/package-member/pages/members/member-review/member-review'
        });
      }

      // 2. 今日排课

      if (homeRes.status === 'fulfilled' && homeRes.value.data && homeRes.value.data.today_schedules && homeRes.value.data.today_schedules.length > 0) {
        todoList.push({
          id: 'today_schedule',
          title: '今日排课',
          desc: `${homeRes.value.data.today_schedules.length} 节课程待上课`,
          type: 'schedule',
          urgent: false,
          icon: '📅',
          action: '查看预约',
          targetUrl: '/pages/operations/operations',
          clickable: false,
          detail: homeRes.value.data.today_schedules
        });
      }

      // 3. 时间卡快到期

      if (statsRes.status === 'fulfilled' && statsRes.value.data && statsRes.value.data.expiring_time_cards && statsRes.value.data.expiring_time_cards.length > 0) {
        todoList.push({
          id: 'expiring_cards',
          title: '时间卡快到期',
          desc: `${statsRes.value.data.expiring_time_cards.length} 位会员时间卡即将到期`,
          type: 'expiring_time',
          urgent: true,
          icon: '⏰',
          action: '查看详情',
          targetUrl: '/pages/members/members',
          detail: statsRes.value.data.expiring_time_cards
        });
      }

      // 4. 次卡会员跟进

      if (statsRes.status === 'fulfilled' && statsRes.value.data && statsRes.value.data.count_card_alerts && statsRes.value.data.count_card_alerts.length > 0) {
        todoList.push({
          id: 'count_card_alert',
          title: '次卡会员跟进',
          desc: `${statsRes.value.data.count_card_alerts.length} 位会员需要跟进`,
          type: 'count_card',
          urgent: true,
          icon: '🎫',
          action: '查看详情',
          targetUrl: '/pages/members/members',
          detail: statsRes.value.data.count_card_alerts
        });
      }

      // 5. 候补排队

      if (waitlistRes.status === 'fulfilled' && waitlistRes.value.data && waitlistRes.value.data.length > 0) {
        const totalWaitlist = waitlistRes.value.data.reduce((sum, item) => sum + item.waitlist_count, 0);
        if (totalWaitlist > 0) {
          todoList.push({
            id: 'waitlist',
            title: '候补排队',
            desc: `有 ${totalWaitlist} 人在排队等待`,
            type: 'waitlist',
            urgent: false,
            icon: '🚶',
            action: '去处理',
            targetUrl: '/package-schedule/pages/waitlist/waitlist',
            detail: waitlistRes.value.data
          });
        }
      }

      // 6. 近期课程安排提醒（如果课程即将开始）

      if (statsRes.status === 'fulfilled' && statsRes.value.data && statsRes.value.data.upcoming_schedules && statsRes.value.data.upcoming_schedules.length > 0) {
        todoList.push({
          id: 'upcoming_schedule',
          title: '近期课程安排',
          desc: `${statsRes.value.data.upcoming_schedules.length} 节课程即将开始`,
          type: 'upcoming',
          urgent: false,
          icon: '📆',
          action: '查看排课',
          targetUrl: '/package-schedule/pages/schedule/schedule',
          clickable: false,
          detail: statsRes.value.data.upcoming_schedules
        });
      }

      this.setData({ todoList, loading: false });
    } catch (err) {
      console.error('加载待办事项失败', err);
      this.setData({ loading: false });
    }
  },

  onTabChange(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab });
  },

  // 判断是否为 tabBar 页面（tabBar 页面必须用 wx.switchTab，不能用 wx.navigateTo）
  _isTabBarPage(url) {
    if (!url) return false;
    const tabBarPages = [
      'pages/dashboard/dashboard',
      'pages/operations/operations',
      'pages/members/members',
      'pages/shop/shop',
      'pages/profile/profile'
    ];
    for (let i = 0; i < tabBarPages.length; i++) {
      if (url.indexOf(tabBarPages[i]) !== -1) return true;
    }
    return false;
  },

  onTodoItemClick(e) {
    const todo = e.currentTarget.dataset.todo;
    // 今日排课/近期课程卡片不支持整体点击，仅右侧按钮可点击
    if (todo.clickable === false) return;
    if (todo.targetUrl) {
      if (this._isTabBarPage(todo.targetUrl)) {
        wx.switchTab({ url: todo.targetUrl });
      } else {
        wx.navigateTo({ url: todo.targetUrl });
      }
    }
  },

  // 右侧按钮点击：今日排课/近期课程走这里，其他卡片点击按钮也会触发跳转
  onTodoActionClick(e) {
    const todo = e.currentTarget.dataset.todo;
    if (!todo || !todo.targetUrl) return;
    if (this._isTabBarPage(todo.targetUrl)) {
      wx.switchTab({ url: todo.targetUrl });
    } else {
      wx.navigateTo({ url: todo.targetUrl });
    }
  },

  onRefresh() {
    this.loadTodoList();
  }
});
