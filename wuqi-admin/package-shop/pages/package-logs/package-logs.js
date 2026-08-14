const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');

const PAGE_SIZE = 5;

// 列表去重辅助：合并已有列表与新列表，按 _id 去重（避免后端返回重复数据导致 wx:key 警告）
// isFirstPage=true 时直接返回 newList 内部去重结果；否则合并去重
function mergeDedupeById(existingList, newList, isFirstPage) {
  const result = isFirstPage ? [] : [...existingList];
  const seen = new Set(result.map(i => String(i._id)));
  for (const item of newList) {
    const id = String(item._id);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(item);
    }
  }
  return result;
}

Page({
  data: {
    activeTab: 'activation',
    activationList: [],
    extensionList: [],
    entryList: [],
    loading: true,
    page: 1,
    pageSize: PAGE_SIZE,
    hasMore: true,
    currentTotal: 0,
    visibleCount: PAGE_SIZE,
    requestId: 0,
    // 返回顶部按钮
    showBackToTop: false,
    backToTopThreshold: 0,
    // 各TAB的会员搜索关键字
    activationKeyword: '',
    extensionKeyword: '',
    entryKeyword: ''
  },

  onLoad(options) {
    // 接收跳转参数：tab=指定初始TAB，keyword=会员搜索关键字
    if (options.tab) {
      this.setData({ activeTab: options.tab });
    }
    if (options.keyword) {
      const kw = decodeURIComponent(options.keyword);
      if (options.tab === 'extension') {
        this.setData({ extensionKeyword: kw });
      } else if (options.tab === 'activation') {
        this.setData({ activationKeyword: kw });
      } else if (options.tab === 'entry') {
        this.setData({ entryKeyword: kw });
      } else {
        this.setData({ activationKeyword: kw });
      }
    }
  },

  async onShow() {
    if (!app.checkAuth()) return;
    this.setData({ loading: true, page: 1, hasMore: true, visibleCount: PAGE_SIZE, currentTotal: 0, showBackToTop: false, backToTopThreshold: 0 });
    this.loadList();
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      activeTab: tab,
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0
    });
    this.loadList();
  },

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

  // 获取当前tab对应的列表
  _getCurrentList() {
    const tab = this.data.activeTab;
    if (tab === 'activation') return this.data.activationList;
    if (tab === 'extension') return this.data.extensionList;
    return this.data.entryList;
  },

  // 点击"查看更多"加载下一页
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    const nextPage = this.data.page + 1;
    this.setData({ page: nextPage });
    this.loadList();
  },

  // ========== 搜索相关 ==========
  onActivationKeywordInput(e) {
    this.setData({ activationKeyword: e.detail.value });
  },
  onActivationSearch() {
    if (this.data.loading) return;
    this.setData({
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      activationList: []
    });
    this.loadActivationList();
  },
  onActivationClearSearch() {
    if (this.data.loading) return;
    this.setData({
      activationKeyword: '',
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      activationList: []
    });
    this.loadActivationList();
  },

  onExtensionKeywordInput(e) {
    this.setData({ extensionKeyword: e.detail.value });
  },
  onExtensionSearch() {
    if (this.data.loading) return;
    this.setData({
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      extensionList: []
    });
    this.loadExtensionList();
  },
  onExtensionClearSearch() {
    if (this.data.loading) return;
    this.setData({
      extensionKeyword: '',
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      extensionList: []
    });
    this.loadExtensionList();
  },

  onEntryKeywordInput(e) {
    this.setData({ entryKeyword: e.detail.value });
  },
  onEntrySearch() {
    if (this.data.loading) return;
    this.setData({
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      entryList: []
    });
    this.loadEntryList();
  },
  onEntryClearSearch() {
    if (this.data.loading) return;
    this.setData({
      entryKeyword: '',
      loading: true,
      page: 1,
      hasMore: true,
      visibleCount: PAGE_SIZE,
      currentTotal: 0,
      showBackToTop: false,
      backToTopThreshold: 0,
      entryList: []
    });
    this.loadEntryList();
  },

  async loadActivationList() {
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
          store_id: app.globalData.shopStoreId || '',
          keyword: this.data.activationKeyword || ''
        }
      });

      if (this.data.requestId !== currentRequestId) return;

      const data = res.data || {};
      const typeMap = { manual: '手动激活', auto: '自动激活', booking: '预约激活', default: '默认激活' };
      const newList = (data.list || []).map(item => {
        // 对内层 records 数组中的每条记录做字段格式化
        const records = (item.records || []).map(record => ({
          ...record,
          typeLabel: typeMap[record.type] || record.type || '',
          activated_at_display: record.activated_at ? this.formatDateTime(record.activated_at) : '-',
          effective_date_display: record.effective_date ? record.effective_date.split('T')[0] : '-',
          expire_date_display: record.expire_date ? record.expire_date.split('T')[0] : '-',
        }));
        return {
          ...item,
          records,
        };
      });

      const activationList = mergeDedupeById(this.data.activationList, newList, this.data.page === 1);
      const total = data.total || 0;
      const hasMore = activationList.length < total;
      const visibleCount = Math.min(activationList.length, this.data.page * this.data.pageSize);

      this.setData({
        activationList,
        hasMore,
        currentTotal: total,
        visibleCount,
        loading: false,
        showBackToTop: false
      }, () => {
        if (activationList.length >= 5) this._calcBackToTopThreshold();
      });
    } catch (err) {
      console.error('加载激活记录失败', err);
      if (this.data.requestId === currentRequestId) {
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    }
  },

  async loadExtensionList() {
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
          store_id: app.globalData.shopStoreId || '',
          keyword: this.data.extensionKeyword || ''
        }
      });

      if (this.data.requestId !== currentRequestId) return;

      const data = res.data || {};
      const typeMap = { manual: '手动延长', holiday: '放假顺延', system: '系统延长' };
      const packageTypeMap = { count_card: '次卡', time_card: '时间卡' };
      const newList = (data.list || []).map(item => {
        // 对内层 records 数组中的每条记录做字段格式化
        const records = (item.records || []).map(record => {
          const unitText = record.extend_unit === 'month' ? '月' : '天';
          const extendValue = record.extend_value || record.extend_days || 0;
          return {
            ...record,
            typeLabel: typeMap[record.type] || record.type || '',
            packageTypeLabel: packageTypeMap[record.package_type] || record.package_type || '',
            created_at_display: record.created_at ? this.formatDateTime(record.created_at) : '-',
            original_expire_display: record.original_expire ? record.original_expire.split('T')[0] : '-',
            new_expire_display: record.new_expire ? record.new_expire.split('T')[0] : '-',
            extend_value_text: `+${extendValue}${unitText}`,
          };
        });
        return {
          ...item,
          records,
        };
      });

      const extensionList = mergeDedupeById(this.data.extensionList, newList, this.data.page === 1);
      const total = data.total || 0;
      const hasMore = extensionList.length < total;
      const visibleCount = Math.min(extensionList.length, this.data.page * this.data.pageSize);

      this.setData({
        extensionList,
        hasMore,
        currentTotal: total,
        visibleCount,
        loading: false,
        showBackToTop: false
      }, () => {
        if (extensionList.length >= 5) this._calcBackToTopThreshold();
      });
    } catch (err) {
      console.error('加载延长记录失败', err);
      if (this.data.requestId === currentRequestId) {
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    }
  },

  async loadEntryList() {
    const currentRequestId = Date.now();
    this.setData({ requestId: currentRequestId });

    // 安全兜底：3秒后如果 loading 仍未重置，强制重置
    const safetyTimer = setTimeout(() => {
      if (this.data.requestId === currentRequestId && this.data.loading) {
        console.warn('[loadEntryList] 安全兜底：强制重置 loading');
        this.setData({ loading: false });
      }
    }, 3000);

    try {
      this.setData({ loading: true });
      const res = await request({
        url: '/packages/entry-records',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          store_id: app.globalData.shopStoreId || '',
          keyword: this.data.entryKeyword || ''
        }
      });

      clearTimeout(safetyTimer);
      if (this.data.requestId !== currentRequestId) return;

      const data = res.data || {};
      const packageTypeMap = { count_card: '次卡', time_card: '时间卡' };
      const newList = (data.list || []).map(item => {
        // 对内层 records 数组中的每条记录做字段格式化
        const records = (item.records || []).map(record => {
          let creditsText = '';
          if (record.package_type === 'count_card') {
            creditsText = `${record.total_credits}课时`;
          } else if (record.package_type === 'time_card') {
            const unitText = record.duration_unit === 'month' ? '个月' : '天';
            creditsText = `${record.duration_value}${unitText}`;
          }
          return {
            ...record,
            packageTypeLabel: packageTypeMap[record.package_type] || record.package_type,
            creditsText,
            created_at_display: record.created_at ? this.formatDateTime(record.created_at) : '-',
          };
        });
        return {
          ...item,
          records,
        };
      });

      const entryList = mergeDedupeById(this.data.entryList, newList, this.data.page === 1);
      const total = data.total || 0;
      const hasMore = entryList.length < total;
      const visibleCount = Math.min(entryList.length, this.data.page * this.data.pageSize);

      this.setData({
        entryList,
        hasMore,
        currentTotal: total,
        visibleCount,
        loading: false,
        showBackToTop: false
      }, () => {
        if (entryList.length >= 5) this._calcBackToTopThreshold();
      });
    } catch (err) {
      clearTimeout(safetyTimer);
      console.error('加载录入记录失败', err);
      if (this.data.requestId === currentRequestId) {
        this.setData({ loading: false });
      }
    }
  },

  // 不再自动触底加载，改为手动点击"查看更多"
  onReachBottom() {},

  // 返回顶部
  onBackToTop() {
    this.setData({ showBackToTop: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  // 滚动监听，控制返回顶部按钮显隐
  onPageScroll(e) {
    const threshold = this.data.backToTopThreshold;
    const shouldShow = threshold > 0 && e.scrollTop > threshold;
    if (shouldShow !== this.data.showBackToTop) {
      this.setData({ showBackToTop: shouldShow });
    }
  },

  // 计算第5条记录底部位置，作为返回顶部按钮显示阈值
  _calcBackToTopThreshold() {
    const query = wx.createSelectorQuery().in(this);
    query.selectAll('.logs-list .log-item').boundingClientRect();
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

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return formatDate(date, 'YYYY-MM-DD HH:mm');
  }
});
