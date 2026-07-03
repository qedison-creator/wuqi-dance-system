/**
 * 课程状态业务逻辑统一常量
 * 全项目（管理端、会员端、后端）唯一真相源
 *
 * 状态流转规则：
 * not_open → available（到开放时间）
 * available ↔ full（满员/取消预约）
 * available/full → offline（管理员下线/放假封禁）
 * offline → available/full（管理员上线/放假结束）
 * available/full → cancelled（人数不足/管理员取消/放假取消）
 * available/full → in_progress（课程开始）
 * in_progress → completed（课程结束）
 * in_progress → cancelled（管理员中途取消，签到后取消）
 * * → deleted（管理员删除）
 */

// ============ Schedule 状态 ============
const SCHEDULE_STATUS = {
  NOT_OPEN: 'not_open',           // 未开放
  AVAILABLE: 'available',         // 可预约
  FULL: 'full',                   // 已满
  OFFLINE: 'offline',             // 已下线（管理员下线/放假封禁）
  CANCELLED: 'cancelled',         // 已取消（人数不足/管理员取消/放假取消）
  IN_PROGRESS: 'in_progress',     // 进行中（开课中）
  COMPLETED: 'completed',         // 已完成
  DELETED: 'deleted',             // 已删除
};

// Schedule 取消原因
const CANCEL_REASON = {
  MIN_BOOKINGS_NOT_MET: 'min_bookings_not_met', // 人数不足
  ADMIN_CANCEL: 'admin_cancel',                 // 管理员手动取消
  HOLIDAY: 'holiday',                           // 放假取消
  ADMIN_OFFLINE: 'admin_offline',               // 管理员下线（offline 状态使用）
};

// ============ Booking 状态 ============
const BOOKING_STATUS = {
  BOOKED: 'booked',       // 已预约
  CANCELLED: 'cancelled', // 已取消
  COMPLETED: 'completed', // 已完成（已签到）
};

// Booking 取消类型
const CANCEL_TYPE = {
  NORMAL: 'normal',                       // 正常取消（截止时间前）
  EXEMPT: 'exempt',                       // 豁免取消（窗口期内，使用豁免权）
  QUICK: 'quick',                         // 补约快速取消（补约后5分钟内）
  ADMIN_CANCEL: 'admin_cancel',           // 管理员取消
  MIN_BOOKINGS_NOT_MET: 'min_bookings_not_met', // 人数不足自动取消
  HOLIDAY: 'holiday',                     // 放假取消
  AFTER_CHECKIN_CANCEL: 'after_checkin_cancel', // 签到后取消（in_progress状态中途取消）
};

// 签到方式
const CHECK_IN_METHOD = {
  SCAN: 'scan',     // 扫码签到
  AUTO: 'auto',     // 自动签到（课程开始时）
  ONSITE: 'onsite', // 现场签到（线下补签）
  ADMIN: 'admin',   // 管理员手动签到
};

// ============ 状态展示文案（前后端共享）============
const STATUS_TEXT_MAP = {
  [SCHEDULE_STATUS.NOT_OPEN]: '未开放',
  [SCHEDULE_STATUS.AVAILABLE]: '可预约',
  [SCHEDULE_STATUS.FULL]: '已满',
  [SCHEDULE_STATUS.OFFLINE]: '已下线',
  [SCHEDULE_STATUS.CANCELLED]: '已取消',
  [SCHEDULE_STATUS.IN_PROGRESS]: '进行中',
  [SCHEDULE_STATUS.COMPLETED]: '已完成',
  [SCHEDULE_STATUS.DELETED]: '已删除',
};

// 取消原因文案
const CANCEL_REASON_TEXT_MAP = {
  [CANCEL_REASON.MIN_BOOKINGS_NOT_MET]: '人数不足取消',
  [CANCEL_REASON.ADMIN_CANCEL]: '管理员取消',
  [CANCEL_REASON.HOLIDAY]: '放假取消',
  [CANCEL_REASON.ADMIN_OFFLINE]: '管理员下线',
};

// 取消类型文案
const CANCEL_TYPE_TEXT_MAP = {
  [CANCEL_TYPE.NORMAL]: '用户取消',
  [CANCEL_TYPE.EXEMPT]: '豁免取消（不扣课时）',
  [CANCEL_TYPE.QUICK]: '补约快速取消（5分钟内）',
  [CANCEL_TYPE.ADMIN_CANCEL]: '管理员取消',
  [CANCEL_TYPE.MIN_BOOKINGS_NOT_MET]: '人数不足取消',
  [CANCEL_TYPE.HOLIDAY]: '放假取消',
  [CANCEL_TYPE.AFTER_CHECKIN_CANCEL]: '课程中取消',
};

// ============ 时间规则 ============
const TIME_RULES = {
  BOOKING_DEADLINE_MINUTES: 120,   // 预约截止时间：开课前 120 分钟
  EXEMPT_WINDOW_MINUTES: 10,       // 豁免取消窗口：开课前 10 分钟内
  QUICK_CANCEL_MINUTES: 5,         // 补约快速取消窗口：预约后 5 分钟内
  DEFAULT_EXEMPTION_COUNT: 2,      // 默认豁免次数：每人 2 次
};

// ============ 终态判断 ============
const TERMINAL_STATUSES = [SCHEDULE_STATUS.CANCELLED, SCHEDULE_STATUS.COMPLETED, SCHEDULE_STATUS.DELETED];
const CANCELLED_STATUSES = [SCHEDULE_STATUS.CANCELLED, SCHEDULE_STATUS.OFFLINE];
const ACTIVE_STATUSES = [SCHEDULE_STATUS.AVAILABLE, SCHEDULE_STATUS.FULL, SCHEDULE_STATUS.NOT_OPEN, SCHEDULE_STATUS.IN_PROGRESS];

// ============ 扣课时规则 ============
// 退课时的 cancel_type 集合（退还课时 + 释放名额）
const REFUND_CANCEL_TYPES = [
  CANCEL_TYPE.NORMAL,
  CANCEL_TYPE.EXEMPT,
  CANCEL_TYPE.QUICK,
  CANCEL_TYPE.ADMIN_CANCEL,
  CANCEL_TYPE.MIN_BOOKINGS_NOT_MET,
  CANCEL_TYPE.HOLIDAY,
  CANCEL_TYPE.AFTER_CHECKIN_CANCEL,
];

// ============ 会员端记录分类（方案A）============
// 预约记录 tab：只显示 booked 状态
// 取消记录 tab：所有 cancelled 状态，按 cancel_type 细分
// 上课记录 tab：所有 completed 状态
const RECORD_TAB_FILTERS = {
  booking: {
    upcoming: { status: BOOKING_STATUS.BOOKED },  // 即将上课
  },
  cancelled: {
    all: { status: BOOKING_STATUS.CANCELLED },    // 所有取消
  },
  attendance: {
    all: { status: BOOKING_STATUS.COMPLETED },    // 所有上课
  },
};

module.exports = {
  SCHEDULE_STATUS,
  CANCEL_REASON,
  BOOKING_STATUS,
  CANCEL_TYPE,
  CHECK_IN_METHOD,
  STATUS_TEXT_MAP,
  CANCEL_REASON_TEXT_MAP,
  CANCEL_TYPE_TEXT_MAP,
  TIME_RULES,
  TERMINAL_STATUSES,
  CANCELLED_STATUSES,
  ACTIVE_STATUSES,
  REFUND_CANCEL_TYPES,
  RECORD_TAB_FILTERS,
};
