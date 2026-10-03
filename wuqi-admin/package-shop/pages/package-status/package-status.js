const { request } = require('../../../utils/request');
const { fixImageUrl } = require('../../../utils/util');
const app = getApp();

// 手机号脱敏：138****1234
function maskPhone(phone) {
  const s = String(phone || '');
  if (!s) return '';
  if (s.length >= 11) return s.slice(0, 3) + '****' + s.slice(-4);
  return s;
}

// 日期格式化：YYYY-MM-DD
function fmtDate(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// 各类别允许的提醒方式（二选一）
const MODE_ENUM = {
  time_card_expire: ['days', 'percent'],
  count_card_expire: ['days', 'percent'],
  count_card_low: ['count', 'percent'],
};

Page({
  data: {
    // 角色
    isSuperAdmin: false,
    // 门店
    showStoreSwitcher: false,
    storeList: [],
    currentStore: null,
    currentStoreName: '',
    // 加载态
    loading: true,
    // 阈值设置（默认收起，点击标题行展开）
    configExpanded: false,
    configSummary: '',
    // 阈值表单（字符串便于输入；mode 为二选一的提醒方式）
    configForm: null,
    configDirty: false,
    savingConfig: false,
    // 四类会员名单
    categories: [
      { key: 'time_card_expiring', title: '时间卡到期', unit: '人', list: [], expanded: false },
      { key: 'count_card_expiring', title: '次卡到期', unit: '人', list: [], expanded: false },
      { key: 'count_card_low', title: '次卡次数不足', unit: '人', list: [], expanded: false },
      { key: 'inactive_members', title: '久未跳舞', unit: '人', list: [], expanded: false },
    ],
  },

  onLoad() {
    const userInfo = app.globalData.userInfo || {};
    this.setData({ isSuperAdmin: userInfo.role === 'super_admin' });
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.initStore();
  },

  // 初始化门店（从全局店务管理门店同步；单门店角色固定所属门店）
  // 首次进入或门店变化时才重新加载数据，从会员详情页返回时不重置列表展开状态
  async initStore() {
    const prevStoreId = this._currentStoreId || '';

    // 单门店角色：固定所属门店，无切换器
    if (app.isSingleStoreRole()) {
      const defaultStoreId = app.getDefaultStoreId();
      let storeList = app.globalData.storeList || [];
      if (!storeList.length) {
        try {
          const res = await request({ url: '/stores', method: 'GET' });
          storeList = app.filterStoresForUser(res.data || []);
          app.globalData.storeList = storeList;
        } catch (err) {
          console.error('加载门店列表失败', err);
        }
      }
      const matched = storeList.find(s => String(s._id) === String(defaultStoreId)) || null;
      app.globalData.shopStoreId = defaultStoreId;
      this._currentStoreId = defaultStoreId;
      this.setData({
        showStoreSwitcher: false,
        storeList,
        currentStore: matched,
        currentStoreName: matched ? matched.name : '',
      });
      if (!this._initialized || prevStoreId !== defaultStoreId) {
        this._initialized = true;
        this.loadData(true);
      }
      return;
    }

    // 超管/审核员/多门店店长：显示切换器，优先全局门店，默认第一个
    let storeList = app.globalData.storeList || [];
    if (!storeList.length) {
      try {
        const res = await request({ url: '/stores', method: 'GET' });
        storeList = app.filterStoresForUser(res.data || []);
        app.globalData.storeList = storeList;
      } catch (err) {
        console.error('加载门店列表失败', err);
      }
    }
    const savedStoreId = app.globalData.shopStoreId || '';
    let currentStore = storeList.find(s => String(s._id) === String(savedStoreId)) || null;
    if (!currentStore && storeList.length > 0) currentStore = storeList[0];
    const newStoreId = currentStore ? String(currentStore._id) : '';
    if (currentStore) app.globalData.shopStoreId = newStoreId;
    this._currentStoreId = newStoreId;
    this.setData({
      showStoreSwitcher: storeList.length > 0,
      storeList,
      currentStore,
      currentStoreName: currentStore ? currentStore.name : '',
    });
    if (!this._initialized || prevStoreId !== newStoreId) {
      this._initialized = true;
      this.loadData(true);
    }
  },

  // 切换门店（重置展开状态）
  onStoreSwitcherTap() {
    if (!this.data.storeList.length) return;
    const items = this.data.storeList.map(s => s.name);
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const store = this.data.storeList[res.tapIndex];
        if (!store) return;
        if (String(store._id) === (this.data.currentStore && String(this.data.currentStore._id))) return;
        app.globalData.shopStoreId = String(store._id);
        this._currentStoreId = String(store._id);
        this.setData({
          currentStore: store,
          currentStoreName: store.name,
        });
        this.loadData(true);
      }
    });
  },

  // 加载四类会员名单 + 阈值配置
  // resetExpanded: 是否重置列表展开状态（切店/首次进入重置，刷新/保存阈值保留）
  async loadData(resetExpanded) {
    const storeId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    this.setData({ loading: true });
    try {
      const res = await request({
        url: '/stats/package-status',
        method: 'GET',
        data: storeId ? { store_id: storeId } : {},
      });
      const data = res.data || {};
      this.applyConfig(data.config || {});
      this.applyLists(data, resetExpanded);
    } catch (err) {
      console.error('加载会员套餐状态失败', err);
      this.setData({ loading: false });
    }
  },

  // 应用阈值配置到表单与摘要
  applyConfig(cfg) {
    const form = {
      time_card_expire: {
        mode: MODE_ENUM.time_card_expire.indexOf(cfg.time_card_expire && cfg.time_card_expire.mode) >= 0 ? cfg.time_card_expire.mode : 'days',
        days: String((cfg.time_card_expire && cfg.time_card_expire.days) || 0),
        percent: String((cfg.time_card_expire && cfg.time_card_expire.percent) || 0),
      },
      count_card_expire: {
        mode: MODE_ENUM.count_card_expire.indexOf(cfg.count_card_expire && cfg.count_card_expire.mode) >= 0 ? cfg.count_card_expire.mode : 'days',
        days: String((cfg.count_card_expire && cfg.count_card_expire.days) || 0),
        percent: String((cfg.count_card_expire && cfg.count_card_expire.percent) || 0),
      },
      count_card_low: {
        mode: MODE_ENUM.count_card_low.indexOf(cfg.count_card_low && cfg.count_card_low.mode) >= 0 ? cfg.count_card_low.mode : 'count',
        count: String((cfg.count_card_low && cfg.count_card_low.count) || 0),
        percent: String((cfg.count_card_low && cfg.count_card_low.percent) || 0),
      },
      inactive_days: {
        days: String((cfg.inactive_days && cfg.inactive_days.days) || 0),
      },
    };
    this.setData({
      configForm: form,
      configSummary: this.buildSummary(form),
      configDirty: false,
      loading: false,
    });
  },

  // 收起状态下的设置摘要（按二选一结果显示）
  buildSummary(f) {
    const tc = f.time_card_expire.mode === 'percent'
      ? '剩余' + f.time_card_expire.percent + '%提醒'
      : '前' + f.time_card_expire.days + '天提醒';
    const cc = f.count_card_expire.mode === 'percent'
      ? '剩余' + f.count_card_expire.percent + '%提醒'
      : '前' + f.count_card_expire.days + '天提醒';
    const cl = f.count_card_low.mode === 'percent'
      ? '占比' + f.count_card_low.percent + '%提醒'
      : '剩' + f.count_card_low.count + '次提醒';
    const ia = '超' + f.inactive_days.days + '天未上课';
    return '时间卡' + tc + ' · 次卡' + cc + ' · 次数' + cl + ' · ' + ia;
  },

  // 应用四类名单（映射为统一卡片结构；默认保留展开状态）
  applyLists(data, resetExpanded) {
    const mapCard = (m) => ({
      _id: String(m.user_id || '') + '_' + (m.package_name || '') + '_' + (m.end_date || m.last_attended || '') + '_' + Math.random().toString(36).slice(2, 6),
      member_id: m.user_id ? String(m.user_id) : '',
      user_name: m.user_name || '未知会员',
      avatar_char: (m.user_name || '会').charAt(0),
      avatar_url: fixImageUrl(m.avatar_url),
      phone: maskPhone(m.phone),
      package_name: m.package_name || (m.package_type === 'time_card' ? '时间卡' : '次卡'),
      package_type: m.package_type || '',
      store_name: m.store_name || '',
      remaining: m.remaining_credits || 0,
      total: m.total_credits || 0,
      days_left: typeof m.remaining_days === 'number' ? m.remaining_days : 0,
      end_date: fmtDate(m.end_date),
      last_attended: fmtDate(m.last_attended),
      days_since: typeof m.days_since === 'number' ? m.days_since : 0,
    });

    const categories = this.data.categories.map(c => {
      const raw = data[c.key] || [];
      return {
        ...c,
        list: raw.map(mapCard),
        expanded: resetExpanded ? false : c.expanded,
      };
    });
    this.setData({ categories, loading: false });
  },

  // ===== 阈值设置折叠/展开 =====
  onToggleConfig() {
    this.setData({ configExpanded: !this.data.configExpanded });
  },

  // 切换提醒方式（二选一）
  onModeTap(e) {
    const { section, mode } = e.currentTarget.dataset;
    if (!this.data.isSuperAdmin) return;
    const configForm = this.data.configForm;
    if (!configForm || !configForm[section]) return;
    if (configForm[section].mode === mode) return;
    const updated = {
      ...configForm,
      [section]: { ...configForm[section], mode },
    };
    this.setData({
      configForm: updated,
      configSummary: this.buildSummary(updated),
      configDirty: true,
    });
  },

  // 阈值输入
  onConfigInput(e) {
    const { section, field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const configForm = this.data.configForm;
    if (!configForm || !configForm[section]) return;
    const updated = {
      ...configForm,
      [section]: { ...configForm[section], [field]: value },
    };
    this.setData({
      configForm: updated,
      configSummary: this.buildSummary(updated),
      configDirty: true,
    });
  },

  // 保存阈值（仅超级管理员）
  async onSaveConfig() {
    if (!this.data.isSuperAdmin) {
      wx.showToast({ title: '仅超级管理员可修改', icon: 'none' });
      return;
    }
    if (this.data.savingConfig) return;
    const f = this.data.configForm;
    if (!f) return;

    const toInt = (v, label) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 100) {
        wx.showToast({ title: label + '需为0-100的整数', icon: 'none' });
        return null;
      }
      return n;
    };

    const body = {
      time_card_expire: {
        mode: f.time_card_expire.mode,
        days: toInt(f.time_card_expire.days, '时间卡到期天数'),
        percent: toInt(f.time_card_expire.percent, '时间卡提醒百分比'),
      },
      count_card_expire: {
        mode: f.count_card_expire.mode,
        days: toInt(f.count_card_expire.days, '次卡到期天数'),
        percent: toInt(f.count_card_expire.percent, '次卡提醒百分比'),
      },
      count_card_low: {
        mode: f.count_card_low.mode,
        count: toInt(f.count_card_low.count, '次卡次数阈值'),
        percent: toInt(f.count_card_low.percent, '次数占比阈值'),
      },
      inactive_days: {
        days: toInt(f.inactive_days.days, '久未跳舞天数'),
      },
    };
    if (body.time_card_expire.days === null || body.time_card_expire.percent === null) return;
    if (body.count_card_expire.days === null || body.count_card_expire.percent === null) return;
    if (body.count_card_low.count === null || body.count_card_low.percent === null) return;
    if (body.inactive_days.days === null) return;

    this.setData({ savingConfig: true });
    try {
      await request({
        url: '/stats/package-status-config',
        method: 'PUT',
        data: body,
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.applyConfig(body);
      // 阈值变化后名单口径随之变化，重新加载（保留当前展开状态）
      this.loadData(false);
    } catch (err) {
      console.error('保存提醒阈值失败', err);
    } finally {
      this.setData({ savingConfig: false });
    }
  },

  // ===== 四类名单展开/收起 =====
  onToggleCategory(e) {
    const key = e.currentTarget.dataset.key;
    const categories = this.data.categories.map(c => {
      if (c.key === key) return { ...c, expanded: !c.expanded };
      return c;
    });
    this.setData({ categories });
  },

  // 会员卡片点击 → 会员详情
  onMemberCardTap(e) {
    const memberId = e.currentTarget.dataset.memberId;
    if (!memberId) return;
    wx.navigateTo({
      url: '/package-member/pages/members/member-detail/member-detail?id=' + memberId,
    });
  },

  // 下拉刷新（保留展开状态）
  onPullDownRefresh() {
    this.loadData(false).then(() => wx.stopPullDownRefresh());
  },
});
