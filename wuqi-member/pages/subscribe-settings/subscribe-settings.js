const { request } = require('../../utils/request');
const { fetchTemplates, requestBookingSubscribe, requestCancelSubscribe, requestWaitlistSubscribe, requestWaitlistAndBookingSubscribe, requestPackageSubscribe, requestPhoneAuditSubscribe } = require('../../utils/subscribe-message');

Page({
  data: {
    subscribedStatus: {
      booking: false,
      cancel: false,
      classReminder: false,
      waitlist: false,
      package: false,
      countCardLow: false,
      packageActivated: false,
      inactive: false,
      phoneAudit: false,
    }
  },

  onLoad() {
    this.loadSubscribedStatus();
  },

  onShow() {
    this.loadSubscribedStatus();
  },

  // 从本地缓存读取订阅状态（记录的是用户是否曾授权过该场景）
  loadSubscribedStatus() {
    const keys = ['booking', 'cancel', 'classReminder', 'waitlist', 'package', 'countCardLow', 'packageActivated', 'inactive', 'phoneAudit'];
    const status = {};
    keys.forEach(key => {
      // 检查是否曾跳过该场景的引导（跳过的不算已订阅）
      // 这里只能记录用户是否点过"去授权"，无法真正查询微信的订阅状态
      const skipped = wx.getStorageSync(`subscribe_guide_${key}`);
      // 如果缓存存在且未过期，说明用户跳过（未授权）
      // 如果缓存不存在，我们假设用户可能已经授权过
      // 实际上微信不允许查询订阅状态，所以这里只能做一个"提示"作用
      status[key] = false; // 默认显示"去订阅"
    });
    this.setData({ subscribedStatus: status });
  },

  // 点击订阅按钮
  async onSubscribe(e) {
    const type = e.currentTarget.dataset.type;
    try {
      await fetchTemplates();
      let result = null;
      let sceneKey = '';

      switch (type) {
        case 'booking':
          sceneKey = 'booking';
          result = await requestBookingSubscribe();
          break;
        case 'cancel':
          sceneKey = 'cancel';
          result = await requestCancelSubscribe();
          break;
        case 'classReminder':
          // 上课提醒包含在预约订阅中，单独触发一次
          sceneKey = 'booking';
          result = await requestBookingSubscribe();
          break;
        case 'waitlist':
          sceneKey = 'waitlist';
          result = await requestWaitlistAndBookingSubscribe();
          break;
        case 'package':
        case 'countCardLow':
          sceneKey = 'package';
          result = await requestPackageSubscribe();
          break;
        case 'packageActivated':
          sceneKey = 'package';
          result = await requestPackageSubscribe();
          break;
        case 'inactive':
          sceneKey = 'package';
          result = await requestPackageSubscribe();
          break;
        case 'phoneAudit':
          sceneKey = 'phoneAudit';
          result = await requestPhoneAuditSubscribe();
          break;
      }

      // 检查授权结果
      if (result && typeof result === 'object') {
        const accepted = Object.values(result).some(v => v === 'accept');
        if (accepted) {
          wx.showToast({ title: '订阅成功', icon: 'success' });
          // 更新本地状态
          const status = this.data.subscribedStatus;
          status[type] = true;
          this.setData({ subscribedStatus: status });
        }
      }
    } catch (err) {
      console.error('[SubscribeSettings] 订阅失败:', err);
    }
  },
});
