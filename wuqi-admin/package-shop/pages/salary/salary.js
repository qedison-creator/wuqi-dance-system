const app = getApp();
const { request } = require('../../../utils/request');
const { formatDate } = require('../../../utils/util');

// 'YYYY-MM-DD' 格式化（兼容 ISO 字符串与 Date）
const fmtDay = (v) => {
  if (!v) return '';
  const s = typeof v === 'string' ? v.split('T')[0] : new Date(v).toISOString().split('T')[0];
  return s;
};

// 结束日期按"含当天"展示：内部存储为截止日零点（不含当天），展示时减一天
const inclusiveEnd = (v) => {
  if (!v) return '';
  const d = new Date(v);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

Page({
  data: {
    activeTab: 'hours',
    salaryConfigList: [],
    rateGaps: [],
    gapPanelExpanded: false,
    gapClassTotal: 0,
    loading: true,
    pageSize: 200,
    coachList: [],
    coachNames: [],
    statForm: {
      startDate: '',
      endDate: ''
    },
    billPreview: null,
    billGenerated: false,
    // 账单生成提示：未配置单价未入账（按教练折叠）；已入账跳过数
    billUnresolvedCoachs: [],
    billUnresolvedClassTotal: 0,
    billUnresolvedExpanded: false,
    billSkippedCount: 0,
    totalBillAmount: 0,
    billSelectedCount: 0,
    billSelectedAmount: 0,
    // 账单列表
    billList: [],
    // 月度薪酬（单年）
    salaryMonthlyYears: [],
    monthlyYear: 0,
    monthYearOptions: [],
    // 课时统计（单年，逐课明细懒加载）
    classHoursYears: [],
    hoursYear: 0,
    hoursYearOptions: [],
    hoursOrphanCount: 0,
    hoursSummary: null,
    // 添加一期单价弹窗
    showAddPeriodModal: false,
    addPeriodForm: {
      coach_id: '',
      coach_name: '',
      duration: '',
      effective_from: '',
      salary_rate: '',
      remark: '',
      _lockCoach: false,
      _lockDuration: false
    },
    // 编辑时期弹窗（开始/结束日期与单价）
    showEditPeriodModal: false,
    editPeriodForm: {
      id: '',
      coach_name: '',
      duration: 0,
      oldPeriod: '',
      effective_from: '',
      effective_to: '',
      noEnd: true,
      salary_rate: ''
    }
  },

  onShow() {
    if (!app.checkAuth()) return;
    // 审核员禁止访问薪酬页（商业秘密隔离，与后端 coach-salary 路由拦截一致）
    const role = (app.globalData.userInfo || {}).role;
    if (role === 'reviewer') {
      wx.showModal({ title: '无权访问', content: '审核员账号不可查看薪酬数据', showCancel: false, success: () => wx.navigateBack() });
      return;
    }
    if (this.data.showAddPeriodModal || this.data.showEditPeriodModal) {
      return;
    }

    const nowYear = new Date().getFullYear();
    const yearOptions = [nowYear, nowYear - 1, nowYear - 2].map(String);
    this.setData({
      hoursYear: this.data.hoursYear || nowYear,
      hoursYearOptions: yearOptions,
      monthlyYear: this.data.monthlyYear || nowYear,
      monthYearOptions: yearOptions
    });

    this.initStatForm();
    this.loadClassHours();
    this.loadSalaryMonthly();
    this.loadBillList();

    if (!this.data.salaryConfigList || this.data.salaryConfigList.length === 0) {
      this.loadConfigList();
    } else {
      this.setData({ loading: false });
    }
    this.loadRateGaps();
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'config') {
      this.setData({ loading: true });
      this.loadConfigList();
      this.loadRateGaps();
    } else if (tab === 'stats') {
      this.loadSalaryMonthly();
      this.loadBillList();
    } else if (tab === 'hours') {
      this.loadClassHours();
    }
  },

  // ==================== 课时统计（按年，明细懒加载） ====================

  onHoursYearChange(e) {
    const year = Number(this.data.hoursYearOptions[e.detail.value]);
    if (year && year !== this.data.hoursYear) {
      this.setData({ hoursYear: year });
      this.loadClassHours(year);
    }
  },

  async loadClassHours(year) {
    try {
      const shopStoreId = app.globalData.shopStoreId || '';
      const params = { year: year || this.data.hoursYear };
      if (shopStoreId) params.store_id = shopStoreId;
      const res = await request({
        url: '/coach-salaries/stats/class-hours',
        method: 'GET',
        data: params
      });
      if (res.data) {
        const hasData = (res.data.months || []).length > 0;
        this.setData({
          classHoursYears: hasData ? [res.data] : [],
          hoursOrphanCount: res.data.orphan_count || 0,
          hoursSummary: res.data.summary || null,
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

  // 点击教练卡片展开/收起：首次展开时懒加载逐课明细，并按门店分组拆入各 store
  async onToggleHoursCoach(e) {
    const { yi, mi, ci } = e.currentTarget.dataset;
    const years = this.data.classHoursYears;
    const month = years[yi].months[mi];
    const coach = month.coaches[ci];
    if (!coach._expanded && !coach._recordsLoaded) {
      try {
        const shopStoreId = app.globalData.shopStoreId || '';
        const params = {
          year: years[yi].year,
          month: month.monthKey,
          coach_id: coach.coach_id
        };
        if (shopStoreId) params.store_id = shopStoreId;
        const res = await request({
          url: '/coach-salaries/stats/class-hours/detail',
          method: 'GET',
          data: params
        });
        const recs = (res.data && res.data.records) || [];
        recs.forEach((r, i) => { r._key = `${r.class_date}_${r.start_time}_${i}`; });
        coach._recordsLoaded = true;
        (coach.stores || []).forEach(s => {
          s.records = recs.filter(r => r.store_name === s.store_name);
        });
      } catch (err) {
        console.error('加载课时明细失败', err);
        wx.showToast({ title: err.message || '加载明细失败', icon: 'none' });
      }
    }
    coach._expanded = !coach._expanded;
    this.setData({ classHoursYears: years });
  },

  // ==================== 月度薪酬明细（按年） ====================

  onMonthlyYearChange(e) {
    const year = Number(this.data.monthYearOptions[e.detail.value]);
    if (year && year !== this.data.monthlyYear) {
      this.setData({ monthlyYear: year });
      this.loadSalaryMonthly(year);
    }
  },

  async loadSalaryMonthly() {
    try {
      const shopStoreId = app.globalData.shopStoreId || '';
      const params = { year: this.data.monthlyYear };
      if (shopStoreId) params.store_id = shopStoreId;
      const res = await request({
        url: '/coach-salaries/stats/monthly-salary',
        method: 'GET',
        data: params
      });
      if (res.data) {
        const hasData = (res.data.months || []).length > 0;
        this.setData({ salaryMonthlyYears: hasData ? [res.data] : [], loading: false });
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

  // ==================== 薪酬配置（单价时间线管理） ====================

  async loadConfigList() {
    try {
      const shopStoreId = app.globalData.shopStoreId || '';
      const params = {
        page: 1,
        pageSize: this.data.pageSize,
        is_active: 'all'
      };
      if (shopStoreId) params.store_id = shopStoreId;
      const res = await request({
        url: '/coach-salaries',
        method: 'GET',
        data: params
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
            is_deleted_coach: !!(config.coach_id && config.coach_id.is_deleted),
            configs: []
          });
        }

        const fromStr = fmtDay(config.effective_from);
        const toStr = config.effective_to ? fmtDay(config.effective_to) : '';
        coachMap.get(coachId).configs.push({
          ...config,
          _range: `${fromStr} ~ ${toStr ? inclusiveEnd(config.effective_to) : '至今'}`,
          // 倒挂/空期（结束早于等于开始）标记为异常，提示管理员编辑修正
          _bad: !!(toStr && toStr <= fromStr)
        });
      });

      const groupedList = Array.from(coachMap.values());
      // 按时长分组，组内按生效日期降序（最新一期在前）
      groupedList.forEach(g => {
        const dmap = {};
        g.configs.forEach(cfg => {
          if (!dmap[cfg.duration]) dmap[cfg.duration] = [];
          dmap[cfg.duration].push(cfg);
        });
        g.durationGroups = Object.keys(dmap)
          .map(d => ({
            duration: Number(d),
            versions: dmap[d].sort((a, b) => (String(a.effective_from) < String(b.effective_from) ? 1 : -1))
          }))
          .sort((a, b) => a.duration - b.duration);
      });

      this.setData({
        salaryConfigList: groupedList,
        loading: false
      });
    } catch (err) {
      console.error('加载薪酬配置失败', err);
      this.setData({ loading: false });
    }
  },

  // 课时单价空档：有已上课但该日期没匹配到任何生效单价（按教练折叠展示）
  async loadRateGaps() {
    try {
      const shopStoreId = app.globalData.shopStoreId || '';
      const params = {};
      if (shopStoreId) params.store_id = shopStoreId;
      const res = await request({
        url: '/coach-salaries/stats/rate-gaps',
        method: 'GET',
        data: params
      });
      const gaps = (res.data && res.data.gaps) || [];
      const coachMap = new Map();
      gaps.forEach(g => {
        if (!coachMap.has(g.coach_id)) {
          coachMap.set(g.coach_id, {
            coach_id: g.coach_id,
            coach_name: g.coach_name,
            periodCount: 0,
            classCount: 0,
            items: [],
            _expanded: false
          });
        }
        const c = coachMap.get(g.coach_id);
        c.periodCount += 1;
        c.classCount += g.count;
        c.items.push({ ...g, _key: `${g.duration}_${g.store_id || ''}_${g.from}` });
      });
      const gapCoachList = Array.from(coachMap.values());
      this.setData({
        rateGaps: gapCoachList,
        gapClassTotal: gapCoachList.reduce((sum, c) => sum + c.classCount, 0)
      });
    } catch (err) {
      console.error('加载单价空档失败', err);
    }
  },

  // 展开/收起整个空档提示面板
  onToggleGapPanel() {
    this.setData({ gapPanelExpanded: !this.data.gapPanelExpanded });
  },

  onToggleGapCoach(e) {
    const { index } = e.currentTarget.dataset;
    const rateGaps = this.data.rateGaps;
    rateGaps[index]._expanded = !rateGaps[index]._expanded;
    this.setData({ rateGaps });
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

  // ---- 添加一期单价 ----

  onAddConfig() {
    this.loadCoachList();
    this.openAddPeriod({});
  },

  // 卡片内"+ 添加时长"：教练锁定
  onAddConfigFor(e) {
    const group = e.currentTarget.dataset.item;
    if (group.is_deleted_coach) {
      wx.showToast({ title: '已删除教练的配置已锁定，如需补配历史费率请联系超级管理员', icon: 'none', duration: 2500 });
      return;
    }
    this.openAddPeriod({ coach_id: group._id, coach_name: group.coach_name, _lockCoach: true });
  },

  // 时长分组内"+ 加一期"：教练+时长锁定
  onAddPeriod(e) {
    const { group, duration } = e.currentTarget.dataset;
    if (group.is_deleted_coach) {
      wx.showToast({ title: '已删除教练的配置已锁定，如需补配历史费率请联系超级管理员', icon: 'none', duration: 2500 });
      return;
    }
    this.openAddPeriod({
      coach_id: group._id,
      coach_name: group.coach_name,
      duration: String(duration),
      _lockCoach: true,
      _lockDuration: true
    });
  },

  openAddPeriod(prefill = {}) {
    this.setData({
      showAddPeriodModal: true,
      addPeriodForm: {
        coach_id: prefill.coach_id || '',
        coach_name: prefill.coach_name || '',
        duration: prefill.duration || '',
        effective_from: formatDate(new Date(), 'YYYY-MM-DD'),
        salary_rate: '',
        remark: '',
        _lockCoach: !!prefill._lockCoach,
        _lockDuration: !!prefill._lockDuration
      }
    });
  },

  onAddPeriodCoachChange(e) {
    const coach = this.data.coachList[e.detail.value];
    if (coach) {
      this.setData({
        'addPeriodForm.coach_id': coach._id,
        'addPeriodForm.coach_name': coach.name || coach.nick_name || '未知'
      });
    }
  },

  onAddPeriodInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`addPeriodForm.${field}`]: e.detail.value });
  },

  onAddPeriodDateChange(e) {
    this.setData({ 'addPeriodForm.effective_from': e.detail.value });
  },

  onCloseAddPeriod() {
    this.setData({ showAddPeriodModal: false });
  },

  async onSaveAddPeriod() {
    const f = this.data.addPeriodForm;
    if (!f.coach_id) {
      wx.showToast({ title: '请选择教练', icon: 'none' });
      return;
    }
    const duration = parseInt(f.duration, 10);
    if (!duration || duration <= 0) {
      wx.showToast({ title: '请输入有效的课程时长', icon: 'none' });
      return;
    }
    const rate = parseFloat(f.salary_rate);
    if (isNaN(rate) || rate < 0) {
      wx.showToast({ title: '请输入有效的单价', icon: 'none' });
      return;
    }
    if (!f.effective_from) {
      wx.showToast({ title: '请选择生效日期', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    try {
      const shopStoreId = app.globalData.shopStoreId || '';
      const submitData = {
        coach_id: f.coach_id,
        duration,
        salary_rate: rate,
        effective_from: f.effective_from,
        remark: f.remark
      };
      if (shopStoreId) submitData.store_id = shopStoreId;

      await request({
        url: '/coach-salaries',
        method: 'POST',
        data: submitData
      });

      wx.hideLoading();
      wx.showToast({ title: '已添加', icon: 'success' });
      this.setData({ showAddPeriodModal: false });
      this.loadConfigList();
      this.loadRateGaps();
      this.loadSalaryMonthly();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none', duration: 2500 });
    }
  },

  // ---- 编辑某一期（起止日期 + 单价） ----

  onEditPeriod(e) {
    const cfg = e.currentTarget.dataset.cfg;
    const coachName = e.currentTarget.dataset.coachname || '';
    if (!cfg || !cfg._id) return;
    this.setData({
      showEditPeriodModal: true,
      editPeriodForm: {
        id: cfg._id,
        coach_name: coachName,
        duration: cfg.duration,
        oldPeriod: cfg._range || '',
        effective_from: fmtDay(cfg.effective_from),
        effective_to: cfg.effective_to ? fmtDay(cfg.effective_to) : '',
        noEnd: !cfg.effective_to,
        salary_rate: String(cfg.salary_rate)
      }
    });
  },

  onEditPeriodInput(e) {
    this.setData({ 'editPeriodForm.salary_rate': e.detail.value });
  },

  onEditPeriodFromChange(e) {
    this.setData({ 'editPeriodForm.effective_from': e.detail.value });
  },

  onEditPeriodToChange(e) {
    this.setData({ 'editPeriodForm.effective_to': e.detail.value });
  },

  onEditPeriodNoEnd(e) {
    this.setData({ 'editPeriodForm.noEnd': e.detail.value });
  },

  onCloseEditPeriod() {
    this.setData({ showEditPeriodModal: false });
  },

  onSaveEditPeriod() {
    const f = this.data.editPeriodForm;
    const rate = parseFloat(f.salary_rate);
    if (isNaN(rate) || rate < 0) {
      wx.showToast({ title: '请输入有效的单价', icon: 'none' });
      return;
    }
    if (!f.effective_from) {
      wx.showToast({ title: '请选择开始日期', icon: 'none' });
      return;
    }
    if (!f.noEnd && !f.effective_to) {
      wx.showToast({ title: '请选择结束日期，或开启长期有效', icon: 'none' });
      return;
    }

    const periodText = `${f.effective_from} ~ ${f.noEnd ? '至今' : f.effective_to}`;
    wx.showModal({
      title: '确认保存',
      content: `确定将「${f.coach_name}」${f.duration}分钟这一期调整为 ${periodText}、¥${rate}/节 吗？该时期有已入账课程时，金额将按新单价重算。`,
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '保存中...' });
        try {
          await request({
            url: `/coach-salaries/${f.id}`,
            method: 'PUT',
            data: {
              salary_rate: rate,
              effective_from: f.effective_from,
              effective_to: f.noEnd ? null : f.effective_to
            }
          });
          wx.hideLoading();
          wx.showToast({ title: '已保存', icon: 'success' });
          this.setData({ showEditPeriodModal: false });
          this.loadConfigList();
          this.loadRateGaps();
          this.loadSalaryMonthly();
          this.loadBillList();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '保存失败', icon: 'none', duration: 2500 });
        }
      }
    });
  },

  // ---- 删除某一期单价 ----

  onDeleteVersion(e) {
    const cfg = e.currentTarget.dataset.cfg;
    const coachName = e.currentTarget.dataset.coachname || '';
    if (!cfg || !cfg._id) return;
    wx.showModal({
      title: '删除这一期单价',
      content: `确定删除「${coachName}」${cfg.duration}分钟（${cfg._range}）的 ¥${cfg.salary_rate}/节 吗？删除后前一期单价自动衔接。若该时期已有入账课程，将无法删除。`,
      confirmColor: '#C44B4B',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        try {
          await request({
            url: `/coach-salaries/${cfg._id}`,
            method: 'DELETE'
          });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadConfigList();
          this.loadRateGaps();
          this.loadSalaryMonthly();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none', duration: 2500 });
        }
      }
    });
  },

  // ---- 删除整教练配置（停用当前适用的各期） ----

  onDeleteConfig(e) {
    const coachGroup = e.currentTarget.dataset.item;
    // 只停用当前适用的各期（历史期是统计依据，保留）
    const ids = (coachGroup.configs || []).filter(c => c.is_active).map(c => c._id).filter(Boolean);
    if (ids.length === 0) {
      wx.showToast({ title: '无可删除的配置', icon: 'none' });
      return;
    }
    const coachName = coachGroup.coach_name || '该教练';
    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${coachName}」当前适用的配置吗？共${ids.length}期。删除从明天起失效，历史课程的薪酬统计不受影响。`,
      confirmColor: '#C44B4B',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          request({
            url: '/coach-salaries/batch-delete',
            method: 'POST',
            data: { ids }
          }).then(() => {
            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadConfigList();
            this.loadRateGaps();
          }).catch((err) => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  stopPropagation() {
  },

  // ==================== 账单 ====================

  onStatStartDateChange(e) {
    const startDate = e.detail.value;
    // 选择开始日期后，结束日期自动预选为当月最末一天
    const [year, month] = startDate.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    this.setData({
      statForm: { startDate, endDate }
    });
  },

  onStatEndDateChange(e) {
    this.setData({
      'statForm.endDate': e.detail.value
    });
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
      const shopStoreId = app.globalData.shopStoreId || '';
      const res = await request({
        url: '/coach-salaries/stats/generate',
        method: 'POST',
        data: {
          start_date: startDate,
          end_date: endDate,
          preview: true,
          ...(shopStoreId ? { store_id: shopStoreId } : {})
        }
      });

      wx.hideLoading();

      if (res.data) {
        const { bill, unresolved_groups, skipped_count, total_amount } = res.data;

        const preview = (bill || []).map(c => ({ ...c, _selected: true }));
        const selectedTotal = preview.reduce((sum, c) => sum + (c.total_amount || 0), 0);
        const unresolvedCoachs = this.buildUnresolvedCoachList(unresolved_groups);

        this.setData({
          billPreview: preview,
          billGenerated: false,
          billUnresolvedCoachs: unresolvedCoachs,
          billUnresolvedClassTotal: unresolvedCoachs.reduce((sum, c) => sum + c.classCount, 0),
          billUnresolvedExpanded: false,
          billSkippedCount: skipped_count || 0,
          totalBillAmount: total_amount,
          billSelectedCount: preview.length,
          billSelectedAmount: Math.round(selectedTotal * 100) / 100
        });
        if (preview.length === 0) {
          const warnCount = unresolvedCoachs.reduce((sum, c) => sum + c.classCount, 0);
          wx.showToast({
            title: warnCount > 0 ? '无可入账课程，存在未匹配薪酬配置的课' : '所选时段课程均已入账',
            icon: 'none',
            duration: 2500
          });
        }
      }
    } catch (err) {
      wx.hideLoading();
      console.error('生成账单失败', err);
      wx.showToast({ title: err.message || '生成账单失败', icon: 'none' });
    }
  },

  // 未入账分组按教练折叠
  buildUnresolvedCoachList(groups) {
    const map = new Map();
    (groups || []).forEach(g => {
      const cid = g.coach_id || '_none';
      if (!map.has(cid)) {
        map.set(cid, {
          coach_id: cid,
          coach_name: g.coach_name || '未知教练',
          periodCount: 0,
          classCount: 0,
          items: [],
          _expanded: false
        });
      }
      const c = map.get(cid);
      c.periodCount += 1;
      c.classCount += g.count;
      c.items.push({ ...g, _key: `${g.duration}_${g.store_id || ''}_${g.from}_${g.matched || ''}` });
    });
    return Array.from(map.values());
  },

  onToggleBillUnresolved() {
    this.setData({ billUnresolvedExpanded: !this.data.billUnresolvedExpanded });
  },

  onToggleBillUnresolvedCoach(e) {
    const { index } = e.currentTarget.dataset;
    const billUnresolvedCoachs = this.data.billUnresolvedCoachs;
    billUnresolvedCoachs[index]._expanded = !billUnresolvedCoachs[index]._expanded;
    this.setData({ billUnresolvedCoachs });
  },

  onConfirmGenerateBill() {
    const { statForm: { startDate, endDate }, billUnresolvedClassTotal, billSkippedCount } = this.data;

    const parts = [];
    if (billUnresolvedClassTotal > 0) {
      parts.push(`有 ${billUnresolvedClassTotal} 节课未匹配到薪酬配置（按 ¥0 计、暂不入账），补配置后重新生成即可补上`);
    }
    if (billSkippedCount > 0) {
      parts.push(`${billSkippedCount} 节课已入账将自动跳过`);
    }
    if (parts.length > 0) {
      wx.showModal({
        title: '提示',
        content: parts.join('；') + '。确定要继续生成账单吗？',
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
      const shopStoreId = app.globalData.shopStoreId || '';
      const res = await request({
        url: '/coach-salaries/stats/generate',
        method: 'POST',
        data: {
          start_date: startDate,
          end_date: endDate,
          preview: false,
          coach_ids: selectedCoachIds,
          ...(shopStoreId ? { store_id: shopStoreId } : {})
        }
      });

      wx.hideLoading();

      if (res.data) {
        wx.showToast({ title: '账单生成成功', icon: 'success' });
        this.setData({
          billPreview: null,
          billGenerated: false,
          billUnresolvedCoachs: [],
          billUnresolvedClassTotal: 0,
          billUnresolvedExpanded: false,
          billSkippedCount: 0,
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

  onCloseBillContent() {
    this.setData({ billPreview: null, billGenerated: false, billUnresolvedCoachs: [], billUnresolvedClassTotal: 0, billUnresolvedExpanded: false, billSkippedCount: 0, billSelectedCount: 0, billSelectedAmount: 0 });
  },

  async loadBillList() {
    try {
      const shopStoreId = app.globalData.shopStoreId || '';
      const params = {};
      if (shopStoreId) params.store_id = shopStoreId;
      const res = await request({
        url: '/coach-salaries/stats/bills',
        method: 'GET',
        data: params
      });
      if (res.data) {
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

  onToggleBillCard(e) {
    const { index } = e.currentTarget.dataset;
    const billList = this.data.billList;
    billList[index]._expanded = !billList[index]._expanded;
    this.setData({ billList });
  },

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
          const storeLabel = it.store_name ? `（${it.store_name}）` : '';
          html += `<td style="text-align:center;">${it.duration}分钟${storeLabel} × ${it.count}节</td>`;
          html += `<td style="text-align:center;">¥${it.rate}/节</td>`;
          html += `<td style="text-align:right;">¥${it.amount}</td>`;
          html += '</tr>';
        });
      }
      // 教练小计
      html += `<tr style="background-color:#fff8f5;"><td colspan="3" style="text-align:right;">${c.coach_name} 小计</td><td style="text-align:right;font-weight:bold;">¥${c.total_amount}</td></tr>`;
    });

    // 警告行（未入账课程）
    if ((bill.warnings || []).length > 0) {
      bill.warnings.forEach(w => {
        html += `<tr><td colspan="4" style="color:#C44B4B;">⚠ ${w}</td></tr>`;
      });
    }

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
      content: `确定删除「${bill._title}」吗？删除后该账单内的课程会恢复为未入账状态，可重新生成；此操作不可恢复。`,
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
            this.loadSalaryMonthly();
          } catch (err) {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  }
});
