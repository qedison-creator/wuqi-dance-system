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
 * 引导弹窗去重缓存
 * 用户在引导弹窗点"暂不开启"后，24小时内不再提示该场景
 */
const GUIDE_SKIP_DURATION = 24 * 60 * 60 * 1000; // 24小时

const getGuideCacheKey = (sceneKey) => `subscribe_guide_${sceneKey}`;
const getGuideSkipped = (sceneKey) => {
  try {
    const cached = wx.getStorageSync(getGuideCacheKey(sceneKey));
    if (cached && cached.expireAt > Date.now()) {
      return true;
    }
  } catch (e) {}
  return false;
};
const setGuideSkipped = (sceneKey) => {
  try {
    wx.setStorageSync(getGuideCacheKey(sceneKey), {
      expireAt: Date.now() + GUIDE_SKIP_DURATION
    });
  } catch (e) {}
};
const setGuideAccepted = (sceneKey) => {
  try {
    wx.removeStorageSync(getGuideCacheKey(sceneKey));
  } catch (e) {}
};

/**
 * 请求订阅消息授权（单次最多3个模板ID，弹1次窗）
 * 先弹引导提示，再调微信授权
 * @param {string[]} tmplIds - 模板ID列表
 * @param {string} sceneKey - 场景标识，用于去重缓存（如 'booking', 'waitlist', 'package', 'cancel', 'phoneAudit'）
 * @param {boolean} skipGuide - 是否跳过引导弹窗，直接调微信授权
 */
const requestSubscribeMessage = (tmplIds, sceneKey = '', skipGuide = false) => {
  return new Promise((resolve) => {
    const validIds = [...new Set((Array.isArray(tmplIds) ? tmplIds : [tmplIds]).filter(id => id && id.trim()))];
    if (validIds.length === 0) {
      resolve({});
      return;
    }

    // 检查用户是否曾跳过该场景的引导（24小时内不再提示）
    if (sceneKey && getGuideSkipped(sceneKey)) {
      // 用户跳过引导，直接调微信授权（微信会根据"总是保持"设置决定是否弹窗）
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
      return;
    }

    // 先弹引导提示，引导用户勾选"总是保持以上选择"
    const doRequestWechat = () => {
      setGuideAccepted(sceneKey);
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
    };

    if (skipGuide) {
      doRequestWechat();
      return;
    }

    wx.showModal({
      title: '开启消息通知',
      content: '为了及时收到上课提醒、预约结果等通知，请在接下来弹出的窗口中勾选「总是保持以上选择，不再询问」，这样以后就不会再重复弹窗啦～',
      confirmText: '去授权',
      cancelText: '暂不开启',
      showCancel: true,
      success: (modalRes) => {
        if (modalRes.confirm) {
          doRequestWechat();
        } else {
          // 用户点"暂不开启"，缓存跳过状态（24小时内不再提示该场景）
          if (sceneKey) {
            setGuideSkipped(sceneKey);
          }
          resolve({});
        }
      },
      fail: () => {
        resolve({});
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
  return requestSubscribeMessage(ids, 'booking');
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
  return requestSubscribeMessage(ids, 'cancel');
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
  return requestSubscribeMessage(ids, 'waitlist');
};

/**
 * 加入候补时（合并候补+预约两个场景的模板，只弹1次窗）
 * 候补：WAITLIST_AVAILABLE, CLASS_REMINDER, MEMBER_INACTIVE_REMIND
 * 预约：BOOKING_SUCCESS, CLASS_REMINDER, BOOKING_CANCEL
 * 合并去重后最多3个，优先保留候补相关
 */
const requestWaitlistAndBookingSubscribe = async () => {
  await fetchTemplates(true);
  const idSet = new Set();
  const ids = [];
  // 优先候补相关模板
  [SUBSCRIBE_TEMPLATES.WAITLIST_AVAILABLE, SUBSCRIBE_TEMPLATES.CLASS_REMINDER, SUBSCRIBE_TEMPLATES.MEMBER_INACTIVE_REMIND, SUBSCRIBE_TEMPLATES.BOOKING_SUCCESS, SUBSCRIBE_TEMPLATES.BOOKING_CANCEL].forEach(id => {
    if (id && !idSet.has(id)) {
      idSet.add(id);
      ids.push(id);
    }
  });
  // 微信一次最多3个模板
  const limitedIds = ids.slice(0, 3);
  if (limitedIds.length === 0) return Promise.resolve({});
  return requestSubscribeMessage(limitedIds, 'waitlist');
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
  return requestSubscribeMessage(ids, 'package');
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
  return requestSubscribeMessage(ids, 'phoneAudit');
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
  requestWaitlistAndBookingSubscribe,
  requestPhoneAuditSubscribe,
  getAcceptedTemplates
};