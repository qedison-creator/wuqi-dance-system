const axios = require('axios');
const config = require('../config');
const { getMessageTemplates } = require('../config/messageConfig');

/**
 * 微信订阅消息推送服务
 *
 * 使用前需要在微信小程序后台配置消息模板
 * 并在小程序前端调用 wx.requestSubscribeMessage 获取用户授权
 */

// 获取access_token
let accessTokenCache = {
  token: null,
  expiresAt: 0,
};

const getAccessToken = async () => {
  // 如果缓存未过期，直接返回
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  try {
    const appId = config.wechatAppId || process.env.WECHAT_APP_ID;
    const appSecret = config.wechatAppSecret || process.env.WECHAT_APP_SECRET;

    if (!appId || !appSecret) {
      console.warn('[WeChatMessage] 未配置微信小程序AppId或AppSecret，消息推送功能不可用');
      return null;
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    const response = await axios.get(url);
    const data = response.data;

    if (data.access_token) {
      accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000, // 提前5分钟过期
      };
      return data.access_token;
    } else {
      console.error('[WeChatMessage] 获取access_token失败:', data);
      return null;
    }
  } catch (err) {
    console.error('[WeChatMessage] 获取access_token异常:', err.message);
    return null;
  }
};

// 发送订阅消息
const sendSubscribeMessage = async (openid, templateId, data, page = '') => {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.warn('[WeChatMessage] 无法发送消息: access_token不可用');
      return false;
    }

    if (!templateId) {
      return false;
    }

    const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;
    const body = {
      touser: openid,
      template_id: templateId,
      data,
    };

    if (page) {
      body.page = page;
    }

    const response = await axios.post(url, body);
    const result = response.data;

    if (result.errcode === 0) {
      console.log(`[WeChatMessage] 消息发送成功: openid=${openid.substring(0, 8)}...`);
      return true;
    } else if (result.errcode === 43101) {
      console.log(`[WeChatMessage] 用户未订阅消息: openid=${openid.substring(0, 8)}...`);
      return false;
    } else {
      console.error(`[WeChatMessage] 消息发送失败:`, result);
      return false;
    }
  } catch (err) {
    console.error('[WeChatMessage] 发送消息异常:', err.message);
    return false;
  }
};

// ========== 业务消息方法 ==========

// 预约成功通知
exports.sendBookingSuccess = async (user, schedule) => {
  const templates = getMessageTemplates();
  const templateId = templates.bookingSuccessTemplateId;
  if (!templateId || !user.openid) return;

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: schedule.course_name || '舞蹈课程' },
    time2: { value: `${schedule.date} ${schedule.start_time}` },
    thing3: { value: schedule.store_id?.name || '舞栖舞蹈' },
  }, 'pages/booking/booking');
};

// 取消预约通知
exports.sendBookingCancel = async (user, schedule, reason) => {
  const templates = getMessageTemplates();
  const templateId = templates.bookingCancelTemplateId;
  if (!templateId || !user.openid) return;

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: schedule.course_name || '舞蹈课程' },
    time2: { value: `${schedule.date} ${schedule.start_time}` },
    thing3: { value: reason || '已取消' },
  }, 'pages/booking/booking');
};

// 上课提醒（定时任务调用）
exports.sendClassReminder = async (user, schedule) => {
  const templates = getMessageTemplates();
  const templateId = templates.classReminderTemplateId;
  if (!templateId || !user.openid) return;

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: schedule.course_name || '舞蹈课程' },
    time2: { value: `${schedule.date} ${schedule.start_time}` },
    thing3: { value: schedule.classroom || '请准时到场' },
  }, 'pages/booking/booking');
};

// 候补成功通知
exports.sendWaitlistAvailable = async (user, schedule) => {
  const templates = getMessageTemplates();
  const templateId = templates.waitlistAvailableTemplateId;
  if (!templateId || !user.openid) return;

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: schedule.course_name || '舞蹈课程' },
    time2: { value: `${schedule.date} ${schedule.start_time}` },
    thing3: { value: '有名额空出，请尽快预约' },
  }, 'pages/booking/booking');
};

// 套餐即将到期通知
exports.sendPackageExpiring = async (user, packageName, endDate) => {
  const templates = getMessageTemplates();
  const templateId = templates.packageExpiringTemplateId;
  if (!templateId || !user.openid) return;

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: packageName || '舞蹈套餐' },
    date2: { value: endDate },
    thing3: { value: '您的套餐即将到期，请及时续费' },
  }, 'pages/profile/profile');
};

// 套餐已激活通知
exports.sendPackageActivated = async (user, packageName, endDate) => {
  const templates = getMessageTemplates();
  const templateId = templates.packageActivatedTemplateId;
  if (!templateId || !user.openid) return;

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: packageName || '舞蹈套餐' },
    date2: { value: endDate },
    thing3: { value: '您的套餐已激活，快来预约课程吧' },
  }, 'pages/booking/booking');
};

// 手机号审核结果通知
exports.sendPhoneAuditResult = async (user, result, reason = '') => {
  const templates = getMessageTemplates();
  const templateId = templates.phoneAuditResultTemplateId;
  if (!templateId || !user.openid) return;

  const resultText = result === 'approved' ? '审核通过' : '审核未通过';
  const remark = result === 'approved' 
    ? '您的预留手机号已更新成功' 
    : (reason || '请核实信息后重新提交');

  await sendSubscribeMessage(user.openid, templateId, {
    thing1: { value: '预留手机号修改' },
    phrase2: { value: resultText },
    thing3: { value: remark },
  }, 'pages/profile/profile');
};

exports.sendSubscribeMessage = sendSubscribeMessage;
