/**
 * 获取北京时间的日期对象（UTC+8）
 * @param {Date|string} date - 输入的日期
 * @returns {Date} 北京时间的日期对象
 */
const getBeijingDate = (date) => {
  if (!date) {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() + (offset + 480) * 60 * 1000);
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  return new Date(year, month, day, hours, minutes, seconds);
};

const formatDate = (date, format = 'YYYY-MM-DD') => {
  if (!date) return '';
  const d = getBeijingDate(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hour)
    .replace('mm', minute);
};

const formatTime = (date) => {
  return formatDate(date, 'HH:mm');
};

const formatDateTime = (date) => {
  return formatDate(date, 'YYYY-MM-DD HH:mm');
};

const getWeekday = (date) => {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const d = getBeijingDate(date);
  return weekdays[d.getDay()];
};

const getWeekDay = (date) => {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[getBeijingDate(date).getDay()];
};

const getWeekDayCN = (date) => {
  return getWeekday(date);
};

const getNextDays = (days = 7) => {
  const result = [];
  const today = getBeijingDate();
  for (let i = 0; i < days; i++) {
    const d = getBeijingDate(today);
    d.setDate(today.getDate() + i);
    result.push({
      date: formatDate(d),
      weekDay: getWeekDay(d),
      day: d.getDate(),
      isToday: i === 0
    });
  }
  return result;
};

const formatMoney = (amount) => {
  if (amount == null || amount === '') return '';
  return '¥' + Number(amount).toFixed(2);
};

const formatNumber = (num) => {
  if (num == null || num === '') return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

// 课程状态文案映射（与后端统一状态枚举一致）
// 状态枚举: not_open / available / full / offline / cancelled / in_progress / completed / deleted

const STATUS_TEXT_MAP = {
  'not_open': '未开放',
  'available': '可预约',
  'full': '已满',
  'offline': '已下线',
  'cancelled': '已取消',
  'in_progress': '进行中',
  'completed': '已完成',
  'deleted': '已删除',
};

// 课程取消原因文案映射

const CANCEL_REASON_TEXT_MAP = {
  'min_bookings_not_met': '人数不足取消',
  'admin_cancel': '管理员取消',
  'holiday': '放假取消',
  'admin_offline': '管理员下线',
};

// 预约取消类型文案映射

const CANCEL_TYPE_TEXT_MAP = {
  'normal': '正常取消',
  'exempt': '豁免取消',
  'admin_cancel': '管理员取消',
  'min_bookings_not_met': '人数不足取消',
  'holiday': '放假取消',
};

// 获取课程状态文案

const getScheduleStatusText = (status) => {
  return STATUS_TEXT_MAP[status] || status || '';
};

// 获取课程取消原因文案

const getCancelReasonText = (reason) => {
  return CANCEL_REASON_TEXT_MAP[reason] || reason || '';
};

// 获取预约取消类型文案

const getCancelTypeText = (cancelType) => {
  if (!cancelType) return '已取消';
  return CANCEL_TYPE_TEXT_MAP[cancelType] || cancelType;
};

const getStatusText = (status, type = 'booking') => {
  const statusMap = {
    booking: {
      'pending': '待确认',
      'confirmed': '已确认',
      'checked_in': '已签到',
      'cancelled': '已取消',
      'completed': '已完成'
    },
    package: {
      'inactive': '未激活',
      'active': '使用中',
      'paused': '已暂停',
      'expired': '已过期',
      'depleted': '已用完'
    },
    member: {
      'guest': '访客',
      'registered': '已注册',
      'official': '正式会员',
      'suspended': '已停卡'
    },
    salary: {
      'pending': '待结算',
      'settled': '已结算',
      'cancelled': '已取消'
    }
  };
  return statusMap[type] ? statusMap[type][status] : status;
};

const showToast = (title, icon = 'none', duration = 2000) => {
  wx.showToast({ title, icon, duration });
};

const showLoading = (title = '加载中...') => {
  wx.showLoading({ title, mask: true });
};

const hideLoading = () => {
  wx.hideLoading();
};

const showModal = (title, content, options = {}) => {
  return new Promise((resolve, reject) => {
    wx.showModal({
      title,
      content,
      confirmColor: '#FFCC00',
      ...options,
      success: (res) => {
        if (res.confirm) {
          resolve(res);
        } else {
          reject(res);
        }
      }
    });
  });
};

const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

module.exports = {
  getBeijingDate,
  formatDate,
  formatTime,
  formatDateTime,
  getWeekday,
  getWeekDay,
  getWeekDayCN,
  getNextDays,
  formatMoney,
  formatNumber,
  STATUS_TEXT_MAP,
  CANCEL_REASON_TEXT_MAP,
  CANCEL_TYPE_TEXT_MAP,
  getScheduleStatusText,
  getCancelReasonText,
  getCancelTypeText,
  getStatusText,
  showToast,
  showLoading,
  hideLoading,
  showModal,
  debounce
};
