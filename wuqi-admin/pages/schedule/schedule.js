const app = getApp();
const { request } = require('../../utils/request');
const { COURSE_DURATIONS, DEFAULT_DURATION } = require('../../utils/config');
const { getBeijingDate, getWeekday } = require('../../utils/helpers');
const { getScheduleStatusText, getCancelReasonText } = require('../../utils/util');

// 最大图片上传大小（与后端 multer limits.fileSize 一致）
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// 从上传错误中提取有意义的提示信息
function getUploadErrorMessage(err) {
  if (!err) return '上传失败，请重试';
  const msg = err.message || err.errMsg || String(err);
  if (msg.includes('文件过大')) return msg;
  if (msg.includes('不支持的图片类型')) return msg;
  if (msg.includes('413')) return '图片文件过大，最大支持 10MB';
  if (msg.includes('timeout') || msg.includes('超时')) return '上传超时，请检查网络后重试';
  if (msg.includes('fail') || msg.includes('网络')) return '网络异常，请检查网络后重试';
  try {
    const data = JSON.parse(msg);
    if (data && data.message) return data.message;
  } catch (e) {}
  return '上传失败，请重试';
}

Page({
  data: {
    stores: [],
    currentStoreId: '',
    currentDate: '',
    dateList: [],
    schedules: [],
    coaches: [],
    danceStyles: [],
    // 视图模式: 'day' | 'month'
    viewMode: 'month',
    // 当前显示的月份（用于月视图）
    currentMonth: '',
    // 当前月份名称
    currentMonthName: '',
    // 月份列表（用于月视图导航）
    monthList: [],
    // 月视图日历数据
    monthCalendar: [],
    // 星期标题（从周一开始）
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    // 星期视图数据（作为模板，不与具体日期绑定）
    weekdayList: [
      { name: '周一', weekday: 1 },
      { name: '周二', weekday: 2 },
      { name: '周三', weekday: 3 },
      { name: '周四', weekday: 4 },
      { name: '周五', weekday: 5 },
      { name: '周六', weekday: 6 },
      { name: '周日', weekday: 0 }
    ],
    currentWeekdayIndex: 0,
    // 星期模板数据（存储星期的排课模板）
    weekTemplate: {},
    // 这周的日期范围（仅用于月视图）
    currentWeekStart: '',
    currentWeekEnd: '',
    showAddModal: false,
    showCopyModal: false,
    showManageModal: false,
    showManageDatePicker: false,
    showManageConfirm: false,
    manageConfirmText: '',
    manageConfirmInput: '',
    manageClearDate: '',
    deleting: false, // 防抖标志位
    manageClearAction: '',
    copyStep: 1,
    copySourceCount: 0,
    copyPreviewText: '',
    copyStoreName: '',
    copyForm: {
      source_start_date: '',
      source_end_date: '',
      target_start_date: '',
      copyMode: 'weeks',
      copyCount: 4
    },
    // 取消排课原因选择
    showCancelReasonModal: false,
    cancelScheduleId: '',
    cancelScheduleBookings: 0,
    cancelSelectedReason: '',
    showCustomDuration: false,
    isCustomDuration: false,
    courseDurations: COURSE_DURATIONS,
    formData: {
        _id: '',
        course_name: '',
        danceStyleId: '',
        danceStyleName: '',
        coachId: '',
        coachName: '',
        startTime: '',
        endTime: '',
        duration: DEFAULT_DURATION,
        customDuration: '',
        classroom: '',
        max_bookings: 20,
        min_bookings: 5,
        weekday: 1, // 添加星期字段用于模板
        bookingDeadline: 180,
        customBookingDeadline: '',
        cancelBookingDeadline: 120,
        customCancelBookingDeadline: '',
        creditsCost: 1,
        customCreditsCost: '',
        coverUrl: ''
      }
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.initDateList();
    this.loadStores();
    // 如果默认视图是月视图，生成日历
    // 注意：loadSchedules() 会在 loadStores() 的回调中调用，避免重复请求
    if (this.data.viewMode === 'month') {
      this.generateMonthCalendar(this.data.currentMonth);
    }
    this._startAutoRefresh();
  },

  onHide() {
    this._stopAutoRefresh();
  },

  onUnload() {
    this._isDestroyed = true;
    this._stopAutoRefresh();
  },

  _startAutoRefresh() {
    this._stopAutoRefresh();
    this._autoRefreshTimer = setInterval(() => {
      this.loadStores();
    }, 30000);
  },

  _stopAutoRefresh() {
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
  },

  // 初始化日期列表（历史1年 + 未来3个月）
  initDateList() {
    const dates = [];
    const months = [];
    const today = getBeijingDate(); // 使用北京时间
    const todayStr = this._formatDate(today);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    // 生成日期范围：历史365天 + 未来90天
    const startOffset = -365; // 历史1年
    const endOffset = 90;     // 未来3个月
    
    let currentMonth = '';
    
    for (let i = startOffset; i <= endOffset; i++) {
      const date = getBeijingDate(today); // 复制并偏移
      date.setDate(today.getDate() + i);
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const monthKey = `${year}-${month}`;
      const monthName = `${year}年${month}月`;
      
      // 记录月份变化
      if (monthKey !== currentMonth) {
        currentMonth = monthKey;
        if (!months.find(m => m.key === monthKey)) {
          months.push({
            key: monthKey,
            name: monthName,
            year: year,
            month: parseInt(month)
          });
        }
      }
      
      const isToday = dateStr === todayStr;
      const isPast = date < today && !isToday;
      const isFuture = date > today;
      const weekday = weekdays[date.getDay()];
      
      dates.push({
        date: dateStr,
        day: `${month}-${day}`,
        weekday: isToday ? '今天' : weekday,
        isToday: isToday,
        isPast: isPast,
        isFuture: isFuture,
        isMonthStart: date.getDate() === 1,
        monthKey: monthKey,
        monthName: monthName
      });
    }

    const todayMonthKey = todayStr.substring(0, 7);
    const currentMonthInfo = months.find(m => m.key === todayMonthKey);
    
    this.setData({
      dateList: dates,
      monthList: months,
      currentDate: dates.find(d => d.isToday)?.date || dates[365]?.date || todayStr,
      currentMonth: currentMonthInfo?.key || (months[0]?.key || todayMonthKey),
      currentMonthName: currentMonthInfo?.name || (months[0]?.name || '')
    });
  },

  // 加载星期模板（从后端加载）
  async loadWeekTemplate() {
    try {
      const { currentStoreId } = this.data;

      
      if (!currentStoreId) {
        if (this.data.viewMode === 'day') {
          this.loadCurrentWeekdaySchedules();
        }
        return;
      }
      
      // 从后端加载星期模板
      const res = await request({
        url: '/week-template?store_id=' + currentStoreId,
        method: 'GET'
      });
      
      if (this._isDestroyed) return;
      

      let template = res.data;
      
      // 如果没有数据，初始化空模板结构
      if (!template || Object.keys(template).length === 0) {
  
        template = {
          0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []
        };
      }
      

      this.setData({ weekTemplate: template }, () => {
        // 只在日视图下加载星期的排课，月视图使用 API 数据
        if (this.data.viewMode === 'day') {
          this.loadCurrentWeekdaySchedules();
        }
      });
    } catch (err) {
      console.error('加载星期模板失败', err);
      wx.showToast({ title: '加载模板失败', icon: 'none' });
      // 即使加载失败，也初始化一个空模板
      this.setData({ 
        weekTemplate: {
          0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []
        }
      }, () => {
        if (this.data.viewMode === 'day') {
          this.loadCurrentWeekdaySchedules();
        }
      });
    }
  },

  // 保存星期模板（保存到后端）
  async saveWeekTemplate() {
    try {
      const { currentStoreId, weekTemplate } = this.data;

      
      if (!currentStoreId) {
  
        return;
      }
      
      const res = await request({
        url: '/week-template',
        method: 'POST',
        data: {
          store_id: currentStoreId,
          template: weekTemplate
        }
      });
      

      return true;
    } catch (err) {
      console.error('保存星期模板失败', err);
      return false;
    }
  },

  // 加载当前选择的星期的排课（来自模板）
  async loadCurrentWeekdaySchedules() {
    const { weekTemplate, currentWeekdayIndex, weekdayList, currentStoreId } = this.data;
    const currentWeekday = weekdayList[currentWeekdayIndex]?.weekday;
    

    
    // 确保模板有对应星期的数据
    let templateSchedules = [];
    if (weekTemplate && weekTemplate[currentWeekday] !== undefined) {
      templateSchedules = weekTemplate[currentWeekday];
    }
    

    
    // 确保 templateSchedules 是数组
    if (!Array.isArray(templateSchedules)) {
      templateSchedules = [];
    }
    
    // 获取未来30天内的正式排课，用于判断模板是否已排课
    let futureSchedules = [];
    if (currentStoreId) {
      try {
        const today = getBeijingDate(); // 使用北京时间
        const futureDate = getBeijingDate(today);
        futureDate.setDate(today.getDate() + 30);
        const todayStr = this._formatDate(today);
        const futureStr = this._formatDate(futureDate);
        
        const res = await request({
          url: '/schedules',
          method: 'GET',
          data: { 
            store_id: currentStoreId,
            start_date: todayStr,
            end_date: futureStr
          }
        });
        if (this._isDestroyed) return;
        futureSchedules = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        console.error('加载未来排课失败:', err);
      }
    }
    
    const processedSchedules = templateSchedules.map(item => {
      const isEnabled = item.enabled !== false;
      const hasScheduled = futureSchedules.some(s => {
        const sDanceId = s.dance_style_id && s.dance_style_id._id ? s.dance_style_id._id : s.dance_style_id;
        const sCoachId = s.coach_id && s.coach_id._id ? s.coach_id._id : s.coach_id;
        const tDanceId = item.dance_style_id;
        const tCoachId = item.coach_id;
        return String(sDanceId) === String(tDanceId) &&
               String(sCoachId) === String(tCoachId) &&
               s.start_time === item.start_time &&
               s.end_time === item.end_time &&
               s.status !== 'cancelled' &&
               s.status !== 'offline';
      });
      
      let statusText = hasScheduled ? '已排课' : '未排课';
      
      return {
        ...item,
        enabled: isEnabled,
        statusText,
        hasScheduled,
        isHistory: false,
        danceStyleName: item.dance_style_name || '未知舞种',
        coachName: item.coach_name || '未知教练'
      };
    });
    

    
    this.setData({
      schedules: processedSchedules
    });
  },

  // 格式化日期为 YYYY-MM-DD
  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 切换视图模式
  onSwitchViewMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ viewMode: mode });
    
    if (mode === 'month') {
      // 切换到月视图时，生成当月日历
      this.generateMonthCalendar(this.data.currentMonth);
    }
    
    this.loadSchedules();
  },

  // 生成月视图日历 - 重写版本
  generateMonthCalendar(monthKey) {
    if (!monthKey) return;
    
    const [year, month] = monthKey.split('-').map(Number);
    
    // 获取当月第一天和最后一天
    const firstDay = getBeijingDate(new Date(year, month - 1, 1));
    const lastDay = getBeijingDate(new Date(year, month, 0));
    
    // 获取第一天是星期几 (0=周日, 1=周一, ..., 6=周六)
    // 调整为从周一开始：周日→6，周一→0，周二→1...周六→5
    let startWeekday = firstDay.getDay();
    if (startWeekday === 0) {
      startWeekday = 6;
    } else {
      startWeekday = startWeekday - 1;
    }
    
    // 创建日历数据
    const today = getBeijingDate();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // 生成完整的日历数据（按周组织）
    const weeks = [];
    let currentWeek = [];
    
    // 填充第一周的空白
    for (let i = 0; i < startWeekday; i++) {
      currentWeek.push({ type: 'empty' });
    }
    
    // 填充日期
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === this.data.currentDate;
      
      currentWeek.push({
        type: 'date',
        date: dateStr,
        day: day,
        isToday: isToday,
        isSelected: isSelected
      });
      
      // 如果一周已满，添加到weeks并开始新周
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    
    // 添加最后一周（如果有剩余）
    if (currentWeek.length > 0) {
      // 填充最后一周的空白
      while (currentWeek.length < 7) {
        currentWeek.push({ type: 'empty' });
      }
      weeks.push(currentWeek);
    }
    
    // 计算当前月份名称
    let monthName = '';
    if (this.data.monthList && this.data.monthList.length > 0) {
      const currentMonthInfo = this.data.monthList.find(m => m.key === monthKey);
      monthName = currentMonthInfo?.name || '';
    }
    
    this.setData({
      monthCalendar: weeks,
      currentMonth: monthKey,
      currentMonthName: monthName
    });
  },

  // 切换月份
  onChangeMonth(e) {
    const direction = e.currentTarget.dataset.direction;
    const { monthList, currentMonth } = this.data;
    
    const currentIndex = monthList.findIndex(m => m.key === currentMonth);
    let newIndex = currentIndex;
    
    if (direction === 'prev' && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else if (direction === 'next' && currentIndex < monthList.length - 1) {
      newIndex = currentIndex + 1;
    }
    
    if (newIndex !== currentIndex) {
      const newMonth = monthList[newIndex].key;
      this.generateMonthCalendar(newMonth);
    }
  },

  // 选择月视图日期
  onSelectMonthDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    
    this.setData({
      currentDate: date
      // 不再自动切换到日视图，保持在月视图
    }, () => {
      // 重新生成日历以更新选中状态
      this.generateMonthCalendar(this.data.currentMonth);
      this.loadSchedules();
    });
  },

  // 快速回到今日
  onGoToToday() {
    if (this.data.viewMode === 'month') {
      // 月视图：回到今天
      const today = this.data.dateList.find(d => d.isToday);
      if (today) {
        this.setData({
          currentDate: today.date,
          currentMonth: today.monthKey
        }, () => {
          // 如果在月视图，重新生成日历以更新选中状态
          if (this.data.viewMode === 'month') {
            this.generateMonthCalendar(today.monthKey);
          }
          this.loadSchedules();
        });
      }
    } else {
      // 星期视图：重新初始化本周
      this.initWeekdayList();
      this.loadSchedules();
    }
  },

  // 选择星期
  onSelectWeekday(e) {
    const index = e.currentTarget.dataset.index;
    if (index >= 0 && index < 7) {
      this.setData({
        currentWeekdayIndex: index
      }, () => {
        this.loadCurrentWeekdaySchedules();
      });
    }
  },

  // 滚动到指定日期
  scrollToDate(dateStr) {
    const query = wx.createSelectorQuery().in(this);
    query.select(`#date-${dateStr}`).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      if (res[0]) {
        const scrollLeft = res[0].left + res[1].scrollLeft - 150;
        wx.pageScrollTo({
          scrollLeft: scrollLeft,
          duration: 300
        });
      }
    });
  },

  async loadStores() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      if (this._isDestroyed) return;
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      

      
      // 保存原始门店ID，用于判断是否需要切换
      const originalStoreId = this.data.currentStoreId;
      
      // 如果已经有选中的门店，且该门店仍在列表中，则保持当前选择
      let newStoreId = originalStoreId;
      if (!newStoreId || !list.find(s => s._id === newStoreId)) {
        // 如果没有选中门店，或选中的门店已不在列表中，则默认选中第一个
        newStoreId = list.length > 0 ? list[0]._id : '';
      }
      
      this.setData({
        stores: list,
        currentStoreId: newStoreId
      }, async () => {
        // 设置完门店ID后，先加载星期模板，再加载排课
        // 只有当门店ID变化时才重新加载模板
        if (originalStoreId !== this.data.currentStoreId) {
          await this.loadWeekTemplate();
        }
        this.loadSchedules();
      });
    } catch (err) {
      console.error('加载门店失败', err);
      this.loadSchedules();
    }
  },

  async loadSchedules() {
    const { viewMode, currentStoreId, currentDate, dateList, weekTemplate } = this.data;
    if (!currentStoreId) return;

    // 星期视图使用本地模板数据
    if (viewMode === 'day') {
      this.loadCurrentWeekdaySchedules();
      return;
    }

    // 月视图使用API数据，没有实际数据时显示模板预览
    try {
      const res = await request({
        url: '/schedules',
        method: 'GET',
        data: { store_id: currentStoreId, date: currentDate, status: 'all' }
      });
      
      if (this._isDestroyed) return;

      let list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      
      // 判断当前日期是否为历史日期
      let isPastDate = false;
      if (dateList && dateList.length > 0) {
        const currentDateInfo = dateList.find(d => d.date === currentDate);
        isPastDate = currentDateInfo?.isPast || false;
      } else {
        // 如果 dateList 不可用，通过比较日期来判断
        const today = getBeijingDate();
        today.setHours(0, 0, 0, 0);
        const current = getBeijingDate(new Date(currentDate));
        current.setHours(0, 0, 0, 0);
        isPastDate = current < today;
      }
      
      // 如果没有实际排课数据，并且不是历史日期，则显示模板预览
      if (list.length === 0 && !isPastDate) {
        const currentDateObj = new Date(currentDate);
        const dayOfWeek = currentDateObj.getDay(); // 0=周日, 1=周一, ...
        const templateSchedules = weekTemplate[dayOfWeek] || [];
        
        if (templateSchedules.length > 0) {
          const templatePreviewList = templateSchedules.map(item => ({
            ...item,
            _id: 'template_' + item.template_id,
            statusText: item.enabled === false ? '已禁用' : '模板预览',
            isHistory: false,
            isTemplatePreview: true,
            enabled: item.enabled !== false,
            from_template: true,
            danceStyleName: item.dance_style_name || '未知舞种',
            coachName: item.coach_name || '未知教练'
          }));
          
          this.setData({ 
            schedules: templatePreviewList,
            isCurrentDatePast: isPastDate
          });
          return;
        }
      }
      
      // 判断课程是否是历史课程（仅用于 UI 展示，不推导状态）
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const current = new Date(currentDate);
      current.setHours(0, 0, 0, 0);
      const isCurrentPast = current < today;

      // 直接信任后端返回的 status 字段，前端不再根据时间推导状态
      const processedList = list.map(item => {
        const status = item.status || 'available';
        return {
          ...item,
          status,
          statusText: getScheduleStatusText(status),
          cancelReasonText: item.cancel_reason ? getCancelReasonText(item.cancel_reason) : '',
          isHistory: isCurrentPast,
          from_template: item.from_template === true,
          danceStyleName: item.dance_style_id?.name || '未知舞种',
          coachName: item.coach_id?.name || '未知教练'
        };
      });
      
      this.setData({ 
        schedules: processedList,
        isCurrentDatePast: isPastDate
      });
    } catch (err) {
      console.error('加载排课失败', err);
      
      if (this._isDestroyed) return;

      // API 失败时也尝试显示模板预览
      const today = getBeijingDate();
      today.setHours(0, 0, 0, 0);
      const current = getBeijingDate(new Date(currentDate));
      current.setHours(0, 0, 0, 0);
      const isCurrentPast = current < today;
      
      if (!isCurrentPast) {
        const dayOfWeek = current.getDay();
        const templateSchedules = weekTemplate[dayOfWeek] || [];
        
        if (templateSchedules.length > 0) {
          const templatePreviewList = templateSchedules.map(item => ({
            ...item,
            _id: 'template_' + item.template_id,
            statusText: item.enabled === false ? '已禁用' : '模板预览',
            isHistory: false,
            isTemplatePreview: true,
            enabled: item.enabled !== false,
            from_template: true,
            danceStyleName: item.dance_style_name || '未知舞种',
            coachName: item.coach_name || '未知教练'
          }));
          
          this.setData({ 
            schedules: templatePreviewList,
            isCurrentDatePast: false
          });
        }
      }
    }
  },

  async loadCoaches() {
    try {
      const res = await request({ 
        url: '/coaches', 
        method: 'GET'
      });
      if (this._isDestroyed) return;
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({ coaches: list });
    } catch (err) {
      console.error('加载教练失败', err);
    }
  },

  async loadDanceStyles() {
    try {
      const res = await request({ 
        url: '/dance-styles', 
        method: 'GET'
      });
      if (this._isDestroyed) return;
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({ danceStyles: list });
    } catch (err) {
      console.error('加载舞种失败', err);
    }
  },

  onSwitchStore(e) {
    const newStoreId = e.currentTarget.dataset.id;
    // 切换门店时先清空 weekTemplate，避免 loadSchedules 使用旧门店模板显示预览
    this.setData({
      currentStoreId: newStoreId,
      weekTemplate: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
      schedules: []
    }, () => {
      // 必须先加载新门店的模板，再加载排课数据，避免模板预览串门店
      this.loadWeekTemplate().then(() => {
        this.loadSchedules();
      });
    });
  },

  onSelectDate(e) {
    this.setData({ currentDate: e.currentTarget.dataset.date }, () => {
      this.loadSchedules();
    });
  },

  // 新增排课
  async onAddSchedule() {
    const { currentWeekdayIndex, weekdayList } = this.data;
    const currentWeekday = weekdayList[currentWeekdayIndex]?.weekday;
    
    await this.loadCoaches();
    await this.loadDanceStyles();
    this.setData({
      showAddModal: true,
      showCustomDuration: false,
      isCustomDuration: false,
      formData: {
        _id: '',
        course_name: '',
        danceStyleId: '',
        danceStyleName: '',
        coachId: '',
        coachName: '',
        startTime: '',
        endTime: '',
        duration: DEFAULT_DURATION,
        customDuration: '',
        classroom: '',
        max_bookings: 20,
        min_bookings: 5,
        weekday: currentWeekday,
        bookingDeadline: 180,
        customBookingDeadline: '',
        cancelBookingDeadline: 120,
        customCancelBookingDeadline: '',
        creditsCost: 1,
        customCreditsCost: '',
        coverUrl: ''
      }
    });
  },

  // 编辑排课
  async onEditSchedule(e) {
    const index = e.currentTarget.dataset.index;
    const schedule = this.data.schedules[index];
    const { currentWeekdayIndex, weekdayList } = this.data;
    const currentWeekday = weekdayList[currentWeekdayIndex]?.weekday;
    
    await this.loadCoaches();
    await this.loadDanceStyles();
    
    const danceStyleId = schedule.dance_style_id && schedule.dance_style_id._id ? schedule.dance_style_id._id : schedule.dance_style_id;
    const danceStyleName = schedule.dance_style_id && schedule.dance_style_id.name ? schedule.dance_style_id.name : schedule.dance_style_name;
    const coachId = schedule.coach_id && schedule.coach_id._id ? schedule.coach_id._id : schedule.coach_id;
    const coachName = schedule.coach_id && schedule.coach_id.name ? schedule.coach_id.name : schedule.coach_name;
    
    this.setData({
      showAddModal: true,
      showCustomDuration: false,
      isCustomDuration: !COURSE_DURATIONS.some(d => d.value === (schedule.duration || DEFAULT_DURATION)),
      formData: {
        _id: schedule._id || schedule.template_id,
        course_name: schedule.course_name || '',
        danceStyleId: danceStyleId || '',
        danceStyleName: danceStyleName || '',
        coachId: coachId || '',
        coachName: coachName || '',
        startTime: schedule.start_time,
        endTime: schedule.end_time,
        duration: schedule.duration || DEFAULT_DURATION,
        customDuration: '',
        classroom: schedule.classroom || '',
        max_bookings: schedule.max_bookings || 20,
        min_bookings: schedule.min_bookings || 5,
        weekday: currentWeekday,
        template_index: index,
        bookingDeadline: schedule.booking_deadline || 180,
        customBookingDeadline: '',
        cancelBookingDeadline: schedule.cancel_deadline || 120,
        customCancelBookingDeadline: '',
        creditsCost: schedule.credits_cost || 1,
        customCreditsCost: '',
        coverUrl: schedule.cover ? this._fixImageUrl(schedule.cover) : ''
      }
    });
  },

  onCloseModal() {
    this.setData({ showAddModal: false });
  },

  onModalTap() {},

  preventTouchMove() {},

  // 补全图片 URL
  _fixImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('https://')) return url;
    const config = require('../../config/index.js');
    const serverBase = config.serverBase || '';
    if (url.startsWith('http://')) {
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      if (match) return serverBase + match[1];
      return url;
    }
    if (url.startsWith('//')) return serverBase.replace(/^https?:/, '') + url;
    if (url.startsWith('/')) return serverBase + url;
    return serverBase + '/' + url;
  },

  // 从完整URL中提取相对路径，用于保存到后端
  _extractRelativePath(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const match = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      return match ? match[1] : url;
    }
    return url;
  },

  // 选择课程封面
  onChooseCover() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const file = res.tempFiles[0];
        // 上传前检查文件大小
        if (file.size > MAX_IMAGE_SIZE) {
          wx.showToast({ title: '图片过大，最大支持 10MB', icon: 'none' });
          return;
        }

        let filePath = file.tempFilePath;

        // 使用微信内置裁剪（固定16:9比例，用户可缩放/拖动）
        try {
          if (wx.cropImage) {
            const cropRes = await new Promise((resolve, reject) => {
              wx.cropImage({
                src: filePath,
                cropScale: '16:9',
                success: resolve,
                fail: reject
              });
            });
            filePath = cropRes.tempFilePath;
          }
        } catch (cropErr) {
          // 裁剪失败或用户取消裁剪，使用原图
          if (cropErr.errMsg && cropErr.errMsg.indexOf('cancel') !== -1) {
            return;
          }
        }

        wx.showLoading({ title: '上传中...' });
        try {
          const token = wx.getStorageSync('admin_token') || '';
          const uploadUrl = app.globalData.baseUrl + '/upload/image?type=course';
          const uploadRes = await new Promise((resolve, reject) => {
            wx.uploadFile({
              url: uploadUrl,
              filePath: filePath,
              name: 'image',
              header: { 'Authorization': 'Bearer ' + token },
              success: resolve,
              fail: reject
            });
          });
          const data = JSON.parse(uploadRes.data);
          if (data.code === 200) {
            const relativePath = data.data.path;
            const fullUrl = that._fixImageUrl(relativePath);
            that.setData({ 'formData.coverUrl': fullUrl });
            wx.hideLoading();
            wx.showToast({ title: '封面上传成功', icon: 'success' });
          } else {
            wx.hideLoading();
            wx.showToast({ title: data.message || '上传失败', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: getUploadErrorMessage(err), icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('选择图片失败', err);
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败，请检查隐私权限', icon: 'none' });
        }
      }
    });
  },

  // 删除课程封面
  onRemoveCover() {
    const that = this;
    wx.showModal({
      title: '删除封面',
      content: '确定要删除当前课程封面吗？',
      confirmText: '删除',
      confirmColor: '#DC5046',
      success: (res) => {
        if (res.confirm) {
          that.setData({ 'formData.coverUrl': '' });
        }
      }
    });
  },

  onSelectDanceStyle(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      'formData.danceStyleId': id,
      'formData.danceStyleName': name
    });
  },

  // 选择教练
  onSelectCoach(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      'formData.coachId': id,
      'formData.coachName': name
    });
  },

  // 开课时间输入变化时自动计算结束时间
  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`formData.${field}`]: e.detail.value });
    
    // 如果是修改开课时间，自动计算结束时间
    if (field === 'startTime') {
      this.calculateEndTime(e.detail.value, this.data.formData.duration);
    }
  },

  // 时间输入框失焦时自动补零（如 4:25 → 04:25）
  onTimeBlur(e) {
    const value = (e.detail.value || '').trim();
    if (!value) return;
    // 匹配非标准小时格式：一位小时数:两位分钟数
    const match = value.match(/^(\d):(\d{2})$/);
    if (match) {
      const formatted = '0' + match[1] + ':' + match[2];
      this.setData({ 'formData.startTime': formatted });
      this.calculateEndTime(formatted, this.data.formData.duration);
    }
  },

  // 选择时长
  onSelectDuration(e) {
    const duration = parseInt(e.currentTarget.dataset.value);
    this.setData({
      'formData.duration': duration,
      showCustomDuration: false,
      isCustomDuration: false
    });
    if (this.data.formData.startTime) {
      this.calculateEndTime(this.data.formData.startTime, duration);
    }
  },

  // 显示自定义时长输入
  onShowCustomDuration() {
    this.setData({ showCustomDuration: true });
  },

  // 自定义时长失去焦点
  onCustomDurationBlur(e) {
    const value = parseInt(e.detail.value);
    if (value && value > 0) {
      const isCustom = !COURSE_DURATIONS.some(d => d.value === value);
      this.setData({
        'formData.duration': value,
        'formData.customDuration': value,
        isCustomDuration: isCustom
      });
      if (this.data.formData.startTime) {
        this.calculateEndTime(this.data.formData.startTime, value);
      }
    }
  },

  // 选择预约截止时间
  onSelectBookingDeadline(e) {
    const value = parseInt(e.currentTarget.dataset.value);
    this.setData({
      'formData.bookingDeadline': value
    });
  },

  // 选择取消预约截止时间
  onSelectCancelBookingDeadline(e) {
    const value = parseInt(e.currentTarget.dataset.value);
    this.setData({
      'formData.cancelBookingDeadline': value
    });
  },

  onSelectCreditsCost(e) {
    const value = parseInt(e.currentTarget.dataset.value);
    this.setData({
      'formData.creditsCost': value
    });
  },

  async onToggleTemplateItem(e) {
    const index = e.currentTarget.dataset.index;
    const { weekTemplate, weekdayList, currentWeekdayIndex } = this.data;
    const currentWeekday = weekdayList[currentWeekdayIndex]?.weekday;

    const newWeekTemplate = { ...weekTemplate };
    const items = [...(newWeekTemplate[currentWeekday] || [])];
    const item = items[index];

    if (!item) return;

    const newEnabled = item.enabled === false ? true : false;
    items[index] = { ...item, enabled: newEnabled };
    newWeekTemplate[currentWeekday] = items;

    this.setData({ weekTemplate: newWeekTemplate });

    await this.saveWeekTemplate();
    this.loadCurrentWeekdaySchedules();

    wx.showToast({ title: newEnabled ? '已启用' : '已禁用', icon: 'success' });
  },

  // 计算下课时间
  calculateEndTime(startTime, duration) {
    if (!startTime || !duration) return;
    
    const [hours, minutes] = startTime.split(':').map(Number);
    const startDate = getBeijingDate();
    startDate.setHours(hours, minutes, 0);
    
    const endDate = getBeijingDate(new Date(startDate.getTime() + duration * 60000));
    const endHours = String(endDate.getHours()).padStart(2, '0');
    const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
    
    this.setData({ 'formData.endTime': `${endHours}:${endMinutes}` });
  },

  // 最大人数变化
  onMaxBookingsChange(e) {
    this.setData({ 'formData.max_bookings': e.detail.value });
  },

  // 最低人数变化
  onMinBookingsChange(e) {
    this.setData({ 'formData.min_bookings': e.detail.value });
  },

  // 提交排课
  async onSubmitSchedule() {
    if (!app.hasPermission('schedule:edit')) {
      wx.showToast({ title: '无权限执行此操作', icon: 'none' });
      return;
    }
    const { formData, currentStoreId, viewMode, weekTemplate, weekdayList, currentWeekdayIndex, schedules } = this.data;
    
    if (!formData.danceStyleId) {
      wx.showToast({ title: '请选择舞种', icon: 'none' });
      return;
    }
    if (!formData.coachId) {
      wx.showToast({ title: '请选择教练', icon: 'none' });
      return;
    }
    if (!formData.startTime) {
      wx.showToast({ title: '请输入开课时间', icon: 'none' });
      return;
    }

    // 时间冲突检测（月视图模式，排除自身）
    if (viewMode !== 'day' && schedules && schedules.length > 0) {
      const newStart = formData.startTime;
      const newEnd = formData.endTime;
      const editingId = formData._id || (this.data.editPreview ? this.data.editPreview._id : '');
      const conflictingSchedule = schedules.find(s => {
        if (s._id === editingId) return false;  // 排除正在编辑的自身
        // 排除所有非活跃状态的排课（已取消、已下架、已删除、已完成、未开放）
        if (['cancelled', 'offline', 'deleted', 'completed', 'not_open'].includes(s.status)) return false;
        const existingStart = s.start_time;
        const existingEnd = s.end_time;
        if (newStart < existingEnd && newEnd > existingStart) {
          const existingCoachId = s.coach_id?._id || s.coach_id;
          if (existingCoachId === formData.coachId) {
            return true;
          }
          if (s.classroom && s.classroom === formData.classroom) {
            return true;
          }
        }
        return false;
      });

      if (conflictingSchedule) {
        const conflictCoach = conflictingSchedule.coach_id?.name || '未知教练';
        const conflictTime = `${conflictingSchedule.start_time}-${conflictingSchedule.end_time}`;
        wx.showModal({
          title: '时间冲突',
          content: `与已有排课冲突：\n教练：${conflictCoach}\n时间：${conflictTime}`,
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
    }

    // 处理预约截止时间和取消预约截止时间
    let bookingDeadline = formData.bookingDeadline;
    let cancelBookingDeadline = formData.cancelBookingDeadline;
    
    if (bookingDeadline === -1) {
      bookingDeadline = parseInt(formData.customBookingDeadline) || 180;
    }
    if (cancelBookingDeadline === -1) {
      cancelBookingDeadline = parseInt(formData.customCancelBookingDeadline) || 120;
    }

    let creditsCost = formData.creditsCost;
    if (creditsCost === -1) {
      creditsCost = parseInt(formData.customCreditsCost) || 1;
    }
    if (creditsCost < 1) {
      creditsCost = 1;
    }

    if (!formData.endTime) {
      wx.showToast({ title: '下课时间计算失败', icon: 'none' });
      return;
    }

    const maxBookings = parseInt(formData.max_bookings) || 20;
    const minBookings = parseInt(formData.min_bookings) || 0;
    if (maxBookings < 3 || maxBookings > 30) {
      wx.showToast({ title: '最大预约人数需在3-30之间', icon: 'none' });
      return;
    }
    if (minBookings > 0 && (minBookings < 1 || minBookings > 15)) {
      wx.showToast({ title: '最低预约人数需在1-15之间', icon: 'none' });
      return;
    }
    if (minBookings > maxBookings) {
      wx.showToast({ title: '最低人数不能大于最大人数', icon: 'none' });
      return;
    }

    // 星期视图模式，保存到本地模板
    if (viewMode === 'day') {
      const currentWeekday = weekdayList[currentWeekdayIndex]?.weekday;
      const templateItem = {
        template_id: formData._id || Date.now().toString(),
        course_name: formData.course_name,
        dance_style_id: formData.danceStyleId,
        dance_style_name: formData.danceStyleName,
        coach_id: formData.coachId,
        coach_name: formData.coachName,
        start_time: formData.startTime,
        end_time: formData.endTime,
        duration: formData.duration,
        classroom: formData.classroom,
        max_bookings: formData.max_bookings,
        min_bookings: formData.min_bookings,
        booking_deadline: bookingDeadline,
        cancel_deadline: cancelBookingDeadline,
        credits_cost: creditsCost,
        cover: this._extractRelativePath(formData.coverUrl),
        coverUrl: formData.coverUrl,
        enabled: true
      };

      // 更新weekTemplate
      const newWeekTemplate = { ...weekTemplate };
      if (!newWeekTemplate[currentWeekday]) {
        newWeekTemplate[currentWeekday] = [];
      }

      if (formData.template_index !== undefined && formData.template_index >= 0) {
        const existingItem = newWeekTemplate[currentWeekday][formData.template_index];
        if (existingItem && existingItem.enabled === false) {
          templateItem.enabled = false;
        }
        newWeekTemplate[currentWeekday][formData.template_index] = templateItem;
      } else {
        // 新增模式
        newWeekTemplate[currentWeekday].push(templateItem);
      }

      this.setData({ weekTemplate: newWeekTemplate, showAddModal: false });
      await this.saveWeekTemplate();
      this.loadCurrentWeekdaySchedules();
      wx.showToast({ title: formData._id ? '修改成功' : '添加成功', icon: 'success' });
      return;
    }

    // 月视图模式，使用API
    const submitData = {
      store_id: currentStoreId,
      date: this.data.currentDate,
      dance_style_id: formData.danceStyleId,
      coach_id: formData.coachId,
      start_time: formData.startTime,
      end_time: formData.endTime,
      duration: formData.duration,
      course_name: formData.course_name,
      classroom: formData.classroom,
      max_bookings: formData.max_bookings,
      min_bookings: formData.min_bookings,
      booking_deadline: bookingDeadline,
      cancel_deadline: cancelBookingDeadline,
      credits_cost: creditsCost,
      cover: this._extractRelativePath(formData.coverUrl)
    };

    try {
      if (formData._id) {
        await request({
          url: `/schedules/${formData._id}`,
          method: 'PUT',
          data: submitData
        });
        wx.showToast({ title: '修改成功', icon: 'success' });
      } else {
        await request({
          url: '/schedules',
          method: 'POST',
          data: submitData
        });
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showAddModal: false });
      this.loadSchedules();
    } catch (err) {
      console.error('保存排课失败', err);
      const errMsg = err.message || err.data?.message || '保存失败';
      if (errMsg.length > 15) {
        wx.showModal({ title: '排课冲突', content: errMsg, showCancel: false, confirmText: '知道了' });
      } else {
        wx.showToast({ title: errMsg, icon: 'none' });
      }
    }
  },

  // 取消排课/删除模板
  async onCancelSchedule(e) {
    // 防抖处理：如果正在删除中，则直接返回
    if (this.data.deleting) {
      wx.showToast({ title: '正在处理中，请稍候', icon: 'none' });
      return;
    }
    
    const { viewMode, weekTemplate, weekdayList, currentWeekdayIndex } = this.data;
    const index = e.currentTarget.dataset.index;
    const id = e.currentTarget.dataset.id;
    const bookings = parseInt(e.currentTarget.dataset.bookings) || 0;
    
    // 星期视图模式，从模板中删除
    if (viewMode === 'day') {
      wx.showModal({
        title: '确认删除',
        content: '确定要删除该模板课程吗？',
        success: async (res) => {
          if (res.confirm) {
            // 设置防抖标志位
            this.setData({ deleting: true });
            try {
              const currentWeekday = weekdayList[currentWeekdayIndex]?.weekday;
              const newWeekTemplate = { ...weekTemplate };
              if (newWeekTemplate[currentWeekday] && newWeekTemplate[currentWeekday][index] !== undefined) {
                newWeekTemplate[currentWeekday].splice(index, 1);
                this.setData({ weekTemplate: newWeekTemplate });
                await this.saveWeekTemplate();
                this.loadCurrentWeekdaySchedules();
                wx.showToast({ title: '已删除', icon: 'success' });
              }
            } catch (err) {
              console.error('删除模板失败', err);
              wx.showToast({ title: '删除失败', icon: 'none' });
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
      return;
    }
    
    // 月视图模式：有预约时弹出原因选择，无预约时直接确认取消
    if (bookings > 0) {
      this.setData({
        showCancelReasonModal: true,
        cancelScheduleId: id,
        cancelScheduleBookings: bookings,
        cancelSelectedReason: ''
      });
      // 注意：防抖标志位将在用户选择原因后，在 confirmCancelReason 方法中处理
    } else {
      wx.showModal({
        title: '确认取消排课',
        content: '确定要取消该排课吗？当前无会员预约。',
        success: async (res) => {
          if (res.confirm) {
            try {
              // 设置防抖标志位
              this.setData({ deleting: true });
              await request({ url: `/schedules/${id}/cancel`, method: 'PUT' });
              wx.showToast({ title: '已取消', icon: 'success' });
              this.loadSchedules();
            } catch (err) {
              console.error('取消排课失败', err);
              wx.showToast({ title: '取消失败', icon: 'none' });
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
  },

  // 关闭取消原因弹窗
  onCloseCancelReasonModal() {
    this.setData({
      showCancelReasonModal: false,
      cancelScheduleId: '',
      cancelScheduleBookings: 0,
      cancelSelectedReason: ''
    });
  },

  // 选择取消原因
  onSelectCancelReason(e) {
    const reason = e.currentTarget.dataset.reason;
    this.setData({ cancelSelectedReason: reason });
  },

  // 确认取消排课（带原因）
  async onConfirmCancelSchedule() {
    const { cancelScheduleId, cancelSelectedReason } = this.data;
    if (!cancelSelectedReason) return;
    
    try {
      await request({
        url: `/schedules/${cancelScheduleId}/cancel`,
        method: 'PUT',
        data: { reason: cancelSelectedReason }
      });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.onCloseCancelReasonModal();
      this.loadSchedules();
    } catch (err) {
      console.error('取消排课失败', err);
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  },

  // 下线排课（管理员手动下线，自动退还已预约会员课时）
  async onOfflineSchedule(e) {
    if (this.data.deleting) {
      wx.showToast({ title: '正在处理中，请稍候', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const bookings = parseInt(e.currentTarget.dataset.bookings) || 0;
    if (!id) {
      wx.showToast({ title: '排课ID不存在', icon: 'none' });
      return;
    }

    const content = bookings > 0
      ? `确定要下线该排课吗？当前有 ${bookings} 人预约，下线后将自动退还他们的课时。`
      : '确定要下线该排课吗？当前无会员预约。';

    wx.showModal({
      title: '确认下线排课',
      content,
      editable: true,
      placeholderText: '请输入下线原因（可选）',
      success: async (res) => {
        if (res.confirm) {
          this.setData({ deleting: true });
          try {
            const reason = res.content || '';
            await request({ url: `/schedules/${id}/offline`, method: 'PUT', data: { reason } });
            wx.showToast({ title: '已下线', icon: 'success' });
            this.loadSchedules();
          } catch (err) {
            console.error('下线排课失败', err);
            wx.showToast({ title: err.message || '下线失败', icon: 'none' });
          } finally {
            this.setData({ deleting: false });
          }
        }
      },
      fail: () => {
        this.setData({ deleting: false });
      }
    });
  },

  // 删除排课（仅限已取消/已下架状态的排课）
  async onDeleteSchedule(e) {
    const id = e.currentTarget.dataset.id;
    
    if (!id) {
      wx.showToast({ title: '排课ID不存在', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该排课吗？此操作不可恢复！',
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...', mask: true });
          try {
            await request({
              url: `/schedules/${id}`,
              method: 'DELETE'
            });
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadSchedules();
          } catch (err) {
            wx.hideLoading();
            console.error('删除排课失败', err);
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 查看预约名单
  onViewBookings(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/bookings/bookings?schedule_id=${id}`
    });
  },

  // 查看上课记录（历史课程）
  onViewAttendance(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/bookings/bookings?schedule_id=${id}&view_mode=attendance`
    });
  },

  // 从模板创建单个课程
  async onCreateFromTemplate(e) {
    const index = e.currentTarget.dataset.index;
    const template = this.data.schedules[index];
    const { currentStoreId, currentDate } = this.data;

    wx.showLoading({ title: '创建中...', mask: true });
    
    try {
      await request({
        url: '/schedules',
        method: 'POST',
        data: {
          store_id: currentStoreId,
          date: currentDate,
          dance_style_id: template.dance_style_id,
          coach_id: template.coach_id,
          start_time: template.start_time,
          end_time: template.end_time,
          duration: template.duration,
          course_name: template.course_name,
          classroom: template.classroom,
          max_bookings: template.max_bookings,
          min_bookings: template.min_bookings,
          booking_deadline: template.booking_deadline || 180,
          cancel_deadline: template.cancel_deadline || template.cancel_booking_deadline || 120,
          credits_cost: template.credits_cost || 1,
          cover: this._extractRelativePath(template.coverUrl || template.cover || ''),
          from_template: true
        }
      });
      
      wx.showToast({ title: '创建成功', icon: 'success' });
      this.loadSchedules();
    } catch (err) {
      console.error('创建排课失败', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 从模板批量创建所有课程（创建一周的课程）
  async onCreateAllFromTemplate() {
    const { schedules, currentStoreId, currentDate, weekTemplate } = this.data;
    
    if (!weekTemplate || Object.keys(weekTemplate).length === 0) {
      wx.showToast({ title: '没有可用的星期模板', icon: 'none' });
      return;
    }

    let totalCount = 0;
    for (const weekday in weekTemplate) {
      if (weekTemplate[weekday] && Array.isArray(weekTemplate[weekday])) {
        totalCount += weekTemplate[weekday].filter(t => t.enabled !== false).length;
      }
    }
    
    if (totalCount === 0) {
      wx.showToast({ title: '没有可创建的模板课程', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '批量创建',
      content: `确定要创建 ${totalCount} 节课程吗？课程将创建在 ${currentDate} 所在周的每一天。`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '批量创建中...', mask: true });
          
          let successCount = 0;
          const startDate = new Date(currentDate);
          const dayOfWeek = startDate.getDay();
          const monday = new Date(startDate);
          monday.setDate(startDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
          
          for (let i = 0; i < 7; i++) {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            const dayNum = date.getDay();
            const templateSchedules = weekTemplate[dayNum] || [];
            
            for (const template of templateSchedules) {
              if (template.enabled === false) continue;
              const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              try {
                await request({
                  url: '/schedules',
                  method: 'POST',
                  data: {
                    store_id: currentStoreId,
                    date: dateStr,
                    dance_style_id: template.dance_style_id,
                    coach_id: template.coach_id,
                    start_time: template.start_time,
                    end_time: template.end_time,
                    duration: template.duration,
                    course_name: template.course_name,
                    classroom: template.classroom,
                    max_bookings: template.max_bookings,
                    min_bookings: template.min_bookings,
                    booking_deadline: template.booking_deadline || 180,
                    cancel_deadline: template.cancel_deadline || template.cancel_booking_deadline || 120,
                    credits_cost: template.credits_cost || 1,
                    cover: this._extractRelativePath(template.coverUrl || template.cover || ''),
                    from_template: true
                  }
                });
                successCount++;
              } catch (err) {
                console.error('创建排课失败', err);
              }
            }
          }
          
          wx.hideLoading();
          
          if (successCount > 0) {
            wx.showToast({ title: `成功创建 ${successCount} 节课`, icon: 'success' });
            this.loadSchedules();
          } else {
            wx.showToast({ title: '创建失败', icon: 'none' });
          }
        }
      }
    });
  },

  // ==================== 复制周排课（3步骤向导） ====================

  // 计算日期所在周的周一和周日
  _getWeekRange(dateStr) {
    const d = getBeijingDate(new Date(dateStr));
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = getBeijingDate(d);
    monday.setDate(d.getDate() + diffToMonday);
    const sunday = getBeijingDate(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    return { start: fmt(monday), end: fmt(sunday) };
  },

  // 格式化日期为中文短格式（5月12日）
  _formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(new Date(dateStr));
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  // 格式化日期为中文长格式（5月12日 周一）
  _formatDateLong(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(new Date(dateStr));
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
  },

  // 计算目标结束日期
  _calcTargetEndDate(targetStart, mode, count) {
    if (!targetStart) return '';
    const d = getBeijingDate(new Date(targetStart));
    if (mode === 'weeks') {
      d.setDate(d.getDate() + (count - 1) * 7);
    } else {
      d.setMonth(d.getMonth() + count);
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  },

  // 更新预览文本
  _updatePreviewText() {
    const { copyForm, viewMode } = this.data;
    if (!copyForm.target_start_date) {
      this.setData({ copyPreviewText: '' });
      return;
    }
    const endDate = this._calcTargetEndDate(copyForm.target_start_date, copyForm.copyMode, copyForm.copyCount);
    const modeLabel = copyForm.copyMode === 'weeks' ? '周' : '月';
    this.setData({
      copyPreviewText: viewMode === 'day'
        ? `从 ${this._formatDateShort(copyForm.target_start_date)} 开始，按星期模板复制${copyForm.copyCount}${modeLabel}，至 ${this._formatDateShort(endDate)}`
        : `从 ${this._formatDateShort(copyForm.target_start_date)} 开始，按${modeLabel}复制${copyForm.copyCount}${modeLabel}，至 ${this._formatDateShort(endDate)}`
    });
  },

  // 查询源周排课数量（星期视图模式不需要，保留兼容）
  async _querySourceCount() {
    // 星期视图模式使用本地模板数据，不需要API查询
  },

  // 打开复制弹窗（重置到第1步）
  onShowCopyModal() {
    const { dateList, stores, currentStoreId, weekTemplate, viewMode } = this.data;
    // 获取当前门店名称
    const currentStore = stores.find(s => s._id === currentStoreId);
    
    // 计算模板总课程数
    let templateCount = 0;
    for (const weekday in weekTemplate) {
      if (weekTemplate[weekday] && Array.isArray(weekTemplate[weekday])) {
        templateCount += weekTemplate[weekday].length;
      }
    }
    
    // 计算下周一作为默认起始日期
    const today = getBeijingDate();
    const dayOfWeek = today.getDay();
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const nextMonday = getBeijingDate(today);
    nextMonday.setDate(today.getDate() + daysUntilNextMonday);
    const targetStartDate = this._formatDate(nextMonday);
    
    this.setData({
      showCopyModal: true,
      copyStep: 1,
      copySourceCount: templateCount,
      copyStoreName: currentStore ? currentStore.name : '',
      copyForm: {
        source_start_date: '', // 星期视图不需要源日期
        source_end_date: '',
        target_start_date: targetStartDate,
        copyMode: 'weeks',
        copyCount: 4
      }
    });
    
    // 如果是星期视图模式，立即更新预览文本
    if (viewMode === 'day') {
      const endDate = this._calcTargetEndDate(targetStartDate, 'weeks', 4);
      this.setData({
        copyPreviewText: `从 ${this._formatDateShort(targetStartDate)} 开始，按星期模板复制4周，至 ${this._formatDateShort(endDate)}`
      });
    }
  },

  // 关闭复制弹窗
  onCloseCopyModal() {
    this.setData({ showCopyModal: false });
  },

  onShowManageModal() {
    this.setData({
      showManageModal: true,
      showManageDatePicker: false,
      showManageConfirm: false,
      manageConfirmInput: '',
      manageClearDate: '',
      manageClearAction: ''
    });
  },

  onCloseManageModal() {
    this.setData({ showManageModal: false });
  },

  onManageClearToday() {
    const storeName = this.data.stores.find(s => s._id === this.data.currentStoreId)?.name || '';
    this.setData({
      showManageConfirm: true,
      showManageDatePicker: false,
      manageConfirmText: `即将清空「${storeName}」今日及未来所有排课，此操作不可恢复！`,
      manageClearAction: 'clearToday'
    });
  },

  onManageClearAfterDate() {
    this.setData({
      showManageDatePicker: true,
      showManageConfirm: false,
      manageClearDate: '',
      manageClearAction: 'clearAfterDate'
    });
  },

  onManageClearDateChange(e) {
    this.setData({ manageClearDate: e.detail.value });
  },

  onConfirmClearAfterDate() {
    const { manageClearDate, stores, currentStoreId } = this.data;
    if (!manageClearDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    const storeName = stores.find(s => s._id === currentStoreId)?.name || '';
    this.setData({
      showManageConfirm: true,
      manageConfirmText: `即将清空「${storeName}」${manageClearDate} 及之后的所有排课，此操作不可恢复！`,
      manageClearAction: 'clearAfterDate'
    });
  },

  onManageClearThisWeek() {
    const storeName = this.data.stores.find(s => s._id === this.data.currentStoreId)?.name || '';
    const weekRange = this._getWeekRange(this.data.currentDate);
    this.setData({
      showManageConfirm: true,
      showManageDatePicker: false,
      manageConfirmText: `即将清空「${storeName}」本周（${weekRange.start} ~ ${weekRange.end}）的所有排课，此操作不可恢复！`,
      manageClearAction: 'clearThisWeek'
    });
  },

  onManageClearTemplate() {
    const storeName = this.data.stores.find(s => s._id === this.data.currentStoreId)?.name || '';
    this.setData({
      showManageConfirm: true,
      showManageDatePicker: false,
      manageConfirmText: `即将清空「${storeName}」的星期课程模板，此操作不可恢复！已生成的排课不受影响。`,
      manageClearAction: 'clearTemplate'
    });
  },

  onCancelManageConfirm() {
    this.setData({
      showManageConfirm: false,
      manageConfirmInput: ''
    });
  },

  onManageConfirmInput(e) {
    this.setData({ manageConfirmInput: e.detail.value });
  },

  async onExecuteManageClear() {
    const { manageClearAction, manageConfirmInput, currentStoreId, manageClearDate } = this.data;
    
    if (manageConfirmInput !== '确认') {
      wx.showToast({ title: '请输入"确认"', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '正在清空...', mask: true });
    
    try {
      if (manageClearAction === 'clearTemplate') {
        const emptyTemplate = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        this.setData({ weekTemplate: emptyTemplate });
        await this.saveWeekTemplate();
        this.loadCurrentWeekdaySchedules();
        wx.showToast({ title: '模板已清空', icon: 'success' });
        this.setData({ showManageModal: false });
        return;
      }
      
      let startDate = '';
      let endDate = '';
      
      if (manageClearAction === 'clearToday') {
        const today = getBeijingDate();
        startDate = this._formatDate(today);
      } else if (manageClearAction === 'clearAfterDate') {
        startDate = manageClearDate;
      } else if (manageClearAction === 'clearThisWeek') {
        const weekRange = this._getWeekRange(this.data.currentDate);
        startDate = weekRange.start;
        endDate = weekRange.end;
      }
      
      const reqData = {
        store_id: currentStoreId,
        start_date: startDate
      };
      if (endDate) {
        reqData.end_date = endDate;
      }
      
      const res = await request({
        url: '/api/v1/schedules/batch-cancel',
        method: 'POST',
        data: reqData
      });
      
      const cancelledCount = res.data?.cancelled_count || 0;
      if (cancelledCount === 0) {
        wx.showToast({ title: '暂无符合条件的排课', icon: 'none' });
      } else {
        wx.showToast({ title: `已清空${cancelledCount}节排课`, icon: 'success' });
      }
      this.setData({ showManageModal: false });
      this.loadSchedules();
    } catch (err) {
      console.error('清空排课失败', err);
      
      if (manageClearAction !== 'clearTemplate') {
        try {
          await this._batchCancelFallback(manageClearAction, manageClearDate);
          this.setData({ showManageModal: false });
          this.loadSchedules();
        } catch (fallbackErr) {
          console.error('逐个取消也失败', fallbackErr);
          wx.showToast({ title: '清空失败，请重试', icon: 'none' });
        }
      } else {
        wx.showToast({ title: err.message || '清空失败', icon: 'none' });
      }
    } finally {
      wx.hideLoading();
    }
  },

  async _batchCancelFallback(action, clearDate) {
    const { currentStoreId, currentDate } = this.data;
    let startDate = '';
    let endDate = '';
    
    if (action === 'clearToday') {
      const today = getBeijingDate();
      startDate = this._formatDate(today);
      const futureDate = getBeijingDate(today);
      futureDate.setDate(today.getDate() + 365);
      endDate = this._formatDate(futureDate);
    } else if (action === 'clearAfterDate') {
      startDate = clearDate;
      const futureDate = getBeijingDate(new Date(clearDate));
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      endDate = this._formatDate(futureDate);
    } else if (action === 'clearThisWeek') {
      const weekRange = this._getWeekRange(currentDate);
      startDate = weekRange.start;
      endDate = weekRange.end;
    }
    
    const res = await request({
      url: '/schedules',
      method: 'GET',
      data: {
        store_id: currentStoreId,
        start_date: startDate,
        end_date: endDate
      }
    });
    
    const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
    const activeList = list.filter(item => item.status !== 'cancelled' && item.status !== 'offline');
    
    let cancelledCount = 0;
    for (const item of activeList) {
      try {
        await request({
          url: `/schedules/${item._id}/cancel`,
          method: 'PUT'
        });
        cancelledCount++;
      } catch (err) {
        console.error('取消排课失败', item._id, err);
      }
    }
    
    wx.showToast({ title: `已清空${cancelledCount}节排课`, icon: 'success' });
  },

  // 表单字段变更（日期选择器）
  onCopyFormChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`copyForm.${field}`]: value });

    // 如果修改了源周日期，自动对齐为整周
    if (field === 'source_start_date' && value) {
      const weekRange = this._getWeekRange(value);
      this.setData({
        'copyForm.source_start_date': weekRange.start,
        'copyForm.source_end_date': weekRange.end,
        copySourceCount: 0
      });
      this._querySourceCount();
    }

    // 如果修改了目标日期，更新预览
    if (field === 'target_start_date') {
      this._updatePreviewText();
    }
  },

  // 切换复制模式
  onCopyModeChange(e) {
    const { mode } = e.currentTarget.dataset;
    // 切换模式时重置复制数量到合理默认值
    const defaultCount = mode === 'weeks' ? 4 : 3;
    this.setData({
      'copyForm.copyMode': mode,
      'copyForm.copyCount': defaultCount
    });
    this._updatePreviewText();
  },

  // 步进器减
  onStepperMinus() {
    const { copyForm } = this.data;
    const min = copyForm.copyMode === 'weeks' ? 1 : 1;
    if (copyForm.copyCount > min) {
      this.setData({ 'copyForm.copyCount': copyForm.copyCount - 1 });
      this._updatePreviewText();
    }
  },

  // 步进器加
  onStepperPlus() {
    const { copyForm } = this.data;
    const max = copyForm.copyMode === 'weeks' ? 52 : 12;
    if (copyForm.copyCount < max) {
      this.setData({ 'copyForm.copyCount': copyForm.copyCount + 1 });
      this._updatePreviewText();
    }
  },

  // 下一步
  onCopyNextStep() {
    const { copyStep, copyForm, copySourceCount } = this.data;

    if (copyStep === 1) {
      // 验证第1步：源周必须选择且有排课
      if (!copyForm.source_start_date || !copyForm.source_end_date) {
        wx.showToast({ title: '请选择源周日期', icon: 'none' });
        return;
      }
      if (copySourceCount === 0) {
        wx.showToast({ title: '该周暂无排课，请选择有排课的周', icon: 'none' });
        return;
      }
      // 进入第2步
      this.setData({ copyStep: 2 });
    } else if (copyStep === 2) {
      // 验证第2步：目标日期和复制数量
      if (!copyForm.target_start_date) {
        wx.showToast({ title: '请选择目标起始周', icon: 'none' });
        return;
      }
      if (!copyForm.copyCount || copyForm.copyCount < 1) {
        wx.showToast({ title: '复制数量至少为1', icon: 'none' });
        return;
      }
      // 进入第3步
      this.setData({ copyStep: 3 });
    }
  },

  // 上一步
  onCopyPrevStep() {
    const { copyStep } = this.data;
    if (copyStep > 1) {
      this.setData({ copyStep: copyStep - 1 });
    }
  },

  // 确认复制
  async onSubmitCopy() {
    const { copyForm, currentStoreId, copySourceCount, viewMode, weekTemplate } = this.data;

    // 星期视图模式：逐个日期创建排课
    if (viewMode === 'day') {
      wx.showLoading({ title: '正在批量排课...', mask: true });
      try {
        const result = await this.createSchedulesFromTemplate(
          copyForm.target_start_date,
          copyForm.copyMode,
          copyForm.copyCount,
          weekTemplate
        );
        const createdCount = result.totalCreated;
        const skippedErrors = result.skippedErrors || [];

        let content = `成功生成 ${createdCount} 节课（星期模板 ${copySourceCount} 节 × ${copyForm.copyCount} ${copyForm.copyMode === 'weeks' ? '周' : '月'}）`;
        if (skippedErrors.length > 0) {
          const showErrors = skippedErrors.slice(0, 5);
          content += `\n\n⚠️ ${skippedErrors.length} 节课因冲突被跳过：`;
          showErrors.forEach(e => {
            content += `\n· ${e}`;
          });
          if (skippedErrors.length > 5) {
            content += `\n... 等共 ${skippedErrors.length} 节`;
          }
        }

        wx.showModal({
          title: '批量排课完成',
          content: content,
          showCancel: false,
          confirmText: '知道了',
          success: () => {
            this.setData({ showCopyModal: false });
            this.loadSchedules();
            if (viewMode === 'day') {
              this.loadCurrentWeekdaySchedules();
            }
          }
        });
      } catch (err) {
        console.error('复制排课失败:', err);
        const errorMsg = err.message || err.data?.message || '复制失败，请检查网络或联系管理员';
        wx.showModal({
          title: '复制失败',
          content: errorMsg,
          showCancel: false,
          confirmText: '知道了'
        });
      } finally {
        wx.hideLoading();
      }
      return;
    }

    // 月视图模式：使用原有API
    const submitData = {
      store_id: currentStoreId,
      source_start_date: copyForm.source_start_date,
      source_end_date: copyForm.source_end_date,
      target_start_date: copyForm.target_start_date,
    };
    if (copyForm.copyMode === 'weeks') {
      submitData.copy_weeks = copyForm.copyCount;
    } else {
      submitData.copy_months = copyForm.copyCount;
    }

    wx.showLoading({ title: '正在批量排课...', mask: true });
    try {
      const res = await request({
        url: '/schedules/copy-week',
        method: 'POST',
        data: submitData
      });
      const result = res.data || {};
      const created = result.created_count || 0;
      const skipped = result.skipped_count || 0;
      let content = `成功生成 ${created} 节课（源周 ${copySourceCount} 节 × ${copyForm.copyCount} ${copyForm.copyMode === 'weeks' ? '周' : '月'}）`;
      if (skipped > 0) {
        content += `\n\n⚠️ ${skipped} 节课因冲突（教练时间冲突/跨门店冲突/放假）被跳过`;
      }
      wx.showModal({
        title: '批量排课完成',
        content: content,
        showCancel: false,
        confirmText: '知道了',
        success: () => {
          this.setData({ showCopyModal: false });
          this.loadSchedules();
        }
      });
    } catch (err) {
      console.error('复制排课失败', err);
      const errorMsg = err.message || err.data?.message || '复制失败，请检查网络或联系管理员';
      wx.showModal({
        title: '复制失败',
        content: errorMsg,
        showCancel: false,
        confirmText: '知道了'
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 从星期模板创建排课
  async createSchedulesFromTemplate(startDateStr, mode, count, weekTemplate) {
    const { currentStoreId } = this.data;
    let totalCreated = 0;
    const skippedErrors = [];
    const startDate = getBeijingDate(new Date(startDateStr));
    
    const weekdayMap = {
      1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6
    };
    
    const datesToProcess = [];
    
    for (let i = 0; i < count; i++) {
      if (mode === 'weeks') {
        // 计算当前周的起始日期
        const weekStart = getBeijingDate(startDate);
        weekStart.setDate(startDate.getDate() + i * 7);
        
        for (let j = 0; j < 7; j++) {
          const date = getBeijingDate(weekStart);
          date.setDate(weekStart.getDate() + j);
          datesToProcess.push(date);
        }
      } else {
        const monthDate = getBeijingDate(startDate);
        monthDate.setMonth(startDate.getMonth() + i);
        monthDate.setDate(1);
        const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
        for (let j = 0; j < lastDay; j++) {
          const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), j + 1);
          datesToProcess.push(date);
        }
      }
    }
    
    for (const date of datesToProcess) {
      const dayOfWeek = date.getDay();
      const templateSchedules = weekTemplate[dayOfWeek] || [];
      
      for (const template of templateSchedules) {
        if (template.enabled === false) continue;
        const dateStr = this._formatDate(date);
        try {
          await request({
            url: '/schedules',
            method: 'POST',
            data: {
              store_id: currentStoreId,
              date: dateStr,
              dance_style_id: template.dance_style_id,
              coach_id: template.coach_id,
              start_time: template.start_time,
              end_time: template.end_time,
              duration: template.duration,
              course_name: template.course_name,
              classroom: template.classroom,
              max_bookings: template.max_bookings,
              min_bookings: template.min_bookings,
              booking_deadline: template.booking_deadline || 180,
              cancel_deadline: template.cancel_deadline || template.cancel_booking_deadline || 120,
              credits_cost: template.credits_cost || 1,
              cover: this._extractRelativePath(template.coverUrl || template.cover || ''),
              from_template: true
            }
          });
          totalCreated++;
        } catch (err) {
          const errMsg = err.data?.message || err.message || '未知错误';
          skippedErrors.push(`${dateStr} ${template.start_time}-${template.end_time} ${template.course_name || ''}: ${errMsg}`);
        }
      }
    }
    
    return { totalCreated, skippedErrors };
  }
});
