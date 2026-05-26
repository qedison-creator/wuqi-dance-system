const { request } = require('../../../utils/request');

Page({
  data: {
    defaultExemption: 3,
    searchKeyword: '',
    memberList: [],
    hasSearched: false
  },

  onLoad() {
    this.loadDefaultExemption();
  },

  // 加载默认豁免次数
  async loadDefaultExemption() {
    try {
      // 直接获取指定配置
      const res = await request({
        url: '/config/default_exemption_count',
        method: 'GET'
      });
      const config = res.data;
      if (config && config.value !== undefined) {
        this.setData({
          defaultExemption: parseInt(config.value) || 3
        });
      }
    } catch (err) {
      // 如果配置不存在，使用默认值
      console.log('使用默认豁免次数:', 3);
    }
  },

  // 默认豁免次数输入
  onDefaultChange(e) {
    this.setData({
      defaultExemption: e.detail.value
    });
  },

  // 保存默认豁免次数
  async saveDefaultExemption() {
    const count = parseInt(this.data.defaultExemption);
    if (isNaN(count) || count < 0) {
      wx.showToast({ title: '请输入有效的次数', icon: 'none' });
      return;
    }

    try {
      await request({
        url: '/config/default_exemption_count',
        method: 'PUT',
        data: { config_value: count.toString(), description: '新注册会员默认豁免次数' }
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      console.error('保存默认豁免次数失败', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  // 搜索会员
  async searchMembers() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) {
      wx.showToast({ title: '请输入搜索关键词', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '搜索中...' });
    
    try {
      const res = await request({
        url: '/members',
        method: 'GET',
        data: { keyword: keyword, pageSize: 20 }
      });
      const list = res.data?.list || [];
      this.setData({
        memberList: list,
        hasSearched: true
      });
    } catch (err) {
      console.error('搜索会员失败', err);
      wx.showToast({ title: '搜索失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 修改会员豁免次数
  async changeExemption(e) {
    const { id, delta } = e.currentTarget.dataset;
    const member = this.data.memberList.find(m => m._id === id);
    if (!member) return;

    const currentCount = member.exemption_count || 0;
    const newCount = currentCount + parseInt(delta);
    
    if (newCount < 0) {
      wx.showToast({ title: '豁免次数不能为负数', icon: 'none' });
      return;
    }

    try {
      await request({
        url: `/members/${id}/exemption`,
        method: 'PUT',
        data: { exemption_count: newCount }
      });
      
      // 更新本地数据
      const newList = this.data.memberList.map(m => {
        if (m._id === id) {
          return { ...m, exemption_count: newCount };
        }
        return m;
      });
      
      this.setData({ memberList: newList });
      wx.showToast({ title: '修改成功', icon: 'success' });
    } catch (err) {
      console.error('修改豁免次数失败', err);
      wx.showToast({ title: '修改失败', icon: 'none' });
    }
  }
});
