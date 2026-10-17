/**
 * [INPUT]: 依赖 ../core/view.js 的 View；依赖 ../core/i18n.js 的 t/tt；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 PromptModal/confirmDialog；依赖 ../core/suggest.js 的 GenericSuggester；依赖 ../core/vault.js 的 TFile/TFolder/normalizePath/parentPathOf
 * [OUTPUT]: 导出 FileExplorerView 与插件注册（左侧栏 'file-explorer' 视图）
 * [POS]: plugins-core/ 的导航面板。DOM 逐字对齐原版：tree-item nav-folder > tree-item-self nav-folder-title.is-clickable > (tree-item-icon.collapse-icon[+right-triangle] + tree-item-inner nav-folder-title-content)。折叠状态同时写在 nav-folder 与 collapse-icon 上（原版 _L() 语义）。文件标题显示去扩展名 basename，非 md 文件追加 nav-file-tag。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: file-explorer — navigation pane with the vault tree. */
import { View } from '../core/view.js';
import { t, tt } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { Notice } from '../core/notices.js';
import { PromptModal, confirmDialog } from '../core/modals.js';
import { GenericSuggester } from '../core/suggest.js';
import { TFile, TFolder, normalizePath, parentPathOf } from '../core/vault.js';
import { IS_MAC } from '../core/keymap.js';

export const nameKey = 'plugins.file-explorer';

const KNOWN_EXTS = new Set([
  'md', 'canvas', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
  'mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'opus', 'mp4', 'webm', 'ogv', 'mov', 'mkv',
]);

const SORT_ORDERS = {
  alphabetical: 'A → Z',
  alphabeticalReverse: 'Z → A',
  byModifiedTime: 'Modified time (new to old)',
  byModifiedTimeReverse: 'Modified time (old to new)',
  byCreatedTime: 'Created time (new to old)',
  byCreatedTimeReverse: 'Created time (old to new)',
};

function sortChildren(children, order) {
  const arr = [...children];
  arr.sort((a, b) => {
    const aF = a instanceof TFolder, bF = b instanceof TFolder;
    if (aF !== bF) return aF ? -1 : 1;
    switch (order) {
      case 'alphabeticalReverse':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'byModifiedTime':
      case 'byModifiedTimeReverse': {
        const av = (a.stat && a.stat.mtime) || 0, bv = (b.stat && b.stat.mtime) || 0;
        const d = bv - av;
        return order === 'byModifiedTime' ? d : -d;
      }
      case 'byCreatedTime':
      case 'byCreatedTimeReverse': {
        const av = (a.stat && a.stat.ctime) || 0, bv = (b.stat && b.stat.ctime) || 0;
        const d = bv - av;
        return order === 'byCreatedTime' ? d : -d;
      }
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
  });
  return arr;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export class FileExplorerView extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'folder-closed';
    this.navigation = true;
    this._collapsed = new Set();
    this._sortOrder = localStorage.getItem('file-explorer-sort-order') || 'alphabetical';
    this._activePath = null;
    this._refs = [];
    this._rerenderQueued = false;
  }
  getViewType() { return 'file-explorer'; }
  getDisplayText() { return t('plugins.file-explorer.name') || 'Files'; }
  getState() {
    return { collapsed: [...this._collapsed], sortOrder: this._sortOrder };
  }
  async setState(state) {
    if (state && state.collapsed) this._collapsed = new Set(state.collapsed);
    if (state && state.sortOrder) this._sortOrder = state.sortOrder;
  }

  async onOpen() {
    this.contentEl.addClass('file-explorer-view');
    const container = this.contentEl.createDiv('nav-files-container node-insert-event');
    this.container = container;

    // Action buttons
    const buttons = container.createDiv('nav-buttons-container');
    const addBtn = (icon, label, cb) => {
      const btn = buttons.createDiv('nav-action-button clickable-icon');
      btn.setAttr('aria-label', label);
      setIcon(btn, icon);
      btn.onclick = cb;
      return btn;
    };
    addBtn('file-plus', t('plugins.file-explorer.action-new-note') || 'New note', () => this.app.commands.executeCommandById('file-explorer:new-file'));
    addBtn('folder-plus', t('plugins.file-explorer.action-new-folder') || 'New folder', () => this.app.commands.executeCommandById('file-explorer:new-folder'));
    const sortBtn = addBtn('arrow-up-narrow-wide', t('plugins.file-explorer.action-change-sort') || 'Change sort order', (ev) => this._showSortMenu(ev));
    if (this._sortOrder !== 'alphabetical') sortBtn.addClass('is-active');

    this.treeEl = container.createDiv('nav-tree');
    this.render();

    // events
    const debouncedRender = () => this._queueRender();
    this._refs = [
      this.app.vault.on('create', debouncedRender),
      this.app.vault.on('delete', debouncedRender),
      this.app.vault.on('rename', debouncedRender),
      this.app.workspace.on('file-open', () => this.setActivePath(this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : null)),
      this.app.workspace.on('active-leaf-change', () => this.setActivePath(this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : null)),
    ];
    // context menu on empty tree area
    container.addEventListener('contextmenu', (ev) => {
      if (ev.target.closest('.nav-file-title, .nav-folder-title')) return;
      ev.preventDefault();
      this._showRootMenu(ev, this.app.vault.getRoot());
    });
    // keyboard
    this.setActivePath(this.app.workspace.getActiveFile() ? this.app.workspace.getActiveFile().path : null);
  }

  onClose() {
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
  }

  _queueRender() {
    if (this._rerenderQueued) return;
    this._rerenderQueued = true;
    requestAnimationFrame(() => {
      this._rerenderQueued = false;
      this.render();
      // keep active file highlighted + revealed
      this.setActivePath(this._activePath, false);
    });
  }

  // -------------------------------------------------------------------------
  render() {
    if (!this.treeEl) return;
    const scrollTop = this.treeEl.parentElement ? this.treeEl.parentElement.scrollTop : 0;
    this.treeEl.empty();
    const root = this.app.vault.getRoot();
    const rootEl = this.treeEl.createDiv('tree-item nav-folder mod-root');
    const rootTitle = rootEl.createDiv('tree-item-self nav-folder-title is-clickable');
    rootTitle.setAttr('data-path', '/');
    rootTitle.createDiv({ cls: 'tree-item-inner nav-folder-title-content' }).setText(this.app.vault.getName());
    const children = rootEl.createDiv('tree-item-children nav-folder-children');
    this._renderChildren(root, children);
    if (this.treeEl.parentElement) this.treeEl.parentElement.scrollTop = scrollTop;
  }

  _renderChildren(folder, container) {
    const order = this._sortOrder;
    for (const child of sortChildren(folder.children, order)) {
      if (child instanceof TFolder) this._renderFolder(child, container, order);
      else if (child instanceof TFile) this._renderFile(child, container);
      else if (child && child.children) this._renderChildren(child, container);
    }
  }

  _isVisibleFile(file) {
    if (KNOWN_EXTS.has(file.extension)) return true;
    return !!this.app.settings.appSettings.showUnsupportedFiles;
  }

  _renderFolder(folder, container, order) {
    const el = container.createDiv('tree-item nav-folder');
    el.setAttr('data-path', folder.path);
    const title = el.createDiv('tree-item-self nav-folder-title is-clickable');
    title.setAttr('data-path', folder.path);
    title.setAttr('draggable', 'true');
    if (folder.isRoot()) el.addClass('mod-root');
    // original: setCollapsible() prepends .tree-item-icon.collapse-icon with a right-triangle
    const icon = title.createDiv('tree-item-icon collapse-icon');
    setIcon(icon, 'right-triangle');
    title.createDiv({ cls: 'tree-item-inner nav-folder-title-content' }).setText(folder.name);
    const childrenEl = el.createDiv('tree-item-children nav-folder-children');

    const collapsed = this._collapsed.has(folder.path);
    el.toggleClass('is-collapsed', collapsed);
    icon.toggleClass('is-collapsed', collapsed);
    childrenEl.toggle(!collapsed);

    const toggle = (ev) => {
      ev.stopPropagation();
      const isCollapsed = this._collapsed.has(folder.path);
      if (isCollapsed) this._collapsed.delete(folder.path);
      else this._collapsed.add(folder.path);
      this.render();
    };
    icon.onclick = toggle;
    title.onclick = (ev) => {
      if (ev.target.closest('.collapse-icon')) return;
      toggle(ev);
    };
    title.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._showFolderMenu(ev, folder);
    };
    title.onauxclick = (ev) => { if (ev.button === 1) { ev.preventDefault(); toggle(ev); } };
    this._setupDrag(title, folder);
    this._setupDrop(title, folder, el);

    // render children (visible files only), hide empty folders?
    for (const child of sortChildren(folder.children, order)) {
      if (child instanceof TFolder) this._renderFolder(child, childrenEl, order);
      else if (child instanceof TFile) { if (this._isVisibleFile(child)) this._renderFile(child, childrenEl); }
    }
  }

  _renderFile(file, container) {
    const el = container.createDiv('tree-item nav-file');
    const title = el.createDiv('tree-item-self nav-file-title is-clickable');
    title.setAttr('data-path', file.path);
    title.setAttr('draggable', 'true');
    // original: title text = basename without extension; tag = raw extension (md gets none)
    title.createDiv({ cls: 'tree-item-inner nav-file-title-content' }).setText(file.basename);
    if (file.extension !== 'md') {
      title.createDiv({ cls: 'nav-file-tag', text: file.extension });
    }
    if (!this._isVisibleFile(file)) el.addClass('is-unsupported');

    title.onclick = (ev) => {
      const newLeaf = (ev.metaKey || ev.ctrlKey) ? 'tab' : false;
      this.app.workspace.openFile(file, { newLeaf });
    };
    title.onauxclick = (ev) => {
      if (ev.button === 1) { ev.preventDefault(); this.app.workspace.openFile(file, { newLeaf: 'tab' }); }
    };
    title.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
      this._showFileMenu(ev, file);
    };
    this._setupDrag(title, file);
  }

  // -------------------------------------------------------------------------
  // Drag & drop
  // -------------------------------------------------------------------------
  _setupDrag(el, item) {
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', JSON.stringify({ path: item.path, type: item instanceof TFolder ? 'folder' : 'file' }));
      ev.dataTransfer.effectAllowed = 'move';
      el.addClass('is-being-dragged');
      this._draggingItem = item;
      // 原版 drag-ghost：图标 + 名称，随指针显示
      try {
        const ghost = createDiv('drag-ghost');
        setIcon(ghost.createDiv('drag-ghost-icon'), item instanceof TFolder ? 'folder' : 'file-text');
        ghost.createDiv('drag-ghost-title').setText(item.name);
        document.body.appendChild(ghost);
        if (ev.dataTransfer.setDragImage) ev.dataTransfer.setDragImage(ghost, 12, 12);
        requestAnimationFrame(() => ghost.detach());
      } catch (e) { /* 某些环境不支持 drag image */ }
    });
    el.addEventListener('dragend', () => {
      el.removeClass('is-being-dragged');
      this._draggingItem = null;
      this.treeEl.findAll('.is-being-dragged-over').forEach((e) => e.removeClass('is-being-dragged-over'));
    });
  }

  _setupDrop(titleEl, folder, folderEl) {
    titleEl.addEventListener('dragover', (ev) => {
      if (!this._draggingItem) return;
      const item = this._draggingItem;
      if (item === folder) return;
      if (item instanceof TFolder && folder.path.startsWith(item.path + '/')) return;
      if (parentPathOf(item.path) === folder.path) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      folderEl.addClass('is-being-dragged-over');
    });
    titleEl.addEventListener('dragleave', (ev) => {
      if (!folderEl.contains(ev.relatedTarget)) folderEl.removeClass('is-being-dragged-over');
    });
    titleEl.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      folderEl.removeClass('is-being-dragged-over');
      const item = this._draggingItem;
      if (!item) return;
      const newPath = normalizePath((folder.path === '/' ? '' : folder.path + '/') + item.name);
      if (newPath === item.path) return;
      const ok = await this.app.fileManager.renameFile(item, newPath);
      if (!ok) new Notice(tt('plugins.file-explorer.msg-error-move-failed', `无法移动“${item.name}”`));
    });
  }

  // -------------------------------------------------------------------------
  // Active file highlighting
  // -------------------------------------------------------------------------
  setActivePath(path, reveal = true) {
    this._activePath = path;
    if (!this.treeEl) return;
    this.treeEl.findAll('.nav-file-title.is-active, .nav-folder-title.is-active').forEach((el) => el.removeClass('is-active'));
    if (!path) return;
    if (reveal === true && path) this._expandTo(path);
    const el = this.treeEl.querySelector(`.nav-file-title[data-path="${cssAttr(path)}"]`) ||
      this.treeEl.querySelector(`.nav-folder-title[data-path="${cssAttr(path)}"]`);
    if (el) {
      el.addClass('is-active');
      if (reveal) el.scrollIntoView({ block: 'nearest' });
    }
  }

  _expandTo(path) {
    const parts = path.split('/');
    parts.pop();
    let changed = false;
    let cur = '';
    for (const part of parts) {
      cur = cur ? cur + '/' + part : part;
      if (this._collapsed.has(cur)) { this._collapsed.delete(cur); changed = true; }
    }
    if (changed) {
      const active = this._activePath;
      this.render();
      this._activePath = active;
    }
  }

  revealFile(file) {
    this._expandTo(file.path);
    this.setActivePath(file.path, true);
  }

  // -------------------------------------------------------------------------
  // Context menus
  // -------------------------------------------------------------------------
  _targetFolderForNewFile() {
    const active = this.app.workspace.getActiveFile();
    return this.app.fileManager.getNewFileParent(active ? active.path : '');
  }

  _showFileMenu(ev, file) {
    const menu = new Menu(this.app);
    menu.addItem((i) => i.setTitle(t('interface.menu.open-in-new-tab') || 'Open in new tab').setIcon('file').onClick(() => this.app.workspace.openFile(file, { newLeaf: 'tab' })));
    menu.addItem((i) => i.setTitle(t('interface.menu.open-to-the-right') || 'Open to the right').setIcon('separator-vertical').onClick(() => this.app.workspace.openFile(file, { newLeaf: 'split' })));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('interface.menu.rename') || 'Rename...').setIcon('pencil').onClick(() => this.startRename(file)));
    menu.addItem((i) => i.setTitle(t('interface.menu.delete-file') || 'Delete').setIcon('trash-2').onClick(() => this.app.fileManager.deleteFile(file)));
    if (file.extension === 'md') {
      menu.addItem((i) => i.setTitle(t('plugins.file-explorer.command-make-a-copy') || 'Make a copy').setIcon('copy').onClick(async () => {
        const folder = this.app.vault.getFolderByPath(parentPathOf(file.path)) || this.app.vault.getRoot();
        const copy = await this.app.fileManager.copyFile(file, folder);
        if (copy) this.app.workspace.openFile(copy, { newLeaf: 'tab' });
      }));
    }
    menu.addItem((i) => i.setTitle(t('plugins.file-explorer.action-move-file') || 'Move file to...').setIcon('folder-input').onClick(() => this.promptMove(file)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('interface.menu.copy-path') || 'Copy path').setIcon('clipboard').onClick(() => {
      navigator.clipboard.writeText(this.app.vault.adapter.toAbs(file.path)).catch(() => {});
    }));
    menu.addItem((i) => i.setTitle('Show in system explorer').setIcon('folder-open').onClick(() => {
      require('../core/ipc.js').Desktop.showItemInFolder(this.app.vault.adapter.toAbs(file.path));
    }));
    menu.showAtMouseEvent(ev);
  }

  _showFolderMenu(ev, folder) {
    const menu = new Menu(this.app);
    menu.addItem((i) => i.setTitle(t('plugins.file-explorer.action-new-note') || 'New note').setIcon('file-plus').onClick(() => {
      this._newNoteIn(folder);
    }));
    menu.addItem((i) => i.setTitle(t('plugins.file-explorer.action-new-folder') || 'New folder').setIcon('folder-plus').onClick(() => this._newFolderIn(folder)));
    menu.addSeparator();
    if (!folder.isRoot()) {
      menu.addItem((i) => i.setTitle(t('interface.menu.rename') || 'Rename...').setIcon('pencil').onClick(() => this.startRename(folder)));
      menu.addItem((i) => i.setTitle(t('interface.menu.delete-file') || 'Delete').setIcon('trash-2').onClick(() => this.app.fileManager.deleteFile(folder)));
      menu.addSeparator();
    }
    const subItem = menu.addItem((i) => i.setTitle(t('plugins.file-explorer.action-change-sort') || 'Change sort order').setIcon('arrow-up-narrow-wide').setSubmenu());
    const sub = subItem.submenu;
    if (sub) {
      for (const [key, label] of Object.entries(SORT_ORDERS)) {
        sub.addItem((i) => i.setTitle(label).setChecked(this._sortOrder === key).onClick(() => {
          this._sortOrder = key;
          localStorage.setItem('file-explorer-sort-order', key);
          this.render();
        }));
      }
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('plugins.file-explorer.action-collapse-all') || 'Collapse all').setIcon('chevrons-down-up').onClick(() => {
      this._collapseAll(folder);
    }));
    menu.addItem((i) => i.setTitle(t('plugins.file-explorer.action-expand-all') || 'Expand all').setIcon('chevrons-up-down').onClick(() => {
      this._collapsed.clear();
      this.render();
    }));
    menu.showAtMouseEvent(ev);
  }

  _showRootMenu(ev, folder) {
    this._showFolderMenu(ev, this.app.vault.getRoot());
  }

  _showSortMenu(ev) {
    const menu = new Menu(this.app);
    for (const [key, label] of Object.entries(SORT_ORDERS)) {
      menu.addItem((i) => i.setTitle(label).setChecked(this._sortOrder === key).onClick(() => {
        this._sortOrder = key;
        localStorage.setItem('file-explorer-sort-order', key);
        this.render();
      }));
    }
    menu.showAtMouseEvent(ev);
  }

  _collapseAll(folder) {
    const walk = (f) => {
      for (const c of f.children) {
        if (c instanceof TFolder) { this._collapsed.add(c.path); walk(c); }
      }
    };
    walk(folder);
    this.render();
  }

  // -------------------------------------------------------------------------
  // Creating / renaming
  // -------------------------------------------------------------------------
  async _newNoteIn(folder, openInNew = false) {
    const base = 'Untitled';
    const name = this.app.fileManager.getUniqueFilename(folder, base, '.md');
    const file = await this.app.fileManager.createNewMarkdownFile(folder, name + '.md', '');
    const leaf = await this.app.workspace.openFile(file, openInNew ? { newLeaf: 'split' } : {});
    if (leaf && leaf.view && leaf.view.focusInlineTitle) setTimeout(() => leaf.view.focusInlineTitle(), 30);
    return file;
  }

  async newNoteInCurrentFolder() {
    const folder = this._targetFolderForNewFile();
    return this._newNoteIn(folder);
  }

  async newFolderInCurrentFolder() {
    const folder = this._targetFolderForNewFile();
    return this._newFolderIn(folder);
  }

  async _newFolderIn(folder) {
    let name = 'Untitled';
    const existing = new Set(folder.children.map((c) => c.name));
    if (existing.has(name)) {
      for (let i = 1; i < 1000; i++) { if (!existing.has(`Untitled ${i}`)) { name = `Untitled ${i}`; break; } }
    }
    const path = normalizePath((folder.path === '/' ? '' : folder.path + '/') + name);
    const created = await this.app.vault.createFolder(path);
    this.render();
    setTimeout(() => this.startRename(created), 30);
    return created;
  }

  startRename(item) {
    if (!this.treeEl) return;
    const selector = item instanceof TFolder
      ? `.nav-folder-title[data-path="${cssAttr(item.path)}"] .nav-folder-title-content`
      : `.nav-file-title[data-path="${cssAttr(item.path)}"] .nav-file-title-content`;
    const el = this.treeEl.querySelector(selector);
    if (!el) return;
    const original = el.textContent;
    const input = createEl('input', { type: 'text', cls: 'nav-rename-input' });
    input.value = item instanceof TFile && item.extension ? item.basename : item.name;
    el.setText('');
    el.appendChild(input);
    input.focus();
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    let committed = false;
    const restore = () => {
      el.setText(original);
    };
    const commit = async () => {
      if (committed) return;
      committed = true;
      const value = input.value.trim();
      if (!value || value === (item instanceof TFile ? item.basename : item.name)) { restore(); return; }
      const parent = parentPathOf(item.path);
      const newName = item instanceof TFile && item.extension ? value + '.' + item.extension : value;
      const newPath = normalizePath((parent === '/' ? '' : parent + '/') + newName);
      const ok = item instanceof TFolder
        ? await this.app.fileManager.renameFolder(item, newPath)
        : await this.app.fileManager.renameFile(item, newPath);
      if (!ok) restore();
    };
    input.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); committed = true; restore(); }
    };
    input.onblur = () => commit();
    input.onclick = (ev) => ev.stopPropagation();
  }

  async promptMove(item) {
    const folders = [this.app.vault.getRoot()];
    const collect = (f) => { for (const c of f.children) if (c instanceof TFolder) { folders.push(c); collect(c); } };
    collect(this.app.vault.getRoot());
    const options = folders.filter((f) => f.path !== parentPathOf(item.path) && !(item instanceof TFolder && f.path.startsWith(item.path))).map((f) => ({ label: f.path === '/' ? '/' : f.path, folder: f }));
    const chosen = await new Promise((resolve) => {
      const m = new GenericSuggester(this.app, options, {
        placeholder: t('plugins.file-explorer.action-move-file') || 'Move file to...',
        onChoose: resolve,
      });
      m.open();
      m.onClose = () => resolve(null);
    });
    if (!chosen) return;
    const newPath = normalizePath((chosen.folder.path === '/' ? '' : chosen.folder.path + '/') + item.name);
    const ok = item instanceof TFolder
      ? await this.app.fileManager.renameFolder(item, newPath)
      : await this.app.fileManager.renameFile(item, newPath);
    if (!ok) new Notice('Could not move file.');
  }
}

function cssAttr(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export function create(app) {
  return {
    onload() {
      app.viewRegistry.registerView('file-explorer', (leaf) => new FileExplorerView(leaf));
      this._ribbonIcon = app.workspace.addRibbonItem('folder-closed', t('plugins.file-explorer.name') || 'Files', () => {
        app.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true });
      });
      this.registerCommands(app);
    },
    onunload() {
      app.viewRegistry.unregisterView('file-explorer');
      if (this._ribbonIcon) this._ribbonIcon.detach();
    },
    registerCommands(app) {
      const withView = (fn) => {
        const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
        if (leaf && leaf.view) { fn(leaf.view); return; }
        app.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true }).then((l) => { if (l && l.view) fn(l.view); });
      };
      app.commands.addCommand({
        id: 'file-explorer:new-file',
        name: t('plugins.file-explorer.action-new-note') || 'New note',
        checkCallback: (checking) => {
          if (checking) return true;
          withView((view) => view.newNoteInCurrentFolder && view.newNoteInCurrentFolder());
        },
      });
      app.commands.addCommand({
        id: 'file-explorer:new-file-in-new-pane',
        name: t('plugins.file-explorer.action-create-note-to-the-right') || 'New note to the right',
        checkCallback: (checking) => {
          if (checking) return true;
          withView((view) => view._newNoteIn && view._newNoteIn(view._targetFolderForNewFile(), true));
        },
      });
      app.commands.addCommand({
        id: 'file-explorer:new-folder',
        name: t('plugins.file-explorer.action-new-folder') || 'New folder',
        checkCallback: (checking) => {
          if (checking) return true;
          withView((view) => view.newFolderInCurrentFolder && view.newFolderInCurrentFolder());
        },
      });
      app.commands.addCommand({
        id: 'file-explorer:reveal-active-file',
        name: t('plugins.file-explorer.action-reveal-file') || 'Reveal file in navigation',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) {
            const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
            if (leaf && leaf.view.revealFile) { app.workspace.revealLeaf(leaf); leaf.view.revealFile(file); }
          }
          return true;
        },
      });
      app.commands.addCommand({
        id: 'file-explorer:make-a-copy',
        name: t(IS_MAC ? 'plugins.file-explorer.command-make-a-copy-mac' : 'plugins.file-explorer.command-make-a-copy') || 'Make a copy',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) {
            const folder = app.vault.getFolderByPath(parentPathOf(file.path)) || app.vault.getRoot();
            app.fileManager.copyFile(file, folder).then((copy) => { if (copy) app.workspace.openFile(copy, { newLeaf: 'tab' }); });
          }
          return true;
        },
      });
      app.commands.addCommand({
        id: 'file-explorer:move-file',
        name: t('plugins.file-explorer.command-move-file') || 'Move current file to another folder',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) withView((view) => view.promptMove && view.promptMove(file));
          return true;
        },
      });
    },
    deregister(app) {
      app.viewRegistry.unregisterView('file-explorer');
    },
  };
}
