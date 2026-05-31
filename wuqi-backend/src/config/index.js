module.exports = {
  port: process.env.PORT || 3000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance',
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'wuqi_dance_dev_secret_2026'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // 微信小程序配置
  wxAppId: process.env.WX_APPID || '',
  wxSecret: process.env.WX_SECRET || '',

  // 腾讯云COS配置
  cosSecretId: process.env.COS_SECRET_ID || '',
  cosSecretKey: process.env.COS_SECRET_KEY || '',
  cosBucket: process.env.COS_BUCKET || '',
  cosRegion: process.env.COS_REGION || 'ap-guangzhou',

  // 环境
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',
  isProd: process.env.NODE_ENV === 'production',
};
