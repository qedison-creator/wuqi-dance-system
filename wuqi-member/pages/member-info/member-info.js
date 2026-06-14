const app = getApp();
const { request } = require('../../utils/request');
const { requireLogin } = require('../../utils/auth');
const config = require('../../config/index.js');

Page({
  data: {
    userInfo: null,
    editing: false,
    editForm: {
      real_name: '',
      phone: '',
      gender: 0,
      nickname: '',
      avatar: ''
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
        const baseUrl = (app && app.globalData && app.globalData.baseUrl) || config.baseUrl;
        const serverBase = config.serverBase;
        // 头像URL补全（静态文件在服务器根路径，非API路径下）
        if (userInfo.avatar && userInfo.avatar.startsWith('/')) {
          userInfo.avatar = serverBase + userInfo.avatar;
        }
        app.globalData.userInfo = userInfo;
        const changeRequestStatus = userInfo.info_change_request ? userInfo.info_change_request.status : 'none';
        this.setData({
          userInfo,
          changeRequestStatus,
          editForm: {
          real_name: userInfo.real_name || '',
          phone: userInfo.reserve_phone || userInfo.phone || '',
          gender: userInfo.gender || 0,
          nickname: userInfo.nickname || '',
          avatar: userInfo.avatar || ''
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
        phone: userInfo.reserve_phone || userInfo.phone || '',
        gender: userInfo.gender || 0,
        nickname: userInfo.nickname || '',
        avatar: userInfo.avatar || ''
      }
    });
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;

    wx.showLoading({ title: '上传中...' });

    const baseUrl = (app && app.globalData && app.globalData.baseUrl) || config.baseUrl;
    const serverBase = config.serverBase;
    wx.uploadFile({
      url: baseUrl + '/auth/avatar',
      filePath: avatarUrl,
      name: 'avatar',
      header: {
        'Authorization': 'Bearer ' + (app.globalData.token || wx.getStorageSync('token'))
      },
      success: (uploadRes) => {
        wx.hideLoading();
        try {
          const data = JSON.parse(uploadRes.data);
          if (data.code === 200 && data.data && data.data.url) {
            let fullAvatarUrl = data.data.url;
            if (fullAvatarUrl.startsWith('/')) {
              fullAvatarUrl = serverBase + fullAvatarUrl;
            }
            this.setData({ 'editForm.avatar': fullAvatarUrl });
            wx.showToast({ title: '头像已更新', icon: 'success' });
          } else {
            wx.showToast({ title: '上传失败', icon: 'none' });
          }
        } catch (e) {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  onNicknameInput(e) {
    this.setData({ 'editForm.nickname': e.detail.value });
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
    const profileUpdates = {};

    // 收集即时生效的字段（头像、昵称）
    if (editForm.avatar && editForm.avatar !== (userInfo.avatar || '')) {
      profileUpdates.avatar_url = editForm.avatar;
    }
    if (editForm.nickname !== (userInfo.nickname || '')) {
      profileUpdates.nick_name = editForm.nickname;
    }

    // 收集需要审核的字段（姓名、手机号、性别）
    const auditChanges = {};
    if (editForm.real_name !== (userInfo.real_name || '')) auditChanges.real_name = editForm.real_name;
    if (editForm.phone !== (userInfo.reserve_phone || userInfo.phone || '')) auditChanges.phone = editForm.phone;
    if (editForm.gender !== (userInfo.gender || 0)) auditChanges.gender = editForm.gender;

    const hasProfileChange = Object.keys(profileUpdates).length > 0;
    const hasAuditChange = Object.keys(auditChanges).length > 0;

    if (!hasProfileChange && !hasAuditChange) {
      wx.showToast({ title: '没有修改任何信息', icon: 'none', duration: 2000 });
      this.setData({ editing: false });
      return;
    }

    // 1. 如果有即时字段变更，先保存
    const savePromise = hasProfileChange
      ? this.updateProfile(profileUpdates)
      : Promise.resolve();

    // 2. 处理审核字段
    if (hasAuditChange) {
      // 校验必填
      const realName = editForm.real_name.trim();
      if (!realName) { wx.showToast({ title: '请输入真实姓名', icon: 'none' }); return; }
      if (!/^1[3-9]\d{9}$/.test(editForm.phone)) { wx.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
      if (editForm.gender !== 1 && editForm.gender !== 2) { wx.showToast({ title: '请选择性别', icon: 'none' }); return; }

      this.setData({ submitting: true });
      // 先保存即时字段，再提交审核
      savePromise.then(() => {
        request({
          url: '/members/info-change/request',
          method: 'POST',
          data: auditChanges
        }).then(() => {
          this.setData({ submitting: false, editing: false, changeRequestStatus: 'pending' });
          wx.showToast({ title: '修改申请已提交', icon: 'success' });
          this.loadUserInfo();
        }).catch(err => {
          this.setData({ submitting: false });
          wx.showToast({ title: err.message || '提交失败', icon: 'none' });
        });
      });
    } else {
      // 只有头像/昵称变更，立即生效
      savePromise.then(() => {
        wx.showToast({ title: '信息已更新', icon: 'success' });
        this.setData({ editing: false });
        this.loadUserInfo();
      });
    }
  },

  // 直接更新头像或昵称（无需审核）
  updateProfile(data) {
    return new Promise((resolve, reject) => {
      const token = app.globalData.token || wx.getStorageSync('token');
      const baseUrl = (app && app.globalData && app.globalData.baseUrl) || config.baseUrl;
      wx.request({
        url: baseUrl + '/auth/profile',
        method: 'PUT',
        header: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        data: data,
        success: (res) => {
          if (res.statusCode === 200 && res.data && res.data.code === 200) {
            // 使用服务端返回的完整数据，不手动合并
            if (res.data.data) {
              app.globalData.userInfo = { ...app.globalData.userInfo, ...res.data.data };
            }
            resolve();
          } else {
            reject(new Error('保存失败'));
          }
        },
        fail: reject
      });
    });
  }
});
