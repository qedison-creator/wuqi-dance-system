const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');
const { COURSE_DURATIONS, DEFAULT_DURATION } = require('../../../utils/config');

Page({
  data: {
    activeTab: 'hours',
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
    billPreview: null,
    billGenerated: false,
    settledWarning: '',
    totalBillAmount: 0,
    billSelectedCount: 0,
    billSelectedAmount: 0,
    // 账单列表
    billList: [],
    // 薪酬统计月份列表
    salaryMonthlyYears: [],
    // 自定义时长弹窗
    showCustomDurationModal: false,
    customDurationIndex: -1,
    customDurationValue: '',
    // 课时统计（年份-月份两级结构）
    classHoursYears: [],
    classHoursSummary: null
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (this.data.showConfigModal || this.data.showStatModal) {
      return;
    }
    
    this.loadClassHours();
    this.loadSalaryMonthly();
    this.loadBillList();
    
    if (!this.data.salaryConfigList || this.data.salaryConfigList.length === 0) {
      this.loadCoachList();
      this.loadConfigList();
    } else {
      this.setData({ loading: false });
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
      page: 1 
    });
    if (tab === 'config') {
      this.setData({ loading: true });
      this.loadConfigList();
    } else if (tab === 'stats') {
      this.initStatForm();
      this.loadSalaryMonthly();
      this.loadBillList();
    } else if (tab === 'hours') {
      this.loadClassHours();
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
      // wx.showModal 不支持 editable 参数，使用自定义弹窗

      this.setData({
        showCustomDurationModal: true,
        customDurationIndex: index
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

  // 自定义时长弹窗相关方法
  onCustomDurationInput(e) {
    this.setData({ customDurationValue: e.detail.value });
  },

  onConfirmCustomDuration() {
    const duration = parseInt(this.data.customDurationValue);
    if (!duration || duration <= 0) {
      wx.showToast({ title: '请输入有效的时长', icon: 'none' });
      return;
    }
    
    const { configItems, customDurationIndex } = this.data;
    const newConfigItems = [...configItems];
    newConfigItems[customDurationIndex].duration = duration;
    
    this.setData({
      configItems: newConfigItems,
      showCustomDurationModal: false,
      customDurationValue: ''
    });
  },

  onCloseCustomDurationModal() {
    this.setData({
      showCustomDurationModal: false,
      customDurationValue: ''
    });
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
        // 默认全选，计算勾选汇总

        const preview = (bill || []).map(c => ({ ...c, _selected: true }));
        const selectedTotal = preview.reduce((sum, c) => sum + (c.total_amount || 0), 0);
        
        this.setData({
          billPreview: preview,
          billGenerated: false,
          settledWarning: settled_warning,
          totalBillAmount: total_amount,
          billSelectedCount: preview.length,
          billSelectedAmount: Math.round(selectedTotal * 100) / 100
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('生成账单失败', err);
      wx.showToast({ title: err.message || '生成账单失败', icon: 'none' });
    }
  },

  onCloseBillContent() {
    this.setData({ billPreview: null, billGenerated: false, settledWarning: '', billSelectedCount: 0, billSelectedAmount: 0 });
  },

  // ==================== 账单列表 ====================

  async loadBillList() {
    try {
      const res = await request({
        url: '/coach-salaries/stats/bills',
        method: 'GET'
      });
      if (res.data) {
        // 预格式化日期，生成唯一标题

        const fmt = (v) => {
          if (!v) return '';
          const s = typeof v === 'string' ? v.split('T')[0] : new Date(v).toISOString().split('T')[0];
          const parts = s.split('-');
          return `${parts[1]}/${parts[2]}`;
        };
        const bills = (res.data.list || []).map(b => {
          b._title = `${fmt(b.start_date)}-${fmt(b.end_date)} 教练薪酬结算`;
          b._start = fmt(b.start_date);
          b._end = fmt(b.end_date);
          b._gen = fmt(b.created_at);
          b._coaches = (b.coaches || []).map(c => c.coach_name).join('、');
          return b;
        });
        this.setData({ billList: bills });
      }
    } catch (err) {
      console.error('加载账单列表失败:', err);
    }
  },

  // ==================== 账单卡片操作 ====================

  onToggleBillCard(e) {
    const { index } = e.currentTarget.dataset;
    const billList = this.data.billList;
    billList[index]._expanded = !billList[index]._expanded;
    this.setData({ billList });
  },

  onExportBillCard(e) {
    const { index } = e.currentTarget.dataset;
    const bill = this.data.billList[index];
    if (!bill) return;

    const fmt = (v) => {
      if (!v) return '';
      const s = typeof v === 'string' ? v.split('T')[0] : new Date(v).toISOString().split('T')[0];
      return s;
    };

    wx.showLoading({ title: '生成表格中...' });

    // 生成 HTML 表格格式，保存为 .xls（Excel/WPS 可直接打开）

    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"></head><body>';
    html += '<table border="1" cellspacing="0" cellpadding="4" style="font-family:微软雅黑;font-size:12px;">';

    // 标题行
    html += '<tr><td colspan="4" style="text-align:center;font-size:16px;font-weight:bold;">舞栖DANCE · 教练薪酬结算单</td></tr>';
    html += `<tr><td colspan="2">结算周期</td><td colspan="2">${fmt(bill.start_date)} ~ ${fmt(bill.end_date)}</td></tr>`;
    html += `<tr><td colspan="2">生成日期</td><td colspan="2">${fmt(bill.created_at)}</td></tr>`;
    html += '<tr></tr>';

    // 表头
    html += '<tr style="background-color:#f5f5f5;font-weight:bold;">';
    html += '<td style="text-align:center;width:120px;">教练</td>';
    html += '<td style="text-align:center;width:160px;">课程明细</td>';
    html += '<td style="text-align:center;width:120px;">单价/数量</td>';
    html += '<td style="text-align:center;width:100px;">金额</td>';
    html += '</tr>';

    // 数据行
    (bill.coaches || []).forEach(c => {
      const items = c.items || [];
      if (items.length === 0) {
        html += `<tr><td>${c.coach_name}</td><td>-</td><td>-</td><td style="text-align:right;">¥${c.total_amount || 0}</td></tr>`;
      } else {
        items.forEach((it, idx) => {
          html += '<tr>';
          if (idx === 0) {
            html += `<td rowspan="${items.length}">${c.coach_name}</td>`;
          }
          html += `<td style="text-align:center;">${it.duration}分钟 × ${it.count}节</td>`;
          html += `<td style="text-align:center;">¥${it.rate}/节</td>`;
          html += `<td style="text-align:right;">¥${it.amount}</td>`;
          html += '</tr>';
        });
      }
      // 教练小计
      html += `<tr style="background-color:#fff8f5;"><td colspan="3" style="text-align:right;">${c.coach_name} 小计</td><td style="text-align:right;font-weight:bold;">¥${c.total_amount}</td></tr>`;
    });

    // 合计行
    html += `<tr style="background-color:#fcebeb;font-weight:bold;"><td colspan="3" style="text-align:right;">合计金额</td><td style="text-align:right;">¥${bill.total_amount}</td></tr>`;

    html += '</table></body></html>';

    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/教练薪酬结算单_${fmt(bill.start_date)}_${fmt(bill.end_date)}.xls`;

    try {
      fs.writeFileSync(filePath, html, 'utf8');
      wx.hideLoading();
      wx.openDocument({
        filePath: filePath,
        fileType: 'xls',
        showMenu: true,
        success: () => {
          wx.showToast({ title: '导出成功，可保存/分享', icon: 'none', duration: 2500 });
        },
        fail: (err) => {
          console.error('打开文档失败:', err);
          wx.showToast({ title: '打开文档失败', icon: 'none' });
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.error('写入文件失败:', err);
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },

  onDeleteBill(e) {
    const { index } = e.currentTarget.dataset;
    const bill = this.data.billList[index];
    if (!bill) return;

    wx.showModal({
      title: '删除账单',
      content: `确定删除「${bill._title}」吗？此操作不可恢复。`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/coach-salaries/stats/bills/${bill._id}`,
              method: 'DELETE'
            });
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadBillList();
          } catch (err) {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
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
    // 只生成选中的教练

    const selectedCoachIds = this.data.billPreview
      .filter(c => c._selected)
      .map(c => c.coach_id);
    
    if (selectedCoachIds.length === 0) {
      wx.showToast({ title: '请至少选择一位教练', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '生成账单中...' });
    
    try {
      const res = await request({
        url: '/coach-salaries/stats/generate',
        method: 'POST',
        data: {
          start_date: startDate,
          end_date: endDate,
          preview: false,
          coach_ids: selectedCoachIds
        }
      });
      
      wx.hideLoading();
      
      if (res.data) {
        wx.showToast({ title: '账单生成成功', icon: 'success' });
        // 清除预览、关闭面板、刷新账单列表和月度薪酬

        this.setData({ 
          billPreview: null, 
          billGenerated: false, 
          settledWarning: '',
          billSelectedCount: 0,
          billSelectedAmount: 0
        });
        this.loadSalaryMonthly();
        this.loadBillList();
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '生成账单失败', icon: 'none' });
    }
  },

  // ==================== 课时统计 ====================

  async loadClassHours() {
    try {
      const res = await request({
        url: '/coach-salaries/stats/class-hours',
        method: 'GET'
      });
      if (res.data) {
        const { years, summary } = res.data;
        this.setData({
          classHoursYears: years || [],
          classHoursSummary: summary || null,
          loading: false
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error('加载课时统计失败', err);
      this.setData({ loading: false });
    }
  },

  // 点击月份横条展开/收起
  onToggleHoursMonth(e) {
    const { yi, mi } = e.currentTarget.dataset;
    const years = this.data.classHoursYears;
    const month = years[yi].months[mi];
    month._expanded = !month._expanded;
    this.setData({ classHoursYears: years });
  },

  // 点击教练卡片展开/收起上课记录
  onToggleHoursCoach(e) {
    const { yi, mi, ci } = e.currentTarget.dataset;
    const years = this.data.classHoursYears;
    const coach = years[yi].months[mi].coaches[ci];
    coach._expanded = !coach._expanded;
    this.setData({ classHoursYears: years });
  },

  // ==================== 薪酬统计月份列表 ====================

  async loadSalaryMonthly() {
    try {
      const res = await request({
        url: '/coach-salaries/stats/monthly-salary',
        method: 'GET'
      });
      if (res.data) {
        const years = (res.data.years || []).map(year => ({
          ...year,
          months: (year.months || []).map(month => ({
            ...month,
            totalAmount: Math.round((month.coaches || []).reduce((sum, c) => sum + (c.total_amount || 0), 0) * 100) / 100
          }))
        }));
        this.setData({ salaryMonthlyYears: years, loading: false });
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error('加载月度薪酬明细失败:', err);
      this.setData({ loading: false });
    }
  },

  onToggleSalaryMonth(e) {
    const { yi, mi } = e.currentTarget.dataset;
    const years = this.data.salaryMonthlyYears;
    const month = years[yi].months[mi];
    month._expanded = !month._expanded;
    this.setData({ salaryMonthlyYears: years });
  },

  // ==================== 账单勾选 ====================

  onToggleBillCoach(e) {
    if (this.data.billGenerated) return;
    const { index } = e.currentTarget.dataset;
    const billPreview = this.data.billPreview;
    billPreview[index]._selected = !billPreview[index]._selected;
    this.updateBillSelection(billPreview);
  },

  updateBillSelection(billPreview) {
    const selected = billPreview.filter(c => c._selected);
    const total = selected.reduce((sum, c) => sum + (c.total_amount || 0), 0);
    this.setData({
      billPreview,
      billSelectedCount: selected.length,
      billSelectedAmount: Math.round(total * 100) / 100
    });
  },

  // ==================== 账单导出 ====================

  onExportBill() {
    const { billPreview, statForm, billSelectedCount, billSelectedAmount } = this.data;
    if (!billPreview || billPreview.length === 0) {
      wx.showToast({ title: '暂无账单数据', icon: 'none' });
      return;
    }

    const selected = billPreview.filter(c => c._selected);
    if (selected.length === 0) {
      wx.showToast({ title: '请至少选择一位教练', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '生成表格中...' });

    // 生成 HTML 表格格式，保存为 .xls（Excel/WPS 可直接打开）

    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"></head><body>';
    html += '<table border="1" cellspacing="0" cellpadding="4" style="font-family:微软雅黑;font-size:12px;">';

    // 标题行
    html += '<tr><td colspan="4" style="text-align:center;font-size:16px;font-weight:bold;">舞栖DANCE · 教练薪酬账单</td></tr>';
    html += `<tr><td colspan="2">结算周期</td><td colspan="2">${statForm.startDate} ~ ${statForm.endDate}</td></tr>`;
    html += `<tr><td colspan="2">导出时间</td><td colspan="2">${new Date().toLocaleString('zh-CN')}</td></tr>`;
    html += `<tr><td colspan="2">教练数量</td><td colspan="2">${billSelectedCount} 位</td></tr>`;
    html += '<tr></tr>';

    // 表头
    html += '<tr style="background-color:#f5f5f5;font-weight:bold;">';
    html += '<td style="text-align:center;width:120px;">教练</td>';
    html += '<td style="text-align:center;width:160px;">课程明细</td>';
    html += '<td style="text-align:center;width:120px;">单价/数量</td>';
    html += '<td style="text-align:center;width:100px;">金额</td>';
    html += '</tr>';

    // 数据行
    selected.forEach(c => {
      const items = c.items || [];
      if (items.length === 0) {
        html += `<tr><td>${c.coach_name}</td><td>-</td><td>-</td><td style="text-align:right;">¥${c.total_amount || 0}</td></tr>`;
      } else {
        items.forEach((it, idx) => {
          html += '<tr>';
          if (idx === 0) {
            html += `<td rowspan="${items.length}">${c.coach_name}</td>`;
          }
          html += `<td style="text-align:center;">${it.duration}分钟 × ${it.count}节</td>`;
          html += `<td style="text-align:center;">¥${it.rate}/节</td>`;
          html += `<td style="text-align:right;">¥${it.amount}</td>`;
          html += '</tr>';
        });
      }
      // 教练小计
      html += `<tr style="background-color:#fff8f5;"><td colspan="3" style="text-align:right;">${c.coach_name} 小计</td><td style="text-align:right;font-weight:bold;">¥${c.total_amount}</td></tr>`;
    });

    // 合计行
    html += `<tr style="background-color:#fcebeb;font-weight:bold;"><td colspan="3" style="text-align:right;">合计金额</td><td style="text-align:right;">¥${billSelectedAmount}</td></tr>`;

    html += '</table></body></html>';

    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/教练薪酬账单_${statForm.startDate}_${statForm.endDate}.xls`;

    try {
      fs.writeFileSync(filePath, html, 'utf8');
      wx.hideLoading();
      wx.openDocument({
        filePath: filePath,
        fileType: 'xls',
        showMenu: true,
        success: () => {
          wx.showToast({ title: '导出成功，可保存/分享', icon: 'none', duration: 2500 });
        },
        fail: (err) => {
          console.error('打开文档失败:', err);
          wx.showToast({ title: '打开文档失败', icon: 'none' });
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.error('写入文件失败:', err);
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },
});