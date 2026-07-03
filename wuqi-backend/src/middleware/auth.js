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

    // 检查账号是否被禁用（管理员/员工账号）
    const user = await User.findById(decoded.id).select('status');
    if (!user) {
      return res.status(401).json(error(401, '账号不存在'));
    }
    if (user.status === 'disabled') {
      return res.status(401).json(error(401, '账号已被禁用，请联系管理员'));
    }

    req.user = decoded;

    // 审核员只读：拦截所有非 GET 请求
    if (decoded.role === 'reviewer' && req.method !== 'GET') {
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
      const user = await User.findById(decoded.id).select('status');
      if (user && user.status !== 'disabled') {
        req.user = decoded;
      }
    }
  } catch (err) {
    // token 无效时忽略，继续放行
  }
  next();
};

module.exports = auth;
module.exports.optionalAuth = optionalAuth;
