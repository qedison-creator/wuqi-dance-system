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
    // 从小程序设置页返回时自动刷新（用户可能在设置页手动开启了订阅）
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
          // - wxStatus === 'reject'/'ban'：用户永久拒绝，无法再弹窗，只能去设置页开启
          // - wxStatus === undefined：一次性授权（未勾"总是保持"）或从未授权
          //   本地 subscribe_accepted_map 记录了用户曾点过"允许"，视为"已授权(一次性)"
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
              // 待授权和一次性都可再次发起授权（一次性可续订补充配额）
              canSubscribe: !isAccepted && !isRejected
            };
          });
          const unsubscribedCount = templatesWithStatus.filter(t => !t.subscribed && !t.onceAccepted && !t.rejected).length;
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
          const unsubscribedCount = templatesWithStatus.filter(t => !t.onceAccepted).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        }
      });
    });
  },

  // 单条授权/续订：自动凑批（带上其他待授权模板，最多3个），
  // 弹窗包含多个模板时才会出现「总是保持以上选择」勾选框，允许后即长期订阅
  onSubscribeSingle(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;

    // 凑批：本模板优先，再补充其他可授权模板（最多3个，微信单次上限）
    const others = this.data.templatesWithStatus
      .filter(t => t.id !== id && t.canSubscribe)
      .slice(0, 2)
      .map(t => t.id);
    const batchIds = [id, ...others];

    wx.requestSubscribeMessage({
      tmplIds: batchIds,
      success: (res) => {
        const accepted = batchIds.filter(tid => res[tid] === 'accept');
        if (accepted.length > 0) markTemplatesAccepted(accepted);
        if (res[id] === 'accept') {
          wx.showToast({ title: '订阅成功', icon: 'success' });
        } else {
          wx.showToast({ title: '未授权', icon: 'none' });
        }
        // 重新读取微信真实状态，准确区分长期订阅/一次性授权/已拒绝
        this.loadSubscribedStatus();
      },
      fail: () => {
        wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      }
    });
  },

  // 已拒绝的模板：跳转小程序设置页，让用户在「订阅消息」中手动开启
  // 返回后 onShow 自动刷新状态
  onGoToSetting() {
    wx.openSetting({
      withSubscriptions: true
    });
  },

  // "一键订阅"：每批最多3个模板，批间通过 modal「继续授权」衔接完成全部授权
  // （modal 的确认点击保留手势上下文，可在回调中继续调用 wx.requestSubscribeMessage）
  onSubscribeAll() {
    const canSubscribe = this.data.templatesWithStatus.filter(item => item.canSubscribe);
    const rejectedCount = this.data.templatesWithStatus.filter(item => item.rejected).length;

    if (canSubscribe.length === 0) {
      if (rejectedCount > 0) {
        wx.showModal({
          title: '无法自动订阅',
          content: `有 ${rejectedCount} 个通知类型已被拒绝，无法再次弹出授权窗口。请点击对应类型的「去设置开启」按钮，在小程序设置页中手动开启。`,
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        wx.showToast({ title: '全部已订阅', icon: 'success' });
      }
      return;
    }

    this._subscribeBatches(canSubscribe, rejectedCount);
  },

  // 递归分批授权：每批3个，授权完弹「继续授权」处理下一批
  _subscribeBatches(remainingList, totalRejected) {
    const batch = remainingList.slice(0, 3);
    const batchIds = batch.map(item => item.id);

    wx.requestSubscribeMessage({
      tmplIds: batchIds,
      success: (res) => {
        const accepted = batchIds.filter(id => res[id] === 'accept');
        if (accepted.length > 0) markTemplatesAccepted(accepted);

        const rest = remainingList.slice(3);
        if (rest.length > 0) {
          // 更新已授权部分的状态（列表刷新交给 loadSubscribedStatus，批次队列自己维护避免竞态）
          this.loadSubscribedStatus();
          wx.showModal({
            title: '本批授权完成',
            content: `已授权 ${accepted.length}/${batch.length} 个，还剩 ${rest.length} 个待授权。建议在授权弹窗中勾选「总是保持以上选择」，一次授权长期有效。`,
            confirmText: '继续授权',
            cancelText: '稍后再说',
            showCancel: true,
            confirmColor: '#C5744B',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this._subscribeBatches(rest, totalRejected);
              }
            }
          });
        } else {
          // 全部批次处理完毕
          this.loadSubscribedStatus();
          const notAcceptedInBatch = batch.length - accepted.length;
          if (accepted.length > 0 && notAcceptedInBatch === 0 && totalRejected === 0) {
            wx.showToast({ title: '全部订阅完成', icon: 'success' });
          } else {
            const parts = [`已成功订阅 ${accepted.length} 个通知`];
            if (notAcceptedInBatch > 0) parts.push(`${notAcceptedInBatch} 个未授权`);
            if (totalRejected > 0) parts.push(`${totalRejected} 个已被拒绝（可点击「去设置开启」恢复）`);
            wx.showModal({
              title: '订阅结束',
              content: parts.join('，') + '。',
              showCancel: false,
              confirmText: '知道了',
              confirmColor: '#C5744B'
            });
          }
        }
      },
      fail: () => {
        wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      }
    });
  }
});
