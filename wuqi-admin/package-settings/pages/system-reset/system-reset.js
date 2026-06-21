const { request } = require('../../../utils/request');

const KEY_ROUTE_MAP = {
  schedules: 'schedules',
  bookings: 'bookings',
  attendance: 'attendance',
  coaches: 'coaches',
  danceStyles: 'dance-styles',
  members: 'members',
  packages: 'packages',
  waitlists: 'waitlists',
  logs: 'logs',
};

Page({
  data: {
    stats: {
      schedules: 0,
      bookings: 0,
      coaches: 0,
      danceStyles: 0,
      members: 0,
      userPackages: 0,
      waitlists: 0,
      operationLogs: 0,
    },
    loading: false,
    showConfirmModal: false,
    confirmKey: '',
    confirmLabel: '',
    confirmCount: 0,
    confirmInput: '',
    isResetAll: false,
    resetItems: [
      { key: 'schedules', label: '课程数据', desc: '清理所有排课记录（不删除预约记录）', icon: '' },
      { key: 'bookings', label: '预约记录', desc: '清理所有预约记录，排课人数归零', icon: '' },
      { key: 'attendance', label: '上课记录', desc: '重置所有签到状态为"已预约"', icon: '' },
      { key: 'coaches', label: '教练数据', desc: '清理所有教练及薪资记录', icon: '' },
      { key: 'danceStyles', label: '舞种数据', desc: '清理所有舞种记录', icon: '' },
      { key: 'members', label: '会员数据', desc: '清理所有会员、套餐、预约、候补记录', icon: '' },
      { key: 'packages', label: '套餐数据', desc: '清理所有用户套餐记录', icon: '' },
      { key: 'waitlists', label: '候补记录', desc: '清理所有候补排队记录', icon: '' },
      { key: 'logs', label: '操作日志', desc: '清理所有操作日志', icon: '' },
    ],
  },

  onShow() {
    this.loadStats();
  },

  async loadStats() {
    try {
      const res = await request({ url: '/system/stats' });
      this.setData({ stats: res.data });
    } catch (err) {
      console.error('获取统计失败', err);
    }
  },

  getCount(key) {
    const { stats } = this.data;
    const map = {
      schedules: stats.schedules,
      bookings: stats.bookings,
      attendance: stats.bookings,
      coaches: stats.coaches,
      danceStyles: stats.danceStyles,
      members: stats.members,
      packages: stats.userPackages,
      waitlists: stats.waitlists,
      logs: stats.operationLogs,
    };
    return map[key] || 0;
  },

  onResetTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const item = this.data.resetItems.find(i => i.key === key);
    if (!item) return;

    const count = this.getCount(key);

    wx.showModal({
      title: '危险操作',
      content: `确认初始化「${item.label}」？\n\n${item.desc}\n\n当前数据量：${count}条\n\n此操作不可恢复！`,
      confirmText: '确认',
      confirmColor: '#FF3B30',
      cancelColor: '#999999',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            showConfirmModal: true,
            confirmKey: key,
            confirmLabel: item.label,
            confirmCount: count,
            confirmInput: '',
            isResetAll: false,
          });
        }
      }
    });
  },

  onModalTap() {
    // 阻止事件冒泡，防止点击弹窗内部关闭弹窗
  },

  onConfirmInput(e) {
    this.setData({ confirmInput: e.detail.value });
  },

  onCancelConfirm() {
    this.setData({ showConfirmModal: false, confirmInput: '' });
  },

  onExecuteConfirm() {
    const { confirmInput, confirmKey, confirmLabel, isResetAll } = this.data;
    if (confirmInput !== '确认初始化') {
      wx.showToast({ title: '请输入"确认初始化"', icon: 'none' });
      return;
    }
    this.setData({ showConfirmModal: false, confirmInput: '' });
    if (isResetAll) {
      this.doResetAll();
    } else {
      this.doReset(confirmKey, confirmLabel);
    }
  },

  async doReset(key, label) {
    wx.showLoading({ title: '初始化中...' });
    try {
      const routeKey = KEY_ROUTE_MAP[key] || key;
      const res = await request({
        url: `/system/reset/${routeKey}`,
        method: 'POST',
      });
      wx.hideLoading();
      wx.showToast({ title: `${label}已初始化`, icon: 'success' });
      this.loadStats();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  onResetAll() {
    const { stats } = this.data;
    const total = stats.schedules + stats.bookings + stats.coaches + stats.danceStyles + stats.members + stats.userPackages + stats.waitlists + stats.operationLogs;

    wx.showModal({
      title: '极度危险',
      content: `确认初始化所有业务数据？\n\n将清理：课程、预约、教练、舞种、会员、套餐、候补、日志\n\n当前总数据量：${total}条\n\n此操作不可恢复！仅保留管理员账号和系统配置`,
      confirmText: '全部初始化',
      confirmColor: '#FF3B30',
      cancelColor: '#999999',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            showConfirmModal: true,
            confirmKey: '',
            confirmLabel: '所有业务数据',
            confirmCount: total,
            confirmInput: '',
            isResetAll: true,
          });
        }
      }
    });
  },

  async doResetAll() {
    wx.showLoading({ title: '初始化中...' });
    try {
      const res = await request({
        url: '/system/reset/all',
        method: 'POST',
      });
      wx.hideLoading();
      wx.showToast({ title: '所有数据已初始化', icon: 'success' });
      this.loadStats();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },
});
