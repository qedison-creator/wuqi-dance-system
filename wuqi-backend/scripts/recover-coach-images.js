/**
 * 恢复脚本：将 uploads/coaches/ 中的旧图片导入 Image 模型
 *
 * 使用方法：
 *   1. 停止后端服务
 *   2. cd wuqi-backend
 *   3. node scripts/recover-coach-images.js
 *
 * 说明：
 *   - 扫描 uploads/coaches/ 目录下的图片文件
 *   - 用 sharp 压缩为 WebP 格式，生成缩略图
 *   - 保存到 uploads/images/ 目录并创建 Image 文档
 *   - 不关联教练（需在管理端手动关联）
 *   - 已存在的图片（相同文件名）会跳过
 */

const mongoose = require('mongoose');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ========== 配置 ==========
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi_dance';
const COACH_UPLOAD_DIR = path.join(__dirname, '../uploads/coaches');
const IMAGE_UPLOAD_DIR = path.join(__dirname, '../uploads/images');

// 支持的图片扩展名
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

// ========== 连接数据库 ==========
console.log('[Recover] 连接数据库...');
mongoose.connect(MONGO_URI).then(async () => {
  console.log('[Recover] 数据库已连接');

  const Image = require('../src/models/Image');

  // 确保目标目录存在
  if (!fs.existsSync(IMAGE_UPLOAD_DIR)) {
    fs.mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });
  }

  // 扫描源目录
  if (!fs.existsSync(COACH_UPLOAD_DIR)) {
    console.error('[Recover] 目录不存在:', COACH_UPLOAD_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(COACH_UPLOAD_DIR)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return IMAGE_EXTS.includes(ext);
    });

  console.log(`[Recover] 找到 ${files.length} 个图片文件`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const srcPath = path.join(COACH_UPLOAD_DIR, fileName);
    const baseName = path.parse(fileName).name;

    // 检查是否已导入（以原始文件名开头的 Image 文档）
    const exists = await Image.findOne({ title: new RegExp(baseName) });
    if (exists) {
      console.log(`  [跳过] 已导入: ${fileName}`);
      skipped++;
      continue;
    }

    try {
      const outputName = `recover_${baseName}_${Date.now()}`;
      const imagePath = path.join(IMAGE_UPLOAD_DIR, `${outputName}.webp`);
      const thumbPath = path.join(IMAGE_UPLOAD_DIR, `${outputName}_thumb.webp`);

      // 获取原图信息
      const metadata = await sharp(srcPath).metadata();

      // 压缩为 WebP
      await sharp(srcPath)
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(imagePath);

      // 生成缩略图
      await sharp(srcPath)
        .resize({ width: 400, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);

      // 确定方向
      let orientation = 'landscape';
      if (metadata.width && metadata.height) {
        const ratio = metadata.width / metadata.height;
        if (ratio > 1.1) orientation = 'landscape';
        else if (ratio < 0.9) orientation = 'portrait';
        else orientation = 'square';
      }

      // 创建 Image 文档（不关联教练）
      await Image.create({
        title: `恢复图片 - ${fileName}`,
        image_url: `/uploads/images/${outputName}.webp`,
        thumbnail_url: `/uploads/images/${outputName}_thumb.webp`,
        coach_ids: [],
        width: metadata.width || 0,
        height: metadata.height || 0,
        orientation,
        show_on_home: false
      });

      console.log(`  [成功] ${fileName} -> /uploads/images/${outputName}.webp`);
      imported++;
    } catch (err) {
      console.error(`  [失败] ${fileName}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n[Recover] 完成！成功=${imported} 跳过=${skipped} 失败=${failed}`);
  console.log('[Recover] 请在管理端"此间画面"中手动将图片关联到对应教练');
  process.exit(0);
}).catch(err => {
  console.error('[Recover] 连接失败:', err);
  process.exit(1);
});
