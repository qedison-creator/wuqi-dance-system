const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');

const PAGE_SIZE = 5;

// 无有效日期记录的兜底分组key（与后端保持一致）
const UNKNOWN_MONTH_KEY = '__unknown__';

// 各TAB的请求地址
const TAB_URL = {
  activation: '/packages/package-activations',
  extension: '/packages/package-extensions',
  entry: '/packages/entry-records'
};

// 列表去重辅助：合并已有列表与新列表，按 _id 去重（避免后端返回重复数据导致 wx:key 警告）
function mergeDedupeById(existingList, newList) {
  const result = [...(existingList || [])];
  const seen = new Set(result.map(i => String(i._id)));
  for (const item of newList || []) {
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
    // 年→月分组数据（由各TAB月份状态 + 全量月份统计派生）
    activationGroups: [],
    extensionGroups: [],
    entryGroups: [],
    // TAB初始化加载中
    loading: true,
    // 返回顶部按钮
    showBackToTop: false,
    backToTopThreshold: 0,
    // 各TAB的会员搜索关键字
    activationKeyword: '',
    extensionKeyword: '',
    entryKeyword: ''
  },

  onLoad(options) {
    // 月份展开态：key = `${tab}|${monthKey}`
    this._expandedState = {};
    // 各TAB全量月份统计（后端返回，用于渲染全部月份行 + 年/月行数字）
    this._monthCounts = { activation: {}, extension: {}, entry: {} };
    // 各TAB按年去重的会员数统计（{ 年份: 会员数 }，用于年份行"XX位"胶囊）
    this._yearMemberCounts = { activation: {}, extension: {}, entry: {} };
    // 各TAB各月份的分页状态：{ monthKey: { list, page, total, hasMore, loading, loaded } }
    this._monthState = { activation: {}, extension: {}, entry: {} };
    // 请求序号：TAB切换/重新搜索后丢弃过期的初始化响应
    this._requestSeq = 0;
    this._thresholdTimer = null;

    // 接收跳转参数：tab=指定初始TAB，keyword=会员搜索关键字
    if (options.tab) {
      this.setData({ activeTab: options.tab });
    }
    if (options.keyword) {
      const kw = decodeURIComponent(options.keyword);
      if (options.tab === 'extension') {
        this.setData({ extensionKeyword: kw });
      } else if (options.tab === 'entry') {
        this.setData({ entryKeyword: kw });
      } else {
        this.setData({ activationKeyword: kw });
      }
    }
  },

  async onShow() {
    if (!app.checkAuth()) return;
    this._resetScroll();
    this.setData({ loading: true });
    this._initTab(this.data.activeTab);
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this._resetTabState(tab);
    this._resetScroll();
    this.setData({ activeTab: tab, loading: true });
    this._initTab(tab);
  },

  // ========== 数据加载 ==========

  // 初始化TAB：拉取全量月份统计，默认展开并加载"本月"（无记录时最近一月）的数据
  async _initTab(tab) {
    const seq = ++this._requestSeq;
    const currentMonth = formatDate(new Date(), 'YYYY-MM');
    try {
      // 先请求本月（响应同时带全量月度统计）
      let data = await this._fetchMonth(tab, 1, currentMonth);
      if (seq !== this._requestSeq) return;

      this._monthCounts[tab] = data.monthCounts || {};
      this._yearMemberCounts[tab] = data.yearMemberCounts || {};
      const counts = this._monthCounts[tab];
      const monthKeys = this._sortMonthKeys(Object.keys(counts));
      if (monthKeys.length === 0) {
        const patch = { loading: false };
        patch[this._groupsFieldOfTab(tab)] = [];
        this.setData(patch);
        return;
      }

      // 默认展开月：本月（有记录时），否则最近一月
      const targetMonth = counts[currentMonth] !== undefined ? currentMonth : monthKeys[0];
      if (targetMonth !== currentMonth) {
        // 本月无记录：改拉最近一月
        data = await this._fetchMonth(tab, 1, targetMonth);
        if (seq !== this._requestSeq) return;
      }
      this._applyMonthData(tab, targetMonth, data, 1);
      this._expandedState[`${tab}|${targetMonth}`] = true;

      this._refreshGroups(tab);
      this.setData({ loading: false });
      this._scheduleThresholdCalc();
    } catch (err) {
      console.error('初始化套餐记录失败', err);
      if (seq === this._requestSeq) {
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    }
  },

  // 请求某月第page页数据（按会员分页，month筛选时仅返回该月发生的记录）
  async _fetchMonth(tab, page, monthKey) {
    const res = await request({
      url: TAB_URL[tab],
      method: 'GET',
      data: {
        page,
        pageSize: PAGE_SIZE,
        store_id: app.globalData.shopStoreId || '',
        keyword: this.data[`${tab}Keyword`] || '',
        month: monthKey
      }
    });
    return res.data || {};
  },

  // 将某月响应写入月份状态
  _applyMonthData(tab, monthKey, data, page) {
    const stateMap = this._monthState[tab];
    const prev = stateMap[monthKey] || { list: [] };
    const formatted = this._formatRecords(tab, data.list || []);
    const list = page === 1 ? formatted : mergeDedupeById(prev.list, formatted);
    const total = data.total || 0;
    stateMap[monthKey] = {
      list,
      page,
      total,
      hasMore: list.length < total,
      loading: false,
      loaded: true
    };
  },

  // 拉取某月数据（月份行首次展开 / 月份内"查看更多"共用）
  async _loadMonth(tab, monthKey, page) {
    const stateMap = this._monthState[tab];
    const state = stateMap[monthKey];
    if (state && state.loading) return;
    stateMap[monthKey] = {
      list: (state && state.list) || [],
      page: (state && state.page) || 0,
      total: (state && state.total) || 0,
      hasMore: state ? state.hasMore : true,
      loaded: state ? state.loaded : false,
      loading: true
    };
    this._refreshGroups(tab);
    try {
      const data = await this._fetchMonth(tab, page, monthKey);
      this._applyMonthData(tab, monthKey, data, page);
    } catch (err) {
      console.error('加载月份记录失败', err);
      const cur = this._monthState[tab][monthKey];
      if (cur) cur.loading = false;
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this._refreshGroups(tab);
    this._scheduleThresholdCalc();
  },

  // ========== 月份行交互 ==========

  // 展开/收起某个月份行；首次展开时自动加载该月数据
  onToggleMonthGroup(e) {
    const tab = e.currentTarget.dataset.tab;
    const monthKey = e.currentTarget.dataset.month;
    const willExpand = this._expandedState[`${tab}|${monthKey}`] !== true;
    this._expandedState[`${tab}|${monthKey}`] = willExpand;
    this._refreshGroups(tab);
    this._scheduleThresholdCalc();
    if (!willExpand || monthKey === UNKNOWN_MONTH_KEY) return;
    const state = (this._monthState[tab] || {})[monthKey];
    if (!state || !state.loaded) {
      this._loadMonth(tab, monthKey, 1);
    }
  },

  // 月份内"查看更多"：加载该月下一页会员
  onLoadMonthMore(e) {
    const tab = e.currentTarget.dataset.tab;
    const monthKey = e.currentTarget.dataset.month;
    const state = (this._monthState[tab] || {})[monthKey];
    if (!state || state.loading || !state.hasMore) return;
    this._loadMonth(tab, monthKey, state.page + 1);
  },

  // ========== 搜索相关 ==========
  onActivationKeywordInput(e) {
    this.setData({ activationKeyword: e.detail.value });
  },
  onActivationSearch() {
    this._searchTab('activation');
  },
  onActivationClearSearch() {
    this.setData({ activationKeyword: '' });
    this._searchTab('activation');
  },

  onExtensionKeywordInput(e) {
    this.setData({ extensionKeyword: e.detail.value });
  },
  onExtensionSearch() {
    this._searchTab('extension');
  },
  onExtensionClearSearch() {
    this.setData({ extensionKeyword: '' });
    this._searchTab('extension');
  },

  onEntryKeywordInput(e) {
    this.setData({ entryKeyword: e.detail.value });
  },
  onEntrySearch() {
    this._searchTab('entry');
  },
  onEntryClearSearch() {
    this.setData({ entryKeyword: '' });
    this._searchTab('entry');
  },

  _searchTab(tab) {
    if (this.data.loading) return;
    this._resetTabState(tab);
    this._resetScroll();
    this.setData({ loading: true });
    this._initTab(tab);
  },

  // ========== 状态辅助 ==========

  _resetScroll() {
    this.setData({ showBackToTop: false, backToTopThreshold: 0 });
  },

  // 清空某TAB的月份分页状态与展开态（切换TAB/重新搜索时）
  _resetTabState(tab) {
    this._monthState[tab] = {};
    const prefix = `${tab}|`;
    Object.keys(this._expandedState).forEach(k => {
      if (k.indexOf(prefix) === 0) delete this._expandedState[k];
    });
  },

  _groupsFieldOfTab(tab) {
    if (tab === 'activation') return 'activationGroups';
    if (tab === 'extension') return 'extensionGroups';
    return 'entryGroups';
  },

  // 月份key倒序排列（时间未知置末）
  _sortMonthKeys(keys) {
    return (keys || []).slice().sort((a, b) => {
      if (a === UNKNOWN_MONTH_KEY) return 1;
      if (b === UNKNOWN_MONTH_KEY) return -1;
      return b.localeCompare(a);
    });
  },

  // 重建并渲染指定TAB的年→月分组
  _refreshGroups(tab) {
    const patch = {};
    patch[this._groupsFieldOfTab(tab)] = this._buildGroups(tab);
    this.setData(patch);
  },

  // 年→月分组：
  // - 月份行集合 = 后端全量月份统计（有记录的月份都会生成月份行）
  // - 月份行/年份行数字 = 该时间段发生的全部记录数（全量口径，不受分页影响）
  // - 月份行内容 = 该月按会员分页加载的记录卡片，月份内独立"查看更多"
  _buildGroups(tab) {
    const counts = this._monthCounts[tab] || {};
    const stateMap = this._monthState[tab] || {};
    const currentMonthKey = formatDate(new Date(), 'YYYY-MM');
    const currentYear = currentMonthKey.slice(0, 4);

    // 月份集合 = 全量统计月份 ∪ 已加载月份（兜底）
    const keySet = new Set(Object.keys(counts).concat(Object.keys(stateMap)));
    const monthKeys = this._sortMonthKeys(Array.from(keySet));

    const yearMap = {};
    monthKeys.forEach(monthKey => {
      const isUnknown = monthKey === UNKNOWN_MONTH_KEY;
      const y = isUnknown ? UNKNOWN_MONTH_KEY : monthKey.slice(0, 4);
      const m = isUnknown ? 0 : Number(monthKey.slice(5, 7));
      const isCurrent = !isUnknown && monthKey === currentMonthKey;
      const monthLabel = isUnknown ? '时间未知' : ((y === currentYear) ? `${m}月` : `${y}年${m}月`);
      if (!yearMap[y]) {
        yearMap[y] = { year: y, yearLabel: isUnknown ? '时间未知' : `${y}年`, totalCount: 0, months: [] };
      }
      const state = stateMap[monthKey];
      const cards = ((state && state.list) || []).map(card => ({
        ...card,
        monthRecordCount: (card.records || []).length
      }));
      const stat = counts[monthKey];
      // 月份行数字 = 全量统计（后端未返回时回退到已加载数）；兼容旧纯数字格式
      const monthCount = stat === undefined ? cards.length : (typeof stat === 'number' ? stat : (stat.count || 0));
      const monthMemberCount = stat && typeof stat === 'object' ? (stat.memberCount || 0) : 0;
      yearMap[y].months.push({
        monthKey,
        monthLabel,
        isCurrent,
        expanded: this._expandedState[`${tab}|${monthKey}`] === true,
        count: monthCount,
        // 该月发生记录的去重会员数
        memberCount: monthMemberCount,
        cards,
        // 该月独立的分页状态
        monthLoading: !!(state && state.loading),
        hasMore: !!(state && state.hasMore),
        remainCount: state ? Math.max(0, (state.total || 0) - cards.length) : 0
      });
    });

    const yearMemberCounts = this._yearMemberCounts[tab] || {};
    return this._sortMonthKeys(Object.keys(yearMap)).map(y => {
      const g = yearMap[y];
      g.totalCount = g.months.reduce((sum, mo) => sum + mo.count, 0);
      // 年份行会员数 = 按年去重统计（后端 yearMemberCounts）
      g.memberCount = yearMemberCounts[y] || 0;
      return g;
    });
  },

  // 各TAB的会员卡片记录格式化
  _formatRecords(tab, list) {
    if (tab === 'activation') {
      const typeMap = { manual: '手动激活', auto: '自动激活', booking: '预约激活', default: '默认激活' };
      return (list || []).map(item => ({
        ...item,
        records: (item.records || []).map(record => ({
          ...record,
          typeLabel: typeMap[record.type] || record.type || '',
          activated_at_display: record.activated_at ? this.formatDateTime(record.activated_at) : '-',
          effective_date_display: record.effective_date ? String(record.effective_date).split('T')[0] : '-',
          expire_date_display: record.expire_date ? String(record.expire_date).split('T')[0] : '-'
        }))
      }));
    }
    if (tab === 'extension') {
      const typeMap = { manual: '手动延长', holiday: '放假顺延', system: '系统延长' };
      const packageTypeMap = { count_card: '次卡', time_card: '时间卡' };
      return (list || []).map(item => ({
        ...item,
        records: (item.records || []).map(record => {
          const unitText = record.extend_unit === 'month' ? '月' : '天';
          const extendValue = record.extend_value || record.extend_days || 0;
          return {
            ...record,
            typeLabel: typeMap[record.type] || record.type || '',
            packageTypeLabel: packageTypeMap[record.package_type] || record.package_type || '',
            created_at_display: record.created_at ? this.formatDateTime(record.created_at) : '-',
            original_expire_display: record.original_expire ? String(record.original_expire).split('T')[0] : '-',
            new_expire_display: record.new_expire ? String(record.new_expire).split('T')[0] : '-',
            extend_value_text: `+${extendValue}${unitText}`
          };
        })
      }));
    }
    // entry
    const packageTypeMap = { count_card: '次卡', time_card: '时间卡' };
    return (list || []).map(item => ({
      ...item,
      records: (item.records || []).map(record => {
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
          created_at_display: record.created_at ? this.formatDateTime(record.created_at) : '-'
        };
      })
    }));
  },

  // ========== 返回顶部 ==========
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

  // 列表渲染完成后延迟测量返回顶部阈值（≥10条时以第10条底部为准）
  _scheduleThresholdCalc() {
    if (this._thresholdTimer) clearTimeout(this._thresholdTimer);
    this._thresholdTimer = setTimeout(() => {
      this._calcBackToTopThreshold();
    }, 300);
  },

  _calcBackToTopThreshold() {
    const query = wx.createSelectorQuery().in(this);
    query.selectAll('.logs-list .log-item').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const cards = res[0];
      const scrollOffset = res[1];
      if (!cards || !scrollOffset) return;
      if (cards.length < 10) {
        // 列表不足10条：不显示返回顶部按钮
        if (this.data.backToTopThreshold !== 0) {
          this.setData({ backToTopThreshold: 0, showBackToTop: false });
        }
        return;
      }
      this.setData({
        backToTopThreshold: scrollOffset.scrollTop + cards[9].bottom
      });
    });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return formatDate(date, 'YYYY-MM-DD HH:mm');
  }
});
