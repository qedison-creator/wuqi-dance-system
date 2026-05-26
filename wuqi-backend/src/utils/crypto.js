const crypto = require('crypto');

const SECRET_KEY = process.env.QRCODE_SECRET || 'wuqi_member_qrcode_secret_2024!';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const EXPIRATION_SECONDS = 60;

function getKey() {
  return crypto.createHash('sha256').update(SECRET_KEY).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid token format');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const encryptedText = parts[1];
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function generateToken(memberCode) {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const data = JSON.stringify({
    member_code: memberCode,
    timestamp,
    random
  });
  return encrypt(data);
}

function verifyToken(token) {
  try {
    const decrypted = decrypt(token);
    const data = JSON.parse(decrypted);
    
    if (!data.member_code || !data.timestamp) {
      throw new Error('Invalid token data');
    }
    
    const now = Date.now();
    const age = now - data.timestamp;
    
    if (age > EXPIRATION_SECONDS * 1000) {
      throw new Error('签到码已过期，请刷新后重试');
    }
    
    return {
      valid: true,
      memberCode: data.member_code,
      timestamp: data.timestamp,
      age: age
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

module.exports = {
  encrypt,
  decrypt,
  generateToken,
  verifyToken,
  EXPIRATION_SECONDS
};
