const mongoose = require('mongoose');
const CoachSalary = require('../models/CoachSalary');
const CoachSalaryStat = require('../models/CoachSalaryStat');
const SalaryBill = require('../models/SalaryBill');
const Coach = require('../models/Coach');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const Store = require('../models/Store');
const User = require('../models/User');
const logService = require('./log.service');
const { getAllowedStoreIds } = require('../utils/storeOwnership');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const BEIJING_TZ = 'Asia/Shanghai';

// 年月一律从 'YYYY-MM-DD' 字符串解析，避免 new Date()+本地时区导致的月份错位
const dateOnly = (d) => dayjs(d).tz(BEIJING_TZ).format('YYYY-MM-DD');
const currentYear = () => Number(dayjs().tz(BEIJING_TZ).format('YYYY'));
const weekdayOf = (dateStr) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayjs(dateStr).day()];

/**
 * 校验薪酬配置的门店归属（店长/员工只能操作所属门店的配置，不能操作全局配置 store_id=null）
 */
function assertCanManageSalary(salary, reqUser, action = '操作') {
  if (!salary) return;
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管/审核员：通过
  if (allowedStoreIds === null) return;

  // 全局配置（store_id 为空，多门店执教教练配置）：仅超管可操作
  if (!salary.store_id) {
    throw new Error(`多门店执教教练的薪酬配置仅超级管理员可${action}`);
  }

  // 校验配置所属门店在允许范围内
  if (!allowedStoreIds.includes(String(salary.store_id))) {
    throw new Error(`无权${action}非所属门店的薪酬配置`);
  }
}

/**
 * 校验教练是否可在指定门店执教（用于创建薪酬配置时校验教练归属）
 * - 多门店执教教练（store_ids 为空）：可在任何门店配置薪酬（仅超管可操作）
 * - 门店独占教练：store_ids 必须包含于当前用户所辖门店
 */
async function assertCoachCanManageAtStore(coachId, storeId, reqUser, action = '配置') {
  const coach = await Coach.findById(coachId).select('name store_ids');
  if (!coach) throw new Error('教练不存在');

  const allowedStoreIds = getAllowedStoreIds(reqUser);
  // 超管：可操作任意教练（含已删除教练——用于补配历史费率）
  if (allowedStoreIds === null) return coach;

  // 店长/员工：教练 store_ids 必须是 allowedStoreIds 的子集（即教练完全归属当前用户所辖门店）
  const storeIds = coach.store_ids;
  if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
    throw new Error(`多门店执教教练"${coach.name}"的薪酬配置仅超级管理员可${action}`);
  }
  const isSubset = storeIds.every(s => allowedStoreIds.includes(String(s)));
  if (!isSubset) {
    throw new Error(`无权${action}非所属门店教练"${coach.name}"的薪酬`);
  }
  return coach;
}

// ============================================================
// 上课事实聚合核心：一节已上课 = 有有效签到（去重后）的排课
// 课时统计 / 月度薪酬 / 账单生成三条链路共用，保证口径一致
// ============================================================

/**
 * 聚合指定条件下的已上课列表
 * @param {Object} params - { start_date, end_date, coach_id, store_id, reqUser }
 * @returns {Promise<{classes: Array, orphans: Array}>}
 *   classes: 逐课列表（快照字段优先，Coach/Schedule 兜底；Coach 含软删除教练）
 *   orphans: 排课记录已不存在的签到（数据异常，只展示不计薪不计数）
 */
async function aggregateTaughtClasses({ start_date, end_date, coach_id, store_id, reqUser }) {
  // aggregate 的 $match 不做 schema 类型转换，字符串 ID 必须显式转 ObjectId
  const toObjectId = (v) => {
    try {
      const oid = new mongoose.Types.ObjectId(String(v));
      return oid;
    } catch {
      return null;
    }
  };

  const filter = {
    check_in_method: { $nin: ['exempt_cancel', 'cancelled_after_checkin'] },
  };
  if (coach_id) {
    const oid = toObjectId(coach_id);
    if (!oid) return { classes: [], orphans: [] };
    filter.coach_id = oid;
  }
  if (start_date || end_date) {
    filter.date = {};
    if (start_date) filter.date.$gte = start_date;
    if (end_date) filter.date.$lte = end_date;
  }

  // 门店隔离：单门店角色只能看所属门店数据（依赖签到快照 store_id）
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { classes: [], orphans: [] };
    }
    const oids = allowedStoreIds.map(toObjectId).filter(Boolean);
    if (oids.length === 0) return { classes: [], orphans: [] };
    filter.store_id = { $in: oids };
  } else if (store_id) {
    const oid = toObjectId(store_id);
    if (!oid) return { classes: [], orphans: [] };
    filter.store_id = oid;
  }

  // 一次聚合：按排课去重并数签到人数（$max 跳过快照缺失的空值）
  const grouped = await Attendance.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$schedule_id',
        attendance_count: { $sum: 1 },
        coach_id: { $max: '$coach_id' },
        store_id: { $max: '$store_id' },
        date: { $max: '$date' },
        course_name: { $max: '$course_name' },
        duration: { $max: '$duration' },
        start_time: { $max: '$start_time' },
        end_time: { $max: '$end_time' },
        coach_name: { $max: '$coach_name' },
        store_name: { $max: '$store_name' },
      },
    },
  ]);

  if (grouped.length === 0) return { classes: [], orphans: [] };

  const schedules = await Schedule.find({ _id: { $in: grouped.map(g => g._id) } })
    .populate('coach_id', 'name')
    .populate('store_id', 'name')
    .lean();
  const scheduleMap = new Map(schedules.map(s => [String(s._id), s]));

  // 教练名兜底：软删除教练仍在 Coach 表中可查（删除教练后统计不受影响）
  const coachIds = [...new Set(grouped.map(g => g.coach_id).filter(Boolean).map(String))];
  const coachMap = new Map();
  if (coachIds.length > 0) {
    const coaches = await Coach.find({ _id: { $in: coachIds } }).select('name').lean();
    coaches.forEach(c => coachMap.set(String(c._id), c));
  }

  const classes = [];
  const orphans = [];
  for (const g of grouped) {
    const sid = String(g._id);
    const schedule = scheduleMap.get(sid);
    const coachId = g.coach_id ? String(g.coach_id)
      : (schedule && schedule.coach_id ? String(schedule.coach_id._id) : null);
    const coachName = g.coach_name
      || (coachId && coachMap.get(coachId) ? coachMap.get(coachId).name : '')
      || (schedule && schedule.coach_id ? schedule.coach_id.name : '')
      || '未知教练';
    const storeId = g.store_id ? String(g.store_id)
      : (schedule && schedule.store_id ? String(schedule.store_id._id) : null);
    const storeName = g.store_name
      || (schedule && schedule.store_id ? schedule.store_id.name : '')
      || '未知门店';

    const entry = {
      schedule_id: sid,
      coach_id: coachId,
      coach_name: coachName,
      store_id: storeId,
      store_name: storeName,
      date: g.date || (schedule ? schedule.date : null),
      course_name: g.course_name || (schedule ? schedule.course_name : '') || '未知课程',
      start_time: g.start_time || (schedule ? schedule.start_time : '') || '',
      end_time: g.end_time || (schedule ? schedule.end_time : '') || '',
      duration: g.duration || (schedule ? schedule.duration : 0) || 75,
      attendance_count: g.attendance_count || 0,
    };

    if (!entry.date) {
      orphans.push({ ...entry, reason: 'missing_date' });
    } else if (!schedule) {
      // 排课已被物理删除：签到虽真实但无法定位课程，单独列出供人工处理
      orphans.push({ ...entry, reason: 'schedule_missing' });
    } else {
      classes.push(entry);
    }
  }

  classes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { classes, orphans };
}

// ============================================================
// 费率解析：按上课日期匹配当时生效的费率版本
// 匹配顺序（不再有"任意时长/任意门店"兜底，配不上按 ¥0 并返回警告）：
//   1. exact   门店专属 + 时长精确
//   2. generic 多门店通用（store_id=null）+ 时长精确
//   3. duration_mismatch / none → rate 0
// ============================================================

function buildRateResolver(configs) {
  // key: `${coach_id}|${store_id或空}|${duration}` → 版本行数组
  const groups = new Map();
  const knownCoaches = new Set();
  configs.forEach(cfg => {
    const cid = String(cfg.coach_id);
    knownCoaches.add(cid);
    const key = `${cid}|${cfg.store_id ? String(cfg.store_id) : ''}|${cfg.duration}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: cfg._id,
      rate: cfg.salary_rate,
      from: dateOnly(cfg.effective_from),
      to: cfg.effective_to ? dateOnly(cfg.effective_to) : null,
    });
  });

  const covers = (v, t) => v.from <= t && (!v.to || v.to > t);
  const pickLatest = (arr, t) => {
    let best = null;
    (arr || []).forEach(v => {
      if (covers(v, t) && (!best || v.from > best.from)) best = v;
    });
    return best;
  };

  const resolve = function resolveRate(coachId, storeId, duration, classDate) {
    const cid = String(coachId);
    const sid = storeId ? String(storeId) : null;
    let hit = sid ? pickLatest(groups.get(`${cid}|${sid}|${duration}`), classDate) : null;
    if (hit) return { rate: hit.rate, matched: 'exact', salary_config_id: hit.id };

    hit = pickLatest(groups.get(`${cid}||${duration}`), classDate);
    if (hit) return { rate: hit.rate, matched: 'generic', salary_config_id: hit.id };

    // 区分"有配置但时长对不上"和"该教练当日完全无配置"
    let hasAny = false;
    groups.forEach((arr, key) => {
      if (hasAny || key.split('|')[0] !== cid) return;
      if (pickLatest(arr, classDate)) hasAny = true;
    });
    return { rate: 0, matched: hasAny ? 'duration_mismatch' : 'none', salary_config_id: null };
  };
  resolve.hasAnyConfig = (coachId) => knownCoaches.has(String(coachId));
  return resolve;
}

/**
 * 加载涉及教练的全部费率配置（含历史版本行，不含 is_active 过滤）
 * 历史版本按生效区间参与匹配；is_active 只约束"同 key 启用行唯一"
 */
async function loadRateResolverForCoaches(coachIds) {
  const ids = [...new Set((coachIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return buildRateResolver([]);
  const configs = await CoachSalary.find({ coach_id: { $in: ids } })
    .sort({ effective_from: 1 })
    .lean();
  return buildRateResolver(configs);
}

async function getOperatorName(operatorId) {
  if (!operatorId) return '系统';
  const operator = await User.findById(operatorId);
  return operator ? (operator.nick_name || operator.username || '未知') : '未知';
}

// 纠错重算：某费率版本名下已入账的课薪台账按新单价更新，并重建涉及账单的金额
async function recalcLedgerForConfig(configId, newRate) {
  const rows = await CoachSalaryStat.find({ salary_config_id: configId, status: 'active' })
    .select('_id bill_id').lean();
  if (rows.length === 0) return { ledgerCount: 0, billIds: [] };

  await CoachSalaryStat.updateMany(
    { salary_config_id: configId, status: 'active' },
    { $set: { salary_rate: newRate, total_salary: newRate } }
  );

  const billIds = [...new Set(rows.map(r => r.bill_id).filter(Boolean).map(String))];
  for (const billId of billIds) {
    await rebuildBillFromLedger(billId);
  }
  return { ledgerCount: rows.length, billIds };
}

// 按课薪台账重建账单的教练明细与总额（纠错后账单随新单价更新）
async function rebuildBillFromLedger(billId) {
  const bill = await SalaryBill.findById(billId);
  if (!bill) return;
  const ledger = await CoachSalaryStat.find({ bill_id: billId, status: 'active' }).lean();
  if (ledger.length === 0) return;

  const coachIds = [...new Set(ledger.map(l => String(l.coach_id)))];
  const storeIds = [...new Set(ledger.map(l => (l.store_id ? String(l.store_id) : null)).filter(Boolean))];
  const [coaches, stores] = await Promise.all([
    Coach.find({ _id: { $in: coachIds } }).select('name').lean(),
    storeIds.length > 0 ? Store.find({ _id: { $in: storeIds } }).select('name').lean() : Promise.resolve([]),
  ]);
  const coachNameMap = new Map(coaches.map(c => [String(c._id), c.name]));
  const storeNameMap = new Map(stores.map(s => [String(s._id), s.name]));

  const coachMap = {};
  ledger.forEach(l => {
    const cid = String(l.coach_id);
    if (!coachMap[cid]) {
      coachMap[cid] = { coach_id: l.coach_id, coach_name: coachNameMap.get(cid) || '未知教练', itemsMap: {} };
    }
    const itemKey = `${l.store_id || ''}|${l.duration}|${l.salary_rate}`;
    if (!coachMap[cid].itemsMap[itemKey]) {
      coachMap[cid].itemsMap[itemKey] = {
        duration: l.duration,
        store_id: l.store_id || null,
        store_name: l.store_id ? (storeNameMap.get(String(l.store_id)) || '未知门店') : '',
        count: 0,
        rate: l.salary_rate,
        amount: 0,
      };
    }
    const item = coachMap[cid].itemsMap[itemKey];
    item.count += 1;
    item.amount += l.total_salary;
  });

  const coachesOut = Object.values(coachMap).map(c => {
    const items = Object.values(c.itemsMap).map(i => ({ ...i, amount: Math.round(i.amount * 100) / 100 }));
    return {
      coach_id: c.coach_id,
      coach_name: c.coach_name,
      items,
      total_amount: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100,
    };
  });

  bill.coaches = coachesOut;
  bill.coach_count = coachesOut.length;
  bill.total_amount = Math.round(coachesOut.reduce((s, c) => s + c.total_amount, 0) * 100) / 100;
  await bill.save();
}

// ============================================================
// 薪酬配置 CRUD（费率版本化）
// ============================================================

// 获取教练薪酬配置列表
exports.getCoachSalaryList = async (query, reqUser) => {
  const { coach_id, store_id, is_active, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (coach_id) filter.coach_id = coach_id;

  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds === null) {
    if (store_id) filter.store_id = store_id;
  } else {
    if (allowedStoreIds.length === 0) {
      filter._id = { $exists: false };
    } else {
      filter.store_id = { $in: allowedStoreIds };
    }
  }

  if (is_active !== undefined) {
    // is_active=all 返回全部版本（含已停用的历史版本），供配置页展示各时期单价
    if (is_active === 'all') {
      delete filter.is_active;
    } else {
      filter.is_active = is_active === 'true';
    }
  } else {
    filter.is_active = true;
  }

  const list = await CoachSalary.find(filter)
    .populate('coach_id', 'name is_deleted')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await CoachSalary.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取教练薪酬配置详情
exports.getCoachSalaryById = async (id, reqUser) => {
  const salary = await CoachSalary.findById(id)
    .populate('coach_id', 'name is_deleted')
    .populate('store_id', 'name')
    .populate('created_by', 'nick_name');
  if (!salary) throw new Error('薪酬配置不存在');
  assertCanManageSalary(salary, reqUser, '查看');
  return salary;
};

// 创建教练薪酬配置（每个教练+门店+时长只允许一条启用中的版本，历史版本由改价自动产生）
exports.createCoachSalary = async (data, operatorId, reqUser) => {
  const { coach_id, duration, salary_rate, effective_from, remark } = data;

  if (!coach_id) throw new Error('教练ID不能为空');
  if (!duration || duration <= 0) throw new Error('课程时长必须大于0');
  if (salary_rate === undefined || salary_rate < 0) throw new Error('薪酬标准不能为负数');

  // 计算 store_id：超管可用 data.store_id（含 null=多门店通用）；店长/员工限所属门店
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  let finalStoreId;
  if (allowedStoreIds === null) {
    finalStoreId = data.store_id || null;
  } else if (allowedStoreIds.length === 0) {
    throw new Error('您的账号未分配门店，无法创建薪酬配置');
  } else {
    const requested = data.store_id ? String(data.store_id) : null;
    if (requested) {
      if (!allowedStoreIds.includes(requested)) {
        throw new Error('无权为非所属门店创建薪酬配置');
      }
      finalStoreId = requested;
    } else if (allowedStoreIds.length === 1) {
      finalStoreId = allowedStoreIds[0];
    } else {
      throw new Error('请选择薪酬配置所属门店');
    }
  }

  // 超管可为已删除教练补配历史费率；店长/员工只能为所属门店教练创建
  const coach = await Coach.findById(coach_id).select('name store_ids is_deleted');
  if (!coach) throw new Error('教练不存在');
  if (coach.is_deleted && allowedStoreIds !== null) {
    throw new Error(`教练"${coach.name}"已删除，历史费率补配仅超级管理员可操作`);
  }
  if (allowedStoreIds !== null) {
    const storeIds = coach.store_ids;
    if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
      throw new Error(`多门店执教教练"${coach.name}"的薪酬配置仅超级管理员可配置`);
    }
    const isSubset = storeIds.every(s => allowedStoreIds.includes(String(s)));
    if (!isSubset) {
      throw new Error(`无权配置非所属门店教练"${coach.name}"的薪酬`);
    }
  }

  // 时间线插入：同一教练+门店+时长可设多期单价（历史/当前/未来），
  // 保证任一日期都有唯一生效单价。新期日期落在哪里决定衔接方式：
  //   晚于当前期起点 → 关闭当前期，新期从该日期起生效（正常调价）
  //   落在某历史期区间内 → 拆分该历史期
  //   早于所有期/落在空档 → 前插一期，截止到下一期起点
  const newFrom = dateOnly(effective_from ? new Date(effective_from) : new Date());
  const rows = await CoachSalary.find({ coach_id, duration, store_id: finalStoreId })
    .sort({ effective_from: 1 }).lean();

  let salaryData;
  if (rows.length === 0) {
    salaryData = {
      coach_id,
      store_id: finalStoreId,
      duration: Number(duration),
      salary_rate: Number(salary_rate),
      effective_from: new Date(newFrom),
      effective_to: null,
      is_active: true,
      remark,
      created_by: operatorId,
    };
  } else {
    const sameStart = rows.find(r => dateOnly(r.effective_from) === newFrom);
    if (sameStart) {
      throw new Error(`该教练 ${duration}分钟 在 ${newFrom} 已有单价版本（¥${sameStart.salary_rate}/节），请直接修改那一期的单价`);
    }
    const activeRow = rows.find(r => r.is_active);
    if (activeRow && newFrom >= dateOnly(activeRow.effective_from)) {
      await CoachSalary.updateOne(
        { _id: activeRow._id },
        { $set: { is_active: false, effective_to: new Date(newFrom) } }
      );
      salaryData = {
        coach_id,
        store_id: finalStoreId,
        duration: Number(duration),
        salary_rate: Number(salary_rate),
        effective_from: new Date(newFrom),
        effective_to: null,
        is_active: true,
        remark,
        created_by: operatorId,
      };
    } else {
      const covering = rows.find(r => !r.is_active &&
        dateOnly(r.effective_from) <= newFrom && r.effective_to && newFrom < dateOnly(r.effective_to));
      if (covering) {
        await CoachSalary.updateOne(
          { _id: covering._id },
          { $set: { effective_to: new Date(newFrom) } }
        );
        salaryData = {
          coach_id,
          store_id: finalStoreId,
          duration: Number(duration),
          salary_rate: Number(salary_rate),
          effective_from: new Date(newFrom),
          effective_to: covering.effective_to,
          is_active: false,
          remark,
          created_by: operatorId,
        };
      } else {
        const next = rows.find(r => dateOnly(r.effective_from) > newFrom);
        salaryData = {
          coach_id,
          store_id: finalStoreId,
          duration: Number(duration),
          salary_rate: Number(salary_rate),
          effective_from: new Date(newFrom),
          effective_to: next ? next.effective_from : null,
          is_active: !next,
          remark,
          created_by: operatorId,
        };
      }
    }
  }

  const salary = await CoachSalary.create(salaryData);

  try {
    const operatorName = await getOperatorName(operatorId);
    await logService.createLog({
      operator_id: operatorId,
      operator_name: operatorName,
      action: 'create',
      module: 'coach_salary',
      target_id: salary._id,
      detail: `创建教练薪酬配置: ${coach.name}, 时长${duration}分钟, 标准${salary_rate}元/节`,
      store_id: finalStoreId,
    });
  } catch (logErr) {
    console.error('[createCoachSalary] 记录操作日志失败:', logErr.message);
  }

  return await CoachSalary.findById(salary._id)
    .populate('coach_id', 'name is_deleted')
    .populate('store_id', 'name');
};

/**
 * 编辑某一期单价时期（开始/结束日期与单价均可改）
 * 规则：
 * - 开始日期必须晚于上一时期的开始、早于下一时期的开始（保持时间线顺序）
 * - 结束日期留空 = 长期有效；仅当该期是最后一期时允许留空
 * - 结束日期必须晚于开始日期，且不超过下一时期的开始（允许留空档，空档期课程按未配置计并提示）
 * - 单价变更时，该期已入账的课薪台账与账单按新单价重算；日期变更只影响后续解析，不回溯台账
 */
exports.updateCoachSalary = async (id, data, operatorId, reqUser) => {
  const salary = await CoachSalary.findById(id);
  if (!salary) throw new Error('薪酬配置不存在');
  assertCanManageSalary(salary, reqUser, '编辑');

  const { salary_rate, effective_from, effective_to, remark } = data || {};

  // 解析新日期（未传的字段保持原值）
  let newFrom = salary.effective_from;
  if (effective_from !== undefined && effective_from !== null && effective_from !== '') {
    newFrom = new Date(effective_from);
  }
  let newTo = salary.effective_to;
  if (effective_to !== undefined) {
    newTo = effective_to === null || effective_to === '' ? null : new Date(effective_to);
  }

  const prev = await CoachSalary.findOne({
    coach_id: salary.coach_id,
    store_id: salary.store_id,
    duration: salary.duration,
    effective_from: { $lt: salary.effective_from },
  }).sort({ effective_from: -1 });
  const next = await CoachSalary.findOne({
    coach_id: salary.coach_id,
    store_id: salary.store_id,
    duration: salary.duration,
    effective_from: { $gt: salary.effective_from },
  }).sort({ effective_from: 1 });

  // 校验（只校验传入的字段，全部通过后一次写回）
  if (next && newTo === null) {
    throw new Error(`后面还有时期（自 ${dateOnly(next.effective_from)} 起），该期结束日期不能留空；如需延长请编辑下一期的开始日期`);
  }
  if (newTo && dateOnly(newTo) <= dateOnly(newFrom)) {
    throw new Error('结束日期必须晚于开始日期');
  }
  if (effective_from !== undefined && effective_from !== null && effective_from !== '') {
    const fromD = dateOnly(newFrom);
    if (prev && fromD <= dateOnly(prev.effective_from)) {
      throw new Error(`开始日期需晚于上一时期的开始日期（${dateOnly(prev.effective_from)}）`);
    }
    if (next && fromD >= dateOnly(next.effective_from)) {
      throw new Error(`开始日期需早于下一时期的开始日期（${dateOnly(next.effective_from)}）`);
    }
  }
  if (newTo && next && dateOnly(newTo) > dateOnly(next.effective_from)) {
    throw new Error(`结束日期不能晚于下一时期的开始日期（${dateOnly(next.effective_from)}），如需调整请编辑下一期的开始日期`);
  }

  const oldRate = salary.salary_rate;
  const oldFrom = dateOnly(salary.effective_from);
  const oldTo = salary.effective_to ? dateOnly(salary.effective_to) : null;
  const newRate = Math.round(Number(salary_rate) * 100) / 100;
  if (salary_rate !== undefined && (isNaN(newRate) || newRate < 0)) {
    throw new Error('请输入有效的薪酬标准（不能为负数）');
  }

  const fromChanged = dateOnly(newFrom) !== oldFrom;
  const toChanged = (newTo ? dateOnly(newTo) : null) !== oldTo;
  const rateChanged = salary_rate !== undefined && newRate !== oldRate;

  if (!fromChanged && !toChanged && !rateChanged && remark === undefined) {
    return await CoachSalary.findById(id)
      .populate('coach_id', 'name is_deleted')
      .populate('store_id', 'name');
  }

  salary.effective_from = newFrom;
  salary.effective_to = newTo;
  // 是否当前期 = 是最后一期且无结束日期
  salary.is_active = !next && newTo === null;
  if (salary_rate !== undefined) salary.salary_rate = newRate;
  if (remark !== undefined) salary.remark = remark;
  await salary.save();

  let recalc = { ledgerCount: 0, billIds: [] };
  if (rateChanged) recalc = await recalcLedgerForConfig(salary._id, newRate);

  const periodStr = `${oldFrom} ~ ${oldTo || '至今'}`;
  const newPeriodStr = `${dateOnly(newFrom)} ~ ${newTo ? dateOnly(newTo) : '至今'}`;
  const operatorName = await getOperatorName(operatorId);
  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'update',
    module: 'coach_salary',
    target_id: salary._id,
    detail: `编辑单价时期: ${salary.duration}分钟 ${periodStr} → ${newPeriodStr}` +
      (rateChanged ? `，单价 ${oldRate}元 → ${newRate}元/节` : '') +
      (recalc.ledgerCount > 0 ? `，已重算 ${recalc.ledgerCount} 条课薪台账、${recalc.billIds.length} 张账单` : ''),
    store_id: salary.store_id,
  });

  return await CoachSalary.findById(id)
    .populate('coach_id', 'name is_deleted')
    .populate('store_id', 'name');
};

/**
 * 删除某一期单价（该期存在已入账课程时拒绝）
 * 删除后与前一版衔接（被删的是最后一期且无截止 → 前一期重新开放至至今），保持时间线连续
 */
exports.deleteCoachSalary = async (id, operatorId, reqUser) => {
  const salary = await CoachSalary.findById(id);
  if (!salary) throw new Error('薪酬配置不存在');
  assertCanManageSalary(salary, reqUser, '删除');

  const ledgerCount = await CoachSalaryStat.countDocuments({ salary_config_id: id, status: 'active' });
  if (ledgerCount > 0) {
    throw new Error(`该时期已有 ${ledgerCount} 节入账课程，不能删除该期单价；如需调整金额请直接编辑那一期的单价`);
  }

  const periodStr = `${dateOnly(salary.effective_from)} ~ ${salary.effective_to ? dateOnly(salary.effective_to) : '至今'}`;

  // 先删后改（避免与"同key仅一条启用版本"的部分唯一索引冲突）
  await CoachSalary.deleteOne({ _id: id });

  const prev = await CoachSalary.findOne({
    coach_id: salary.coach_id,
    store_id: salary.store_id,
    duration: salary.duration,
    effective_from: { $lt: salary.effective_from },
  }).sort({ effective_from: -1 });
  if (prev) {
    // 仅当衔接后不会产生"结束早于开始"的倒挂时才合并（历史脏数据防御）
    const mergedTo = salary.effective_to || null;
    if (!mergedTo || dateOnly(mergedTo) > dateOnly(prev.effective_from)) {
      prev.effective_to = mergedTo;
      prev.is_active = !mergedTo;
      await prev.save();
    }
  }

  const operatorName = await getOperatorName(operatorId);
  await logService.createLog({
    operator_id: operatorId,
    operator_name: operatorName,
    action: 'delete',
    module: 'coach_salary',
    target_id: id,
    detail: `删除单价时期: ${salary.duration}分钟 ¥${salary.salary_rate}/节（${periodStr}）` +
      (prev ? '，前一版已自动衔接' : ''),
    store_id: salary.store_id,
  });

  return { success: true };
};

// 批量删除教练薪酬配置（删除该教练的所有时长配置）
exports.batchDeleteCoachSalary = async (ids, operatorId, reqUser) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('请提供要删除的配置ID');
  }

  const operatorName = await getOperatorName(operatorId);
  const effectiveTo = dayjs().tz(BEIJING_TZ).add(1, 'day').toDate();

  const results = [];
  for (const id of ids) {
    try {
      const salary = await CoachSalary.findById(id);
      if (!salary) {
        results.push({ id, success: false, message: '配置不存在' });
        continue;
      }
      assertCanManageSalary(salary, reqUser, '删除');
      salary.is_active = false;
      salary.effective_to = effectiveTo;
      await salary.save();

      await logService.createLog({
        operator_id: operatorId,
        operator_name: operatorName,
        action: 'delete',
        module: 'coach_salary',
        target_id: id,
        detail: `批量删除教练薪酬配置（${dateOnly(effectiveTo)} 起失效，历史课程不受影响）`,
        store_id: salary.store_id,
      });

      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, message: err.message });
    }
  }

  const failedCount = results.filter(r => !r.success).length;
  return { success: failedCount === 0, results, failedCount };
};

// ============================================================
// 课时统计（基于上课事实聚合，按年加载）
// ============================================================

/**
 * 课时单价空档检测：有已上课但该日期没有匹配到任何生效单价。
 * 供薪酬配置页提示管理员"哪个时间段缺配置"。
 * 按 教练+时长+门店 归并空档，返回涉及的日期范围与课次。
 */
exports.getRateGaps = async (query, reqUser) => {
  const year = parseInt(query.year, 10) || currentYear();
  const { classes } = await aggregateTaughtClasses({
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    reqUser,
    store_id: query.store_id,
  });
  if (classes.length === 0) return { year, gaps: [] };

  const resolve = await loadRateResolverForCoaches(classes.map(c => c.coach_id).filter(Boolean));

  const gapMap = {};
  classes.forEach(cls => {
    if (!cls.coach_id) return;
    const r = resolve(cls.coach_id, cls.store_id, cls.duration, cls.date);
    if (r.matched === 'exact' || r.matched === 'generic') return;
    const key = `${cls.coach_id}|${cls.duration}|${cls.store_id || ''}`;
    if (!gapMap[key]) {
      gapMap[key] = {
        coach_id: cls.coach_id,
        coach_name: cls.coach_name,
        duration: cls.duration,
        store_id: cls.store_id,
        store_name: cls.store_name,
        from: cls.date,
        to: cls.date,
        count: 0,
        matched: r.matched,
      };
    }
    const g = gapMap[key];
    if (cls.date < g.from) g.from = cls.date;
    if (cls.date > g.to) g.to = cls.date;
    g.count += 1;
  });

  const gaps = Object.values(gapMap).sort((a, b) => (a.from < b.from ? -1 : 1));
  return { year, gaps };
};

/**
 * 获取教练课时统计（按月份分组，按教练分组，按门店分组）
 * @param {Object} query - { year?, coach_id?, store_id? }
 * @returns 逐课明细由 getClassHoursDetail 懒加载
 */
exports.getClassHoursStats = async (query, reqUser) => {
  const { coach_id, store_id } = query;
  const year = parseInt(query.year, 10) || currentYear();

  const { classes, orphans } = await aggregateTaughtClasses({
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    coach_id, store_id, reqUser,
  });

  // 年→月→教练→门店 分组
  const monthsMap = {};
  classes.forEach(cls => {
    const monthKey = cls.date.slice(5, 7);
    if (!monthsMap[monthKey]) {
      monthsMap[monthKey] = { monthKey, monthLabel: `${parseInt(monthKey, 10)}月`, coachesMap: {} };
    }
    const month = monthsMap[monthKey];
    if (!month.coachesMap[cls.coach_id]) {
      month.coachesMap[cls.coach_id] = {
        coach_id: cls.coach_id,
        coach_name: cls.coach_name,
        storesMap: {},
      };
    }
    const coach = month.coachesMap[cls.coach_id];
    if (!coach.storesMap[cls.store_id || '_none']) {
      coach.storesMap[cls.store_id || '_none'] = {
        store_id: cls.store_id,
        store_name: cls.store_name,
        durationsMap: {},
        total_classes: 0,
      };
    }
    const store = coach.storesMap[cls.store_id || '_none'];
    store.total_classes += 1;
    if (!store.durationsMap[cls.duration]) store.durationsMap[cls.duration] = { duration: cls.duration, count: 0 };
    store.durationsMap[cls.duration].count += 1;
  });

  const months = Object.values(monthsMap)
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map(m => ({
      monthKey: m.monthKey,
      monthLabel: m.monthLabel,
      coaches: Object.values(m.coachesMap)
        .map(c => {
          const stores = Object.values(c.storesMap)
            .map(s => ({
              store_id: s.store_id,
              store_name: s.store_name,
              total_classes: s.total_classes,
              durations: Object.values(s.durationsMap).sort((a, b) => a.duration - b.duration),
            }))
            .sort((a, b) => b.total_classes - a.total_classes);
          return {
            coach_id: c.coach_id,
            coach_name: c.coach_name,
            total_classes: stores.reduce((sum, s) => sum + s.total_classes, 0),
            stores,
          };
        })
        .sort((a, b) => b.total_classes - a.total_classes),
    }));

  const totalClasses = months.reduce((sum, m) => sum + m.coaches.reduce((s, c) => s + c.total_classes, 0), 0);

  return {
    year,
    months,
    orphan_count: orphans.length,
    orphans: orphans.slice(0, 20),
    summary: { year, total_classes: totalClasses },
  };
};

/**
 * 课时统计逐课明细（展开教练卡片时懒加载）
 * @param {Object} query - { year, month('01'-'12'), coach_id, store_id? }
 */
exports.getClassHoursDetail = async (query, reqUser) => {
  const { coach_id, store_id } = query;
  const year = parseInt(query.year, 10);
  const month = String(query.month || '').padStart(2, '0');
  if (!year || !month || !coach_id) throw new Error('缺少必要参数（year/month/coach_id）');

  // 用当月上界 31 做字符串上界（'YYYY-MM-DD' 字典序，任意月份都成立）
  const { classes } = await aggregateTaughtClasses({
    start_date: `${year}-${month}-01`,
    end_date: `${year}-${month}-31`,
    coach_id, store_id, reqUser,
  });

  return {
    records: classes.map(cls => ({
      class_date: cls.date,
      weekday: weekdayOf(cls.date),
      start_time: cls.start_time,
      end_time: cls.end_time,
      duration: cls.duration,
      attendance_count: cls.attendance_count,
      store_name: cls.store_name,
      course_name: cls.course_name,
    })),
  };
};

// ============================================================
// 月度薪酬明细（上课事实 × 按上课日期解析的费率，实时重算）
// ============================================================

exports.getMonthlySalaryBreakdown = async (query, reqUser) => {
  const { coach_id, store_id } = query;
  const year = parseInt(query.year, 10) || currentYear();

  const { classes, orphans } = await aggregateTaughtClasses({
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    coach_id, store_id, reqUser,
  });

  const coachIds = classes.map(c => c.coach_id).filter(Boolean);
  const resolve = await loadRateResolverForCoaches(coachIds);

  // 月→教练→(门店×时长×费率版本) 行；同月内费率调整会产生多行，保证金额准确
  const monthsMap = {};
  classes.forEach(cls => {
    if (!cls.coach_id) return;
    const monthKey = cls.date.slice(5, 7);
    if (!monthsMap[monthKey]) {
      monthsMap[monthKey] = { monthKey, monthLabel: `${parseInt(monthKey, 10)}月`, coachesMap: {} };
    }
    const month = monthsMap[monthKey];
    if (!month.coachesMap[cls.coach_id]) {
      month.coachesMap[cls.coach_id] = {
        coach_id: cls.coach_id,
        coach_name: cls.coach_name,
        rowsMap: {},
      };
    }
    const coach = month.coachesMap[cls.coach_id];

    const r = resolve(cls.coach_id, cls.store_id, cls.duration, cls.date);
    const rowKey = `${cls.store_id || ''}|${cls.duration}|${r.salary_config_id || r.matched}`;
    if (!coach.rowsMap[rowKey]) {
      coach.rowsMap[rowKey] = {
        duration: cls.duration,
        store_id: cls.store_id,
        store_name: cls.store_name,
        matched: r.matched,
        rate: r.rate,
        amount: 0,
        count: 0,
      };
    }
    const row = coach.rowsMap[rowKey];
    row.count += 1;
    row.amount += r.rate;
  });

  const months = Object.values(monthsMap)
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map(m => {
      const coaches = Object.values(m.coachesMap)
        .map(c => {
          const durations = Object.values(c.rowsMap)
            .map(r => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
            .sort((a, b) => a.duration - b.duration || (a.store_name || '').localeCompare(b.store_name || ''));
          const warnings = durations
            .filter(r => r.matched === 'duration_mismatch' || r.matched === 'none')
            .map(r => r.matched === 'duration_mismatch'
              ? `「${c.coach_name}」${r.duration}分钟课程（${r.store_name}）无对应时长配置，按 ¥0 计`
              : `「${c.coach_name}」${r.store_name}截至当月无生效薪酬配置，按 ¥0 计`);
          const total_amount = Math.round(durations.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
          return {
            coach_id: c.coach_id,
            coach_name: c.coach_name,
            durations,
            warnings,
            total_amount,
            has_salary_config: resolve.hasAnyConfig(c.coach_id),
          };
        })
        .sort((a, b) => b.total_amount - a.total_amount);

      return {
        monthKey: m.monthKey,
        monthLabel: m.monthLabel,
        totalAmount: Math.round(coaches.reduce((sum, c) => sum + c.total_amount, 0) * 100) / 100,
        coaches,
      };
    });

  return {
    year,
    months,
    orphan_count: orphans.length,
    orphans: orphans.slice(0, 20),
  };
};

// ============================================================
// 账单（结算凭证）：预览/生成，逐课写台账
// ============================================================

/**
 * 生成薪酬账单
 * - 只包含"未入账"的课程（已入账的跳过并在结果中提示），结构性避免重复结算
 * - 未匹配到费率配置的课程不入账（按 ¥0 列入 warnings），补配置后重新生成即可补上
 * - 生成时逐课写课薪台账（费率快照），删除账单会作废台账
 */
exports.generateSalaryBill = async (startDate, endDate, preview = false, operatorId = null, coachIds = null, reqUser = null, storeId = null) => {
  const allowedStoreIds = reqUser ? getAllowedStoreIds(reqUser) : null;

  const { classes, orphans } = await aggregateTaughtClasses({
    start_date: startDate,
    end_date: endDate,
    reqUser,
    store_id: storeId,
  });

  let pool = classes;
  if (coachIds && Array.isArray(coachIds) && coachIds.length > 0) {
    const wanted = coachIds.map(String);
    pool = pool.filter(c => c.coach_id && wanted.includes(String(c.coach_id)));
  }

  // 已入账的课程跳过（不重复结算）
  const poolIds = pool.map(c => c.schedule_id);
  const ledgered = poolIds.length > 0
    ? await CoachSalaryStat.find({ schedule_id: { $in: poolIds }, status: 'active' }).select('schedule_id').lean()
    : [];
  const ledgeredSet = new Set(ledgered.map(l => String(l.schedule_id)));
  const toBill = pool.filter(c => !ledgeredSet.has(c.schedule_id));
  const skippedCount = pool.length - toBill.length;

  const resolve = await loadRateResolverForCoaches(toBill.map(c => c.coach_id).filter(Boolean));

  const coachAgg = {};
  const warnings = [];
  const unresolved = []; // 未匹配费率的课（不入账，供补配置后重新生成）
  // 未入账按 教练+时长+门店 归并，供前端折叠展示
  const unresolvedGroupMap = {};
  const addUnresolved = (cls, matched, reason) => {
    const key = `${cls.coach_id || '_'}|${cls.duration}|${cls.store_id || ''}|${matched}`;
    if (!unresolvedGroupMap[key]) {
      unresolvedGroupMap[key] = {
        coach_id: cls.coach_id || null,
        coach_name: cls.coach_name,
        duration: cls.duration,
        store_id: cls.store_id || null,
        store_name: cls.store_name,
        matched,
        reason,
        from: cls.date,
        to: cls.date,
        count: 0,
      };
    }
    const grp = unresolvedGroupMap[key];
    if (cls.date < grp.from) grp.from = cls.date;
    if (cls.date > grp.to) grp.to = cls.date;
    grp.count += 1;
  };

  for (const cls of toBill) {
    if (!cls.coach_id) {
      warnings.push(`${cls.date} ${cls.course_name}：签到记录缺少教练信息，未计薪`);
      addUnresolved(cls, 'no_coach', '签到记录缺少教练信息');
      unresolved.push(cls);
      continue;
    }
    const r = resolve(cls.coach_id, cls.store_id, cls.duration, cls.date);
    if (r.matched !== 'exact' && r.matched !== 'generic') {
      if (r.matched === 'duration_mismatch') {
        warnings.push(`教练「${cls.coach_name}」：${cls.duration}分钟课程无对应薪酬配置（${cls.date} ${cls.store_name}），按 ¥0 计，未入账`);
      } else {
        warnings.push(`教练「${cls.coach_name}」：截至 ${cls.date} 无生效薪酬配置（${cls.store_name}），按 ¥0 计，未入账`);
      }
      addUnresolved(cls, r.matched, r.matched === 'duration_mismatch' ? `${cls.duration}分钟无对应时长的配置` : '该日期无生效薪酬配置');
      unresolved.push(cls);
      continue;
    }

    if (!coachAgg[cls.coach_id]) {
      coachAgg[cls.coach_id] = { coach_id: cls.coach_id, coach_name: cls.coach_name, itemsMap: {} };
    }
    const coach = coachAgg[cls.coach_id];
    const itemKey = `${cls.store_id || ''}|${cls.duration}|${r.salary_config_id}`;
    if (!coach.itemsMap[itemKey]) {
      coach.itemsMap[itemKey] = {
        duration: cls.duration,
        store_id: cls.store_id || null,
        store_name: cls.store_name,
        rate: r.rate,
        amount: 0,
        count: 0,
        schedule_ids: [],
        cls_list: [],
      };
    }
    const item = coach.itemsMap[itemKey];
    item.count += 1;
    item.amount += r.rate;
    item.schedule_ids.push(cls.schedule_id);
    item.cls_list.push({ cls, r });
  }

  let totalAmount = 0;
  const unresolvedGroups = Object.values(unresolvedGroupMap);
  const bill = Object.values(coachAgg).map(coach => {
    const items = Object.values(coach.itemsMap).map(it => ({
      duration: it.duration,
      store_id: it.store_id,
      store_name: it.store_name,
      count: it.count,
      rate: it.rate,
      amount: Math.round(it.amount * 100) / 100,
      schedule_ids: it.schedule_ids,
      cls_list: it.cls_list,
    }));
    const coachTotal = Math.round(items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
    totalAmount += coachTotal;
    return { coach_id: coach.coach_id, coach_name: coach.coach_name, items, total_amount: coachTotal };
  });

  // 账单归属门店：显式选择 > 单门店角色所属门店 > 跨店（null，仅超管或多门店店长）
  let billStoreId = null;
  if (storeId) {
    billStoreId = storeId;
  } else if (allowedStoreIds !== null && allowedStoreIds.length === 1) {
    billStoreId = allowedStoreIds[0];
  }

  if (!preview && operatorId) {
    const operatorName = await getOperatorName(operatorId);

    const billDoc = await SalaryBill.create({
      store_id: billStoreId,
      start_date: new Date(startDate),
      end_date: new Date(endDate),
      coaches: bill.map(c => ({
        coach_id: c.coach_id,
        coach_name: c.coach_name,
        items: c.items.map(i => ({
          duration: i.duration,
          store_id: i.store_id,
          store_name: i.store_name,
          count: i.count,
          rate: i.rate,
          amount: i.amount,
        })),
        total_amount: c.total_amount,
      })),
      warnings,
      unresolved_groups: unresolvedGroups,
      skipped_count: skippedCount,
      total_amount: totalAmount,
      coach_count: bill.length,
      generated_by: operatorId,
    });

    // 逐课写台账（费率快照）
    for (const coach of bill) {
      for (const item of coach.items) {
        for (const { cls, r } of item.cls_list) {
          await CoachSalaryStat.create({
            coach_id: cls.coach_id,
            store_id: cls.store_id || null,
            schedule_id: cls.schedule_id,
            bill_id: billDoc._id,
            class_date: new Date(cls.date),
            duration: cls.duration,
            attendance_count: cls.attendance_count,
            salary_rate: r.rate,
            total_salary: r.rate,
            salary_config_id: r.salary_config_id,
            status: 'active',
            remark: `账单生成于 ${new Date().toISOString()}`,
          });
        }
      }
    }

    await logService.createLog({
      operator_id: operatorId,
      operator_name: operatorName,
      action: 'generate_bill',
      module: 'coach_salary_stat',
      target_id: billDoc._id,
      detail: `批量生成薪酬账单: ${startDate} ~ ${endDate}, 共${bill.length}位教练, 总计${totalAmount}元` +
        (skippedCount > 0 ? `（${skippedCount}节课已入账跳过）` : ''),
      store_id: billStoreId,
    });
  }

  // cls_list 仅内部使用，不外发
  bill.forEach(c => c.items.forEach(i => { delete i.cls_list; }));

  return {
    bill,
    warnings,
    unresolved_groups: unresolvedGroups,
    skipped_count: skippedCount,
    unresolved_count: unresolved.length,
    orphan_count: orphans.length,
    total_amount: totalAmount,
  };
};

// ============================================================
// 账单列表 / 详情 / 删除
// ============================================================

/**
 * 获取账单列表
 * 门店隔离：店长/员工可见所属门店的账单，以及自己生成的跨店账单；超管看全部
 */
exports.getBillList = async (query, reqUser) => {
  const { page = 1, pageSize = 20, store_id } = query;

  const allowedStoreIds = getAllowedStoreIds(reqUser);
  const filter = {};
  if (allowedStoreIds !== null) {
    if (!allowedStoreIds || allowedStoreIds.length === 0) {
      return { list: [], total: 0, page: Number(page), pageSize: Number(pageSize) };
    }
    filter.$or = [
      { store_id: { $in: allowedStoreIds } },
      { store_id: null, generated_by: reqUser.id },
    ];
  } else if (store_id) {
    filter.store_id = store_id;
  }

  const list = await SalaryBill.find(filter)
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await SalaryBill.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取单个账单详情（门店归属校验）
exports.getBillDetail = async (id, reqUser) => {
  const bill = await SalaryBill.findById(id);
  if (!bill) throw new Error('账单不存在');
  assertCanManageBill(bill, reqUser, '查看');
  return bill;
};

// 删除账单：作废其名下全部课薪台账（对应课程回到未入账状态，可重新生成）
exports.deleteBill = async (id, reqUser) => {
  const bill = await SalaryBill.findById(id);
  if (!bill) throw new Error('账单不存在');
  assertCanManageBill(bill, reqUser, '删除');

  await CoachSalaryStat.updateMany(
    { bill_id: id, status: 'active' },
    { $set: { status: 'voided', remark: `账单 ${id} 已删除，台账作废于 ${new Date().toISOString()}` } }
  );
  await SalaryBill.deleteOne({ _id: id });
  return { success: true };
};

function assertCanManageBill(bill, reqUser, action = '操作') {
  const allowedStoreIds = getAllowedStoreIds(reqUser);
  if (allowedStoreIds === null) return;
  const ok = (bill.store_id && allowedStoreIds.includes(String(bill.store_id))) ||
    (!bill.store_id && String(bill.generated_by) === String(reqUser.id));
  if (!ok) throw new Error(`无权${action}该账单`);
}
