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
    loading: true,
    unsubscribedCount: 0
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
          // wxStatus: 'accept'=已授权(勾了"总是保持"), 'reject'=已拒绝(无法再弹出), 'ban'=被禁用, undefined=未处理
          // 注意：对于一次性订阅消息，用户曾经点过"允许"但没勾"总是保持"，也需要重新授权
          // isSubscribed: 仅当 itemSettings[id] === 'accept'（勾了"总是保持"并点了允许）时才算已订阅
          // wasAcceptedOnce: 本地记录曾经点过"允许"，但微信未记录（可能未勾总是保持），需重新订阅
          const templatesWithStatus = allIds.map(item => {
            const wxStatus = itemSettings[item.id];
            const isSubscribed = wxStatus === 'accept';
            const wasAcceptedOnce = !wxStatus && !!localAccepted[item.id];
            const isRejected = wxStatus === 'reject' || wxStatus === 'ban';
            return {
              ...item,
              subscribed: isSubscribed,
              wasAcceptedOnce: wasAcceptedOnce,
              rejected: isRejected,
              canSubscribe: !isSubscribed && !isRejected  // 只要不是永久订阅且未拒绝，都可重新订阅
            };
          });
          const unsubscribedCount = templatesWithStatus.filter(t => t.canSubscribe).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        },
        fail: () => {
          // wx.getSetting 失败时，仅以本地记录做参考（标记为 wasAcceptedOnce，不标记为 subscribed）
          const templatesWithStatus = allIds.map(item => ({
            ...item,
            subscribed: false,
            wasAcceptedOnce: !!localAccepted[item.id],
            rejected: false,
            canSubscribe: true
          }));
          const unsubscribedCount = templatesWithStatus.filter(t => t.canSubscribe).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        }
      });
    });
  },

  // "一键订阅"：微信限制每次用户操作只能弹一次授权窗口，每次最多3个模板
  // 策略：每次点击处理最多3个可重新订阅的模板（排除已永久拒绝的）
  onSubscribeAll() {
    const canSubscribe = this.data.templatesWithStatus.filter(item => item.canSubscribe);

    if (canSubscribe.length === 0) {
      // 检查是否全部是已拒绝的
      const rejected = this.data.templatesWithStatus.filter(item => item.rejected && !item.subscribed);
      if (rejected.length > 0) {
        wx.showModal({
          title: '无法订阅',
          content: `有 ${rejected.length} 个通知模板已被永久拒绝，无法再次弹出授权。请在微信「设置→订阅消息」中手动开启。`,
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        wx.showToast({ title: '全部已订阅', icon: 'success' });
      }
      return;
    }

    // 只取前3个可订阅的
    const batch = canSubscribe.slice(0, 3);
    const batchIds = batch.map(item => item.id);

    wx.showLoading({ title: '请求授权...', mask: true });

    wx.requestSubscribeMessage({
      tmplIds: batchIds,
      success: (res) => {
        wx.hideLoading();
        
        const acceptedIds = [];
        const rejectedIds = [];
        batch.forEach(item => {
          if (res[item.id] === 'accept') {
            acceptedIds.push(item.id);
          } else {
            rejectedIds.push(item.id);
          }
        });

        if (acceptedIds.length > 0) {
          markTemplatesAccepted(acceptedIds);
        }

        // 计算剩余可订阅数量
        const updatedList = this.data.templatesWithStatus.map(item => ({
          ...item,
          subscribed: item.subscribed || acceptedIds.includes(item.id),
          canSubscribe: item.canSubscribe && !acceptedIds.includes(item.id)
        }));
        const remainingAfter = updatedList.filter(t => t.canSubscribe).length;
        
        this.setData({ templatesWithStatus: updatedList, unsubscribedCount: remainingAfter });

        // 显示结果弹窗（避免toast字数限制）
        if (acceptedIds.length > 0 && remainingAfter > 0) {
          wx.showModal({
            title: '部分订阅成功',
            content: `已订阅 ${acceptedIds.length} 个通知，还有 ${remainingAfter} 个未订阅。点击「继续订阅」处理剩余通知。`,
            confirmText: '继续订阅',
            cancelText: '知道了',
            confirmColor: '#C5744B',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.onSubscribeAll();
              }
            }
          });
        } else if (acceptedIds.length > 0 && remainingAfter === 0) {
          wx.showToast({ title: '全部订阅完成', icon: 'success' });
        } else {
          wx.showToast({ title: '未授权，可重试', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      }
    });
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
