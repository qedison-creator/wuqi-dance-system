const app = getApp();
const { request } = require('../../utils/request');
const config = require('../../config/index.js');

function getCurrentDate() {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const w = weekdays[now.getDay()];
  return `${y}年${m}月${d}日 ${w}`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8)    return { text: '晨安', emoji: '🌅', sub: '新的一天，好运满满，今日客户多多上门' };
  if (hour >= 8 && hour < 12)   return { text: '上午好', emoji: '☀️', sub: '营业前的时光，养足精神，今天报名一定多' };
  if (hour >= 12 && hour < 14)  return { text: '午安', emoji: '☕', sub: '午后开门迎客，祝生意兴隆，会员源源不断' };
  if (hour >= 14 && hour < 17)  return { text: '下午好', emoji: '🌟', sub: '午后时光，客户陆续上门，财运滚滚而来' };
  if (hour >= 17 && hour < 19)  return { text: '傍晚好', emoji: '🌆', sub: '晚间高峰即将到来，迎接来报名的客户，多多成交' };
  if (hour >= 19 && hour < 22)  return { text: '晚上好', emoji: '🌙', sub: '课程进行中，舞蹈教室正热闹着呢' };
  return { text: '夜深了', emoji: '🌃', sub: '今日课程已结束，好好休息，明天继续成交收钱' };
}

function getTheme() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8)    return 'sunrise';
  if (hour >= 8 && hour < 12)   return 'morning';
  if (hour >= 12 && hour < 14)  return 'noon';
  if (hour >= 14 && hour < 17)  return 'afternoon';
  if (hour >= 17 && hour < 19)  return 'sunset';
  if (hour >= 19 && hour < 22)  return 'night';
  return 'late-night';
}

Page({
  data: {
    storeList: [],
    currentStoreIndex: 0,
    currentStore: null,
    currentStoreName: '全部门店',
    showStoreModal: false,
    userRoleName: '管理员',
    currentDate: '',
    greeting: { text: '', emoji: '', sub: '' },
    theme: 'morning',
    stats: {
      todaySchedules: 0,
      totalMembers: 0,
      waitlistCount: 0,
      pendingReviews: 0
    },
    banners: [],
    scheduleEndAlert: {
      visible: false,
      weeksLeft: 0,
      daysLeft: 0
    },
    todos: [],
    todoList: [],
    loadingSkeleton: true,
    expandedTodo: '',
    detailList: [],
    scheduleList: [],
    pendingMembers: [],
    auditLoading: false,
    showAuditStoreModal: false,
    auditApproveMember: null,
    auditStoreList: [],
    auditSelectedStoreId: '',
    systemConfigs: {},
    heroBackgroundUrl: ''
  },

  onLoad() {
    const theme = getTheme();
    // 不再预先设置前端拼接的URL，等待后端/home/admin返回正确的hero_background_url
    // 由CSS渐变色背景作为初始兜底
    this.setData({
      currentDate: getCurrentDate(),
      greeting: getGreeting(),
      theme: theme
    });
    this.loadUserInfo();
    this.loadStores();
  },

  onHeroImageError() {
    // 服务器图片加载失败，隐藏图片（hero区域有渐变色背景）
    console.log('服务器背景图加载失败');
    this.setData({ heroBackgroundUrl: '' });
  },

  onShow() {
    if (app.checkAuth && !app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.setData({ greeting: getGreeting(), theme: getTheme() });
    this.loadUserInfo();
    this.loadAllData();
  },

  loadUserInfo() {
    if (!app.globalData.userInfo) {
      request({ url: '/auth/me', method: 'GET' }).then(res => {
        const data = res.data || {};
        app.globalData.userInfo = data;
        this.applyUserInfo(data.admin ? data.admin : data);
      }).catch(() => {});
      return;
    }
    const raw = app.globalData.userInfo;
    const userInfo = raw.admin ? raw.admin : raw;
    this.applyUserInfo(userInfo);
  },

  applyUserInfo(userInfo) {
    const roleNameMap = {
      'super_admin': '超级管理员',
      'store_manager': '店长',
      'staff': '员工'
    };
    this.setData({
      userInfo,
      userRoleName: roleNameMap[userInfo.role] || '管理员'
    });
  },

  async loadStores() {
    try {
      const res = await request({
        url: '/stores',
        method: 'GET'
      });
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      const storeList = [{ _id: '', name: '全部门店' }].concat(list);
      const currentStore = this.data.currentStore;
      let currentStoreIndex = 0;
      let currentStoreName = '全部门店';
      if (currentStore && currentStore._id) {
        const idx = storeList.findIndex(s => s._id === currentStore._id);
        if (idx >= 0) {
          currentStoreIndex = idx;
          currentStoreName = storeList[idx].name;
        }
      }
      this.setData({
        storeList,
        currentStoreIndex,
        currentStoreName,
        currentStore: currentStoreIndex > 0 ? storeList[currentStoreIndex] : null
      }, () => {
        this.loadAllData();
      });
    } catch (err) {
      console.error('加载门店列表失败', err);
      this.loadAllData();
    }
  },

  async loadStats(homeData) {
    const data = homeData || {};
    const statsData = data.stats || {};
    this.setData({
      stats: {
        todaySchedules: statsData.today_schedules || 0,
        totalMembers: statsData.total_members || 0,
        waitlistCount: this.data.stats.waitlistCount || 0,
        pendingReviews: data.pending_review || 0
      }
    });
  },

  buildTodos(homeData, statsData) {
    const todoList = [];

    if (homeData) {
      if (homeData.pending_review > 0) {
        todoList.push({
          _id: 'member_audit',
          title: '会员审核',
          type: 'member_audit',
          urgent: true,
          count: homeData.pending_review,
          unit: '人'
        });
      }

      if (homeData.stats && homeData.stats.today_schedules > 0) {
        todoList.push({
          _id: 'today_schedule',
          title: '今日课程',
          type: 'schedule',
          urgent: false,
          count: homeData.stats.today_schedules,
          unit: '节'
        });
      }
    }

    if (statsData) {
      if (statsData.expiring_time_cards && statsData.expiring_time_cards.length > 0) {
        todoList.push({
          _id: 'expiring_cards',
          title: '时间卡到期',
          type: 'schedule_extend',
          urgent: true,
          count: statsData.expiring_time_cards.length,
          unit: '人'
        });
      }

      if (statsData.count_card_alerts && statsData.count_card_alerts.length > 0) {
        todoList.push({
          _id: 'count_card_alert',
          title: '次卡跟进',
          type: 'expiring_packages',
          urgent: true,
          count: statsData.count_card_alerts.length,
          unit: '人'
        });
      }

      if (statsData.upcoming_schedules && statsData.upcoming_schedules.length > 0) {
        todoList.push({
          _id: 'upcoming_schedule',
          title: '近期课程',
          type: 'schedule',
          urgent: false,
          count: statsData.upcoming_schedules.length,
          unit: '节'
        });
      }
    }

    return todoList;
  },

  async loadSystemConfigs() {
    try {
      // 不再预先设置前端拼接的URL，等待后端/home/admin返回正确的hero_background_url
      // 如果后端未部署或返回空，保持heroBackgroundUrl为空，由CSS渐变色背景兜底
      
      // 尝试加载后端配置（如果后端可能还没部署，暂时静默尝试
      try {
        const res = await request({ url: '/system/configs', method: 'GET', silent: true });
        const configs = res.data || {};
        this.setData({ systemConfigs: configs });
      } catch (e) {
        // 接口暂时不可用，不做任何处理
        console.log('后端系统配置接口还未部署');
      }
    } catch (err) {
      // 完全静默
    }
  },

  applyHeroBackground(themeOrConfigs) {
    let theme;
    let bgUrl = '';

    if (typeof themeOrConfigs === 'string') {
      theme = themeOrConfigs;
    } else if (themeOrConfigs && typeof themeOrConfigs === 'object') {
      theme = this.data.theme;
      // 参照会员端banner方式：优先使用后端API返回的图片URL
      if (themeOrConfigs.hero_background_url) {
        bgUrl = themeOrConfigs.hero_background_url;
        // 参照会员端avatar_url处理：相对路径拼接serverBase，完整URL直接使用
        if (!bgUrl.startsWith('http')) {
          bgUrl = config.serverBase + bgUrl;
        }
      }
    } else {
      theme = this.data.theme;
    }

    // 没有后端配置URL时，使用默认路径拼接
    if (!bgUrl) {
      bgUrl = config.serverBase + '/uploads/hero/hero-' + theme + '.jpg';
    }

    // 后端通过 Nginx 代理时 req.protocol 可能返回 http，需确保使用 config 中的协议
    if (bgUrl.startsWith('http://') && config.serverBase.startsWith('https://')) {
      bgUrl = bgUrl.replace('http://', 'https://');
    }

    this.setData({ heroBackgroundUrl: bgUrl });
  },

  async loadAllData() {
    try {
      const storeId = this.data.currentStore ? this.data.currentStore._id : '';

      this.loadSystemConfigs();

      const [homeRes, statsRes, bannersRes] = await Promise.allSettled([
        request({ url: '/home/admin', method: 'GET' }).catch(() => ({})),
        request({ url: '/stats/dashboard', method: 'GET', data: { store_id: storeId } }).catch(() => ({ data: {} })),
        request({ url: '/banners', method: 'GET', data: {} }).catch(() => ({ data: [] }))
      ]);

      const homeData = homeRes.status === 'fulfilled' ? (homeRes.value.data || {}) : {};
      const statsData = statsRes.status === 'fulfilled' ? (statsRes.value.data || {}) : {};

      // 使用后端返回的hero背景图URL（参照会员端banner方式）
      if (homeData.hero_background_url) {
        let heroUrl = homeData.hero_background_url;
        // 后端通过 Nginx 代理时 req.protocol 可能返回 http，需确保使用 config 中的协议
        if (heroUrl.startsWith('http://') && config.serverBase.startsWith('https://')) {
          heroUrl = heroUrl.replace('http://', 'https://');
        }
        this.setData({ heroBackgroundUrl: heroUrl });
      }

      this.loadStats(homeData);

      const todoList = this.buildTodos(homeData, statsData);
      const countCardAlerts = statsData.count_card_alerts || [];
      this.setData({
        todos: todoList,
        todoList: todoList,
        countCardAlerts: countCardAlerts,
        expiringTimeCards: statsData.expiring_time_cards || []
      });

      const expiringCards = statsData.expiring_time_cards || [];
      this.setData({
        scheduleEndAlert: {
          visible: expiringCards.length > 0,
          weeksLeft: 0,
          daysLeft: expiringCards.length
        }
      });

      const banners = bannersRes.status === 'fulfilled'
        ? (Array.isArray(bannersRes.value.data.list) ? bannersRes.value.data.list : (Array.isArray(bannersRes.value.data) ? bannersRes.value.data : []))
        : [];
      this.setData({ banners });

    } catch (err) {
      console.error('加载数据失败', err);
    }
    this.setData({ loadingSkeleton: false });
  },

  onRefresh() {
    wx.showLoading({ title: '刷新中...', mask: true });
    this.setData({ loadingSkeleton: true });
    this.loadAllData().finally(() => {
      wx.hideLoading();
      wx.stopPullDownRefresh();
    });
  },

  onOpenStoreModal() {
    this.setData({ showStoreModal: true });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  onSelectStore(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const storeList = this.data.storeList;
    const store = storeList[index];
    this.setData({
      currentStoreIndex: index,
      currentStore: store && store._id ? store : null,
      currentStoreName: store ? store.name : '全部门店',
      showStoreModal: false,
      loadingSkeleton: true
    }, () => {
      this.loadAllData();
    });
  },

  onStoreChange(e) {
    const index = parseInt(e.detail.value);
    const storeList = this.data.storeList;
    const store = storeList[index];
    this.setData({
      currentStoreIndex: index,
      currentStore: store && store._id ? store : null,
      currentStoreName: store ? store.name : '全部门店',
      loadingSkeleton: true
    }, () => {
      this.loadAllData();
    });
  },

  onStatTap(e) {
    const type = e.currentTarget.dataset.type;
    switch (type) {
      case 'today':
        this.onGoToSchedule();
        break;
      case 'members':
        this.onGoToMembers();
        break;
      case 'waitlist':
        wx.navigateTo({ url: '/pages/waitlist/waitlist' });
        break;
      case 'reviews':
        wx.navigateTo({ url: '/pages/members/member-review/member-review' });
        break;
    }
  },

  onTodoTap(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    const todo = this.data.todoList.find(t => t._id === item._id) || item;
    if (todo.type === 'expiring_packages' || todo.type === 'schedule_extend') {
      if (this.data.expandedTodo === todo._id) {
        this.setData({ expandedTodo: '', detailList: [] });
      } else {
        if (todo.type === 'expiring_packages') {
          this.showExpiringPackagesModal(todo._id);
        } else {
          this.showScheduleExtendModal(todo._id);
        }
      }
      return;
    }
    // 会员审核：向下展开
    if (todo.type === 'member_audit') {
      if (this.data.expandedTodo === todo._id) {
        this.setData({ expandedTodo: '', pendingMembers: [] });
      } else {
        this._loadPendingAuditMembers(todo._id);
      }
      return;
    }
    // 今日课程 / 近期课程：改为向下展开（之前是直接跳转）
    if (todo.type === 'schedule') {
      if (this.data.expandedTodo === todo._id) {
        this.setData({ expandedTodo: '', scheduleList: [] });
      } else {
        this._enrichScheduleCards(todo);
      }
      return;
    }
    switch (todo.type) {
      default:
        break;
    }
  },

  /**
   * 从 item 里提取会员 ID（兼容多个字段）
   */
  _extractMemberId(item) {
    if (!item) return null;
    return item._id || item.id || item.member_id || item.user_id || null;
  },

  /**
   * 基于原始数据做一次"快速映射"，保证展开瞬间就有内容可以展示
   */
  _quickMapCard(item, type) {
    if (!item) item = {};
    const memberId = this._extractMemberId(item);
    const userName = item.real_name || item.nick_name || item.user_name || item.name || item.member_name || '';
    const avatarChar = userName && userName.length > 0 ? userName.charAt(0) : '会';
    const avatarUrl = item.avatar_url || item.avatar || item.head_img || item.headImg || item.headimgurl || '';
    const phone = item.phone || item.mobile || '';
    let packageName = item.package_name || item.card_name || item.card_type || item.course_name || item.product_name || '';
    let remaining = item.remaining;
    if (remaining === undefined || remaining === null) remaining = item.left_times;
    if (remaining === undefined || remaining === null) remaining = item.times_left;
    if (remaining === undefined || remaining === null) remaining = item.remaining_count;
    if (remaining === undefined || remaining === null) remaining = item.remaining_times;
    if (remaining === undefined || remaining === null) remaining = 0;
    let daysLeft = item.days_left;
    if (daysLeft === undefined || daysLeft === null) daysLeft = item.daysLeft;
    if (daysLeft === undefined || daysLeft === null) daysLeft = item.remaining_days;
    if (daysLeft === undefined || daysLeft === null) daysLeft = item.valid_days;
    if (daysLeft === undefined || daysLeft === null) daysLeft = item.expire_days;
    if (daysLeft === undefined || daysLeft === null) daysLeft = 0;
    let storeName = '';
    if (item.store_name) storeName = item.store_name;
    else if (item.store_id && item.store_id.name) storeName = item.store_id.name;

    if (type === 'time_card') packageName = packageName || '时间卡';
    if (type === 'count_card') packageName = packageName || '次卡';

    return {
      _id: memberId || (Date.now() + Math.random()),
      member_id: memberId,
      user_name: userName || '未知会员',
      avatar_char: avatarChar,
      avatar_url: avatarUrl,
      phone: phone,
      package_name: packageName || '',
      remaining: remaining,
      days_left: daysLeft,
      expiry_date: item.expiry_date || item.expire_date || item.end_date || '',
      store_name: storeName
    };
  },

  /**
   * 异步补全：并行调用 /members/{id} 拉取真实头像、套餐名、门店名
   * 然后用 setData 做增量刷新（不影响展开状态）
   */
  async _enrichMemberCards(rawList, type) {
    if (!rawList || rawList.length === 0) return;

    // 先用快速映射把 UI 填充好，避免白屏
    const initialList = rawList.map((item) => this._quickMapCard(item, type));
    this.setData({ detailList: initialList });

    const tasks = initialList.map((item) => {
      const memberId = item.member_id;
      if (!memberId) return Promise.resolve(item);
      return request({
        url: `/members/${memberId}`,
        method: 'GET',
        timeout: 15000,
        silent: true
      }).then((res) => {
        const data = res.data || {};

        // 头像：优先用接口返回的头像 URL
        let avatarUrl = data.avatar || data.avatar_url || data.head_img || data.headImg || data.headimgurl || '';
        // URL 规范化：相对路径补全
        if (avatarUrl && !/^https?:\/\//.test(avatarUrl)) {
          try {
            const cfg = require('../../config/index.js');
            if (cfg && cfg.serverBase) avatarUrl = cfg.serverBase + avatarUrl;
          } catch (_) {}
        }

        // 姓名
        let userName = data.real_name || data.nick_name || data.user_name || data.name || '';

        // 手机号
        let phone = data.phone || data.mobile || '';

        // 门店名：优先取 store_id.name；再从有效套餐里取
        let storeName = '';
        if (data.store_name) storeName = data.store_name;
        else if (data.store_id && typeof data.store_id === 'object' && data.store_id.name) {
          storeName = data.store_id.name;
        }
        if (!storeName && Array.isArray(data.packages)) {
          for (let i = 0; i < data.packages.length; i++) {
            const p = data.packages[i];
            if (p && p.store_id && p.store_id.name) {
              storeName = p.store_id.name;
              break;
            }
          }
        }

        // 套餐名：优先匹配当前 type，否则取第一个有效套餐
        let packageName = '';
        const packages = Array.isArray(data.packages) ? data.packages : [];
        if (packages.length > 0) {
          if (type === 'count_card') {
            const target = packages.find((p) => p && p.package_type === 'count_card' && p.name);
            if (target) packageName = target.name;
          } else if (type === 'time_card') {
            const target = packages.find((p) => p && p.package_type === 'time_card' && p.name);
            if (target) packageName = target.name;
          }
          if (!packageName) {
            const active = packages.find((p) => p && p.status === 'active' && p.name);
            packageName = (active && active.name) || (packages[0] && packages[0].name) || '';
          }
        }

        // 剩余次数 / 天数：从详情兜底
        let remaining = item.remaining;
        let daysLeft = item.days_left;
        if ((remaining === undefined || remaining === null || remaining === 0) && packages.length > 0) {
          const first = packages[0];
          if (first.remaining_credits !== undefined && first.remaining_credits !== null) {
            remaining = first.remaining_credits;
          }
        }

        const avatarChar = userName && userName.length > 0 ? userName.charAt(0) : '会';

        return {
          ...item,
          user_name: userName || item.user_name || '未知会员',
          avatar_char: avatarChar,
          avatar_url: avatarUrl || item.avatar_url,
          phone: phone || item.phone,
          package_name: packageName || item.package_name,
          remaining: remaining,
          days_left: daysLeft,
          store_name: storeName || item.store_name
        };
      }).catch((err) => {
        console.warn('[dashboard] 补全会员信息失败', err);
        return item;
      });
    });

    const enrichedList = await Promise.all(tasks);

    // 如果用户没关掉展开区域，就把补全后的内容刷新上去
    if (this.data.expandedTodo) {
      this.setData({ detailList: enrichedList });
    }
  },

  showExpiringPackagesModal(todoId) {
    const list = this.data.countCardAlerts || [];
    if (list.length === 0) {
      this.setData({ expandedTodo: todoId, detailList: [] });
      return;
    }
    // 先展开区域（设置 expandedTodo）让用户能立刻看到展开动作
    // 同时用 _enrichMemberCards 内部第一时间填充 initialList
    this.setData({ expandedTodo: todoId });
    this._enrichMemberCards(list, 'count_card');
  },

  showScheduleExtendModal(todoId) {
    const list = this.data.expiringTimeCards || [];
    if (list.length === 0) {
      this.setData({ expandedTodo: todoId, detailList: [] });
      return;
    }
    this.setData({ expandedTodo: todoId });
    this._enrichMemberCards(list, 'time_card');
  },

  onMemberCardTap(e) {
    var memberId = e.currentTarget.dataset.memberId;
    if (!memberId) return;
    wx.navigateTo({
      url: '/pages/members/member-detail/member-detail?id=' + memberId
    });
  },

  // ==== 会员审核操作 ====
  onAuditDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确认删除 ${name || '该用户'} 的会员申请？`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/members/${id}/review`,
              method: 'PUT',
              data: { action: 'reject' }
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this._loadPendingAuditMembers(this.data.expandedTodo);
          } catch (err) {
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  },

  onAuditReject(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认拒绝',
      content: `确认拒绝 ${name || '该用户'} 的会员申请？`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/members/${id}/review`,
              method: 'PUT',
              data: { action: 'reject' }
            });
            wx.showToast({ title: '已拒绝', icon: 'success' });
            this._loadPendingAuditMembers(this.data.expandedTodo);
          } catch (err) {
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  },

  async onAuditApprove(e) {
    const { id, name, storeId } = e.currentTarget.dataset;
    try {
      const res = await request({ url: '/stores' });
      const storeList = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      let autoSelectedStoreId = '';
      if (storeId) {
        const targetStore = storeList.find(s => String(s._id) === String(storeId));
        if (targetStore) autoSelectedStoreId = targetStore._id;
      }
      this.setData({
        auditApproveMember: { id, name },
        auditStoreList: storeList,
        auditSelectedStoreId: autoSelectedStoreId,
        showAuditStoreModal: true
      });
    } catch (err) {
      wx.showToast({ title: '获取门店失败', icon: 'none' });
    }
  },

  onAuditStoreSelect(e) {
    this.setData({ auditSelectedStoreId: e.currentTarget.dataset.id });
  },

  onAuditCloseModal() {
    this.setData({ showAuditStoreModal: false, auditApproveMember: null });
  },

  onAuditModalTap() {},

  async onAuditConfirmApprove() {
    const { auditApproveMember, auditSelectedStoreId } = this.data;
    if (!auditSelectedStoreId) {
      wx.showToast({ title: '请选择门店', icon: 'none' });
      return;
    }
    try {
      await request({
        url: `/members/${auditApproveMember.id}/review`,
        method: 'PUT',
        data: { action: 'approve', store_id: auditSelectedStoreId }
      });
      wx.showToast({ title: '已通过', icon: 'success' });
      this.setData({ showAuditStoreModal: false, auditApproveMember: null });
      this._loadPendingAuditMembers(this.data.expandedTodo);
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  /**
   * 会员审核展开：加载待审核用户列表
   */
  async _loadPendingAuditMembers(todoId) {
    this.setData({ auditLoading: true, expandedTodo: todoId, pendingMembers: [] });
    try {
      const res = await request({
        url: '/members',
        method: 'GET',
        data: { member_status: 'registered', page: 1, limit: 20 }
      });
      const result = res.data || {};
      const list = result.list || (Array.isArray(result) ? result : []);

      const members = list.map(m => {
        const wechatPhone = m.wechat_phone || '';
        const reservePhone = m.reserve_phone || m.phone || '';
        const d = m.created_at ? new Date(m.created_at) : null;
        let dateStr = '';
        if (d && !isNaN(d.getTime())) {
          const y = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const da = String(d.getDate()).padStart(2, '0');
          const h = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          dateStr = `${y}-${mo}-${da} ${h}:${min}`;
        }
        return {
          ...m,
          wechat_phone_display: wechatPhone,
          reserve_phone_display: reservePhone,
          created_at_formatted: dateStr,
          store_name: m.store_id && m.store_id.name ? m.store_id.name : '',
          store_id_val: m.store_id && m.store_id._id ? m.store_id._id : null
        };
      });
      this.setData({ pendingMembers: members, auditLoading: false });
    } catch (err) {
      console.error('加载待审核用户失败', err);
      this.setData({ auditLoading: false });
    }
  },

  /**
   * 课程卡片展开：调用 /schedules 拉取今日或近期课程
   * 再逐个调用 /schedules/${id}/bookings 计算真实预约/签到/取消/豁免数
   * （数据与运营管理页面「今日预约」保持一致）
   */
  async _enrichScheduleCards(todo) {
    if (!todo) return;
    const storeId = this.data.currentStore ? this.data.currentStore._id : '';
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const isToday = todo._id === 'today_schedule';

    let startDate = todayStr;
    let endDate = todayStr;
    if (!isToday) {
      const endD = new Date();
      endD.setDate(today.getDate() + 13);
      const ey = endD.getFullYear();
      const em = String(endD.getMonth() + 1).padStart(2, '0');
      const ed = String(endD.getDate()).padStart(2, '0');
      endDate = `${ey}-${em}-${ed}`;
    }

    this.setData({ expandedTodo: todo._id });

    try {
      const query = { store_id: storeId };
      if (isToday) {
        query.date = todayStr;
      } else {
        query.start_date = startDate;
        query.end_date = endDate;
      }
      query.status = 'all';

      const res = await request({
        url: '/schedules',
        method: 'GET',
        data: query,
        timeout: 15000
      });

      const rawList = res.data && Array.isArray(res.data.list)
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);

      // 为每节课调用一次 booking 接口，拿到真实的 booked / checkedIn / cancelled / exempted
      const statsPromises = rawList.map(s => this._loadScheduleBookingStats(s._id));
      const statsResults = await Promise.all(statsPromises);

      const now = new Date();

      const processed = rawList.map((s, i) => {
        const danceStyle = (s.dance_style_id && s.dance_style_id.name) || s.dance_style_name || '';
        const coachName = (s.coach_id && s.coach_id.name) || s.coach_name || '';
        const storeName = (s.store_id && s.store_id.name) || s.store_name || this.data.currentStoreName || '';

        // 状态：已过结束时间 → 已完成；否则沿用接口返回
        let status = s.status || 'available';
        if (!isToday) {
          const scheduleDate = s.date || todayStr;
          if (s.end_time) {
            const endTime = new Date(`${scheduleDate}T${s.end_time}`);
            if (now > endTime) status = 'completed';
          }
        } else if (s.end_time) {
          const endTime = new Date(`${todayStr}T${s.end_time}`);
          if (now > endTime) status = 'completed';
        }

        const bookingStats = statsResults[i];
        return {
          _id: s._id,
          course_name: s.course_name || (danceStyle ? danceStyle + '课程' : '课程'),
          dance_style_name: danceStyle,
          coach_name: coachName,
          start_time: s.start_time || '',
          end_time: s.end_time || '',
          date: s.date || '',
          bookedCount: bookingStats.booked,
          capacity: s.max_bookings || 15,
          checkedInCount: bookingStats.checkedIn,
          cancelledCount: bookingStats.cancelled,
          exemptedCount: bookingStats.exempted,
          status: status,
          store_name: storeName
        };
      });

      processed.sort((a, b) => {
        const keyA = (a.date || '') + (a.start_time || '');
        const keyB = (b.date || '') + (b.start_time || '');
        return keyA.localeCompare(keyB);
      });

      this.setData({ scheduleList: processed });
    } catch (err) {
      console.warn('[dashboard] 拉取课程失败', err);
      this.setData({ scheduleList: [] });
    }
  },

  /**
   * 调用 /schedules/${id}/bookings，计算 已预约/已签到/已取消/已豁免 真实数量
   */
  async _loadScheduleBookingStats(scheduleId) {
    if (!scheduleId) return { booked: 0, checkedIn: 0, cancelled: 0, exempted: 0 };
    try {
      const res = await request({
        url: `/schedules/${scheduleId}/bookings`,
        method: 'GET'
      });
      const all = res.data || [];
      return {
        booked: all.filter(b => b.status === 'booked' || b.booking_status === 'booked').length,
        checkedIn: all.filter(b => b.checked_in || b.status === 'checked_in').length,
        cancelled: all.filter(b => b.status === 'cancelled' || b.booking_status === 'cancelled').length,
        exempted: all.filter(b => b.status === 'exempted' || b.is_exempted).length
      };
    } catch (err) {
      return { booked: 0, checkedIn: 0, cancelled: 0, exempted: 0 };
    }
  },

  onScheduleCardTap(e) {
    const scheduleId = e.currentTarget.dataset.scheduleId;
    if (!scheduleId) return;
    wx.navigateTo({
      url: '/pages/bookings/bookings?schedule_id=' + scheduleId
    });
  },

  onViewSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  onGoToSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  onGoToMembers() {
    wx.switchTab({ url: '/pages/members/members' });
  },

  onGoToBookings() {
    wx.navigateTo({ url: '/pages/booking-summary/booking-summary' });
  },

  onGoToCheckIn() {
    wx.navigateTo({ url: '/pages/check-in/check-in' });
  },

  onScanSignIn() {
    wx.navigateTo({ url: '/pages/check-in/check-in' });
  },

  onGoToImages() {
    wx.navigateTo({ url: '/pages/images/images' });
  },

  onGoToBanners() {
    wx.navigateTo({ url: '/pages/todo-list/todo-list' });
  },

});