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

    const months = [];
    const today2 = new Date();
    for (let i = -365; i <= 90; i++) {
      const date = new Date(today2);
      date.setDate(today2.getDate() + i);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${month}`;
      if (!months.find(m => m.key === monthKey)) {
        months.push({ key: monthKey, name: `${year}年${month}月`, year, month: parseInt(month) });
      }
    }

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
          bookedCount: bookingStats.booked,
          checkedInCount: bookingStats.checkedIn,
          cancelledCount: bookingStats.cancelled,
          exemptedCount: bookingStats.exempted
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
        const isCheckedIn = item.checked_in || status === 'checked_in';
        if (isCheckedIn) checkedIn++;
        if (status === 'booked' || status === 'checked_in') {
          booked++;
        } else if (status === 'exempted' || item.is_exempted) {
          exempted++;
        } else if (status === 'cancelled') {
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
    const { monthList, currentMonth } = this.data;
    const idx = monthList.findIndex(m => m.key === currentMonth);
    let newIdx = idx;
    if (direction === 'prev' && idx > 0) newIdx = idx - 1;
    if (direction === 'next' && idx < monthList.length - 1) newIdx = idx + 1;
    if (newIdx !== idx) {
      const newMonth = monthList[newIdx].key;
      this.loadMonthSchedules(newMonth);
    }
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
      this.generateMonthCalendar(todayMonthKey);
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
          bookedCount: bookingStats.booked,
          checkedInCount: bookingStats.checkedIn,
          cancelledCount: bookingStats.cancelled,
          exemptedCount: bookingStats.exempted
        };
      });

      this.setData({ dateSchedules: enrichedList });
    } catch (err) {
      console.error('加载日期课程失败', err);
    }
  },

  async onOpenBookingPanel(e) {
    const schedule = e.currentTarget.dataset.schedule;
    this.setData({
      showBookingPanel: true,
      panelSchedule: {
        ...schedule,
        course_name: schedule.course_name || schedule.dance_style_name || '课程',
        dance_style_name: schedule.dance_style_name || '',
        coach_name: schedule.coach_name || '',
        date: schedule.date || this.data.currentDate || this.data.todayDate
      },
      activeTab: 'booked',
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
          checkedIn: item.checked_in || item.status === 'checked_in'
        };
        const status = item.status;
        const isCheckedIn = item.checked_in || status === 'checked_in';
        if (isCheckedIn) {
          checkedInList.push(booking);
        }
        if (status === 'booked' || status === 'checked_in') {
          bookedList.push(booking);
        } else if (status === 'cancelled' || status === 'exempted' || item.is_exempted) {
          // 已豁免并入已取消
          let cancelReason = '';
          if (status === 'exempted' || item.is_exempted) {
            cancelReason = '豁免';
          } else if (item.cancel_type === 'after_checkin_cancel') {
            // 课程中取消：显示管理员勾选的具体原因
            const reason = item.cancel_reason || '';
            cancelReason = reason ? ('课程中因' + reason + '取消') : '课程中取消';
          } else {
            cancelReason = item.cancel_reason || '';
          }
          cancelledList.push({
            ...booking,
            cancelTime: item.cancel_time ? formatDateTime(item.cancel_time) : '',
            creditsRefunded: item.credits_refunded || 0,
            cancelReason: cancelReason
          });
        }
      });

      // 统计按人数（同一用户多次预约只算1次，取最新状态）
      // 按创建时间倒序，后出现的覆盖先出现的（最新状态优先）
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
        const isCheckedIn = item.checked_in || status === 'checked_in';
        if (isCheckedIn) {
          checkedInCount++;
        }
        if (status === 'booked' || status === 'checked_in') {
          bookedCount++;
        } else if (status === 'cancelled' || status === 'exempted' || item.is_exempted) {
          cancelledCount++;
        }
      });

      this.setData({
        bookedList, checkedInList, cancelledList,
        bookedCount, checkedInCount, cancelledCount
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
