/**
 * [INPUT]: 无依赖（使用 localStorage）。
 * [OUTPUT]: 导出 loadCanvasLocalData(path)、saveCanvasLocalData(path: string, readonly: boolean)、migrateCanvasLocalData(oldPath: string, newPath: string)、dropCanvasLocalData(path)。
 * [POS]: views/ 画布的本地数据层（原版 localDataManager 的等价物）。key 为 'canvas-<路径>'，值 {readonly:true} 或删除；
 *        目前只承载只读标记，重命名迁移、删除清理。存储不可用时静默降级。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas per-file local data (readonly flag) — localStorage, original localDataManager keys. */

const KEY_PREFIX = 'canvas-';

export function loadCanvasLocalData(path: string) {
  if (!path) return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + path) || 'null');
    return value && typeof value === 'object' && 'readonly' in value ? { readonly: value.readonly === true } : null;
  } catch (e) { return null; }
}

export function saveCanvasLocalData(path: string, readonly: boolean) {
  if (!path) return;
  try {
    const key = KEY_PREFIX + path;
    if (readonly) localStorage.setItem(key, JSON.stringify({ readonly: true }));
    else localStorage.removeItem(key);
  } catch (e) { /* 本地存储不可用不影响画布 */ }
}

export function migrateCanvasLocalData(oldPath: string, newPath: string) {
  if (!oldPath || !newPath) return;
  try {
    const key = KEY_PREFIX + oldPath;
    const data = localStorage.getItem(key);
    if (!data) return;
    localStorage.removeItem(key);
    localStorage.setItem(KEY_PREFIX + newPath, data);
  } catch (e) { /* ignore */ }
}

export function dropCanvasLocalData(path: string) {
  if (!path) return;
  try { localStorage.removeItem(KEY_PREFIX + path); } catch (e) { /* ignore */ }
}
