const config = require('../config');

class BusinessError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.name = 'BusinessError';
    this.statusCode = code;
  }
}

const errorHandler = (err, req, res, next) => {
  console.error('=== 错误 ===');
  console.error(`路径: ${req.method} ${req.path}`);
  console.error(`时间: ${new Date().toISOString()}`);
  console.error(`信息: ${err.message}`);
  if (config.isDev) {
    console.error(`堆栈: ${err.stack}`);
  }

  // Mongoose 验证错误
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      code: 400,
      message: '数据验证失败',
      data: messages,
    });
  }

  // Mongoose ObjectId 转换错误
  if (err.name === 'CastError') {
    return res.status(400).json({
      code: 400,
      message: `参数格式错误: ${err.path}`,
      data: null,
    });
  }

  // Mongoose 重复键错误
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue).join(', ');
    return res.status(400).json({
      code: 400,
      message: `${field} 已存在`,
      data: null,
    });
  }

  // JWT 错误
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      code: 401,
      message: '认证失败',
      data: null,
    });
  }

  // Multer 文件上传错误
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 413,
        message: '文件过大，图片最大支持 10MB，视频最大支持 500MB',
        data: null,
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        code: 400,
        message: '上传字段名错误，请使用正确的字段名',
        data: null,
      });
    }
    return res.status(400).json({
      code: 400,
      message: `文件上传错误: ${err.message}`,
      data: null,
    });
  }

  // 业务逻辑错误（BusinessError 或带 statusCode 的错误）
  if (err.name === 'BusinessError' || (err.statusCode >= 400 && err.statusCode < 500)) {
    return res.status(err.statusCode || 400).json({
      code: err.statusCode || 400,
      message: err.message,
      data: null,
    });
  }

  // 普通 Error 对象（服务层 throw new Error 的业务错误）
  // 区分：Mongoose/JWT 等框架错误已有上面处理，到这里的是业务代码抛出的普通 Error
  if (err.name === 'Error' && !err.statusCode) {
    return res.status(400).json({
      code: 400,
      message: err.message,
      data: null,
    });
  }

  // 默认服务器错误
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    code: statusCode,
    message: config.isDev ? err.message : '服务器内部错误',
    data: config.isDev ? err.stack : null,
  });
};

module.exports = { errorHandler, BusinessError };
