const { request } = require('../../utils/request');
const { getBeijingDate } = require('../../utils/helpers');

Page({
  data: {
    dateGroups: [],
    loading: false,
    page: 1,
    pageSize: 20,
    hasMore: false,
    displayLimit: 5
  },

  onLoad() {
    this.loadBookings();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  onPullDownRefresh() {
    this.setData({ page: 1, dateGroups: [] });
    this.loadBookings().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadBookings() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: '/bookings',
        method: 'GET',
        data: {
          page: this.data.page,
          pageSize: this.data.pageSize
        }
      });

      const data = res.data || {};
      const list = data.list || [];
      const total = data.total || 0;

      const processedList = list.map(item => ({
        ...item,
        created_at_display: this.formatDateTime(item.created_at),
        cancel_time_display: item.cancel_time ? this.formatDateTime(item.cancel_time) : ''
      }));

      const groupedData = this.groupByDateAndSchedule(processedList);
      let dateGroups = this.data.page === 1 ? groupedData : [...this.data.dateGroups, ...groupedData];

      this.setData({
        dateGroups,
        hasMore: this.data.page * this.data.pageSize < total
      });
    } catch (err) {
      console.error('加载预约记录失败', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  groupByDateAndSchedule(list) {
    const dateMap = {};
    
    list.forEach(item => {
      const scheduleId = item.schedule_id;
      const dateStr = item.schedule_info?.date || '未知日期';
      
      if (!dateMap[dateStr]) {
        dateMap[dateStr] = {
          date: dateStr,
          dateLabel: this.formatDateLabel(dateStr),
          totalCount: 0,
          schedules: []
        };
      }
      
      let schedule = dateMap[dateStr].schedules.find(s => s.schedule_id === scheduleId);
      if (!schedule) {
        schedule = {
          schedule_id: scheduleId,
          schedule_info: item.schedule_info,
          members: [],
          bookedCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          expanded: false,
          activeTab: 'booked',
          displayCount: this.data.displayLimit,
          displayMembers: []
        };
        dateMap[dateStr].schedules.push(schedule);
      }
      
      schedule.members.push(item);
      dateMap[dateStr].totalCount++;
      
      if (item.status === 'booked') schedule.bookedCount++;
      else if (item.status === 'completed') schedule.completedCount++;
      else if (item.status === 'cancelled') schedule.cancelledCount++;
    });
    
    // 初始化每个课程的 displayMembers
    Object.values(dateMap).forEach(dateGroup => {
      dateGroup.schedules.forEach(schedule => {
        schedule.displayMembers = this.getFilteredMembers(schedule);
      });
    });
    
    const sortedDates = Object.keys(dateMap).sort((a, b) => new Date(b) - new Date(a));
    return sortedDates.map(date => {
      dateMap[date].schedules.sort((a, b) => {
        const timeA = a.schedule_info?.time || '';
        const timeB = b.schedule_info?.time || '';
        return timeA.localeCompare(timeB);
      });
      return dateMap[date];
    });
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

  async loadMore() {
    if (this.data.hasMore) {
      this.setData({ page: this.data.page + 1 });
      await this.loadBookings();
    }
  },

  onToggleCourse(e) {
    const { dateIndex, courseIndex } = e.currentTarget.dataset;
    const dateGroups = [...this.data.dateGroups];
    
    if (!dateGroups[dateIndex] || !dateGroups[dateIndex].schedules[courseIndex]) {
      return;
    }
    
    const course = dateGroups[dateIndex].schedules[courseIndex];
    course.expanded = !course.expanded;
    course.displayCount = this.data.displayLimit;
    course.displayMembers = this.getFilteredMembers(course);
    
    this.setData({ dateGroups });
  },

  onSwitchMemberTab(e) {
    const { dateIndex, courseIndex, tab } = e.currentTarget.dataset;
    const dateGroups = [...this.data.dateGroups];
    
    if (!dateGroups[dateIndex] || !dateGroups[dateIndex].schedules[courseIndex]) {
      return;
    }
    
    const course = dateGroups[dateIndex].schedules[courseIndex];
    course.activeTab = tab;
    course.displayCount = this.data.displayLimit;
    course.displayMembers = this.getFilteredMembers(course);
    
    this.setData({ dateGroups });
  },

  onLoadMoreMembers(e) {
    const { dateIndex, courseIndex } = e.currentTarget.dataset;
    const dateGroups = [...this.data.dateGroups];
    
    if (!dateGroups[dateIndex] || !dateGroups[dateIndex].schedules[courseIndex]) {
      return;
    }
    
    const course = dateGroups[dateIndex].schedules[courseIndex];
    course.displayCount += this.data.displayLimit;
    course.displayMembers = this.getFilteredMembers(course);
    
    this.setData({ dateGroups });
  },

  getFilteredMembers(course) {
    const filtered = course.members.filter(m => m.status === course.activeTab);
    return filtered.slice(0, course.displayCount);
  },

  getStatusText(status) {
    const map = {
      'booked': '已预约',
      'completed': '已上课',
      'cancelled': '已取消',
      'no_show': '未到'
    };
    return map[status] || status;
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = getBeijingDate(dateStr);
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch (e) {
      return '';
    }
  }
});
