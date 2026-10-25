/**
 * [INPUT]: Vault 的路径归一化与文件索引。
 * [OUTPUT]: 导出库内唯一文件路径生成函数。
 * [POS]: 文件创建的路径工具，不执行磁盘写入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* small vault utilities (unique paths, generating paths). */
import { normalizePath, parentPathOf } from './vault.js';

export function getUniquePath(app: App, path) {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const dir = parentPathOf(path);
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = normalizePath((dir === '/' ? '' : dir + '/') + `${base} ${i}${ext}`);
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
  return path;
}
