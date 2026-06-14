/**
 * 清理脚本：从 Image 集合中删除头像图片，重置教练 avatar_url
 *
 * 使用方法：
 *   cd wuqi-backend
 *   node scripts/cleanup-avatar-images.js
 */

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wuqi_dance';

console.log('[Cleanup] 连接数据库...');
mongoose.connect(MONGO_URI).then(async () => {
  console.log('[Cleanup] 数据库已连接');

  const Coach = require('../src/models/Coach');
  const Image = require('../src/models/Image');

  // 找出所有头像指向 /uploads/coaches/ 的教练
  const coaches = await Coach.find({ avatar_url: /\/uploads\/coaches\// });
  console.log(`[Cleanup] 找到 ${coaches.length} 个需要重置头像的教练`);

  let reset = 0;

  for (const coach of coaches) {
    const avatarUrl = coach.avatar_url;
    const match = avatarUrl.match(/\/uploads\/coaches\/(.+?)(\.\w+)?$/);

    // 从 Image 集合中删除对应的头像图片
    if (match) {
      const originalBaseName = match[1];
      const deleted = await Image.deleteOne({ title: new RegExp(originalBaseName) });
      if (deleted.deletedCount > 0) {
        console.log(`  [删除Image] ${coach.name}: ${originalBaseName}`);
      }
    }

    // 重置头像为空
    coach.avatar_url = '';
    await coach.save();
    console.log(`  [重置头像] ${coach.name}: ${avatarUrl} -> (空)`);
    reset++;
  }

  console.log(`\n[Cleanup] 完成！重置=${reset}`);
  process.exit(0);
}).catch(err => {
  console.error('[Cleanup] 连接失败:', err);
  process.exit(1);
});
