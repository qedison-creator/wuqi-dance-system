const auth = require('../../utils/auth');

Page({
  data: {
    agreed: false
  },

  onAgreeTap() {
    this.setData({ agreed: !this.data.agreed });
  },

  onLogin() {
    if (!this.data.agreed) {
      wx.showToast({
        title: '请先阅读并同意用户协议和隐私政策',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    wx.showLoading({ title: '登录中...', mask: true });

    auth.wxLogin()
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '登录成功', icon: 'success', duration: 1500 });
        setTimeout(() => {
          wx.navigateBack({
            delta: 1,
            fail() {
              wx.switchTab({ url: '/pages/index/index' });
            }
          });
        }, 1500);
      })
      .catch(err => {
        wx.hideLoading();
        const msg = (err && (err.message || err.errMsg)) || '登录失败，请重试';
        wx.showToast({ title: msg, icon: 'none', duration: 2000 });
      });
  },

  onAgreementTap() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onPrivacyTap() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  }
});