const jwt = require('jsonwebtoken');
const config = require('../config');
const { error } = require('../utils/response');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(error(401, '未提供认证令牌'));
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret);

    // 从 DB 刷新关键权限字段，确保 role/store_id/store_ids/permissions 变更实时生效
    // （JWT payload 中的值可能已过期，以 DB 最新值为准）
    const user = await User.findById(decoded.id).select('status role store_id store_ids permissions user_type nick_name');
    if (!user) {
      return res.status(401).json(error(401, '账号不存在'));
    }
    if (user.status === 'disabled') {
      return res.status(401).json(error(401, '账号已被禁用，请联系管理员'));
    }

    // 用 DB 最新数据覆盖 decoded，确保 storeFilter 等中间件拿到正确的 store_id/store_ids
    req.user = {
      ...decoded,
      id: String(user._id),
      role: user.role,
      user_type: user.user_type,
      nick_name: user.nick_name,
      permissions: user.permissions || [],
      store_id: user.store_id ? String(user.store_id) : null,
      store_ids: (user.store_ids || []).map(s => String(s)),
    };

    // 审核员只读：拦截所有非 GET 请求（以 DB 最新 role 为准）
    if (user.role === 'reviewer' && req.method !== 'GET') {
      return res.status(403).json(error(403, '审核账号为只读模式，无操作权限'));
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(error(401, '令牌已过期'));
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json(error(401, '无效的令牌'));
    }
    next(err);
  }
};

// 可选认证：有 token 则解析，无 token 也放行（用于游客可浏览的接口）
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, config.jwtSecret);
      // 同步刷新权限字段
      const user = await User.findById(decoded.id).select('status role store_id store_ids permissions user_type nick_name');
      if (user && user.status !== 'disabled') {
        req.user = {
          ...decoded,
          id: String(user._id),
          role: user.role,
          user_type: user.user_type,
          nick_name: user.nick_name,
          permissions: user.permissions || [],
          store_id: user.store_id ? String(user.store_id) : null,
          store_ids: (user.store_ids || []).map(s => String(s)),
        };
      }
    }
  } catch (err) {
    // token 无效时忽略，继续放行
  }
  next();
};

module.exports = auth;
module.exports.optionalAuth = optionalAuth;
