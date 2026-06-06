const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('首页背景图迁移脚本');
console.log('========================================');

// 源图片目录 - 相对于当前脚本位置
const srcDir = path.resolve(__dirname, '../../wuqi-admin/images/hero');
// 目标目录
const destDir = path.resolve(__dirname, '../uploads/hero');

console.log('源目录:', srcDir);
console.log('目标目录:', destDir);

// 检查源目录是否存在
if (!fs.existsSync(srcDir)) {
  console.error('错误: 源目录不存在!', srcDir);
  process.exit(1);
}

// 创建目标目录（如果不存在）
if (!fs.existsSync(destDir)) {
  console.log('创建目标目录...');
  fs.mkdirSync(destDir, { recursive: true });
}

console.log('');
console.log('开始复制图片...');

// 获取源目录中的所有 jpg 文件
const files = fs.readdirSync(srcDir).filter(file => file.endsWith('.jpg'));

if (files.length === 0) {
  console.error('错误: 源目录中没有找到 jpg 图片!');
  process.exit(1);
}

let successCount = 0;

files.forEach(file => {
  const srcPath = path.join(srcDir, file);
  const destPath = path.join(destDir, file);
  
  try {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ ${file} 已复制`);
    successCount++;
  } catch (e) {
    console.error(`✗ 复制 ${file} 失败:`, e.message);
  }
});

console.log('');
console.log(`完成! 共复制 ${successCount}/${files.length} 张图片到:`);
console.log(destDir);
console.log('');
console.log('现在后台系统可以访问这些图片了, 路径格式为:');
console.log('/uploads/hero/hero-morning.jpg');
