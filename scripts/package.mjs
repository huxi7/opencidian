/**
 * [INPUT]: 当前系统、可选 --dir、版本标签与 electron-builder 配置。
 * [OUTPUT]: 当前系统的目录包或安装包，版本只写入打包元数据。
 * [POS]: 唯一打包入口。不修改 package.json，不主动上传产物。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { build, Platform, Arch } from 'electron-builder';
import { packageVersion } from './release-config.mjs';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dir')) throw Error('只支持 --dir');
const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
if (!['arm64', 'x64'].includes(process.arch)) throw Error('不支持的处理器架构');
await build({
  targets: Platform.current().createTarget(args.includes('--dir') ? ['dir'] : undefined, arch),
  publish: 'never',
  config: { extraMetadata: { version: packageVersion() } },
});
