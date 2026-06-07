const { request } = require('../../../utils/request');

Page({
  data: {
    accounts: [],
    stores: [],
    currentUserRole: '',
    currentUserId: '',
    showModal: false,
    editingAccount: null,
    roleIndex: 1,
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
      store_ids: []
    },
    storeCheckboxes: [],
    storeSelectAll: false
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
      this.setData({
        currentUserRole: userInfo.role,
        currentUserId: userInfo._id || userInfo.id || ''
      });
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
        storeNames: item.store_ids && item.store_ids.length > 0
          ? item.store_ids.map(s => s.name || '未知').join('、')
          : (item.store_id ? (item.store_id.name || '未知') : ''),
        permCount: item.role === 'super_admin' ? '全部'
          : (item.permissions && item.permissions.length > 0
            ? (item.permissions[0] === '*' ? '全部' : item.permissions.length + '项')
            : '未配置'),
      }));
      this.setData({ accounts: processedList });
    }).catch(() => {});
  },

  onAddAccount() {
    const allStoreIds = this.data.stores.map(s => s._id);
    const allChecked = this.data.stores.map(() => true);
    this.setData({
      showModal: true,
      editingAccount: null,
      roleIndex: 1,
      'formData.name': '',
      'formData.username': '',
      'formData.password': '',
      'formData.role': 'staff',
      'formData.store_ids': allStoreIds,
      storeCheckboxes: allChecked,
      storeSelectAll: allStoreIds.length > 0
    });
  },

  onEditAccount(e) {
    const { index } = e.currentTarget.dataset;
    const account = this.data.accounts[index];
    const roleIndex = this.data.roles.findIndex(r => r.id === account.role);
    // 处理门店多选：优先使用 store_ids，兼容旧的 store_id
    let storeIds = [];
    if (account.store_ids && account.store_ids.length > 0) {
      storeIds = account.store_ids.map(s => typeof s === 'object' ? s._id : s);
    } else if (account.store_id) {
      const sid = typeof account.store_id === 'object' ? account.store_id._id : account.store_id;
      if (sid) storeIds = [sid];
    }
    const checkboxes = this.data.stores.map(s => storeIds.includes(s._id));
    const allChecked = this.data.stores.length > 0 && checkboxes.every(c => c);
    this.setData({
      showModal: true,
      editingAccount: account,
      roleIndex: roleIndex >= 0 ? roleIndex : 1,
      'formData.name': account.nick_name || account.name || '',
      'formData.username': account.username || '',
      'formData.password': '',
      'formData.role': account.role || 'staff',
      'formData.store_ids': storeIds,
      storeCheckboxes: checkboxes,
      storeSelectAll: allChecked
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
    const newRole = this.data.roles[index].id;
    if (newRole === 'super_admin') {
      // 超级管理员不属于任何门店
      this.setData({
        roleIndex: index,
        'formData.role': newRole,
        'formData.store_ids': [],
        storeCheckboxes: this.data.stores.map(() => false),
        storeSelectAll: false
      });
    } else {
      // 店长、员工默认全部门店
      const allStoreIds = this.data.stores.map(s => s._id);
      const allChecked = this.data.stores.map(() => true);
      this.setData({
        roleIndex: index,
        'formData.role': newRole,
        'formData.store_ids': allStoreIds,
        storeCheckboxes: allChecked,
        storeSelectAll: allStoreIds.length > 0
      });
    }
  },

  onStoreToggle(e) {
    const { index } = e.currentTarget.dataset;
    const checkboxes = [...this.data.storeCheckboxes];
    checkboxes[index] = !checkboxes[index];
    const storeIds = this.data.stores
      .filter((s, i) => checkboxes[i])
      .map(s => s._id);
    const allChecked = this.data.stores.length > 0 && checkboxes.every(c => c);
    this.setData({
      storeCheckboxes: checkboxes,
      'formData.store_ids': storeIds,
      storeSelectAll: allChecked
    });
  },

  onStoreToggleAll() {
    const newAll = !this.data.storeSelectAll;
    const checkboxes = this.data.stores.map(() => newAll);
    const storeIds = newAll ? this.data.stores.map(s => s._id) : [];
    this.setData({
      storeCheckboxes: checkboxes,
      'formData.store_ids': storeIds,
      storeSelectAll: newAll
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
      if (formData.role !== 'super_admin') {
        data.store_ids = formData.store_ids;
      } else {
        data.store_ids = [];
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
        store_ids: formData.role !== 'super_admin' ? formData.store_ids : []
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
