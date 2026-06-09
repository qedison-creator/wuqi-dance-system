const router = require('express').Router();
const auth = require('../middleware/auth');
const TemplateFieldMapping = require('../models/TemplateFieldMapping');
const { success } = require('../utils/response');
const { clearMappingCache } = require('../services/wechat-message.service');

// 默认业务字段选项
const BIZ_FIELD_OPTIONS = [
  { value: 'courseName', label: '课程名称' },
  { value: 'coachName', label: '教练' },
  { value: 'storeName', label: '门店' },
  { value: 'courseTime', label: '课程时间' },
  { value: 'bookingTime', label: '预约时间' },
  { value: 'cancelTime', label: '取消时间' },
  { value: 'cancelReason', label: '取消原因' },
  { value: 'packageName', label: '套餐名称' },
  { value: 'packageType', label: '会员卡类型' },
  { value: 'remindType', label: '提醒类型' },
  { value: 'remindReason', label: '提醒原因' },
  { value: 'expireDate', label: '到期日期' },
  { value: 'remainCount', label: '剩余次数' },
  { value: 'memberNickname', label: '会员昵称' },
  { value: 'inactiveDays', label: '未预约天数' },
  { value: 'auditItem', label: '审核事项' },
  { value: 'auditResult', label: '审核结果' },
  { value: 'remark', label: '备注说明' },
  { value: 'classroom', label: '上课地点' },
  { value: 'tipMessage', label: '提示信息' }
];

// GET /api/v1/template-mappings/biz-fields - 获取业务字段选项
router.get('/biz-fields', auth, (req, res) => {
  res.json(success(BIZ_FIELD_OPTIONS));
});

// GET /api/v1/template-mappings - 获取所有模板映射列表
router.get('/', auth, async (req, res, next) => {
  try {
    const list = await TemplateFieldMapping.find().sort({ template_key: 1 });
    res.json(success(list));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/template-mappings/:templateKey - 获取指定模板的映射
router.get('/:templateKey', auth, async (req, res, next) => {
  try {
    const mapping = await TemplateFieldMapping.findOne({ template_key: req.params.templateKey });
    res.json(success(mapping));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/template-mappings/:templateKey - 保存指定模板的映射
router.put('/:templateKey', auth, async (req, res, next) => {
  try {
    const { template_key, template_title, template_name, template_id, description, mappings } = req.body;

    if (!mappings || !Array.isArray(mappings)) {
      return res.status(400).json({ code: 400, message: '映射数据格式不正确', data: null });
    }

    // 校验：微信字段不能为空、业务字段不能为空、微信字段不能重复
    const wxFields = [];
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if (!m.wx_field || !m.wx_field.trim()) {
        return res.status(400).json({ code: 400, message: `第${i + 1}行微信字段不能为空`, data: null });
      }
      if (!m.biz_field) {
        return res.status(400).json({ code: 400, message: `第${i + 1}行业务字段不能为空`, data: null });
      }
      if (wxFields.includes(m.wx_field)) {
        return res.status(400).json({ code: 400, message: `微信字段"${m.wx_field}"重复`, data: null });
      }
      wxFields.push(m.wx_field);
    }

    const doc = await TemplateFieldMapping.findOneAndUpdate(
      { template_key: req.params.templateKey },
      {
        template_key,
        template_title: template_title || '',
        template_name: template_name || req.params.templateKey,
        template_id: template_id || '',
        description: description || '',
        mappings: mappings.map(m => ({
          field_name: m.field_name || '',
          wx_field: m.wx_field.trim(),
          biz_field: m.biz_field,
          example_value: m.example_value || ''
        }))
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json(success(doc, '保存成功'));
    clearMappingCache();
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/template-mappings/:templateKey - 删除指定模板的映射
router.delete('/:templateKey', auth, async (req, res, next) => {
  try {
    await TemplateFieldMapping.findOneAndDelete({ template_key: req.params.templateKey });
    res.json(success(null, '删除成功'));
    clearMappingCache();
  } catch (err) {
    next(err);
  }
});

module.exports = router;