const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const BEIJING_TIMEZONE = 'Asia/Shanghai';

const formatDate = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
  return dayjs(date).tz(BEIJING_TIMEZONE).format(format);
};

const addDays = (date, days) => {
  return dayjs(date).tz(BEIJING_TIMEZONE).add(days, 'day').toDate();
};

const getDaysBetween = (start, end) => {
  const startDate = dayjs(start).tz(BEIJING_TIMEZONE);
  const endDate = dayjs(end).tz(BEIJING_TIMEZONE);
  return endDate.diff(startDate, 'day');
};

const getWeekRange = (date) => {
  const d = dayjs(date).tz(BEIJING_TIMEZONE);
  const start = d.startOf('week').add(1, 'day'); // 周一
  const end = d.endOf('week').add(1, 'day'); // 周日
  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  };
};

/**
 * 获取星期几（1-7表示周一到周日）
 */
const getWeekday = (date) => {
  const day = dayjs(date).tz(BEIJING_TIMEZONE).day();
  return day === 0 ? 7 : day;
};

/**
 * 获取星期几的中文名称
 */
const getWeekdayText = (date) => {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[dayjs(date).tz(BEIJING_TIMEZONE).day()];
};

module.exports = { formatDate, addDays, getDaysBetween, getWeekRange, getWeekday, getWeekdayText };
