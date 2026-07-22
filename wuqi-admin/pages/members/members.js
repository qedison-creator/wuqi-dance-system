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
    loading: false,
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
      limit_type: 'weekly',
      limit_value: '',
      remark: ''
    },
    storeListForPicker: [],
    packageFormStoreIndex: 0
  },

  onShow() {
    if (!app.checkAuth()) return;
    // 更新自定义tabbar的选中状态

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    const userInfo = app.globalData.userInfo || {};
    const isReviewer = userInfo.role === 'reviewer';
    const currentStore = app.globalData.currentStore;
    const currentStoreId = currentStore ? currentStore._id : '';
    const currentStoreName = currentStore ? currentStore.name : '';
    
    let activeFilter = this.data.activeFilter;
    const fromReview = app.globalData.fromReviewPage;
    if (fromReview) {
      activeFilter = 'no-package';
      app.globalData.fromReviewPage = false;
    }
    
    this.setData({
      currentStoreId,
      currentStoreName,
      activeFilter,
      members: [],
      page: 1,
      hasMore: true,
      loading: true
    });

    // 独立加载门店列表，不依赖全局数据；统计请求并行，减少串行等待
    Promise.all([
      this.loadStoreList(true),
      this.loadInfoChangeCount(),
      this.loadPendingClaimCount()
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
          }
        }
      });
    } catch (e) {
      // WebSocket 不可用时静默降级，_startAutoRefresh 轮询兜底
    }
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
      const list = res.data && res.data.list
        ? res.data.list
        : (Array.isArray(res.data) ? res.data : []);
      // 同时更新本地和全局的门店列表

      this.setData({ storeList: list });
      app.globalData.storeList = list;
      // 加载会员列表需要在门店列表加载完成后进行

      this.loadMembers(forceLoadMembers);
    } catch (err) {
      console.error('获取门店列表失败', err);
      wx.showToast({ title: '加载门店失败', icon: 'none' });
      // 即使获取门店列表失败，也尝试加载会员列表

      this.loadMembers(forceLoadMembers);
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
  async loadPendingClaimCount() {
    try {
      const res = await request({
        url: '/pre-members/stats',
        method: 'GET'
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

  onStoreFilterChange(e) {
    const { id } = e.currentTarget.dataset;
    const storeList = this.data.storeList;
    const currentStore = id ? storeList.find(s => s._id === id) : null;
    app.globalData.currentStore = currentStore;
    app.globalData.currentStoreId = id;
    this.setData({
      currentStoreId: id,
      currentStoreName: currentStore ? currentStore.name : '',
      showStorePicker: false,
      members: [],
      page: 1,
      hasMore: true
    });
    this.loadMembers();
    this.loadInfoChangeCount();
    this.loadPendingClaimCount();
  },

  // ========== 套餐状态筛选 ==========
  onFilterChange(e) {
    const { filter } = e.currentTarget.dataset;
    const filterLabelMap = {
      'all': '全部会员',
      'active': '使用中',
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
      hasMore: true
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
    this.setData({ members: [], page: 1, hasMore: true });
    this.loadMembers();
  },

  onClearSearch() {
    this.setData({ keyword: '' });
    this.onSearch();
  },

  // ========== 加载会员列表 ==========
  async loadMembers(force = false) {
    if ((!force && this.data.loading) || !this.data.hasMore) return;
    this.setData({ loading: true });

    try {
      const data = {
        store_id: this.data.currentStoreId,
        keyword: this.data.keyword,
        page: this.data.page,
        limit: 20,
        member_status: 'official'
      };
      // 套餐状态筛选

      if (this.data.activeFilter === 'active') {
        data.package_active = true;
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

      const newList = list.map(member => {
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

        // 构建套餐信息文本

        let packageInfo = '';
        if (member.member_status === 'official' && member.packages && member.packages.length > 0) {
          const usablePkg = member.packages.find(p => p.status === 'active') || member.packages.find(p => p.status === 'pending');
          if (usablePkg) {
            const typeLabel = usablePkg.package_type === 'time_card' ? '时间卡' : '次卡';
            const statusPrefix = usablePkg.status === 'pending' ? '未激活·' : '';
            const startDate = usablePkg.start_date ? formatDate(usablePkg.start_date) : '';
            const endDate = usablePkg.end_date ? formatDate(usablePkg.end_date) : '';
            const dateRange = (startDate || endDate) ? `有效期${startDate}至${endDate}` : '';
            if (usablePkg.package_type === 'count_card') {
              const total = usablePkg.total_credits || 0;
              const remaining = usablePkg.remaining_credits || 0;
              packageInfo = `${statusPrefix}${typeLabel} · ${remaining}/${total}次`;
              if (dateRange) packageInfo += ' · ' + dateRange;
            } else {
              const duration = usablePkg.duration_value || 0;
              const unit = usablePkg.duration_unit === 'month' ? '个月' : '天';
              let limitStr = '';
              if (usablePkg.daily_limit) {
                limitStr = `每日${usablePkg.daily_limit}次`;
              } else if (usablePkg.weekly_limit) {
                limitStr = `每周${usablePkg.weekly_limit}次`;
              }
              if (usablePkg.status === 'pending') {
                packageInfo = `${statusPrefix}${typeLabel} · ${duration}${unit}`;
                if (limitStr) packageInfo += ' · ' + limitStr;
              } else {
                const remainDays = usablePkg.remaining_days;
                const remainStr = remainDays !== undefined && remainDays !== null ? `${remainDays}天剩余` : '';
                packageInfo = `${typeLabel}`;
                if (limitStr) packageInfo += ' · ' + limitStr;
                if (remainStr) packageInfo += ' · ' + remainStr;
                if (dateRange) packageInfo += ' · ' + dateRange;
              }
            }
          }
        }

        // 处理门店标签

        let storeLabels = [];
        if (member.packages && member.packages.length > 0) {
          // 有套餐：显示套餐所属门店

          const storeMap = new Map();
          member.packages.forEach(pkg => {
            if (pkg.store_id && pkg.store_id._id && pkg.store_id.name) {
              if (!storeMap.has(pkg.store_id._id)) {
                storeMap.set(pkg.store_id._id, {
                  id: pkg.store_id._id,
                  name: pkg.store_id.name
                });
              }
            }
          });
          storeLabels = Array.from(storeMap.values());
        } else if (member.store_id && member.store_id._id && member.store_id.name) {
          // 无套餐：显示用户选择或审核时选择的门店
          storeLabels = [{
            id: member.store_id._id,
            name: member.store_id.name
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
          // 按优先级判断套餐状态：active > suspended > pending > exhausted > expired

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
          package_info: packageInfo,
          store_labels: storeLabels
        };
      });

      const isFirstPage = this.data.page === 1;
      this.setData({
        members: isFirstPage ? newList : this.data.members.concat(newList),
        totalMembers: isFirstPage ? total : this.data.totalMembers,
        pendingCount: isFirstPage ? pending : this.data.pendingCount,
        hasMore: newList.length >= 20,
        page: this.data.page + 1
      });
    } catch (err) {
      console.error('加载会员列表失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    this.loadMembers();
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

    const defaultForm = {
      package_type: 'count_card',
      store_id: '',
      store_name: '',
      total_credits: '',
      duration_value: '',
      duration_unit: 'month',
      limit_type: 'weekly',
      limit_value: '',
      remark: ''
    };

    const memberStoreId = member.store_id && (member.store_id._id || member.store_id);
    const memberStoreName = member.store_id && member.store_id.name ? member.store_id.name : '';
    if (memberStoreId) {
      defaultForm.store_id = memberStoreId;
      defaultForm.store_name = memberStoreName;
    }

    let storeListForPicker = [];
    let packageFormStoreIndex = 0;
    try {
      const storeRes = await request({ url: '/stores' });
      const stores = storeRes.data && (Array.isArray(storeRes.data) ? storeRes.data : (storeRes.data.list || []));
      storeListForPicker = stores.filter(s => s.status === 'active');
      if (memberStoreId) {
        const idx = storeListForPicker.findIndex(s => s._id === memberStoreId || s._id.toString() === memberStoreId.toString());
        if (idx >= 0) packageFormStoreIndex = idx;
      }
    } catch (err) {
      console.error('获取门店列表失败', err);
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
          defaultForm.limit_type = 'daily';
          defaultForm.limit_value = activePkg.daily_limit || '';
        } else if (activePkg.weekly_limit) {
          defaultForm.limit_type = 'weekly';
          defaultForm.limit_value = activePkg.weekly_limit || '';
        } else {
          defaultForm.limit_type = 'unlimited';
          defaultForm.limit_value = '';
        }
        defaultForm.remark = activePkg.remark || '';
        if (activePkg.package_type === 'count_card') {
          defaultForm.total_credits = activePkg.remaining_credits || '';
        }
        if (activePkg.store_id) {
          const pkgStoreId = activePkg.store_id._id || activePkg.store_id;
          const pkgStoreName = activePkg.store_id.name || '';
          defaultForm.store_id = pkgStoreId;
          defaultForm.store_name = pkgStoreName;
          const idx = storeListForPicker.findIndex(s => s._id === pkgStoreId || s._id.toString() === pkgStoreId.toString());
          if (idx >= 0) packageFormStoreIndex = idx;
        }
      }
    } catch (err) {
      console.error('获取套餐信息失败', err);
    }

    this.setData({
      showPackageModal: true,
      packageMember: member,
      packageForm: defaultForm,
      storeListForPicker,
      packageFormStoreIndex
    });
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
      wx.showToast({ title: '请选择限制方式', icon: 'none' });
      return;
    }
    if (packageForm.package_type === 'time_card' && packageForm.limit_type !== 'unlimited' && !packageForm.limit_value) {
      wx.showToast({ title: packageForm.limit_type === 'daily' ? '请输入每日限制' : '请输入每周限制', icon: 'none' });
      return;
    }
    if (packageForm.package_type === 'time_card' && packageForm.limit_type !== 'unlimited' && packageForm.limit_value) {
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
        remark: packageForm.remark
      };

      if (packageForm.package_type === 'count_card') {
        postData.total_credits = parseInt(packageForm.total_credits);
      } else {
        postData.duration_value = parseInt(packageForm.duration_value);
        postData.duration_unit = packageForm.duration_unit;
        postData.total_credits = 9999;
        if (packageForm.limit_type === 'daily') {
          postData.daily_limit = parseInt(packageForm.limit_value);
        } else if (packageForm.limit_type === 'weekly') {
          postData.weekly_limit = parseInt(packageForm.limit_value);
        }
        // unlimited: 不传 daily_limit 和 weekly_limit
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
