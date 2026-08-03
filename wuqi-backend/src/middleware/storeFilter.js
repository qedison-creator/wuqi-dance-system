const { error } = require('../utils/response');

/**
 * 门店数据隔离中间件
 *
 * 角色处理：
 * - super_admin: 不受门店限制，req.storeFilter = {}（不过滤）
 * - reviewer:   不受门店限制（受 auth 只读拦截保护），req.storeFilter = {}
 * - store_manager: 按 store_ids 数组限制；单门店强制注入，多门店校验归属
 * - staff:      按 store_id 限制，强制注入所属门店
 *
 * 显式设置 req.storeFilter 供 service 层使用：
 * - 单门店角色：{ store_id: 'xxx' }
 * - 多门店店长：{ store_id: { $in: ['xxx', 'yyy'] } }
 * - 超管/审核员：{}（不过滤）
 *
 * HTTP 方法处理：
 * - GET:    未传 store_id 则注入；传入不在允许范围则 403
 * - POST:   body 中 store_id 不在允许范围则 403；未传则注入
 * - PUT:    body 中 store_id 不在允许范围则 403；不自动注入（防覆盖），由 service 层校验归属
 * - DELETE: 从 query.store_id 校验；未传则交由 service 层校验归属
 */
const storeFilter = (options = {}) => {
  const { allowAll = false } = options;

  return (req, res, next) => {
    try {
      // 未认证用户跳过（公开接口）
      if (!req.user) {
        return next();
      }

      const role = req.user.role;

      // super_admin 和 reviewer 不受门店限制
      if (role === 'super_admin' || role === 'reviewer') {
        req.storeFilter = {};
        return next();
      }

      // store_manager 和 staff 统一获取允许访问的门店列表
      let allowedStoreIds = [];
      if (role === 'store_manager') {
        allowedStoreIds = (req.user.store_ids || []).map(s => String(s));
        if (allowedStoreIds.length === 0) {
          return res.status(403).json(error(403, '您的账号未分配门店，请联系管理员'));
        }
      } else if (role === 'staff') {
        const userStoreId = req.user.store_id;
        if (!userStoreId) {
          return res.status(403).json(error(403, '您的账号未绑定门店，请联系管理员'));
        }
        allowedStoreIds = [String(userStoreId)];
      } else {
        // 其他角色（如 member）不处理门店过滤
        req.storeFilter = {};
        return next();
      }

      // 判断是否单门店（用于决定注入策略）
      const isSingleStore = allowedStoreIds.length === 1;
      const defaultStoreId = allowedStoreIds[0];

      // 设置 req.storeFilter 供 service 层使用
      if (isSingleStore) {
        req.storeFilter = { store_id: defaultStoreId };
      } else {
        req.storeFilter = { store_id: { $in: allowedStoreIds } };
      }

      // GET 请求：处理 query.store_id
      if (req.method === 'GET') {
        const queryStoreId = req.query.store_id;
        if (!queryStoreId) {
          // 未传 store_id：单门店自动注入；多门店不注入（允许查看所辖全部门店）
          if (isSingleStore && !allowAll) {
            req.query.store_id = defaultStoreId;
          }
        } else if (!allowedStoreIds.includes(String(queryStoreId))) {
          return res.status(403).json(error(403, '您只能查看所属门店的数据'));
        }
      }

      // POST 请求：处理 body.store_id
      if (req.method === 'POST') {
        const bodyStoreId = req.body.store_id;
        if (bodyStoreId) {
          if (!allowedStoreIds.includes(String(bodyStoreId))) {
            return res.status(403).json(error(403, '您只能操作所属门店的数据'));
          }
        } else if (!allowAll) {
          // 未传 store_id：单门店自动注入；多门店不自动注入（需调用方明确指定）
          if (isSingleStore) {
            req.body.store_id = defaultStoreId;
          }
        }
      }

      // PUT 请求：校验 body.store_id，不自动注入（防止覆盖已有记录的门店归属）
      if (req.method === 'PUT') {
        const bodyStoreId = req.body.store_id;
        if (bodyStoreId && !allowedStoreIds.includes(String(bodyStoreId))) {
          return res.status(403).json(error(403, '您只能操作所属门店的数据'));
        }
        // 若 body 无 store_id，由 service 层校验目标记录归属
      }

      // DELETE 请求：校验 query.store_id（若有）
      if (req.method === 'DELETE') {
        const queryStoreId = req.query.store_id;
        if (queryStoreId && !allowedStoreIds.includes(String(queryStoreId))) {
          return res.status(403).json(error(403, '您只能操作所属门店的数据'));
        }
        // 若 query 无 store_id，由 service 层校验目标记录归属
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = storeFilter;
