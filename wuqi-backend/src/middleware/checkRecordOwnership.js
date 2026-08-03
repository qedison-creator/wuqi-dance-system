const { error } = require('../utils/response');
const { getAllowedStoreIds } = require('../utils/storeOwnership');

/**
 * 记录归属校验中间件工厂
 *
 * 用于按 ID 操作的路由（GET/PUT/DELETE /:id），在 storeFilter 之后执行，
 * 根据路由参数（如 :id）查询对应模型，校验目标记录的 store_id 是否在用户允许访问的门店列表内。
 *
 * 使用场景：
 *   - 超管/审核员：直接通过（不限门店）
 *   - 店长/员工：查询目标记录，校验 record.store_id 是否在 allowedStoreIds 内
 *
 * 使用示例：
 *   const checkOwnership = require('../middleware/checkRecordOwnership');
 *   const Member = require('../models/Member');
 *   router.put('/:id', auth, storeFilter(), checkOwnership(Member), async (req, res, next) => { ... });
 *
 * @param {Model} Model - Mongoose 模型，用于查询目标记录
 * @param {Object} [options]
 * @param {string} [options.paramName='id'] - 路由参数名，默认 'id'
 * @param {string} [options.recordName='记录'] - 记录名称（用于错误提示）
 * @param {string} [options.storeIdField='store_id'] - 记录中门店ID字段名
 * @param {boolean} [options.allowNullStoreId=false] - 是否允许 store_id 为 null 的记录通过（如审核待审核会员时分配门店）
 */
function checkRecordOwnership(Model, options = {}) {
  const {
    paramName = 'id',
    recordName = '记录',
    storeIdField = 'store_id',
    allowNullStoreId = false,
  } = options;

  return async (req, res, next) => {
    try {
      // 未认证用户跳过（由 auth 中间件处理）
      if (!req.user) return next();

      // 超管/审核员不限门店
      const allowedStoreIds = getAllowedStoreIds(req.user);
      if (allowedStoreIds === null) {
        return next();
      }

      // 无门店权限：拒绝
      if (!allowedStoreIds || allowedStoreIds.length === 0) {
        return res.status(403).json(error(403, `您无权操作此${recordName}`));
      }

      const recordId = req.params[paramName];
      if (!recordId) return next();

      // 查询目标记录的门店归属字段
      const record = await Model.findById(recordId).select(storeIdField).lean();
      if (!record) {
        // 记录不存在，交给路由处理（返回 404）
        return next();
      }

      // 记录无 store_id（全局数据）：仅超管可操作，此处拒绝
      // 例外：allowNullStoreId=true 时允许（如审核待审核会员时分配门店）
      const recordStoreId = record[storeIdField];
      if (!recordStoreId) {
        if (allowNullStoreId) {
          req.ownershipRecord = record;
          return next();
        }
        return res.status(403).json(error(403, `您无权操作此${recordName}`));
      }

      // 校验门店归属
      if (!allowedStoreIds.includes(String(recordStoreId))) {
        return res.status(403).json(error(403, `您只能操作所属门店的${recordName}`));
      }

      // 将记录挂载到 req，避免路由层重复查询
      req.ownershipRecord = record;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = checkRecordOwnership;
