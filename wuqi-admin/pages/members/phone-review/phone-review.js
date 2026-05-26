const { request } = require('../../../utils/request');
const { formatDateTime } = require('../../../utils/util');

Page({
  data: {
    reviews: [], // 审核列表
    loading: true
  },

  onLoad() {
    this.loadReviews();
  },

  onShow() {
    this.loadReviews();
  },

  // 加载待审核列表
  loadReviews() {
    this.setData({ loading: true });
    request({
      url: '/members/phone-audit/list'
    }).then(res => {
      const reviews = (res.data || []).map(r => ({
        ...r,
        requestTimeStr: formatDateTime(r.phone_audit_requested_at)
      }));
      this.setData({
        reviews,
        loading: false
      });
    }).catch(err => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  // 审核操作
  onReview(e) {
    const member = e.currentTarget.dataset.member;
    const action = e.currentTarget.dataset.action;
    const actionText = action === 'approve' ? '通过' : '拒绝';
    
    wx.showModal({
      title: `确认${actionText}`,
      content: `确认${actionText}该会员的手机号修改申请吗？`,
      confirmColor: action === 'approve' ? '#27AE60' : '#E74C3C',
      success: (res) => {
        if (res.confirm) {
          this.doReview(member._id, action);
        }
      }
    });
  },

  // 执行审核
  doReview(memberId, action) {
    wx.showLoading({ title: '处理中...' });
    request({
      url: `/members/${memberId}/phone-audit`,
      method: 'PUT',
      data: { action }
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.loadReviews();
    }).catch(err => {
      wx.hideLoading();
      const msg = err.data && err.data.message || '操作失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  }
});
