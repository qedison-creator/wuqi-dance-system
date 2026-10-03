/**
 * 用 miniprogram-ci 编译整个管理端项目，暴露任何真实编译错误（尤其 package-data 子包）
 * 用法：node scripts/ci-compile-check.js
 */
const path = require('path');
const ci = require('miniprogram-ci');

(async () => {
  const projectPath = path.resolve(__dirname, '..');
  const cfg = require(path.join(projectPath, 'project.config.json'));
  const project = new ci.Project({
    appid: cfg.appid,
    type: 'miniProgram',
    projectPath,
    privateKeyPath: path.join(projectPath, 'scripts/.ci-placeholder-key'), // compileQuickly 不上传，占位即可
    ignores: ['node_modules/**/*'],
  });

  try {
    const result = await ci.getCompiledResult(project, {
      es6: true,
      minify: false,
      autoPrefixWXSS: true,
    });
    const files = Object.keys(result || {});console.log('===== 编译完成，产物文件数:', files.length, '=====');const dcFiles = files.filter(f => f.includes('package-data'));console.log('package-data 产物:', dcFiles.length, '个');
  } catch (err) {
    console.error('===== 编译失败 =====');
    console.error(err.message || err);
    if (err.stack) console.error(err.stack.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }
})();
