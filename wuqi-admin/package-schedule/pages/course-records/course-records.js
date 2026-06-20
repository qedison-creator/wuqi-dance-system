const app = getApp();
const { request } = require('../../../utils/request');
const { getScheduleStatusText } = require('../../../utils/util');

Page({
  data: {
    stores: [],
    currentStoreId: '',
    currentDate: '',
    monthList: [],
    currentMonth: '',
    currentMonthName: '',
    monthCalendar: [],
    schedules: [],
    monthSchedules: {}, // 存储整个月的课程信息
    holidays: [], // 存储假期信息
    isCurrentDatePast: false, // 当前选中日期是否是历史日期
    weekdays: ['一', '二', '三', '四', '五', '六', '日']
  },

  onShow() {
    if (!app.checkAuth()) return;
    // 更新自定义tabbar的选中状态

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.initDateList();
    this.loadStores();
    this.loadHolidays();
  },

  // 初始化日期列表（历史1年 + 未来3个月）
  initDateList() {
    const months = [];
    const today = new Date();
    const todayStr = this._formatDate(today);

    // 生成日期范围：历史1年 + 未来3个月

    const startOffset = -365;
    const endOffset = 90;

    let currentMonth = '';

    for (let i = startOffset; i <= endOffset; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
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
    }

    const todayMonthKey = todayStr.substring(0, 7);
    const currentMonthInfo = months.find(m => m.key === todayMonthKey);

    // 默认初始化时，当天不是历史日期（因为today >= today）

    this.setData({
      monthList: months,
      currentDate: todayStr,
      currentMonth: currentMonthInfo?.key || (months[0]?.key || todayMonthKey),
      currentMonthName: currentMonthInfo?.name || (months[0]?.name || ''),
      isCurrentDatePast: false
    }, () => {
      this.generateMonthCalendar(this.data.currentMonth);
    });
  },

  // 格式化日期为 YYYY-MM-DD
  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 生成月视图日历
  async generateMonthCalendar(monthKey) {
    if (!monthKey) return;

    const [year, month] = monthKey.split('-').map(Number);

    // 获取当月第一天和最后一天

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    // 获取第一天是星期几 (0=周日, 1=周一, ..., 6=周六)
    // 调整为从周一开始：周日→6，周一→0，周二→1...周六→5

    let startWeekday = firstDay.getDay();
    if (startWeekday === 0) {
      startWeekday = 6;
    } else {
      startWeekday = startWeekday - 1;
    }

    // 创建日历数据

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 生成完整的日历数据（按周组织）

    const weeks = [];
    let currentWeek = [];

    // 先加载当月的所有课程
    await this.loadMonthSchedules(monthKey);

    // 填充第一周的空白

    for (let i = 0; i < startWeekday; i++) {
      currentWeek.push({ type: 'empty' });
    }

    // 填充日期

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === this.data.currentDate;
      const isPast = new Date(dateStr) < today;

      // 判断当天的课程状态

      const dayStatus = this.getDayStatus(dateStr);

      currentWeek.push({
        type: 'date',
        date: dateStr,
        day: day,
        isToday: isToday,
        isSelected: isSelected,
        isPast: isPast,
        dayStatus: dayStatus
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

  // 加载整个月的课程
  async loadMonthSchedules(monthKey) {
    const { currentStoreId } = this.data;
    if (!currentStoreId || !monthKey) return;

    try {
      const [year, month] = monthKey.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const res = await request({
        url: '/schedules',
        method: 'GET',
        data: { store_id: currentStoreId, start_date: startDate, end_date: endDate, status: 'all', pageSize: 500 }
      });
      const allSchedules = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);

      const monthSchedules = {};
      allSchedules.forEach(schedule => {
        const date = schedule.date;
        if (!monthSchedules[date]) {
          monthSchedules[date] = [];
        }
        monthSchedules[date].push(schedule);
      });

      this.setData({ monthSchedules });
    } catch (err) {
      console.error('加载月课程失败', err);
    }
  },

  // 加载假期信息
  async loadHolidays() {
    try {
      const res = await request({ url: '/holidays', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      this.setData({ holidays: list });
    } catch (err) {
      console.error('加载假期失败', err);
    }
  },

  // 判断某天的状态
  getDayStatus(dateStr) {
    // 首先检查是否是未来日期

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(dateStr);
    checkDate.setHours(0, 0, 0, 0);
    
    // 未来的日期直接返回none，不显示边框

    if (checkDate > today) {
      return 'none';
    }
    
    const { monthSchedules, holidays } = this.data;
    
    // 检查是否是假期

    const isHoliday = holidays.some(holiday => {
      const hEnd = holiday.end_date || holiday.date;
      return holiday.date <= dateStr && hEnd >= dateStr;
    });
    
    if (isHoliday) {
      return 'holiday';
    }

    // 检查当天是否有课程

    const daySchedules = monthSchedules[dateStr];
    if (!daySchedules || daySchedules.length === 0) {
      return 'none';
    }

    // 检查课程状态

    let hasNormal = false;
    let hasCancelled = false;

    daySchedules.forEach(schedule => {
      if (schedule.status === 'cancelled' || schedule.status === 'offline') {
        hasCancelled = true;
      } else {
        hasNormal = true;
      }
    });

    if (hasNormal && hasCancelled) {
      return 'mixed';
    } else if (hasCancelled) {
      return 'cancelled';
    } else if (hasNormal) {
      return 'normal';
    }

    return 'none';
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

    // 首先检查选择的日期是否是历史日期

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    const isPastDate = current < today;

    this.setData({
      currentDate: date,
      isCurrentDatePast: isPastDate
    }, () => {
      // 重新生成日历以更新选中状态

      this.generateMonthCalendar(this.data.currentMonth);
      this.loadSchedules();
    });
  },

  async loadStores() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      
      const originalStoreId = this.data.currentStoreId;
      let storeId = originalStoreId;
      if (!storeId || !list.find(s => s._id === storeId)) {
        storeId = list.length > 0 ? list[0]._id : '';
      }
      
      this.setData({
        stores: list,
        currentStoreId: storeId
      }, () => {
        if (storeId !== originalStoreId) {
          this.loadSchedules();
        }
      });
    } catch (err) {
      console.error('加载门店失败', err);
      this.loadSchedules();
    }
  },

  async loadSchedules() {
    const { currentStoreId, currentDate } = this.data;
    if (!currentStoreId) return;

    try {
      // 首先检查是否是未来日期

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const current = new Date(currentDate);
      current.setHours(0, 0, 0, 0);
      const isPastDate = current < today;
      
      // 设置当前日期是否是历史日期的状态

      this.setData({
        isCurrentDatePast: isPastDate
      });
      
      // 未来日期直接不加载课程

      if (!isPastDate) {
        this.setData({
          schedules: []
        });
        return;
      }

      const res = await request({
        url: '/schedules',
        method: 'GET',
        data: { store_id: currentStoreId, date: currentDate, status: 'all' }
      });
      let list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);

      // 直接信任后端返回的 status 字段，前端不再推导历史课程状态

      const processedList = list.map(item => {
        const status = item.status || 'available';
        return {
          ...item,
          status,
          statusText: getScheduleStatusText(status),
          isHistory: true,
          danceStyleName: item.dance_style_id?.name || '未知舞种',
          coachName: item.coach_id?.name || '未知教练'
        };
      });

      this.setData({
        schedules: processedList
      });
    } catch (err) {
      console.error('加载课程记录失败', err);
    }
  },

  onSwitchStore(e) {
    this.setData({ currentStoreId: e.currentTarget.dataset.id }, () => {
      this.loadSchedules();
      // 重新加载月课程

      this.generateMonthCalendar(this.data.currentMonth);
    });
  },

  onViewBookings(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/package-schedule/pages/bookings/bookings?schedule_id=${id}`
    });
  },

  onViewAttendance(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/package-schedule/pages/bookings/bookings?schedule_id=${id}&view_mode=attendance`
    });
  }
});
