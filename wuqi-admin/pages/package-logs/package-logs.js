const app = getApp();
const { request } = require('../../utils/request');
const { formatDate } = require('../../utils/util');

Page({
  data: {
    activeTab: 'activation',
    activationList: [],
    extensionList: [],
    loading: true,
    page: 1,
    pageSize: 20
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.setData({ loading: true });
    this.loadActivationList();
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab, loading: true, page: 1 });
    if (tab === 'activation') {
      this.loadActivationList();
    } else {
      this.loadExtensionList();
    }
  },

  async loadActivationList() {
    try {
      const res = await request({
        url: '/packages/package-activations',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          store_id: app.globalData.currentStore ? app.globalData.currentStore._id : ''
        }
      });
      const data = res.data || {};
      const activationList = (data.list || []).map(item => {
        const typeMap = { manual: '手动激活', auto: '自动激活', booking: '预约激活' };
        return {
          ...item,
          typeLabel: typeMap[item.type] || item.type || '',
          activated_at_display: item.activated_at ? this.formatDateTime(item.activated_at) : '-',
          effective_date_display: item.effective_date ? item.effective_date.split('T')[0] : '-',
          expire_date_display: item.expire_date ? item.expire_date.split('T')[0] : '-',
        };
      });
      this.setData({ 
        activationList,
        loading: false 
      });
    } catch (err) {
      console.error('加载激活记录失败', err);
      this.setData({ loading: false });
    }
  },

  async loadExtensionList() {
    try {
      const res = await request({
        url: '/packages/package-extensions',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          store_id: app.globalData.currentStore ? app.globalData.currentStore._id : ''
        }
      });
      const data = res.data || {};
      const extensionList = (data.list || []).map(item => {
        const typeMap = { manual: '手动延长', holiday: '放假顺延', system: '系统延长' };
        return {
          ...item,
          typeLabel: typeMap[item.type] || item.type || '',
          created_at_display: item.created_at ? this.formatDateTime(item.created_at) : '-',
          original_expire_display: item.original_expire ? item.original_expire.split('T')[0] : '-',
          new_expire_display: item.new_expire ? item.new_expire.split('T')[0] : '-',
        };
      });
      this.setData({ 
        extensionList,
        loading: false 
      });
    } catch (err) {
      console.error('加载延长记录失败', err);
      this.setData({ loading: false });
    }
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