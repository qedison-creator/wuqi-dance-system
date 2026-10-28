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

// —— 课时/次数/天数口径（与后端 booking.service 保持一致）——
function _idOf(v) {
  if (!v) return '';
  return String(typeof v === 'string' ? v : (v._id || v));
}
function _toMin(hhmm) {
  const parts = String(hhmm || '').split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

/**
 * 选择本节课实际生效的套餐：门店覆盖 + 有效期内 + 舞种/星期/可用时段匹配，
 * 口径与后端 booking.service 一致（time_card 优先于 count_card）。
 * @param {Array} packages 用户套餐列表（/packages/my 的 history）
 * @param {Object} course 课程对象
 * @returns {Object|null} 生效套餐，无法判定时返回 null
 */
const pickEffectivePackage = (packages, course) => {
  const list = Array.isArray(packages) ? packages : [];
  const cStore = _idOf(course && course.store_id);
  const cStyle = _idOf(course && (course.dance_style_id || course.danceStyleId));
  const cDate = (course && (course.date || course.dateStr)) || '';
  const cStart = (course && course.start_time) || '';
  const now = new Date();
  const valid = list.filter(pkg => {
    const isActive = pkg.status === 'active' && !pkg.is_suspended &&
      !(pkg.is_activated && pkg.end_date && now > new Date(pkg.end_date));
    const isPending = pkg.status === 'pending';
    if (!isActive && !isPending) return false;
    if (pkg.package_type === 'count_card' && !(pkg.remaining_credits > 0)) return false;
    const covered = _idOf(pkg.store_id) === cStore ||
      (pkg.extra_store_ids || []).some(e => _idOf(e) === cStore);
    if (cStore && !covered) return false;
    if (cStyle && Array.isArray(pkg.dance_style_limit) && pkg.dance_style_limit.length > 0) {
      if (!pkg.dance_style_limit.some(s => _idOf(s) === cStyle)) return false;
    }
    if (cDate && Array.isArray(pkg.weekday_limit) && pkg.weekday_limit.length > 0) {
      const day = new Date(String(cDate).replace(/-/g, '/')).getDay();
      if (pkg.weekday_limit.indexOf(day) === -1) return false;
    }
    if (cStart && (pkg.usable_before || pkg.usable_after)) {
      const t = _toMin(cStart);
      const b = pkg.usable_before ? _toMin(pkg.usable_before) : null;
      const a = pkg.usable_after ? _toMin(pkg.usable_after) : null;
      let ok = true;
      if (b !== null && a !== null) ok = t <= b || t >= a;
      else if (b !== null) ok = t <= b;
      else if (a !== null) ok = t >= a;
      if (!ok) return false;
    }
    return true;
  });
  return valid.find(p => p.package_type === 'time_card') ||
    valid.find(p => p.package_type === 'count_card') || null;
};

/**
 * 统一扣除/退还口径：次卡=次；时间卡(周期限制)=课时；时间卡(按天/每日1节)=天。
 * 与后端 checkTimeCardLimit 口径一致（按天口径 N≥2 才缩期，N=1 不占用）。
 * @param {Object|null} pkg 生效套餐
 * @param {number} creditsCost 课程扣除课时数
 * @returns {{unit:string, amount:number, shrinkDays:number, deductText:string, refundText:string}}
 */
const getCreditUnitInfo = (pkg, creditsCost) => {
  const n = Math.max(1, Number(creditsCost) || 1);
  if (pkg && pkg.package_type === 'time_card') {
    const isUnlimited = !pkg.daily_limit && !pkg.weekly_limit && !pkg.monthly_limit;
    const isDailyOne = pkg.daily_limit === 1 && !pkg.weekly_limit && !pkg.monthly_limit;
    if (isUnlimited || isDailyOne) {
      const shrinkDays = n >= 2 ? n : 0;
      return {
        unit: '天',
        amount: shrinkDays,
        shrinkDays,
        deductText: shrinkDays > 0 ? `扣除 ${shrinkDays} 天有效期` : '不占用有效期',
        refundText: shrinkDays > 0 ? `退还 ${shrinkDays} 天有效期` : '未占用有效期'
      };
    }
    return {
      unit: '课时', amount: n, shrinkDays: 0,
      deductText: `扣除 ${n} 课时`, refundText: `退还 ${n} 课时`
    };
  }
  return {
    unit: '次', amount: n, shrinkDays: 0,
    deductText: `扣除 ${n} 次`, refundText: `退还 ${n} 次`
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
  showToast,
  showLoading,
  hideLoading,
  showModal,
  debounce,
  throttle,
  normalizeImageUrl,
  pickEffectivePackage,
  getCreditUnitInfo
};