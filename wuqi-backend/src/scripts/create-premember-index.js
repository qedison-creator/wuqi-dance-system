/**
 * 预建档部分唯一索引创建脚本
 *
 * 功能：仅对 member_status='pending_claim' 状态的 reserve_phone 做唯一约束
 * 特点：background:true 后台异步创建，不阻塞线上读写
 *
 * 执行方式：node src/scripts/create-premember-index.js
 */

const mongoose = require('mongoose');
const config = require('../config');

async function createIndex() {
  try {
    console.log('正在连接数据库...');
    const uri = config.mongodbUri;
    if (!uri) {
      throw new Error('未配置 mongodbUri，请检查环境变量 MONGODB_URI 或 .env 文件');
    }
    await mongoose.connect(uri);
    console.log('数据库连接成功');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // 检查索引是否已存在
    const existingIndexes = await collection.indexes();
    const indexExists = existingIndexes.some(idx =>
      idx.key &&
      idx.key.reserve_phone === 1 &&
      idx.partialFilterExpression &&
      idx.partialFilterExpression.member_status === 'pending_claim'
    );

    if (indexExists) {
      console.log('索引已存在，无需重复创建');
      return;
    }

    console.log('正在创建部分唯一索引（reserve_phone + member_status=pending_claim）...');
    await collection.createIndex(
      { reserve_phone: 1 },
      {
        unique: true,
        partialFilterExpression: { member_status: 'pending_claim' },
        background: true,
        name: 'reserve_phone_pending_claim_unique'
      }
    );
    console.log('索引创建成功：reserve_phone_pending_claim_unique');
  } catch (err) {
    console.error('索引创建失败:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('数据库连接已关闭');
  }
}

createIndex();
