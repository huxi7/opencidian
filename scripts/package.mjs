/**
 * [INPUT]: 当前系统、可选 --dir、版本标签、图标摘要；macOS 依赖 Xcode 26+。
 * [OUTPUT]: 当前系统的目录包或安装包，版本只写入打包元数据。
 * [POS]: 唯一打包入口。不修改 package.json，不主动上传产物。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, Platform, Arch } from 'electron-builder';
import { packageVersion } from './release-config.mjs';
// ---- 图标门禁：阻止旧生成器或意外替换进入安装包 ----
const icons = JSON.parse(fs.readFileSync(new URL('../build/icons.sha256.json', import.meta.url), 'utf8'));
for (const [file, expected] of Object.entries(icons)) {
  const actual = createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex');
  if (actual !== expected) throw Error('图标摘要不一致，请运行 scripts/make-app-icon.py：' + file);
}
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dir')) throw Error('只支持 --dir');
const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
if (!['arm64', 'x64'].includes(process.arch)) throw Error('不支持的处理器架构');
if (process.platform === 'darwin') {
  let actool;
  try { actool = execFileSync('xcrun', ['--find', 'actool'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw Error('原生 macOS 图标需要 Xcode 26+ 的 actool。Command Line Tools 不包含它；请安装 Xcode 或使用 macOS 发布流水线。'); }
  process.env.PATH = path.dirname(actool) + path.delimiter + process.env.PATH;
}
await build({
  targets: Platform.current().createTarget(args.includes('--dir') ? ['dir'] : undefined, arch),
  publish: 'never',
  config: { extraMetadata: { version: packageVersion() } },
});
