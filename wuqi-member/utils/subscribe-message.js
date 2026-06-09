/**
 * 微信订阅消息工具函数
 * 
 * 微信订阅消息机制：
 * - 每次授权只能发一条消息（一次性消费）
 * - wx.requestSubscribeMessage 一次最多传 3 个模板ID
 * - 必须在用户点击事件中调用
 * - 用户勾选"总是保持以上选择"后可免弹窗
 * 
 * 授权策略：每个操作最多弹 1 次授权弹窗（最多3个模板），分散到各场景
 */

const config = require('../config/index.js');

const SUBSCRIBE_TEMPLATES = {
  BOOKING_SUCCESS: '',
  BOOKING_CANCEL: '',
  CLASS_REMINDER: '',
  WAITLIST_AVAILABLE: '',
  PACKAGE_EXPIRING: '',
  PACKAGE_ACTIVATED: '',
  COUNT_CARD_LOW_REMIND: '',
  MEMBER_INACTIVE_REMIND: '',
  PHONE_AUDIT_RESULT: ''
};

let templatesLoaded = false;
let templatesLoading = false;
let templatesPromise = null;

const fetchTemplates = (force = false) => {
  if (templatesLoaded && !force) return Promise.resolve();
  if (templatesLoading && templatesPromise) return templatesPromise;

  templatesLoading = true;
  templatesPromise = new Promise((resolve) => {
    const app = getApp();
    const baseUrl = (app && app.globalData && app.globalData.baseUrl) || config.baseUrl;
    wx.request({
      url: baseUrl + '/config/active-templates',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.code === 200 && res.data.data) {
          const tpl = res.data.data;
          if (tpl.bookingSuccessTemplateId) SUBSCRIBE_TEMPLATES.BOOKING_SUCCESS = tpl.bookingSuccessTemplateId;
          if (tpl.classReminderTemplateId) SUBSCRIBE_TEMPLATES.CLASS_REMINDER = tpl.classReminderTemplateId;
          if (tpl.bookingCancelTemplateId) SUBSCRIBE_TEMPLATES.BOOKING_CANCEL = tpl.bookingCancelTemplateId;
          if (tpl.waitlistAvailableTemplateId) SUBSCRIBE_TEMPLATES.WAITLIST_AVAILABLE = tpl.waitlistAvailableTemplateId;
          if (tpl.packageExpiringTemplateId) SUBSCRIBE_TEMPLATES.PACKAGE_EXPIRING = tpl.packageExpiringTemplateId;
          if (tpl.packageActivatedTemplateId) SUBSCRIBE_TEMPLATES.PACKAGE_ACTIVATED = tpl.packageActivatedTemplateId;
          if (tpl.countCardLowRemindTemplateId) SUBSCRIBE_TEMPLATES.COUNT_CARD_LOW_REMIND = tpl.countCardLowRemindTemplateId;
          if (tpl.memberInactiveRemindTemplateId) SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND = tpl.memberInactiveRemindTemplateId;
          if (tpl.phoneAuditResultTemplateId) SUBSCRIBE_TEMPLATES.PHONE_AUDIT_RESULT = tpl.phoneAuditResultTemplateId;
        }
        templatesLoaded = true;
        templatesLoading = false;
        resolve();
      },
      fail: (err) => {
        console.error('[SubscribeMessage] 加载模板失败:', err);
        templatesLoaded = true;
        templatesLoading = false;
        resolve();
      }
    });
  });
  return templatesPromise;
};

/**
 * 请求订阅消息授权（单次最多3个模板ID，弹1次窗）
 * 先弹引导提示，再调微信授权
 */
const requestSubscribeMessage = (tmplIds) => {
  return new Promise((resolve) => {
    const validIds = [...new Set((Array.isArray(tmplIds) ? tmplIds : [tmplIds]).filter(id => id && id.trim()))];
    if (validIds.length === 0) {
      resolve({});
      return;
    }

    // 先弹引导提示，引导用户勾选"总是保持以上选择"
    wx.showModal({
      title: '开启消息通知',
      content: '为了及时收到上课提醒、课程变动等通知，请在接下来弹出的窗口中勾选「总是保持以上选择，不再询问」，这样以后就不会再重复弹窗啦～',
      confirmText: '知道了',
      showCancel: false,
      success: () => {
        wx.requestSubscribeMessage({
          tmplIds: validIds,
          success: (res) => {
            resolve(res);
          },
          fail: (err) => {
            console.error('[SubscribeMessage] 授权失败:', err);
            resolve({});
          }
        });
      }
    });
  });
};

// ========== 各场景订阅函数（每次最多弹1次窗） ==========

/**
 * 预约课程时：预约成功 + 上课提醒 + 取消通知
 */
const requestBookingSubscribe = async () => {
  await fetchTemplates(true);
  const ids = [
    SUBSCRIBE_TEMPLATES.BOOKING_SUCCESS,
    SUBSCRIBE_TEMPLATES.CLASS_REMINDER,
    SUBSCRIBE_TEMPLATES.BOOKING_CANCEL
  ].filter(id => id);
  if (ids.length === 0) return Promise.resolve({});
  return requestSubscribeMessage(ids);
};

/**
 * 取消预约时：取消通知 + 不活跃提醒 + 次卡低次数
 */
const requestCancelSubscribe = async () => {
  await fetchTemplates(true);
  const ids = [
    SUBSCRIBE_TEMPLATES.BOOKING_CANCEL,
    SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND,
    SUBSCRIBE_TEMPLATES.COUNT_CARD_LOW_REMIND
  ].filter(id => id);
  if (ids.length === 0) return Promise.resolve({});
  return requestSubscribeMessage(ids);
};

/**
 * 加入候补时：候补成功 + 上课提醒 + 不活跃提醒
 */
const requestWaitlistSubscribe = async () => {
  await fetchTemplates(true);
  const ids = [
    SUBSCRIBE_TEMPLATES.WAITLIST_AVAILABLE,
    SUBSCRIBE_TEMPLATES.CLASS_REMINDER,
    SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND
  ].filter(id => id);
  if (ids.length === 0) return Promise.resolve({});
  return requestSubscribeMessage(ids);
};

/**
 * 激活套餐时：套餐即将到期 + 次卡低次数 + 不活跃提醒
 * （套餐激活本身不需要推送消息，此处借激活时机授权到期提醒）
 */
const requestPackageSubscribe = async () => {
  await fetchTemplates(true);
  const ids = [
    SUBSCRIBE_TEMPLATES.PACKAGE_EXPIRING,
    SUBSCRIBE_TEMPLATES.COUNT_CARD_LOW_REMIND,
    SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND
  ].filter(id => id);
  if (ids.length === 0) return Promise.resolve({});
  return requestSubscribeMessage(ids);
};

/**
 * 提交手机号审核时：审核结果 + 不活跃提醒 + 次卡低次数
 */
const requestPhoneAuditSubscribe = async () => {
  await fetchTemplates(true);
  const ids = [
    SUBSCRIBE_TEMPLATES.PHONE_AUDIT_RESULT,
    SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND,
    SUBSCRIBE_TEMPLATES.COUNT_CARD_LOW_REMIND
  ].filter(id => id);
  if (ids.length === 0) return Promise.resolve({});
  return requestSubscribeMessage(ids);
};

/**
 * 获取已授权的模板ID列表
 */
const getAcceptedTemplates = (subscribeResult) => {
  if (!subscribeResult) return [];
  return Object.keys(subscribeResult).filter(key => {
    return subscribeResult[key] === 'accept' && !key.startsWith('errMsg');
  });
};

module.exports = {
  SUBSCRIBE_TEMPLATES,
  fetchTemplates,
  requestSubscribeMessage,
  requestBookingSubscribe,
  requestCancelSubscribe,
  requestPackageSubscribe,
  requestWaitlistSubscribe,
  requestPhoneAuditSubscribe,
  getAcceptedTemplates
};