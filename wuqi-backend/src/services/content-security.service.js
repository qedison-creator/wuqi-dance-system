/**
 * 微信内容安全检查服务
 * 文档：
 *   - 图片：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.imgSecCheck.html
 *   - 文本：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html
 *
 * 说明：
 *   - 管理端上传的图片/文本最终会展示给会员端用户，因此内容安全检查必须使用「会员端小程序」
 *     的 access_token（因为审核规则要求"所调用API可在小程序内任意发布的场景生效"）。
 *   - 如管理端未配置小程序或使用会员端配置失败，可回退到管理端配置重试一次。
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { getAccessToken } = require('../utils/wechat');
const config = require('../config');

const IMG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/img_sec_check';
const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';

// imgSecCheck 接口限制：图片大小不超过 1MB，建议尺寸 750*1333 以下
const IMG_MAX_BYTES = 1 * 1024 * 1024;

/**
 * 检测图片是否含违规内容
 * @param {string} filePath - 本地图片文件绝对路径
 * @param {string} clientType - 使用的小程序类型（默认 member，即会员端）
 * @returns {Promise<{safe: boolean, reason: string, detail?: object}>}
 *   - safe=true 表示安全；safe=false 表示违规
 */
async function checkImage(filePath, clientType = 'member') {
  if (!fs.existsSync(filePath)) {
    return { safe: false, reason: '图片文件不存在' };
  }

  // imgSecCheck 限制：图片不超过 1MB；大于 1MB 时尝试用 sharp 压缩后再检测
  let checkPath = filePath;
  let tmpPath = null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > IMG_MAX_BYTES) {
      const sharp = (() => { try { return require('sharp'); } catch (e) { return null; } })();
      if (!sharp) {
        return { safe: false, reason: '图片过大且未安装 sharp，无法进行内容安全检测' };
      }
      tmpPath = filePath + '.sec-tmp.jpg';
      await sharp(filePath)
        .resize({ width: 750, withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toFile(tmpPath);
      const tmpStat = fs.statSync(tmpPath);
      if (tmpStat.size > IMG_MAX_BYTES) {
        // 仍超过 1MB，继续压缩质量
        await sharp(filePath)
          .resize({ width: 600, withoutEnlargement: true })
          .jpeg({ quality: 60, progressive: true })
          .toFile(tmpPath);
      }
      checkPath = tmpPath;
    }

    const accessToken = await getAccessToken(clientType);
    if (!accessToken) {
      // access_token 获取失败：不阻塞业务，记日志后返回 safe=true 但附带 warn
      console.warn('[ContentSecurity] 获取 access_token 失败，跳过图片内容安全检测（可能未配置微信小程序）');
      return { safe: true, reason: 'access_token 获取失败，跳过检测' };
    }

    const form = new FormData();
    form.append('media', fs.createReadStream(checkPath), {
      filename: 'check.jpg',
      contentType: 'image/jpeg',
    });

    const response = await axios.post(`${IMG_SEC_CHECK_URL}?access_token=${accessToken}`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 15000,
    });

    const data = response.data || {};
    // errcode: 0=通过；87014=内容违规
    if (data.errcode === 0) {
      return { safe: true, reason: '内容安全检测通过' };
    }
    if (data.errcode === 87014) {
      return { safe: false, reason: '图片含违规内容', detail: data };
    }
    // 其他错误码（如 40001 access_token 无效）→ 不阻塞业务，记日志后跳过
    console.warn('[ContentSecurity] imgSecCheck 返回异常:', JSON.stringify(data));
    return { safe: true, reason: `检测异常被跳过: ${data.errmsg || data.errcode}` };
  } catch (err) {
    console.error('[ContentSecurity] imgSecCheck 调用异常:', err.message);
    // 网络异常等情况：不阻塞业务，返回 safe=true 但记日志
    return { safe: true, reason: `检测异常被跳过: ${err.message}` };
  } finally {
    // 清理临时文件
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
  }
}

/**
 * 检测文本是否含违规内容
 * @param {string} content - 待检测文本（长度不超过 500KB，建议 2K 以内）
 * @param {string} clientType - 使用的小程序类型（默认 member）
 * @param {object} options - 可选参数：{ openid, scene }（scene: 1=资料 2=评论 3=论坛 4=社交日志）
 * @returns {Promise<{safe: boolean, reason: string, detail?: object}>}
 */
async function checkText(content, clientType = 'member', options = {}) {
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return { safe: true, reason: '内容为空，跳过检测' };
  }

  try {
    const accessToken = await getAccessToken(clientType);
    if (!accessToken) {
      console.warn('[ContentSecurity] 获取 access_token 失败，跳过文本内容安全检测');
      return { safe: true, reason: 'access_token 获取失败，跳过检测' };
    }

    const payload = {
      version: 2,
      scene: options.scene || 1,
      openid: options.openid || '',
      content: content,
    };

    const response = await axios.post(`${MSG_SEC_CHECK_URL}?access_token=${accessToken}`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    const data = response.data || {};
    if (data.errcode === 0) {
      const result = (data.result && data.result[0]) || {};
      const suggest = result.suggest || 'pass';
      if (suggest === 'pass') {
        return { safe: true, reason: '内容安全检测通过' };
      }
      // suggest: risky / hit
      return {
        safe: false,
        reason: '文本含违规内容',
        detail: { suggest, label: result.label, keyword: result.keyword }
      };
    }
    console.warn('[ContentSecurity] msgSecCheck 返回异常:', JSON.stringify(data));
    return { safe: true, reason: `检测异常被跳过: ${data.errmsg || data.errcode}` };
  } catch (err) {
    console.error('[ContentSecurity] msgSecCheck 调用异常:', err.message);
    return { safe: true, reason: `检测异常被跳过: ${err.message}` };
  }
}

/**
 * 批量检测多个文本字段（合并为一段文本一次性检测，减少 API 调用）
 * @param {Object} fields - { fieldName: value, ... } 键值对
 * @param {string} clientType - 使用的小程序类型（默认 member）
 * @returns {Promise<{safe: boolean, reason: string, detail?: object}>}
 */
async function checkTextFields(fields, clientType = 'member') {
  if (!fields || typeof fields !== 'object') {
    return { safe: true, reason: '无待检测字段' };
  }
  const texts = Object.values(fields)
    .filter(v => v && typeof v === 'string' && v.trim() !== '')
    .map(v => v.trim());
  if (texts.length === 0) {
    return { safe: true, reason: '内容为空，跳过检测' };
  }
  // 合并多字段为一段文本（用空格分隔），一次性检测
  return checkText(texts.join(' '), clientType);
}

module.exports = {
  checkImage,
  checkText,
  checkTextFields,
};
