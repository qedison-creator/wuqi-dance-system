const { request } = require('../../../utils/request');
const {
  SUBSCRIBE_TEMPLATES,
  fetchTemplates,
  markTemplatesAccepted,
  getLocalAcceptedMap
} = require('../../../utils/subscribe-message');

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
          // 微信订阅消息状态判定：
          // - wxStatus === 'accept'：用户勾了"总是保持"并点了允许，微信永久记录
          // - wxStatus === 'reject'/'ban'：用户永久拒绝，无法再弹窗
          // - wxStatus === undefined：用户点过"允许"但未勾"总是保持"（一次性消费），或从未授权
          //   此时本地 subscribe_accepted_map 记录了用户曾点过"允许"，应视为"已订阅"（一次性配额已发放）
          //   只有本地也无记录时，才是"待授权"
          const templatesWithStatus = allIds.map(item => {
            const wxStatus = itemSettings[item.id];
            const isAccepted = wxStatus === 'accept';
            const isOnceAccepted = !isAccepted && !!localAccepted[item.id] && wxStatus !== 'reject' && wxStatus !== 'ban';
            const isRejected = wxStatus === 'reject' || wxStatus === 'ban';
            return {
              ...item,
              subscribed: isAccepted,
              onceAccepted: isOnceAccepted,
              rejected: isRejected,
              canSubscribe: !isAccepted && !isOnceAccepted && !isRejected
            };
          });
          const unsubscribedCount = templatesWithStatus.filter(t => t.canSubscribe).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        },
        fail: () => {
          // wx.getSetting 失败时，以本地记录为准（点过"允许"即视为已订阅）
          const templatesWithStatus = allIds.map(item => ({
            ...item,
            subscribed: false,
            onceAccepted: !!localAccepted[item.id],
            rejected: false,
            canSubscribe: !localAccepted[item.id]
          }));
          const unsubscribedCount = templatesWithStatus.filter(t => t.canSubscribe).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        }
      });
    });
  },

  // 单条授权：点击"待授权"对该模板单独弹出授权窗口
  onSubscribeSingle(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;

    wx.requestSubscribeMessage({
      tmplIds: [id],
      success: (res) => {
        if (res[id] === 'accept') {
          markTemplatesAccepted([id]);
          // 重新读取微信真实状态，准确区分永久订阅/一次性授权
          this.loadSubscribedStatus();
          wx.showToast({ title: '订阅成功', icon: 'success' });
        } else {
          wx.showToast({ title: '未授权', icon: 'none' });
          this.loadSubscribedStatus();
        }
      },
      fail: () => {
        wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      }
    });
  },

  // "一键订阅"：微信限制每次用户点击只能弹1次授权窗，每次最多3个模板
  // 每次点击处理一批（最多3个），剩余的提示用户再次点击继续
  // 不能在 wx.requestSubscribeMessage 的 success 回调中链式调用下一批，
  // 因为异步回调已脱离用户 tap 事件上下文，微信不会弹出授权窗
  onSubscribeAll() {
    const canSubscribe = this.data.templatesWithStatus.filter(item => item.canSubscribe);

    if (canSubscribe.length === 0) {
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

    // 取第一批（最多3个），微信单次授权上限为3个模板
    const batch = canSubscribe.slice(0, 3);
    const batchIds = batch.map(item => item.id);

    wx.requestSubscribeMessage({
      tmplIds: batchIds,
      success: (res) => {
        const accepted = [];
        const rejectedInBatch = [];
        batch.forEach(item => {
          if (res[item.id] === 'accept') {
            accepted.push(item.id);
          } else {
            rejectedInBatch.push(item.id);
          }
        });

        if (accepted.length > 0) {
          markTemplatesAccepted(accepted);
        }

        // 更新列表状态：已接受和本批已拒绝的都标记为不可再订阅
        const acceptedSet = new Set(accepted);
        const rejectedSet = new Set(rejectedInBatch);
        const updatedList = this.data.templatesWithStatus.map(item => {
          if (acceptedSet.has(item.id)) {
            return { ...item, subscribed: true, canSubscribe: false };
          }
          if (rejectedSet.has(item.id)) {
            return { ...item, canSubscribe: false };
          }
          return item;
        });
        const remainingAfter = updatedList.filter(t => t.canSubscribe).length;
        this.setData({ templatesWithStatus: updatedList, unsubscribedCount: remainingAfter });

        if (remainingAfter > 0) {
          // 还有剩余，提示用户再次点击继续授权
          wx.showModal({
            title: '本批授权完成',
            content: `已授权 ${accepted.length} 个，还有 ${remainingAfter} 个待授权。请再次点击「一键订阅」继续授权剩余通知。`,
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#C5744B'
          });
        } else {
          // 全部处理完毕
          if (accepted.length > 0 && rejectedInBatch.length === 0) {
            wx.showToast({ title: '全部订阅完成', icon: 'success' });
          } else {
            wx.showModal({
              title: '订阅完成',
              content: `已成功订阅 ${accepted.length} 个通知${rejectedInBatch.length > 0 ? `，${rejectedInBatch.length} 个未授权` : ''}。`,
              showCancel: false,
              confirmText: '知道了',
              confirmColor: '#C5744B'
            });
          }
          this.loadSubscribedStatus();
        }
      },
      fail: () => {
        wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      }
    });
  }
});