/* small vault utilities (unique paths, generating paths). */
import { normalizePath, parentPathOf } from './vault.js';

export function getUniquePath(app, path) {
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
