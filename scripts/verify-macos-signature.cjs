/**
 * [INPUT]: electron-builder 完成签名的 macOS 应用目录。
 * [OUTPUT]: codesign 深层严格校验；失败立即阻止安装包生成。
 * [POS]: afterSign 门禁，拒绝丢失资源封装或仍绑定 Electron 身份的应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  // codesign 的详细信息写入 stderr。
  const result = spawnSync('codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || '无法读取 macOS 签名');
  if (!result.stderr.includes('Identifier=' + context.packager.appInfo.id + '\n')) throw Error('签名身份未绑定当前应用');
  if (!/Sealed Resources version=/.test(result.stderr)) throw Error('macOS 签名未封存应用资源');
};
