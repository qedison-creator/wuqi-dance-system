const app = getApp();
const { request } = require('../../../utils/request');
const serverConfig = require('../../../config/index.js');

const HERO_THEMES = [
  { key: 'sunrise', label: '清晨 (5:00-8:00)' },
  { key: 'morning', label: '上午 (8:00-12:00)' },
  { key: 'noon', label: '中午 (12:00-14:00)' },
  { key: 'afternoon', label: '下午 (14:00-17:00)' },
  { key: 'sunset', label: '傍晚 (17:00-19:00)' },
  { key: 'night', label: '晚上 (19:00-22:00)' },
  { key: 'late-night', label: '深夜 (22:00-5:00)' }
];

Page({
  data: {
    configs: [],
    loading: true,
    showEditModal: false,
    editingConfig: null,
    configValue: '',
    activeTab: 'general',
    systemConfigs: {},
    heroConfigs: HERO_THEMES.map(t => ({
      ...t,
      config_key: `hero_bg_${t.key}`,
      config_value: '',
      uploading: false
    }))
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
      // 尝试加载系统配置，但即使失败也不影响其他内容
      new Promise(resolve => {
        request({ url: '/system/configs', method: 'GET', silent: true })
          .then(res => resolve(res))
          .catch(() => resolve({ data: {} }));
      })
    ]).then(([res, systemRes]) => {
      // 过滤掉重复的模板ID配置
      const EXCLUDED_KEYS = ['tpl_bookingSuccessTemplateId', 'tpl_bookingCancelTemplateId'];
      const configs = (res.data || [])
        .filter(c => !EXCLUDED_KEYS.includes(c.key))
        .map(c => ({
          config_key: c.key,
          config_value: c.value,
          description: c.description
        }));
      
      const systemConfigs = systemRes && systemRes.data ? systemRes.data : {};
      const heroConfigs = HERO_THEMES.map(t => ({
        ...t,
        config_key: `hero_bg_${t.key}`,
        config_value: systemConfigs[`hero_bg_${t.key}`] || (serverConfig.serverBase + '/uploads/hero/hero-' + t.key + '.jpg'),
        uploading: false
      }));
      
      this.setData({ configs, systemConfigs, heroConfigs, loading: false });
    }).catch(err => {
      // 即使系统配置请求失败，也要初始化 heroConfigs
      this.setData({
        configs: [
          { config_key: 'default_booking_deadline', config_value: '180', description: '默认预约截止时间(分钟)' },
          { config_key: 'default_cancel_deadline', config_value: '120', description: '默认取消截止时间(分钟)' },
          { config_key: 'default_credits_cost', config_value: '1', description: '默认消耗次数' },
          { config_key: 'default_exemption_count', config_value: '3', description: '新注册会员默认豁免次数' },
          { config_key: 'timeout_cancel_window', config_value: '10', description: '超时取消窗口(分钟)' },
          { config_key: 'default_schedule_duration', config_value: '75', description: '默认排课时长(分钟)' }
        ],
        heroConfigs: HERO_THEMES.map(t => ({ ...t, config_key: `hero_bg_${t.key}`, config_value: serverConfig.serverBase + '/uploads/hero/hero-' + t.key + '.jpg', uploading: false })),
        loading: false
      });
    });
  },
  
  onChooseHeroImage(e) {
    const { index } = e.currentTarget.dataset;
    const heroConfig = this.data.heroConfigs[index];
    
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0];
        if (file.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '图片过大，最大支持 10MB', icon: 'none' });
          return;
        }
        this.uploadHeroImage(index, file.tempFilePath);
      }
    });
  },
  
  uploadHeroImage(index, tempFilePath) {
    const heroConfigs = [...this.data.heroConfigs];
    heroConfigs[index].uploading = true;
    this.setData({ heroConfigs });
    
    const token = wx.getStorageSync('token');
    const baseUrl = app.globalData.baseUrl;
    
    wx.uploadFile({
      url: `${baseUrl}/upload/image?type=banner`,
      filePath: tempFilePath,
      name: 'image',
      header: { 'Authorization': `Bearer ${token}` },
      success: (uploadRes) => {
        try {
          const data = JSON.parse(uploadRes.data);
          if (data.code === 0 || data.code === 200) {
            const fileUrl = data.data.url || data.data.file_url || data.data;
            this.saveHeroConfig(index, fileUrl);
          } else {
            throw new Error(data.message || '上传失败');
          }
        } catch (e) {
          this.setHeroUploading(index, false);
          wx.showToast({ title: e.message || '上传失败', icon: 'none' });
        }
      },
      fail: (err) => {
        this.setHeroUploading(index, false);
        const errMsg = (err && err.errMsg) ? err.errMsg : '';
        if (errMsg.includes('timeout')) {
          wx.showToast({ title: '上传超时，请检查网络', icon: 'none' });
        } else {
          wx.showToast({ title: '上传失败，请检查网络', icon: 'none' });
        }
      }
    });
  },
  
  setHeroUploading(index, uploading) {
    const heroConfigs = [...this.data.heroConfigs];
    heroConfigs[index].uploading = uploading;
    this.setData({ heroConfigs });
  },
  
  saveHeroConfig(index, fileUrl) {
    const heroConfig = this.data.heroConfigs[index];
    request({
      url: '/system/configs',
      method: 'PUT',
      data: {
        key: heroConfig.config_key,
        value: fileUrl,
        description: `首页${heroConfig.label}背景图`,
        group: 'hero'
      }
    }).then(res => {
      const heroConfigs = [...this.data.heroConfigs];
      heroConfigs[index].config_value = fileUrl;
      heroConfigs[index].uploading = false;
      this.setData({ heroConfigs });
      wx.showToast({ title: '保存成功', icon: 'success' });
    }).catch(err => {
      this.setHeroUploading(index, false);
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },
  
  onResetHeroImage(e) {
    const { index } = e.currentTarget.dataset;
    const heroConfig = this.data.heroConfigs[index];
    
    wx.showModal({
      title: '确认重置',
      content: `确定要重置「${heroConfig.label}」为默认背景图吗？`,
      success: (res) => {
        if (res.confirm) {
          request({
            url: '/system/configs',
            method: 'PUT',
            data: {
              key: heroConfig.config_key,
              value: '',
              description: `首页${heroConfig.label}背景图`,
              group: 'hero'
            }
          }).then(res => {
            const heroConfigs = [...this.data.heroConfigs];
            heroConfigs[index].config_value = '';
            this.setData({ heroConfigs });
            wx.showToast({ title: '已重置', icon: 'success' });
          }).catch(err => {
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      }
    });
  },
  
  onEditConfig(e) {
    const { index } = e.currentTarget.dataset;
    const config = this.data.configs[index];
    this.setData({
      showEditModal: true,
      editingConfig: { ...config, _type: 'general' },
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
    
    const url = `/config/${editingConfig.config_key}`;
    const data = { config_value: this.data.configValue, description: editingConfig.description };
    
    request({ url, method: 'PUT', data }).then(res => {
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
