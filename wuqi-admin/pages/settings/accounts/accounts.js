const { request } = require('../../../utils/request');

Page({
  data: {
    accounts: [],
    stores: [],
    currentUserRole: '',
    showModal: false,
    editingAccount: null,
    roleIndex: 1,
    storeIndex: 0,
    roles: [
      { id: 'super_admin', name: '超级管理员' },
      { id: 'store_manager', name: '店长' },
      { id: 'staff', name: '员工' }
    ],
    formData: {
      name: '',
      username: '',
      password: '',
      role: 'staff',
      store_id: ''
    }
  },

  onShow() {
    this.loadStores();
    this.loadAccounts();
    this.getCurrentUserRole();
  },

  getCurrentUserRole() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      this.setData({ currentUserRole: userInfo.role });
    }
  },

  loadStores() {
    request({ url: '/stores', method: 'GET' }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (res.data || []);
      this.setData({ stores: list });
    }).catch(() => {});
  },

  loadAccounts() {
    request({ url: '/accounts', method: 'GET' }).then(res => {
      const list = res.data && res.data.list ? res.data.list : (res.data || []);
      const roleMap = {
        'super_admin': '超级管理员',
        'store_manager': '店长',
        'staff': '员工'
      };
      const processedList = list.map(item => ({
        ...item,
        roleName: roleMap[item.role] || item.role,
        permCount: item.role === 'super_admin' ? '全部'
          : (item.permissions && item.permissions.length > 0
            ? (item.permissions[0] === '*' ? '全部' : item.permissions.length + '项')
            : '未配置'),
      }));
      this.setData({ accounts: processedList });
    }).catch(() => {});
  },

  onAddAccount() {
    this.setData({
      showModal: true,
      editingAccount: null,
      roleIndex: 1,
      storeIndex: 0,
      formData: {
        name: '',
        username: '',
        password: '',
        role: 'staff',
        store_id: this.data.stores.length > 0 ? this.data.stores[0]._id : ''
      }
    });
  },

  onEditAccount(e) {
    const { index } = e.currentTarget.dataset;
    const account = this.data.accounts[index];
    const roleIndex = this.data.roles.findIndex(r => r.id === account.role);
    let storeId = '';
    let storeIndex = -1;
    if (account.store_id) {
      storeId = typeof account.store_id === 'object' ? account.store_id._id : account.store_id;
      storeIndex = this.data.stores.findIndex(s => s._id === storeId);
    }
    this.setData({
      showModal: true,
      editingAccount: account,
      roleIndex: roleIndex >= 0 ? roleIndex : 1,
      storeIndex: storeIndex >= 0 ? storeIndex : 0,
      formData: {
        name: account.nick_name || account.name || '',
        username: account.username || '',
        password: '',
        role: account.role || 'staff',
        store_id: storeId
      }
    });
  },

  onCloseModal() {
    this.setData({ showModal: false });
  },

  onModalTap() {},

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`formData.${field}`]: e.detail.value });
  },

  onRoleChange(e) {
    const index = e.detail.value;
    this.setData({
      roleIndex: index,
      'formData.role': this.data.roles[index].id
    });
  },

  onStoreChange(e) {
    const index = e.detail.value;
    const store = this.data.stores[index];
    this.setData({
      'formData.store_id': store ? store._id : ''
    });
  },

  onSubmit() {
    const { formData, editingAccount, currentUserRole } = this.data;
    if (!formData.name || !formData.username) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    if (!editingAccount && !formData.password) {
      wx.showToast({ title: '请设置密码', icon: 'none' });
      return;
    }

    let data;
    if (editingAccount) {
      data = {
        nick_name: formData.name
      };
      if (formData.store_id) {
        data.store_id = formData.store_id;
      }
      if (currentUserRole === 'super_admin') {
        data.role = formData.role;
      }
    } else {
      data = {
        username: formData.username,
        nick_name: formData.name,
        user_type: formData.role === 'store_manager' ? 'admin' : 'staff',
        role: formData.role,
        password: formData.password,
        store_id: formData.store_id
      };
    }

    const url = editingAccount ? `/accounts/${editingAccount._id}` : '/accounts';
    const method = editingAccount ? 'PUT' : 'POST';

    request({ url, method, data }).then(() => {
      wx.showToast({ title: editingAccount ? '修改成功' : '添加成功', icon: 'success' });
      this.setData({ showModal: false });
      this.loadAccounts();
    }).catch(err => {
      const msg = err && err.data && err.data.message ? err.data.message : '操作失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onToggleAccount(e) {
    const { index } = e.currentTarget.dataset;
    const account = this.data.accounts[index];
    const newStatus = account.status === 'active' ? 'disabled' : 'active';
    request({
      url: `/accounts/${account._id}/status`,
      method: 'PUT',
      data: { status: newStatus }
    }).then(() => {
      this.setData({ [`accounts[${index}].status`]: newStatus });
    }).catch(err => {
      const msg = err && err.data && err.data.message ? err.data.message : '操作失败';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  onDeleteAccount(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '确认删除此账号？',
      success: (res) => {
        if (res.confirm) {
          request({
            url: `/accounts/${id}`,
            method: 'DELETE'
          }).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadAccounts();
          }).catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  onGoToRoles() {
    wx.navigateTo({ url: '/pages/settings/roles/roles' });
  },
});
