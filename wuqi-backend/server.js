require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/database');
const { startScheduler } = require('./src/utils/scheduler');
const { syncServerTime } = require('./src/utils/time');
const configRoutes = require('./src/routes/config.routes');
const PORT = process.env.PORT || 3000;

// 连接数据库
connectDB();

// 数据库连接成功后初始化
const mongoose = require('mongoose');
mongoose.connection.once('open', async () => {
  console.log('数据库连接成功，开始初始化...');
  
  // 同步服务器时间
  await syncServerTime();
  
  // 初始化默认配置
  if (configRoutes.initDefaultConfigs) {
    await configRoutes.initDefaultConfigs();
  }
});

// 启动定时任务调度器
startScheduler();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`舞栖舞蹈社后端服务已启动: http://localhost:${PORT}`);
  console.log(`局域网访问地址: http://192.168.1.3:${PORT}`);
});
