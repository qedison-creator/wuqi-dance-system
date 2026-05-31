const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./middleware/logger');
const routes = require('./routes');

const app = express();

const corsOptions = config.isProd ? {
  origin: [
    'https://servicewechat.com',
    'https://api.yuekeme.cn',
    'https://yuekeme.cn'
  ],
  credentials: true
} : {};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(config.isProd ? 'combined' : 'dev'));
app.use(logger);

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = config.isProd ? 200 : 1000;

app.use((req, res, next) => {
  if (req.path.startsWith('/uploads') || req.path === '/health') {
    return next();
  }
  const key = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = rateLimitStore.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  }
  record.count++;
  rateLimitStore.set(key, record);
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ code: 429, message: '请求过于频繁，请稍后再试', data: null });
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore) {
    if (now > record.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

const uploadsDir = path.join(__dirname, '../uploads');
const placeholderPath = path.join(uploadsDir, 'default-placeholder.png');

app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsDir, req.path);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.sendFile(placeholderPath);
  }
});

// 路由
app.use('/api/v1', routes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 错误处理
app.use(errorHandler);

module.exports = app;
