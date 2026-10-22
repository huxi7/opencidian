/**
 * [INPUT]: Markdown/画布视图的已加载原文、当前编辑、Desktop CAS 与 Vault 事件。
 * [OUTPUT]: 导出视图串行保存、脏状态判断、冲突提示与 flushWindowViews 关闭前保存边界。
 * [POS]: 独立窗口共用保存协议。CAS 冲突保留本地编辑，关闭前只校验保存，不写工作区布局。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop } from './ipc.js';
import { Notice } from './notices.js';
import { attachWindowSaveActions } from './window-save-conflict.js';
const operations = new WeakMap();
const typeOf = view => view?.getViewType?.();
export function currentWindowViewText(view) {
  if (typeOf(view) === 'markdown') return view.editor?.getValue() ?? view._loadedText ?? '';
  if (typeOf(view) === 'canvas') return JSON.stringify(view.getData(), null, '\t');
  return null;
}
const baseline = view => typeOf(view) === 'canvas' ? view._savedDataText : view._loadedText;
export function hasUnsavedWindowView(view) {
  if (!view?.file || !['markdown', 'canvas'].includes(typeOf(view))) return false;
  return currentWindowViewText(view) !== baseline(view);
}
export function reportWindowSaveError(view, message, conflict = false) {
  const repeated = view._saveError === message;
  view._saveError = message; view._saveConflict = conflict; view._dirty = hasUnsavedWindowView(view);
  if (!repeated) { view._saveNotice?.hide?.(); const notice = view._saveNotice = new Notice(message, conflict ? 0 : 8000); attachWindowSaveActions(notice, view); }
  return false;
}
export function saveWindowView(view) {
  clearTimeout(view._saveTimer); view._saveTimer = null;
  const operation = (operations.get(view) || Promise.resolve()).catch(() => {}).then(async () => {
    if (view._closed || !view.file || !['markdown', 'canvas'].includes(typeOf(view))) return true;
    const file = view.file, text = currentWindowViewText(view);
    if (text === baseline(view)) { view._dirty = false; view._saveError = null; view._saveConflict = false; view._saveNotice?.hide?.(); view._saveNotice = null; return true; }
    if (view._fileDeleted) return reportWindowSaveError(view, '文件已删除，未保存的编辑已保留。');
    const expected = typeOf(view) === 'canvas' ? view._savedText : view._loadedText;
    if (typeof expected !== 'string') return reportWindowSaveError(view, '尚未读取文件原文，已取消保存。');
    view._writing = true;
    try {
      let result = await Desktop.compareAndSwapFile({ path: file.path, expected, text });
      if (result?.conflict && await view.app.vault.read(file) === text) result = { ok: true };
      if (!result?.ok) return reportWindowSaveError(view, result?.conflict ? '文件已被另一个窗口修改，未保存的编辑已保留。' : '保存失败：' + (result?.error || '无法写入文件'), !!result?.conflict);
      if (view.file === file) {
        if (typeOf(view) === 'canvas') { view._savedText = text; view._savedDataText = text; }
        else view._loadedText = text;
        view._saveError = null; view._saveConflict = false; view._saveNotice?.hide?.(); view._saveNotice = null; view._dirty = hasUnsavedWindowView(view);
      }
      try { const stat = await view.app.vault.adapter.stat(file.path); file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size }; } catch {}
      view.app.vault.trigger('modify', file);
      return !hasUnsavedWindowView(view);
    } catch (error) { return reportWindowSaveError(view, '保存失败：' + error.message); }
    finally { view._writing = false; }
  });
  operations.set(view, operation);
  operation.finally(() => { if (operations.get(view) === operation) operations.delete(view); }).catch(() => {});
  return operation;
}
export async function flushWindowViews(app) {
  if (app.isSettingsWindow || !app.workspace?.getLeavesOfType) return { ok: true, failures: [] };
  const views = [...app.workspace.getLeavesOfType('markdown'), ...app.workspace.getLeavesOfType('canvas'), ...app.workspace.getLeavesOfType('bases')].map(leaf => leaf.view);
  const failures = [];
  for (const view of views) {
    if (typeof view?.save !== 'function') continue;
    try {
      let saved = false;
      // 保存期间的新输入会保留为 dirty；关闭守卫再收敛一次，绝不以旧快照通过。
      for (let attempt = 0; attempt < 4; attempt++) { saved = await view.save(); if (saved !== false && !hasUnsavedWindowView(view)) break; if (view._saveError) break; }
      if (saved === false || hasUnsavedWindowView(view)) failures.push({ path: view.file?.path || '', message: view._saveError || '仍有未保存的编辑' });
    } catch (error) { failures.push({ path: view.file?.path || '', message: error.message }); }
  }
  // 后面的视图保存期间，前面的视图仍可能收到输入。最终逐一复核。
  for (const view of views) if (hasUnsavedWindowView(view) && !failures.some(item => item.path === view.file?.path)) failures.push({ path: view.file?.path || '', message: view._saveError || '保存期间仍有新输入' });
  return { ok: failures.length === 0, failures };
}
