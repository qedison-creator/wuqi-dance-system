const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');

Page({
  data: {
    activeTab: 'activation',
    activationList: [],
    extensionList: [],
    entryList: [],
    loading: true,
    page: 1,
    pageSize: 20,
    hasMore: true, // 是否还有更多数据
    requestId: 0, // 请求标识，用于解决竞态条件
    // 门店筛选
    storeList: [],
    currentStoreIndex: 0,
    currentStore: null,
    currentStoreName: '全部门店',
    showStoreModal: false,
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.loadStores();
    this.setData({ loading: true });
    this.loadList();
  },

  // 加载门店列表
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
      });
    } catch (err) {
      console.error('加载门店失败', err);
    }
  },

  // 打开门店选择弹窗
  onOpenStoreModal() {
    this.setData({ showStoreModal: true });
  },

  // 关闭门店选择弹窗
  onCloseStoreModal() {
    this.setData({ showStoreModal: false });
  },

  // 选择门店
  onSelectStore(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const storeList = this.data.storeList;
    const store = storeList[index];
    this.setData({
      currentStoreIndex: index,
      currentStore: store && store._id ? store : null,
      currentStoreName: store ? store.name : '全部门店',
      showStoreModal: false,
      loading: true,
      page: 1,
      hasMore: true
    }, () => {
      this.loadList();
    });
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    // 切换标签时重置分页状态

    this.setData({ 
      activeTab: tab, 
      loading: true, 
      page: 1,
      hasMore: true 
    });
    this.loadList();
  },

  // 根据当前tab加载列表
  loadList() {
    const { activeTab } = this.data;
    if (activeTab === 'activation') {
      this.loadActivationList();
    } else if (activeTab === 'extension') {
      this.loadExtensionList();
    } else if (activeTab === 'entry') {
      this.loadEntryList();
    }
  },

  async loadActivationList() {
    // 竞态条件处理：生成请求标识

    const currentRequestId = Date.now();
    this.setData({ requestId: currentRequestId });
    
    try {
      this.setData({ loading: true });
      const res = await request({
        url: '/packages/package-activations',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          store_id: this.data.currentStore ? this.data.currentStore._id : ''
        }
      });
      
      // 竞态条件处理：检查是否是最新的请求

      if (this.data.requestId !== currentRequestId) {
        console.log('忽略过期的激活记录请求');
        return;
      }
      
      const data = res.data || {};
      const newList = (data.list || []).map(item => {
        const typeMap = { manual: '手动激活', auto: '自动激活', booking: '预约激活' };
        return {
          ...item,
          typeLabel: typeMap[item.type] || item.type || '',
          activated_at_display: item.activated_at ? this.formatDateTime(item.activated_at) : '-',
          effective_date_display: item.effective_date ? item.effective_date.split('T')[0] : '-',
          expire_date_display: item.expire_date ? item.expire_date.split('T')[0] : '-',
        };
      });
      
      // 分页处理：第一页替换数据，后续页面追加数据

      const activationList = this.data.page === 1 ? newList : [...this.data.activationList, ...newList];
      const hasMore = newList.length >= this.data.pageSize;
      
      this.setData({ 
        activationList,
        hasMore,
        loading: false 
      });
    } catch (err) {
      console.error('加载激活记录失败', err);
      // 竞态条件处理：检查是否是最新的请求

      if (this.data.requestId === currentRequestId) {
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    }
  },

  async loadExtensionList() {
    // 竞态条件处理：生成请求标识

    const currentRequestId = Date.now();
    this.setData({ requestId: currentRequestId });
    
    try {
      this.setData({ loading: true });
      const res = await request({
        url: '/packages/package-extensions',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          store_id: this.data.currentStore ? this.data.currentStore._id : ''
        }
      });
      
      // 竞态条件处理：检查是否是最新的请求

      if (this.data.requestId !== currentRequestId) {
        console.log('忽略过期的延长记录请求');
        return;
      }
      
      const data = res.data || {};
      const newList = (data.list || []).map(item => {
        const typeMap = { manual: '手动延长', holiday: '放假顺延', system: '系统延长' };
        return {
          ...item,
          typeLabel: typeMap[item.type] || item.type || '',
          created_at_display: item.created_at ? this.formatDateTime(item.created_at) : '-',
          original_expire_display: item.original_expire ? item.original_expire.split('T')[0] : '-',
          new_expire_display: item.new_expire ? item.new_expire.split('T')[0] : '-',
        };
      });
      
      // 分页处理：第一页替换数据，后续页面追加数据

      const extensionList = this.data.page === 1 ? newList : [...this.data.extensionList, ...newList];
      const hasMore = newList.length >= this.data.pageSize;
      
      this.setData({ 
        extensionList,
        hasMore,
        loading: false 
      });
    } catch (err) {
      console.error('加载延长记录失败', err);
      // 竞态条件处理：检查是否是最新的请求

      if (this.data.requestId === currentRequestId) {
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    }
  },

  async loadEntryList() {
    // 竞态条件处理：生成请求标识

    const currentRequestId = Date.now();
    this.setData({ requestId: currentRequestId });
    
    try {
      this.setData({ loading: true });
      const res = await request({
        url: '/packages/entry-records',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          store_id: this.data.currentStore ? this.data.currentStore._id : ''
        }
      });
      
      // 竞态条件处理：检查是否是最新的请求

      if (this.data.requestId !== currentRequestId) {
        console.log('忽略过期的录入记录请求');
        return;
      }
      
      const data = res.data || {};
      const newList = (data.list || []).map(item => {
        const statusMap = { active: '已激活', pending: '待激活', expired: '已过期', exhausted: '已用完' };
        const packageTypeMap = { count_card: '次卡', time_card: '时间卡' };
        let creditsText = '';
        if (item.package_type === 'count_card') {
          creditsText = `${item.total_credits}课时`;
        } else if (item.package_type === 'time_card') {
          const unitText = item.duration_unit === 'month' ? '个月' : '天';
          creditsText = `${item.duration_value}${unitText}`;
        }
        return {
          ...item,
          statusLabel: statusMap[item.status] || item.status,
          packageTypeLabel: packageTypeMap[item.package_type] || item.package_type,
          creditsText,
          created_at_display: item.created_at ? this.formatDateTime(item.created_at) : '-',
        };
      });
      
      // 分页处理：第一页替换数据，后续页面追加数据

      const entryList = this.data.page === 1 ? newList : [...this.data.entryList, ...newList];
      const hasMore = newList.length >= this.data.pageSize;
      
      this.setData({ 
        entryList,
        hasMore,
        loading: false 
      });
    } catch (err) {
      console.error('加载录入记录失败', err);
      // 竞态条件处理：检查是否是最新的请求

      if (this.data.requestId === currentRequestId) {
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    }
  },

  // 触底加载更多
  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) {
      return;
    }
    this.setData({
      page: this.data.page + 1
    }, () => {
      this.loadList();
    });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return formatDate(date, 'YYYY-MM-DD HH:mm');
  },

  getActivationType(type) {
    const typeMap = {
      manual: '手动激活',
      auto: '自动激活',
      booking: '预约激活'
    };
    return typeMap[type] || type;
  },

  getExtensionType(type) {
    const typeMap = {
      manual: '手动延长',
      holiday: '放假顺延',
      system: '系统延长'
    };
    return typeMap[type] || type;
  }
});