const app = getApp();
const { request } = require('../../utils/request');

Page({
  data: {
    scheduleId: '',
    scheduleInfo: null,
    viewMode: 'bookings',
    activeTab: 'booked',
    // 已预约名单
    bookedList: [],
    // 已取消名单
    cancelledList: [],
    // 已豁免名单（如有）
    exemptedList: [],
    // 上课记录
    attendanceList: []
  },

  onLoad(options) {
    if (options.schedule_id) {
      this.setData({ 
        scheduleId: options.schedule_id,
        viewMode: options.view_mode || 'bookings'
      });
      this.loadScheduleInfo();
      if (options.view_mode === 'attendance') {
        this.setData({ activeTab: 'all' });
        this.loadAttendanceList();
      } else {
        this.loadBookingList();
      }
    }
  },

  onShow() {
    if (!app.checkAuth()) return;
    if (this.data.scheduleId) {
      this.loadBookingList();
    }
  },

  // 加载排课信息
  async loadScheduleInfo() {
    try {
      const res = await request({
        url: `/schedules/${this.data.scheduleId}`,
        method: 'GET'
      });
      this.setData({ scheduleInfo: res.data });
    } catch (err) {
      console.error('加载排课信息失败', err);
    }
  },

  // 加载预约名单（三类）
  async loadBookingList() {
    try {
      const res = await request({
        url: `/schedules/${this.data.scheduleId}/bookings`,
        method: 'GET'
      });
      
      const allBookings = res.data || [];
      
      // 分类处理
      const bookedList = [];
      const cancelledList = [];
      const exemptedList = [];
      
      allBookings.forEach(item => {
        const booking = {
          _id: item._id,
          userName: item.user_id?.nick_name || '未知用户',
          userPhone: item.user_id?.phone || '',
          userAvatar: item.user_id?.avatar_url || '',
          bookingTime: item.created_at,
          creditsDeducted: item.credits_deducted || 0,
          remark: item.remark || ''
        };
        
        // 根据状态分类
        const status = item.status || item.booking_status;
        if (status === 'booked') {
          bookedList.push(booking);
        } else if (status === 'cancelled') {
          cancelledList.push({
            ...booking,
            cancelTime: item.cancel_time,
            cancelReason: item.cancel_reason || '',
            creditsRefunded: item.credits_refunded || 0
          });
        } else if (status === 'exempted' || item.is_exempted) {
          exemptedList.push(booking);
        }
      });
      
      this.setData({
        bookedList,
        cancelledList,
        exemptedList
      });
    } catch (err) {
      console.error('加载预约名单失败', err);
    }
  },

  // 加载上课记录
  async loadAttendanceList() {
    try {
      const res = await request({
        url: '/attendance',
        method: 'GET',
        data: { schedule_id: this.data.scheduleId }
      });
      
      const list = res.data && Array.isArray(res.data.list) ? res.data.list : [];
      
      const processedList = list.map(item => ({
        _id: item._id,
        userName: item.user_id?.nick_name || '未知用户',
        userPhone: item.user_id?.phone || '',
        userAvatar: item.user_id?.avatar_url || '',
        checkInTime: item.check_in_time,
        checkInMethod: item.check_in_method || 'scan',
        checkInMethodText: this.getCheckInMethodText(item.check_in_method),
        source: item.source,
        creditsCost: item.credits_cost || 0
      }));
      
      this.setData({ attendanceList: processedList });
    } catch (err) {
      console.error('加载上课记录失败', err);
    }
  },

  getCheckInMethodText(method) {
    const map = {
      'scan': '扫码签到',
      'auto': '自动签到',
      'exempt_cancel': '未上课(豁免取消)'
    };
    return map[method] || '扫码签到';
  },

  // 切换Tab
  onTabChange(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab });
  },

  // 管理员手动取消预约
  async onCancelBooking(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认取消',
      content: '确认手动取消此预约？将退还会员次数。',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/bookings/${id}/admin-cancel`,
              method: 'PUT',
              data: { reason: '管理员手动取消' }
            });
            wx.showToast({ title: '已取消', icon: 'success' });
            this.loadBookingList();
          } catch (err) {
            console.error('取消预约失败', err);
          }
        }
      }
    });
  },

  // 返回排课页面
  onBack() {
    wx.navigateBack();
  }
});
