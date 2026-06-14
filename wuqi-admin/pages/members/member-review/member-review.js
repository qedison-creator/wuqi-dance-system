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
    selectedStoreId: ''
  },

  onShow() {
    this.loadPendingMembers();
  },

  onPullDownRefresh() {
    this.loadPendingMembers().then(() => {
      wx.stopPullDownRefresh();
    });
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
        const reservePhone = member.reserve_phone || member.phone || '';
        return {
          ...member,
          nickname: member.nick_name,
          avatar: member.avatar_url,
          wechat_phone_display: wechatPhone,
          reserve_phone_display: reservePhone,
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

  async onDelete(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确认删除 ${name || '该用户'} 的会员申请？删除后信息将不再保留。`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (res.confirm) {
          try {
            // 删除功能直接调用拒绝接口，或者用软删除
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

  // 点击"通过"→ 弹出门店选择
  async onApprove(e) {
    const { id, name, storeId } = e.currentTarget.dataset;
    // 加载门店列表
    try {
      const res = await request({ url: '/stores' });
      const storeList = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      
      // 自动选中用户已选择的门店
      let autoSelectedStoreId = '';
      if (storeId) {
        // 检查门店列表中是否存在这个门店
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
