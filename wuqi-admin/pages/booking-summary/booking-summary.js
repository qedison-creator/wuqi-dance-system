const { request } = require('../../utils/request');
const { getBeijingDate } = require('../../utils/helpers');

Page({
  data: {
    yearGroups: [],
    loading: false,
    page: 1,
    pageSize: 20,
    hasMore: false,
    displayLimit: 5,
    storeList: [],
    activeStoreId: ''
  },

  onLoad() {
    this.loadStores();
    this.loadBookings();
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

  onPullDownRefresh() {
    this.setData({ page: 1, yearGroups: [] });
    this.loadBookings().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onStoreFilter(e) {
    const storeId = e.currentTarget.dataset.id;
    this.setData({
      activeStoreId: storeId,
      page: 1,
      yearGroups: []
    });
    this.loadBookings();
  },

  async loadBookings() {
    this.setData({ loading: true });
    try {
      const reqData = {
        page: this.data.page,
        pageSize: this.data.pageSize
      };
      if (this.data.activeStoreId) {
        reqData.store_id = this.data.activeStoreId;
      }

      const res = await request({
        url: '/bookings',
        method: 'GET',
        data: reqData
      });

      const data = res.data || {};
      const list = data.list || [];
      const total = data.total || 0;

      const processedList = list.map(item => this.processBookingItem(item));

      const filteredList = this.data.activeStoreId
        ? processedList.filter(item => item.store_id === this.data.activeStoreId)
        : processedList;

      const newYearGroups = this.groupByYearMonthDate(filteredList);
      let yearGroups = this.mergeYearGroups(this.data.yearGroups, newYearGroups);

      this.setData({
        yearGroups,
        hasMore: this.data.page * this.data.pageSize < total
      });
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
        time: scheduleObj.start_time || item.booking_time || '',
        course_name: scheduleObj.course_name || scheduleObj.name || '未知课程',
        coach_name: scheduleObj.coach_id && typeof scheduleObj.coach_id === 'object' ? scheduleObj.coach_id.name : '',
        store_name: storeObj ? storeObj.name : ''
      },
      user_info: {
        _id: userId,
        nick_name: userObj.nick_name || userObj.name || '未知会员',
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
    if (!cancelType) return '';
    const map = {
      'normal': '正常取消',
      'timeout': '超时取消',
      'exempt': '豁免取消',
      'admin_cancel': '管理员取消',
      'min_bookings_not_met': '人数不足取消',
      'holiday': '节假日取消'
    };
    return map[cancelType] || cancelType;
  },

  getWeekday(dateStr) {
    if (!dateStr || dateStr === '未知日期') return '';
    try {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const d = getBeijingDate(dateStr);
      return weekdays[d.getDay()];
    } catch (e) {
      return '';
    }
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
          bookedCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          expanded: false,
          activeTab: 'booked',
          displayCount: this.data.displayLimit,
          displayMemberGroups: []
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
          latestTime: item.created_at
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

      if (new Date(item.created_at) > new Date(memberGroup.latestTime)) {
        memberGroup.latestStatus = item.status;
        memberGroup.latestTime = item.created_at;
      }

      if (item.status === 'booked') schedule.bookedCount++;
      else if (item.status === 'completed') schedule.completedCount++;
      else if (item.status === 'cancelled') schedule.cancelledCount++;

      dateGroup.totalCount++;
      monthGroup.totalCount++;
      yearMap[yearKey].totalCount++;
    });

    Object.values(yearMap).forEach(yg => {
      yg.months.forEach(mg => {
        mg.dates.forEach(dg => {
          dg.schedules.forEach(schedule => {
            schedule.memberGroups.forEach(mg => {
              mg.records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            });
            schedule.displayMemberGroups = this.getFilteredMemberGroups(schedule);
          });
          dg.schedules.sort((a, b) => {
            const timeA = a.schedule_info.time || a.schedule_info.start_time || '';
            const timeB = b.schedule_info.time || b.schedule_info.start_time || '';
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

  mergeYearGroups(existing, newData) {
    if (existing.length === 0) return newData;

    const result = [...existing];
    newData.forEach(newYear => {
      let existYear = result.find(y => y.year === newYear.year);
      if (!existYear) {
        result.push(newYear);
        return;
      }
      newYear.months.forEach(newMonth => {
        let existMonth = existYear.months.find(m => m.monthKey === newMonth.monthKey);
        if (!existMonth) {
          existYear.months.push(newMonth);
          return;
        }
        newMonth.dates.forEach(newDate => {
          let existDate = existMonth.dates.find(d => d.date === newDate.date);
          if (!existDate) {
            existMonth.dates.push(newDate);
            return;
          }
          newDate.schedules.forEach(newSchedule => {
            let existSchedule = existDate.schedules.find(s => s.schedule_id === newSchedule.schedule_id);
            if (!existSchedule) {
              existDate.schedules.push(newSchedule);
            }
          });
        });
        existMonth.dates.sort((a, b) => new Date(b.date) - new Date(a.date));
        existMonth.totalCount = existMonth.dates.reduce((sum, d) => sum + d.totalCount, 0);
      });
      existYear.months.sort((a, b) => b.month - a.month);
      existYear.totalCount = existYear.months.reduce((sum, m) => sum + m.totalCount, 0);
    });

    result.sort((a, b) => parseInt(b.year) - parseInt(a.year));
    return result;
  },

  formatDateLabel(dateStr) {
    if (!dateStr || dateStr === '未知日期') return '未知日期';
    
    try {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      
      if (dateStr === todayStr) return '今天';
      if (dateStr === yesterdayStr) return '昨天';
      
      const parts = dateStr.split('-');
      if (parts.length >= 3) {
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (!isNaN(month) && !isNaN(day)) {
          return `${month}月${day}日`;
        }
      }
      return dateStr;
    } catch (e) {
      return dateStr;
    }
  },

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
    course.displayCount = this.data.displayLimit;
    course.displayMemberGroups = this.getFilteredMemberGroups(course);
    
    this.setData({ yearGroups });
  },

  onSwitchMemberTab(e) {
    const { yearIndex, monthIndex, dateIndex, courseIndex, tab } = e.currentTarget.dataset;
    const yearGroups = [...this.data.yearGroups];
    
    const month = yearGroups[yearIndex] && yearGroups[yearIndex].months[monthIndex];
    const date = month && month.dates[dateIndex];
    const course = date && date.schedules[courseIndex];
    if (!course) return;
    
    course.activeTab = tab;
    course.displayCount = this.data.displayLimit;
    course.displayMemberGroups = this.getFilteredMemberGroups(course);
    
    this.setData({ yearGroups });
  },

  onLoadMoreMembers(e) {
    const { yearIndex, monthIndex, dateIndex, courseIndex } = e.currentTarget.dataset;
    const yearGroups = [...this.data.yearGroups];
    
    const month = yearGroups[yearIndex] && yearGroups[yearIndex].months[monthIndex];
    const date = month && month.dates[dateIndex];
    const course = date && date.schedules[courseIndex];
    if (!course) return;
    
    course.displayCount += this.data.displayLimit;
    course.displayMemberGroups = this.getFilteredMemberGroups(course);
    
    this.setData({ yearGroups });
  },

  async loadMore() {
    if (this.data.hasMore) {
      this.setData({ page: this.data.page + 1 });
      await this.loadBookings();
    }
  },

  getFilteredMemberGroups(schedule) {
    const tab = schedule.activeTab;
    const filtered = schedule.memberGroups.filter(mg => {
      if (tab === 'booked') return mg.latestStatus === 'booked';
      if (tab === 'completed') return mg.latestStatus === 'completed';
      if (tab === 'cancelled') return mg.latestStatus === 'cancelled';
      return true;
    });
    return filtered.slice(0, schedule.displayCount);
  },

  getStatusText(status) {
    const map = {
      'booked': '已预约',
      'completed': '已上课',
      'cancelled': '已取消'
    };
    return map[status] || status;
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
    } catch (e) {
      return '';
    }
  }
});
