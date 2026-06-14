const app = getApp();
const { request } = require('../../utils/request');
const { formatDate } = require('../../utils/util');

// 前端计算放假天数的备用函数
const calculateDaysCount = (startDate, endDate) => {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  const diffTime = end - start;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
};

Page({
  data: {
    holidays: [],
    isAdmin: false,
    showAddModal: false,
    formData: {
      _id: '',
      title: '',
      startDate: '',
      endDate: '',
      storeScope: 'all',
      selectedStoreId: '',
      reason: ''
    },
    storeList: [],
    storePickerIndex: 0,
    deleting: false, // 防抖标志位
    selectedStoreName: ''
  },

  onShow() {
    if (!app.checkAuth()) return;
    const userInfo = app.globalData.userInfo;
    this.setData({
      isAdmin: userInfo && (userInfo.role === 'super_admin'),
      storeList: app.globalData.storeList || []
    });
    this.loadHolidays();
  },

  async loadHolidays() {
    try {
      const res = await request({
        url: '/holidays',
        method: 'GET'
      });
      let list = res.data && res.data.list ? res.data.list : (res.data || []);
      
      // 前端备用处理 - 计算天数和处理门店名称
      list = list.map(item => {
        const newItem = { ...item };
        // 如果后端没有计算或者计算为0，则前端重新计算
        if (!newItem.daysCount || newItem.daysCount === 0) {
          const start = newItem.start_date || newItem.date;
          const end = newItem.end_date || newItem.date;
          newItem.daysCount = calculateDaysCount(start, end);
        }
        
        // 前端备用处理 - 如果没有 storeNames 但有 store_id，尝试从 storeList 中查找
        if (newItem.store_scope === 'single' && (!newItem.storeNames || newItem.storeNames.length === 0)) {
          let storeId = newItem.store_id_str || '';
          if (!storeId && newItem.store_id) {
            if (typeof newItem.store_id === 'object') {
              storeId = newItem.store_id._id || newItem.store_id.id || '';
            } else {
              storeId = newItem.store_id;
            }
          }
          
          if (storeId && this.data.storeList.length > 0) {
            const foundStore = this.data.storeList.find(s => String(s._id) === String(storeId));
            if (foundStore) {
              newItem.storeNames = [foundStore.name];
            }
          }
        }
        
        return newItem;
      });
      
      this.setData({ holidays: list });
    } catch (err) {
      console.error('加载放假列表失败', err);
    }
  },

  onAdd() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '仅超级管理员可操作', icon: 'none' });
      return;
    }
    this.setData({
      showAddModal: true,
      formData: {
        _id: '',
        title: '',
        startDate: '',
        endDate: '',
        storeScope: 'all',
        selectedStoreId: '',
        reason: ''
      },
      storePickerIndex: 0,
      selectedStoreName: ''
    });
  },

  onCloseAddModal() {
    this.setData({ showAddModal: false });
  },

  onModalTap() {},

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`formData.${field}`]: e.detail.value });
  },

  onStartDateChange(e) {
    this.setData({ 
      'formData.startDate': e.detail.value,
      // 如果还没有选择结束日期，或者结束日期早于开始日期，则默认结束日期为开始日期
      'formData.endDate': !this.data.formData.endDate || this.data.formData.endDate < e.detail.value ? e.detail.value : this.data.formData.endDate
    });
  },

  onEndDateChange(e) {
    this.setData({ 'formData.endDate': e.detail.value });
  },

  onScopeChange(e) {
    const scope = e.currentTarget.dataset.scope;
    this.setData({
      'formData.storeScope': scope,
      'formData.selectedStoreId': scope === 'all' ? '' : this.data.formData.selectedStoreId
    });
  },

  // 门店选择器变化
  onStorePickerChange(e) {
    const index = e.detail.value;
    const store = this.data.storeList[index];
    if (store) {
      this.setData({
        storePickerIndex: index,
        'formData.selectedStoreId': String(store._id),
        selectedStoreName: store.name
      });
    }
  },

  async onSubmitHoliday() {
    const { formData } = this.data;
    if (!formData.title || !formData.startDate || !formData.endDate) {
      wx.showToast({ title: '请填写必要信息', icon: 'none' });
      return;
    }

    if (formData.storeScope === 'single' && !formData.selectedStoreId) {
      wx.showToast({ title: '请选择适用门店', icon: 'none' });
      return;
    }

    const submitData = {
      name: formData.title,
      start_date: formData.startDate,
      end_date: formData.endDate,
      store_scope: formData.storeScope,
      store_id: formData.storeScope === 'single' ? formData.selectedStoreId : undefined,
      description: formData.reason
    };

    try {
      if (formData._id) {
        await request({
          url: `/holidays/${formData._id}`,
          method: 'PUT',
          data: submitData
        });
      } else {
        await request({
          url: '/holidays',
          method: 'POST',
          data: submitData
        });
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ showAddModal: false });
      this.loadHolidays();
    } catch (err) {
      console.error('保存放假失败', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  onEdit(e) {
    const { index } = e.currentTarget.dataset;
    const holiday = this.data.holidays[index];

    // 使用后端提供的 store_id_str，如果没有再尝试解析 store_id
    let storeId = holiday.store_id_str || '';
    if (!storeId && holiday.store_id) {
      if (typeof holiday.store_id === 'object') {
        storeId = holiday.store_id._id || holiday.store_id.id || '';
      } else {
        storeId = holiday.store_id;
      }
    }
    
    // 确保 storeId 是字符串
    storeId = storeId ? String(storeId) : '';

    // 查找门店在 storeList 中的索引
    let storePickerIndex = 0;
    let selectedStoreName = '';
    if (storeId && this.data.storeList.length > 0) {
      const foundIndex = this.data.storeList.findIndex(s => String(s._id) === storeId);
      if (foundIndex !== -1) {
        storePickerIndex = foundIndex;
        selectedStoreName = this.data.storeList[foundIndex].name;
      }
    }
    
    this.setData({
      showAddModal: true,
      formData: {
        _id: holiday._id,
        title: holiday.name || holiday.title,
        startDate: holiday.start_date || holiday.date,
        endDate: holiday.end_date || holiday.date,
        storeScope: holiday.store_scope || 'all',
        selectedStoreId: storeId,
        reason: holiday.description || holiday.reason
      },
      storePickerIndex,
      selectedStoreName
    });
  },

  async onRevoke(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认撤销',
      content: '确认撤销此放假安排？相关课程将恢复。',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/holidays/${id}/cancel`,
              method: 'PUT'
            });
            wx.showToast({ title: '已撤销', icon: 'success' });
            this.loadHolidays();
          } catch (err) {
            console.error('撤销放假失败', err);
            wx.showToast({ title: '撤销失败', icon: 'none' });
          }
        }
      }
    });
  },

  async onDelete(e) {
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在删除中，请稍候', icon: 'none' });
      return;
    }
    
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '确认删除此放假安排？此操作不可恢复。',
      confirmColor: '#FF3B30',
      success: async (res) => {
        if (res.confirm) {
          try {
            // 设置防抖标志位
            this.setData({ deleting: true });
            await request({
              url: `/holidays/${id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadHolidays();
          } catch (err) {
            console.error('删除放假失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          } finally {
            // 无论成功或失败，都重置防抖标志位
            this.setData({ deleting: false });
          }
        }
      },
      fail: () => {
        // 用户取消删除，重置防抖标志位
        this.setData({ deleting: false });
      }
    });
  }
});
