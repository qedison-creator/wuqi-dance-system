const config = {
  dev: {
    baseUrl: 'http://localhost:3000/api/v1',
    serverBase: 'http://localhost:3000'
  },
  prod: {
    baseUrl: 'https://api.yuekeme.cn/api/v1',
    serverBase: 'https://api.yuekeme.cn'
  }
};

/**
 * 环境切换说明：
 * - 本地开发请设置为 'dev'
 * - 小程序审核/上线请设置为 'prod'
 * 同时注意 project.config.json 中的 urlCheck 配置：
 * - dev 模式建议设置为 false（可请求 localhost）
 * - prod 模式必须设置为 true（仅可请求已备案的合法域名）
 */
const env = 'dev';
module.exports = config[env];