const app = getApp();
const { request } = require('../../../../utils/request');

Page({
  data: {
    nickName: '',
    username: '',
    roleName: '',
    userId: '',
    avatarUrl: '',
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  },

  onShow() {
    this.loadUserInfo();
  },

  loadUserInfo() {
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      const roleMap = {
        'super_admin': '超级管理员',
        'store_manager': '店长',
        'staff': '员工'
      };
      // 规范化avatar_url
      let avatarUrl = userInfo.avatar_url || '';
      avatarUrl = this.normalizeAvatarUrl(avatarUrl);
      this.setData({
        nickName: userInfo.nick_name || userInfo.name || '',
        username: userInfo.username || '',
        roleName: roleMap[userInfo.role] || userInfo.role || '',
        userId: userInfo._id || userInfo.id || '',
        avatarUrl: avatarUrl
      });
    }
  },

  /**
   * 规范化头像URL：处理旧数据中的HTTP IP地址
   */
  normalizeAvatarUrl(url) {
    if (!url) return '';
    if (url.startsWith('https://')) return url;
    const config = require('../../../../config/index.js');
    const serverBase = config.serverBase || '';
    if (url.startsWith('http://')) {
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      if (match) return serverBase + match[1];
    }
    return serverBase + url;
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  onOldPasswordInput(e) {
    this.setData({ oldPassword: e.detail.value });
  },

  onNewPasswordInput(e) {
    this.setData({ newPassword: e.detail.value });
  },

  onConfirmPasswordInput(e) {
    this.setData({ confirmPassword: e.detail.value });
  },

  // 更换头像
  onChangeAvatar() {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 调用裁剪接口，类似微信换头像的体验
        wx.cropImage({
          src: tempFilePath,
          cropScale: '1:1',
          success: (cropRes) => {
            self.uploadAvatar(cropRes.tempFilePath);
          },
          fail: (err) => {
            // 裁剪失败或取消，直接使用原图
            if (err.errMsg && err.errMsg.indexOf('cancel') > -1) {
              return;
            }
            self.uploadAvatar(tempFilePath);
          }
        });
      }
    });
  },

  // 上传头像到服务器
  uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...', mask: true });
    const baseUrl = app.globalData.serverBase || app.globalData.baseUrl;
    const token = wx.getStorageSync('admin_token') || app.globalData.token || '';

    wx.uploadFile({
      url: baseUrl + '/api/v1/upload/image?type=user_avatar',
      filePath: filePath,
      name: 'image',
      header: {
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        wx.hideLoading();
        try {
          const data = JSON.parse(res.data);
          if (data.code === 200 && data.data) {
            // 只保存相对路径到后端，显示时再根据环境拼接完整URL
            const relativeUrl = data.data.url;
            const avatarUrl = this.normalizeAvatarUrl(relativeUrl);
            this.setData({ avatarUrl: avatarUrl });
            // 保存相对路径到后端（不包含服务器地址，便于环境切换）
            this.saveAvatar(relativeUrl);
          } else {
            wx.showToast({ title: data.message || '上传失败', icon: 'none' });
          }
        } catch (e) {
          wx.showToast({ title: '上传解析失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误，上传失败', icon: 'none' });
      }
    });
  },

  // 保存头像URL到用户信息
  async saveAvatar(avatarUrl) {
    try {
      const res = await request({
        url: '/auth/admin-profile',
        method: 'PUT',
        data: { avatar_url: avatarUrl }
      });
      // 更新全局用户信息
      if (app.globalData.userInfo) {
        app.globalData.userInfo.avatar_url = avatarUrl;
      }
      wx.showToast({ title: '头像更新成功', icon: 'success' });
    } catch (err) {
      const msg = err && err.data && err.data.message ? err.data.message : '保存失败';
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

  // 保存姓名
  async onSaveProfile() {
    const { nickName } = this.data;
    if (!nickName || !nickName.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    try {
      const res = await request({
        url: '/auth/admin-profile',
        method: 'PUT',
        data: { nick_name: nickName.trim() }
      });
      // 更新全局用户信息
      if (app.globalData.userInfo) {
        app.globalData.userInfo.nick_name = nickName.trim();
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      const msg = err && err.data && err.data.message ? err.data.message : '保存失败';
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

  // 修改密码
  async onChangePassword() {
    const { oldPassword, newPassword, confirmPassword } = this.data;
    if (!oldPassword) {
      wx.showToast({ title: '请输入旧密码', icon: 'none' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      wx.showToast({ title: '新密码至少6位', icon: 'none' });
      return;
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次新密码不一致', icon: 'none' });
      return;
    }
    try {
      await request({
        url: '/auth/change-password',
        method: 'PUT',
        data: { old_password: oldPassword, new_password: newPassword }
      });
      wx.showToast({ title: '密码修改成功', icon: 'success' });
      this.setData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      const msg = err && err.data && err.data.message ? err.data.message : '修改失败';
      wx.showToast({ title: msg, icon: 'none' });
    }
  }
});