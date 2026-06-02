const axios = require('axios');
const config = require('../config');

// 按客户端类型缓存 access_token
const accessTokenCaches = {
  member: { token: null, expiresAt: 0 },
  admin: { token: null, expiresAt: 0 },
};

const accessTokenPromises = {
  member: null,
  admin: null,
};

/**
 * 微信小程序 code 换取 openid/session_key
 * @param {string} code - 微信登录code
 * @param {string} clientType - 客户端类型：'member' | 'admin'
 */
const code2Session = async (code, clientType = 'member') => {
  try {
    const wxConfig = config.getWxConfig(clientType);
    if (!wxConfig.appId || !wxConfig.secret) {
      throw new Error(`未配置${clientType === 'admin' ? '管理端' : '会员端'}小程序 AppID 或 Secret`);
    }

    const url = 'https://api.weixin.qq.com/sns/jscode2session';
    const params = {
      appid: wxConfig.appId,
      secret: wxConfig.secret,
      js_code: code,
      grant_type: 'authorization_code',
    };

    const response = await axios.get(url, { params });
    const data = response.data;

    if (data.errcode) {
      throw new Error(`微信登录失败: ${data.errmsg}`);
    }

    return {
      openid: data.openid,
      session_key: data.session_key,
      unionid: data.unionid || null,
    };
  } catch (error) {
    throw new Error(`微信 code2Session 调用失败: ${error.message}`);
  }
};

/**
 * 获取微信 access_token（带并发锁）
 * @param {string} clientType - 客户端类型：'member' | 'admin'
 */
const getAccessToken = async (clientType = 'member') => {
  const cache = accessTokenCaches[clientType];
  if (cache.token && Date.now() < cache.expiresAt) {
    return cache.token;
  }

  if (accessTokenPromises[clientType]) {
    return accessTokenPromises[clientType];
  }

  accessTokenPromises[clientType] = (async () => {
    try {
      const wxConfig = config.getWxConfig(clientType);
      if (!wxConfig.appId || !wxConfig.secret) {
        console.warn(`[WeChat] 未配置${clientType === 'admin' ? '管理端' : '会员端'}小程序 AppID 或 Secret`);
        return null;
      }

      const url = 'https://api.weixin.qq.com/cgi-bin/token';
      const params = {
        grant_type: 'client_credential',
        appid: wxConfig.appId,
        secret: wxConfig.secret,
      };

      const response = await axios.get(url, { params });
      const data = response.data;

      if (data.errcode) {
        throw new Error(`获取 access_token 失败: ${data.errmsg}`);
      }

      accessTokenCaches[clientType] = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
      };

      return data.access_token;
    } finally {
      accessTokenPromises[clientType] = null;
    }
  })();

  return accessTokenPromises[clientType];
};

module.exports = { code2Session, getAccessToken };
