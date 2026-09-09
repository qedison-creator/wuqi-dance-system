// 版本更新提醒弹窗组件
// 配合 app.js 的 setupUpdateManager 使用：
// - 新版本下载完成后（onUpdateReady）由 app 通知所有已挂载组件弹窗提醒
// - 组件挂载时向 app 注册自身；页面 onShow（pageLifetimes.show）时检查待提醒状态
// - 点击"立即重启"调用 applyUpdate() 应用新版本并重启（微信自动管理代码包缓存）
Component({
  data: {
    visible: false,
    updating: false
  },

  lifetimes: {
    attached() {
      const app = getApp();
      if (typeof app.registerUpdateModal === 'function') {
        app.registerUpdateModal(this);
      }
    },
    detached() {
      const app = getApp();
      if (typeof app.unregisterUpdateModal === 'function') {
        app.unregisterUpdateModal(this);
      }
    }
  },

  pageLifetimes: {
    show() {
      // 页面每次显示（含从其他页面返回、tab 切换）时检查更新状态
      const app = getApp();
      if (app.globalData.updateReady && !app.globalData.updateDismissed) {
        this.showModal();
      }
    }
  },

  methods: {
    // 显示弹窗（防重复）
    showModal() {
      if (this.data.visible) return;
      this.setData({ visible: true });
    },

    // 忽略本次更新：本次运行期不再提醒，下次冷启动微信自动应用新版本
    dismiss() {
      const app = getApp();
      app.globalData.updateDismissed = true;
      this.setData({ visible: false });
    },

    // 确认重启：应用新版本，微信自动清理旧版本缓存并重启小程序
    onConfirm() {
      if (this.data.updating) return;
      this.setData({ updating: true });
      wx.getUpdateManager().applyUpdate();
    },

    // 阻止冒泡
    noop() {}
  }
})
