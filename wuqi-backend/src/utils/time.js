/**
 * 服务器时间工具 - 统一使用北京时间
 * 所有业务逻辑应使用此模块获取时间，避免使用 new Date() 或 Date.now()
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// 设置默认时区为北京时间
const BEIJING_TIMEZONE = 'Asia/Shanghai';

// 服务器时间偏移量（毫秒）
let serverTimeOffset = 0;

/**
 * 同步服务器时间
 * 已使用 dayjs 时区插件直接获取北京时间，无需再从数据库同步
 */
exports.syncServerTime = async () => {
  console.log('[Time] 使用北京时间（Asia/Shanghai），偏移量: 0ms');
};

/**
 * 获取当前北京时间 (Date对象)
 * @returns {Date} 北京当前时间
 */
exports.now = () => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').toDate();
};

/**
 * 获取当前北京时间戳 (毫秒)
 * @returns {number} 北京当前时间戳
 */
exports.timestamp = () => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').valueOf();
};

/**
 * 获取当前北京日期字符串 (YYYY-MM-DD)
 * @returns {string} 日期字符串
 */
exports.today = () => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').format('YYYY-MM-DD');
};

/**
 * 获取当前北京时间字符串 (HH:mm:ss)
 * @returns {string} 时间字符串
 */
exports.currentTime = () => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').format('HH:mm:ss');
};

/**
 * 获取当前北京日期时间字符串 (YYYY-MM-DD HH:mm:ss)
 * @returns {string} 日期时间字符串
 */
exports.datetime = () => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').format('YYYY-MM-DD HH:mm:ss');
};

/**
 * 获取 dayjs 对象（使用北京时间）
 * @param {Date|string|number} [date] 可选日期
 * @returns {dayjs.Dayjs} dayjs 对象
 */
exports.dayjs = (date) => {
  if (date) {
    return dayjs(date).tz(BEIJING_TIMEZONE);
  }
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond');
};

/**
 * 格式化日期（使用北京时间）
 * @param {Date|string|number} date 日期
 * @param {string} format 格式
 * @returns {string} 格式化后的日期字符串
 */
exports.format = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
  return dayjs(date).tz(BEIJING_TIMEZONE).format(format);
};

/**
 * 判断是否是今天（北京时间）
 * @param {Date|string} date 日期
 * @returns {boolean} 是否是今天
 */
exports.isToday = (date) => {
  return dayjs(date).tz(BEIJING_TIMEZONE).format('YYYY-MM-DD') === this.today();
};

/**
 * 判断是否已过期（北京时间）
 * @param {Date|string} date 日期
 * @returns {boolean} 是否已过期
 */
exports.isExpired = (date) => {
  return dayjs(date).tz(BEIJING_TIMEZONE).isBefore(this.now());
};

/**
 * 获取指定天数后的日期（北京时间）
 * @param {number} days 天数
 * @returns {Date} 日期对象
 */
exports.addDays = (days) => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').add(days, 'day').toDate();
};

/**
 * 获取指定月数后的日期（北京时间）
 * @param {number} months 月数
 * @returns {Date} 日期对象
 */
exports.addMonths = (months) => {
  return dayjs().tz(BEIJING_TIMEZONE).add(serverTimeOffset, 'millisecond').add(months, 'month').toDate();
};

/**
 * 获取星期几（北京时间，1-7表示周一到周日）
 * @param {Date|string} date 日期
 * @returns {number} 星期几
 */
exports.getWeekday = (date) => {
  const day = dayjs(date).tz(BEIJING_TIMEZONE).day();
  return day === 0 ? 7 : day; // 0表示周日，转为7
};

/**
 * 获取星期几的中文名称
 * @param {Date|string} date 日期
 * @returns {string} 星期几的中文
 */
exports.getWeekdayText = (date) => {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[dayjs(date).tz(BEIJING_TIMEZONE).day()];
};
