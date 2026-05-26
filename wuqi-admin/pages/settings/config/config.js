const { request } = require('../../../utils/request');

Page({
  data: {
    configs: [],
    reminderConfigs: [],
    loading: true,
    showEditModal: false,
    editingConfig: null,
    configValue: '',
    activeTab: 'general'
  },
  
  onLoad() {
    this.loadConfigs();
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },
  
  loadConfigs() {
    this.setData({ loading: true });
    Promise.all([
      request({ url: '/config', method: 'GET' }),
      request({ url: '/config/reminder-settings', method: 'GET', silent: true })
    ]).then(([res, reminderRes]) => {
      const configs = (res.data || []).map(c => ({
        config_key: c.key,
        config_value: c.value,
        description: c.description
      }));
      const reminderData = reminderRes && reminderRes.data ? reminderRes.data : {};
      const reminderConfigs = [
        { config_key: 'package_expire_remind_days', config_value: reminderData.package_expire_remind_days || '8', description: '套餐到期提前提醒天数' },
        { config_key: 'count_card_low_remind', config_value: reminderData.count_card_low_remind || '5', description: '次卡剩余次数低于此值时提醒' },
        { config_key: 'inactive_remind_days', config_value: reminderData.inactive_remind_days || '10', description: '会员未预约课程提醒天数' },
        { config_key: 'reminder_send_time', config_value: reminderData.reminder_send_time || '14:00', description: '套餐提醒推送时间' }
      ];
      this.setData({ configs, reminderConfigs, loading: false });
    }).catch(err => {
      this.setData({
        configs: [
          { config_key: 'default_booking_deadline', config_value: '180', description: '默认预约截止时间(分钟)' },
          { config_key: 'default_cancel_deadline', config_value: '120', description: '默认取消截止时间(分钟)' },
          { config_key: 'default_credits_cost', config_value: '1', description: '默认消耗次数' },
          { config_key: 'default_exemption_count', config_value: '3', description: '新注册会员默认豁免次数' },
          { config_key: 'timeout_cancel_window', config_value: '10', description: '超时取消窗口(分钟)' },
          { config_key: 'default_schedule_duration', config_value: '75', description: '默认排课时长(分钟)' }
        ],
        reminderConfigs: [
          { config_key: 'package_expire_remind_days', config_value: '8', description: '套餐到期提前提醒天数' },
          { config_key: 'count_card_low_remind', config_value: '5', description: '次卡剩余次数低于此值时提醒' },
          { config_key: 'inactive_remind_days', config_value: '10', description: '会员未预约课程提醒天数' },
          { config_key: 'reminder_send_time', config_value: '14:00', description: '套餐提醒推送时间' }
        ],
        loading: false
      });
    });
  },
  
  onEditConfig(e) {
    const { index, type } = e.currentTarget.dataset;
    const config = type === 'reminder' ? this.data.reminderConfigs[index] : this.data.configs[index];
    this.setData({
      showEditModal: true,
      editingConfig: { ...config, _type: type || 'general' },
      configValue: config.config_value
    });
  },
  
  onCloseModal() {
    this.setData({ showEditModal: false });
  },

  onModalTap() {},

  onValueChange(e) {
    this.setData({ configValue: e.detail.value });
  },
  
  onSaveConfig() {
    const { editingConfig } = this.data;
    if (!editingConfig) return;
    wx.showLoading({ title: '保存中...' });
    
    const url = editingConfig._type === 'reminder'
      ? '/config/reminder-settings'
      : `/config/${editingConfig.config_key}`;
    const method = editingConfig._type === 'reminder' ? 'PUT' : 'PUT';
    const data = editingConfig._type === 'reminder'
      ? { [editingConfig.config_key]: this.data.configValue }
      : { config_value: this.data.configValue, description: editingConfig.description };
    
    request({ url, method, data }).then(res => {
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ showEditModal: false });
      this.loadConfigs();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  }
});
