const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/services/preMember.service.js');
const content = fs.readFileSync(filePath, 'utf8');

if (content.indexOf("filter.claimed_at = { $exists: true, $ne: null }") !== -1) {
  console.log('[本地文件] 已是最新逻辑：使用 claimed_at 判断已认领');
} else {
  console.log('[本地文件] 仍是旧逻辑');
}

// 检查是否有 member_identity 作为 claimed 条件
if (content.indexOf("member_identity: { $in: ['new', 'old'] }") !== -1) {
  console.log('[本地文件] 仍包含 member_identity 判断条件');
} else {
  console.log('[本地文件] 已移除 member_identity 判断条件');
}
