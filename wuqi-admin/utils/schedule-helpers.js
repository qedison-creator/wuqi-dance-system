/**
 * 排课模块通用工具函数
 * 从 schedule.js 中提取，减少主文件体积
 */

// 最大图片上传大小（与后端 multer limits.fileSize 一致）
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// 从上传错误中提取有意义的提示信息
function getUploadErrorMessage(err) {
  if (!err) return '上传失败，请重试';
  const msg = err.message || err.errMsg || String(err);
  if (msg.includes('文件过大')) return msg;
  if (msg.includes('不支持的图片类型')) return msg;
  if (msg.includes('413')) return '图片文件过大，最大支持 10MB';
  if (msg.includes('timeout') || msg.includes('超时')) return '上传超时，请检查网络后重试';
  if (msg.includes('fail') || msg.includes('网络')) return '网络异常，请检查网络后重试';
  try {
    const data = JSON.parse(msg);
    if (data && data.message) return data.message;
  } catch (e) {}
  return '上传失败，请重试';
}

module.exports = {
  MAX_IMAGE_SIZE,
  getUploadErrorMessage
};
