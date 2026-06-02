module.exports = {
  port: process.env.PORT || 3000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance',
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'wuqi_dance_dev_secret_2026'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // 微信小程序配置 - 会员端
  wxMemberAppId: process.env.WX_MEMBER_APPID || process.env.WX_APPID || '',
  wxMemberSecret: process.env.WX_MEMBER_SECRET || process.env.WX_SECRET || '',

  // 微信小程序配置 - 管理端
  wxAdminAppId: process.env.WX_ADMIN_APPID || '',
  wxAdminSecret: process.env.WX_ADMIN_SECRET || '',

  // 腾讯云COS配置
  cosSecretId: process.env.COS_SECRET_ID || '',
  cosSecretKey: process.env.COS_SECRET_KEY || '',
  cosBucket: process.env.COS_BUCKET || '',
  cosRegion: process.env.COS_REGION || 'ap-guangzhou',

  // 环境
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',
  isProd: process.env.NODE_ENV === 'production',

  // 根据客户端类型获取对应的微信配置
  getWxConfig: (clientType = 'member') => {
    if (clientType === 'admin') {
      return {
        appId: process.env.WX_ADMIN_APPID || '',
        secret: process.env.WX_ADMIN_SECRET || '',
      };
    }
    // 默认返回会员端配置
    return {
      appId: process.env.WX_MEMBER_APPID || process.env.WX_APPID || '',
      secret: process.env.WX_MEMBER_SECRET || process.env.WX_SECRET || '',
    };
  },
};
