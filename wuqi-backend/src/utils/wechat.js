const axios = require('axios');
const config = require('../config');

let accessTokenCache = {
  token: null,
  expiresAt: 0,
};

let accessTokenPromise = null;

/**
 * 微信小程序 code 换取 openid/session_key
 */
const code2Session = async (code) => {
  try {
    const url = 'https://api.weixin.qq.com/sns/jscode2session';
    const params = {
      appid: config.wxAppId,
      secret: config.wxSecret,
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
 */
const getAccessToken = async () => {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  if (accessTokenPromise) {
    return accessTokenPromise;
  }

  accessTokenPromise = (async () => {
    try {
      const url = 'https://api.weixin.qq.com/cgi-bin/token';
      const params = {
        grant_type: 'client_credential',
        appid: config.wxAppId,
        secret: config.wxSecret,
      };

      const response = await axios.get(url, { params });
      const data = response.data;

      if (data.errcode) {
        throw new Error(`获取 access_token 失败: ${data.errmsg}`);
      }

      accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
      };

      return data.access_token;
    } finally {
      accessTokenPromise = null;
    }
  })();

  return accessTokenPromise;
};

module.exports = { code2Session, getAccessToken };
