/**
 * [INPUT]: 依赖 Events、metadata/vault、视图注册表与桌面 IPC。
 * 依赖 workspace-model 的节点；委托 workspace-renderer 与 workspace-interactions。
 * [OUTPUT]: 导出 Workspace、WorkspaceItem、WorkspaceSplit、WorkspaceTabs、
 * WorkspaceLeaf 与 parseSubpath。保留既有方法签名和调用入口。
 * [POS]: 装配分割树与导航。侧栏工具固定，文档新标签始终进入中心。侧栏沿用最近中心文件，链接路径由 vault 转为文件。
 * loadLayout 只替换布局；旧视图保存与关闭仍由调用方负责。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Events } from './events.js';
import { t } from './i18n.js';
import { Notice } from './notices.js';
import { FileNameModal } from './modals.js';
import { normalizePath } from './vault.js';
import { Desktop } from './ipc.js';
import { WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from './workspace-model.js';
import * as workspaceRenderer from './workspace-renderer.js';
import * as workspaceInteractions from './workspace-interactions.js';
import { reconcileSidebars, canCloseLeaf } from './workspace-sidebar.js';

export { WorkspaceItem, WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from './workspace-model.js';

export class Workspace extends Events {
  constructor(app) {
    super();
    this.app = app;
    this.containerEl = null;
    this.rootSplit = null;
    this.leftSplit = null;
    this.rightSplit = null;
    this.centerSplit = null;
    this.ribbonEl = null;
    this.statusBar = null;
    this.activeLeaf = null;
    this.lastOpenFiles = [];
    this._leafMap = new Map();
    this._lastActiveLeaves = [];
  }

  // -------------------------------------------------------------------------
  // 挂载
  // -------------------------------------------------------------------------
  mount(container) { return workspaceRenderer.mount(this, container); }

  // -------------------------------------------------------------------------
  // 模型到 DOM
  // -------------------------------------------------------------------------
  render() { return workspaceRenderer.render(this); }

  _getRootEl() { return workspaceRenderer._getRootEl(this); }

  _renderNode(node) { return workspaceRenderer._renderNode(this, node); }

  _renderTabs(tabs) { return workspaceRenderer._renderTabs(this, tabs); }

  _sideOf(node) {
    let n = node;
    while (n) {
      if (n === this.leftSplit) return 'left';
      if (n === this.rightSplit) return 'right';
      if (n === this.centerSplit) return 'center';
      n = n.parent;
    }
    return 'center';
  }

  _renderLeaf(leaf) { return workspaceRenderer._renderLeaf(this, leaf); }

  _fillViewHeader(leaf) { return workspaceRenderer._fillViewHeader(this, leaf); }

  _refreshLeafContent(leaf) { return workspaceRenderer._refreshLeafContent(this, leaf); }

  _ensureLeafDom(leaf) { return workspaceRenderer._ensureLeafDom(this, leaf); }

  // -------------------------------------------------------------------------
  // 标签同步
  // -------------------------------------------------------------------------
  _createTabHeader(leaf) { return workspaceRenderer._createTabHeader(this, leaf); }

  _syncTabsHeaders(tabs) { return workspaceRenderer._syncTabsHeaders(this, tabs); }

  _syncTabsVisibility(tabs) { return workspaceRenderer._syncTabsVisibility(this, tabs); }

  _syncAllTabs() { return workspaceRenderer._syncAllTabs(this); }

  // -------------------------------------------------------------------------
  // 叶子与分割树
  // -------------------------------------------------------------------------
  getLeaf(newLeaf, parent) {
    if (newLeaf === undefined) newLeaf = false;
    let leaf;
    if (newLeaf === false) {
      // reuse active center leaf
      leaf = this.activeLeaf && this._sideOf(this.activeLeaf) === 'center' ? this.activeLeaf : this._firstLeafInCenter();
      if (!leaf) leaf = this.getLeaf('tab');
      return leaf;
    }
    let tabs = null;
    if (parent instanceof WorkspaceTabs) tabs = parent;
    else if (parent instanceof WorkspaceLeaf) tabs = parent.parent;
    else if (this.activeLeaf && this._sideOf(this.activeLeaf) === 'center' && this.activeLeaf.parent instanceof WorkspaceTabs) tabs = this.activeLeaf.parent;
    if (!tabs && !parent) tabs = this._firstTabsIn(this.centerSplit);

    if (newLeaf === 'split') {
      const relativeTabs = tabs || this._firstTabsIn(this.centerSplit);
      const splitParent = relativeTabs ? relativeTabs.parent : this.centerSplit;
      const newTabs = new WorkspaceTabs(this);
      if (splitParent instanceof WorkspaceSplit && splitParent.direction === 'vertical' && splitParent !== this.leftSplit && splitParent !== this.rightSplit) {
        const idx = splitParent.children.indexOf(relativeTabs);
        splitParent.insertChild(idx >= 0 ? idx + 1 : splitParent.children.length, newTabs);
      } else {
        const newSplit = new WorkspaceSplit(this, 'vertical');
        if (relativeTabs && relativeTabs.parent instanceof WorkspaceSplit) {
          const grand = relativeTabs.parent;
          const idx = grand.children.indexOf(relativeTabs);
          grand.removeChild(relativeTabs);
          newSplit.insertChild(0, relativeTabs);
          newSplit.insertChild(1, newTabs);
          grand.insertChild(idx, newSplit);
        } else {
          this.centerSplit.insertChild(this.centerSplit.children.length, newSplit);
          newSplit.insertChild(0, newTabs);
        }
        this.render();
      }
      leaf = this.createLeafInTabGroup(newTabs);
      return leaf;
    }
    if (!tabs) {
      // create tabs in center
      tabs = new WorkspaceTabs(this);
      this.centerSplit.insertChild(this.centerSplit.children.length, tabs);
      this.render();
    }
    if (newLeaf === 'tab') {
      const idx = tabs.children.indexOf(tabs.activeLeaf);
      leaf = this.createLeafInTabGroup(tabs, idx + 1 >= tabs.children.length ? undefined : idx + 1);
    } else {
      leaf = this.createLeafInTabGroup(tabs);
    }
    return leaf;
  }

  createLeafInTabGroup(tabs, index) {
    const leaf = new WorkspaceLeaf(this);
    this._leafMap.set(leaf.id, leaf);
    tabs.addLeaf(leaf, index);
    if (tabs.containerEl && tabs.containerEl.isConnected) {
      // keep DOM in sync immediately
      const el = this._renderLeaf(leaf);
      tabs.containerEl.appendChild(el);
      const header = this._createTabHeader(leaf);
      tabs._headersInner.appendChild(header);
      this._syncTabsHeaders(tabs);
      this._syncTabsVisibility(tabs);
    }
    this.trigger('layout-change');
    return leaf;
  }

  createLeafBySplit(referenceLeaf, direction, before = false) {
    if (this._sideOf(referenceLeaf) !== 'center') referenceLeaf = this._firstLeafInCenter();
    const tabs = referenceLeaf.parent;
    const splitParent = tabs ? tabs.parent : null;
    const newTabs = new WorkspaceTabs(this);
    const theDirection = direction === 'horizontal' ? 'horizontal' : 'vertical';
    if (splitParent instanceof WorkspaceSplit && splitParent.direction === theDirection) {
      const idx = splitParent.children.indexOf(tabs);
      splitParent.insertChild(before ? idx : idx + 1, newTabs);
    } else if (splitParent instanceof WorkspaceSplit) {
      const idx = splitParent.children.indexOf(tabs);
      const newSplit = new WorkspaceSplit(this, theDirection);
      splitParent.removeChild(tabs);
      if (before) { newSplit.insertChild(0, newTabs); newSplit.insertChild(1, tabs); }
      else { newSplit.insertChild(0, tabs); newSplit.insertChild(1, newTabs); }
      splitParent.insertChild(idx, newSplit);
    } else {
      const newSplit = new WorkspaceSplit(this, theDirection);
      newSplit.insertChild(0, newTabs);
      this.centerSplit.insertChild(this.centerSplit.children.length, newSplit);
    }
    this.render();
    return this.createLeafInTabGroup(newTabs);
  }

  canCloseLeaf(leaf) { return canCloseLeaf(this, leaf); }

  reconcileSidebars() {
    const previous = this._sidebarUpdate || Promise.resolve();
    this._sidebarUpdate = previous.then(() => reconcileSidebars(this));
    return this._sidebarUpdate;
  }

  detachLeaf(leaf) {
    const tabs = leaf.parent;
    if (!tabs) return;
    if (leaf.view) {
      try { leaf.view.onClose(); } catch (e) { console.error(e); }
    }
    if (leaf._tabHeaderEl) leaf._tabHeaderEl.detach();
    if (leaf._leafEl) leaf._leafEl.detach();
    if (leaf._resizeObserver) leaf._resizeObserver.disconnect();
    tabs.removeLeaf(leaf);
    this._leafMap.delete(leaf.id);
    if (leaf === this.activeLeaf) {
      this.activeLeaf = null;
      const next = tabs.activeLeaf;
      if (next) this.setActiveLeaf(next, { focus: false });
      else this.trigger('active-leaf-change', null);
    }
    if (tabs.children.length === 0) {
      this._removeTabsNode(tabs);
    } else {
      this._syncTabsHeaders(tabs);
      this._syncTabsVisibility(tabs);
    }
    this.trigger('layout-change');
  }

  _removeTabsNode(tabs) {
    const parent = tabs.parent;
    if (!(parent instanceof WorkspaceSplit)) { tabs.containerEl && tabs.containerEl.detach(); return; }
    parent.removeChild(tabs);
    // collapse single-child splits
    let node = parent;
    while (node && node !== this.rootSplit && node !== this.centerSplit && node !== this.leftSplit && node !== this.rightSplit) {
      const grand = node.parent;
      if (node.children.length === 0) {
        if (grand instanceof WorkspaceSplit) grand.removeChild(node);
        node = grand;
        continue;
      }
      if (node.children.length === 1 && grand instanceof WorkspaceSplit) {
        const child = node.children[0];
        const idx = grand.children.indexOf(node);
        grand.removeChild(node);
        if (child instanceof WorkspaceSplit && child.direction === node.direction) {
          const kids = [...child.children];
          child.children.length = 0;
          kids.forEach((k, i) => grand.insertChild(idx + i, k));
        } else {
          grand.insertChild(idx, child);
        }
      }
      node = grand;
    }
    // ensure center still has content
    if (this.centerSplit.children.length === 0) {
      const newTabs = new WorkspaceTabs(this);
      this.centerSplit.insertChild(0, newTabs);
      const leaf = this.createLeafInTabGroup(newTabs);
      leaf.setViewState({ type: 'empty' });
    }
    this.render();
  }

  setActiveLeaf(leaf, options = {}) {
    if (!leaf) return;
    const prev = this.activeLeaf;
    this.activeLeaf = leaf;
    leaf.activeTime = Date.now();
    if (options.clear) {
      this._lastActiveLeaves = [];
    }
    if (prev && prev !== leaf && this._sideOf(prev) === 'center') {
      this._lastActiveLeaves.unshift(prev);
      this._lastActiveLeaves = this._lastActiveLeaves.slice(0, 25);
    }
    if (leaf.parent instanceof WorkspaceTabs) {
      const i = leaf.parent.children.indexOf(leaf);
      if (i >= 0) leaf.parent.currentTab = i;
    }
    this._syncAllTabs();
    if (options.focus !== false && leaf.view && leaf.view.onFocus) leaf.view.onFocus();
    if (this.activeLeaf !== prev) this.trigger('active-leaf-change', leaf);
    this.trigger('layout-change');
  }

  revealLeaf(leaf) {
    if (!leaf) return;
    // uncollapse sidebars containing leaf
    const side = this._sideOf(leaf);
    if (side === 'left') this.showSidebar('left');
    if (side === 'right') this.showSidebar('right');
    this.setActiveLeaf(leaf, { focus: true });
  }

  getLeavesOfType(type) {
    const out = [];
    this.iterateAllLeaves((leaf) => { if (leaf.view && leaf.view.getViewType() === type) out.push(leaf); });
    return out;
  }

  iterateAllLeaves(cb) {
    const walk = (node) => {
      if (node instanceof WorkspaceLeaf) { cb(node); return; }
      if (node.children) node.children.forEach(walk);
    };
    if (this.rootSplit) walk(this.rootSplit);
  }

  _firstLeafInCenter() {
    let found = null;
    const first = (node) => {
      if (found) return;
      if (node instanceof WorkspaceLeaf) { found = node; return; }
      if (node.children) for (const c of node.children) { first(c); if (found) return; }
    };
    if (this.centerSplit) first(this.centerSplit);
    return found;
  }

  _firstTabsIn(split) {
    for (const c of split.children) {
      if (c instanceof WorkspaceTabs) return c;
      if (c instanceof WorkspaceSplit) {
        const f = this._firstTabsIn(c);
        if (f) return f;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 文件打开
  // -------------------------------------------------------------------------
  async openFile(file, options = {}) {
    if (!file) {
      const leaf = this.getLeaf(options.newLeaf ? 'tab' : false);
      await leaf.setViewState({ type: 'empty' });
      return leaf;
    }
    let leaf = null;
    if (!options.newLeaf) leaf = this.activeLeaf && this._sideOf(this.activeLeaf) === 'center' ? this.activeLeaf : this._firstLeafInCenter();
    if (!leaf) leaf = this.getLeaf(options.newLeaf === 'split' ? 'split' : (options.newLeaf ? 'tab' : 'tab'));
    const state = this._getViewStateForFile(file);
    if (options.eState) state.state = { ...(state.state || {}), ...options.eState };
    // If same file already open in some center leaf, focus it (like "open in new tab" de-dupe)
    if (options.newLeaf !== 'always') {
      const existing = this.getLeavesOfType(state.type).find((l) => {
        const st = l.view.getState && l.view.getState();
        return st && st.file === file.path && this._sideOf(l) === 'center';
      });
      if (existing && options.newLeaf) {
        this.revealLeaf(existing);
        this._addLastOpenFile(file.path);
        this.trigger('file-open', file);
        return existing;
      }
    }
    // 先激活再异步加载：避免加载较慢时，迟到的 setActiveLeaf 把用户随后切到的标签抢回来
    // （原版同样是"标签立即激活，内容随后加载"的语义）
    if (!options.newLeaf || this.app.settings.appSettings.focusNewTab === true) {
      this.setActiveLeaf(leaf, { focus: true });
    }
    await leaf.setViewState(state);
    this._addLastOpenFile(file.path);
    if (options.eState) leaf.view.setEphemeralState && leaf.view.setEphemeralState(options.eState);
    this.trigger('file-open', file);
    return leaf;
  }

  _getViewStateForFile(file) {
    const ext = (file.extension || '').toLowerCase();
    if (ext === 'md') {
      const settings = this.app.settings.appSettings;
      // 原版语义：defaultViewMode 'source'（编辑视图）| 'preview'（阅读视图）；livePreview 决定编辑视图用实时预览还是源码
      const editingMode = settings.livePreview === false ? 'source' : 'live';
      const mode = settings.defaultViewMode === 'preview' ? 'preview' : editingMode;
      return { type: 'markdown', state: { file: file.path, mode } };
    }
    if (ext === 'canvas') return { type: 'canvas', state: { file: file.path } };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return { type: 'image', state: { file: file.path } };
    if (['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext)) return { type: 'video', state: { file: file.path } };
    if (['mp3', 'wav', 'm4a', 'ogg', 'flac', '3gp', 'opus'].includes(ext)) return { type: 'audio', state: { file: file.path } };
    if (ext === 'pdf') return { type: 'pdf', state: { file: file.path } };
    return { type: 'empty', state: {} };
  }

  _addLastOpenFile(path) {
    this.lastOpenFiles = [path, ...this.lastOpenFiles.filter((p) => p !== path)].slice(0, 40);
  }

  async openLinkText(linktext, sourcePath, newLeaf = false) {
    const path = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
    const file = path ? this.app.vault.getFileByPath(path) : null;
    if (!file) {
      new Notice(t('plugins.page-preview.label-empty-attachment', { linktext }) !== 'plugins.page-preview.label-empty-attachment'
        ? t('plugins.page-preview.label-empty-attachment', { linktext })
        : `“${linktext}” could not be found.`);
      return;
    }
    const hashIdx = linktext.indexOf('#');
    const subpath = hashIdx >= 0 ? linktext.slice(hashIdx + 1) : '';
    await this.openFile(file, {
      newLeaf: typeof newLeaf === 'string' ? newLeaf : !!newLeaf,
      eState: subpath ? { subpath } : undefined,
    });
  }

  /**
   * 原版 handleLinkContextMenu：已解析 → 新标签页/新标签组/重命名（并触发 file-menu）；
   * 未解析 → 创建此文件。返回是否已填充菜单。
   */
  handleLinkContextMenu(menu, linktext, sourcePath, ctx) {
    if (!linktext) return false;
    const dest = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath || '');
    const file = dest && dest.path ? dest : (dest ? this.app.vault.getFileByPath(dest) : null);
    if (file) {
      menu.addItem((i) => i.setSection('open').setTitle(t('interface.menu.open-in-new-tab') || 'Open in new tab')
        .setIcon('lucide-file-plus').onClick(() => this.openLinkText(linktext, sourcePath || '', 'tab')));
      menu.addItem((i) => i.setSection('open').setTitle(t('interface.menu.open-to-the-right') || 'Open to the right')
        .setIcon('lucide-separator-vertical').onClick(() => this.openLinkText(linktext, sourcePath || '', 'split')));
      menu.addItem((i) => i.setSection('action').setTitle(t('plugins.file-explorer.menu-opt-rename') || 'Rename')
        .setIcon('lucide-edit-3').onClick(() => {
          const modal = new FileNameModal(this.app, file.name, async (name) => {
            let finalName = name;
            if (file.extension && !/\.[^./]+$/.test(finalName)) finalName += '.' + file.extension;
            const parent = file.path.split('/').slice(0, -1).join('/');
            await this.app.fileManager.renameFile(file, normalizePath((parent ? parent + '/' : '') + finalName));
          });
          modal.open();
        }));
      this.trigger('file-menu', menu, file, 'link-context-menu', ctx);
      return true;
    }
    menu.addItem((i) => i.setSection('open').setTitle(t('interface.menu.create-file') || 'Create this file')
      .setIcon('lucide-file').onClick(() => this.openLinkText(linktext, sourcePath || '', false)));
    return true;
  }

  /** 原版 handleExternalLinkContextMenu：复制链接（info）/ 在默认浏览器打开（open），并触发 url-menu。 */
  handleExternalLinkContextMenu(menu, href) {
    if (!href) return false;
    menu.addItem((i) => i.setSection('info').setTitle(t('interface.menu.copy-url') || 'Copy URL')
      .setIcon('lucide-link').onClick(() => {
        try { navigator.clipboard.writeText(href); } catch (e) { /* ignore */ }
        new Notice(t('interface.copied', { item: 'URL' }) || 'URL copied to your clipboard');
      }));
    menu.addItem((i) => i.setSection('open').setTitle(t('plugins.web-viewer.action-open-link-default-browser') || 'Open in default browser')
      .setIcon('lucide-globe-2').onClick(() => {
        try { Desktop.openExternal(href); } catch (e) { window.open(href, '_external'); }
      }));
    this.trigger('url-menu', menu, href);
    return true;
  }

  // -------------------------------------------------------------------------
  // 侧栏
  // -------------------------------------------------------------------------
  async ensureSideLeaf(type, side, options = {}) {
    const leaves = this.getLeavesOfType(type).filter((l) => this._sideOf(l) === side);
    if (leaves.length) {
      if (options.reveal !== false) this.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    let tabs = this._firstTabsIn(split);
    if (!tabs) {
      tabs = new WorkspaceTabs(this);
      split.insertChild(0, tabs);
    }
    const leaf = this.createLeafInTabGroup(tabs);
    await leaf.setViewState({ type, state: options.state || {} });
    this.render();
    if (options.reveal !== false) {
      this.revealLeaf(leaf);
      this.showSidebar(side);
    }
    return leaf;
  }

  showSidebar(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (!split.collapsed) return;
    split.collapsed = false;
    this.render();
    const target = Math.max(180, split.size || 300);
    this._animateSidebar(split, 0, target, () => {
      if (split.containerEl) {
        split.containerEl.style.flex = `0 0 ${target}px`;
        split.containerEl.style.width = target + 'px';
      }
      this._updateLeafSizes();
      this.trigger('layout-change');
    });
  }

  hideSidebar(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (split.collapsed) return;
    const from = split.containerEl ? split.containerEl.offsetWidth : (split.size || 300);
    split.collapsed = true;
    this._animateSidebar(split, from, 0, () => {
      if (split.collapsed) this.render();
      this._updateLeafSizes();
      this.trigger('layout-change');
    });
  }

  /** 原版侧栏收展 140ms 宽度补间（--anim-motion-swing），结束后再落最终布局。 */
  _animateSidebar(split, from, to, after) {
    const el = split.containerEl;
    if (this._sidebarAnim) {
      try { this._sidebarAnim.cancel(); } catch (e) {}
      this._sidebarAnim = null;
    }
    if (!el || typeof el.animate !== 'function') { after && after(); return; }
    const anim = el.animate(
      [{ flexBasis: from + 'px', width: from + 'px' }, { flexBasis: to + 'px', width: to + 'px' }],
      { duration: 140, easing: 'cubic-bezier(0.25, 1, 0.5, 1)', fill: 'both' }
    );
    this._sidebarAnim = anim;
    anim.onfinish = () => {
      if (this._sidebarAnim !== anim) return;
      this._sidebarAnim = null;
      try { anim.cancel(); } catch (e) {}
      after && after();
    };
  }

  toggleSidebar(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (split.collapsed) this.showSidebar(side); else this.hideSidebar(side);
  }

  getSidebarCollapsed(side) {
    return !!(side === 'left' ? this.leftSplit.collapsed : this.rightSplit.collapsed);
  }

  // -------------------------------------------------------------------------
  // 尺寸
  // -------------------------------------------------------------------------
  _createResizeHandle(split, childIndex, direction) { return workspaceRenderer._createResizeHandle(this, split, childIndex, direction); }

  _updateLeafSizes() { return workspaceRenderer._updateLeafSizes(this); }

  // -------------------------------------------------------------------------
  // 功能区
  // -------------------------------------------------------------------------
  _createRibbon() { return workspaceRenderer._createRibbon(this); }

  addRibbonItem(icon, title, callback, target) { return workspaceRenderer.addRibbonItem(this, icon, title, callback, target); }

  getRibbonItems() { return workspaceRenderer.getRibbonItems(this); }

  isRibbonItemHidden(key) { return workspaceRenderer.isRibbonItemHidden(this, key); }

  setRibbonItemHidden(key, hidden) { return workspaceRenderer.setRibbonItemHidden(this, key, hidden); }

  setRibbonOrder(keys) { return workspaceRenderer.setRibbonOrder(this, keys); }

  // -------------------------------------------------------------------------
  // 标签交互
  // -------------------------------------------------------------------------
  _onNewTab(tabs) { return workspaceInteractions._onNewTab(this, tabs); }

  _showTabContextMenu(ev, leaf) { return workspaceInteractions._showTabContextMenu(this, ev, leaf); }

  _showTabListMenu(ev, tabs) { return workspaceInteractions._showTabListMenu(this, ev, tabs); }

  // -------------------------------------------------------------------------
  // 标签拖拽
  // -------------------------------------------------------------------------
  _setupTabDrag(header, leaf) { return workspaceInteractions._setupTabDrag(this, header, leaf); }

  _dragGhost(ev) { return workspaceInteractions._dragGhost(this, ev); }

  _setupLeafDrop(el, leaf) { return workspaceInteractions._setupLeafDrop(this, el, leaf); }

  _dropZone(x, y) { return workspaceInteractions._dropZone(this, x, y); }

  _clearLeafDropIndicators() { return workspaceInteractions._clearLeafDropIndicators(this); }

  _clearDropIndicators() { return workspaceInteractions._clearDropIndicators(this); }

  _makeTabBarSortable(tabs) { return workspaceInteractions._makeTabBarSortable(this, tabs); }

  // -------------------------------------------------------------------------
  // 布局序列化
  // -------------------------------------------------------------------------
  serializeNode(node) {
    if (node instanceof WorkspaceLeaf) {
      const type = node.view ? node.view.getViewType() : 'empty';
      const state = node.view && node.view.getState ? node.view.getState() : {};
      return { id: node.id, type: 'leaf', state: { type, state } };
    }
    if (node instanceof WorkspaceTabs) {
      return { id: node.id, type: 'tabs', currentTab: node.currentTab, children: node.children.map((c) => this.serializeNode(c)) };
    }
    if (node instanceof WorkspaceSplit) {
      const s = { id: node.id, type: 'split', direction: node.direction, children: node.children.map((c) => this.serializeNode(c)) };
      if (node.size) s.size = node.size;
      return s;
    }
    return null;
  }

  getLayout() {
    return {
      main: this.serializeNode(this.centerSplit),
      left: this.serializeNode(this.leftSplit),
      right: this.serializeNode(this.rightSplit),
      active: this.activeLeaf ? this.activeLeaf.id : '',
      lastOpenFiles: this.lastOpenFiles,
      leftCollapsed: !!this.leftSplit.collapsed,
      rightCollapsed: !!this.rightSplit.collapsed,
      leftWidth: this.leftSplit.size,
      rightWidth: this.rightSplit.size,
      leftActive: this.leftSplit.children.length ? this.serializeNode(this.leftSplit) : null,
    };
  }

  async deserializeNode(data) {
    if (!data) return null;
    if (data.type === 'leaf') {
      const leaf = new WorkspaceLeaf(this);
      if (data.id) leaf.id = data.id;
      leaf._pendingState = data.state || { type: 'empty', state: {} };
      this._leafMap.set(leaf.id, leaf);
      return leaf;
    }
    if (data.type === 'tabs') {
      const tabs = new WorkspaceTabs(this);
      if (data.id) tabs.id = data.id;
      for (const child of data.children || []) {
        const node = await this.deserializeNode(child);
        if (node) tabs.addLeaf(node);
      }
      tabs.currentTab = Math.max(0, Math.min(data.currentTab || 0, tabs.children.length - 1));
      return tabs;
    }
    if (data.type === 'split') {
      const split = new WorkspaceSplit(this, data.direction || 'vertical');
      if (data.id) split.id = data.id;
      if (data.size) split.size = data.size;
      for (const child of data.children || []) {
        const node = await this.deserializeNode(child);
        if (node) split.insertChild(split.children.length, node);
      }
      return split;
    }
    return null;
  }

  async loadLayout(data) {
    this._leafMap.clear();
    if (!data) return false;
    try {
      const center = await this.deserializeNode(data.main);
      if (center) { this.centerSplit = this._replaceInRoot(this.centerSplit, center); center.side = 'center'; }
      const left = await this.deserializeNode(data.left);
      if (left) { this.leftSplit = this._replaceInRoot(this.leftSplit, left); left.side = 'left'; }
      const right = await this.deserializeNode(data.right);
      if (right) { this.rightSplit = this._replaceInRoot(this.rightSplit, right); right.side = 'right'; }
      this.lastOpenFiles = data.lastOpenFiles || [];
      this.leftSplit.collapsed = !!data.leftCollapsed;
      this.rightSplit.collapsed = !!data.rightCollapsed;
      if (data.leftWidth) this.leftSplit.size = data.leftWidth;
      if (data.rightWidth) this.rightSplit.size = data.rightWidth;
      return data.active || null;
    } catch (e) {
      console.error('Failed to load layout', e);
      return false;
    }
  }

  _replaceInRoot(oldNode, newNode) {
    const idx = this.rootSplit.children.indexOf(oldNode);
    if (idx >= 0) {
      this.rootSplit.removeChild(oldNode);
      this.rootSplit.insertChild(idx, newNode);
    }
    return newNode;
  }

  async postLayoutLoad(activeId) {
    // load every leaf's view first so DOM rendering can attach content
    const leaves = [];
    this.iterateAllLeaves((l) => leaves.push(l));
    for (const leaf of leaves) {
      const state = leaf._pendingState || { type: 'empty', state: {} };
      leaf._pendingState = null;
      leaf.viewState = state;
      const factory = this.app.viewRegistry.getViewCreator(state.type) || this.app.viewRegistry.getViewCreator('empty');
      if (!factory) continue;
      leaf.view = factory(leaf);
      leaf.view.app = this.app;
      leaf.view.leaf = leaf;
      leaf.view._rootEl = createDiv('view-content');
      leaf.view.contentEl = leaf.view._rootEl;
      try {
        await leaf.view.load();
      } catch (e) {
        console.error('Failed to load view', state.type, e);
      }
      if (leaf.view.setState) {
        try { await leaf.view.setState(state.state || {}, state); } catch (e) { console.error('setState failed', state.type, e); }
      }
    }
    // render DOM once
    this.render();
    // after DOM exists, inform views + set active
    for (const leaf of leaves) {
      leaf.view && leaf.view.onResize && leaf.view.onResize();
      if (leaf.view && leaf.view.onLayoutReady) leaf.view.onLayoutReady();
    }
    if (activeId && this._leafMap.has(activeId)) this.setActiveLeaf(this._leafMap.get(activeId), { focus: false });
    else {
      const first = this._firstLeafInCenter();
      if (first) this.setActiveLeaf(first, { focus: false });
      // activate first sidebar leaves as tab stacks
      for (const side of [this.leftSplit, this.rightSplit]) {
        const tabs = this._firstTabsIn(side);
        if (tabs && tabs.activeLeaf) this._syncTabsVisibility(tabs);
      }
    }
    await this.reconcileSidebars();
    this.updateTitle();
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------
  getActiveFile() {
    const active = this.activeLeaf;
    const leaf = active && this._sideOf(active) !== 'center'
      ? this._lastActiveLeaves.find((item) => !item._closed && this._leafMap.has(item.id) && this._sideOf(item) === 'center')
      : active;
    const view = leaf && leaf.view;
    const path = view?.file?.path || view?.getState?.().file;
    return path ? this.app.vault.getFileByPath(path) : null;
  }

  getActiveViewOfType(type) {
    const view = this.activeLeaf && this.activeLeaf.view;
    if (!view) return null;
    // The original takes a view class; string type names are also accepted so
    // core plugins can look views up without importing their classes.
    if (typeof type === 'string') return view.getViewType() === type ? view : null;
    if (view instanceof type) return view;
    if (view && view.getViewType() === type) return view;
    return null;
  }

  updateTitle() {
    const file = this.getActiveFile();
    const vaultName = this.app.vault.getName();
    const version = (Desktop.version && Desktop.version()) || '';
    const appTitle = 'OpenSidian' + (version ? ' ' + version : '');
    // 原版：有文件 = "<basename> - <vault> - <app>"，无文件 = "<vault> - <app>"
    const title = file ? `${file.basename} - ${vaultName} - ${appTitle}` : `${vaultName} - ${appTitle}`;
    Desktop.setTitle(title);
    // titlebar-text 镜像 document.title（原版 MutationObserver 语义，单层节点）
    if (this.titlebarTextEl) this.titlebarTextEl.setText(title);
  }

  getLastOpenFiles() { return this.lastOpenFiles; }

  getShownSidebarLeaves(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    const out = [];
    for (const child of split.children) {
      if (child instanceof WorkspaceLeaf) out.push(child);
      else if (child.children) {
        const collect = (n) => {
          if (n instanceof WorkspaceLeaf) out.push(n);
          else if (n.children) n.children.forEach(collect);
        };
        child.children.forEach(collect);
      }
    }
    return out;
  }

  // 设置变更后同步标题栏
  refreshHeaderVisibility() { return workspaceRenderer.refreshHeaderVisibility(this); }
}

export function parseSubpath(linktext) {
  if (!linktext) return '';
  const i = linktext.indexOf('#');
  return i < 0 ? '' : linktext.slice(i + 1);
}
