const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wuqi_dance';
const OUTPUT_DIR = path.join(__dirname, 'db-backup');

async function exportDB() {
  console.log('连接数据库...');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('已连接\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const collections = await db.listCollections().toArray();
  console.log(`共 ${collections.length} 个集合\n`);

  let totalDocs = 0;
  const stats = [];

  for (const col of collections) {
    const colName = col.name;
    const docs = await db.collection(colName).find({}).toArray();
    totalDocs += docs.length;
    stats.push({ collection: colName, count: docs.length });

    const filePath = path.join(OUTPUT_DIR, `${colName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
    console.log(`  ${colName}: ${docs.length} 条记录 → ${colName}.json`);
  }

  const summary = {
    exportTime: new Date().toISOString(),
    database: 'wuqi_dance',
    totalCollections: collections.length,
    totalDocuments: totalDocs,
    collections: stats
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n=== 导出完成 ===`);
  console.log(`集合数: ${collections.length}, 总记录数: ${totalDocs}`);
  console.log(`输出目录: ${OUTPUT_DIR}`);

  await mongoose.connection.close();
  console.log('数据库连接已关闭');
}

exportDB().catch(err => {
  console.error('导出失败:', err);
  process.exit(1);
});