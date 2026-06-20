const app = getApp();
const { request } = require('../../../utils/request');
const { getScheduleStatusText } = require('../../../utils/util');

Page({
  data: {
    scheduleId: '',
    scheduleInfo: null,
    viewMode: 'bookings',
    activeTab: 'booked',
    // 已预约名单
    bookedList: [],
    // 已签到名单
    completedList: [],
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
      // 始终加载签到数据（预约视图也需要显示已签到Tab）
      this.loadAttendanceList();
      if (options.view_mode === 'attendance') {
        this.setData({ activeTab: 'all' });
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
      // 直接信任后端返回的 status 字段，前端不再推导状态
      const scheduleInfo = res.data;
      if (scheduleInfo) {
        scheduleInfo.statusText = getScheduleStatusText(scheduleInfo.status);
      }
      this.setData({ scheduleInfo });
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
      const completedList = [];
      const cancelledList = [];
      const exemptedList = [];
      
      allBookings.forEach(item => {
        const realName = item.user_id?.real_name;
        const nickName = item.user_id?.nick_name;
        const displayName = realName || nickName || '未知用户';
        const nickNameDisplay = realName && nickName && nickName !== realName ? nickName : '';
        const booking = {
          _id: item._id,
          userName: displayName,
          userNickName: nickNameDisplay,
          userPhone: item.user_id?.phone || '',
          userAvatar: item.user_id?.avatar_url || '',
          bookingTime: item.created_at,
          creditsDeducted: item.credits_deducted || 0,
          remark: item.remark || '',
          checkInTime: item.check_in_time,
          checkedIn: item.checked_in || false
        };
        
        // 根据状态分类（没有缺勤业务，所有未签到的都自动签到）
        const status = item.status;
        if (status === 'booked') {
          bookedList.push(booking);
        } else if (status === 'completed') {
          completedList.push(booking);
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
        completedList,
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
        url: `/attendance/schedule/${this.data.scheduleId}`,
        method: 'GET'
      });
      
      // 后端返回 { total, checkedIn, booked, cancelled, records: [...] }
      const records = (res.data && res.data.records) || [];
      
      const processedList = records.map(item => {
        const realName = item.user_id?.real_name;
        const nickName = item.user_id?.nick_name;
        const displayName = realName || nickName || '未知用户';
        const nickNameDisplay = realName && nickName && nickName !== realName ? nickName : '';
        const att = item.attendance;
        let method = 'scan';
        if (att) {
          if (att.source === 'booking') method = 'auto';
          else if (att.check_in_method) method = att.check_in_method;
          else method = 'scan';
        } else if (item.check_in_method) {
          method = item.check_in_method;
        }
        return {
          _id: item.booking_id || item._id,
          userName: displayName,
          userNickName: nickNameDisplay,
          userPhone: item.user_id?.phone || '',
          userAvatar: item.user_id?.avatar_url || '',
          checkInTime: att ? att.check_in_time : (item.check_in_time || ''),
          checkInMethod: method,
          checkInMethodText: this.getCheckInMethodText(method),
          source: item.source,
          creditsCost: att ? att.credits_cost : (item.credits_deducted || 0),
          status: item.status,
          checkedIn: item.checked_in
        };
      });
      
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
    wx.showActionSheet({
      itemList: ['不足开课人数', '恶劣天气', '教练突发状况', '放假', '其他'],
      success: (res) => {
        const reasons = ['不足开课人数', '恶劣天气', '教练突发状况', '放假', '其他'];
        const reason = reasons[res.tapIndex];
        wx.showModal({
          title: '确认取消',
          content: `确认以「${reason}」为由取消此预约？将退还会员次数。`,
          success: async (modalRes) => {
            if (modalRes.confirm) {
              try {
                await request({
                  url: `/bookings/${id}/admin-cancel`,
                  method: 'PUT',
                  data: { reason }
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
      fail: () => {}
    });
  },

  // 返回排课页面
  onBack() {
    wx.navigateBack();
  }
});
