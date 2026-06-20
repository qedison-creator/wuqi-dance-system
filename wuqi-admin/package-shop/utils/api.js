const { request } = require('/utils/request');
const config = require('/config/index.js');

module.exports = {
  // 认证相关
  auth: {
    adminLogin: (data) => request({ url: '/auth/admin-login', method: 'POST', data }),
    getMe: () => request({ url: '/auth/me', method: 'GET' }),
  },

  // 统计相关
  stats: {
    getDashboard: (data) => request({ url: '/stats/dashboard', data }),
  },

  // 门店相关
  stores: {
    getList: (data) => request({ url: '/stores', data }),
    getDetail: (id) => request({ url: `/stores/${id}` }),
  },

  // 会员相关
  members: {
    getList: (data) => request({ url: '/members', data }),
    getDetail: (id) => request({ url: `/members/${id}` }),
    update: (id, data) => request({ url: `/members/${id}`, method: 'PUT', data }),
    review: (id, data) => request({ url: `/members/${id}/review`, method: 'PUT', data }),
    assignCode: (id) => request({ url: `/members/${id}/assign-code`, method: 'PUT' }),
    setExemption: (id, data) => request({ url: `/members/${id}/exemption`, method: 'PUT', data }),
    getExemptionLogs: (id, data) => request({ url: `/members/${id}/exemption-logs`, data }),
    suspend: (id, data) => request({ url: `/members/${id}/suspend`, method: 'PUT', data }),
    unsuspend: (id) => request({ url: `/members/${id}/unsuspend`, method: 'PUT' }),
    getStats: () => request({ url: '/members/stats/overview' }),
    getPhoneAuditList: (data) => request({ url: '/members/phone-audit/list', data }),
    auditPhone: (id, data) => request({ url: `/members/${id}/phone-audit`, method: 'PUT', data }),
  },

  // 套餐相关
  packages: {
    getList: (data) => request({ url: '/packages', data }),
    getDetail: (id) => request({ url: `/packages/${id}` }),
    create: (data) => request({ url: '/packages', method: 'POST', data }),
    update: (id, data) => request({ url: `/packages/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/packages/${id}`, method: 'DELETE' }),
    deleteUserPackage: (id) => request({ url: `/packages/user/${id}`, method: 'DELETE' }),
    getActivationRecords: (data) => request({ url: '/packages/activation-records', data }),
    getExtensionRecords: (data) => request({ url: '/packages/extension-records', data }),
    extend: (id, data) => request({ url: `/packages/${id}/extend`, method: 'PUT', data }),
    revokeExtension: (id) => request({ url: `/packages/extension-records/${id}/revoke`, method: 'PUT' }),
    refreshStatus: () => request({ url: '/packages/refresh-status', method: 'PUT' }),
  },

  // 排课相关
  schedules: {
    getList: (data) => request({ url: '/schedules', data }),
    getDetail: (id) => request({ url: `/schedules/${id}` }),
    create: (data) => request({ url: '/schedules', method: 'POST', data }),
    update: (id, data) => request({ url: `/schedules/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/schedules/${id}`, method: 'DELETE' }),
    cancel: (id, data) => request({ url: `/schedules/${id}/cancel`, method: 'PUT', data }),
    offline: (id, data) => request({ url: `/schedules/${id}/offline`, method: 'PUT', data }),
  },

  // 预约相关
  bookings: {
    getList: (data) => request({ url: '/bookings', data }),
    getDetail: (id) => request({ url: `/bookings/${id}` }),
    adminCancel: (id, data) => request({ url: `/bookings/${id}/admin-cancel`, method: 'PUT', data }),
    checkIn: (data) => request({ url: '/bookings/check-in', method: 'POST', data }),
    batchCheckIn: (data) => request({ url: '/bookings/batch-check-in', method: 'POST', data }),
    getCheckInRecords: (id) => request({ url: `/bookings/check-in-records/${id}` }),
    checkLowAttendance: (data) => request({ url: '/bookings/check-low-attendance', method: 'POST', data }),
    batchCheckLowAttendance: (data) => request({ url: '/bookings/batch-check-low-attendance', method: 'POST', data }),
  },

  // 教练相关
  coaches: {
    getList: (data) => request({ url: '/coaches', data }),
    getDetail: (id) => request({ url: `/coaches/${id}` }),
    create: (data) => request({ url: '/coaches', method: 'POST', data }),
    update: (id, data) => request({ url: `/coaches/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/coaches/${id}`, method: 'DELETE' }),
  },

  // 教练薪酬相关
  coachSalaries: {
    getList: (data) => request({ url: '/coach-salaries', data }),
    getDetail: (id) => request({ url: `/coach-salaries/${id}` }),
    create: (data) => request({ url: '/coach-salaries', method: 'POST', data }),
    update: (id, data) => request({ url: `/coach-salaries/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/coach-salaries/${id}`, method: 'DELETE' }),
    getStatsList: (data) => request({ url: '/coach-salaries/stats/list', data }),
    getStatsSummary: (data) => request({ url: '/coach-salaries/stats/summary', data }),
    generateStats: (data) => request({ url: '/coach-salaries/stats/generate', method: 'POST', data }),
    settleStats: (id, data) => request({ url: `/coach-salaries/stats/${id}/settle`, method: 'PUT', data }),
    cancelStats: (id) => request({ url: `/coach-salaries/stats/${id}/cancel`, method: 'PUT' }),
  },

  // 放假相关
  holidays: {
    getList: (data) => request({ url: '/holidays', data }),
    getDetail: (id) => request({ url: `/holidays/${id}` }),
    create: (data) => request({ url: '/holidays', method: 'POST', data }),
    update: (id, data) => request({ url: `/holidays/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/holidays/${id}`, method: 'DELETE' }),
    revoke: (id) => request({ url: `/holidays/${id}/cancel`, method: 'PUT' }),
  },

  // Banner相关
  banners: {
    getList: (data) => request({ url: '/banners', data }),
    getDetail: (id) => request({ url: `/banners/${id}` }),
    create: (data) => request({ url: '/banners', method: 'POST', data }),
    update: (id, data) => request({ url: `/banners/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/banners/${id}`, method: 'DELETE' }),
  },

  // 图片相册相关
  images: {
    getList: (data) => request({ url: '/images', data }),
    create: (data) => request({ url: '/images', method: 'POST', data }),
    update: (id, data) => request({ url: `/images/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/images/${id}`, method: 'DELETE' }),
  },

  // 舞种相关
  danceStyles: {
    getList: (data) => request({ url: '/dance-styles', data }),
    getDetail: (id) => request({ url: `/dance-styles/${id}` }),
    create: (data) => request({ url: '/dance-styles', method: 'POST', data }),
    update: (id, data) => request({ url: `/dance-styles/${id}`, method: 'PUT', data }),
    delete: (id) => request({ url: `/dance-styles/${id}`, method: 'DELETE' }),
  },

  // 日志相关
  logs: {
    getList: (data) => request({ url: '/logs', data }),
  },

  // 上传相关
  upload: {
    image: (filePath, uploadType = 'general') => {
      return new Promise((resolve, reject) => {
        const app = getApp();
        const token = wx.getStorageSync('admin_token') || (app.globalData && app.globalData.token) || '';
        const baseUrl = (app.globalData && app.globalData.baseUrl) || config.baseUrl;

        wx.uploadFile({
          url: baseUrl + '/upload/image',
          filePath,
          name: 'image',
          formData: { type: uploadType },
          header: {
            'Authorization': token ? `Bearer ${token}` : ''
          },
          success: (res) => {
            const data = JSON.parse(res.data);
            if (data.code === 200) {
              resolve(data);
            } else {
              reject(data);
            }
          },
          fail: reject
        });
      });
    }
  }
};
