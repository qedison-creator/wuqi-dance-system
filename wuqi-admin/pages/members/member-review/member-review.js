const app = getApp();
const { request } = require('../../../utils/request');

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
    // 审核通过时的门店选择弹窗
    showStoreModal: false,
    approveMember: null,
    storeList: [],
    selectedStoreId: '',
    // 右滑删除相关
    touchStartX: 0,
    touchEndX: 0,
    currentSwipeId: '',
    swipeOffset: {}
  },

  onShow() {
    this.loadPendingMembers();
  },

  onPullDownRefresh() {
    this.loadPendingMembers().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onTouchStart(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      touchStartX: e.touches[0].clientX,
      currentSwipeId: id
    });
  },

  onTouchMove(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.currentSwipeId !== id) return;
    
    const touchEndX = e.touches[0].clientX;
    const diff = this.data.touchStartX - touchEndX;
    
    if (diff > 0) {
      const offset = Math.min(diff, 160);
      this.setData({
        [`swipeOffset.${id}`]: offset
      });
    }
  },

  onTouchEnd(e) {
    const id = e.currentTarget.dataset.id;
    const offset = this.data.swipeOffset[id] || 0;
    
    if (offset > 80) {
      this.setData({
        [`swipeOffset.${id}`]: 160
      });
    } else {
      this.setData({
        [`swipeOffset.${id}`]: 0
      });
    }
    this.setData({ currentSwipeId: '' });
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
        let phone = member.phone;
        if (phone && phone.length === 11) {
          phone = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
        }
        return {
          ...member,
          nickname: member.nick_name,
          avatar: member.avatar_url,
          phone: phone,
          created_at: formatDate(member.created_at),
          store_name: member.store_id && member.store_id.name ? member.store_id.name : ''
        };
      });

      this.setData({ members, total, swipeOffset: {} });
    } catch (err) {
      console.error('加载待审核列表失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确认删除 ${name || '该用户'} 的会员申请？删除后信息将不再保留。`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/members/${id}`,
              method: 'DELETE'
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

  // 点击"通过"→ 弹出门店选择
  async onApprove(e) {
    const { id, name } = e.currentTarget.dataset;
    // 加载门店列表
    try {
      const res = await request({ url: '/stores' });
      const storeList = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({
        approveMember: { id, name },
        storeList: storeList,
        selectedStoreId: '',
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

  // 确认通过（带门店）
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
      content: `确认拒绝 ${name || '该用户'} 的会员申请？`,
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
