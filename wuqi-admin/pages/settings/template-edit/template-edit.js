const { request } = require('../../../utils/request');

const TEMPLATE_SCENARIOS = {
  bookingSuccess: '用户在小程序中预约课程成功后，系统自动推送微信订阅消息，告知用户预约已生效。消息中将展示课程名称、授课教练、上课门店及具体上课时间，帮助用户快速确认预约详情。',
  classReminder: '课程开始前，系统自动向已预约该课程的用户推送上课提醒通知。消息中将展示课程名称、上课时间及具体教室位置，避免用户遗忘或跑错教室，提升学员出勤体验。',
  bookingCancel: '当课程因故取消时（管理员下架、放假、人数不足等），系统自动推送给已预约用户的通知。消息中将展示课程名称、教练、取消原因及取消时间。注意：用户自行取消预约使用下方"预约取消通知"。',
  bookingCancelByUser: '用户在小程序中自行取消已预约的课程后，系统自动推送取消确认通知。消息中将展示取消的课程名称、教练、门店及取消时间，并附带取消原因说明，让用户清晰了解取消结果。',
  waitlistAvailable: '当已满员的课程有名额空出时，系统自动向候补队列中的用户推送通知，提醒用户当前可预约该课程。消息中将展示课程名称、上课时间，引导用户尽快完成预约。',
  packageExpiring: '当用户的舞蹈课程套餐即将到期时，系统自动推送到期提醒通知。消息中将展示套餐名称、到期日期及续费提示，帮助用户及时续费避免权益中断。',
  packageActivated: '用户成功购买或激活舞蹈课程套餐后，系统自动推送激活确认通知。消息中将展示套餐名称、有效期截止日期及引导语，鼓励用户立即开始预约课程。',
  countCardLowRemind: '当用户的次卡剩余可用次数低于设定阈值时，系统自动推送低次数提醒通知。消息中将展示套餐名称、剩余次数及续费引导语，提醒用户及时补充次卡以免影响正常上课。',
  memberInactiveRemind: '当会员连续多日未在小程序中预约任何课程时，系统自动推送不活跃提醒通知。消息中将展示会员昵称、未活跃天数及暖心引导语，鼓励学员重新回到课堂，提升会员活跃度和留存率。',
  phoneAuditResult: '当用户在小程序中提交手机号修改申请并完成审核后，系统自动推送审核结果通知。消息中将展示审核事项、审核结果及备注说明，使用户第一时间了解手机号变更的处理结果。'
};

Page({
  data: {
    bizFieldOptions: [],
    templates: [],
    loading: false,
    saving: false,
    deleting: false // 防抖标志位
  },

  onLoad() {
    this.loadBizFieldOptions();
    this.loadTemplates();
  },

  onShow() {
    if (this.data.templates.length === 0) {
      this.loadTemplates();
    }
  },

  async loadBizFieldOptions() {
    try {
      const res = await request({ url: '/template-mappings/biz-fields', method: 'GET' });
      this.setData({ bizFieldOptions: res.data || [] });
    } catch (err) {
      console.error('加载业务字段选项失败', err);
    }
  },

  async loadTemplates() {
    this.setData({ loading: true });
    try {
      const res = await request({ url: '/template-mappings', method: 'GET' });
      const templates = (res.data || []).map(t => this.formatTemplate(t));
      this.setData({ templates, loading: false });
    } catch (err) {
      wx.showToast({ title: '加载模板失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  formatTemplate(t) {
    return {
      _id: t._id,
      template_key: t.template_key,
      template_title: t.template_title || '',
      template_name: t.template_name || '',
      template_id: t.template_id || '',
      description: t.description || TEMPLATE_SCENARIOS[t.template_key] || '',
      expanded: false,
      mappings: (t.mappings || []).map(m => ({
        field_name: m.field_name || '',
        wx_field: m.wx_field,
        biz_field: m.biz_field,
        biz_field_index: this.getBizFieldIndex(m.biz_field),
        example_value: m.example_value || ''
      }))
    };
  },

  getBizFieldIndex(bizFieldValue) {
    const options = this.data.bizFieldOptions;
    if (!options || options.length === 0) return 0;
    const idx = options.findIndex(o => o.value === bizFieldValue);
    return idx >= 0 ? idx : 0;
  },

  toggleExpand(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`templates[${idx}].expanded`]: !this.data.templates[idx].expanded });
  },

  addTemplate() {
    const newTemplate = {
      template_key: `custom_${Date.now()}`,
      template_name: '',
      template_id: '',
      description: '',
      expanded: true,
      mappings: []
    };
    const templates = [...this.data.templates, newTemplate];
    this.setData({ templates });
  },

  addMappingRow(e) {
    const idx = e.currentTarget.dataset.index;
    const templates = [...this.data.templates];
    const mappings = [...templates[idx].mappings];
    mappings.push({
      field_name: '',
      wx_field: '',
      biz_field: this.data.bizFieldOptions.length > 0 ? this.data.bizFieldOptions[0].value : '',
      biz_field_index: 0,
      example_value: ''
    });
    templates[idx].mappings = mappings;
    this.setData({ templates });
  },

  deleteMappingRow(e) {
    const tplIdx = e.currentTarget.dataset.tplIndex;
    const mapIdx = e.currentTarget.dataset.mapIndex;
    const templates = [...this.data.templates];
    const mappings = templates[tplIdx].mappings.filter((_, i) => i !== mapIdx);
    templates[tplIdx].mappings = mappings;
    this.setData({ templates });
  },

  onNameInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`templates[${idx}].template_name`]: e.detail.value });
  },

  onTitleInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`templates[${idx}].template_title`]: e.detail.value });
  },

  onDescInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`templates[${idx}].description`]: e.detail.value });
  },

  onIdInput(e) {
    const idx = e.currentTarget.dataset.index;
    const val = (e.detail.value || '').trim();
    this.setData({ [`templates[${idx}].template_id`]: val });
  },

  onIdBlur(e) {
    const idx = e.currentTarget.dataset.index;
    const val = (e.detail.value || '').trim();
    this.setData({ [`templates[${idx}].template_id`]: val });
  },

  onWxFieldInput(e) {
    const tplIdx = e.currentTarget.dataset.tplIndex;
    const mapIdx = e.currentTarget.dataset.mapIndex;
    this.setData({ [`templates[${tplIdx}].mappings[${mapIdx}].wx_field`]: e.detail.value });
  },

  onFieldNameInput(e) {
    const tplIdx = e.currentTarget.dataset.tplIndex;
    const mapIdx = e.currentTarget.dataset.mapIndex;
    this.setData({ [`templates[${tplIdx}].mappings[${mapIdx}].field_name`]: e.detail.value });
  },

  onBizFieldChange(e) {
    const tplIdx = e.currentTarget.dataset.tplIndex;
    const mapIdx = e.currentTarget.dataset.mapIndex;
    const bizIdx = parseInt(e.detail.value);
    this.setData({
      [`templates[${tplIdx}].mappings[${mapIdx}].biz_field_index`]: bizIdx,
      [`templates[${tplIdx}].mappings[${mapIdx}].biz_field`]: this.data.bizFieldOptions[bizIdx].value
    });
  },

  onExampleInput(e) {
    const tplIdx = e.currentTarget.dataset.tplIndex;
    const mapIdx = e.currentTarget.dataset.mapIndex;
    this.setData({ [`templates[${tplIdx}].mappings[${mapIdx}].example_value`]: e.detail.value });
  },

  validateTemplate(template) {
    if (!template.template_name || !template.template_name.trim()) {
      throw new Error('模板名称不能为空');
    }
    const wxFields = [];
    for (let i = 0; i < template.mappings.length; i++) {
      const m = template.mappings[i];
      if (!m.wx_field || !m.wx_field.trim()) {
        throw new Error(`第 ${i + 1} 行微信字段不能为空`);
      }
      if (!m.biz_field) {
        throw new Error(`第 ${i + 1} 行业务字段不能为空`);
      }
      if (wxFields.includes(m.wx_field.trim())) {
        throw new Error(`微信字段「${m.wx_field}」重复`);
      }
      wxFields.push(m.wx_field.trim());
    }
  },

  async saveTemplate(e) {
    const idx = e.currentTarget.dataset.index;
    const template = this.data.templates[idx];
    try {
      this.validateTemplate(template);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await request({
        url: `/template-mappings/${template.template_key}`,
        method: 'PUT',
        data: {
          template_key: template.template_key,
          template_title: template.template_title,
          template_name: template.template_name,
          template_id: (template.template_id || '').trim(),
          description: template.description,
          mappings: template.mappings.map(m => ({
            field_name: m.field_name || '',
            wx_field: m.wx_field.trim(),
            biz_field: m.biz_field,
            example_value: m.example_value || ''
          }))
        }
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({
        [`templates[${idx}].expanded`]: false,
        saving: false
      });
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      this.setData({ saving: false });
    }
  },

  async deleteTemplate(e) {
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }
    
    const idx = e.currentTarget.dataset.index;
    const template = this.data.templates[idx];
    wx.showModal({
      title: '删除模板',
      content: `确定要删除「${template.template_name}」吗？`,
      confirmColor: '#D4786E',
      success: async (res) => {
        if (res.confirm) {
          try {
            // 设置防抖标志位
            this.setData({ deleting: true });
            await request({ url: `/template-mappings/${template.template_key}`, method: 'DELETE' });
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadTemplates();
          } catch (err) {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          } finally {
            // 无论成功或失败，都重置防抖标志位
            this.setData({ deleting: false });
          }
        } else {
          // 用户取消删除，重置防抖标志位
          this.setData({ deleting: false });
        }
      },
      fail: () => {
        // 用户取消删除，重置防抖标志位
        this.setData({ deleting: false });
      }
    });
  }
});