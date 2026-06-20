const { request } = require('../../../../utils/request');
const { getBeijingDate } = require('../../../../utils/helpers');

Page({
  data: {
    memberId: '',
    memberName: '',
    bookings: [],
    filteredBookings: [],
    statusFilter: '', // '' 全部 | 'booked' 已预约 | 'completed' 已完成 | 'cancelled' 已取消
    loading: false
  },

  onLoad(options) {
    const { memberId, memberName } = options;
    this.setData({ 
      memberId: memberId || '', 
      memberName: decodeURIComponent(memberName || '会员') 
    });
    
    // 设置标题
    wx.setNavigationBarTitle({
      title: `${this.data.memberName}的预约记录`
    });
    
    this.loadBookings();
  },

  /**
   * 加载预约记录
   */
  async loadBookings() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: `/members/${this.data.memberId}`,
        method: 'GET'
      });
      
      const data = res.data || {};
      const bookings = (data.bookings || []).map(booking => {
        // 格式化创建时间
        if (booking.created_at) {
          booking.created_at_display = this.formatDateTime(booking.created_at);
        }
        // 计算课程星期
        const date = booking.schedule_id ? booking.schedule_id.date : booking.booking_date;
        if (date) {
          booking._weekday = this.getWeekDay(date);
        }
        return booking;
      }).sort((a, b) => {
        // 按时间倒序排列
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      
      this.setData({ 
        bookings: bookings,
        filteredBookings: bookings // 初始化显示全部
      });
    } catch (err) {
      console.error('加载预约记录失败', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 筛选变更
   */
  onFilterChange(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ statusFilter: status });
    this.applyFilter();
  },

  /**
   * 应用筛选
   */
  applyFilter() {
    const { bookings, statusFilter } = this.data;
    if (!statusFilter) {
      this.setData({ filteredBookings: bookings });
    } else {
      this.setData({
        filteredBookings: bookings.filter(b => b.status === statusFilter)
      });
    }
  },

  /**
   * 获取星期几（北京时间）
   */
  getWeekDay(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(dateStr);
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    return `周${weekDays[d.getDay()]}`;
  },

  /**
   * 格式化日期时间为 YYYY-MM-DD HH:mm（北京时间）
   */
  formatDateTime(dateStr) {
    if (!dateStr) return '';
    const d = getBeijingDate(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.loadBookings().then(() => {
      wx.stopPullDownRefresh();
    }).catch(() => {
      wx.stopPullDownRefresh();
    });
  }
});
