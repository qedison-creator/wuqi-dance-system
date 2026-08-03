const { request } = require('../../../../utils/request');
const app = getApp();

Page({
  data: {
    defaultExemption: 3,
    savedExemption: 3,   // 上次保存的值，用于判断是否已修改
    saveStatus: '',      // '' | 'saved' | 'modified' | 'saving'
    isExemptionInherited: false, // 当前门店是否继承全局配置
    searchKeyword: '',
    memberList: [],
    hasSearched: false,
    // 门店（只读，从全局shopStoreId同步）
    currentStore: null,       // null 表示"全部门店"
    currentStoreName: '全部门店',
    // 权限
    isSuperAdmin: false
  },

  onLoad() {
    const userInfo = app.globalData.userInfo || {};
    this.setData({ isSuperAdmin: userInfo.role === 'super_admin' });
  },

  onShow() {
    if (!app.checkAuth()) return;
    // 从全局同步门店选择
    const prevStoreId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    this._syncStoreFromGlobal();
    const newStoreId = this.data.currentStore ? String(this.data.currentStore._id) : '';
    // 首次加载或门店变化时重新加载数据
    if (!this._initialized || prevStoreId !== newStoreId) {
      this._initialized = true;
      if (prevStoreId !== newStoreId) {
        // 门店变化时清空会员搜索结果
        this.setData({ memberList: [], hasSearched: false, searchKeyword: '' });
      }
      this.loadDefaultExemption();
    }
  },

  // 从全局shopStoreId同步门店信息
  _syncStoreFromGlobal() {
    const storeList = app.globalData.storeList || [];
    let currentStore = null;
    let currentStoreName = '全部门店';
    // 单门店角色强制使用所属门店
    if (app.isSingleStoreRole()) {
      const defaultStoreId = app.getDefaultStoreId();
      if (defaultStoreId) {
        const matched = storeList.find(s => String(s._id) === String(defaultStoreId));
        if (matched) {
          currentStore = matched;
          currentStoreName = matched.name;
          // 同步回全局，确保后续接口使用所属门店
          app.globalData.shopStoreId = matched._id;
        }
      }
      this.setData({ currentStore, currentStoreName });
      return;
    }
    const shopStoreId = app.globalData.shopStoreId || '';
    if (shopStoreId) {
      const matched = storeList.find(s => String(s._id) === String(shopStoreId));
      if (matched) {
        currentStore = matched;
        currentStoreName = matched.name;
      }
    }
    this.setData({ currentStore, currentStoreName });
  },

  // 加载默认豁免次数（全局或门店级）
  async loadDefaultExemption() {
    const storeId = app.globalData.shopStoreId || '';
    try {
      const res = await request({
        url: '/config/default_exemption_count',
        method: 'GET',
        data: storeId ? { store_id: storeId } : {}
      });
      const config = res.data;
      if (config && config.value !== undefined) {
        const val = parseInt(config.value) || 3;
        this.setData({
          defaultExemption: val,
          savedExemption: val,
          saveStatus: 'saved',
          isExemptionInherited: config.is_inherited === true
        });
      }
    } catch (err) {
      console.log('使用默认豁免次数:', 3);
      this.setData({
        defaultExemption: 3,
        savedExemption: 3,
        saveStatus: 'saved',
        isExemptionInherited: false
      });
    }
  },

  // 默认豁免次数输入
  onDefaultChange(e) {
    const value = e.detail.value;
    // 判断当前值是否与已保存值不同
    const isModified = String(value) !== String(this.data.savedExemption);
    this.setData({
      defaultExemption: value,
      saveStatus: isModified ? 'modified' : 'saved',
    });
  },

  // 保存默认豁免次数
  async saveDefaultExemption() {
    if (this.data.saveStatus === 'saving') return;

    const count = parseInt(this.data.defaultExemption);
    if (isNaN(count) || count < 0) {
      wx.showToast({ title: '请输入有效的次数', icon: 'none' });
      return;
    }

    this.setData({ saveStatus: 'saving' });

    try {
      const storeId = app.globalData.shopStoreId || '';
      await request({
        url: '/config/default_exemption_count',
        method: 'PUT',
        data: {
          config_value: count.toString(),
          description: '新注册会员默认豁免次数',
          ...(storeId ? { store_id: storeId } : {})
        }
      });
      this.setData({
        savedExemption: count,
        saveStatus: 'saved',
        isExemptionInherited: false
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      console.error('保存默认豁免次数失败', err);
      this.setData({ saveStatus: 'modified' });
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
      const storeId = app.globalData.shopStoreId || '';
      const res = await request({
        url: '/members',
        method: 'GET',
        data: {
          keyword: keyword,
          pageSize: 20,
          member_status: 'official',  // 仅搜索已审核正式会员，过滤掉"微信用户"等未完善信息
          ...(storeId ? { store_id: storeId } : {})
        }
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
