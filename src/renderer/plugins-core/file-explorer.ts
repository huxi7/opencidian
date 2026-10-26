/**
 * [INPUT]: 依赖 ../core/view.js 的 View；依赖 ../core/i18n.js 的 t/tt；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu；依赖 ../core/notices.js 的 Notice；依赖 ../core/vault.js 的 TFile/TFolder/normalizePath/parentPathOf；依赖 ../core/keymap.js 的 IS_MAC；依赖 ./file-explorer-selection.js 的 FileTreeSelection/isModEvent；依赖 ./file-explorer-drag.js 的拖拽生命周期；依赖 ./file-explorer-multi.js 的多选菜单与批量命令；依赖 ./file-explorer-toolbar.js 的 createExplorerToolbar/syncExplorerToolbar/SORT_ORDER_IDS
 * [OUTPUT]: 导出 FileExplorerView 与插件注册；停用撤销视图与全部六条命令。
 * [POS]: plugins-core/ 的导航面板。DOM 逐字对齐原版：tree-item nav-folder > tree-item-self nav-folder-title.is-clickable > (tree-item-icon.collapse-icon[+right-triangle] + tree-item-inner nav-folder-title-content)。折叠状态同时写在 nav-folder 与 collapse-icon 上（原版 _L() 语义）。插件注册的扩展名加入可见文件。文件标题显示去扩展名 basename，非 md 文件追加 nav-file-tag。
 *        根级文件直接挂匿名容器，不渲染仓库名根标题（原版桌面无根节点标题行）；1.14.4 文件列表没有功能区按钮。
 *        面板头按原版 QL：.nav-header 是内容块第一个子块（固定在树上方，不随树滚动），按钮行宽 100%，侧栏内按用户指定左对齐；中心面板按钮行保持原版居中，排序菜单由 file-explorer-toolbar.js 建，本文件只持 _autoReveal/_allCollapsed 状态并调用 syncExplorerToolbar 渲染。
 *        排序菜单按原版三分组（名称/修改时间/创建时间），组后各插分隔线；自动显示开启时才在 file-open / 活动叶切换时展开祖先并滚入视野。
 *        选择集与键盘由 FileTreeSelection 持有（Alt 切换 / Shift 范围 / 方向键 / Delete），本文件只提供 DOM 与动作（打开、折叠、重命名、删除、菜单）。
 *        拖动生命周期与落点全部委派 file-explorer-drag.js：幽灵、body.is-grabbing、选择集源态、750ms 展开、根落点。
 *        右键菜单按 1.14 onFileContextMenu 的分节与项集构建（open/action-primary/action/info.copy/system/danger），
 *        复制路径子菜单与 system/action 系统项由 file-menu 事件交给 core/file-menu.js 补齐。
 * 延后标题聚焦绑定原视图身份，切换到数据库后不得调用旧标题方法。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: file-explorer — navigation pane with the vault tree. */
import type { EventRef } from '../core/events.js';
import { View } from '../core/view.js';
import { t, tt } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu, MenuEvent } from '../core/menu.js';
import { createExplorerToolbar, syncExplorerToolbar, SORT_ORDER_IDS } from './file-explorer-toolbar.js';
import { Notice } from '../core/notices.js';
import { TFile, TFolder, VaultEntry, normalizePath, parentPathOf } from '../core/vault.js';
import { IS_MAC } from '../core/keymap.js';
import { FileTreeSelection, isModEvent } from './file-explorer-selection.js';
import { chooseMoveTarget, deleteItemsSequentially, showMultiSelectionMenu } from './file-explorer-multi.js';
import { clearDragExpand, endItemDrag, setupFolderDrop, setupItemDrag, setupRootDrop } from './file-explorer-drag.js';
import { WorkspaceLeaf } from '../core/workspace-model.js';

export const nameKey = 'plugins.file-explorer';

const KNOWN_EXTS = new Set([
  'md', 'canvas', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
  'mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'opus', 'mp4', 'webm', 'ogv', 'mov', 'mkv',
]);

function sortChildren(children: VaultEntry[], order: string) {
  const arr = [...children];
  arr.sort((a, b) => {
    const aF = a instanceof TFolder, bF = b instanceof TFolder;
    if (aF !== bF) return aF ? -1 : 1;
    switch (order) {
      case 'alphabeticalReverse':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'byModifiedTime':
      case 'byModifiedTimeReverse': {
        const av = (a instanceof TFile && a.stat.mtime) || 0, bv = (b instanceof TFile && b.stat.mtime) || 0;
        const d = bv - av;
        return order === 'byModifiedTime' ? d : -d;
      }
      case 'byCreatedTime':
      case 'byCreatedTimeReverse': {
        const av = (a instanceof TFile && a.stat.ctime) || 0, bv = (b instanceof TFile && b.stat.ctime) || 0;
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
  declare icon: string;
  declare navigation: boolean;
  declare _collapsed: Set<string>;
  declare _sortOrder: string;
  declare _autoReveal: boolean;
  declare _allCollapsed: boolean;
  declare _activePath: string | null;
  declare _refs: EventRef[];
  declare _rerenderQueued: boolean;
  declare _selection: FileTreeSelection;
  _draggingItem: VaultEntry | null = null;
  declare _draggingItems: VaultEntry[] | null;
  declare _draggingEls: HTMLElement[] | null;
  declare _dragExpandTimer: ReturnType<typeof setTimeout> | null;
  declare _dragExpandPath: string | null;
  declare navHeaderEl: HTMLDivElement;
  declare _sortBtn: HTMLDivElement;
  declare _autoRevealBtn: HTMLDivElement;
  declare _collapseAllBtn: HTMLDivElement;
  declare container: HTMLDivElement;
  declare treeEl: HTMLDivElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.icon = 'folder-closed';
    this.navigation = true;
    this._collapsed = new Set();
    this._sortOrder = localStorage.getItem('file-explorer-sort-order') || 'alphabetical';
    this._autoReveal = false;   // 原版 autoRevealFile 默认关闭（布局恢复时由 setState 回填）
    this._allCollapsed = false;
    this._activePath = null;
    this._refs = [];
    this._rerenderQueued = false;
    this._selection = new FileTreeSelection(this);
    this._draggingItems = null;
    this._draggingEls = null;
    this._dragExpandTimer = null;
    this._dragExpandPath = null;
  }
  getViewType() { return 'file-explorer'; }
  getDisplayText() { return t('plugins.file-explorer.name') || 'Files'; }
  getState() {
    return { collapsed: [...this._collapsed], sortOrder: this._sortOrder, autoReveal: this._autoReveal };
  }
  async setState(state: Record<string,unknown>) {
    if (Array.isArray(state.collapsed)) this._collapsed = new Set(state.collapsed.filter((path): path is string => typeof path === 'string'));
    if (typeof state.sortOrder === 'string') this._sortOrder = state.sortOrder;
    if (state && typeof state.autoReveal === 'boolean') this._autoReveal = state.autoReveal;
  }

  async onOpen() {
    this.contentEl.addClass('file-explorer-view');
    // 原版 QL.addNavButton：.nav-header 是内容块的第一个子块，按钮行固定在树容器上方（见 file-explorer-toolbar.js）
    const toolbar = createExplorerToolbar(this);
    this.navHeaderEl = toolbar.headerEl;
    this._sortBtn = toolbar.sortBtn;
    this._autoRevealBtn = toolbar.autoRevealBtn;
    this._collapseAllBtn = toolbar.collapseAllBtn;
    syncExplorerToolbar(this);

    const container = this.contentEl.createDiv('nav-files-container node-insert-event');
    this.container = container;
    this.treeEl = container.createDiv('nav-tree');
    // 键盘导航：容器本身可聚焦（原版走 scope + focusedItem，本复刻用 DOM 焦点等价）
    container.setAttr('tabindex', '0');
    container.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      const target = ev.target;
      if (target instanceof Element && target.closest('.nav-rename-input')) return;
      this._focusContainer();
    });
    container.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      if (!this._selection.handleKeyDown(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
    });
    // 空白处点击清空选择集（原版 a2 构造函数里的 containerEl click 语义）
    container.addEventListener('click', (ev) => {
      if ((ev.target instanceof Element ? ev.target : null)?.closest('.nav-file-title, .nav-folder-title')) return;
      if ((ev.target instanceof Element ? ev.target : null)?.closest('.nav-buttons-container')) return;
      this._selection.clear();
      this._selection.setFocus(null, false);
    });
    // 根区域空白处：外部文件复制进库根；库内项移回仓库根
    setupRootDrop(this);
    this.render();

    // events
    const debouncedRender = () => this._queueRender();
    this._refs = [
      this.app.vault.on('create', debouncedRender),
      this.app.vault.on('delete', debouncedRender),
      this.app.vault.on('rename', debouncedRender),
      this.app.workspace.on('file-open', () => this._onFileOpen()),
      this.app.workspace.on('active-leaf-change', () => {
        const file = this.app.workspace.getActiveFile();
        // 原版：活动叶变化只标记选择集；展开祖先 + 滚入视野仅由「自动显示当前文件」驱动
        this.setActivePath(file ? file.path : null, this._autoReveal);
      }),
    ];
    // context menu on empty tree area
    container.addEventListener('contextmenu', (ev) => {
      if ((ev.target instanceof Element ? ev.target : null)?.closest('.nav-file-title, .nav-folder-title')) return;
      ev.preventDefault();
      this._selection.clear();
      this._selection.setFocus(null, false);
      this._showRootMenu(ev, this.app.vault.getRoot());
    });
    // keyboard
    this.setActivePath(this.app.workspace.getActiveFile()?.path || null, this._autoReveal);
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
    // 原版桌面文件树不渲染根节点标题；根级文件直接挂在匿名容器里。
    const children = this.treeEl.createDiv();
    this._renderChildren(root, children);
    if (this.treeEl.parentElement) this.treeEl.parentElement.scrollTop = scrollTop;
    this._selection.apply();
  }

  _renderChildren(folder: TFolder, container: HTMLElement) {
    const order = this._sortOrder;
    for (const child of sortChildren(folder.children, order)) {
      if (child instanceof TFolder) this._renderFolder(child, container, order);
      else if (child instanceof TFile) this._renderFile(child, container);

    }
  }

  _isVisibleFile(file: TFile) {
    if (KNOWN_EXTS.has(file.extension) || this.app.viewRegistry.getTypeByExtension(file.extension)) return true;
    return !!this.app.settings.appSettings.showUnsupportedFiles;
  }

  _renderFolder(folder: TFolder, container: HTMLElement, order: string) {
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

    const toggle = (ev: { stopPropagation: () => void; }) => {
      ev.stopPropagation();
      this._toggleFolder(folder.path);
    };
    icon.onclick = toggle;
    title.onclick = (ev: MenuEvent) => {
      if ((ev.target instanceof Element ? ev.target : null)?.closest('.collapse-icon')) return;
      if (this._selection.handleItemSelection(ev, folder)) return;
      toggle(ev);
    };
    title.oncontextmenu = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._showFolderMenu(ev, folder);
    };
    title.onauxclick = (ev) => { if ('button' in ev && ev.button === 1) { ev.preventDefault(); toggle(ev); } };
    setupItemDrag(this, title, folder);
    setupFolderDrop(this, title, folder, el);

    // render children (visible files only), hide empty folders?
    for (const child of sortChildren(folder.children, order)) {
      if (child instanceof TFolder) this._renderFolder(child, childrenEl, order);
      else if (child instanceof TFile) { if (this._isVisibleFile(child)) this._renderFile(child, childrenEl); }
    }
  }

  _renderFile(file: TFile, container: HTMLElement) {
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

    title.onclick = (ev: MenuEvent) => {
      if (this._selection.handleItemSelection(ev, file)) return;
      this._openFileFromTree(ev, file);
    };
    title.onauxclick = (ev: MenuEvent) => {
      if ('button' in ev && ev.button === 1) { ev.preventDefault(); this._selection.handleItemSelection(ev, file); this._openFileFromTree(ev, file); }
    };
    title.oncontextmenu = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
      this._showFileMenu(ev, file);
    };
    setupItemDrag(this, title, file);
  }

  /** 原版 file onSelfClick 的打开分支：Mod → 新标签页（Mod+Alt → 新标签组）。 */
  _openFileFromTree(ev: MenuEvent, file: TFile|null|undefined) {
    const event = isModEvent(ev);
    const newLeaf = event === 'tab' ? 'tab' : (event ? 'split' : false);
    this.app.workspace.openFile(file, { newLeaf });
  }

  // -------------------------------------------------------------------------
  // Active file highlighting
  // -------------------------------------------------------------------------
  setActivePath(path: string|null, reveal = true) {
    this._activePath = path;
    if (!this.treeEl) return;
    this.treeEl.findAll('.nav-file-title.is-active, .nav-folder-title.is-active').forEach((el) => el.removeClass('is-active'));
    if (!path) return;
    if (reveal === true && path) this._expandTo(path);
    const el = this._titleEl(path);
    if (el) {
      el.addClass('is-active');
      if (reveal) el.scrollIntoView({ block: 'nearest' });
    }
  }

  /** 原版 x8.onFileOpen：活动文件不是键盘焦点项时清空选择集，再更新 is-active。 */
  _onFileOpen() {
    const file = this.app.workspace.getActiveFile();
    const path = file ? file.path : null;
    if (path !== this._selection.focusPath) this._selection.clear();
    // 原版 onFileOpen：自动显示开启时才展开祖先并滚入视野
    this.setActivePath(path, this._autoReveal);
  }

  _expandTo(path: string) {
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

  revealFile(file: VaultEntry) {
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

  _showFileMenu(ev: MouseEvent, file: VaultEntry) {
    // 原版：右键项属于多选（≥2）时菜单作用于整个选择集
    if (this._selection.size > 1 && this._selection.has(file.path)) {
      showMultiSelectionMenu(this, ev, file);
      return;
    }
    this._selection.setFocus(file.path, false);
    const menu = new Menu(this.app);
    // 原版 onFileContextMenu 分节表：open 在最前，danger（重命名/删除）在最后
    menu.addSections(['title', 'open', 'action-primary', 'action', 'info', 'info.copy', 'view', 'system', '', 'danger']);
    const isFolder = file instanceof TFolder;
    const isRoot = file instanceof TFolder && file.isRoot();
    if (!isRoot) {
      menu.addItem((i) => i.setSection('danger').setTitle(t('plugins.file-explorer.menu-opt-rename') || 'Rename')
        .setIcon('lucide-edit-3').onClick(() => this.startRename(file)));
    }
    if (isFolder) {
      menu.addItem((i) => i.setSection('action-primary').setTitle(t('plugins.file-explorer.menu-opt-new-note') || 'New note')
        .setIcon('lucide-edit').onClick((ev2) => this._newNoteIn(file, isModEvent(ev2) ? 'tab' : false)));
      menu.addItem((i) => i.setSection('action-primary').setTitle(t('plugins.file-explorer.menu-opt-new-folder') || 'New folder')
        .setIcon('lucide-folder-open').onClick(() => this._newFolderIn(file)));
    } else {
      menu.addItem((i) => i.setSection('open').setTitle(t('interface.menu.open-in-new-tab') || 'Open in new tab')
        .setIcon('lucide-file-plus').onClick(() => this.app.workspace.openFile(file, { newLeaf: 'tab' })));
      menu.addItem((i) => i.setSection('open').setTitle(t('interface.menu.open-to-the-right') || 'Open to the right')
        .setIcon('lucide-separator-vertical').onClick(() => this.app.workspace.openFile(file, { newLeaf: 'split' })));
    }
    if (!isRoot) {
      menu.addItem((i) => i.setSection('action')
        .setTitle(IS_MAC ? (t('plugins.file-explorer.menu-opt-make-copy-mac') || 'Make a copy')
          : (t('plugins.file-explorer.menu-opt-make-copy') || 'Make a copy'))
        .setIcon('lucide-files').onClick(async (ev2) => {
          const parent = this.app.vault.getFolderByPath(parentPathOf(file.path)) || this.app.vault.getRoot();
          const copy = await this.app.fileManager.copyFile(file, parent);
          if (copy) copy instanceof TFile && this._afterCreate(copy, isModEvent(ev2));
        }));
      menu.addItem((i) => i.setSection('danger').setTitle(t('plugins.file-explorer.menu-opt-delete') || 'Delete')
        .setIcon('lucide-trash-2').setWarning(true).onClick(() => this.app.fileManager.promptForDeletion(file)));
    }
    this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', null);
    const titleEl = this._titleEl(file.path);
    if (titleEl) menu.setParentElement(titleEl as HTMLElement);
    menu.showAtMouseEvent(ev);
  }

  /** 原版 afterCreate：文件副本在标签页打开并进入改名；文件夹只排序。 */
  async _afterCreate(file: TFile, openInNew: boolean | string = false) {
    if (file instanceof TFolder) return;
    const leaf = await this.app.workspace.openFile(file, openInNew ? { newLeaf: 'tab' } : {});
    const view = leaf?.view;
    if (view?.focusInlineTitle) setTimeout(() => { if (leaf.view === view) view.focusInlineTitle?.(); }, 30);
  }

  _showFolderMenu(ev: MouseEvent, folder: TFolder) {
    this._showFileMenu(ev, folder);
  }

  _showRootMenu(ev: MouseEvent, folder: TFolder) {
    this._showFolderMenu(ev, this.app.vault.getRoot());
  }

  /** 原版 setSortOrder：记排序并保存布局。 */
  setSortOrder(order: string) {
    if (!SORT_ORDER_IDS.has(order)) return;
    this._sortOrder = order;
    localStorage.setItem('file-explorer-sort-order', order);
    this.render();
  }

  /** 原版 onToggleAutoReveal：切换 is-active，开启时立即揭示当前文件并保存布局。 */
  _toggleAutoReveal() {
    this._autoReveal = !this._autoReveal;
    syncExplorerToolbar(this);
    if (this._autoReveal) this._revealActiveFile();
    void this.app.saveLayout();
  }

  /** 原版 revealActiveFile：展开祖先并滚入视野（init 时同样带 4 行预滚动余量）。 */
  _revealActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    this._expandTo(file.path);
    const el = this._titleEl(file.path);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  /** 原版 tree.toggleCollapseAll + setIsAllCollapsed：折叠全部 ↔ 展开全部，按钮图标/提示同步。 */
  _toggleCollapseAll() {
    this._allCollapsed = !this._allCollapsed;
    this._setCollapsedAll(this._allCollapsed);
    syncExplorerToolbar(this);
  }

  // -------------------------------------------------------------------------
  // Creating / renaming
  // -------------------------------------------------------------------------
  async _newNoteIn(folder: TFolder, newLeaf: boolean | string = false) {
    const base = 'Untitled';
    const name = this.app.fileManager.getUniqueFilename(folder, base, '.md');
    const file = await this.app.fileManager.createNewMarkdownFile(folder, name + '.md', '');
    const options = newLeaf === 'tab' ? { newLeaf: 'tab' } : (newLeaf ? { newLeaf: 'split' } : {});
    const leaf = await this.app.workspace.openFile(file, options);
    const view = leaf?.view;
    if (view?.focusInlineTitle) setTimeout(() => { if (leaf.view === view) view.focusInlineTitle?.(); }, 30);
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

  /** 建文件夹（唯一名 + 渲染），调用方决定是否进入重命名。 */
  async _createFolderIn(folder: TFolder) {
    let name = 'Untitled';
    const existing = new Set(folder.children.map((c) => c.name));
    if (existing.has(name)) {
      for (let i = 1; i < 1000; i++) { if (!existing.has(`Untitled ${i}`)) { name = `Untitled ${i}`; break; } }
    }
    const path = normalizePath((folder.path === '/' ? '' : folder.path + '/') + name);
    const created = await this.app.vault.createFolder(path);
    this.render();
    return created;
  }

  async _newFolderIn(folder: TFolder) {
    const created = await this._createFolderIn(folder);
    setTimeout(() => this.startRename(created), 30);
    return created;
  }

  startRename(item: VaultEntry) {
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

  async promptMove(item: VaultEntry) {
    const chosen = await chooseMoveTarget(this, [item]);
    if (!chosen) return;
    const newPath = normalizePath((chosen.path === '/' ? '' : chosen.path + '/') + item.name);
    const ok = item instanceof TFolder
      ? await this.app.fileManager.renameFolder(item, newPath)
      : await this.app.fileManager.renameFile(item, newPath);
    if (!ok) new Notice(tt('plugins.file-explorer.msg-error-move-file-failed', '无法移动文件。'));
  }

  // -------------------------------------------------------------------------
  // Multi-selection actions (keyboard / menu / drag fall through to these)
  // -------------------------------------------------------------------------
  _itemByPath(path: string | null) { if (!path) return null; return this.app.vault.getAbstractFileByPath(path) || null; }

  _titleEl(path: string | null) { if (!path) return null;
    if (!this.treeEl) return null;
    const attr = `data-path="${cssAttr(path)}"`;
    return this.treeEl.querySelector<HTMLElement>(`.nav-file-title[${attr}]`) || this.treeEl.querySelector<HTMLElement>(`.nav-folder-title[${attr}]`);
  }

  /** 原版 S8.selectItem 的门：showUnsupportedFiles 关闭时不受支持的文件不可选中。 */
  _isSelectablePath(path: string | null): path is string { if (!path) return false;
    const item = this._itemByPath(path);
    return !!item && !(item instanceof TFile && !this._isVisibleFile(item));
  }

  /** 键盘导航需要容器持有 DOM 焦点（原版靠 scope 栈，不依赖焦点元素）。 */
  _focusContainer() {
    if (!this.container || document.activeElement === this.container) return;
    const active = document.activeElement;
    if (active && active.closest && active.closest('.nav-rename-input')) return;
    try { this.container.focus({ preventScroll: true }); } catch (e) { this.container.focus(); }
  }

  _toggleFolder(path: string) {
    const expanded = this._collapsed.has(path);
    if (expanded) this._collapsed.delete(path);
    else this._collapsed.add(path);
    // 原版 setCollapsed(false) → setIsAllCollapsed(false)：手动展开任一文件夹即退出"全部折叠"态
    if (expanded) this._markAllCollapsed(false);
    this.render();
  }

  _setCollapsed(path: string, collapsed: boolean) {
    if (collapsed) this._collapsed.add(path); else this._collapsed.delete(path);
    if (!collapsed) this._markAllCollapsed(false);
    this.render();
  }

  /** 已不是"全部折叠"时把按钮切回 Collapse all 图标与文案（原版 setIsAllCollapsed）。 */
  _markAllCollapsed(allCollapsed: boolean) {
    if (this._allCollapsed === allCollapsed) return;
    this._allCollapsed = allCollapsed;
    syncExplorerToolbar(this);
  }

  /** 原版 setCollapseAll：折叠/展开全部文件夹。 */
  _setCollapsedAll(collapsed: boolean) {
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (!(child instanceof TFolder)) continue;
        if (collapsed) this._collapsed.add(child.path); else this._collapsed.delete(child.path);
        walk(child);
      }
    };
    walk(this.app.vault.getRoot());
    this.render();
  }

  /** 原版 onKeyOpen → focusedItem.onSelfClick：文件打开，文件夹折叠切换。 */
  _activateFocused() {
    const item = this._selection.focusPath ? this._itemByPath(this._selection.focusPath) : null;
    if (item instanceof TFolder) this._toggleFolder(item.path);
    else if (item) this._openFromKeyboard(item);
  }

  /** 键盘打开（Mod+方向键 / Mod+Enter / Space）：打开后把焦点还给树，便于继续移动。 */
  async _openFromKeyboard(file: TFile|null|undefined) {
    if (!(file instanceof TFile)) return;
    await this.app.workspace.openFile(file);
    this._focusContainer();
  }

  /** 原版 Mod+方向键的非文件夹判定：焦点项是文件才打开。 */
  _openFocusedFile() {
    const item = this._selection.focusPath ? this._itemByPath(this._selection.focusPath) : null;
    if (item instanceof TFile) this._openFromKeyboard(item);
  }

  /** 原版 onKeyRename / handleRenameFocusedItem：根目录不可重命名。 */
  _renameFocused() {
    const item = this._selection.focusPath ? this._itemByPath(this._selection.focusPath) : null;
    if (item && !(item instanceof TFolder && item.isRoot())) this.startRename(item);
  }

  /** 原版 onDeleteSelectedFiles：选择集优先，空集时退到焦点项。 */
  _deleteSelected() {
    const items = this._selection.items();
    if (!items.length) {
      const focused = this._selection.focusPath ? this._itemByPath(this._selection.focusPath) : null;
      if (focused) items.push(focused);
    }
    return deleteItemsSequentially(this, items);
  }
}

function cssAttr(s: string) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export function create(app: App) {
  return {
    onload() {
      app.viewRegistry.registerView('file-explorer', (leaf) => new FileExplorerView(leaf));
      // 原版 1.14.4 的文件列表没有功能区按钮；首个按钮属于快速切换。
      this.registerCommands(app);
    },
    onunload() {
      app.viewRegistry.unregisterView('file-explorer');
      this.deregisterCommands();
    },
    registerCommands(app: App) {
      const withView = (fn: (view: FileExplorerView) => unknown) => {
        const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
        if (leaf?.view instanceof FileExplorerView) { fn(leaf.view); return; }
        app.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true }).then((l) => { if (l?.view instanceof FileExplorerView) fn(l.view); });
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
            if (leaf?.view?.revealFile) { app.workspace.revealLeaf(leaf); leaf.view.revealFile(file); }
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
            app.fileManager.copyFile(file, folder).then((copy) => { if (copy instanceof TFile) app.workspace.openFile(copy, { newLeaf: 'tab' }); });
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
    deregisterCommands() {
      for (const id of ['new-file', 'new-file-in-new-pane', 'new-folder', 'reveal-active-file', 'make-a-copy', 'move-file']) app.commands.removeCommand('file-explorer:' + id);
    },
  };
}
