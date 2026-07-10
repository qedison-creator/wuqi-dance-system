const app = getApp();
const { request } = require('../../../../utils/request');

const maskPhone = (phone) => {
  if (!phone || phone.length < 7) return phone || '';
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4);
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const week = weekNames[d.getDay()];
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${week} ${h}:${min}`;
};

Page({
  data: {
    members: [],
    total: 0,
    loading: false,
    showStoreModal: false,
    approveMember: null,
    storeList: [],
    selectedStoreId: '',
    activeTab: 'pending',
    history: [],
    historyPage: 1,
    historyTotal: 0,
    historyLoading: false,
    isReviewer: false
  },

  onShow() {
    this.checkRole();
    if (this.data.activeTab === 'pending') {
      this.loadPendingMembers();
    }
  },

  onPullDownRefresh() {
    const promise = this.data.activeTab === 'pending' ? this.loadPendingMembers() : this.loadHistory(true);
    promise.finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  checkRole() {
    const userInfo = app && app.globalData && app.globalData.userInfo;
    const role = userInfo && userInfo.role;
    const isReviewer = role === 'reviewer';
    this.setData({ isReviewer });
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'pending') {
      this.loadPendingMembers();
    } else if (tab === 'history') {
      this.loadHistory(true);
    }
  },

  async loadPendingMembers() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: '/members',
        method: 'GET',
        data: { member_status: 'registered', page: 1, limit: 100 }
      });
      const result = res.data || {};
      const list = result.list || (Array.isArray(result) ? result : []);
      const total = result.total || 0;

      const members = list.map(member => {
        const wechatPhone = member.wechat_phone || '';
        return {
          ...member,
          nickname: member.nick_name,
          avatar: member.avatar_url,
          wechatPhoneRaw: wechatPhone,
          wechatPhoneDisplay: maskPhone(wechatPhone),
          _showPhone: false,
          created_at: formatDate(member.created_at),
          store_name: member.store_id && member.store_id.name ? member.store_id.name : '',
          store_id: member.store_id && member.store_id._id ? member.store_id._id : null
        };
      });

      this.setData({ members, total });
    } catch (err) {
      console.error('加载待审核列表失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onTogglePhone(e) {
    const index = e.currentTarget.dataset.index;
    const key = `members[${index}]._showPhone`;
    const current = this.data.members[index] && this.data.members[index]._showPhone;
    this.setData({ [key]: !current });
  },

  loadHistory(reset) {
    if (reset) {
      this.setData({ historyPage: 1, history: [], historyLoading: true });
    } else {
      this.setData({ historyLoading: true });
    }
    const page = reset ? 1 : this.data.historyPage;
    request({
      url: '/members/audit-history',
      data: { page, pageSize: 20 }
    }).then(res => {
      const data = res.data || {};
      const list = (data.list || []).map(log => {
        const member = log.target_id || {};
        const operator = log.operator_id || {};
        const phone = member.wechat_phone || member.reserve_phone || member.phone || '';
        return {
          ...log,
          memberName: member.real_name || member.nick_name || '未知',
          memberPhone: phone,
          memberPhoneRaw: phone,
          memberPhoneDisplay: maskPhone(phone),
          _showPhone: false,
          memberCreatedAt: member.created_at ? formatDate(member.created_at) : '',
          operatorName: operator.real_name || operator.nick_name || log.operator_name || '—',
          auditAt: formatDate(log.created_at),
          auditResult: log.action === 'approve' ? '已通过' : '已拒绝',
          auditResultClass: log.action === 'approve' ? 'approved' : 'rejected'
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

  onToggleHistoryPhone(e) {
    const index = e.currentTarget.dataset.index;
    const key = `history[${index}]._showPhone`;
    const current = this.data.history[index] && this.data.history[index]._showPhone;
    this.setData({ [key]: !current });
  },

  loadMoreHistory() {
    if (this.data.historyLoading || this.data.history.length >= this.data.historyTotal) return;
    this.loadHistory(false);
  },

  async onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确认删除该用户的会员申请？删除后信息将不再保留。`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/members/${id}/review`,
              method: 'PUT',
              data: { action: 'reject' }
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadPendingMembers();
          } catch (err) {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  async onApprove(e) {
    const { id, name, storeId } = e.currentTarget.dataset;
    try {
      const res = await request({ url: '/stores' });
      const storeList = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      
      let autoSelectedStoreId = '';
      if (storeId) {
        const targetStore = storeList.find(s => String(s._id) === String(storeId));
        if (targetStore) {
          autoSelectedStoreId = targetStore._id;
        }
      }
      
      this.setData({
        approveMember: { id, name },
        storeList: storeList,
        selectedStoreId: autoSelectedStoreId,
        showStoreModal: true
      });
    } catch (err) {
      wx.showToast({ title: '获取门店失败', icon: 'none' });
    }
  },

  onStoreSelect(e) {
    this.setData({ selectedStoreId: e.currentTarget.dataset.id });
  },

  onCloseStoreModal() {
    this.setData({ showStoreModal: false, approveMember: null });
  },

  onModalTap() {},

  async onConfirmApprove() {
    const { approveMember, selectedStoreId } = this.data;
    if (!selectedStoreId) {
      wx.showToast({ title: '请选择门店', icon: 'none' });
      return;
    }
    try {
      await request({
        url: `/members/${approveMember.id}/review`,
        method: 'PUT',
        data: { action: 'approve', store_id: selectedStoreId }
      });
      wx.showToast({ title: '已通过', icon: 'success' });
      app.globalData.fromReviewPage = true;
      this.setData({ showStoreModal: false, approveMember: null });
      this.loadPendingMembers();
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async onReject(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认拒绝',
      content: `确认拒绝该用户的会员申请？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/members/${id}/review`,
              method: 'PUT',
              data: { action: 'reject' }
            });
            wx.showToast({ title: '已拒绝', icon: 'success' });
            this.loadPendingMembers();
          } catch (err) {
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  }
});