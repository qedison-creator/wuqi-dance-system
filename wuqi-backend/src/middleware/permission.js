const { error } = require('../utils/response');

const MODULE_ROLE_MAP = {
  schedule: ['super_admin', 'store_manager', 'staff'],
  booking: ['super_admin', 'store_manager', 'staff'],
  member: ['super_admin', 'store_manager', 'staff'],
  checkin: ['super_admin', 'store_manager', 'staff'],
  coach: ['super_admin', 'store_manager'],
  video: ['super_admin', 'store_manager'],
  salary: ['super_admin', 'store_manager'],
  package: ['super_admin', 'store_manager', 'staff'],
  waitlist: ['super_admin', 'store_manager', 'staff'],
  holiday: ['super_admin', 'store_manager'],
  banner: ['super_admin', 'store_manager'],
  account: ['super_admin', 'store_manager'],
  config: ['super_admin', 'store_manager'],
  log: ['super_admin', 'store_manager'],
  dashboard: ['super_admin', 'store_manager', 'staff'],
};

const checkPermission = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json(error(401, '未认证'));
      }

      const userRole = req.user.role;
      const userType = req.user.user_type;
      const userPermissions = req.user.permissions || [];

      if (userRole === 'super_admin' || (userPermissions && userPermissions.indexOf('*') >= 0)) {
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

      if (userRole === 'super_admin' || userPermissions.indexOf('*') >= 0) {
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
module.exports.MODULE_ROLE_MAP = MODULE_ROLE_MAP;
