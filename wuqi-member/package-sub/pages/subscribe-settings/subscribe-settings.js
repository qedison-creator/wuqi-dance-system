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
            const isSubscribed = wxStatus === 'accept' || (!!localAccepted[item.id] && wxStatus !== 'reject' && wxStatus !== 'ban');
            const isRejected = wxStatus === 'reject' || wxStatus === 'ban';
            return {
              ...item,
              subscribed: isSubscribed,
              wasAcceptedOnce: false,
              rejected: isRejected,
              canSubscribe: !isSubscribed && !isRejected
            };
          });
          const unsubscribedCount = templatesWithStatus.filter(t => t.canSubscribe).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        },
        fail: () => {
          // wx.getSetting 失败时，以本地记录为准（点过"允许"即视为已订阅）
          const templatesWithStatus = allIds.map(item => ({
            ...item,
            subscribed: !!localAccepted[item.id],
            wasAcceptedOnce: false,
            rejected: false,
            canSubscribe: !localAccepted[item.id]
          }));
          const unsubscribedCount = templatesWithStatus.filter(t => t.canSubscribe).length;
          this.setData({ templatesWithStatus, loading: false, unsubscribedCount });
        }
      });
    });
  },

  // "一键订阅"：微信限制每次用户操作只能弹一次授权窗口，每次最多3个模板
  // 策略：每次处理一批（最多3个），处理完后用 showModal 询问是否继续下一批
  // 必须在用户点击事件上下文中调用 wx.requestSubscribeMessage，不能在异步回调中自动调用
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

    // 开始第一批授权
    this._processBatch(canSubscribe, 0, { accepted: [], rejected: [] });
  },

  // 处理一批授权（最多3个模板）
  _processBatch(canSubscribeList, startIndex, accum) {
    const batch = canSubscribeList.slice(startIndex, startIndex + 3);
    if (batch.length === 0) {
      this._showFinalResult(accum, canSubscribeList.length);
      return;
    }
    const batchIds = batch.map(item => item.id);
    const batchNames = batch.map(item => item.name);
    const totalBatches = Math.ceil(canSubscribeList.length / 3);
    const currentBatchNum = Math.floor(startIndex / 3) + 1;

    wx.showLoading({
      title: `授权中(${currentBatchNum}/${totalBatches})`,
      mask: true
    });

    wx.requestSubscribeMessage({
      tmplIds: batchIds,
      success: (res) => {
        wx.hideLoading();

        batch.forEach(item => {
          if (res[item.id] === 'accept') {
            accum.accepted.push(item.id);
          } else {
            accum.rejected.push(item.id);
          }
        });

        if (accum.accepted.length > 0) {
          markTemplatesAccepted(accum.accepted);
        }

        // 实时更新列表状态
        const updatedList = this.data.templatesWithStatus.map(item => ({
          ...item,
          subscribed: item.subscribed || accum.accepted.includes(item.id),
          canSubscribe: item.canSubscribe && !accum.accepted.includes(item.id)
        }));
        const remainingAfter = updatedList.filter(t => t.canSubscribe).length;
        this.setData({ templatesWithStatus: updatedList, unsubscribedCount: remainingAfter });

        // 检查是否还有下一批
        const nextStart = startIndex + 3;
        if (nextStart < canSubscribeList.length && remainingAfter > 0) {
          // 还有剩余，弹窗询问是否继续（用户点击"继续"触发下一批，保持在用户事件上下文中）
          const acceptedSoFar = accum.accepted.length;
          wx.showModal({
            title: `第${currentBatchNum}批完成`,
            content: `已成功授权 ${acceptedSoFar} 个通知，还有 ${remainingAfter} 个待授权。点击「继续」授权剩余通知。`,
            confirmText: '继续',
            cancelText: '稍后',
            confirmColor: '#C5744B',
            success: (modalRes) => {
              if (modalRes.confirm) {
                // 用户点击"继续"，在用户事件上下文中调用下一批
                this._processBatch(canSubscribeList, nextStart, accum);
              } else {
                // 用户选择稍后，显示当前结果
                this._showFinalResult(accum, canSubscribeList.length);
              }
            }
          });
        } else {
          // 所有批次处理完毕
          this._showFinalResult(accum, canSubscribeList.length);
        }
      },
      fail: () => {
        wx.hideLoading();
        if (startIndex === 0) {
          wx.showToast({ title: '授权失败，请重试', icon: 'none' });
        } else {
          this._showFinalResult(accum, canSubscribeList.length);
        }
      }
    });
  },

  _showFinalResult(accum, total) {
    const acceptedCount = accum.accepted.length;
    const rejectedCount = accum.rejected.length;

    if (acceptedCount === total) {
      wx.showToast({ title: '全部订阅完成', icon: 'success' });
    } else if (acceptedCount > 0) {
      wx.showModal({
        title: '订阅完成',
        content: `已成功订阅 ${acceptedCount} 个通知${rejectedCount > 0 ? `，${rejectedCount} 个未授权` : ''}。可稍后再次点击「一键订阅」处理未授权项。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#C5744B'
      });
    } else {
      wx.showToast({ title: '未授权，可重试', icon: 'none' });
    }
    this.loadSubscribedStatus();
  }
});