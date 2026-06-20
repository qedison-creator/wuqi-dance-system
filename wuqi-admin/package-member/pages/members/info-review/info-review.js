const { request } = require('../../../../utils/request');
const { formatDate } = require('../../../../utils/util');

Page({
  data: {
    reviews: [],
    loading: true
  },

  onLoad() {
    this.loadReviews();
  },

  onShow() {
    this.loadReviews();
  },

  loadReviews() {
    this.setData({ loading: true });
    request({
      url: '/members/info-change/list'
    }).then(res => {
      const reviews = (res.data || []).map(r => {
        const pending = r.info_change_request || {};
        const pendingData = pending.pending_data || {};
        return {
          ...r,
          requestTimeStr: formatDate(pending.requested_at, 'YYYY-MM-DD HH:mm'),
          pendingData,
          changeFields: this.getChangeFields(r, pendingData)
        };
      });
      this.setData({ reviews, loading: false });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  getChangeFields(member, pendingData) {
    const fields = [];
    const fieldMap = {
      real_name: { label: '姓名', getValue: (d) => d.real_name, getCurrent: (m) => m.real_name },
      phone: { label: '手机号', getValue: (d) => d.phone, getCurrent: (m) => m.phone },
      gender: { label: '性别', getValue: (d) => d.gender === 1 ? '男' : '女', getCurrent: (m) => m.gender === 1 ? '男' : (m.gender === 2 ? '女' : '未设置') },
      store_id: { label: '门店', getValue: (d) => d.store_id_name || d.store_id, getCurrent: (m) => m.store_id && m.store_id.name ? m.store_id.name : '未选择' }
    };
    for (const [key, config] of Object.entries(fieldMap)) {
      if (pendingData[key] !== undefined) {
        fields.push({
          label: config.label,
          currentValue: config.getCurrent(member),
          newValue: config.getValue(pendingData)
        });
      }
    }
    return fields;
  },

  onReview(e) {
    const member = e.currentTarget.dataset.member;
    const action = e.currentTarget.dataset.action;
    const actionText = action === 'approve' ? '通过' : '拒绝';

    wx.showModal({
      title: `确认${actionText}`,
      content: `确认${actionText}该会员的信息修改申请吗？`,
      confirmColor: action === 'approve' ? '#27AE60' : '#E74C3C',
      success: (res) => {
        if (res.confirm) {
          this.doReview(member._id, action);
        }
      }
    });
  },

  doReview(memberId, action) {
    wx.showLoading({ title: '处理中...' });
    request({
      url: `/members/${memberId}/info-change-audit`,
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
