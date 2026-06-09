require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/database');
const config = require('./src/config');
const { startScheduler } = require('./src/utils/scheduler');
const { syncServerTime } = require('./src/utils/time');
const PORT = process.env.PORT || 3000;

if (config.isProd && !process.env.JWT_SECRET) {
  console.error('[FATAL] 生产环境必须设置 JWT_SECRET 环境变量');
  process.exit(1);
}

if (config.isProd && !process.env.WX_APPID) {
  console.warn('[WARN] 生产环境未设置 WX_APPID，微信订阅消息推送将不可用');
}

connectDB().then(() => {
  // 注意：initDefaultConfigs() 仅在首次部署时手动执行，不应在每次启动时自动调用
  // 如需初始化默认数据，请运行: node scripts/init-defaults.js
  startScheduler();
  syncServerTime();
  app.listen(PORT, () => {
    console.log(`[Server] 舞栖舞蹈社后端服务已启动: http://localhost:${PORT}`);
    console.log(`[Server] 环境: ${config.env}, API域名: https://api.yuekeme.cn`);
  });
}).catch(err => {
  console.error('数据库连接失败:', err.message);
  process.exit(1);
});
