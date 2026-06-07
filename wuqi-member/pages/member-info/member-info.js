const app = getApp();
const { request } = require('../../utils/request');
const { requireLogin } = require('../../utils/auth');

Page({
  data: {
    userInfo: null,
    editing: false,
    editForm: {
      real_name: '',
      phone: '',
      gender: 0
    },
    changeRequestStatus: 'none',
    submitting: false
  },

  onLoad() {
    if (!requireLogin()) return;
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadUserInfo();
  },

  loadUserInfo() {
    request({ url: '/auth/me', silent: true }).then(res => {
      if (res.data) {
        const userInfo = res.data;
        app.globalData.userInfo = userInfo;
        const changeRequestStatus = userInfo.info_change_request ? userInfo.info_change_request.status : 'none';
        this.setData({
          userInfo,
          changeRequestStatus,
          editForm: {
            real_name: userInfo.real_name || '',
            phone: userInfo.phone || '',
            gender: userInfo.gender || 0
          }
        });
      }
    }).catch(() => {});
  },

  onEditTap() {
    this.setData({ editing: true });
  },

  onCancelEdit() {
    const { userInfo } = this.data;
    this.setData({
      editing: false,
      editForm: {
        real_name: userInfo.real_name || '',
        phone: userInfo.phone || '',
        gender: userInfo.gender || 0
      }
    });
  },

  onRealNameInput(e) {
    this.setData({ 'editForm.real_name': e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ 'editForm.phone': e.detail.value });
  },

  onGenderSelect(e) {
    const gender = parseInt(e.currentTarget.dataset.gender);
    this.setData({ 'editForm.gender': gender });
  },

  onSubmitChange() {
    const { editForm, userInfo } = this.data;
    if (!editForm.real_name || !editForm.real_name.trim()) {
      wx.showToast({ title: '请输入真实姓名', icon: 'none' });
      return;
    }
    if (!editForm.phone || !/^1[3-9]\d{9}$/.test(editForm.phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    if (editForm.gender !== 1 && editForm.gender !== 2) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }

    const changeData = {};
    if (editForm.real_name !== (userInfo.real_name || '')) changeData.real_name = editForm.real_name;
    if (editForm.phone !== (userInfo.phone || '')) changeData.phone = editForm.phone;
    if (editForm.gender !== (userInfo.gender || 0)) changeData.gender = editForm.gender;

    if (Object.keys(changeData).length === 0) {
      wx.showToast({ title: '没有修改的信息', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    request({
      url: '/members/info-change/request',
      method: 'POST',
      data: changeData
    }).then(() => {
      this.setData({ submitting: false, editing: false, changeRequestStatus: 'pending' });
      wx.showToast({ title: '修改申请已提交', icon: 'success' });
    }).catch(err => {
      this.setData({ submitting: false });
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    });
  }
});
