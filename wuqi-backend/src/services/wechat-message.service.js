const axios = require('axios');
const config = require('../config');
const TemplateFieldMapping = require('../models/TemplateFieldMapping');

/**
 * 微信订阅消息推送服务
 * 完全从 TemplateFieldMapping 表读取：模板ID、字段映射
 */

// ========== 模板与映射缓存 ==========
let mappingCache = {}; // { [templateKey]: { data, time } }
const MAPPING_CACHE_TTL = 60 * 1000; // 60秒缓存，每key独立TTL

const loadTemplateFromDB = async (templateKey) => {
  const now = Date.now();
  const cached = mappingCache[templateKey];
  if (cached && (now - cached.time) < MAPPING_CACHE_TTL) {
    return cached.data;
  }
  try {
    const doc = await TemplateFieldMapping.findOne({ template_key: templateKey });
    const data = doc && doc.template_id ? {
      templateId: doc.template_id,
      mappings: doc.mappings || [],
    } : null;
    mappingCache[templateKey] = { data, time: now };
    return data;
  } catch (err) {
    console.error(`[WeChatMessage] 加载模板失败 templateKey=${templateKey}:`, err.message);
    return null;
  }
};

const clearMappingCache = () => {
  mappingCache = {};
};

const getFieldMaxLength = (wxField) => {
  const match = wxField.match(/^([a-z_]+)\d*$/);
  if (!match) return 20;
  const limits = {
    thing: 20,
    character_string: 32,
    phrase: 5,
    time: 50,
    date: 50,
    number: 50,
    amount: 50,
    phone_number: 20,
    letter: 50,
    car_number: 10,
    const: 50,
  };
  return limits[match[1]] || 20;
};

const buildWxData = (mappings, bizData) => {
  const wxData = {};
  for (const m of mappings) {
    const value = String(bizData[m.biz_field] || '');
    const maxLen = getFieldMaxLength(m.wx_field);
    wxData[m.wx_field] = { value: value.substring(0, maxLen) };
  }
  return wxData;
};

// 按客户端类型缓存 access_token
const accessTokenCaches = {
  member: { token: null, expiresAt: 0 },
  admin: { token: null, expiresAt: 0 },
};

const getAccessToken = async (clientType = 'member') => {
  const cache = accessTokenCaches[clientType];
  if (cache.token && Date.now() < cache.expiresAt) {
    return cache.token;
  }
  try {
    const wxConfig = config.getWxConfig(clientType);
    if (!wxConfig.appId || !wxConfig.secret) {
      console.warn(`[WeChatMessage] 未配置${clientType === 'admin' ? '管理端' : '会员端'}小程序 AppID 或 Secret，订阅消息推送将不可用`);
      return null;
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wxConfig.appId}&secret=${wxConfig.secret}`;
    const response = await axios.get(url);
    const data = response.data;
    if (data.access_token) {
      accessTokenCaches[clientType] = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
      };
      console.log(`[WeChatMessage] ${clientType === 'admin' ? '管理端' : '会员端'} access_token 刷新成功`);
      return data.access_token;
    }
    console.error('[WeChatMessage] 获取access_token失败:', JSON.stringify(data));
    return null;
  } catch (err) {
    console.error('[WeChatMessage] 获取access_token异常:', err.message);
    return null;
  }
};

const sendSubscribeMessage = async (openid, templateId, data, page = '', clientType = 'member') => {
  try {
    const accessToken = await getAccessToken(clientType);
    if (!accessToken || !templateId) return false;
    const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;
    const body = { touser: openid, template_id: templateId, data };
    if (page) body.page = page;
    const response = await axios.post(url, body);
    const result = response.data;
    if (result.errcode === 0) return true;
    if (result.errcode === 43101) {
      console.log(`[WeChatMessage] 用户未订阅: ${openid.substring(0, 8)}...`);
      return false;
    }
    console.error('[WeChatMessage] 发送失败:', result);
    return false;
  } catch (err) {
    console.error('[WeChatMessage] 发送异常:', err.message);
    return false;
  }
};

// ========== 核心：从 DB 读取模板与映射发送 ==========

const sendByTemplateKey = async (openid, templateKey, bizData, page = '', clientType = 'member') => {
  if (!openid || !bizData) return false;

  const template = await loadTemplateFromDB(templateKey);
  if (!template || !template.templateId) return false;

  const wxData = template.mappings && template.mappings.length > 0
    ? buildWxData(template.mappings, bizData)
    : null;

  if (!wxData || Object.keys(wxData).length === 0) return false;

  return await sendSubscribeMessage(openid, template.templateId, wxData, page, clientType);
};

// ========== 业务消息方法 ==========

// 预约成功通知
exports.sendBookingSuccess = async (user, schedule, clientType = 'member') => {
  if (!user.openid) return;
  const now = new Date();
  const bookingTime = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    coachName: schedule.coach_id?.name || schedule.coach_name || '待定',
    storeName: schedule.store_id?.name || '舞栖舞蹈',
    courseTime: `${schedule.date} ${schedule.start_time}~${schedule.end_time}`,
    bookingTime: bookingTime,
  };

  await sendByTemplateKey(user.openid, 'bookingSuccess', bizData, 'pages/booking/booking', clientType);
};

// 取消预约通知
exports.sendBookingCancel = async (user, schedule, reason, clientType = 'member') => {
  if (!user.openid) return;
  const now = new Date();
  const cancelTime = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    coachName: schedule.coach_id?.name || schedule.coach_name || '待定',
    cancelReason: reason || '已取消',
    storeName: schedule.store_id?.name || '舞栖舞蹈',
    cancelTime: cancelTime,
  };

  await sendByTemplateKey(user.openid, 'bookingCancel', bizData, 'pages/booking/booking', clientType);
};

// 上课提醒
exports.sendClassReminder = async (user, schedule, clientType = 'member') => {
  if (!user.openid) return;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    courseTime: `${schedule.date} ${schedule.start_time}`,
    classroom: schedule.classroom || '请准时到场',
  };

  await sendByTemplateKey(user.openid, 'classReminder', bizData, 'pages/booking/booking', clientType);
};

// 候补成功通知
exports.sendWaitlistAvailable = async (user, schedule, clientType = 'member') => {
  if (!user.openid) return;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    courseTime: `${schedule.date} ${schedule.start_time}`,
    tipMessage: '候补成功！记得准时去上课哦',
  };

  await sendByTemplateKey(user.openid, 'waitlistAvailable', bizData, 'pages/booking/booking', clientType);
};

// 套餐即将到期通知
exports.sendPackageExpiring = async (user, packageName, endDate, daysLeft, clientType = 'member') => {
  if (!user.openid) return;

  const bizData = {
    packageName: packageName || '舞蹈套餐',
    expireDate: endDate,
    tipMessage: `套餐还有${daysLeft}天到期，记得续费哦`,
  };

  await sendByTemplateKey(user.openid, 'packageExpiring', bizData, 'pages/profile/profile', clientType);
};

// 套餐已激活通知
exports.sendPackageActivated = async (user, packageName, endDate, clientType = 'member') => {
  if (!user.openid) return;

  const bizData = {
    packageName: packageName || '舞蹈套餐',
    expireDate: endDate,
    tipMessage: '解锁跳舞权限！快来约课吧',
  };

  await sendByTemplateKey(user.openid, 'packageActivated', bizData, 'pages/booking/booking', clientType);
};

// 手机号审核结果通知
exports.sendPhoneAuditResult = async (user, result, reason = '', clientType = 'member') => {
  if (!user.openid) return;
  const resultText = result === 'approved' ? '审核通过' : '审核未通过';
  const remark = result === 'approved' ? '您的预留手机号已更新成功' : (reason || '请核实信息后重新提交');

  const bizData = {
    auditItem: '预留手机号修改',
    auditResult: resultText,
    remark: remark,
  };

  await sendByTemplateKey(user.openid, 'phoneAuditResult', bizData, 'pages/profile/profile', clientType);
};

exports.sendSubscribeMessage = sendSubscribeMessage;
exports.sendByTemplateKey = sendByTemplateKey;
exports.buildWxData = buildWxData;
exports.clearMappingCache = clearMappingCache;
