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
      confirmColor: '#D4786E',
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

const throttle = (func, limit) => {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * 规范化图片 URL
 * - 空值：返回空字符串
 * - 相对路径（/uploads/...）：拼接 SERVER_BASE
 * - 本服务器域名（api.yuekeme.cn / admin-api.yuekeme.cn / 101.33.203.22）：提取路径拼 SERVER_BASE
 * - 外部域名（如 unsplash.com）：返回空字符串（在小程序真机会被域名白名单拦截）
 * @param {string} url - 原始图片 URL
 * @param {string} serverBase - 服务器基础地址
 */
const normalizeImageUrl = (url, serverBase) => {
  if (!url) return '';
  if (!serverBase) return url;
  if (url.startsWith('/')) return serverBase + url;
  const serverHosts = [
    'api.yuekeme.cn',
    'admin-api.yuekeme.cn',
    '101.33.203.22:3000',
    'localhost:3000',
    '127.0.0.1:3000'
  ];
  const match = url.match(/^https?:\/\/([^\/]+)(\/.*)/);
  if (match && serverHosts.indexOf(match[1]) !== -1) {
    return serverBase + match[2];
  }
  return '';
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
  showToast,
  showLoading,
  hideLoading,
  showModal,
  debounce,
  throttle,
  normalizeImageUrl
};