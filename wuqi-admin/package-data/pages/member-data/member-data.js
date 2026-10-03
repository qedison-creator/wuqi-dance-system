const app = getApp();
const wsClient = require('../../../utils/websocket-client');
const { request } = require('../../../utils/request');

const PERIODS = ['today', 'week', 'month', 'lastWeek', 'lastMonth', 'custom'];
const PERIOD_LABELS = { today: '今日', week: '本周', month: '本月', lastWeek: '上周', lastMonth: '上月', custom: '自定义' };
const ALERT_META = [
  { key: 'expiring', label: '30天内到期', icon: '⏳' },
  { key: 'low_credits', label: '次数不足', icon: '⚡' },
  { key: 'dormant', label: '很久没来', icon: '💤' },
];
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    role: '',
    storeId: '',
    period: 'today',
    customVisible: false,
    customStart: '',
    customEnd: '',
    activeTab: 'overview', // overview | rank | bill
    // 总览
    overview: null,
    trend: null,
    trendChart: null,
    // 提醒
    reminders: null,
    alertMeta: [],
    alertPanelType: '',
    alertViewDone: false,
    alertList: [],
    // 排行与热度
    rankTab: 'consume',
    consumeRank: [],
    cancelRank: [],
    hotCourses: [],
    courseChart: null,
    hotCoaches: [],
    coachChart: null,
    fillRates: [],
    // 账单
    billView: 'member',
    billSearch: '',
    billMembers: [],
    billByDate: [],
    billTotals: null,
    billLoading: false,
  },

  onLoad() {
    const userInfo = app.globalData.userInfo || {};
    // 门店取值：跟随店务管理页的门店切换（空 = 全部门店），单店角色兜底所属门店
    const storeId = app.getShopStoreId() || app.getDefaultStoreId() || '';
    this.setData({ role: userInfo.role || '', storeId });
    // 延迟到页面 mount 完成后再加载数据和连接 WebSocket，避免基础库 3.17.x routeDone 竞态错误
    setTimeout(() => {
      this.loadAll();
      this._connectWebSocket();
    }, 0);
  },

  onShow() {
    // 从店务页切回时门店可能已切换
    const storeId = app.getShopStoreId() || app.getDefaultStoreId() || '';
    if (this._inited && storeId !== this.data.storeId) {
      this.setData({ storeId });
      this.loadAll();
    } else if (this._stale) {
      this._stale = false;
      this.loadAll();
    }
    this._inited = true;
  },

  onHide() {
    // 页面切后台时标记过期，回前台强制刷新一次（WS 期间的推送不再回放）
    this._stale = true;
  },

  onUnload() {
    this._disconnectWebSocket();
  },

  onPullDownRefresh() {
    this.loadAll();
    wx.stopPullDownRefresh();
  },

  // ---- 数据加载 ----
  loadAll() {
    const base = { store_id: this.data.storeId || undefined };
    this.loadOverview(base);
    this.loadTrend(base);
    if (this.data.role !== 'reviewer') {
      this.loadReminders(base);
      this.loadRanks(base);
      this.loadHot(base);
      this.loadBill(base);
    }
  },

  loadOverview(base) {
    return request({ url: '/datacenter/overview', data: { ...base, period: this.data.period } }).then(res => {
      this.setData({ overview: res.data });
    }).catch(() => {});
  },

  loadTrend(base) {
    return request({ url: '/datacenter/trend', data: { ...base, period: this.data.period } }).then(res => {
      const d = res.data || {};
      const days = d.days || [];
      // 数据点过多时抽稀显示，避免柱状图 x 轴日期标签挤压重叠导致不可读
      let viewDays = days;
      if (days.length > 14) {
        const step = Math.ceil(days.length / 14);
        viewDays = days.filter((_, i) => i % step === 0);
        // 抽稀后保留最大峰值点，避免柱状图与“最热一天”文案不一致
        let maxIdx = 0;
        days.forEach((x, i) => { if (x.credits > days[maxIdx].credits) maxIdx = i; });
        const hasMax = viewDays.some(x => x === days[maxIdx]);
        if (!hasMax) viewDays.push(days[maxIdx]);
        // 兜底：抽稀可能漏掉最大日期，补回最后一个点保证覆盖完整区间
        const last = days[days.length - 1];
        if (viewDays[viewDays.length - 1] !== last) viewDays.push(last);
        // 保持时间顺序
        viewDays.sort((a, b) => a.date < b.date ? -1 : 1);
      }
      const trendChart = viewDays.length ? {
        chartId: 'trendChart', type: 'column',
        // X 轴只显示“日”（如 23），月份单独在图表标题旁显示，避免日期文字拥挤
        categories: viewDays.map(x => x.date.slice(8)),
        series: [{ name: '消耗课时', data: viewDays.map(x => x.credits) }],
        monthLabel: viewDays[0].date.slice(0, 7).replace('-', '年') + '月',
      } : null;
      this.setData({ trend: d, trendChart });
    }).catch(() => {});
  },

  loadReminders(base) {
    return request({ url: '/datacenter/reminders', data: base }).then(res => {
      const d = res.data || {};
      const groups = d.groups || {};
      const alertMeta = ALERT_META.map(m => {
        const items = groups[m.key] || [];
        return { ...m, pending: items.filter(x => !x.followup_done).length };
      });
      this.setData({ reminders: d, alertMeta, activeAlertType: '', alertViewDone: false, alertList: [] });
    }).catch(() => {});
  },

  loadRanks(base) {
    return request({ url: '/datacenter/member-rank', data: { ...base, period: this.data.period } }).then(res => {
      const d = res.data || {};
      const withGo = (rows) => rows.map(x => ({ ...x, go: `/package-member/pages/members/member-detail/member-detail?id=${x.member_id}` }));
      this.setData({ consumeRank: withGo(d.consume_top || []), cancelRank: withGo(d.cancel_top || []) });
    }).catch(() => {});
  },

  loadHot(base) {
    const courseReq = request({ url: '/datacenter/hot-courses', data: { ...base, period: this.data.period } }).then(res => {
      const list = (res.data && res.data.list) || [];
      const courseChart = list.length ? {
        chartId: 'courseChart', type: 'bar',
        categories: list.map(x => x.name),
        series: [{ name: '消耗课时', data: list.map(x => x.credits) }],
      } : null;
      this.setData({ hotCourses: list, courseChart });
    }).catch(() => {});
    const coachReq = request({ url: '/datacenter/hot-coaches', data: { ...base, period: this.data.period } }).then(res => {
      const list = (res.data && res.data.list) || [];
      const coachChart = list.length ? {
        chartId: 'coachChart', type: 'bar',
        categories: list.map(x => x.name),
        series: [{ name: '到课人次', data: list.map(x => x.visits) }],
      } : null;
      this.setData({ hotCoaches: list, coachChart });
    }).catch(() => {});
    return Promise.all([courseReq, coachReq]);
  },

  loadBill(base) {
    if (this.data.billLoading) return Promise.resolve();
    this.setData({ billLoading: true });
    const params = { ...base, start_date: this.data.periodStart || undefined, end_date: this.data.periodEnd || undefined };
    if (this.data.billSearch) params.search = this.data.billSearch;
    return request({ url: '/datacenter/member-bill', data: params }).then(res => {
      const d = res.data || {};
      const WEEKD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const billMembers = (d.members || []).map(m => ({
        ...m,
        bills: (m.bills || []).map(b => ({ ...b, weekday: WEEKD[new Date(b.date.replace(/-/g, '/')).getDay()] })),
      }));
      const billByDate = (d.by_date || []).map(g => ({ ...g, weekday: WEEKD[new Date(g.date.replace(/-/g, '/')).getDay()] }));
      this.setData({ billMembers, billByDate, billTotals: { credits: d.total_credits, sessions: d.total_sessions }, billLoading: false });
    }).catch(() => {
      this.setData({ billLoading: false });
    });
  },

  // ---- 时间切换 ----
  onPeriodTap(e) {
    const period = e.currentTarget.dataset.period;
    if (period === 'custom') {
      this.setData({ customVisible: !this.data.customVisible });
      return;
    }
    this.setData({ period, customVisible: false });
    this.loadAll();
  },

  onCustomStart(e) { this.setData({ customStart: e.detail.value }); },
  onCustomEnd(e) { this.setData({ customEnd: e.detail.value }); },
  onCustomApply() {
    if (!this.data.customStart || !this.data.customEnd) {
      wx.showToast({ title: '选好起止日期', icon: 'none' });
      return;
    }
    this.setData({ period: 'custom' });
    this.loadAll();
  },

  // ---- Tab ----
  onTabChange(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  // ---- 提醒 ----
  onAlertGroupTap(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.alertPanelType === key) {
      this.setData({ alertPanelType: '', alertList: [] });
      return;
    }
    const meta = (this.data.alertMeta || []).find(m => m.key === key);
    this.setData({ alertPanelType: key, alertPanelLabel: (meta && meta.label) || key, alertViewDone: false });
    this._fillAlertList();
  },

  closeAlertPanel() {
    this.setData({ alertPanelType: '', alertList: [] });
  },

  noop() {},

  // 全站会员姓名点击 → 会员详情页
  onGoMember(e) {
    const go = e.currentTarget.dataset.go;
    if (go) wx.navigateTo({ url: go });
  },

  onAlertViewToggle(e) {
    this.setData({ alertViewDone: e.currentTarget.dataset.done === '1' });
    this._fillAlertList();
  },

  _fillAlertList() {
    const groups = (this.data.reminders && this.data.reminders.groups) || {};
    const items = groups[this.data.alertPanelType] || [];
    this.setData({ alertList: items.filter(x => !!x.followup_done === this.data.alertViewDone) });
  },

  onMarkDone(e) {
    const { memberid, alerttype, periodkey } = e.currentTarget.dataset;
    request({
      url: '/datacenter/reminders/followup', method: 'POST',
      data: { member_id: memberid, alert_type: alerttype, period_key: periodkey, store_id: this.data.storeId || undefined },
    }).then(() => {
      wx.showToast({ title: '已标记', icon: 'success' });
      this.loadReminders({ store_id: this.data.storeId || undefined });
    }).catch(err => {
      if (!err._handled) wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  onUndoDone(e) {
    const { memberid, alerttype, periodkey } = e.currentTarget.dataset;
    request({
      url: `/datacenter/reminders/followup?member_id=${memberid}&alert_type=${alerttype}&period_key=${periodkey}`,
      method: 'DELETE',
    }).then(() => {
      wx.showToast({ title: '已恢复提醒', icon: 'success' });
      this.loadReminders({ store_id: this.data.storeId || undefined });
    }).catch(err => {
      if (!err._handled) wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  // ---- 排行双榜 ----
  onRankTabChange(e) {
    this.setData({ rankTab: e.currentTarget.dataset.r });
  },

  // ---- 账单 ----
  onBillViewChange(e) {
    this.setData({ billView: e.currentTarget.dataset.view });
  },

  onBillSearchInput(e) { this.setData({ billSearch: e.detail.value }); },

  onBillSearch() {
    this.loadBill({});
  },

  loadBill(base) {
    if (this.data.billLoading) return Promise.resolve();
    this.setData({ billLoading: true });
    // 账单跟随时间切换：传 period，自定义时传起止日期（不传 undefined 字面量）
    const params = { ...base, period: this.data.period };
    if (this.data.period === 'custom') {
      params.start_date = this.data.customStart;
      params.end_date = this.data.customEnd;
    }
    if (this.data.billSearch) params.search = this.data.billSearch;
    return request({ url: '/datacenter/member-bill', data: params }).then(res => {
      const d = res.data || {};
      const WEEKD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const billMembers = (d.members || []).map(m => ({
        ...m,
        bills: (m.bills || []).map(b => ({ ...b, weekday: WEEKD[new Date(b.date.replace(/-/g, '/')).getDay()] })),
      }));
      const billByDate = (d.by_date || []).map(g => ({ ...g, weekday: WEEKD[new Date(g.date.replace(/-/g, '/')).getDay()] }));
      this.setData({ billMembers, billByDate, billTotals: { credits: d.total_credits, sessions: d.total_sessions }, billLoading: false });
    }).catch(() => {
      this.setData({ billLoading: false });
    });
  },

  onBillMemberTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `billMembers[${idx}].expanded`;
    this.setData({ [key]: !this.data.billMembers[idx].expanded });
  },

  // ---- WebSocket 即时刷新 ----
  // 不自行 connect（dashboard 已持有全局连接）：注册页面级处理器，注销于 onUnload
  _connectWebSocket() {
    wsClient.registerHandlers('datacenter', {
      // 会员签到消课（扫码/自动/现场/管理员）
      consume_create: () => this._onLiveUpdate(),
      datacenter_update: () => this._onLiveUpdate(),
      // 预约/取消（既有事件）
      booking_create: () => this._onLiveUpdate(),
      booking_cancel: () => this._onLiveUpdate(),
    });
  },

  _disconnectWebSocket() {
    wsClient.unregisterHandlers('datacenter');
  },

  _onLiveUpdate() {
    // 正在查看弹层/账单时只标记过期，关闭后刷新；否则平滑刷新总览与当前 Tab
    if (this.data.alertPanelType) {
      this._stale = true;
      return;
    }
    this.loadOverview({ store_id: this.data.storeId || undefined });
    if (this.data.activeTab === 'rank') this.loadRanks({ store_id: this.data.storeId || undefined });
    if (this.data.activeTab === 'bill') this.loadBill({ store_id: this.data.storeId || undefined });
    wx.showToast({ title: '数据已更新', icon: 'none', duration: 800 });
  },
});
