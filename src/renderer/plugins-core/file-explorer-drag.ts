/**
 * [INPUT]: 依赖 ../core/icons.js 的 setIcon；依赖 ../core/vault.js 的 TFolder；
 *          依赖 ../editor/attachments.js 的 getAvailableAttachmentPath；
 *          依赖 ./file-explorer-multi.js 的 dragPayloadFor/dragGhostTitle/dragTitleFor/movableItems/moveItemsToFolder。
 * [OUTPUT]: 导出 setupItemDrag、endItemDrag、clearDragExpand、scheduleDragExpand、setupFolderDrop、importExternalFiles、setupRootDrop。
 * [POS]: plugins-core/file-explorer 的拖拽层。逐条对齐原版 dragManager 与 attachDropHandler：
 *        drag-ghost-self 幽灵、body.is-grabbing、整个选择集 is-being-dragged、文件夹 750ms 悬停展开、
 *        根容器空白处移回仓库根、系统外部文件复制进库。视图只保留 DOM 与选择集，拖拽生命周期全部在此。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setIcon } from '../core/icons.js';
import { TFolder } from '../core/vault.js';
import { getAvailableAttachmentPath } from '../editor/attachments.js';
import {
  dragGhostTitle, dragPayloadFor, dragTitleFor, movableItems, moveItemsToFolder,
} from './file-explorer-multi.js';

/** 原版 dragManager.updateSource + dragFile/dragFolder/dragFiles 的源态与幽灵。 */
export function setupItemDrag(view, el, item) {
  el.addEventListener('dragstart', (ev) => {
    const multi = dragPayloadFor(view._selection, item);
    const payload = multi || { path: item.path, type: item instanceof TFolder ? 'folder' : 'file' };
    ev.dataTransfer.setData('text/plain', JSON.stringify(payload));
    ev.dataTransfer.effectAllowed = 'move';
    const sourceEls = multi
      ? view.treeEl.findAll('.nav-file-title.is-selected, .nav-folder-title.is-selected')
      : [el];
    view._draggingEls = sourceEls;
    sourceEls.forEach((src) => src.addClass('is-being-dragged'));
    view._draggingItem = item;
    view._draggingItems = multi ? view._selection.items() : null;
    document.body.addClass('is-grabbing');
    // 原版 dragManager：drag-ghost-self 承载图标 + 标题，action 行由落点态填充
    try {
      const ghost = createDiv('drag-ghost');
      const self = ghost.createDiv('drag-ghost-self');
      setIcon(self, multi ? 'lucide-files' : item instanceof TFolder ? 'lucide-folder-open' : 'lucide-file');
      self.createSpan({ text: multi ? dragGhostTitle(view._draggingItems) : dragTitleFor(item) });
      ghost.createDiv('drag-ghost-action');
      document.body.appendChild(ghost);
      if (ev.dataTransfer.setDragImage) ev.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.detach(), 0);
    } catch (e) { /* 某些环境不支持 drag image */ }
  });
  el.addEventListener('dragend', () => endItemDrag(view, el));
}

/** 拖拽收尾：源行、幽灵、hover 与 750ms 展开计时器全部清空。 */
export function endItemDrag(view, fallbackEl?) {
  for (const src of (view._draggingEls || (fallbackEl ? [fallbackEl] : []))) src.removeClass('is-being-dragged');
  if (fallbackEl) fallbackEl.removeClass('is-being-dragged');
  view._draggingEls = null;
  view._draggingItem = null;
  view._draggingItems = null;
  clearDragExpand(view);
  document.body.removeClass('is-grabbing');
  if (view.treeEl) view.treeEl.findAll('.is-being-dragged-over').forEach((e) => e.removeClass('is-being-dragged-over'));
}

export function clearDragExpand(view) {
  if (view._dragExpandTimer) clearTimeout(view._dragExpandTimer);
  view._dragExpandTimer = null;
  view._dragExpandPath = null;
}

/** 原版 attachDropHandler：悬停折叠文件夹 750ms 后自动展开（同目标只挂一次）。 */
export function scheduleDragExpand(view, folder) {
  if (!view._collapsed.has(folder.path)) { clearDragExpand(view); return; }
  if (view._dragExpandPath === folder.path) return;
  clearDragExpand(view);
  view._dragExpandPath = folder.path;
  view._dragExpandTimer = setTimeout(() => {
    view._dragExpandTimer = null;
    if (!view._draggingItem || !view._collapsed.has(folder.path)) return;
    view._collapsed.delete(folder.path);
    view.render();
  }, 750);
}

/** 原版 attachDropHandler：文件夹标题的 dragover/dragleave/drop。 */
export function setupFolderDrop(view, titleEl, folder, folderEl) {
  titleEl.addEventListener('dragover', (ev) => {
    const types = ev.dataTransfer ? Array.from(ev.dataTransfer.types || []) : [];
    if (!view._draggingItem && types.includes('Files')) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      folderEl.addClass('is-being-dragged-over');
      return;
    }
    if (!view._draggingItem) return;
    if (!movableItems(view._draggingItems || [view._draggingItem], folder).length) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    folderEl.addClass('is-being-dragged-over');
    scheduleDragExpand(view, folder);
  });
  titleEl.addEventListener('dragleave', (ev) => {
    if (!folderEl.contains(ev.relatedTarget)) {
      folderEl.removeClass('is-being-dragged-over');
      clearDragExpand(view);
    }
  });
  titleEl.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    folderEl.removeClass('is-being-dragged-over');
    clearDragExpand(view);
    const files = ev.dataTransfer && ev.dataTransfer.files ? Array.from(ev.dataTransfer.files) : [];
    if (!view._draggingItem && files.length) { await importExternalFiles(view, files, folder.path); return; }
    if (!view._draggingItem) return;
    await moveItemsToFolder(view, view._draggingItems || [view._draggingItem], folder);
    endItemDrag(view);
  });
}

/** 系统外部文件拖入文件夹/根：复制进库（不插入链接，原版文件树行为）。 */
export async function importExternalFiles(view, files, folderPath) {
  for (const f of files) {
    let bytes = null;
    try { bytes = new Uint8Array(await f.arrayBuffer()); } catch (e) { continue; }
    const dot = f.name.lastIndexOf('.');
    const name = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot + 1) : '';
    const path = getAvailableAttachmentPath(view.app, folderPath === '/' ? '' : folderPath, name, ext);
    try { await view.app.vault.createBinary(path, bytes); } catch (e) { /* 失败跳过 */ }
  }
}

/** 根容器空白处：外部文件复制进库根；库内项移回仓库根（原版 navFileContainerEl 的 attachDropHandler）。 */
export function setupRootDrop(view) {
  const treeEl = view.treeEl;
  treeEl.addEventListener('dragover', (ev) => {
    if (ev.target.closest && ev.target.closest('.nav-file-title, .nav-folder-title')) return;
    const root = view.app.vault.getRoot();
    if (view._draggingItem) {
      if (!movableItems(view._draggingItems || [view._draggingItem], root).length) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      treeEl.addClass('is-being-dragged-over');
      return;
    }
    const types = ev.dataTransfer ? Array.from(ev.dataTransfer.types || []) : [];
    if (!types.includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    treeEl.addClass('is-being-dragged-over');
  });
  treeEl.addEventListener('dragleave', (ev) => {
    if (ev.target.closest && ev.target.closest('.nav-file-title, .nav-folder-title')) return;
    if (!treeEl.contains(ev.relatedTarget)) treeEl.removeClass('is-being-dragged-over');
  });
  treeEl.addEventListener('drop', async (ev) => {
    if (ev.target.closest && ev.target.closest('.nav-file-title, .nav-folder-title')) return;
    treeEl.removeClass('is-being-dragged-over');
    const files = ev.dataTransfer && ev.dataTransfer.files ? Array.from(ev.dataTransfer.files) : [];
    if (view._draggingItem) {
      ev.preventDefault();
      clearDragExpand(view);
      await moveItemsToFolder(view, view._draggingItems || [view._draggingItem], view.app.vault.getRoot());
      endItemDrag(view);
      return;
    }
    if (!files.length) return;
    ev.preventDefault();
    await importExternalFiles(view, files, '/');
  });
}
