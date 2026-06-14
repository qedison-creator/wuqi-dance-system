const config = {
  dev: {
    baseUrl: 'http://localhost:3000/api/v1',
    serverBase: 'http://localhost:3000'
  },
  test: {
    baseUrl: 'http://101.33.203.22:3000/api/v1',
    serverBase: 'http://101.33.203.22:3000'
  },
  prod: {
    baseUrl: 'https://admin-api.yuekeme.cn/api/v1',
    serverBase: 'https://admin-api.yuekeme.cn'
  }
};

/**
 * 环境切换说明：
 * - 'dev'  : 本地开发（localhost:3000）
 * - 'test' : 服务器IP直连测试（域名备案前临时使用）
 * - 'prod' : 正式环境（已备案域名 + HTTPS）
 *
 * project.config.json 中的 urlCheck 配置：
 * - dev/test 模式：设置为 false（可请求 localhost/IP）
 * - prod 模式：设置为 true（仅可请求已备案的合法域名）
 */
const env = 'prod';
module.exports = config[env];