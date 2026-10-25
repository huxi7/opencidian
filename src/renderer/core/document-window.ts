/**
 * [INPUT]: 文档叶子的保存与状态、Desktop 文档窗口 IPC、Notice。
 * [OUTPUT]: 提供 openLeafInWindow 与 registerDocumentWindowCommands（含冲突恢复入口）。
 * [POS]: 文档转移协调器。新窗口就绪后再移除来源，失败保留原文档。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop } from './ipc.js';
import { Notice } from './notices.js';
import { t } from './i18n.js';

export function canOpenLeafInWindow(app: App, leaf) {
  return !!leaf?.view && app.workspace._sideOf(leaf) === 'center' && leaf.view.getViewType() !== 'empty';
}
export async function openLeafInWindow(app: App, leaf, move: boolean | string = false) {
  if (!canOpenLeafInWindow(app, leaf)) return false;
  const view = leaf.view;
  if (view.save && await view.save() === false) return false;
  if (view.editor && view.file && await app.vault.read(view.file) !== view.editor.getValue()) {
    new Notice('笔记尚未保存，已取消窗口转移'); return false;
  }
  const state = { type: view.getViewType(), state: view.getState() };
  const bounds = leaf.containerEl?.getBoundingClientRect();
  const result = await Desktop.openDocumentWindow({ ...state, size: bounds ? { width: bounds.width, height: bounds.height } : undefined,
    zoom: require('electron').webFrame.getZoomLevel() });
  if (!result?.ok) { new Notice(result?.reason || '无法打开文档窗口'); return false; }
  if (move && leaf.view === view && JSON.stringify(view.getState()) === JSON.stringify(state.state)) await leaf.detach();
  return result;
}
export function registerDocumentWindowCommands(app: App) {
  app.commands.addCommand({ id: 'workspace:resolve-save-conflict', name: '解决保存冲突', icon: 'lucide-file-warning', checkCallback(checking) {
    const view = app.workspace.activeLeaf?.view;
    if (!view?._saveError || typeof view.resolveSaveConflict !== 'function') return false;
    if (!checking) view.resolveSaveConflict();
    return true;
  } });
  for (const [id, key, move] of [
    ['workspace:move-to-new-window', 'commands.move-to-new-window', true],
    ['workspace:open-in-new-window', 'commands.open-in-new-window', false],
  ]) app.commands.addCommand({ id, name: t(key), icon: move ? 'lucide-picture-in-picture' : 'lucide-picture-in-picture-2', checkCallback(checking) {
    const leaf = app.workspace.activeLeaf;
    if (!canOpenLeafInWindow(app, leaf)) return false;
    if (!checking) openLeafInWindow(app, leaf, move).catch(error => new Notice(error.message));
    return true;
  } });
}
