/**
 * 生成 miniprogram_npm/@swc/runtime/*.js
 * 来源：@swc/helpers 0.5.23 的 cjs 实现（WeChat 开发者工具 SWC 编译器发出的
 * `require('@swc/runtime/_xxx.js')` 需要这些 helper 文件真实存在于 miniprogram_npm）。
 * 兼容处理：
 *  1. .cjs → .js
 *  2. 内部 require('./X.cjs') → require('./X.js')
 *  3. 追加兼容导出：module.exports = 主函数（可直接调用），同时挂 ._/原名/default
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];              // 解压后的 @swc/helpers cjs 目录
const DEST = process.argv[3];             // miniprogram_npm/@swc/runtime
if (!SRC || !DEST) { console.error('usage: node gen-swc-runtime.js <srcCjsDir> <destDir>'); process.exit(1); }

fs.mkdirSync(DEST, { recursive: true });
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.cjs'));
let count = 0;

for (const f of files) {
  let content = fs.readFileSync(path.join(SRC, f), 'utf8');
  // 内部相对引用 .cjs → .js
  content = content.replace(/require\((['"])\.\/([^'"]+)\.cjs\1\)/g, 'require($1./$2.js$1)');

  const base = f.replace(/\.cjs$/, '');
  // 提取主函数名（文件内第一个 function 声明）
  const fnMatch = content.match(/function\s+(_\w+)\s*\(/);
  const fnName = fnMatch ? fnMatch[1] : null;

  const compat = `
// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    ${fnName ? `main['${fnName}'] = main;` : ''}
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
`;

  fs.writeFileSync(path.join(DEST, base + '.js'), content + compat, 'utf8');
  count += 1;
}
console.log('generated', count, 'helpers at', DEST);
