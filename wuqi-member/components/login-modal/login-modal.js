const app = getApp();

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    agreed: false
  },

  // 弹窗显示/隐藏时重置勾选状态
  observers: {
    'visible': function(newVal) {
      if (newVal) {
        this.setData({ agreed: false });
      }
    }
  },

  methods: {
    /* 点击遮罩关闭 */
    onClose() {
      this.triggerEvent('close');
    },

    /* 阻止点击卡片时冒泡到遮罩 */
    onModalTap() {},

    /* 切换隐私协议勾选状态 */
    onToggleAgree() {
      this.setData({ agreed: !this.data.agreed });
    },

    /* 打开隐私政策 */
    onOpenPrivacy() {
      wx.navigateTo({ url: '/package-sub/pages/privacy/privacy' });
    },

    /* 打开用户协议 */
    onOpenAgreement() {
      wx.navigateTo({ url: '/package-sub/pages/agreement/agreement' });
    },

    /* 授权手机号回调——直接调微信官方弹窗 */
    onGetPhoneNumber(e) {
      if (!this.data.agreed) {
        wx.showToast({ title: '请先阅读并同意隐私保护指引和用户协议', icon: 'none' });
        return;
      }

      const detail = e.detail || {};
      const phoneCode = detail.code;

      if (!phoneCode) {
        wx.showToast({ title: '未获取到授权', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '登录中...', mask: true });
      const self = this;

      wx.login({
        success: (loginRes) => {
          const sessionCode = loginRes.code;
          const baseUrl = (app && app.globalData && app.globalData.baseUrl) || '';

          const reqData = {
            code: sessionCode,
            phone_code: phoneCode
          };

          if (!baseUrl) {
            setTimeout(() => {
              wx.hideLoading();
              wx.setStorageSync('token', 'mock-token');
              app.globalData.token = 'mock-token';
              wx.showToast({ title: '登录成功', icon: 'success', duration: 1200 });
              self.triggerEvent('success');
              self.triggerEvent('close');
            }, 600);
            return;
          }

          wx.request({
            url: baseUrl + '/auth/wx-login',
            method: 'POST',
            header: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (app.globalData.token || wx.getStorageSync('token') || '')
            },
            data: reqData,
            success: (res) => {
              wx.hideLoading();
              if (res.statusCode === 200 && res.data && res.data.code === 200) {
                const respData = res.data.data || {};
                const token = respData.token || '';
                const respUser = respData.user || null;

                if (token) {
                  wx.setStorageSync('token', token);
                  app.globalData.token = token;
                }

                // 登录成功后调用 /auth/me 获取完整用户信息

                wx.request({
                  url: baseUrl + '/auth/me',
                  method: 'GET',
                  header: {
                    'Authorization': 'Bearer ' + token
                  },
                  success: (meRes) => {
                    if (meRes.statusCode === 200 && meRes.data && meRes.data.data) {
                      const fullUserInfo = meRes.data.data;
                      app.globalData.userInfo = fullUserInfo;
                      wx.setStorageSync('userInfo', fullUserInfo);
                      app.resetAndMatchStore();
                      self.triggerEvent('success', { userInfo: fullUserInfo });
                    } else if (respUser) {
                      app.globalData.userInfo = respUser;
                      wx.setStorageSync('userInfo', respUser);
                      app.resetAndMatchStore();
                      self.triggerEvent('success', { userInfo: respUser });
                    }
                    self.triggerEvent('close');
                  },
                  fail: () => {
                    // /auth/me 失败时用登录返回的user

                    if (respUser) {
                      app.globalData.userInfo = respUser;
                      wx.setStorageSync('userInfo', respUser);
                      app.resetAndMatchStore();
                    }
                    self.triggerEvent('success', { userInfo: respUser });
                    self.triggerEvent('close');
                  }
                });

                wx.showToast({ title: '登录成功', icon: 'success', duration: 1200 });
              } else {
                const msg = (res.data && res.data.msg) || '登录失败，请重试';
                wx.showToast({ title: msg, icon: 'none' });
              }
            },
            fail: () => {
              wx.hideLoading();
              wx.showToast({ title: '登录失败，请重试', icon: 'none' });
            }
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        }
      });
    }
  }
});