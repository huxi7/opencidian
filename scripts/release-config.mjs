/**
 * [INPUT]: 版本标签、运行平台与 GitHub 附件元数据。
 * [OUTPUT]: 发布目标、版本解析、目录包路径与附件完整性校验。
 * [POS]: 本地打包、CI 和发布共用事实源；不访问网络或修改源码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const RELEASE_TARGETS = [
  { os: 'macos-15', target: 'macos-arm64', asset: 'opensidian-macos-arm64.dmg' },
  { os: 'windows-latest', target: 'windows-x64', asset: 'opensidian-windows-x64.exe' },
  { os: 'ubuntu-24.04', target: 'linux-x64', asset: 'opensidian-linux-x64.AppImage' },
];
export function versionFromTag(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw Error('版本标签必须为 vX.Y.Z');
  return tag.slice(1);
}
export function packageVersion(env = process.env) {
  if (env.RELEASE_TAG) return versionFromTag(env.RELEASE_TAG);
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--exact-match', '--match', 'v[0-9]*'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return versionFromTag(tag);
  } catch { return '0.0.0-dev'; }
}
export function packagedPaths(root, platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    const app = path.join(root, 'release', arch === 'x64' ? 'mac' : `mac-${arch}`, 'OpenSidian.app', 'Contents');
    return { binary: path.join(app, 'MacOS/OpenSidian'), archive: path.join(app, 'Resources/app.asar') };
  }
  const folder = platform === 'win32' ? 'win-unpacked' : 'linux-unpacked';
  if (!['win32', 'linux'].includes(platform) || arch !== 'x64') throw Error('该平台尚未配置目录包');
  const base = path.join(root, 'release', folder);
  return { binary: path.join(base, platform === 'win32' ? 'OpenSidian.exe' : 'opensidian'), archive: path.join(base, 'resources/app.asar') };
}
export function verifyAssets(assets, includeChecksums = false) {
  const expected = RELEASE_TARGETS.map(item => item.asset).concat(includeChecksums ? ['SHA256SUMS'] : []).sort();
  const actual = assets.map(item => item.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Release 附件不完整或存在未知附件');
  for (const asset of assets) {
    if (asset.state !== 'uploaded' || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw Error('附件未完成上传或缺少校验和：' + asset.name);
  }
}
