const logger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl } = req;
    const { statusCode } = res;

    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] ${method} ${originalUrl} ${statusCode} ${duration}ms`;

    if (statusCode >= 500) {
      console.error(log);
    } else if (statusCode >= 400) {
      console.warn(log);
    } else {
      console.log(log);
    }
  });

  next();
};

module.exports = logger;
