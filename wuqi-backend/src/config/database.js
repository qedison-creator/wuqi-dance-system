const mongoose = require('mongoose');
const config = require('./index');
const Config = require('../models/Config');

// 权限配置迁移：检测过时的 role_permissions 文档并重置为最新默认值
async function migrateRolePermissions() {
  try {
    const LEGACY_KEYS = ['video', 'package', 'transfer'];
    const doc = await Config.findOne({ key: 'role_permissions' });

    if (!doc) return; // 无文档时使用代码默认值，无需迁移

    // 检测是否包含已废弃的权限 key
    const allPerms = Object.values(doc.value || {}).flatMap(r => r.permissions || []);
    const hasLegacy = allPerms.some(p => LEGACY_KEYS.includes(p));
    if (!hasLegacy) return;

    console.log('[Migration] 检测到过时的 role_permissions 配置，重置为最新默认值...');
    await Config.deleteOne({ key: 'role_permissions' });
    console.log('[Migration] role_permissions 已重置，将使用代码中的 DEFAULT_ROLE_PERMISSIONS');
  } catch (err) {
    console.error('[Migration] role_permissions 迁移失败:', err.message);
  }
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri);
    console.log(`MongoDB 连接成功: ${conn.connection.host}`);
    await migrateRolePermissions();
  } catch (error) {
    console.error(`MongoDB 连接失败: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB 连接断开');
});

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB 连接错误: ${err.message}`);
});

module.exports = connectDB;
