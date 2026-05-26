const config = {
  dev: {
    baseUrl: 'http://localhost:3000/api/v1',
    serverBase: 'http://localhost:3000'
  },
  prod: {
    baseUrl: 'https://your-domain.com/api/v1',
    serverBase: 'https://your-domain.com'
  }
};
const env = 'dev';
module.exports = config[env];