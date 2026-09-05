const app = getApp();
const { request } = require('../../utils/request');

// 规范化头像 URL：相对路径补全 serverBase，完整 URL 直接返回
const normalizeAvatarUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const config = require('../../config/index.js');
  const serverBase = config.serverBase || '';
  const path = url.startsWith('/') ? url : '/' + url;
  return serverBase + path;
};

// 格式化日期为 YYYY-MM-DD

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 统一把舞种 ID 转成字符串
const _normalizeDanceStyleId = (id) => {
  if (!id) return '';
  if (typeof id === 'object') {
    return id._id || id.id || (id.toString ? id.toString() : '') || '';
  }
  return String(id);
};

// 格式化审核通过日期为 YYYY-MM-DD 周X HH:mm

const formatReviewDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[d.getDay()];
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${weekday} ${hours}:${minutes}`;
};

Page({
  data: {
    activeFilter: 'active',
    members: [],
    showPhone: false,
    isReviewer: false,
    keyword: '',
    page: 1,
    hasMore: true,
    visibleCount: 5,
    currentTotal: 0,
    showBackToTop: false,
    backToTopThreshold: 0,
    loading: false,
    loadingMore: false,
    storeList: [],
    currentStoreId: '',
    currentStoreName: '',
    totalMembers: 0,
    pendingCount: 0,
    infoChangeCount: 0,
    pendingClaimCount: 0,
    filterLabel: '使用中',
    // 门店选择弹窗
    showStorePicker: false,
    // 审核弹窗
    showReviewModal: false,
    reviewMember: null,
    reviewAction: 'approve',
    // 套餐弹窗
    showPackageModal: false,
    packageMember: null,
    packageForm: {
      package_type: 'count_card',
      store_id: '',
      store_name: '',
      total_credits: '',
      duration_value: '',
      duration_unit: 'month',
      limit_type: 'limited',
      limit_cycle: 'weekly',
      limit_value: '',
      dance_style_limit: [],
      remark: ''
    },
    storeListForPicker: [],
    packageFormStoreIndex: 0,
    packageStoreLocked: false,  // 单门店权限时锁定所属门店为本门店
    showDanceStylePicker: false,
    showStoreSwitcher: true,
    // 舞种限制
    danceStyleList: [],
    addDanceStyleOptions: [],
    packageFormDanceStyleText: '',
    selectedDanceStyleId: ''   // 单选 UI 判断用（空=不限舞种）
  },

  onShow() {
    if (!app.checkAuth()) return;
    // 更新自定义tabbar的选中状态

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    const userInfo = app.globalData.userInfo || {};
    const isReviewer = userInfo.role === 'reviewer';

    // 从详情页返回：保留已加载的列表数据和滚动位置，不重新加载第一页
    if (this._backFromDetail) {
      this._backFromDetail = false;
      this._connectWebSocket();
      this._startAutoRefresh();
      // 延迟恢复滚动位置，确保页面渲染完成
      const savedTop = this._lastScrollTop || 0;
      setTimeout(() => {
        wx.pageScrollTo({ scrollTop: savedTop, duration: 0 });
      }, 50);
      return;
    }
    // 首次进入初始化滚动位置记录
    if (this._lastScrollTop === undefined) this._lastScrollTop = 0;

    // 门店隔离：单门店角色无门店切换器（仅展示所属门店）
    const isSingleStore = app.isSingleStoreRole();
    const defaultStoreId = app.getDefaultStoreId();
    let currentStoreId;
    let currentStoreName;
    if (isSingleStore && defaultStoreId) {
      // 单门店角色：固定所属门店
      currentStoreId = defaultStoreId;
      const storeList = app.globalData.storeList || [];
      const found = storeList.find(s => s._id === defaultStoreId);
      currentStoreName = found ? found.name : '';
      app.globalData.currentStore = found || null;
      app.globalData.currentStoreId = defaultStoreId;
    } else {
      // 超管/审核员/多门店店长
      // 会员管理保留"全部门店"作为独立查询状态，不跟随首页/店务管理的默认选中逻辑
      // 已初始化过门店选择时，优先复用本页上次选中（含"全部门店"空字符串状态），避免被其他页面覆盖
      const storeList = app.globalData.storeList || [];
      if (this._storeSelectionInited) {
        const prevStoreId = this.data.currentStoreId;
        if (prevStoreId === '') {
          currentStoreId = '';
          currentStoreName = '全部门店';
        } else {
          const found = storeList.find(s => String(s._id) === String(prevStoreId));
          if (found) {
            currentStoreId = found._id;
            currentStoreName = found.name;
          } else {
            currentStoreId = prevStoreId;
            currentStoreName = '';
          }
        }
      } else {
        // 首次进入本页：恢复上次手动选择的门店（本地持久化）；无记录时默认"全部门店"视图
        let savedStoreId = '';
        try { savedStoreId = wx.getStorageSync('members_selected_store_id') || ''; } catch (e) { /* 忽略读取失败 */ }
        if (savedStoreId) {
          if (storeList.length > 0) {
            const found = storeList.find(s => String(s._id) === String(savedStoreId));
            if (found) {
              currentStoreId = found._id;
              currentStoreName = found.name;
            } else {
              // 上次选择的门店已不存在：清除记忆并回退"全部门店"
              try { wx.removeStorageSync('members_selected_store_id'); } catch (e) { /* 忽略 */ }
              currentStoreId = '';
              currentStoreName = '全部门店';
            }
          } else {
            // 全局门店列表尚未就绪：先保留选择，名称由 loadStoreList 完成后回填
            currentStoreId = savedStoreId;
            currentStoreName = '';
          }
        } else {
          // "全部门店"：不设门店过滤，展示全平台会员
          currentStoreId = '';
          currentStoreName = '全部门店';
        }
        this._storeSelectionInited = true;
      }
    }

    let activeFilter = this.data.activeFilter;
    const fromReview = app.globalData.fromReviewPage;
    if (fromReview) {
      activeFilter = 'no-package';
      app.globalData.fromReviewPage = false;
    }

    this.setData({
      currentStoreId,
      currentStoreName,
      showStoreSwitcher: !isSingleStore,
      activeFilter,
      members: [],
      page: 1,
      hasMore: true,
      visibleCount: 5,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      loading: true,
      loadingMore: false
    });

    // 独立加载门店列表，不依赖全局数据；统计请求并行，减少串行等待
    Promise.all([
      this.loadStoreList(true),
      this.loadInfoChangeCount(),
      this.loadPendingClaimCount(currentStoreId)
    ]);
    this._startAutoRefresh();

    // 接入 WebSocket 实时更新计数
    this._connectWebSocket();
  },

  onHide() {
    this._stopAutoRefresh();
  },

  _connectWebSocket() {
    try {
      const ws = require('../../utils/websocket-client');
      const self = this;
      ws.connect({
        onMessage: {
          member_count_update: () => {
            // 会员计数变更时，实时刷新统计卡片数据（不影响列表滚动位置）
            self.loadInfoChangeCount();
            self.loadPendingClaimCount();
            // 刷新待审核计数（轻量级，不重置列表）
            self._refreshPendingCount();
            // 防抖刷新会员列表，避免短时间内多次推送导致频繁请求
            self._debouncedRefreshList();
          }
        }
      });
    } catch (e) {
      // WebSocket 不可用时静默降级，_startAutoRefresh 轮询兜底
    }
  },

  // 防抖刷新会员列表：收到审核推送后保留当前筛选条件重载第一页
  _debouncedRefreshList() {
    if (this._listRefreshTimer) clearTimeout(this._listRefreshTimer);
    this._listRefreshTimer = setTimeout(() => {
      this.setData({ page: 1, hasMore: true, visibleCount: 5, currentTotal: 0, showBackToTop: false, backToTopThreshold: 0, loadingMore: false });
      this.loadMembers();
    }, 600);
  },

  // 轻量刷新待审核计数，不重置列表和分页
  async _refreshPendingCount() {
    try {
      const res = await request({
        url: '/members/stats/overview',
        method: 'GET',
        data: { store_id: this.data.currentStoreId },
        timeout: 10000
      });
      if (res && res.data) {
        this.setData({ pendingCount: res.data.registered || 0 });
      }
    } catch (e) { /* 静默忽略 */ }
  },

  _startAutoRefresh() {
    this._stopAutoRefresh();
    this._autoRefreshTimer = setInterval(() => {
      this.loadStoreList();
      this.loadInfoChangeCount();
      this.loadPendingClaimCount();
    }, 30000);
  },

  _stopAutoRefresh() {
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
  },
  
  // 加载门店列表
  async loadStoreList(forceLoadMembers = false) {
    try {
      const res = await request({
        url: '/stores',
        method: 'GET'
      });
      let list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      // 门店隔离：按当前用户角色过滤可访问门店
      list = app.filterStoresForUser(list);
      // 同时更新本地和全局的门店列表

      this.setData({ storeList: list });
      app.globalData.storeList = list;
      // 门店名称回填：冷启动时全局门店列表可能未就绪，onShow 保留了已选门店但名称为空
      if (this.data.currentStoreId && !this.data.currentStoreName) {
        const found = list.find(s => String(s._id) === String(this.data.currentStoreId));
        if (found) {
          this.setData({ currentStoreName: found.name });
        } else if (!app.isSingleStoreRole()) {
          // 上次手动选择的门店已被删除（多门店角色）：回退"全部门店"并清除记忆
          try { wx.removeStorageSync('members_selected_store_id'); } catch (e) { /* 忽略 */ }
          this.setData({ currentStoreId: '', currentStoreName: '全部门店' });
        }
      }
      // 加载会员列表需要在门店列表加载完成后进行
      // 仅在显式请求时加载会员列表，自动刷新时不触发（避免翻页后 concat 导致重复）
      if (forceLoadMembers) {
        this.loadMembers(true);
      }
    } catch (err) {
      console.error('获取门店列表失败', err);
      wx.showToast({ title: '加载门店失败', icon: 'none' });
      // 即使获取门店列表失败，也尝试加载会员列表
      if (forceLoadMembers) {
        this.loadMembers(true);
      }
    }
  },

  onRefresh() {
    this.setData({ page: 1, hasMore: true });
    return Promise.all([
      this.loadStoreList(true),
      this.loadInfoChangeCount(),
      this.loadPendingClaimCount()
    ]);
  },

  onPullDownRefresh() {
    this.onRefresh().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 跳转到待审核页面
  onGoReview() {
    wx.navigateTo({ url: '/package-member/pages/members/member-review/member-review' });
  },

  onGoInfoReview() {
    wx.navigateTo({ url: '/package-member/pages/members/info-review/info-review' });
  },

  // 跳转到预建档管理页面
  onGoPreMember() {
    wx.navigateTo({ url: '/package-member/pages/pre-member/pre-member-list' });
  },

  // 加载预建档数量
  async loadPendingClaimCount(storeId) {
    try {
      const res = await request({
        url: '/pre-members/stats',
        method: 'GET',
        data: { store_id: storeId !== undefined ? storeId : this.data.currentStoreId }
      });
      const count = res.data && res.data.pending_count ? res.data.pending_count : 0;
      this.setData({ pendingClaimCount: count });
    } catch (err) {
      console.error('加载预建档数量失败', err);
    }
  },

  // ========== 待审核信息修改数量 ==========
  async loadInfoChangeCount() {
    try {
      const res = await request({
        url: '/members/info-change/list',
        method: 'GET'
      });
      const list = res.data && Array.isArray(res.data) ? res.data : (res.data && res.data.list ? res.data.list : []);
      this.setData({ infoChangeCount: list.length });
    } catch (err) {
      console.error('加载信息修改请求数量失败', err);
    }
  },

  // ========== 门店选择弹窗 ==========
  onShowStorePicker() {
    this.setData({ showStorePicker: true });
  },

  onCloseStorePicker() {
    this.setData({ showStorePicker: false });
  },

  // 统一门店选择器：点击打开 ActionSheet
  onStoreSwitcherTap() {
    if (!this.data.storeList.length) return;
    const items = ['全部门店', ...this.data.storeList.map(s => s.name)];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = res.tapIndex;
        let id = '';
        if (idx === 0) {
          id = '';
        } else {
          id = String(this.data.storeList[idx - 1]._id);
        }
        this.onStoreFilterChange({ currentTarget: { dataset: { id } } });
      }
    });
  },

  onStoreFilterChange(e) {
    const { id } = e.currentTarget.dataset;
    const storeList = this.data.storeList;
    const currentStore = id ? storeList.find(s => s._id === id) : null;
    app.globalData.currentStore = currentStore;
    app.globalData.currentStoreId = id;
    // 同步到全局统一门店选择（与首页/店务管理/运营管理共享）
    app.globalData.shopStoreId = id;
    // 持久化本页手动选择的门店：选"全部门店"时清除记忆（下次进入即默认全部）
    try {
      if (id) {
        wx.setStorageSync('members_selected_store_id', id);
      } else {
        wx.removeStorageSync('members_selected_store_id');
      }
    } catch (e) { /* 忽略存储失败 */ }
    this.setData({
      currentStoreId: id,
      currentStoreName: currentStore ? currentStore.name : '全部门店',
      showStorePicker: false,
      members: [],
      page: 1,
      hasMore: true,
      visibleCount: 5,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      loadingMore: false
    });
    this.loadMembers();
    this.loadInfoChangeCount();
    this.loadPendingClaimCount(id);
  },

  // ========== 套餐状态筛选 ==========
  onFilterChange(e) {
    const { filter } = e.currentTarget.dataset;
    const filterLabelMap = {
      'all': '全部会员',
      'active': '使用中',
      'cross_store': '跨门店',
      'suspended': '已停卡',
      'unactivated': '待激活',
      'exhausted': '已用完',
      'expired': '已过期',
      'no-package': '未录套餐'
    };
    this.setData({
      activeFilter: filter,
      filterLabel: filterLabelMap[filter] || '全部会员',
      members: [],
      page: 1,
      hasMore: true,
      visibleCount: 5,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      loadingMore: false
    });
    this.loadMembers();
  },

  // ========== 手机号显示切换 ==========
  // 使用 catchtouchstart 既阻止事件冒泡（防止卡片 :active 动画），又触发号码切换
  onTogglePhone(e) {
    const index = e.currentTarget.dataset.index;
    const key = `members[${index}]._showPhone`;
    this.setData({
      [key]: !this.data.members[index]._showPhone
    });
  },

  // ========== 搜索 ==========
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.setData({ members: [], page: 1, hasMore: true, visibleCount: 5, currentTotal: 0, showBackToTop: false, backToTopThreshold: 0, loadingMore: false });
    this.loadMembers();
  },

  onClearSearch() {
    this.setData({ keyword: '' });
    this.onSearch();
  },

  // ========== 加载会员列表 ==========
  // silent=true 时为"查看更多"静默加载：不切换 loading 状态，避免 expand-toggle 按钮显隐导致列表整体闪动
  async loadMembers(force = false, silent = false) {
    if ((!force && this.data.loading) || !this.data.hasMore) return;
    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const data = {
        store_id: this.data.currentStoreId,
        keyword: this.data.keyword,
        page: this.data.page,
        pageSize: 5,
        member_status: 'official'
      };
      // 套餐状态筛选

      if (this.data.activeFilter === 'active') {
        data.package_active = true;
      } else if (this.data.activeFilter === 'cross_store') {
        data.cross_store = true;
      } else if (this.data.activeFilter === 'suspended') {
        data.package_suspended = true;
      } else if (this.data.activeFilter === 'unactivated') {
        data.package_pending = true;
      } else if (this.data.activeFilter === 'exhausted') {
        data.package_exhausted = true;
      } else if (this.data.activeFilter === 'expired') {
        data.package_expired = true;
      } else if (this.data.activeFilter === 'no-package') {
        data.no_package = true;
      }
      const res = await request({
        url: '/members',
        method: 'GET',
        data,
        timeout: 30000
      });
      const result = res.data || {};
      const list = result.list || (Array.isArray(result) ? result : []);
      const total = result.total || 0;
      const pending = result.pendingCount || 0;

      const newList = list.map(member => this._buildMemberListItem(member));

      const isFirstPage = this.data.page === 1;
      const mergedList = isFirstPage ? newList : this.data.members.concat(newList);
      const currentTotal = isFirstPage ? total : this.data.currentTotal;
      const visibleCount = Math.min(mergedList.length, this.data.page * 5);

      // 构造增量更新对象：首页整体替换 members；翻页时仅追加新项，避免数组整体替换触发 wx:for 重渲染导致 scrollTop 跳动闪烁
      const updateData = {
        totalMembers: isFirstPage ? total : this.data.totalMembers,
        pendingCount: isFirstPage ? pending : this.data.pendingCount,
        hasMore: mergedList.length < currentTotal,
        currentTotal,
        visibleCount,
        showBackToTop: false
      };
      if (isFirstPage) {
        updateData.members = newList;
      } else {
        const startIdx = this.data.members.length;
        newList.forEach((item, i) => {
          updateData[`members[${startIdx + i}]`] = item;
        });
      }
      this.setData(updateData, () => {
        if (mergedList.length >= 5) this._calcBackToTopThreshold();
      });
    } catch (err) {
      console.error('加载会员列表失败', err);
    } finally {
      if (silent) {
        // 静默加载：仅重置 loadingMore，不切换 loading 状态
        this.setData({ loadingMore: false });
      } else {
        this.setData({ loading: false });
      }
    }
  },

  onReachBottom() {},

  /**
   * 构建会员列表项数据（供 loadMembers 和 _refreshSingleMember 复用）
   * 包含手机号脱敏、套餐信息文本、门店标签、状态判断等
   */
  _buildMemberListItem(member) {
    const maskPhone = (p) => {
      if (p && p.length === 11) {
        return p.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
      }
      return p;
    };
    const reservePhoneRaw = member.reserve_phone || member.phone || '';
    const wechatPhoneRaw = member.wechat_phone || '';
    const reservePhone = maskPhone(reservePhoneRaw);
    const wechatPhone = maskPhone(wechatPhoneRaw);

    // 构建套餐行数据：一个套餐一行，每行携带自己的状态标签（已激活/待激活/已停卡/已过期/已用完）
    let packageRows = [];
    if (member.member_status === 'official' && member.packages && member.packages.length > 0) {
      // 展示排序：使用中 > 已停卡 > 待激活 > 已用完 > 已过期
      const statusOrder = { active: 0, suspended: 1, pending: 2, exhausted: 3, expired: 4 };
      const getPkgOrder = (p) => {
        if (p.status === 'active' && p.is_suspended) return statusOrder.suspended;
        return statusOrder[p.status] !== undefined ? statusOrder[p.status] : 9;
      };
      packageRows = member.packages
        .slice()
        .sort((a, b) => getPkgOrder(a) - getPkgOrder(b))
        .map((pkg, idx) => {
          const typeLabel = pkg.package_type === 'time_card' ? '时间卡' : '次卡';
          const startDate = pkg.start_date ? formatDate(pkg.start_date) : '';
          const endDate = pkg.end_date ? formatDate(pkg.end_date) : '';
          const dateRange = (startDate || endDate) ? `${startDate}至${endDate}` : '';
          const duration = pkg.duration_value || 0;
          const unit = pkg.duration_unit === 'month' ? '个月' : '天';
          let info = '';
          if (pkg.package_type === 'count_card') {
            const total = pkg.total_credits || 0;
            const remaining = pkg.remaining_credits || 0;
            info = `${typeLabel} · ${remaining}/${total}次`;
            if (pkg.status === 'pending') {
              // 待激活：显示卡面时长（XX个月/XX天），激活时才起算有效期
              if (duration) info += ` · ${duration}${unit}`;
            } else if (dateRange) {
              info += ' · ' + dateRange;
            }
          } else {
            let limitStr = '不限次数';
            if (pkg.daily_limit) {
              limitStr = `每日${pkg.daily_limit}次`;
            } else if (pkg.weekly_limit) {
              limitStr = `每周${pkg.weekly_limit}次`;
            } else if (pkg.monthly_limit) {
              limitStr = `每月${pkg.monthly_limit}次`;
            }
            if (pkg.status === 'pending') {
              info = `${typeLabel}`;
              if (limitStr) info += ' · ' + limitStr;
              if (duration) info += ` · ${duration}${unit}`;
            } else {
              const remainDays = pkg.remaining_days;
              const remainStr = remainDays !== undefined && remainDays !== null ? `${remainDays}天剩余` : '';
              info = `${typeLabel}`;
              if (limitStr) info += ' · ' + limitStr;
              if (remainStr) info += ' · ' + remainStr;
              if (dateRange) info += ' · ' + dateRange;
            }
          }
          // 舞种限制（该套餐独有）
          const dsl = pkg.dance_style_limit || [];
          let danceStyleText = '';
          if (Array.isArray(dsl) && dsl.length > 0) {
            danceStyleText = dsl
              .map(ds => (typeof ds === 'object' ? (ds.name || '') : ''))
              .filter(Boolean)
              .join('、');
          }
          // 套餐状态标签
          let statusText = '';
          let statusCls = '';
          if (pkg.is_suspended) {
            statusText = '已停卡';
            statusCls = 'status-danger';
          } else if (pkg.status === 'active') {
            statusText = '已激活';
            statusCls = 'status-active';
          } else if (pkg.status === 'pending') {
            statusText = '待激活';
            statusCls = 'status-warning';
          } else if (pkg.status === 'exhausted') {
            statusText = '已用完';
            statusCls = 'status-default';
          } else if (pkg.status === 'expired') {
            statusText = '已过期';
            statusCls = 'status-default';
          } else {
            statusText = '未激活';
            statusCls = 'status-default';
          }
          return {
            key: pkg._id || String(idx),
            info,
            dance_style_text: danceStyleText,
            status_text: statusText,
            status_cls: statusCls
          };
        });
    }

    // 处理门店标签
    // 福永店使用蓝色系标签，与其他门店（棕色系）视觉区分
    const isFuyongStore = (name) => (name || '').indexOf('福永') !== -1;
    let storeLabels = [];
    if (member.packages && member.packages.length > 0) {
      const storeMap = new Map();
      member.packages.forEach(pkg => {
        if (pkg.store_id && pkg.store_id._id && pkg.store_id.name) {
          if (!storeMap.has(pkg.store_id._id)) {
            storeMap.set(pkg.store_id._id, {
              id: pkg.store_id._id,
              name: pkg.store_id.name,
              isFuyong: isFuyongStore(pkg.store_id.name)
            });
          }
        }
      });
      storeLabels = Array.from(storeMap.values());
    } else if (member.store_id && member.store_id._id && member.store_id.name) {
      storeLabels = [{
        id: member.store_id._id,
        name: member.store_id.name,
        isFuyong: isFuyongStore(member.store_id.name)
      }];
    }

    let displayStatus = 'inactive';
    let canEditPackage = false;
    if (member.status === 'disabled') {
      displayStatus = 'disabled';
    } else if (member.member_status === 'registered') {
      displayStatus = 'pending';
    } else if (!member.packages || member.packages.length === 0) {
      displayStatus = 'no-package';
    } else {
      const activePkg = member.packages.find(p => p.status === 'active' && p.is_activated && !p.is_suspended);
      const suspendedPkg = member.packages.find(p => p.status === 'active' && p.is_activated && p.is_suspended);
      const pendingPkg = member.packages.find(p => p.status === 'pending' && !p.is_activated);
      const exhaustedPkg = member.packages.find(p => p.status === 'exhausted');
      const expiredPkg = member.packages.find(p => p.status === 'expired');
      if (activePkg) {
        displayStatus = 'active';
        canEditPackage = true;
      } else if (suspendedPkg) {
        displayStatus = 'suspended';
      } else if (pendingPkg) {
        displayStatus = 'unactivated';
        canEditPackage = true;
      } else if (exhaustedPkg) {
        displayStatus = 'exhausted';
      } else if (expiredPkg) {
        displayStatus = 'expired';
      } else {
        displayStatus = 'no-package';
      }
    }

    return {
      ...member,
      nickname: member.nick_name,
      avatar: normalizeAvatarUrl(member.avatar_url),
      phone: reservePhone,
      reserve_phone: reservePhone,
      reserve_phone_raw: reservePhoneRaw,
      wechat_phone_display: wechatPhone,
      wechat_phone_raw: wechatPhoneRaw,
      created_at: formatDate(member.created_at),
      reviewed_at: formatReviewDate(member.updated_at || member.created_at),
      status: displayStatus,
      member_status: member.member_status,
      has_package: member.packages && member.packages.length > 0,
      can_edit_package: canEditPackage,
      package_rows: packageRows,
      store_labels: storeLabels
    };
  },

  /**
   * 局部刷新单个会员数据（从详情页返回后调用）
   * 仅更新该会员在列表中的数据，不重载列表、不影响滚动位置
   */
  async _refreshSingleMember(memberId) {
    if (!memberId) return;
    try {
      const res = await request({
        url: `/members/${memberId}`,
        method: 'GET',
        timeout: 15000
      });
      const member = res.data || {};
      const newItem = this._buildMemberListItem(member);
      // 在已加载列表中找到该会员索引
      const members = this.data.members;
      const idx = members.findIndex(m => String(m._id) === String(memberId));
      if (idx >= 0) {
        // 局部更新该会员，保留 _showPhone 等UI状态
        const preserved = {
          _showPhone: members[idx]._showPhone
        };
        this.setData({ [`members[${idx}]`]: { ...newItem, ...preserved } });
      }
      // 注：套餐修改不影响 pendingClaimCount（预建档统计）和 infoChangeCount（信息变更统计），无需刷新
    } catch (err) {
      console.error('局部刷新会员数据失败', err);
    }
  },

  // 点击"查看更多"加载下一页：走静默加载路径，不切换 loading 状态，避免按钮显隐导致列表闪动
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.setData({ loadingMore: true, page: this.data.page + 1 }, () => {
      this.loadMembers(false, true);
    });
  },

  // 返回顶部
  onBackToTop() {
    this.setData({ showBackToTop: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  // 滚动监听，控制返回顶部按钮显隐
  onPageScroll(e) {
    // 记录最新滚动位置，供详情页返回时恢复
    this._lastScrollTop = e.scrollTop;
    const threshold = this.data.backToTopThreshold;
    const shouldShow = threshold > 0 && e.scrollTop > threshold;
    if (shouldShow !== this.data.showBackToTop) {
      this.setData({ showBackToTop: shouldShow });
    }
  },

  // 计算第5条记录底部位置，作为返回顶部按钮显示阈值
  _calcBackToTopThreshold() {
    const query = wx.createSelectorQuery().in(this);
    query.selectAll('.member-list .member-card').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const cards = res[0];
      const scrollOffset = res[1];
      if (cards && cards[4] && scrollOffset) {
        this.setData({
          backToTopThreshold: scrollOffset.scrollTop + cards[4].bottom
        });
      }
    });
  },

  onAvatarError(e) {
    const index = e.currentTarget.dataset.index;
    if (this.data.members[index]) {
      this.setData({ [`members[${index}].avatar`]: '/images/default-avatar.svg' });
    }
  },

  // ========== 审核 ==========
  onReview(e) {
    const { member } = e.detail;
    this.setData({
      showReviewModal: true,
      reviewMember: member,
      reviewAction: 'approve'
    });
  },

  onReject(e) {
    const { member } = e.detail;
    wx.showModal({
      title: '确认拒绝',
      content: `确认拒绝 ${member.nickname || member.name} 的会员申请？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/members/${member._id}/review`,
              method: 'PUT',
              data: { action: 'reject' }
            });
            wx.showToast({ title: '已拒绝', icon: 'success' });
            this.setData({ members: [], page: 1, hasMore: true }, () => {
              this.loadMembers();
            });
          } catch (err) {
            console.error('拒绝失败', err);
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
          }
        }
      }
    });
  },

  onReviewAction(e) {
    const { action } = e.currentTarget.dataset;
    this.setData({ reviewAction: action });
  },

  onCloseReviewModal() {
    this.setData({ showReviewModal: false, reviewMember: null });
  },

  onModalTap() {},

  async onSubmitReview() {
    if (!app.hasPermission('member_review')) {
      wx.showToast({ title: '无权限执行此操作', icon: 'none' });
      return;
    }
    const { reviewMember, reviewAction } = this.data;
    try {
      await request({
        url: `/members/${reviewMember._id}/review`,
        method: 'PUT',
        data: { action: reviewAction }
      });
      wx.showToast({
        title: reviewAction === 'approve' ? '已通过' : '已拒绝',
        icon: 'success'
      });
      this.setData({ showReviewModal: false, reviewMember: null, members: [], page: 1, hasMore: true }, () => {
        this.loadMembers();
      });
    } catch (err) {
      console.error('审核失败', err);
      wx.showToast({ title: '审核失败，请重试', icon: 'none' });
    }
  },

  // ========== 套餐录入 ==========
  async onAddPackage(e) {
    const member = e.currentTarget.dataset.member || (e.detail && e.detail.member);
    
    if (!member || !member._id) {
      wx.showToast({ title: '会员信息缺失', icon: 'none' });
      return;
    }

    const isSingleStore = app.isSingleStoreRole();
    const defaultStoreId = app.getDefaultStoreId ? app.getDefaultStoreId() : '';

    const defaultForm = {
      package_type: 'count_card',
      store_id: '',
      store_name: '',
      total_credits: '',
      duration_value: '',
      duration_unit: 'month',
      limit_type: 'limited',
      limit_cycle: 'weekly',
      limit_value: '',
      dance_style_limit: [],
      remark: ''
    };

    let storeListForPicker = [];
    let packageFormStoreIndex = 0;
    try {
      const storeRes = await request({ url: '/stores' });
      const stores = storeRes.data && (Array.isArray(storeRes.data) ? storeRes.data : (storeRes.data.list || []));
      // 按当前用户角色过滤可访问门店（单门店角色仅返回所属门店）
      storeListForPicker = app.filterStoresForUser(stores).filter(s => s.status === 'active');
    } catch (err) {
      console.error('获取门店列表失败', err);
    }

    if (isSingleStore && defaultStoreId) {
      // 单门店权限：所属门店固定为本门店，不可切换
      const ownStore = storeListForPicker.find(s => String(s._id) === String(defaultStoreId));
      defaultForm.store_id = defaultStoreId;
      defaultForm.store_name = ownStore ? ownStore.name : '';
      const idx = storeListForPicker.findIndex(s => String(s._id) === String(defaultStoreId));
      packageFormStoreIndex = idx >= 0 ? idx : 0;
    } else {
      // 超管/审核员/多门店权限：默认取会员归属门店，可通过选择器自由切换
      const memberStoreId = member.store_id && (member.store_id._id || member.store_id);
      const memberStoreName = member.store_id && member.store_id.name ? member.store_id.name : '';
      if (memberStoreId) {
        defaultForm.store_id = memberStoreId;
        defaultForm.store_name = memberStoreName;
        const idx = storeListForPicker.findIndex(s => s._id === memberStoreId || (s._id && s._id.toString && memberStoreId.toString && s._id.toString() === memberStoreId.toString()));
        if (idx >= 0) packageFormStoreIndex = idx;
      }
    }

    try {
      const res = await request({
        url: `/members/${member._id}`,
        method: 'GET'
      });
      const packages = res.data && res.data.packages || [];
      const activePkg = packages.find(p => p.status === 'active');
      if (activePkg) {
        defaultForm.package_type = activePkg.package_type || 'count_card';
        defaultForm.duration_value = activePkg.duration_value || '';
        defaultForm.duration_unit = activePkg.duration_unit || 'month';
        if (activePkg.daily_limit) {
          defaultForm.limit_type = 'limited';
          defaultForm.limit_cycle = 'daily';
          defaultForm.limit_value = activePkg.daily_limit || '';
        } else if (activePkg.weekly_limit) {
          defaultForm.limit_type = 'limited';
          defaultForm.limit_cycle = 'weekly';
          defaultForm.limit_value = activePkg.weekly_limit || '';
        } else if (activePkg.monthly_limit) {
          defaultForm.limit_type = 'limited';
          defaultForm.limit_cycle = 'monthly';
          defaultForm.limit_value = activePkg.monthly_limit || '';
        } else {
          defaultForm.limit_type = 'unlimited';
          defaultForm.limit_cycle = 'weekly';
          defaultForm.limit_value = '';
        }
        defaultForm.remark = activePkg.remark || '';
        // 回填舞种限制（populate 后是对象数组，未 populate 是 ObjectId 数组）
        if (Array.isArray(activePkg.dance_style_limit) && activePkg.dance_style_limit.length > 0) {
          defaultForm.dance_style_limit = activePkg.dance_style_limit.map(ds =>
            _normalizeDanceStyleId(typeof ds === 'object' ? (ds._id || ds.id) : ds)
          );
        }
        if (activePkg.package_type === 'count_card') {
          defaultForm.total_credits = activePkg.remaining_credits || '';
        }
        // 单门店权限时所属门店已固定为本门店，不可被活跃套餐覆盖
        if (activePkg.store_id && !isSingleStore) {
          const pkgStoreId = activePkg.store_id._id || activePkg.store_id;
          const pkgStoreName = activePkg.store_id.name || '';
          defaultForm.store_id = pkgStoreId;
          defaultForm.store_name = pkgStoreName;
          const idx = storeListForPicker.findIndex(s => s._id === pkgStoreId || (s._id && s._id.toString && pkgStoreId.toString && s._id.toString() === pkgStoreId.toString()));
          if (idx >= 0) packageFormStoreIndex = idx;
        }
      }
    } catch (err) {
      console.error('获取套餐信息失败', err);
    }

    // 加载舞种列表（供舞种限制多选）
    await this._loadDanceStyleList();

    this.setData({
      showPackageModal: true,
      packageMember: member,
      packageForm: defaultForm,
      storeListForPicker,
      packageFormStoreIndex,
      packageStoreLocked: isSingleStore
    });
    this._refreshDanceStyleText();
  },

  // ========== 舞种限制 ==========
  async _loadDanceStyleList() {
    if (this.data.danceStyleList && this.data.danceStyleList.length > 0) return;
    try {
      const res = await request({ url: '/dance-styles' });
      const list = res.data && (Array.isArray(res.data) ? res.data : (res.data.list || []));
      const danceStyleList = list
        .filter(ds => ds.status === 'active')
        .map(ds => ({ ...ds, _id: _normalizeDanceStyleId(ds._id) }));
      this.setData({ danceStyleList });
    } catch (err) {
      console.error('获取舞种列表失败', err);
    }
  },

  _buildDanceStyleText() {
    const { danceStyleList, packageForm } = this.data;
    const selectedIds = packageForm.dance_style_limit || [];
    if (selectedIds.length === 0) return '';
    const names = danceStyleList
      .filter(ds => selectedIds.indexOf(ds._id) > -1)
      .map(ds => ds.name);
    return names.join('、');
  },

  _refreshDanceStyleText() {
    this.setData({ packageFormDanceStyleText: this._buildDanceStyleText() });
  },

  onOpenDanceStylePicker() {
    const arr = this.data.packageForm.dance_style_limit || [];
    this.setData({
      selectedDanceStyleId: arr.length > 0 ? arr[0] : '',
      showDanceStylePicker: true
    });
  },

  onCloseDanceStylePicker() {
    this.setData({ showDanceStylePicker: false });
  },

  onSelectDanceStyle(e) {
    const { id } = e.currentTarget.dataset;
    const normalizedId = id ? _normalizeDanceStyleId(id) : '';
    // 单选：空 id 表示"不限舞种"，清空数组；否则只保留该舞种
    const selectedIds = normalizedId ? [normalizedId] : [];
    this.setData({
      'packageForm.dance_style_limit': selectedIds,
      selectedDanceStyleId: normalizedId,
      showDanceStylePicker: false
    });
    this._refreshDanceStyleText();
  },

  onPackageStoreChange(e) {
    const idx = e.detail.value;
    const store = this.data.storeListForPicker[idx];
    if (store) {
      this.setData({
        packageFormStoreIndex: idx,
        'packageForm.store_id': store._id,
        'packageForm.store_name': store.name
      });
    }
  },

  onPackageTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ 'packageForm.package_type': type });
  },

  onPackageLimitTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ 'packageForm.limit_type': type, 'packageForm.limit_value': '' });
  },

  onPackageLimitCycleChange(e) {
    this.setData({ 'packageForm.limit_cycle': e.currentTarget.dataset.type, 'packageForm.limit_value': '' });
  },

  onPackageDurationUnitChange(e) {
    const unit = e.currentTarget.dataset.unit;
    this.setData({ 'packageForm.duration_unit': unit });
  },

  onClosePackageModal() {
    this.setData({ showPackageModal: false, packageMember: null });
  },

  onPackageModalTap() {
    // 防止点击弹窗内容时关闭弹窗
  },

  onPackageInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`packageForm.${field}`]: e.detail.value });
  },

  async onSubmitPackage() {
    const { packageMember, packageForm } = this.data;

    // 验证门店是否已选择

    if (!packageForm.store_id) {
      wx.showToast({ title: '请选择门店', icon: 'none' });
      return;
    }

    if (packageForm.package_type === 'count_card') {
      if (!packageForm.total_credits) {
        wx.showToast({ title: '请输入次数', icon: 'none' });
        return;
      }
      const totalCredits = parseInt(packageForm.total_credits);
      if (isNaN(totalCredits) || totalCredits <= 0) {
        wx.showToast({ title: '次数必须是正整数', icon: 'none' });
        return;
      }
    }

    if (!packageForm.duration_value) {
      wx.showToast({ title: '请输入服务有效期', icon: 'none' });
      return;
    }
    const durationValue = parseInt(packageForm.duration_value);
    if (isNaN(durationValue) || durationValue <= 0) {
      wx.showToast({ title: '有效期必须是正整数', icon: 'none' });
      return;
    }

    if (packageForm.package_type === 'time_card' && !packageForm.limit_type) {
      wx.showToast({ title: '请选择次数限制', icon: 'none' });
      return;
    }
    if (packageForm.package_type === 'time_card' && packageForm.limit_type === 'limited') {
      if (!packageForm.limit_cycle) {
        wx.showToast({ title: '请选择周期类型', icon: 'none' });
        return;
      }
      if (!packageForm.limit_value) {
        const cycleLabel = packageForm.limit_cycle === 'daily' ? '每日' : (packageForm.limit_cycle === 'weekly' ? '每周' : '每月');
        wx.showToast({ title: `请输入${cycleLabel}限制次数`, icon: 'none' });
        return;
      }
      const limitValue = parseInt(packageForm.limit_value);
      if (isNaN(limitValue) || limitValue <= 0) {
        wx.showToast({ title: '限制次数必须是正整数', icon: 'none' });
        return;
      }
    }

    try {
      const postData = {
        user_id: packageMember._id,
        store_id: packageForm.store_id || (packageMember.store_id && (packageMember.store_id._id || packageMember.store_id)) || null,
        package_type: packageForm.package_type,
        duration_value: parseInt(packageForm.duration_value),
        duration_unit: packageForm.duration_unit,
        dance_style_limit: Array.isArray(packageForm.dance_style_limit) ? packageForm.dance_style_limit : [],
        remark: packageForm.remark
      };

      if (packageForm.package_type === 'count_card') {
        postData.total_credits = parseInt(packageForm.total_credits);
      } else {
        postData.duration_value = parseInt(packageForm.duration_value);
        postData.duration_unit = packageForm.duration_unit;
        postData.total_credits = 9999;
        if (packageForm.limit_type === 'limited') {
          const cycle = packageForm.limit_cycle;
          if (cycle === 'daily') {
            postData.daily_limit = parseInt(packageForm.limit_value);
          } else if (cycle === 'weekly') {
            postData.weekly_limit = parseInt(packageForm.limit_value);
          } else if (cycle === 'monthly') {
            postData.monthly_limit = parseInt(packageForm.limit_value);
          }
        }
        // unlimited: 不传 daily_limit / weekly_limit / monthly_limit
      }

      await request({
        url: `/packages`,
        method: 'POST',
        data: postData
      });
      wx.showToast({ title: '录入成功', icon: 'success' });
      this.setData({ 
        showPackageModal: false, 
        packageMember: null,
        members: [],
        page: 1,
        hasMore: true
      });
      this.loadMembers();
    } catch (err) {
      console.error('录入套餐失败', err);
      wx.showToast({ title: err.data?.message || '录入失败', icon: 'none' });
    }
  },

  // ========== 查看详情 ==========
  onViewDetail(e) {
    // 防止快速双击导致 routeDone webviewId not found 错误
    if (this._navigating) return;
    const member = e.currentTarget.dataset.member || (e.detail && e.detail.member);
    if (!member) return;
    this._navigating = true;
    // 标记从详情页返回时需恢复滚动位置
    this._backFromDetail = true;
    wx.navigateTo({
      url: `/package-member/pages/members/member-detail/member-detail?id=${member._id}`,
      fail: (err) => {
        this._navigating = false;
        console.warn('导航到会员详情失败:', err);
      },
      complete: () => {
        // 延迟释放锁，确保页面跳转完成后再允许下次点击
        setTimeout(() => { this._navigating = false; }, 500);
      }
    });
  }
});
