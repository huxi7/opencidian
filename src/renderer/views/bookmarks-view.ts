/**
 * [INPUT]: 依赖 ../core/view.js 的 View；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu；依赖 ../core/notices.js 的 Notice
 * [OUTPUT]: 导出 BookmarksView 类；行点击与中键把真实事件交给插件选择目标标签。
 * [POS]: 空分组保持可见，活动项按文件路径匹配。views/ 的书签面板视图。由 plugins-core/bookmarks.js 注册为 'bookmarks' 视图类型并注入插件实例（setPlugin）。DOM 对齐原版：tree-item-self.bookmark 行 + tree-item-icon + tree-item-inner-text，分组可折叠（right-triangle），条目图标用 lucide-* 全名（folder 必须绕开别名表），视图头四钮（bookmark-plus/folder-plus/chevrons-down-up/search），行尾无“…”按钮（重命名/删除/复制路径只走右键菜单），点击文件打开、搜索钮展开 SearchComponent 过滤标题与路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Bookmarks view — tree of bookmarks grouped by item type. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { Notice } from '../core/notices.js';
import { SearchComponent } from '../core/setting.js';

function itemIcon(item) {
  // 显式 lucide- 前缀：绕过别名表（'folder' 会被别名解析成 folder-open，原版是闭口 folder）。
  if (item.type === 'file') {
    if (item.path.endsWith('.canvas')) return 'lucide-layout-dashboard';
    if (item.subpath && item.subpath.startsWith('#^')) return 'lucide-toy-brick';
    if (item.subpath && item.subpath.startsWith('#')) return 'lucide-heading';
    return 'lucide-file';
  }
  if (item.type === 'folder') return 'lucide-folder';
  if (item.type === 'search') return 'lucide-search';
  if (item.type === 'graph') return 'lucide-git-fork';
  if (item.type === 'url') return 'lucide-globe-2';
  return 'lucide-bookmark';
}

export class BookmarksView extends View {
  declare icon: string;
  declare navigation: boolean;
  declare _plugin: any;
  declare _refs: any[];
  declare _collapsed: any;
  declare _queueTimer: any;
  declare _searchTimer: any;
  declare _searchQuery: string;
  declare _isSearching: boolean;
  declare _search: any;
  declare _searchBtn: any;
  declare _header: any;
  declare _buttons: any;
  declare _collapseAllBtn: any;
  declare _treeEl: any;

  constructor(leaf) {
    super(leaf);
    this.icon = 'bookmark';
    this.navigation = true;
    this._plugin = null;
    this._refs = [];
    this._collapsed = new Set();
    this._queueTimer = null;
    this._searchTimer = null;
    this._searchQuery = '';
    this._isSearching = false;
    this._search = null;
    this._searchBtn = null;
  }
  getViewType() { return 'bookmarks'; }
  getDisplayText() { return t('plugins.bookmarks.name') || 'Bookmarks'; }
  getIcon() { return 'bookmark'; }
  setPlugin(plugin) { this._plugin = plugin; }

  async onOpen() {
    this.contentEl.addClass('bookmarks-view');
    this._render();
    this._refs = [
      this.app.workspace.on('file-open', () => this._updateActive()),
      this.app.workspace.on('active-leaf-change', () => this._updateActive()),
      this.app.vault.on('create', () => this._queueRender()),
      this.app.vault.on('delete', () => this._queueRender()),
      this.app.vault.on('rename', () => this._queueRender()),
    ];
    if (this._plugin) this._refs.push(this._plugin.on('changed', () => this._queueRender()));
  }

  onClose() {
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
    clearTimeout(this._queueTimer);
  }

  _queueRender() {
    if (this._queueTimer) return;
    this._queueTimer = setTimeout(() => { this._queueTimer = null; this._render(); }, 50);
  }

  /* ------------------------------------------------------------------ 渲染 */
  _render() {
    clearTimeout(this._queueTimer);
    this._queueTimer = null;
    const plugin = this._plugin;
    if (!plugin) return;
    this.contentEl.empty();
    // 原版 QL：.nav-header 固定在上方（按钮行 + 搜索框），树在下方滚动。
    this._header = this.contentEl.createDiv('nav-header');
    this._buttons = this._header.createDiv('nav-buttons-container');
    this._addNavButton('lucide-bookmark-plus', t('plugins.bookmarks.action-new-bookmark') || 'Bookmark current tab', () => {
      plugin.bookmarkCurrentView();
    });
    this._addNavButton('lucide-folder-plus', t('plugins.bookmarks.action-new-group') || 'New group', () => this._createGroup(null));
    const collapseBtn = this._addNavButton('lucide-chevrons-down-up', t('plugins.bookmarks.action-collapse-all') || 'Collapse all', (ev) => this._toggleCollapseAll(ev.currentTarget));
    this._collapseAllBtn = collapseBtn;
    // 原版视图头第四个动作：搜索书签（lucide-search + 收起式输入框）。
    this._searchBtn = this._addNavButton('lucide-search', t('plugins.bookmarks.action-search', 'Search bookmarks') || 'Search bookmarks', () => this._toggleSearch());
    this._buildSearch();
    this._treeEl = this.contentEl.createDiv('bookmarks-tree');
    this._renderTree();
  }

  /** 搜索框：原版 addSearchButton → SearchComponent 挂在 nav-header，按钮切换显隐。 */
  _buildSearch() {
    this._search = new SearchComponent(this._header);
    this._search
      .setPlaceholder(t('plugins.bookmarks.placeholder-search', 'Search bookmarks...') || 'Search bookmarks...')
      .onChange((value) => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          const query = String(value || '').trim().toLowerCase();
          if (query === this._searchQuery) return;
          this._searchQuery = query;
          this._renderTree();
        }, 150);
      });
    this._search.inputEl.addEventListener('keydown', (ev) => {
      if (ev.isComposing) return;
      if (ev.key === 'Escape') { ev.preventDefault(); this._toggleSearch(false); }
    });
    this._search.containerEl.toggle(this._isSearching);
    if (this._isSearching) this._search.setValue(this._searchQuery);
  }

  _toggleSearch(force?) {
    if (!this._search || !this._searchBtn) return;
    const show = force === undefined ? !this._isSearching : !!force;
    this._isSearching = show;
    this._search.containerEl.toggle(show);
    this._searchBtn.toggleClass('is-active', show);
    if (show) {
      this._search.inputEl.focus();
      this._search.inputEl.select();
    } else if (this._searchQuery) {
      this._searchQuery = '';
      this._search.setValue('');
      this._renderTree();
    }
  }

  /** 只重建树：搜索输入时不重建头部，避免输入框失焦。 */
  _renderTree() {
    const plugin = this._plugin;
    if (!this._treeEl || !plugin) return;
    this._treeEl.empty();
    if (!plugin.hasValidData) {
      const errorEl = this._treeEl.createDiv('pane-empty mod-error');
      errorEl.createDiv({ text: t('plugins.bookmarks.label-invalid-data') || 'Failed to load bookmarks.' });
      errorEl.createDiv({ text: t('plugins.bookmarks.label-invalid-data-desc') || 'The data file is corrupted.' });
      return;
    }
    if (!plugin.items.length) {
      /* 原版语义：空态提示只在顶层无条目时出现（缺失文件的隐藏行不算空）。 */
      this._treeEl.createDiv({ cls: 'pane-empty bookmarks-pane-empty', text: t('plugins.bookmarks.label-no-bookmarks') || 'No bookmarks found.' });
      this._updateActive();
      return;
    }
    for (const item of plugin.items) this._renderItem(this._treeEl, item, null);
    this._updateActive();
  }

  /** 搜索命中：标题/路径/查询串任一处包含查询词；分组按后代是否命中保留。 */
  _itemMatches(item) {
    const query = this._searchQuery;
    if (!query) return true;
    const plugin = this._plugin;
    const haystack = [
      plugin ? plugin.getItemTitle(item) : '',
      item.path || '',
      item.subpath || '',
      item.query || '',
      item.url || '',
    ].join(' ').toLowerCase();
    if (haystack.includes(query)) return true;
    if (item.type === 'group') return (item.items || []).some((child) => this._itemMatches(child));
    return false;
  }

  _addNavButton(icon, label, callback) {
    const btn = this._buttons.createDiv('nav-action-button clickable-icon');
    btn.setAttr('aria-label', label);
    setIcon(btn, icon);
    btn.onclick = callback;
    return btn;
  }

  /** 渲染一条书签，返回该行是否可见（文件不存在时隐藏，对齐原版）。 */
  _renderItem(container, item, parentItem) {
    if (!this._itemMatches(item)) return false;
    const plugin = this._plugin;
    const isGroup = item.type === 'group';
    const itemEl = container.createDiv('tree-item');
    itemEl.setAttr('data-path', this._itemPath(item));
    const self = itemEl.createDiv('tree-item-self is-clickable bookmark');
    if (isGroup) self.addClass('mod-collapsible');
    if (item.type === 'file') self.setAttr('data-file', item.path);

    if (isGroup) {
      const iconEl = self.createDiv('tree-item-icon collapse-icon');
      setIcon(iconEl, 'right-triangle');
      const collapsed = !this._searchQuery && this._collapsed.has(item.ctime);
      iconEl.toggleClass('is-collapsed', collapsed);
      itemEl.toggleClass('is-collapsed', collapsed);
    } else {
      const iconEl = self.createDiv('tree-item-icon');
      setIcon(iconEl, itemIcon(item));
    }

    const inner = self.createDiv('tree-item-inner');
    const titleEl = inner.createSpan('tree-item-inner-text');
    titleEl.setText(plugin.getItemTitle(item) || '');

    // 原版条目没有行尾“…”按钮：重命名/删除/复制路径走右键菜单。
    self.oncontextmenu = (ev) => { ev.preventDefault(); this._showItemMenu(ev, item, parentItem); };
    self.onclick = (ev) => {
      if (isGroup) this._toggleGroup(item, itemEl, self);
      else if (ev.button === 0) plugin.openItem(item, ev);
    };
    self.onauxclick = ev => {
      if (ev.button !== 1 || isGroup) return;
      ev.preventDefault(); plugin.openItem(item, ev);
    };
    // 行内重命名入口（双击标题）
    titleEl.ondblclick = (ev) => { ev.stopPropagation(); this._startRename(item, self, titleEl); };

    let visible = true;
    if (item.type === 'file' || item.type === 'folder') {
      visible = !!this.app.vault.getAbstractFileByPath(item.path);
      self.toggle(visible);
    }

    if (isGroup) {
      const children = itemEl.createDiv('tree-item-children');
      for (const child of item.items || []) this._renderItem(children, child, item);
      return visible;
    }
    return visible;
  }

  _itemPath(item) {
    const plugin = this._plugin;
    const parts = [];
    let node = item;
    while (node) {
      parts.push(plugin ? plugin.getItemTitle(node) : '');
      node = node[Object.getOwnPropertySymbols(node).find((s) => String(s).includes('parent'))] || null;
    }
    return parts.reverse().join('/');
  }

  _toggleGroup(item, itemEl, self) {
    const collapsed = !this._collapsed.has(item.ctime);
    if (collapsed) this._collapsed.add(item.ctime);
    else this._collapsed.delete(item.ctime);
    itemEl.toggleClass('is-collapsed', collapsed);
    const iconEl = self.querySelector('.collapse-icon');
    if (iconEl) iconEl.toggleClass('is-collapsed', collapsed);
  }

  _toggleCollapseAll(btn) {
    const plugin = this._plugin;
    const allCollapsed = this._collapsed.size > 0;
    if (allCollapsed) this._collapsed.clear();
    else for (const item of plugin.items) this._collectGroups(item, (g) => this._collapsed.add(g.ctime));
    if (btn) {
      btn.empty();
      setIcon(btn, allCollapsed ? 'lucide-chevrons-down-up' : 'lucide-chevrons-up-down');
      btn.setAttr('aria-label', allCollapsed
        ? (t('plugins.bookmarks.action-collapse-all') || 'Collapse all')
        : (t('file-explorer.action-expand-all') || 'Expand all'));
    }
    this._renderTree();
  }

  _collectGroups(item, cb) {
    if (item.type !== 'group') return;
    cb(item);
    for (const child of item.items || []) this._collectGroups(child, cb);
  }

  _updateActive() {
    if (!this._treeEl) return;
    const active = this.app.workspace.getActiveFile();
    this._treeEl.findAll('.tree-item-self.is-active').forEach((el) => el.removeClass('is-active'));
    if (!active) return;
    const row = this._treeEl.findAll('.tree-item-self.bookmark').find((el) => {
      return el.getAttr('data-file') === active.path;
    });
    if (row) row.addClass('is-active');
  }

  /* ------------------------------------------------------------------ 菜单 */
  _showItemMenu(ev, item, parentItem) {
    const plugin = this._plugin;
    const menu = new Menu(this.app);
    menu.addItem((i) => i
      .setTitle(t('plugins.bookmarks.menu-opt-rename') || 'Rename')
      .setIcon('pencil')
      .onClick(() => {
        const self = ev.target.closest ? ev.target.closest('.tree-item-self') : null;
        if (self) this._startRename(item, self, self.querySelector('.tree-item-inner-text'));
      }));
    menu.addItem((i) => i
      .setTitle(t('plugins.bookmarks.menu-opt-remove') || 'Remove')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => plugin.removeItem(item)));
    menu.addItem((i) => i
      .setTitle(t('interface.menu.copy-path') || 'Copy path')
      .setIcon('copy')
      .onClick(() => this._copyPath(item)));
    if (item.type === 'group') {
      menu.addSeparator();
      menu.addItem((i) => i
        .setTitle(t('plugins.bookmarks.action-new-group') || 'New group')
        .setIcon('folder-plus')
        .onClick(() => this._createGroup(item)));
    }
    menu.showAtMouseEvent(ev);
  }

  _copyPath(item) {
    let value = '';
    if (item.type === 'file') value = item.path + (item.subpath || '');
    else if (item.type === 'folder') value = item.path;
    else if (item.type === 'search') value = item.query;
    else if (item.type === 'url') value = item.url;
    else value = this._plugin.getItemTitle(item) || '';
    if (navigator.clipboard && navigator.clipboard.writeText) { try { const p = navigator.clipboard.writeText(value); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    new Notice(t('interface.menu.copy-path') || 'Copy path');
  }

  _createGroup(parentItem) {
    const plugin = this._plugin;
    const group = plugin.createGroup(parentItem);
    this._render();
    const row = this._treeEl.findAll('.tree-item-self.bookmark').find((el) => {
      const titleEl = el.querySelector('.tree-item-inner-text');
      return titleEl && titleEl.textContent === plugin.getItemTitle(group);
    });
    if (row) this._startRename(group, row, row.querySelector('.tree-item-inner-text'));
  }

  /* ------------------------------------------------------------------ 重命名 */
  _startRename(item, self, titleEl) {
    if (!titleEl) return;
    self.addClass('is-being-renamed');
    titleEl.setAttr('contenteditable', 'true');
    titleEl.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    selection.removeAllRanges();
    selection.addRange(range);
    const commit = (save) => {
      titleEl.removeAttribute('contenteditable');
      self.removeClass('is-being-renamed');
      titleEl.onkeydown = null;
      titleEl.onblur = null;
      if (save) {
        const value = titleEl.textContent.trim();
        if (value) this._plugin.renameItem(item, value);
        else titleEl.setText(this._plugin.getItemTitle(item) || '');
      } else {
        titleEl.setText(this._plugin.getItemTitle(item) || '');
      }
    };
    titleEl.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    };
    titleEl.onblur = () => commit(true);
  }
}
