/**
 * [INPUT]: 依赖 node 内置 fs/path（探测 .obsidian/bookmarks.json 是否存在）；依赖 ../core/events.js 的 Events；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/notices.js 的 Notice；依赖 ../core/vault.js 的 TFolder；依赖 ../views/bookmarks-view.js 的 BookmarksView
 * [OUTPUT]: 导出 nameKey、create(app)（插件实例：items/hasValidData/getItemTitle/openItem/removeItem/renameItem/createGroup/addItem/bookmarkCurrentView/on('changed')），注册 'bookmarks' 视图与 5 条命令（open/bookmark-current-view/unbookmark-current-view/bookmark-current-search/bookmark-current-heading）
 * [POS]: 文件视图均可收藏，目录改名同步子路径书签。plugins-core/ 的书签插件与数据层。数据 .obsidian/bookmarks.json（{items:[...]}，项形状对齐原版：file/folder/search/group），无数据时从 .obsidian/starred.json 迁移。视图只渲染，增删改与打开行为都在本文件；file 书签直接解析 vault 文件并带 subpath eState 打开（不走 openLinkText）。视图头部书签图标按原版 addAction 语义 prepend 注入，由 mod-bookmark/mod-bookmarked 类控制显隐（见 styles/bookmarks.css）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: bookmarks — bookmark files, folders, searches and groups. */
import { Events } from '../core/events.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Notice } from '../core/notices.js';
import { TFolder } from '../core/vault.js';
import { BookmarksView } from '../views/bookmarks-view.js';

/* 渲染进程 nodeIntegration:true；同步探测数据文件存在性，区分"缺失"与"损坏"。 */
const fs = require('fs');
const nodePath = require('path');

export const nameKey = 'plugins.bookmarks';

const DATA_FILE = 'bookmarks.json';
const LEGACY_FILE = 'starred.json';

/* 父项链用 Symbol 挂在项上（原版 IJ），JSON 序列化自动忽略。 */
const PARENT = Symbol('parent');

function untitledGroup() {
  return t('plugins.bookmarks.label-untitled-group') || 'Untitled group';
}

/* --------------------------------------------------------------------------
 * BookmarksPlugin — 插件实例（core/plugins.js 直接调用其 onload/onunload）
 * ------------------------------------------------------------------------ */
class BookmarksPlugin extends Events {
  constructor(app) {
    super();
    this.app = app;
    this.items = [];
    this.hasValidData = false;
    this._dataFileExists = false;   // 区分"文件缺失"（空态）与"文件损坏"（invalid）
    this.bookmarkLookup = {};       // path -> 无 subpath 的 file / folder 项
    this._refs = [];
    this._commandIds = [];
  }

  /* ---------------------------------------------------------------- 生命周期 */
  onload() {
    this._loadData();
    this._migrateLegacyStarred();
    this._registerCommands();
    this.app.viewRegistry.registerView('bookmarks', (leaf) => {
      const view = new BookmarksView(leaf);
      view.setPlugin(this);
      return view;
    });
    this._refs = [
      this.app.workspace.on('layout-change', () => this.updateViewActions()),
      this.app.vault.on('rename', (file, oldPath) => this._onFileRename(file, oldPath)),
    ];
  }

  onunload() {
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
    this.deregisterCommands();
    this.app.viewRegistry.unregisterView('bookmarks');
    this._removeViewActions();
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  /* ---------------------------------------------------------------- 数据层 */
  /* 原版语义：文件缺失 → 空态（hasValidData=true）；存在但解析失败 → 损坏（false）。 */
  _loadData() {
    this._dataFileExists = fs.existsSync(nodePath.join(this.app.settings.dir, DATA_FILE));
    if (!this._dataFileExists) {
      this.hasValidData = true;
      this.items = [];
      this.rebuildLookup();
      return;
    }
    const data = this.app.settings.readJson(DATA_FILE);
    this.hasValidData = data !== null && data !== undefined;
    if (data && Array.isArray(data.items)) {
      this._setParents(data.items, null);
      this.items = data.items;
    }
    this.rebuildLookup();
  }

  /** 旧版 starred.json → bookmarks.json 一次性迁移（仅 bookmarks.json 不存在时）。 */
  _migrateLegacyStarred() {
    if (this._dataFileExists) return;
    const starred = this.app.settings.readJson(LEGACY_FILE);
    if (!starred || !Array.isArray(starred.items)) return;
    const now = Date.now();
    const items = [];
    for (const raw of starred.items) {
      if (raw.type !== 'file' && raw.type !== 'folder') continue;
      if (!this.app.vault.getAbstractFileByPath(raw.path)) continue;
      const item = { ...raw };
      if (item.type === 'file') delete item.title;
      if (!item.ctime) item.ctime = now;
      items.push(item);
    }
    if (!items.length) return;
    this._setParents(items, null);
    this.items = items;
    this._onItemsChanged(true);
  }

  _setParents(items, parent) {
    for (const item of items) {
      item[PARENT] = parent;
      if (item.type === 'group' && Array.isArray(item.items)) this._setParents(item.items, item);
    }
  }

  /** 只索引 folder 与无 subpath 的 file（原版 rebuildBookmarkCache）。 */
  rebuildLookup() {
    this.bookmarkLookup = {};
    const walk = (items) => {
      for (const item of items) {
        if (item.type === 'folder' || (item.type === 'file' && !item.subpath)) this.bookmarkLookup[item.path] = item;
        if (item.type === 'group' && Array.isArray(item.items)) walk(item.items);
      }
    };
    walk(this.items);
  }

  saveData() {
    this.app.settings.savePluginData(DATA_FILE, { items: this.items });
  }

  _onItemsChanged(save) {
    this.trigger('changed');
    this.rebuildLookup();
    this.updateViewActions();
    if (save) this.saveData();
  }

  /* ---------------------------------------------------------------- 增删改查 */
  addItem(item, parent) {
    item[PARENT] = parent || null;
    if (parent) {
      if (!Array.isArray(parent.items)) parent.items = [];
      parent.items.push(item);
    } else {
      this.items.push(item);
    }
    this._onItemsChanged(true);
    return item;
  }

  removeItem(item) {
    const parent = item[PARENT];
    const list = parent ? parent.items || [] : this.items;
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
    this._onItemsChanged(true);
  }

  renameItem(item, title) {
    item.title = title;
    this._onItemsChanged(true);
  }

  createGroup(parentItem) {
    const group = { type: 'group', ctime: Date.now(), items: [], title: untitledGroup() };
    this.addItem(group, parentItem || null);
    return group;
  }

  /** 项显示名：自定义 title 优先；file/folder 取 vault 内名字；search 取 query。 */
  getItemTitle(item) {
    if (!item) return '';
    if (item.title) return item.title;
    if (item.type === 'file' && item.subpath) return this._fileTitle(item.path) + item.subpath;
    if (item.type === 'file' || item.type === 'folder') {
      const file = this.app.vault.getAbstractFileByPath(item.path);
      if (file) return file instanceof TFolder ? file.name : file.basename;
      return this._fileTitle(item.path);
    }
    if (item.type === 'search') return item.query || '';
    if (item.type === 'group') return untitledGroup();
    if (item.type === 'graph') return t('plugins.bookmarks.label-untitled-graph') || 'Untitled graph';
    if (item.type === 'url') return item.url || '';
    return '';
  }

  _fileTitle(path) {
    const name = String(path || '').split('/').pop() || '';
    return name.replace(/\.md$/i, '');
  }

  _walkItems(callback, items = this.items) {
    for (const item of items || []) {
      if (callback(item) === false) return false;
      if (item.type === 'group' && this._walkItems(callback, item.items) === false) return false;
    }
    return true;
  }

  _findFileItem(path, subpath) {
    let found = null;
    this._walkItems((item) => {
      if (item.type === 'file' && item.path === path && (item.subpath || '') === (subpath || '')) { found = item; return false; }
      return true;
    });
    return found;
  }

  _findSearchItem(query) {
    let found = null;
    this._walkItems((item) => {
      if (item.type === 'search' && item.query === query) { found = item; return false; }
      return true;
    });
    return found;
  }

  /* ---------------------------------------------------------------- 打开 */
  async openItem(item) {
    if (!item) return;
    if (item.type === 'file') {
      const file = this.app.vault.getFileByPath(item.path);
      if (!file) return;
      await this.app.workspace.openFile(file, item.subpath ? { eState: { subpath: item.subpath } } : {});
    } else if (item.type === 'folder') {
      this._revealFolder(item.path);
    } else if (item.type === 'search') {
      this._openSearch(item.query);
    } else if (item.type === 'url') {
      window.open(item.url, '_blank');
    }
  }

  _revealFolder(path) {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) return;
    const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (leaf && leaf.view && leaf.view.revealFile) {
      this.app.workspace.revealLeaf(leaf);
      leaf.view.revealFile(folder);
    }
  }

  _openSearch(query) {
    const existing = this.app.workspace.getLeavesOfType('search')[0];
    const open = (leaf) => {
      this.app.workspace.revealLeaf(leaf);
      if (leaf.view && leaf.view.setQuery) leaf.view.setQuery(query);
    };
    if (existing) open(existing);
    else this.app.workspace.ensureSideLeaf('search', 'left', { state: { query } }).then(open);
  }

  openBookmarksPane() {
    return this.app.workspace.ensureSideLeaf('bookmarks', 'left', { reveal: true });
  }

  /* ------------------------------------------------------- 当前视图 → 书签 */
  _activeView() {
    return this.app.workspace.activeLeaf ? this.app.workspace.activeLeaf.view : null;
  }

  _getSearchQuery(view) {
    let target = view;
    if (!target) {
      const leaf = this.app.workspace.getLeavesOfType('search')[0];
      target = leaf && leaf.view;
    }
    if (!target) return '';
    const query = target._query !== undefined ? target._query : (target.getState ? (target.getState() || {}).query : '');
    return (query || '').trim();
  }

  /** 视图 → 可收藏项（原版 R2 的 markdown/search 分支）。 */
  _bookmarkableItemForView(view) {
    if (!view || !view.getViewType) return null;
    const type = view.getViewType();
    if (view.file) return { type: 'file', ctime: Date.now(), path: view.file.path };
    if (type === 'search') {
      const query = this._getSearchQuery(view);
      return query ? { type: 'search', ctime: Date.now(), query } : null;
    }
    return null;
  }

  _findExistingItem(item) {
    if (item.type === 'file') return this._findFileItem(item.path, item.subpath || '');
    if (item.type === 'search') return this._findSearchItem(item.query);
    if (item.type === 'folder') return this.bookmarkLookup[item.path] || null;
    return null;
  }

  /**
   * 收藏/取消收藏当前视图（切换语义）。返回 false 表示当前视图无法收藏。
   * 书签面板 "+" 按钮、视图头部图标与 bookmarks:bookmark-current-view 命令共用。
   */
  bookmarkCurrentView(view) {
    const target = view || this._activeView();
    const item = this._bookmarkableItemForView(target);
    if (!item) return false;
    const existing = this._findExistingItem(item);
    if (existing) this.removeItem(existing);
    else this.addItem(item, null);
    return true;
  }

  /** 收藏光标所在章节（原版 WA 语义：光标行之前最近的标题）。 */
  bookmarkHeading(editor, view) {
    const file = view && view.file;
    if (!file || !editor) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = (cache && cache.headings) || [];
    const line = editor.getCursor('to').line;
    let heading = null;
    for (const h of headings) {
      if (h.position.start.line > line) break;
      heading = h;
    }
    if (!heading) return false;
    const subpath = '#' + heading.heading;
    if (this._findFileItem(file.path, subpath)) return true;
    const item = { type: 'file', ctime: Date.now(), path: file.path, subpath };
    if (editor.somethingSelected && editor.somethingSelected()) {
      /* 本复刻 editor.getSelection() 返回 {anchor,head}，文本须经 getRange 取。 */
      item.title = editor.getRange(editor.getCursor('from'), editor.getCursor('to')).trim();
    }
    this.addItem(item, null);
    return true;
  }

  /* ---------------------------------------------------------------- 命令 */
  _registerCommands() {
    const add = (command) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'bookmarks:open',
      name: t('plugins.bookmarks.action-show') || 'Show bookmarks',
      icon: 'lucide-bookmark',
      callback: () => this.openBookmarksPane(),
    });
    add({
      id: 'bookmarks:bookmark-current-view',
      name: t('plugins.bookmarks.action-bookmark') || 'Bookmark',
      icon: 'lucide-bookmark-plus',
      checkCallback: (checking) => {
        const item = this._bookmarkableItemForView(this._activeView());
        if (!item) return false;
        if (!checking) this.bookmarkCurrentView();
        return true;
      },
    });
    add({
      id: 'bookmarks:unbookmark-current-view',
      name: t('plugins.bookmarks.action-remove-bookmark') || 'Remove bookmark for current file',
      icon: 'lucide-bookmark-minus',
      checkCallback: (checking) => {
        const view = this._activeView();
        const existing = view && view.getViewType && view.file
          ? this.bookmarkLookup[view.file.path]
          : null;
        if (!existing) return false;
        if (!checking) this.removeItem(existing);
        return true;
      },
    });
    add({
      id: 'bookmarks:bookmark-current-search',
      name: t('plugins.bookmarks.action-bookmark-search') || 'Bookmark current search',
      icon: 'lucide-search',
      checkCallback: (checking) => {
        const searchPlugin = this.app.plugins.getInternalPlugin('global-search');
        if (!searchPlugin || !searchPlugin.enabled) return false;
        if (!checking) {
          const query = this._getSearchQuery();
          if (!query) {
            new Notice(t('plugins.bookmarks.msg-no-search-query') || 'No search query to bookmark.');
            return true;
          }
          if (!this._findSearchItem(query)) this.addItem({ type: 'search', ctime: Date.now(), query }, null);
        }
        return true;
      },
    });
    add({
      id: 'bookmarks:bookmark-current-heading',
      name: t('plugins.bookmarks.action-bookmark-heading') || 'Bookmark heading',
      icon: 'lucide-bookmark-plus',
      editorCallback: (editor, view) => this.bookmarkHeading(editor, view),
    });
  }

  /* ------------------------------------------------------ 视图头部书签图标 */
  /**
   * 为每个 markdown 叶子注入头部书签图标（原版 updateTabHeaders）。
   * 图标常驻 DOM：未收藏时被 CSS 隐藏，收藏后显示为高亮填充态。
   */
  updateViewActions() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const actions = leaf._viewActionsEl;
      if (!actions) return;
      const view = leaf.view;
      const bookmarkable = view && view.getViewType && view.file;
      let btn = actions.querySelector('.view-action.mod-bookmark');
      if (!bookmarkable) {
        if (btn) btn.detach();
        return;
      }
      if (!btn) {
        btn = actions.createEl('button', { cls: 'clickable-icon view-action mod-bookmark' });
        actions.prepend(btn);
        setIcon(btn, 'lucide-bookmark');
        btn.addEventListener('mousedown', (ev) => ev.preventDefault());
        btn.onclick = () => this.bookmarkCurrentView(view);
      }
      const bookmarked = !!this.bookmarkLookup[view.file.path];
      btn.toggleClass(['mod-bookmarked', 'mod-filled'], bookmarked);
      btn.setAttr('aria-label', bookmarked
        ? (t('plugins.bookmarks.label-bookmarked') || 'Bookmarked')
        : (t('plugins.bookmarks.label-bookmark') || 'Bookmark'));
    });
  }

  _removeViewActions() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const actions = leaf._viewActionsEl;
      if (!actions) return;
      const btn = actions.querySelector('.view-action.mod-bookmark');
      if (btn) btn.detach();
    });
  }

  /* ---------------------------------------------------------------- 重命名 */
  _onFileRename(file, oldPath) {
    let changed = false;
    this._walkItems((item) => {
      if ((item.type === 'file' || item.type === 'folder') &&
          (item.path === oldPath || (file instanceof TFolder && item.path.startsWith(oldPath + '/')))) {
        item.path = file.path + item.path.slice(oldPath.length);
        changed = true;
      }
      return true;
    });
    if (changed) this._onItemsChanged(true);
  }
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app) {
  return new BookmarksPlugin(app);
}

export function deregister(app) {
  app.viewRegistry.unregisterView('bookmarks');
}
