const app = getApp();
const { request } = require('../../utils/request');
const { formatDate } = require('../../utils/util');
const { COURSE_DURATIONS, DEFAULT_DURATION } = require('../../utils/config');

Page({
  data: {
    activeTab: 'config',
    salaryConfigList: [],
    salaryStatsList: [],
    statsSummary: null,
    loading: true,
    page: 1,
    pageSize: 20,
    showConfigModal: false,
    editConfig: null,
    selectedCoachId: '',
    selectedCoachName: '',
    configItems: [],
    courseDurations: COURSE_DURATIONS,
    durationOptions: COURSE_DURATIONS.map(d => String(d.value)).concat(['自定义']),
    commonForm: {
      effective_from: '',
      remark: ''
    },
    showStatModal: false,
    currentStat: null,
    coachList: [],
    coachNames: [],
    statForm: {
      startDate: '',
      endDate: ''
    },
    showBillModal: false,
    billPreview: null,
    settledWarning: '',
    totalBillAmount: 0
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (this.data.showConfigModal || this.data.showStatModal || this.data.showBillModal) {
      return;
    }
    if (!this.data.salaryConfigList || this.data.salaryConfigList.length === 0) {
      this.setData({ loading: true });
      this.loadCoachList();
      this.loadConfigList();
    }
    if (this.data.activeTab === 'stats') {
      this.initStatForm();
    }
  },

  initStatForm() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = formatDate(now, 'YYYY-MM-DD');
    this.setData({
      statForm: { startDate, endDate }
    });
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ 
      activeTab: tab, 
      loading: true,
      page: 1 
    });
    if (tab === 'config') {
      this.loadConfigList();
    } else {
      this.initStatForm();
      this.loadStatsList();
      this.loadStatsSummary();
    }
  },

  async loadConfigList() {
    try {
      const res = await request({
        url: '/coach-salaries',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize
        }
      });
      const result = res.data || {};
      const list = result.list || [];
      
      const coachMap = new Map();
      list.forEach(config => {
        const coachId = config.coach_id && config.coach_id._id ? config.coach_id._id : config.coach_id;
        const coachName = config.coach_id && config.coach_id.name ? config.coach_id.name : '未知教练';
        
        if (!coachMap.has(coachId)) {
          coachMap.set(coachId, {
            _id: coachId,
            coach_name: coachName,
            coach_id: config.coach_id,
            is_active: config.is_active,
            effective_from: config.effective_from,
            configs: []
          });
        }
        
        coachMap.get(coachId).configs.push(config);
      });
      
      const groupedList = Array.from(coachMap.values());
      
      this.setData({ 
        salaryConfigList: groupedList,
        loading: false 
      });
    } catch (err) {
      console.error('加载薪酬配置失败', err);
      this.setData({ loading: false });
    }
  },

  async loadStatsList() {
    try {
      const { startDate, endDate } = this.data.statForm;
      const res = await request({
        url: '/coach-salaries/stats/list',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize,
          start_date: startDate,
          end_date: endDate
        }
      });
      const result = res.data || {};
      this.setData({ 
        salaryStatsList: result.list || [],
        loading: false 
      });
    } catch (err) {
      console.error('加载薪酬统计失败', err);
      this.setData({ loading: false });
    }
  },

  async loadStatsSummary() {
    try {
      const { startDate, endDate } = this.data.statForm;
      const res = await request({
        url: '/coach-salaries/stats/summary',
        method: 'GET',
        data: {
          start_date: startDate,
          end_date: endDate
        }
      });
      this.setData({ statsSummary: res.data });
    } catch (err) {
      console.error('加载薪酬汇总失败', err);
    }
  },

  onAddConfig() {
    this.loadCoachList();
    this.setData({ 
      showConfigModal: true,
      editConfig: null,
      selectedCoachId: '',
      selectedCoachName: '',
      configItems: COURSE_DURATIONS.map(d => ({ duration: d.value, salary_rate: 0 })),
      commonForm: {
        effective_from: formatDate(new Date(), 'YYYY-MM-DD'),
        remark: ''
      }
    });
  },

  onEditConfig(e) {
    const coachGroup = e.currentTarget.dataset.item;
    this.loadCoachList().then(() => {
      let coachName = coachGroup.coach_name || '未知教练';
      const coachId = coachGroup._id;
      const coach = this.data.coachList.find(c => c._id === coachId);
      if (coach) {
        coachName = coach.name || coach.nick_name || '未知';
      }
      
      const configItems = (coachGroup.configs || []).map(item => ({
        id: item._id,
        duration: item.duration,
        salary_rate: item.salary_rate,
        effective_from: item.effective_from,
        remark: item.remark
      }));
      
      const firstConfig = configItems[0] || {};
      
      this.setData({ 
        showConfigModal: true,
        editConfig: coachGroup,
        selectedCoachId: coachId,
        selectedCoachName: coachName,
        configItems: configItems.length > 0 ? configItems : COURSE_DURATIONS.map(d => ({ duration: d.value, salary_rate: 0 })),
        commonForm: {
          effective_from: firstConfig.effective_from ? formatDate(new Date(firstConfig.effective_from), 'YYYY-MM-DD') : formatDate(new Date(), 'YYYY-MM-DD'),
          remark: firstConfig.remark || ''
        }
      });
    });
  },

  addConfigItem() {
    const configItems = [...this.data.configItems];
    configItems.push({ duration: DEFAULT_DURATION, salary_rate: 0 });
    this.setData({ configItems });
  },

  removeConfigItem(e) {
    const index = e.currentTarget.dataset.index;
    const configItems = [...this.data.configItems];
    configItems.splice(index, 1);
    this.setData({ configItems });
  },

  onDurationItemChange(e) {
    const index = e.currentTarget.dataset.index;
    const optionIndex = e.detail.value;
    const option = this.data.durationOptions[optionIndex];
    const configItems = [...this.data.configItems];
    
    if (option === '自定义') {
      wx.showModal({
        title: '自定义时长',
        editable: true,
        placeholderText: '请输入时长（分钟）',
        success: (res) => {
          if (res.confirm && res.content) {
            const duration = parseInt(res.content);
            if (duration > 0) {
              configItems[index].duration = duration;
              this.setData({ configItems });
            } else {
              wx.showToast({ title: '请输入有效的时长', icon: 'none' });
            }
          }
        }
      });
    } else {
      configItems[index].duration = parseInt(option);
      this.setData({ configItems });
    }
  },

  onSalaryRateChange(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    const configItems = [...this.data.configItems];
    configItems[index].salary_rate = parseFloat(value) || 0;
    this.setData({ configItems });
  },

  async onSaveConfig() {
    const { selectedCoachId, configItems, commonForm } = this.data;
    
    if (!selectedCoachId) {
      wx.showToast({ title: '请选择教练', icon: 'none' });
      return;
    }
    
    const validItems = configItems.filter(item => item.salary_rate > 0 && item.duration > 0);
    
    if (validItems.length === 0) {
      wx.showToast({ title: '请至少设置一个有效的薪酬配置', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      const promises = validItems.map(item => {
        const submitData = {
          coach_id: selectedCoachId,
          duration: item.duration,
          salary_rate: item.salary_rate,
          effective_from: commonForm.effective_from,
          remark: commonForm.remark
        };
        
        if (item.id) {
          return request({ 
            url: `/coach-salaries/${item.id}`, 
            method: 'PUT', 
            data: submitData 
          });
        } else {
          return request({ 
            url: '/coach-salaries', 
            method: 'POST', 
            data: submitData 
          });
        }
      });
      
      await Promise.all(promises);
      
      wx.hideLoading();
      setTimeout(() => {
        wx.showToast({ title: '保存成功', icon: 'success' });
      }, 100);
      this.setData({ showConfigModal: false });
      this.loadConfigList();
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败', err);
      setTimeout(() => {
        wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none' });
      }, 100);
    }
  },

  onDeleteConfig(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个薪酬配置吗？',
      success: (res) => {
        if (res.confirm) {
          request({ url: `/coach-salaries/${id}`, method: 'DELETE' }).then(() => {
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadConfigList();
          }).catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  onViewStat(e) {
    const stat = e.currentTarget.dataset.item;
    this.setData({ 
      showStatModal: true,
      currentStat: stat 
    });
  },

  onSettleStat() {
    const { currentStat } = this.data;
    wx.showModal({
      title: '确认结算',
      content: `确定要结算教练「${currentStat.coach_id && currentStat.coach_id.name ? currentStat.coach_id.name : '未知'}」的薪酬吗？`,
      success: (res) => {
        if (res.confirm) {
          request({ 
            url: `/coach-salaries/stats/${currentStat._id}/settle`, 
            method: 'PUT',
            data: { remark: '手动结算' }
          }).then(() => {
            wx.showToast({ title: '结算成功', icon: 'success' });
            this.setData({ showStatModal: false });
            this.loadStatsList();
            this.loadStatsSummary();
          }).catch(() => {
            wx.showToast({ title: '结算失败', icon: 'none' });
          });
        }
      }
    });
  },

  onCancelStat() {
    const { currentStat } = this.data;
    wx.showModal({
      title: '确认取消',
      content: '确定要取消这个薪酬统计吗？',
      success: (res) => {
        if (res.confirm) {
          request({ 
            url: `/coach-salaries/stats/${currentStat._id}/cancel`, 
            method: 'PUT',
            data: { reason: '手动取消' }
          }).then(() => {
            wx.showToast({ title: '取消成功', icon: 'success' });
            this.setData({ showStatModal: false });
            this.loadStatsList();
            this.loadStatsSummary();
          }).catch(() => {
            wx.showToast({ title: '取消失败', icon: 'none' });
          });
        }
      }
    });
  },

  stopPropagation() {
  },

  onCloseModal() {
    this.setData({ showConfigModal: false, showStatModal: false });
  },

  onCloseBillModal() {
    this.setData({ showBillModal: false, billPreview: null, settledWarning: '' });
  },

  onCommonInputChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`commonForm.${field}`]: value
    });
  },

  async loadCoachList() {
    try {
      const res = await request({
        url: '/coaches',
        method: 'GET'
      });
      let coachList = [];
      if (res.data && res.data.data) {
        coachList = res.data.data;
      } else if (res.data && res.data.list) {
        coachList = res.data.list;
      } else if (Array.isArray(res.data)) {
        coachList = res.data;
      }
      const coachNames = coachList.map(c => c.name || c.nick_name || '未知');
      this.setData({ coachList, coachNames });
    } catch (err) {
      console.error('加载教练列表失败', err);
    }
  },

  onCoachChange(e) {
    const index = e.detail.value;
    const coach = this.data.coachList[index];
    if (coach) {
      const existingConfigs = this.data.salaryConfigList.filter(item => {
        const itemCoachId = item.coach_id && item.coach_id._id ? item.coach_id._id : item.coach_id;
        return itemCoachId === coach._id;
      });
      
      let configItems;
      if (existingConfigs.length > 0) {
        configItems = existingConfigs.map(item => ({
          id: item._id,
          duration: item.duration,
          salary_rate: item.salary_rate
        }));
      } else {
        configItems = COURSE_DURATIONS.map(d => ({ duration: d.value, salary_rate: 0 }));
      }
      
      this.setData({
        selectedCoachId: coach._id,
        selectedCoachName: coach.name || coach.nick_name || '未知',
        configItems: configItems
      });
    }
  },

  onEffectiveFromChange(e) {
    this.setData({
      'commonForm.effective_from': e.detail.value
    });
  },

  onStatStartDateChange(e) {
    const startDate = e.detail.value;
    let { endDate } = this.data.statForm;
    if (!endDate || endDate < startDate) {
      endDate = startDate;
    }
    this.setData({
      statForm: { startDate, endDate }
    });
  },

  onStatEndDateChange(e) {
    this.setData({
      'statForm.endDate': e.detail.value
    });
  },

  async onGenerateBill() {
    const { startDate, endDate } = this.data.statForm;
    
    if (!startDate || !endDate) {
      wx.showToast({ title: '请选择统计时间范围', icon: 'none' });
      return;
    }
    
    if (startDate > endDate) {
      wx.showToast({ title: '开始日期不能大于结束日期', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '生成预览中...' });
    
    try {
      const res = await request({
        url: '/coach-salaries/stats/generate',
        method: 'POST',
        data: {
          start_date: startDate,
          end_date: endDate,
          preview: true
        }
      });
      
      wx.hideLoading();
      
      if (res.data) {
        const { bill, settled_warning, total_amount } = res.data;
        
        this.setData({
          billPreview: bill,
          settledWarning: settled_warning,
          totalBillAmount: total_amount,
          showBillModal: true
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('生成账单失败', err);
      wx.showToast({ title: err.message || '生成账单失败', icon: 'none' });
    }
  },

  async onConfirmGenerateBill() {
    const { statForm: { startDate, endDate }, settledWarning } = this.data;
    
    if (settledWarning) {
      wx.showModal({
        title: '提示',
        content: settledWarning + ' 确定要继续生成账单吗？',
        success: (res) => {
          if (res.confirm) {
            this.confirmBillGeneration(startDate, endDate);
          }
        }
      });
    } else {
      this.confirmBillGeneration(startDate, endDate);
    }
  },

  async confirmBillGeneration(startDate, endDate) {
    wx.showLoading({ title: '生成账单中...' });
    
    try {
      const res = await request({
        url: '/coach-salaries/stats/generate',
        method: 'POST',
        data: {
          start_date: startDate,
          end_date: endDate,
          preview: false
        }
      });
      
      wx.hideLoading();
      
      if (res.data) {
        wx.showToast({ title: '账单生成成功', icon: 'success' });
        this.setData({ 
          showBillModal: false, 
          billPreview: null, 
          settledWarning: '' 
        });
        this.loadStatsList();
        this.loadStatsSummary();
      }
    } catch (err) {
      wx.hideLoading();
      console.error('生成账单失败', err);
      wx.showToast({ title: err.message || '生成账单失败', icon: 'none' });
    }
  }
});