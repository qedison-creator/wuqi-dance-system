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
  // 相对路径：补全协议+域名
  if (url.startsWith('/')) return serverBase + url;
  // 完整 URL：识别已知服务器主机（测试 IP/localhost/生产域名），改写到 serverBase
  // 避免测试主机名被微信小程序域名白名单拦截
  const serverHosts = ['101.33.203.22:3000', 'localhost:3000', 'api.yuekeme.cn', 'admin-api.yuekeme.cn'];
  const match = url.match(/^https?:\/\/([^/]+)(\/.*)/);
  if (match) {
    const host = match[1];
    if (serverHosts.some(h => host === h || host.endsWith('.' + h))) {
      return serverBase + match[2];
    }
    // 外部域名（如 images.unsplash.com）保留原址
    return url;
  }
  return url;
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
    // 尝试创建离屏 Canvas（基础库 2.16.0+）
    let canvas;
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width: outputSize, height: outputSize });
    } catch (e) {
      // 不支持离屏 Canvas，降级返回原图
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
  normalizeImageUrl,
  cropImageToCircle
};