const { request } = require('../../utils/request');
const {
  SUBSCRIBE_TEMPLATES,
  fetchTemplates,
  requestSubscribeMessage,
  markTemplatesAccepted,
  getLocalAcceptedMap
} = require('../../utils/subscribe-message');

Page({
  data: {
    templatesWithStatus: [],
    loading: true
  },

  onLoad() {
    this.loadSubscribedStatus();
  },

  onShow() {
    this.loadSubscribedStatus();
  },

  loadSubscribedStatus() {
    this.setData({ loading: true });

    fetchTemplates().then(() => {
      const allIds = [
        { key: 'bookingSuccess', id: SUBSCRIBE_TEMPLATES.BOOKING_SUCCESS, name: '预约成功通知', desc: '预约课程成功后收到确认通知' },
        { key: 'classReminder', id: SUBSCRIBE_TEMPLATES.CLASS_REMINDER, name: '上课提醒', desc: '课前1小时和30分钟提醒' },
        { key: 'bookingCancel', id: SUBSCRIBE_TEMPLATES.BOOKING_CANCEL, name: '课程取消通知', desc: '课程被取消时收到通知' },
        { key: 'bookingCancelByUser', id: SUBSCRIBE_TEMPLATES.BOOKING_CANCEL_BY_USER, name: '预约取消通知', desc: '取消预约后收到确认' },
        { key: 'waitlistAvailable', id: SUBSCRIBE_TEMPLATES.WAITLIST_AVAILABLE, name: '候补成功通知', desc: '候补转正后收到通知' },
        { key: 'packageExpiring', id: SUBSCRIBE_TEMPLATES.PACKAGE_EXPIRING, name: '套餐到期提醒', desc: '套餐即将到期时提醒续费' },
        { key: 'packageActivated', id: SUBSCRIBE_TEMPLATES.PACKAGE_ACTIVATED, name: '套餐激活通知', desc: '套餐激活后收到确认' },
        { key: 'countCardLow', id: SUBSCRIBE_TEMPLATES.COUNT_CARD_LOW_REMIND, name: '次卡低次数提醒', desc: '剩余次数不足时提醒' },
        { key: 'inactive', id: SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND, name: '不活跃提醒', desc: '长时间未约课时提醒' },
        { key: 'phoneAudit', id: SUBSCRIBE_TEMPLATES.PHONE_AUDIT_RESULT, name: '手机号审核结果', desc: '手机号修改审核后通知' }
      ].filter(item => item.id);

      const localAccepted = getLocalAcceptedMap();

      wx.getSetting({
        withSubscriptions: true,
        success: (res) => {
          const subscriptions = res.subscriptionsSetting || {};
          const itemSettings = subscriptions.itemSettings || {};
          const templatesWithStatus = allIds.map(item => ({
            ...item,
            subscribed: itemSettings[item.id] === 'accept' || !!localAccepted[item.id]
          }));
          this.setData({ templatesWithStatus, loading: false });
        },
        fail: () => {
          const templatesWithStatus = allIds.map(item => ({
            ...item,
            subscribed: !!localAccepted[item.id]
          }));
          this.setData({ templatesWithStatus, loading: false });
        }
      });
    });
  },

  async onSubscribeAll() {
    await fetchTemplates();
    const unsubscribed = this.data.templatesWithStatus.filter(item => !item.subscribed);

    if (unsubscribed.length === 0) {
      wx.showToast({ title: '全部已订阅', icon: 'success' });
      return;
    }

    const batchSize = 3;
    const newlyAccepted = [];

    for (let i = 0; i < unsubscribed.length; i += batchSize) {
      const batch = unsubscribed.slice(i, i + batchSize);
      const batchIds = batch.map(item => item.id);
      const result = await requestSubscribeMessage(batchIds, 'settings');

      if (result && typeof result === 'object') {
        const acceptedIds = [];
        batch.forEach(item => {
          if (result[item.id] === 'accept') {
            acceptedIds.push(item.id);
          }
        });
        if (acceptedIds.length > 0) {
          newlyAccepted.push(...acceptedIds);
          markTemplatesAccepted(acceptedIds);
        }
      }
    }

    if (newlyAccepted.length > 0) {
      // 立即刷新 UI
      const templatesWithStatus = this.data.templatesWithStatus.map(item => ({
        ...item,
        subscribed: item.subscribed || newlyAccepted.includes(item.id)
      }));
      this.setData({ templatesWithStatus });
    }

    wx.showToast({ title: newlyAccepted.length > 0 ? '订阅成功' : '已处理', icon: newlyAccepted.length > 0 ? 'success' : 'none' });
    setTimeout(() => this.loadSubscribedStatus(), 500);
  },

  async onSubscribeItem(e) {
    const key = e.currentTarget.dataset.key;
    await fetchTemplates();
    const item = this.data.templatesWithStatus.find(t => t.key === key);
    if (!item || !item.id) return;

    const result = await requestSubscribeMessage([item.id], 'settings_' + key);

    if (result && result[item.id] === 'accept') {
      markTemplatesAccepted([item.id]);
      wx.showToast({ title: '订阅成功', icon: 'success' });
      this.loadSubscribedStatus();
    }
  }
});
