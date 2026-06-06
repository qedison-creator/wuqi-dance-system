const { request } = require('../../utils/request');
const { getBeijingDate } = require('../../utils/helpers');
const config = require('../../config/index.js');

function getDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayStr() {
  return getDateStr(getBeijingDate());
}

Page({
  data: {
    yearGroups: [],
    loading: false,
    storeList: [],
    activeStoreId: '',
    // 日期筛选
    dateFilter: 'today', // today | yesterday | week | month | custom
    customDate: '',
    customDateText: '选日期',
    startDate: '',
    endDate: '',
    // 汇总数据
    summary: { totalCourses: 0, totalBookings: 0, checkedIn: 0, cancelled: 0 },
    // 展开的会员卡片
    expandedMembers: {}
  },

  onLoad() {
    this.initDates();
    this.loadStores();
  },

  onShow() {
    this.loadBookings();
  },

  onPullDownRefresh() {
    this.loadBookings().finally(() => wx.stopPullDownRefresh());
  },

  initDates() {
    const today = getBeijingDate();
    const todayStr = getDateStr(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateStr(yesterday);

    // 本周一
    const weekStart = new Date(today);
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    weekStart.setDate(today.getDate() - diff);
    const weekStartStr = getDateStr(weekStart);

    // 本月1号
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartStr = getDateStr(monthStart);

    this.setData({
      startDate: todayStr,
      endDate: todayStr,
      _todayStr: todayStr,
      _yesterdayStr: yesterdayStr,
      _weekStartStr: weekStartStr,
      _monthStartStr: monthStartStr
    });
  },

  async loadStores() {
    try {
      const res = await request({ url: '/stores', method: 'GET' });
      const list = res.data && res.data.list ? res.data.list : (Array.isArray(res.data) ? res.data : []);
      const storeList = [{ _id: '', name: '全部' }].concat(list);
      this.setData({ storeList });
    } catch (err) {
      console.error('加载门店失败', err);
      this.setData({ storeList: [{ _id: '', name: '全部' }] });
    }
  },

  // ========== 门店筛选 ==========
  onStoreFilter(e) {
    const storeId = e.currentTarget.dataset.id;
    this.setData({ activeStoreId: storeId, yearGroups: [] });
    this.loadBookings();
  },

  // ========== 日期筛选 ==========
  onDateFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    const today = getBeijingDate();
    const todayStr = this.data._todayStr;
    const yesterdayStr = this.data._yesterdayStr;
    const weekStartStr = this.data._weekStartStr;
    const monthStartStr = this.data._monthStartStr;

    let startDate = todayStr;
    let endDate = todayStr;

    switch (filter) {
      case 'today':
        startDate = todayStr;
        endDate = todayStr;
        break;
      case 'yesterday':
        startDate = yesterdayStr;
        endDate = yesterdayStr;
        break;
      case 'week':
        startDate = weekStartStr;
        endDate = todayStr;
        break;
      case 'month':
        startDate = monthStartStr;
        endDate = todayStr;
        break;
      case 'custom':
        // 触发日期选择器
        this.setData({ dateFilter: 'custom' });
        return;
    }

    this.setData({ dateFilter: filter, startDate, endDate, yearGroups: [] });
    this.loadBookings();
  },

  onDateChange(e) {
    const dateStr = e.detail.value;
    const parts = dateStr.split('-');
    const label = `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
    this.setData({
      customDate: dateStr,
      customDateText: label,
      startDate: dateStr,
      endDate: dateStr,
      yearGroups: []
    });
    this.loadBookings();
  },

  // ========== 加载预约数据 ==========
  async loadBookings() {
    this.setData({ loading: true });
    try {
      const reqData = {};
      if (this.data.activeStoreId) reqData.store_id = this.data.activeStoreId;
      if (this.data.startDate) reqData.start_date = this.data.startDate;
      if (this.data.endDate) reqData.end_date = this.data.endDate;

      const res = await request({ url: '/bookings', method: 'GET', data: reqData });
      const data = res.data || {};
      const list = data.list || [];

      const processedList = list.map(item => this.processBookingItem(item));
      const yearGroups = this.groupByYearMonthDate(processedList);
      const summary = this.calcSummary(yearGroups);

      this.setData({ yearGroups, summary });
    } catch (err) {
      console.error('加载预约记录失败', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  processBookingItem(item) {
    const scheduleObj = item.schedule_id && typeof item.schedule_id === 'object' ? item.schedule_id : {};
    const scheduleId = scheduleObj._id || item.schedule_id || '';
    const storeObj = scheduleObj.store_id && typeof scheduleObj.store_id === 'object' ? scheduleObj.store_id : null;
    const userObj = item.user_id && typeof item.user_id === 'object' ? item.user_id : {};
    const userId = userObj._id || item.user_id || '';

    return {
      ...item,
      schedule_id: scheduleId,
      user_id_str: userId,
      store_id: storeObj ? storeObj._id : (item.store_id || ''),
      schedule_info: {
        _id: scheduleId,
        date: scheduleObj.date || item.booking_date || '未知日期',
        start_time: scheduleObj.start_time || item.booking_time || '',
        end_time: scheduleObj.end_time || '',
        course_name: scheduleObj.course_name || scheduleObj.name || '未知课程',
        coach_name: scheduleObj.coach_id && typeof scheduleObj.coach_id === 'object' ? scheduleObj.coach_id.name : '',
        store_name: storeObj ? storeObj.name : '',
        max_bookings: scheduleObj.max_bookings || 0
      },
      user_info: {
        _id: userId,
        nick_name: userObj.nick_name || userObj.name || '未知会员',
        real_name: userObj.real_name || '',
        phone: userObj.phone || '',
        avatar_url: userObj.avatar_url || ''
      },
      created_at_display: this.formatDateTime(item.created_at),
      cancel_time_display: item.cancel_time ? this.formatDateTime(item.cancel_time) : '',
      cancel_type_text: this.getCancelTypeText(item.cancel_type),
      credits_deducted: item.credits_deducted || 0,
      credits_refunded: item.credits_refunded || 0
    };
  },

  getCancelTypeText(cancelType) {
    if (!cancelType) return '已取消';
    const map = {
      'normal': '会员主动取消',
      'timeout': '超时取消',
      'exempt': '豁免取消',
      'admin_cancel': '管理员取消',
      'min_bookings_not_met': '系统取消-人数不足',
      'class_cancelled': '系统取消-人数不足',
      'holiday': '系统取消-门店放假'
    };
    return map[cancelType] || cancelType;
  },

  getWeekday(dateStr) {
    if (!dateStr || dateStr === '未知日期') return '';
    try {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const d = getBeijingDate(dateStr);
      return weekdays[d.getDay()];
    } catch (e) { return ''; }
  },

  groupByYearMonthDate(list) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const yearMap = {};

    list.forEach(item => {
      const dateStr = item.schedule_info.date || '未知日期';
      const parts = dateStr.split('-');
      const year = parts[0] || '未知';
      const month = (parts.length >= 2 && !isNaN(parseInt(parts[1], 10))) ? parseInt(parts[1], 10) : 0;
      const yearKey = year;
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      if (!yearMap[yearKey]) {
        yearMap[yearKey] = {
          year: yearKey,
          yearLabel: yearKey === '未知' ? '未知年份' : `${yearKey}年`,
          months: [],
          totalCount: 0
        };
      }

      let monthGroup = yearMap[yearKey].months.find(m => m.monthKey === monthKey);
      if (!monthGroup) {
        monthGroup = {
          monthKey: monthKey,
          month: month,
          monthLabel: month === 0 ? '未知月份' : `${month}月`,
          expanded: (parseInt(yearKey) === currentYear && month === currentMonth),
          dates: [],
          totalCount: 0
        };
        yearMap[yearKey].months.push(monthGroup);
      }

      let dateGroup = monthGroup.dates.find(d => d.date === dateStr);
      if (!dateGroup) {
        dateGroup = {
          date: dateStr,
          dateLabel: this.formatDateLabel(dateStr),
          weekday: this.getWeekday(dateStr),
          totalCount: 0,
          schedules: []
        };
        monthGroup.dates.push(dateGroup);
      }

      const scheduleId = item.schedule_id;
      let schedule = dateGroup.schedules.find(s => s.schedule_id === scheduleId);
      if (!schedule) {
        schedule = {
          schedule_id: scheduleId,
          schedule_info: item.schedule_info,
          memberGroups: [],
          expanded: false,
          // 三区块计数
          completedCount: 0,
          cancelledCount: 0,
          bookedCount: 0
        };
        dateGroup.schedules.push(schedule);
      }

      const userId = item.user_id_str;
      let memberGroup = schedule.memberGroups.find(mg => mg.user_id === userId);
      if (!memberGroup) {
        memberGroup = {
          user_id: userId,
          user_info: item.user_info,
          records: [],
          latestStatus: item.status,
          latestTime: item.created_at,
          // 折叠状态
          _expanded: false,
          // 取消类型（取最新一条取消记录的cancel_type）
          _cancelType: null,
          _cancelTypeText: ''
        };
        schedule.memberGroups.push(memberGroup);
      }

      memberGroup.records.push({
        _id: item._id,
        status: item.status,
        created_at: item.created_at,
        created_at_display: item.created_at_display,
        cancel_time: item.cancel_time,
        cancel_time_display: item.cancel_time_display,
        cancel_type: item.cancel_type,
        cancel_type_text: item.cancel_type_text,
        cancel_reason: item.cancel_reason || '',
        credits_deducted: item.credits_deducted,
        credits_refunded: item.credits_refunded
      });

      // 更新最新状态
      if (new Date(item.created_at) > new Date(memberGroup.latestTime)) {
        memberGroup.latestStatus = item.status;
        memberGroup.latestTime = item.created_at;
        if (item.status === 'cancelled') {
          memberGroup._cancelType = item.cancel_type;
          memberGroup._cancelTypeText = item.cancel_type_text;
        }
      }

      dateGroup.totalCount++;
      monthGroup.totalCount++;
      yearMap[yearKey].totalCount++;
    });

    // 排序各层级
    Object.values(yearMap).forEach(yg => {
      yg.months.forEach(mg => {
        mg.dates.forEach(dg => {
          dg.schedules.forEach(schedule => {
            schedule.memberGroups.forEach(mg => {
              mg.records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              // 计算统计
              const totalRecords = mg.records.length;
              const cancelCount = mg.records.filter(r => r.status === 'cancelled').length;
              mg._totalBookings = totalRecords;
              mg._cancelCount = cancelCount;
              mg._hasRepeat = totalRecords > 1;
              mg._expanded = false;
            });
            // 分类计数
            schedule.completedCount = schedule.memberGroups.filter(mg => mg.latestStatus === 'completed').length;
            schedule.cancelledCount = schedule.memberGroups.filter(mg => mg.latestStatus === 'cancelled').length;
            schedule.bookedCount = schedule.memberGroups.filter(mg => mg.latestStatus === 'booked').length;
            // 排序：completed > cancelled > booked
            schedule._sortedMemberGroups = [
              ...schedule.memberGroups.filter(mg => mg.latestStatus === 'completed'),
              ...schedule.memberGroups.filter(mg => mg.latestStatus === 'cancelled'),
              ...schedule.memberGroups.filter(mg => mg.latestStatus === 'booked')
            ];
          });
          dg.schedules.sort((a, b) => {
            const timeA = a.schedule_info.start_time || '';
            const timeB = b.schedule_info.start_time || '';
            return timeA.localeCompare(timeB);
          });
        });
        mg.dates.sort((a, b) => new Date(b.date) - new Date(a.date));
      });
      yg.months.sort((a, b) => b.month - a.month);
    });

    const sortedYears = Object.keys(yearMap).sort((a, b) => parseInt(b) - parseInt(a));
    return sortedYears.map(y => yearMap[y]);
  },

  calcSummary(yearGroups) {
    let totalCourses = 0;
    let totalBookings = 0;
    let checkedIn = 0;
    let cancelled = 0;

    yearGroups.forEach(yg => {
      yg.months.forEach(mg => {
        mg.dates.forEach(dg => {
          dg.schedules.forEach(schedule => {
            totalCourses++;
            schedule.memberGroups.forEach(mg => {
              totalBookings += mg.records.length;
              if (mg.latestStatus === 'completed') checkedIn++;
              else if (mg.latestStatus === 'cancelled') cancelled++;
            });
          });
        });
      });
    });

    return { totalCourses, totalBookings, checkedIn, cancelled };
  },

  formatDateLabel(dateStr) {
    if (!dateStr || dateStr === '未知日期') return '未知日期';
    try {
      const today = getBeijingDate();
      const todayStr = getDateStr(today);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getDateStr(yesterday);

      if (dateStr === todayStr) return '今天';
      if (dateStr === yesterdayStr) return '昨天';

      const parts = dateStr.split('-');
      if (parts.length >= 3) {
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (!isNaN(month) && !isNaN(day)) return `${month}月${day}日`;
      }
      return dateStr;
    } catch (e) { return dateStr; }
  },

  // ========== 折叠展开 ==========
  onToggleMonth(e) {
    const { yearIndex, monthIndex } = e.currentTarget.dataset;
    const yearGroups = [...this.data.yearGroups];
    if (!yearGroups[yearIndex] || !yearGroups[yearIndex].months[monthIndex]) return;
    yearGroups[yearIndex].months[monthIndex].expanded = !yearGroups[yearIndex].months[monthIndex].expanded;
    this.setData({ yearGroups });
  },

  onToggleCourse(e) {
    const { yearIndex, monthIndex, dateIndex, courseIndex } = e.currentTarget.dataset;
    const yearGroups = [...this.data.yearGroups];
    const month = yearGroups[yearIndex] && yearGroups[yearIndex].months[monthIndex];
    const date = month && month.dates[dateIndex];
    const course = date && date.schedules[courseIndex];
    if (!course) return;
    course.expanded = !course.expanded;
    this.setData({ yearGroups });
  },

  onToggleMember(e) {
    const { yearIndex, monthIndex, dateIndex, courseIndex, userId } = e.currentTarget.dataset;
    const yearGroups = [...this.data.yearGroups];
    const month = yearGroups[yearIndex] && yearGroups[yearIndex].months[monthIndex];
    const date = month && month.dates[dateIndex];
    const course = date && date.schedules[courseIndex];
    if (!course) return;
    const memberGroup = course.memberGroups.find(mg => mg.user_id === userId);
    if (memberGroup) {
      memberGroup._expanded = !memberGroup._expanded;
    }
    this.setData({ yearGroups });
  },

  isMemberExpanded(yearIndex, monthIndex, dateIndex, courseIndex, userId) {
    const key = `${yearIndex}_${monthIndex}_${dateIndex}_${courseIndex}_${userId}`;
    return !!this.data.expandedMembers[key];
  },

  // ========== 签到 ==========
  async onCheckIn(e) {
    const { scheduleId, userId } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认签到',
      content: '确定为该会员签到？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({
            url: '/bookings/check-in',
            method: 'POST',
            data: { schedule_id: scheduleId, user_id: userId }
          });
          wx.showToast({ title: '签到成功', icon: 'success' });
          this.loadBookings();
        } catch (err) {
          wx.showToast({ title: '签到失败', icon: 'none' });
        }
      }
    });
  },

  // ========== 导出 ==========
  async onExport(e) {
    const { scheduleId } = e.currentTarget.dataset;
    try {
      wx.showLoading({ title: '导出中...' });
      const app = getApp();
      const token = wx.getStorageSync('admin_token') || (app.globalData && app.globalData.token) || '';
      const baseUrl = (app.globalData && app.globalData.baseUrl) || config.baseUrl;

      const storeId = this.data.activeStoreId;
      const params = [];
      if (storeId) params.push(`store_id=${storeId}`);
      if (this.data.startDate) params.push(`start_date=${this.data.startDate}`);
      if (this.data.endDate) params.push(`end_date=${this.data.endDate}`);

      const url = `${baseUrl}/bookings/export?${params.join('&')}`;

      wx.request({
        url,
        header: { 'Authorization': token ? `Bearer ${token}` : '' },
        responseType: 'text',
        success: (res) => {
          wx.hideLoading();
          if (res.statusCode === 200 && res.data) {
            const csvContent = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            const timestamp = Date.now();
            const fs = wx.getFileSystemManager();
            // 使用 .xls 扩展名，因为 wx.openDocument 不支持 csv 格式
            const filePath = `${wx.env.USER_DATA_PATH}/bookings_${timestamp}.xls`;
            fs.writeFile({
              filePath,
              data: csvContent,
              encoding: 'utf8',
              success: () => {
                wx.openDocument({
                  filePath,
                  fileType: 'xls',
                  showMenu: true,
                  success: () => {
                    wx.showToast({ title: '导出成功', icon: 'success' });
                  },
                  fail: (err) => {
                    console.error('openDocument失败', err);
                    wx.showModal({
                      title: '导出完成',
                      content: '文件已保存，可在微信文件中查看',
                      showCancel: false
                    });
                  }
                });
              },
              fail: () => {
                wx.showToast({ title: '保存失败', icon: 'none' });
              }
            });
          } else {
            wx.showToast({ title: '导出失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '导出失败', icon: 'none' });
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = getBeijingDate(dateStr);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    } catch (e) { return ''; }
  }
});