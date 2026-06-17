module.exports = {
  apps: [
    {
      name: 'wuqi-api',              // 进程名称，pm2 list 中显示
      script: './server.js',           // 入口文件
      cwd: '/home/ubuntu/wuqi-dance-system/backend',
      instances: 1,                   // 单实例（Express 不适合 cluster，有内存状态）
      autorestart: true,              // 崩溃自动重启
      watch: false,                   // 不监听文件变化（生产环境）
      max_memory_restart: '500M',     // 内存超限自动重启
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // 重启策略：异常重启间隔递增，防止无限重启循环
      min_uptime: '10s',              // 10秒内挂掉视为异常启动
      max_restarts: 10,               // 1分钟内最多重启10次，超过则停止
      restart_delay: 4000,            // 每次重启间隔4秒
      // 日志配置
      error_file: '/home/ubuntu/.pm2/logs/wuqi-api-error.log',
      out_file: '/home/ubuntu/.pm2/logs/wuqi-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 优雅关闭
      kill_timeout: 5000,             // 发送SIGINT后等5秒再SIGKILL
      listen_timeout: 10000,          // 等待10秒确认启动成功
    }
  ]
};
