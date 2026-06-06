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

module.exports = auth;
