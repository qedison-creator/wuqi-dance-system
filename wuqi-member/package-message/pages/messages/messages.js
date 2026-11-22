const { request } = require('../../../utils/request');
const skin = require('../../../utils/skin');
const wsClient = require('../../../utils/websocket-client');

const PAGE_SIZE = 20;
// 公告重要性配色：一般灰 / 重要红 / 永久墨
const ANNOUNCE_IMPORTANCE_COLOR = {
  important: '#C74A3C',
  always: '#2A2118'
};

Page({
  data: {
    skinId: 'classic',
    t: {},
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    refresherTriggered: false,
    category: 'all',        // all / reminder / notice / announcement
    categories: [
      { key: 'all', label: '全部' },
      { key: 'reminder', label: '提醒' },
      { key: 'notice', label: '通知' },
      { key: 'announcement', label: '公告' }
    ],
    unreadCount: 0,
    expandedId: '',
    // 一键已读按钮文案：classic「全部已读」/ paper「全部启阅」/ volt「全部已读」
    markAllText: '全部已读'
  },

  onLoad() {
    const sid = skin.getSkinId();
    this.setData({
      skinId: sid,
      t: skin.SKINS[sid].t,
      markAllText: sid === 'paper' ? '全部启阅' : '全部已读'
    });
    this.fetchList(true);
  },

  onShow() {
    // 皮肤可能在消息页停留期间被其他页切换（如回首页切换），onShow 对齐
    const sid = skin.getSkinId();
    if (sid !== this.data.skinId) {
      this.setData({
        skinId: sid,
        t: skin.SKINS[sid].t,
        markAllText: sid === 'paper' ? '全部启阅' : '全部已读'
      });
    }
    skin.pageState();
    this.fetchList(true);
    // WebSocket：新站内信实时刷新列表（连接失败静默，已有下拉刷新兜底）
    this._connectWS();
  },

  // 新站内信 WS 实时推送：有人收到候补/审核/提醒/公告消息时本页实时刷新
  _connectWS() {
    if (this._msgWsConnected) return;
    try {
      this._msgWsConnected = true;
      wsClient.connect({
        onMessage: {
          message_update: () => {
            this.fetchList(true);
          }
        }
      });
    } catch (err) {
      this._msgWsConnected = false;
    }
  },

  // 拉取列表；reset=true 时回到第一页
  async fetchList(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page + 1;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });
    try {
      const res = await request({
        url: `/messages?page=${page}&pageSize=${PAGE_SIZE}&category=${this.data.category}`,
        method: 'GET',
        silent: true
      });
      const data = res.data || {};
      const items = (data.list || []).map(m => this.decorate(m));
      let list;
      if (reset) {
        list = this.pinAlwaysAnnouncement(items);
      } else {
        list = this.pinAlwaysAnnouncement(this.data.list.concat(items));
      }
      this.setData({
        list,
        page,
        total: data.total || 0,
        unreadCount: data.unreadCount || 0,
        hasMore: list.length < (data.total || 0)
      });
    } catch (err) {
      // 静默失败，保留现有列表
    } finally {
      this.setData({ loading: false, refresherTriggered: false });
    }
  },

  // 永久公告置顶常驻：importance=always 的公告排在最前
  pinAlwaysAnnouncement(list) {
    const pinned = list.filter(m => m.type === 'announcement' && m.importance === 'always');
    if (!pinned.length) return list;
    const pinnedIds = {};
    pinned.forEach(m => { pinnedIds[m._id] = true; });
    const rest = list.filter(m => !pinnedIds[m._id]);
    return pinned.concat(rest);
  },

  // 字段加工：配色 / 时间文案
  decorate(m) {
    let color = m.color;
    if (m.type === 'announcement' && ANNOUNCE_IMPORTANCE_COLOR[m.importance]) {
      color = ANNOUNCE_IMPORTANCE_COLOR[m.importance];
    }
    return {
      ...m,
      color,
      unread: !m.read,
      timeText: this.formatTime(m.created_at)
    };
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const sameYear = d.getFullYear() === now.getFullYear();
    const datePart = sameYear
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 筛选切换
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.category) return;
    this.setData({ category: key, expandedId: '' });
    this.fetchList(true);
  },

  // 点消息：展开详情 + 即刻已读
  async onItemTap(e) {
    const idx = e.currentTarget.dataset.index;
    const item = this.data.list[idx];
    if (!item) return;
    const expanding = this.data.expandedId !== item._id;
    this.setData({ expandedId: expanding ? item._id : '' });
    if (expanding && item.unread) {
      this.setData({ [`list[${idx}].unread`]: false, [`list[${idx}].read`]: true });
      if (this.data.unreadCount > 0) {
        this.setData({ unreadCount: this.data.unreadCount - 1 });
      }
      try {
        await request({ url: `/messages/${item._id}/read`, method: 'POST', silent: true });
      } catch (err) { /* 已读失败不阻断浏览 */ }
    }
  },

  // 一键已读
  async onMarkAllRead() {
    if (this.data.unreadCount === 0) return;
    try {
      await request({ url: '/messages/read-all', method: 'POST', silent: true });
      const list = this.data.list.map(m => ({ ...m, unread: false, read: true }));
      this.setData({ list, unreadCount: 0 });
      wx.showToast({ title: this.data.skinId === 'paper' ? '已全部启阅' : '已全部已读', icon: 'none' });
    } catch (err) { /* 静默 */ }
  },

  onPullDownRefresh() {
    this.fetchList(true);
  },

  onHide() {
    // 切离消息页断开 WS，避免残留回调（与其他页面同一约定）
    wsClient.disconnect();
    this._msgWsConnected = false;
  },

  onUnload() {
    wsClient.disconnect();
    this._msgWsConnected = false;
  },

  onReachBottom() {
    this.fetchList(false);
  }
});
