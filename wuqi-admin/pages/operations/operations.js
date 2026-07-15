const app = getApp();
const { request } = require('../../utils/request');
const { getScheduleStatusText, formatDateTime, fixImageUrl } = require('../../utils/util');

Page({
  data: {
    stores: [],
    currentStoreId: '',
    todayDate: '',
    todayDateText: '',
    todaySchedules: [],
    monthList: [],
    currentMonth: '',
    currentMonthName: '',
    currentDate: '',
    monthCalendar: [],
    monthSchedules: {},
    holidays: [],
    dateSchedules: [],
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    showBookingPanel: false,
    panelSchedule: null,
    activeTab: 'booked',
    bookedList: [],
    checkedInList: [],
    cancelledList: [],
    isSelectedDateHoliday: false
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.initDates();

    // 接收首页跳转携带的门店信息
    app.globalData = app.globalData || {};
    const pendingStoreId = app.globalData.pendingStoreId;
    if (pendingStoreId !== undefined) {
      // 有待应用的门店ID（可能为空字符串表示全部门店）
      this._pendingStoreId = pendingStoreId;
      delete app.globalData.pendingStoreId;
    }

    this.loadStores();
    this.loadHolidays();
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadStores(),
      this.loadHolidays()
    ]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  initDates() {
    const today = new Date();
    const todayStr = this._formatDate(today);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const todayText = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 ${weekdays[today.getDay()]}`;

    // 初始只生成当前月，用户切换月份时再动态扩展，避免一次性 setData 大量月份
    const months = this._buildMonthRange(today, 0, 0);

    const todayMonthKey = todayStr.substring(0, 7);
    const currentMonthInfo = months.find(m => m.key === todayMonthKey);

    this.setData({
      todayDate: todayStr,
      todayDateText: todayText,
      currentDate: todayStr,
      monthList: months,
      currentMonth: todayMonthKey,
      currentMonthName: currentMonthInfo?.name || ''
    }, () => {
      this.generateMonthCalendar(todayMonthKey);
    });
  },

  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 根据基准日期生成一段月份列表（relativeStart/End 为相对月数）
  _buildMonthRange(baseDate, relativeStart, relativeEnd) {
    const months = [];
    for (let i = relativeStart; i <= relativeEnd; i++) {
      const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${month}`;
      if (!months.find(m => m.key === monthKey)) {
        months.push({ key: monthKey, name: `${year}年${month}月`, year, month: parseInt(month) });
      }
    }
    return months;
  },

  // 确保 monthList 在目标月份前后至少有 2 个月的缓冲，避免切换到底边界时无法继续翻页
  _ensureMonthRange(targetMonthKey) {
    const { monthList } = this.data;
    if (!monthList || monthList.length === 0) return monthList;
    const baseDate = new Date();
    const [targetYear, targetMonth] = targetMonthKey.split('-').map(Number);
    const targetDate = new Date(targetYear, targetMonth - 1, 1);
    const first = monthList[0];
    const last = monthList[monthList.length - 1];
    const firstDate = new Date(first.year, first.month - 1, 1);
    const lastDate = new Date(last.year, last.month - 1, 1);
    let newMonths = monthList.slice();
    // 向前扩展
    let curDate = new Date(firstDate);
    while ((curDate.getFullYear() * 12 + curDate.getMonth()) > (targetDate.getFullYear() * 12 + targetDate.getMonth() - 2)) {
      curDate.setMonth(curDate.getMonth() - 1);
      const year = curDate.getFullYear();
      const month = String(curDate.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      if (!newMonths.find(m => m.key === key)) {
        newMonths.unshift({ key, name: `${year}年${month}月`, year, month: parseInt(month) });
      }
    }
    // 向后扩展
    curDate = new Date(lastDate);
    while ((curDate.getFullYear() * 12 + curDate.getMonth()) < (targetDate.getFullYear() * 12 + targetDate.getMonth() + 2)) {
      curDate.setMonth(curDate.getMonth() + 1);
      const year = curDate.getFullYear();
      const month = String(curDate.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      if (!newMonths.find(m => m.key === key)) {
        newMonths.push({ key, name: `${year}年${month}月`, year, month: parseInt(month) });
      }
    }
    return newMonths;
  },

  async loadStores() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);

      // 优先使用首页跳转携带的门店ID
      const pendingStoreId = this._pendingStoreId;
      this._pendingStoreId = null;

      const originalStoreId = this.data.currentStoreId;
      let storeId;
      if (pendingStoreId !== null && pendingStoreId !== undefined) {
        // 首页跳转携带的门店ID（空字符串表示全部门店，但 operations 必须有具体门店，取第一个）
        storeId = pendingStoreId && list.find(s => s._id === pendingStoreId)
          ? pendingStoreId
          : (list.length > 0 ? list[0]._id : '');
      } else {
        // 正常逻辑：保持原门店或选第一个
        storeId = originalStoreId;
        if (!storeId || !list.find(s => s._id === storeId)) {
          storeId = list.length > 0 ? list[0]._id : '';
        }
      }

      this.setData({ stores: list, currentStoreId: storeId }, () => {
        if (storeId && storeId !== originalStoreId) {
          this.loadTodaySchedules();
          this.loadMonthSchedules(this.data.currentMonth);
        }
      });
    } catch (err) {
      console.error('加载门店失败', err);
      wx.showToast({ title: '加载门店失败', icon: 'none' });
    }
  },

  onSwitchStore(e) {
    const id = e.currentTarget.dataset.id;
    const { currentStoreId, currentDate, todayDate } = this.data;
    if (id === currentStoreId) return;
    this.setData({ currentStoreId: id }, () => {
      this.loadTodaySchedules();
      this.loadMonthSchedules(this.data.currentMonth);
      if (currentDate !== todayDate) {
        this.loadDateSchedules(currentDate);
      }
    });
  },

  async loadTodaySchedules() {
    const { currentStoreId, todayDate, holidays } = this.data;
    if (!currentStoreId) return;

    const isHoliday = holidays.some(h => {
      const hEnd = h.end_date || h.date;
      return h.date <= todayDate && hEnd >= todayDate;
    });
    if (isHoliday) {
      this.setData({ todaySchedules: [] });
      return;
    }

    try {
      const res = await request({
        url: '/schedules',
        method: 'GET',
        data: { store_id: currentStoreId, date: todayDate, status: 'all' }
      });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);

      const statsPromises = list.map(schedule => this.loadScheduleBookingStats(schedule._id));
      const statsResults = await Promise.all(statsPromises);

      // 直接信任后端返回的 status 字段，前端不再根据时间/人数推导状态

      const enrichedList = list.map((schedule, i) => {
        const bookingStats = statsResults[i];
        const status = schedule.status || 'available';
        return {
          ...schedule,
          status,
          statusText: getScheduleStatusText(status),
          course_name: schedule.course_name || (schedule.dance_style_name || '课程'),
          dance_style_name: schedule.dance_style_name || (schedule.dance_style_id && schedule.dance_style_id.name || ''),
          coach_name: schedule.coach_name || (schedule.coach_id && schedule.coach_id.name || ''),
          // 卡片"已预约"显示：已预约 + 已签到（所有实际预约人数）
          bookedCount: (bookingStats.booked || 0) + (bookingStats.checkedIn || 0),
          checkedInCount: bookingStats.checkedIn,
          // 已取消含豁免取消
          cancelledCount: (bookingStats.cancelled || 0) + (bookingStats.exempted || 0)
        };
      });

      this.setData({ todaySchedules: enrichedList });
    } catch (err) {
      console.error('加载今日课程失败', err);
    }
  },

  async loadScheduleBookingStats(scheduleId) {
    try {
      const res = await request({
        url: `/schedules/${scheduleId}/bookings`,
        method: 'GET'
      });
      const all = res.data || [];
      // 按人数统计（同一用户多次预约只算1次，取最新状态）
      const sortedAll = [...all].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      const userLatestMap = new Map();
      sortedAll.forEach(item => {
        const uid = item.user_id?._id || item.user_id || 'unknown';
        if (!userLatestMap.has(uid)) {
          userLatestMap.set(uid, item);
        }
      });
      let booked = 0, checkedIn = 0, cancelled = 0, exempted = 0;
      userLatestMap.forEach(item => {
        const status = item.status;
        const cancelType = item.cancel_type;
        // 因课程/admin原因取消的，仍算实际预约人数
        const isCourseCancel = status === 'cancelled' && ['admin_cancel', 'min_bookings_not_met', 'holiday', 'after_checkin_cancel'].includes(cancelType);
        const isUserCancel = status === 'cancelled' && !isCourseCancel;
        const isExempted = status === 'exempted' || item.is_exempted;
        // 已签到 + 已完成 都归入"已签到"
        const isCheckedIn = item.checked_in || status === 'checked_in' || status === 'completed';
        if (isCheckedIn) checkedIn++;
        // 预约人数（卡片显示）：booked + checked_in + completed + 课程取消的cancelled
        if (status === 'booked' || status === 'checked_in' || status === 'completed' || isCourseCancel) {
          booked++;
        } else if (isExempted) {
          exempted++;
        } else if (isUserCancel) {
          cancelled++;
        }
      });
      return { booked, checkedIn, cancelled, exempted };
    } catch (err) {
      return { booked: 0, checkedIn: 0, cancelled: 0, exempted: 0 };
    }
  },

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
      allSchedules.forEach(s => {
        const d = s.date;
        if (!monthSchedules[d]) monthSchedules[d] = [];
        monthSchedules[d].push(s);
      });

      this.setData({ monthSchedules }, () => {
        this.generateMonthCalendar(monthKey);
      });
    } catch (err) {
      console.error('加载月课程失败', err);
    }
  },

  async loadHolidays() {
    try {
      const res = await request({ url: '/holidays', method: 'GET' });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const activeHolidays = list.filter(h => h.status !== 'cancelled' && h.status !== 'disabled');
      this.setData({ holidays: activeHolidays });
    } catch (err) {
      console.error('加载假期失败', err);
    }
  },

  generateMonthCalendar(monthKey) {
    if (!monthKey) return;
    const [year, month] = monthKey.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let startWeekday = firstDay.getDay();
    startWeekday = startWeekday === 0 ? 6 : startWeekday - 1;

    const today = new Date();
    const todayStr = this._formatDate(today);
    const weeks = [];
    let currentWeek = [];

    for (let i = 0; i < startWeekday; i++) {
      currentWeek.push({ type: 'empty' });
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === this.data.currentDate;
      const isPast = new Date(dateStr) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const dayStatus = this.getDayStatus(dateStr);

      currentWeek.push({ type: 'date', date: dateStr, day, isToday, isSelected, isPast, dayStatus });

      if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) { currentWeek.push({ type: 'empty' }); }
      weeks.push(currentWeek);
    }

    const monthInfo = this.data.monthList.find(m => m.key === monthKey);
    this.setData({ monthCalendar: weeks, currentMonth: monthKey, currentMonthName: monthInfo?.name || '' });
  },

  getDayStatus(dateStr) {
    const { monthSchedules, holidays } = this.data;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(dateStr);
    checkDate.setHours(0, 0, 0, 0);

    if (checkDate > today) return 'none';

    if (holidays.some(h => {
      const hEnd = h.end_date || h.date;
      return h.date <= dateStr && hEnd >= dateStr;
    })) return 'holiday';

    const daySchedules = monthSchedules[dateStr];
    if (!daySchedules || daySchedules.length === 0) return 'none';

    // 直接信任后端 status 字段判断当日状态

    let hasNormal = false, hasCancelled = false;
    daySchedules.forEach(s => {
      if (s.status === 'cancelled' || s.status === 'offline') hasCancelled = true;
      else hasNormal = true;
    });
    if (hasNormal && hasCancelled) return 'mixed';
    if (hasCancelled) return 'cancelled';
    if (hasNormal) return 'normal';
    return 'none';
  },

  onChangeMonth(e) {
    const direction = e.currentTarget.dataset.direction;
    let { monthList, currentMonth } = this.data;
    const idx = monthList.findIndex(m => m.key === currentMonth);
    let newMonth = '';

    if (direction === 'prev') {
      if (idx > 0) {
        newMonth = monthList[idx - 1].key;
      } else if (monthList.length > 0) {
        // 已在最前，动态生成上一个月
        const first = monthList[0];
        const prevDate = new Date(first.year, first.month - 2, 1);
        const y = prevDate.getFullYear();
        const m = String(prevDate.getMonth() + 1).padStart(2, '0');
        newMonth = `${y}-${m}`;
      }
    } else if (direction === 'next') {
      if (idx < monthList.length - 1) {
        newMonth = monthList[idx + 1].key;
      } else if (monthList.length > 0) {
        // 已在最后，动态生成下一个月
        const last = monthList[monthList.length - 1];
        const nextDate = new Date(last.year, last.month, 1);
        const y = nextDate.getFullYear();
        const m = String(nextDate.getMonth() + 1).padStart(2, '0');
        newMonth = `${y}-${m}`;
      }
    }

    if (!newMonth) return;

    // 动态扩展月份列表，保证前后都有缓冲月可翻页
    const extendedMonths = this._ensureMonthRange(newMonth);
    if (extendedMonths.length !== monthList.length) {
      this.setData({ monthList: extendedMonths });
    }
    this.loadMonthSchedules(newMonth);
  },

  // 返回今日
  onGoToToday() {
    const todayDate = this.data.todayDate;
    const todayMonthKey = todayDate.substring(0, 7);
    const isHoliday = this.data.holidays.some(h => h.date === todayDate);

    this.setData({
      currentDate: todayDate,
      currentMonth: todayMonthKey,
      isSelectedDateHoliday: isHoliday
    }, () => {
      this.loadMonthSchedules(todayMonthKey);
      if (!isHoliday) {
        this.loadDateSchedules(todayDate);
      } else {
        this.setData({ dateSchedules: [] });
      }
    });
  },

  async onSelectMonthDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    const isHoliday = this.data.holidays.some(h => h.date === date);
    this.setData({ 
      currentDate: date,
      isSelectedDateHoliday: isHoliday
    }, () => {
      this.generateMonthCalendar(this.data.currentMonth);
      if (date !== this.data.todayDate) {
        this.loadDateSchedules(date);
      } else {
        this.setData({ dateSchedules: [] });
      }
    });
  },

  async loadDateSchedules(date) {
    const { currentStoreId, holidays } = this.data;
    if (!currentStoreId || !date) return;

    const isHoliday = holidays.some(h => h.date === date);
    if (isHoliday) {
      this.setData({ dateSchedules: [] });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const isPast = checkDate < today;

    try {
      const res = await request({
        url: '/schedules',
        method: 'GET',
        data: { store_id: currentStoreId, date, status: 'all' }
      });
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : []);

      const statsPromises = list.map(schedule => this.loadScheduleBookingStats(schedule._id));
      const statsResults = await Promise.all(statsPromises);

      // 直接信任后端返回的 status 字段，前端不再根据时间/人数推导状态

      const enrichedList = list.map((schedule, i) => {
        const bookingStats = statsResults[i];
        const status = schedule.status || 'available';
        return {
          ...schedule,
          status,
          statusText: getScheduleStatusText(status),
          course_name: schedule.course_name || (schedule.dance_style_name || '课程'),
          dance_style_name: schedule.dance_style_name || '',
          coach_name: schedule.coach_name || (schedule.coach_id && schedule.coach_id.name || ''),
          // 卡片"已预约"显示：已预约 + 已签到（所有实际预约人数）
          bookedCount: (bookingStats.booked || 0) + (bookingStats.checkedIn || 0),
          checkedInCount: bookingStats.checkedIn,
          // 已取消含豁免取消
          cancelledCount: (bookingStats.cancelled || 0) + (bookingStats.exempted || 0)
        };
      });

      this.setData({ dateSchedules: enrichedList });
    } catch (err) {
      console.error('加载日期课程失败', err);
    }
  },

  async onOpenBookingPanel(e) {
    const schedule = e.currentTarget.dataset.schedule;
    const tab = e.currentTarget.dataset.tab || 'booked';
    this.setData({
      showBookingPanel: true,
      panelSchedule: {
        ...schedule,
        course_name: schedule.course_name || schedule.dance_style_name || '课程',
        dance_style_name: schedule.dance_style_name || '',
        coach_name: schedule.coach_name || '',
        date: schedule.date || this.data.currentDate || this.data.todayDate
      },
      activeTab: tab,
      bookedList: [],
      checkedInList: [],
      cancelledList: []
    });
    await this.loadBookingList(schedule._id);
  },

  onCloseBookingPanel() {
    this.setData({ showBookingPanel: false, panelSchedule: null });
  },

  onPanelTap() {},

  async loadBookingList(scheduleId) {
    try {
      const res = await request({ url: `/schedules/${scheduleId}/bookings`, method: 'GET' });
      const all = res.data || [];
      const bookedList = [], checkedInList = [], cancelledList = [];

      // 列表保留每一次记录（按时间正序）
      all.forEach(item => {
        const realName = item.user_id?.real_name;
        const nickName = item.user_id?.nick_name;
        const displayName = realName || nickName || '未知用户';
        const nickNameDisplay = realName && nickName && nickName !== realName ? nickName : '';
        const status = item.status;
        const cancelType = item.cancel_type;
        const booking = {
          _id: item._id,
          userName: displayName,
          userNickName: nickNameDisplay,
          userPhone: item.user_id?.phone || '',
          userWechatPhone: item.user_id?.wechat_phone || '',
          userReservePhone: item.user_id?.reserve_phone || '',
          userAvatar: fixImageUrl(item.user_id?.avatar_url),
          bookingTime: item.created_at ? formatDateTime(item.created_at) : '',
          creditsDeducted: item.credits_deducted || 0,
          checkedIn: item.checked_in || status === 'checked_in' || status === 'completed',
          isCompleted: status === 'completed',
          cancelType: cancelType,
          cancelReason: item.cancel_reason || '',
          creditsRefunded: item.credits_refunded || 0
        };
        const isCourseCancel = status === 'cancelled' && ['admin_cancel', 'min_bookings_not_met', 'holiday', 'after_checkin_cancel'].includes(cancelType);
        const isUserCancel = status === 'cancelled' && !isCourseCancel;
        const isExempted = status === 'exempted' || item.is_exempted;
        const isCheckedIn = item.checked_in || status === 'checked_in' || status === 'completed';
        // 已签到（含已完成）：checked_in + completed
        if (isCheckedIn) {
          checkedInList.push(booking);
        }
        // 已预约：booked + 课程/admin取消的（不含已签到/已完成）
        if (status === 'booked' || isCourseCancel) {
          bookedList.push(booking);
        } else if (isUserCancel || isExempted) {
          // 已取消：用户自行取消 + 豁免取消
          let cancelReasonText = '';
          if (isExempted) {
            cancelReasonText = '豁免取消';
          } else {
            cancelReasonText = item.cancel_reason || '用户取消';
          }
          cancelledList.push({
            ...booking,
            cancelTime: item.cancel_time ? formatDateTime(item.cancel_time) : '',
            cancelReason: cancelReasonText
          });
        }
      });

      // 统计按人数（同一用户多次预约只算1次，取最新状态）
      const sortedAll = [...all].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      const userLatestMap = new Map();
      sortedAll.forEach(item => {
        const uid = item.user_id?._id || item.user_id || 'unknown';
        if (!userLatestMap.has(uid)) {
          userLatestMap.set(uid, item);
        }
      });
      let bookedCount = 0, checkedInCount = 0, cancelledCount = 0;
      userLatestMap.forEach(item => {
        const status = item.status;
        const cancelType = item.cancel_type;
        const isCourseCancel = status === 'cancelled' && ['admin_cancel', 'min_bookings_not_met', 'holiday', 'after_checkin_cancel'].includes(cancelType);
        const isUserCancel = status === 'cancelled' && !isCourseCancel;
        const isExempted = status === 'exempted' || item.is_exempted;
        const isCheckedIn = item.checked_in || status === 'checked_in' || status === 'completed';
        if (isCheckedIn) {
          checkedInCount++;
        }
        if (status === 'booked' || isCourseCancel) {
          bookedCount++;
        } else if (isUserCancel || isExempted) {
          cancelledCount++;
        }
      });
      // 卡片"预约人数"显示：已预约 + 已签到 = 所有实际预约人数
      const totalBookedDisplay = bookedCount + checkedInCount;

      this.setData({
        bookedList, checkedInList, cancelledList,
        bookedCount, checkedInCount, cancelledCount,
        totalBookedDisplay
      });
    } catch (err) {
      console.error('加载预约名单失败', err);
    }
  },

  onTabChange(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  async onCheckIn(e) {
    const bookingId = e.currentTarget.dataset.id;
    wx.showLoading({ title: '签到中' });
    try {
      await request({ url: `/bookings/${bookingId}/checkin`, method: 'PUT' });
      wx.showToast({ title: '签到成功', icon: 'success' });
      this.loadBookingList(this.data.panelSchedule._id);
    } catch (err) {
      wx.showToast({ title: '签到失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  async onCancelBooking(e) {
    const bookingId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认取消',
      content: '确定取消该会员的预约吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({ url: `/bookings/${bookingId}/cancel`, method: 'PUT' });
            wx.showToast({ title: '已取消', icon: 'success' });
            this.loadBookingList(this.data.panelSchedule._id);
          } catch (err) {
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  }
});
