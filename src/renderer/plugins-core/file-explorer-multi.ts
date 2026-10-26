/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t/tt/getNouns；依赖 ../core/menu.js 的 Menu；依赖 ../core/notices.js 的 Notice；
 *          依赖 ../core/suggest.js 的 GenericSuggester；依赖 ../core/vault.js 的 TFolder/normalizePath/parentPathOf
 * [OUTPUT]: 导出 movableItems、flattenTopLevel、dragPayloadFor、dragTitleFor、dragGhostTitle、moveItemsToFolder、deleteItemsSequentially、
 *          createFolderWithSelection、showMultiSelectionMenu、folderChoicesFor、chooseMoveTarget
 * [POS]: plugins-core/file-explorer 的多选批量操作层。逐条对应原版：x8.dragFiles（多选拖动载荷 type=files + items）、
 *        dragManager.dragFile/dragFolder 的单项幽灵标题（dragTitleFor：md 短名/其它全名/文件夹名）、
 *        onFileContextMenu 多选分支（actionNewFolderWithCount + 触发 files-menu 由 core/file-menu.js 补 actionMoveItems + menuOptDelete，
 *        分节表与单选菜单一致）、
 *        onDeleteSelectedFiles（顺序 promptForDeletion）、f$（移动进文件夹）、v$（剔除被选中文件夹包含的项）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { FileExplorerView } from './file-explorer.js';
import type { FileTreeSelection } from './file-explorer-selection.js';
import { t, tt, getNouns } from '../core/i18n.js';
import { Menu } from '../core/menu.js';
import { Notice } from '../core/notices.js';
import { GenericSuggester } from '../core/suggest.js';
import { TFolder, VaultEntry, normalizePath, parentPathOf } from '../core/vault.js';

/** 原版 m$ + f$ 的跳过规则：自身、自身后代、已在本文件夹内的项都不可移动。 */
export function movableItems(items: VaultEntry[], folder: TFolder) {
  return items.filter((item: { path: string; }) => {
    if (item === folder) return false;
    if (item instanceof TFolder && folder.path !== '/' && (folder.path === item.path || folder.path.startsWith(item.path + '/'))) return false;
    if (parentPathOf(item.path) === folder.path) return false;
    return true;
  });
}

/** 原版 v$：剔除被另一个选中文件夹包含的项，得到顶层项。 */
export function flattenTopLevel(items: VaultEntry[]) {
  return items.filter((item: { path: string; }) => !items.some((other) => other !== item && other instanceof TFolder && item.path.startsWith(other.path)));
}

/** 原版 x8.dragFiles：拖动项属于多选时返回整个选择集的载荷；否则返回 null 走单项拖动。 */
export function dragPayloadFor(selection: FileTreeSelection, item: VaultEntry) {
  if (selection.size < 2 || !selection.has(item.path)) return null;
  const items = selection.items();
  if (items.length < 2) return null;
  return {
    path: item.path,
    type: 'files',
    items: items.map((it) => ({ path: it.path, type: it instanceof TFolder ? 'folder' : 'file' })),
  };
}

/** 原版 dragManager.dragFile/dragFolder 的单项幽灵标题：md 用短名，其它文件用全名，文件夹用名字。 */
export function dragTitleFor(item: VaultEntry) {
  if (item instanceof TFolder) return item.name;
  return item.extension === 'md' ? item.basename : item.name;
}

/** 原版 dragManager.dragFiles 的幽灵标题："N files and M folders"。 */
export function dragGhostTitle(items: VaultEntry[]) {
  const nouns = getNouns();
  const files = items.filter((it) => !(it instanceof TFolder)).length;
  const folders = items.length - files;
  if (files && folders) return tt('plugins.file-explorer.label-drag-files-and-folders', `${nouns.file(files)} 与 ${nouns.folder(folders)}`);
  return files ? nouns.file(files) : nouns.folder(folders);
}

/** 原版 f$：把 items 移动进 folder，逐项 renameFile，失败提示沿用拖拽移动的文案。 */
export async function moveItemsToFolder(view: Pick<FileExplorerView, 'app'>, items: VaultEntry[], folder: TFolder) {
  let moved = 0;
  for (const item of movableItems(flattenTopLevel(items), folder)) {
    const newPath = normalizePath((folder.path === '/' ? '' : folder.path + '/') + item.name);
    const ok = await view.app.fileManager.renameFile(item, newPath);
    if (ok) moved++;
    else new Notice(tt('plugins.file-explorer.msg-error-move-failed', `无法移动“${item.name}”`, { name: item.name }));
  }
  return moved;
}

/** 原版 onDeleteSelectedFiles：逐项走现有删除确认 / 回收站流程，跳过根目录与已消失的项。 */
export async function deleteItemsSequentially(view: Pick<FileExplorerView, 'app'>, items: VaultEntry[]) {
  let deleted = 0;
  for (const item of items) {
    if (item instanceof TFolder && item.isRoot()) continue;
    // 原版 vault.exists 的等价物：本复刻的 Vault 只有内存索引，删除文件夹后子项会一并消失
    if (!view.app.vault.getAbstractFileByPath(item.path)) continue;
    if (await view.app.fileManager.promptForDeletion(item)) deleted++;
  }
  return deleted;
}

/** 原版 actionNewFolderWithCount：在目标位置建新文件夹，把选择集移动进去，随后进入重命名。 */
export async function createFolderWithSelection(view: FileExplorerView, targetItem: VaultEntry, items: VaultEntry[]) {
  const parent = targetItem instanceof TFolder
    ? targetItem
    : (view.app.vault.getFolderByPath(parentPathOf(targetItem.path)) || view.app.vault.getRoot());
  const created = await view._createFolderIn(parent);
  await moveItemsToFolder(view, items, created);
  view._selection.clear();
  view._selection.setFocus(created.path, true);
  setTimeout(() => view.startRename(created), 30);
  return created;
}

/** 原版多选右键菜单：新建文件夹含选中项（action-primary）/ 移动到…（files-menu）/ 删除（danger）。 */
export function showMultiSelectionMenu(view: FileExplorerView, ev: MouseEvent, clickedItem: VaultEntry) {
  const items = view._selection.items();
  const targets = flattenTopLevel(items);
  const menu = new Menu(view.app);
  menu.addSections(['title', 'open', 'action-primary', 'action', 'info', 'info.copy', 'view', 'system', '', 'danger']);
  menu.addItem((i) => i.setSection('action-primary')
    .setTitle(t('plugins.file-explorer.action-new-folder-with-count', { count: targets.length }))
    .setIcon('lucide-folder-plus')
    .onClick(() => { createFolderWithSelection(view, clickedItem, items); }));
  menu.addItem((i) => i.setSection('danger')
    .setTitle(t('plugins.file-explorer.menu-opt-delete'))
    .setIcon('lucide-trash-2')
    .setWarning(true)
    .onClick(() => { deleteItemsSequentially(view, items); }));
  view.app.workspace.trigger('files-menu', menu, items, 'file-explorer-context-menu', null);
  const titleEl = view._titleEl(clickedItem.path);
  if (titleEl) menu.setParentElement(titleEl as HTMLElement);
  view._selection.setFocus(clickedItem.path, false);
  menu.showAtMouseEvent(ev);
  return menu;
}

/** 原版 m0 移动弹窗的文件夹候选：排除各选中文件夹自身与后代，以及唯一父目录（移动过去是空操作）。 */
export function folderChoicesFor(view: { app: { vault: { getRoot: () => TFolder; }; }; }, items: { path: string; }[]) {
  const folders = [view.app.vault.getRoot()];
  const collect = (folder: TFolder) => {
    for (const child of folder.children) {
      if (child instanceof TFolder) { folders.push(child); collect(child); }
    }
  };
  collect(view.app.vault.getRoot());
  const parents = new Set(items.map((item: { path: string; }) => parentPathOf(item.path)));
  const parent = parents.size === 1 ? parents.values().next().value : null;
  return folders.filter((folder) => folder.path !== parent
    && !items.some((item) => item instanceof TFolder && folder.path.startsWith(item.path)));
}

/** 原版 m0 移动弹窗：选目标文件夹，返回 TFolder 或 null。 */
export function chooseMoveTarget(view: Pick<FileExplorerView, 'app'>, items: VaultEntry[]) {
  const options = folderChoicesFor(view, items).map((folder) => ({ label: folder.path === '/' ? '/' : folder.path, folder }));
  return new Promise<TFolder | null>((resolve) => {
    const m = new GenericSuggester(view.app, options, {
      placeholder: t('plugins.file-explorer.action-move-file') || 'Move file to...',
      onChoose: choice => resolve(choice.folder),
    });
    m.open();
    m.onClose = () => resolve(null);
  });
}
