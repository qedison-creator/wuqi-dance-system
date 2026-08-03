const OperationLog = require('../models/OperationLog');

// 创建操作日志
exports.createLog = async (data) => {
  const { operator_id, operator_name, action, module, target_id, detail, ip, user_agent, metadata, store_id } = data;

  if (!action || !module) {
    throw new Error('操作类型和模块名称为必填项');
  }

  const log = await OperationLog.create({
    operator_id,
    operator_name,
    action,
    module,
    target_id,
    detail,
    ip,
    user_agent,
    metadata,
    store_id,
  });

  return log;
};

// 获取日志列表(不可删除)
exports.getLogList = async (query) => {
  const { module: moduleName, action, operator_id, start_date, end_date, store_id, page = 1, pageSize = 20 } = query;
  const filter = {};

  if (moduleName) filter.module = moduleName;
  if (action) filter.action = action;
  if (operator_id) filter.operator_id = operator_id;
  // 门店过滤：store_id 由 storeFilter 中间件注入（单门店为字符串，多门店为 $in 查询）
  // 超管/审核员不传 store_id，查看全部日志（含存量无 store_id 的日志）
  if (store_id) filter.store_id = store_id;
  if (start_date && end_date) {
    filter.created_at = {
      $gte: new Date(start_date),
      $lte: new Date(end_date + ' 23:59:59'),
    };
  } else if (start_date) {
    filter.created_at = { $gte: new Date(start_date) };
  }

  const list = await OperationLog.find(filter)
    .populate('operator_id', 'nick_name username')
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await OperationLog.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 获取日志详情
exports.getLogById = async (id) => {
  const log = await OperationLog.findById(id).populate('operator_id', 'nick_name username');
  if (!log) throw new Error('日志不存在');
  return log;
};
