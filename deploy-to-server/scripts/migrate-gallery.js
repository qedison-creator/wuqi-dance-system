/**
 * 迁移脚本：将 Coach.gallery 中的旧图片迁移至 Image 模型
 *
 * 使用方法：
 *   1. 停止后端服务
 *   2. cd wuqi-dance-system/backend
 *   3. node scripts/migrate-gallery.js
 *
 * 说明：
 *   - 对每张旧gallery图片，下载原图 → sharp压缩 → 生成缩略图 → 创建Image文档
 *   - 不会删除 Coach.gallery 中的旧数据
 *   - 已存在的图片（相同image_url）会跳过
 */

const mongoose = require('mongoose');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// ========== 配置 ==========
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi';
const SERVER_BASE = process.env.SERVER_BASE || 'https://api.yuekeme.cn';
const UPLOAD_DIR = path.join(__dirname, '../uploads/images');

// ========== 连接数据库 ==========
console.log('[Migration] 连接数据库...');
mongoose.connect(MONGO_URI).then(async () => {
  console.log('[Migration] 数据库已连接');

  // 路径与服务器上的目录结构匹配
  const Coach = require('../src/models/Coach');
  const Image = require('../src/models/Image');

  // 确保目录存在
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  const coaches = await Coach.find({ gallery: { $exists: true, $not: { $size: 0 } } });
  console.log(`[Migration] 找到 ${coaches.length} 个有相册数据的教练`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const coach of coaches) {
    for (let i = 0; i < coach.gallery.length; i++) {
      const url = coach.gallery[i];

      // 检查是否已迁移（相同image_url的Image文档已存在）
      const exists = await Image.findOne({ image_url: url });
      if (exists) {
        // 补充教练关联
        if (exists.coach_ids && !exists.coach_ids.some(id => String(id) === String(coach._id))) {
          exists.coach_ids.push(coach._id);
          await exists.save();
          console.log(`  [更新] 补充教练关联: ${coach.name} -> ${url}`);
        } else {
          console.log(`  [跳过] 已存在: ${url}`);
        }
        skipped++;
        continue;
      }

      try {
        // 构建完整URL
        let fullUrl = url;
        if (url.startsWith('/')) {
          fullUrl = SERVER_BASE.replace(/\/$/, '') + url;
        }

        // 下载图片
        console.log(`  [下载] ${fullUrl}`);
        const response = await axios.get(fullUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Wuqi-Migration/1.0'
          }
        });

        const buffer = Buffer.from(response.data);
        const baseName = `migrate_${coach._id}_${Date.now()}_${i}`;
        const imagePath = path.join(UPLOAD_DIR, `${baseName}.webp`);
        const thumbPath = path.join(UPLOAD_DIR, `${baseName}_thumb.webp`);

        // 压缩并保存
        const metadata = await sharp(buffer).metadata();
        await sharp(buffer)
          .resize({ width: 1920, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(imagePath);
        await sharp(buffer)
          .resize({ width: 400, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(thumbPath);

        let orientation = 'landscape';
        if (metadata.width && metadata.height) {
          const ratio = metadata.width / metadata.height;
          if (ratio > 1.1) orientation = 'landscape';
          else if (ratio < 0.9) orientation = 'portrait';
          else orientation = 'square';
        }

        // 创建Image文档
        await Image.create({
          title: `${coach.name} - 作品图片 ${i + 1}`,
          image_url: `/uploads/images/${baseName}.webp`,
          thumbnail_url: `/uploads/images/${baseName}_thumb.webp`,
          coach_ids: [coach._id],
          width: metadata.width || 0,
          height: metadata.height || 0,
          orientation,
          show_on_home: true
        });

        console.log(`  [成功] ${coach.name} -> /uploads/images/${baseName}.webp`);
        migrated++;
      } catch (err) {
        console.error(`  [失败] ${coach.name} #${i} (${url}): ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n[Migration] 完成！成功=${migrated} 跳过=${skipped} 失败=${failed}`);
  process.exit(0);
}).catch(err => {
  console.error('[Migration] 连接失败:', err);
  process.exit(1);
});