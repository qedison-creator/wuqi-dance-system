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

// 将头像/图片相对路径转为完整 URL
// 数据库存的是 /uploads/avatars/xxx.webp 这样的相对路径，前端直接用会被当作小程序本地资源加载导致 500
const fixImageUrl = (url) => {
  if (!url) return '';
  // 已是完整 URL：强制升级 HTTP 为 HTTPS（微信小程序不再支持 HTTP 协议图片）
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'https://');
  try {
    const config = require('../config/index.js');
    const serverBase = config.serverBase || '';
    if (url.startsWith('//')) return (serverBase.replace(/^https?:/, '') + url).replace(/^http:\/\//, 'https://');
    if (url.startsWith('/')) return (serverBase + url).replace(/^http:\/\//, 'https://');
    return (serverBase + '/' + url).replace(/^http:\/\//, 'https://');
  } catch (e) {
    return url;
  }
};

/**
 * 将图片裁剪为圆形（中心裁剪 + 圆形遮罩）
 * 使用离屏 Canvas 实现，不受 wx.cropImage 方形限制
 * 不支持的环境自动降级为返回原图
 * @param {string} filePath - 图片临时路径
 * @param {number} outputSize - 输出尺寸（默认200px）
 * @returns {Promise<string>} 圆形图片临时路径
 */
const cropImageToCircle = (filePath, outputSize = 200) => {
  return new Promise((resolve) => {
    let canvas;
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width: outputSize, height: outputSize });
    } catch (e) {
      resolve(filePath);
      return;
    }

    wx.getImageInfo({
      src: filePath,
      success: (imgInfo) => {
        const ctx = canvas.getContext('2d');
        const srcSize = Math.min(imgInfo.width, imgInfo.height);
        const sx = (imgInfo.width - srcSize) / 2;
        const sy = (imgInfo.height - srcSize) / 2;

        const img = canvas.createImage();
        img.onload = () => {
          ctx.save();
          ctx.beginPath();
          ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, outputSize, outputSize);
          ctx.restore();

          wx.canvasToTempFilePath({
            canvas,
            success: (res) => resolve(res.tempFilePath),
            fail: () => resolve(filePath)
          });
        };
        img.onerror = () => resolve(filePath);
        img.src = filePath;
      },
      fail: () => resolve(filePath)
    });
  });
};

/**
 * 安全裁剪图片（带兜底机制）
 * 优先调用 wx.cropImage 进行裁剪，失败时根据错误类型处理：
 * - 用户取消裁剪（cancel）：抛出错误，调用方可识别并中断
 * - 开发者工具不支持 / 其他错误：跳过裁剪，返回原图（兜底，保证流程继续）
 * @param {string} filePath - 原图临时路径
 * @param {string} cropScale - 裁剪比例（仅支持 16:9/9:16/4:3/3:4/5:4/4:5/1:1）
 * @returns {Promise<string>} 裁剪后图片路径（或原图路径）
 */
const cropImageSafe = (filePath, cropScale) => {
  return new Promise((resolve, reject) => {
    // wx.cropImage 不存在：直接返回原图
    if (!wx.cropImage) {
      resolve(filePath);
      return;
    }
    // 开发者工具环境：wx.cropImage 不支持调试，直接跳过裁剪，避免触发 HTTP 临时路径警告
    try {
      const sysInfo = wx.getSystemInfoSync();
      if (sysInfo && sysInfo.platform === 'devtools') {
        console.warn('[cropImageSafe] 开发者工具环境跳过裁剪，使用原图');
        resolve(filePath);
        return;
      }
    } catch (e) { /* 忽略，继续尝试裁剪 */ }
    wx.cropImage({
      src: filePath,
      cropScale: cropScale,
      success: (res) => resolve(res.tempFilePath),
      fail: (err) => {
        const errMsg = (err.errMsg || '').toLowerCase();
        // 用户主动取消裁剪：抛出错误，调用方可中断
        if (errMsg.indexOf('cancel') !== -1) {
          reject(err);
          return;
        }
        // 其他失败（含开发者工具不支持）：跳过裁剪，返回原图兜底
        console.warn('裁剪跳过，使用原图:', err.errMsg || err);
        resolve(filePath);
      }
    });
  });
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
  debounce,
  fixImageUrl,
  cropImageToCircle,
  cropImageSafe
};
