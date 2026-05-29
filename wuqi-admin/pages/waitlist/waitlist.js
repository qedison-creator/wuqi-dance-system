const app = getApp();
const { request } = require('../../utils/request');
const { formatDate, getWeekDay } = require('../../utils/util');

Page({
  data: {
    waitlistList: [],
    totalWaitlistCount: 0,
    currentSchedule: null,
    scheduleWaitlist: [],
    loading: true,
    showScheduleModal: false,
    page: 1,
    pageSize: 20,
    statusSummary: { waiting: 0, notified: 0, confirmed: 0, cancelled: 0 },
    exportLoading: false
  },

  onShow() {
    if (!app.checkAuth()) return;
    this.setData({ loading: true });
    this.loadWaitlistSummary();
  },

  async loadWaitlistSummary() {
    try {
      const res = await request({
        url: '/bookings/waitlist/summary',
        method: 'GET',
        data: {
          store_id: app.globalData.currentStore ? app.globalData.currentStore._id : ''
        }
      });
      const list = res.data || [];
      let total = 0;
      for (let i = 0; i < list.length; i++) {
        total += (list[i].waitlist_count || 0);
      }
      this.setData({ 
        waitlistList: list,
        totalWaitlistCount: total,
        loading: false 
      });
    } catch (err) {
      console.error('加载候补列表失败', err);
      this.setData({ loading: false });
    }
  },

  async loadScheduleWaitlist(scheduleId) {
    try {
      const res = await request({
        url: `/bookings/${scheduleId}/waitlist`,
        method: 'GET'
      });
      const list = res.data || [];
      const summary = { waiting: 0, notified: 0, confirmed: 0, cancelled: 0 };
      list.forEach(item => {
        if (summary[item.status] !== undefined) {
          summary[item.status]++;
        }
      });
      return { list, summary };
    } catch (err) {
      console.error('加载排课候补失败', err);
      return { list: [], summary: { waiting: 0, notified: 0, confirmed: 0, cancelled: 0 } };
    }
  },

  onViewScheduleWaitlist(e) {
    const schedule = e.currentTarget.dataset.item;
    this.setData({ showScheduleModal: true, currentSchedule: schedule });
    this.loadScheduleWaitlist(schedule._id).then(({ list, summary }) => {
      this.setData({ scheduleWaitlist: list, statusSummary: summary });
    });
  },

  onCloseModal() {
    this.setData({ showScheduleModal: false, currentSchedule: null, scheduleWaitlist: [], statusSummary: { waiting: 0, notified: 0, confirmed: 0, cancelled: 0 } });
  },

  onExportWaitlist() {
    const { scheduleWaitlist, currentSchedule } = this.data;
    if (scheduleWaitlist.length === 0) {
      wx.showToast({ title: '无候补数据可导出', icon: 'none' });
      return;
    }
    this.setData({ exportLoading: true });
    try {
      const BOM = '\uFEFF';
      let csv = BOM + '序号,会员姓名,手机号,候补状态,加入时间,排队位置\n';
      scheduleWaitlist.forEach((item, index) => {
        const name = item.user_id && item.user_id.nick_name
          ? item.user_id.nick_name
          : (item.user_id && item.user_id.real_name ? item.user_id.real_name : '未知会员');
        const phone = item.user_id && item.user_id.phone ? item.user_id.phone : '-';
        const status = this.getStatusText(item.status);
        const time = this.formatWaitlistTime(item.created_at);
        const position = item.position || (index + 1);
        csv += `${index + 1},"${name}","${phone}","${status}","${time}","${position}"\n`;
      });
      const fs = wx.getFileSystemManager();
      const fileName = `候补名单_${currentSchedule.course_name || '课程'}_${formatDate(new Date(), 'YYYYMMDD')}.csv`;
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      fs.writeFileSync(filePath, csv, 'utf8');
      wx.openDocument({
        filePath: filePath,
        showMenu: true,
        success: () => {
          this.setData({ exportFilePath: filePath, exportFileName: fileName });
        },
        fail: () => {
          wx.showToast({ title: '文件已生成，请在文件中查看', icon: 'none' });
        }
      });
    } catch (err) {
      console.error('导出候补名单失败', err);
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
    this.setData({ exportLoading: false });
  },

  onPromoteWaitlist(e) {
    const waitlistId = e.currentTarget.dataset.id;
    const userName = e.currentTarget.dataset.name;
    wx.showModal({
      title: '确认候补转正',
      content: `确定要将「${userName}」转为正式预约吗？`,
      success: (res) => {
        if (res.confirm) {
          request({ 
            url: `/bookings/waitlist/${waitlistId}/promote`, 
            method: 'PUT'
          }).then(() => {
            wx.showToast({ title: '转正成功', icon: 'success' });
            this.loadScheduleWaitlist(this.data.currentSchedule._id).then(({ list, summary }) => {
              this.setData({ scheduleWaitlist: list, statusSummary: summary });
            });
            this.loadWaitlistSummary();
          }).catch(() => {
            wx.showToast({ title: '转正失败', icon: 'none' });
          });
        }
      }
    });
  },

  onRemoveWaitlist(e) {
    const waitlistId = e.currentTarget.dataset.id;
    const userName = e.currentTarget.dataset.name;
    wx.showModal({
      title: '确认移除候补',
      content: `确定要移除「${userName}」的候补资格吗？`,
      success: (res) => {
        if (res.confirm) {
          request({ 
            url: `/bookings/waitlist/${waitlistId}`, 
            method: 'DELETE'
          }).then(() => {
            wx.showToast({ title: '移除成功', icon: 'success' });
            this.loadScheduleWaitlist(this.data.currentSchedule._id).then(({ list, summary }) => {
              this.setData({ scheduleWaitlist: list, statusSummary: summary });
            });
            this.loadWaitlistSummary();
          }).catch(() => {
            wx.showToast({ title: '移除失败', icon: 'none' });
          });
        }
      }
    });
  },

  formatWaitlistTime(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return formatDate(date, 'MM-dd HH:mm');
  },

  getStatusText(status) {
    const statusMap = {
      waiting: '等待中',
      notified: '已通知',
      confirmed: '已确认',
      cancelled: '已取消'
    };
    return statusMap[status] || status;
  },

  getStatusClass(status) {
    const classMap = {
      waiting: 'status-waiting',
      notified: 'status-notified',
      confirmed: 'status-confirmed',
      cancelled: 'status-cancelled'
    };
    return classMap[status] || '';
  }
});