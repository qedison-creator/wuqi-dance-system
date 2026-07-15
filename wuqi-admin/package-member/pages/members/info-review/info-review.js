const { request } = require('../../../../utils/request');
const { formatDate } = require('../../../../utils/util');
const wsClient = require('../../../../utils/websocket-client');

const maskPhone = (phone) => {
  if (!phone || phone.length < 7) return phone || '';
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4);
};

Page({
  data: {
    reviews: [],
    history: [],
    loading: true,
    activeTab: 'pending',
    historyPage: 1,
    historyTotal: 0,
    historyLoading: false,
    isReviewer: false
  },

  onLoad() {
    this.checkRole();
    this.loadReviews();
  },

  onShow() {
    if (this.data.activeTab === 'pending') {
      this.loadReviews();
    }
    // 连接 WebSocket，监听新的信息修改审核请求
    const self = this;
    wsClient.connect({
      onMessage: {
        info_change_request: function() {
          if (self.data.activeTab === 'pending') {
            self.loadReviews();
          }
        },
        member_count_update: function() {
          if (self.data.activeTab === 'pending') {
            self.loadReviews();
          }
        }
      }
    });
  },

  onHide() {
    wsClient.disconnect();
  },

  onUnload() {
    wsClient.disconnect();
  },

  onPullDownRefresh() {
    if (this.data.activeTab === 'pending') {
      this.loadReviews().then(() => wx.stopPullDownRefresh());
    } else {
      this.setData({ historyPage: 1 }, () => {
        this.loadHistory().then(() => wx.stopPullDownRefresh());
      });
    }
  },

  checkRole() {
    const app = getApp();
    const userInfo = app && app.globalData && app.globalData.userInfo;
    const role = userInfo && userInfo.role;
    const isReviewer = role === 'reviewer';
    this.setData({ isReviewer });
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'pending') {
      this.loadReviews();
    } else if (tab === 'history') {
      this.loadHistory(true);
    }
  },

  loadReviews() {
    this.setData({ loading: true });
    return request({
      url: '/members/info-change/list'
    }).then(res => {
      const reviews = (res.data || []).map(r => {
        const pending = r.info_change_request || {};
        const pendingData = pending.pending_data || {};
        const rawPhone = r.phone || '';
        return {
          ...r,
          requestTimeStr: formatDate(pending.requested_at, 'YYYY-MM-DD HH:mm'),
          pendingData,
          changeFields: this.getChangeFields(r, pendingData),
          memberPhoneRaw: rawPhone,
          memberPhone: maskPhone(rawPhone),
          _showPhone: false
        };
      });
      this.setData({ reviews, loading: false });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  loadHistory(reset) {
    if (reset) {
      this.setData({ historyPage: 1, history: [], historyLoading: true });
    } else {
      this.setData({ historyLoading: true });
    }
    const page = reset ? 1 : this.data.historyPage;
    return request({
      url: '/members/info-change/history',
      data: { page, pageSize: 20 }
    }).then(res => {
      const data = res.data || {};
      const list = (data.list || []).map(r => {
        const req = r.info_change_request || {};
        const pendingData = req.pending_data || {};
        const reviewer = req.reviewed_by || {};
        const rawPhone = r.phone || '';
        return {
          ...r,
          requestTimeStr: formatDate(req.requested_at, 'YYYY-MM-DD HH:mm'),
          reviewTimeStr: formatDate(req.reviewed_at, 'YYYY-MM-DD HH:mm'),
          reviewStatus: req.status === 'approved' ? '已通过' : '已拒绝',
          reviewStatusClass: req.status === 'approved' ? 'approved' : 'rejected',
          reviewerName: reviewer.real_name || reviewer.nick_name || '—',
          changeFields: this.getChangeFields(r, pendingData),
          memberPhoneRaw: rawPhone,
          memberPhone: maskPhone(rawPhone),
          _showPhone: false
        };
      });
      const history = reset ? list : this.data.history.concat(list);
      this.setData({
        history,
        historyPage: page + 1,
        historyTotal: data.total || 0,
        historyLoading: false
      });
    }).catch(() => {
      this.setData({ historyLoading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  loadMoreHistory() {
    if (this.data.historyLoading || this.data.history.length >= this.data.historyTotal) return;
    this.loadHistory(false);
  },

  onTogglePhone(e) {
    const index = e.currentTarget.dataset.index;
    const key = `reviews[${index}]._showPhone`;
    const current = this.data.reviews[index] && this.data.reviews[index]._showPhone;
    this.setData({ [key]: !current });
  },

  onToggleHistoryPhone(e) {
    const index = e.currentTarget.dataset.index;
    const key = `history[${index}]._showPhone`;
    const current = this.data.history[index] && this.data.history[index]._showPhone;
    this.setData({ [key]: !current });
  },

  getChangeFields(member, pendingData) {
    const fields = [];
    const fieldMap = {
      real_name: { label: '姓名', getValue: (d) => d.real_name, getCurrent: (m) => m.real_name },
      phone: { label: '手机号', getValue: (d) => d.phone, getCurrent: (m) => m.phone, isPhone: true },
      gender: { label: '性别', getValue: (d) => d.gender === 1 ? '男' : '女', getCurrent: (m) => m.gender === 1 ? '男' : (m.gender === 2 ? '女' : '未设置') },
      store_id: { label: '门店', getValue: (d) => d.store_id_name || d.store_id, getCurrent: (m) => m.store_id && m.store_id.name ? m.store_id.name : '未选择' }
    };
    for (const [key, config] of Object.entries(fieldMap)) {
      if (pendingData[key] !== undefined) {
        const currentRaw = config.getCurrent(member);
        const newRaw = config.getValue(pendingData);
        const isPhone = config.isPhone || false;
        fields.push({
          label: config.label,
          currentValue: isPhone ? maskPhone(currentRaw) : currentRaw,
          currentValueRaw: isPhone ? currentRaw : '',
          newValue: isPhone ? maskPhone(newRaw) : newRaw,
          newValueRaw: isPhone ? newRaw : '',
          isPhone
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
      confirmText: actionText,
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