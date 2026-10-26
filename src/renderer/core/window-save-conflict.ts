/**
 * [INPUT]: 未保存的 Markdown/画布视图、Modal、Notice 与 FileManager 文件创建。
 * [OUTPUT]: 导出冲突提示动作、解决弹层及显式载入磁盘与另存副本操作。
 * [POS]: 保存冲突恢复入口。载入磁盘先确认，读盘后复核草稿与文件；副本创建成功后才丢弃原草稿。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { View } from './view.js';
import { Modal } from './modals.js';
import { Notice } from './notices.js';
const snapshot = (view: View) => {
  if (view.getViewType() === 'markdown' && view.editor) return view.editor.getValue();
  if (view.getData) return JSON.stringify(view.getData(), null, '\t');
  throw Error('视图没有可恢复的正文');
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const errorCode = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
export async function reloadWindowViewFromDisk(view: View) {
  if (view._saveTimer != null) clearTimeout(view._saveTimer); view._saveTimer = null;
  const file = view.file, before = snapshot(view);
  if (!file) throw Error('视图未关联文件');
  const sequence = view._saveRecoverySequence = (view._saveRecoverySequence || 0) + 1;
  const text = await view.app.vault.read(file);
  if (view._closed || view.file !== file || snapshot(view) !== before || view._saveRecoverySequence !== sequence) {
    const error: Error & { code?: string } = Error('载入期间文档或草稿已变化，当前编辑已保留。'); error.code = 'DRAFT_CHANGED'; throw error;
  }
  if (view.getViewType() === 'markdown') {
    view._suppressChange = true;
    if (!view.editor) throw Error('编辑器尚未就绪');
    try { view.editor.setValue(text); view._loadedText = text; } finally { view._suppressChange = false; }
    view._renderedText = null; view._renderProperties?.(); if (view.mode === 'preview') view._renderReading?.();
  } else if (await view._applyFileFromDisk?.(file.path, { text }) === false) throw Error('无法载入磁盘版本');
  view._dirty = false; view._saveError = null; view._saveConflict = false; view._saveNotice?.hide();
  return true;
}
export async function saveWindowViewCopy(view: View) {
  const text = snapshot(view), source = view.file;
  if (!source) throw Error('视图未关联文件');
  const name = source.basename + ' (conflict copy).' + source.extension;
  const file = await view.app.fileManager.createNewFile(source.parent, name, text);
  if (!file) throw Error('未能创建本地副本');
  // 创建期间的新输入不能被已保存的旧快照代表。
  if (view.file === source && snapshot(view) === text) {
    try { await reloadWindowViewFromDisk(view); }
    catch (error) { if (errorCode(error) !== 'DRAFT_CHANGED') throw error; new Notice('副本已保存，原文档仍有新输入。'); }
  } else new Notice('副本已保存，原文档仍有新输入。');
  await view.app.workspace.openFile(file, { newLeaf: 'always' });
  return file;
}
export function showWindowSaveConflict(view: View) {
  if (!view?.file || !view._saveError) return null;
  const modal = new Modal(view.app); modal.modalEl.addClass('window-save-conflict'); modal.setTitle('解决保存冲突');
  modal.contentEl.createEl('p', { text: '当前文件：' + view.file.path });
  modal.contentEl.createEl('p', { text: '本地未保存的编辑已保留。可另存副本，或确认放弃草稿后载入磁盘版本。' });
  const error = modal.contentEl.createDiv('window-save-conflict-error'); error.setAttr('role', 'alert');
  const load = modal.buttonContainerEl.createEl('button', { text: '载入磁盘版本' }); load.dataset.action = 'reload';
  load.onclick = () => {
    modal.contentEl.createEl('p', { text: '将放弃当前未保存的草稿。确定载入磁盘版本？', cls: 'window-save-discard-confirm' });
    modal.buttonContainerEl.empty();
    const confirm = modal.buttonContainerEl.createEl('button', { text: '放弃草稿并载入', cls: 'mod-warning' }); confirm.dataset.action = 'confirm-reload';
    confirm.onclick = async () => { confirm.disabled = true; try { await reloadWindowViewFromDisk(view); modal.close(); } catch (cause) { error.textContent = message(cause); confirm.disabled = false; } };
    modal.buttonContainerEl.createEl('button', { text: '取消' }).onclick = () => modal.close();
  };
  const copy = modal.buttonContainerEl.createEl('button', { text: '另存本地副本', cls: 'mod-cta' }); copy.dataset.action = 'save-copy';
  copy.onclick = async () => { copy.disabled = true; try { await saveWindowViewCopy(view); modal.close(); } catch (cause) { error.textContent = message(cause); copy.disabled = false; } };
  modal.buttonContainerEl.createEl('button', { text: '暂不处理' }).onclick = () => modal.close();
  modal.open(); return modal;
}
export function attachWindowSaveActions(notice: Notice, view: View) {
  view.resolveSaveConflict = () => showWindowSaveConflict(view);
  if (!notice.messageEl?.createEl) return;
  const action = notice.messageEl.createEl('button', { text: '解决保存冲突', cls: 'window-save-resolve' });
  action.onclick = event => { event.stopPropagation(); showWindowSaveConflict(view); };
}
