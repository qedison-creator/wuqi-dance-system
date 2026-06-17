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
    return null;
  }
};

const clearMappingCache = () => {
  mappingCache = {};
};

// ========== 启动自动初始化所有模板映射 ==========
const ensureTemplateMappings = async () => {
  const msgConfig = require('../config/messageConfig');
  const defaults = {
    bookingSuccess:    { name:'预约成功通知', id: msgConfig.getMessageTemplates?.()?.bookingSuccessTemplateId    || msgConfig.bookingSuccessTemplateId    || '', mappings:[{wx:'thing1',biz:'courseName'},{wx:'name2',biz:'coachName'},{wx:'thing4',biz:'storeName'},{wx:'time5',biz:'courseTime'},{wx:'time3',biz:'bookingTime'}] },
    bookingCancel:     { name:'课程取消通知', id: msgConfig.getMessageTemplates?.()?.bookingCancelTemplateId     || msgConfig.bookingCancelTemplateId     || '', mappings:[{wx:'thing1',biz:'courseName'},{wx:'date4',biz:'courseTime'},{wx:'name5',biz:'coachName'},{wx:'thing2',biz:'cancelReason'},{wx:'thing7',biz:'storeName'}] },
    bookingCancelByUser:{ name:'预约取消通知', id: msgConfig.getMessageTemplates?.()?.bookingCancelByUserTemplateId|| msgConfig.bookingCancelByUserTemplateId|| '', mappings:[{wx:'thing1',biz:'courseName'},{wx:'date4',biz:'courseTime'},{wx:'name5',biz:'coachName'},{wx:'thing2',biz:'cancelReason'},{wx:'thing7',biz:'storeName'}] },
    classReminder:      { name:'上课提醒',     id: msgConfig.getMessageTemplates?.()?.classReminderTemplateId      || msgConfig.classReminderTemplateId      || '', mappings:[{wx:'thing1',biz:'courseName'},{wx:'time2',biz:'courseTime'},{wx:'name3',biz:'coachName'},{wx:'thing5',biz:'tipMessage'},{wx:'thing4',biz:'storeName'}] },
    waitlistAvailable:  { name:'候补成功通知', id: msgConfig.getMessageTemplates?.()?.waitlistAvailableTemplateId  || msgConfig.waitlistAvailableTemplateId  || '', mappings:[{wx:'thing1',biz:'courseName'},{wx:'time2',biz:'courseTime'},{wx:'thing3',biz:'storeName'}] },
    packageExpiring:    { name:'套餐到期提醒', id: msgConfig.getMessageTemplates?.()?.packageExpiringTemplateId    || msgConfig.packageExpiringTemplateId    || '', mappings:[{wx:'thing1',biz:'remindType'},{wx:'date2',biz:'expireDate'},{wx:'thing5',biz:'packageName'},{wx:'thing4',biz:'remindReason'}] },
    packageActivated:   { name:'套餐激活通知', id: msgConfig.getMessageTemplates?.()?.packageActivatedTemplateId   || msgConfig.packageActivatedTemplateId   || '', mappings:[{wx:'thing1',biz:'packageName'},{wx:'time2',biz:'expireDate'},{wx:'thing3',biz:'storeName'}] },
    countCardLowRemind: { name:'次卡次数提醒', id: msgConfig.getMessageTemplates?.()?.countCardLowRemindTemplateId || msgConfig.countCardLowRemindTemplateId || '', mappings:[{wx:'thing1',biz:'remindType'},{wx:'number2',biz:'remainCount'},{wx:'thing3',biz:'packageName'}] },
    memberInactiveRemind:{name:'不活跃提醒',   id: msgConfig.getMessageTemplates?.()?.memberInactiveRemindTemplateId|| msgConfig.memberInactiveRemindTemplateId|| '', mappings:[{wx:'thing1',biz:'remindType'},{wx:'name2',biz:'memberNickname'},{wx:'number3',biz:'inactiveDays'}] },
    phoneAuditResult:   { name:'手机号审核结果',id:msgConfig.getMessageTemplates?.()?.phoneAuditResultTemplateId   || msgConfig.phoneAuditResultTemplateId   || '', mappings:[{wx:'thing1',biz:'auditItem'},{wx:'phrase2',biz:'auditResult'},{wx:'thing3',biz:'remark'}] },
  };

  let created = 0;
  for (const [key, cfg] of Object.entries(defaults)) {
    const exists = await TemplateFieldMapping.findOne({ template_key: key });
    if (!exists) {
      await TemplateFieldMapping.create({
        template_key: key, template_name: cfg.name, template_id: cfg.id,
        mappings: cfg.mappings.map(m => ({ wx_field: m.wx, biz_field: m.biz })),
      });
      created++;
      console.log(`[WeChat] 自动创建模板映射: ${key}`);
    }
  }
  if (created > 0) console.log(`[WeChat] 自动初始化完成: 创建${created}个模板映射`);
};

exports.ensureTemplateMappings = ensureTemplateMappings;

const getFieldMaxLength = (wxField) => {
  const match = wxField.match(/^([a-z_]+)\d*$/);
  if (!match) return 20;
  const limits = {
    thing: 20,
    short_thing: 6,
    name: 10,
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

const sendSubscribeMessage = async (openid, templateId, data, page = '', clientType = 'member', retryCount = 0) => {
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
      return false;
    }
    // 可恢复错误：token过期（40001）、系统繁忙（45009）等，尝试重试
    if (result.errcode === 40001 || result.errcode === 45009) {
      if (retryCount < 2) {
        console.log(`[WeChatMessage] 发送失败(errcode=${result.errcode})，${retryCount < 1 ? '刷新token后' : ''}重试...`);
        if (result.errcode === 40001) {
          // 清除缓存的 token，强制重新获取
          accessTokenCaches[clientType].token = null;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // 指数退避
        return await sendSubscribeMessage(openid, templateId, data, page, clientType, retryCount + 1);
      }
    }
    console.error('[WeChatMessage] 发送失败:', result);
    return false;
  } catch (err) {
    // 网络异常也重试
    if (retryCount < 2) {
      console.log(`[WeChatMessage] 发送异常: ${err.message}，重试...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return await sendSubscribeMessage(openid, templateId, data, page, clientType, retryCount + 1);
    }
    console.error('[WeChatMessage] 发送异常（重试失败）:', err.message);
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

  await sendByTemplateKey(user.openid, 'bookingSuccess', bizData, 'pages/records/records', clientType);
};

// 取消通知（兼容两种场景：用户自行取消 / 课程被取消）
// templateKey: 'bookingCancel'=课程被取消, 'bookingCancelByUser'=用户自行取消预约
exports.sendBookingCancel = async (user, schedule, reason, clientType = 'member', templateKey = 'bookingCancel') => {
  if (!user.openid) return;
  const now = new Date();
  const cancelTime = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    coachName: schedule.coach_id?.name || schedule.coach_name || '待定',
    cancelReason: reason || '已取消',
    storeName: schedule.store_id?.name || '舞栖舞蹈',
    cancelTime: cancelTime,
    courseTime: `${schedule.date} ${schedule.start_time}~${schedule.end_time}`,
  };

  await sendByTemplateKey(user.openid, templateKey, bizData, 'pages/records/records', clientType);
};

// 上课提醒
exports.sendClassReminder = async (user, schedule, clientType = 'member', reminderType = '1h') => {
  if (!user.openid) return;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    courseTime: `${schedule.date} ${schedule.start_time}`,
    coachName: schedule.coach_id?.name || schedule.coach_name || '待定',
    tipMessage: reminderType === '1h'
      ? '一小时后，美好的舞蹈时光马上就要来啦'
      : '距离开课还有半小时，尽早出发别迟到哦',
    storeName: schedule.store_id?.name || '舞栖舞蹈',
    classroom: schedule.classroom || '请准时到场',
  };

  await sendByTemplateKey(user.openid, 'classReminder', bizData, 'pages/records/records', clientType);
};

// 候补成功通知
exports.sendWaitlistAvailable = async (user, schedule, clientType = 'member') => {
  if (!user.openid) return;

  const bizData = {
    courseName: schedule.course_name || '舞蹈课程',
    courseTime: `${schedule.date} ${schedule.start_time}`,
    storeName: schedule.store_id?.name || '舞栖舞蹈',
    tipMessage: '候补成功！记得准时去上课哦',
  };

  await sendByTemplateKey(user.openid, 'waitlistAvailable', bizData, 'pages/records/records', clientType);
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
    packageType: packageName || '舞蹈套餐',
    remindType: '激活提醒',
    remindReason: '您的新套餐已成功激活',
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
