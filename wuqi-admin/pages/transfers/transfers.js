const app = getApp();
const { request } = require('../../utils/request');
const { formatDate } = require('../../utils/util');

Page({
  data: {
    transfers: [],
    loading: true,
    activeTab: 'pending',
    page: 1,
    pageSize: 20,
    hasMore: true,
    showRejectModal: false,
    rejectTransferId: '',
    rejectReason: ''
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.setData({ page: 1, transfers: [], hasMore: true, loading: true });
    this.loadTransfers();
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab, page: 1, transfers: [], hasMore: true });
    this.loadTransfers();
  },

  loadTransfers() {
    const { activeTab, page, pageSize } = this.data;
    const status = activeTab === 'all' ? '' : activeTab;
    request({
      url: '/transfers',
      data: { status, page, pageSize }
    }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const total = res.data && res.data.total ? res.data.total : list.length;
      this.setData({
        transfers: page === 1 ? list : this.data.transfers.concat(list),
        loading: false,
        hasMore: this.data.transfers.length + list.length < total
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({ page: this.data.page + 1 });
    this.loadTransfers();
  },

  onApprove(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认批准',
      content: '批准后将把该会员的所有套餐转移至目标门店，确定批准吗？',
      confirmColor: '#C5744B',
      success: (res) => {
        if (res.confirm) {
          this.doReview(id, 'approve');
        }
      }
    });
  },

  onShowReject(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({ showRejectModal: true, rejectTransferId: id, rejectReason: '' });
  },

  onCloseRejectModal() {
    this.setData({ showRejectModal: false, rejectTransferId: '', rejectReason: '' });
  },

  onRejectReasonInput(e) {
    this.setData({ rejectReason: e.detail.value });
  },

  onConfirmReject() {
    if (!this.data.rejectReason.trim()) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' });
      return;
    }
    this.doReview(this.data.rejectTransferId, 'reject', this.data.rejectReason);
  },

  doReview(id, action, rejectReason) {
    wx.showLoading({ title: '处理中...' });
    request({
      url: `/transfers/${id}/review`,
      method: 'PUT',
      data: { action, reject_reason: rejectReason }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: action === 'approve' ? '已批准' : '已拒绝', icon: 'success' });
      this.setData({ showRejectModal: false, rejectTransferId: '', rejectReason: '', page: 1, transfers: [] });
      this.loadTransfers();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: err.data?.message || '操作失败', icon: 'none' });
    });
  },

  getStatusText(status) {
    const map = { pending: '待审核', approved: '已批准', rejected: '已拒绝' };
    return map[status] || status;
  },

  getStatusClass(status) {
    const map = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };
    return map[status] || '';
  },

  formatTime(timeStr) {
    if (!timeStr) return '-';
    return formatDate(new Date(timeStr), 'MM-dd HH:mm');
  }
});