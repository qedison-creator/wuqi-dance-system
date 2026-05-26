const { error } = require('../utils/response');

/**
 * 门店数据隔离中间件
 * - super_admin: 可查看/操作所有门店
 * - store_manager: 可查看/操作所有门店
 * - staff: 只能查看/操作所属门店
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

      // super_admin 和 store_manager 不受门店限制
      if (role === 'super_admin' || role === 'store_manager') {
        return next();
      }

      // staff 角色：强制过滤所属门店
      if (role === 'staff') {
        const userStoreId = req.user.store_id;

        if (!userStoreId) {
          return res.status(403).json(error(403, '您的账号未绑定门店，请联系管理员'));
        }

        // GET 请求：自动注入 store_id 过滤
        if (req.method === 'GET') {
          if (!req.query.store_id) {
            req.query.store_id = userStoreId.toString();
          } else if (req.query.store_id !== userStoreId.toString()) {
            return res.status(403).json(error(403, '您只能查看所属门店的数据'));
          }
        }

        // POST/PUT 请求：校验 store_id 一致性
        if (req.method === 'POST' || req.method === 'PUT') {
          const bodyStoreId = req.body.store_id;
          if (bodyStoreId && bodyStoreId !== userStoreId.toString()) {
            return res.status(403).json(error(403, '您只能操作所属门店的数据'));
          }
          // 如果 body 中没有 store_id，自动注入（确保创建时绑定正确门店）
          if (!bodyStoreId && req.method === 'POST' && !allowAll) {
            req.body.store_id = userStoreId.toString();
          }
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = storeFilter;
