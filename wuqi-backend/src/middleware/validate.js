module.exports = {
  objectId: (paramName) => {
    return (req, res, next) => {
      const id = req.params[paramName] || req.query[paramName];
      if (id && !/^[a-f\d]{24}$/i.test(id)) {
        return res.status(400).json({ success: false, message: '无效的ID格式' });
      }
      next();
    };
  },
  required: (fields) => {
    return (req, res, next) => {
      const missing = fields.filter(f => !req.body[f] && req.body[f] !== 0);
      if (missing.length > 0) {
        return res.status(400).json({ success: false, message: `缺少必要参数: ${missing.join(', ')}` });
      }
      next();
    };
  }
};