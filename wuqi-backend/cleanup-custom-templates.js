require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const TemplateFieldMapping = require('./src/models/TemplateFieldMapping');
const config = require('./src/config');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  try {
    // 1. 连接数据库
    console.log(`[1/3] 连接数据库: ${config.mongodbUri.replace(/mongodb:\/\/.*@/, 'mongodb://***:***@')}`);
    await mongoose.connect(config.mongodbUri);
    console.log('    ✓ 数据库连接成功');

    // 2. 查找 custom_ 开头的重复模板
    console.log('\n[2/3] 查询自定义模板...');
    const customTpls = await TemplateFieldMapping.find({
      template_key: /^custom_/
    });

    if (customTpls.length === 0) {
      console.log('    ✓ 没有发现 custom_ 开头的重复模板，无需清理');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log(`    发现 ${customTpls.length} 个自定义模板：\n`);
    customTpls.forEach((t, i) => {
      console.log(`    [${i + 1}] template_key: ${t.template_key}`);
      console.log(`        名称: ${t.template_name}`);
      console.log(`        模板ID: ${t.template_id || '(空)'}`);
      console.log(`        字段数: ${(t.mappings || []).length}`);
      console.log(`        创建时间: ${t.created_at || t.updated_at || '未知'}`);
      console.log();
    });

    // 3. 确认后删除
    await new Promise((resolve) => {
      rl.question('\n确认删除以上所有 custom_ 模板？(y/n): ', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase());
      });
    }).then(async (answer) => {
      if (answer === 'y' || answer === 'yes') {
        console.log('\n[3/3] 正在删除...');
        const res = await TemplateFieldMapping.deleteMany({
          template_key: /^custom_/
        });
        console.log(`    ✓ 已删除 ${res.deletedCount} 个模板`);
        await mongoose.connection.close();
        process.exit(0);
      } else {
        console.log('    × 已取消删除');
        await mongoose.connection.close();
        process.exit(0);
      }
    });
  } catch (err) {
    console.error('\n操作失败:', err.message);
    try {
      await mongoose.connection.close();
    } catch (e) {}
    process.exit(1);
  }
}

main();
