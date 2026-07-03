const { error } = require('../utils/response');

const checkPermission = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json(error(401, '未认证'));
      }

      const userRole = req.user.role;
      const userType = req.user.user_type;
      const userPermissions = req.user.permissions || [];

      if (userRole === 'super_admin' || userRole === 'reviewer' || (userPermissions && userPermissions.indexOf('*') >= 0)) {
        return next();
      }

      const roleMatch = allowedRoles.indexOf(userRole) >= 0 || allowedRoles.indexOf(userType) >= 0;
      if (!roleMatch) {
        return res.status(403).json(error(403, '权限不足'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

const checkModulePermission = (moduleId) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json(error(401, '未认证'));
      }

      const userRole = req.user.role;
      const userPermissions = req.user.permissions || [];

      if (userRole === 'super_admin' || userRole === 'reviewer' || userPermissions.indexOf('*') >= 0) {
        return next();
      }

      if (userPermissions.indexOf(moduleId) >= 0) {
        return next();
      }

      return res.status(403).json(error(403, '权限不足'));
    } catch (err) {
      next(err);
    }
  };
};

module.exports = checkPermission;
module.exports.checkModulePermission = checkModulePermission;
