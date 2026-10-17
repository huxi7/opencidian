/**
 * [INPUT]: 依赖 ./events.js 的 Events；依赖 ./i18n.js 的 t；依赖 ./icons.js；依赖 ./menu.js 的 Menu；依赖 ../views/index.js 的视图注册表
 * [OUTPUT]: 导出 Workspace 类（getLeaf/openFile/setActiveLeaf/detachLeavesOfType/iterateAllLeaves/on('file-open')…）、Leaf、WorkspaceLeaf、ItemView
 * [POS]: core/ 的布局引擎与视图宿主。分割树模型对齐原版：.mod-vertical=横向排列(row)，.mod-horizontal=纵向堆叠(column)。视图持有稳定 _rootEl，布局重排只 re-parent 不重建。布局 JSON 持久化至 .obsidian/workspace.json。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Workspace — split panes, tab stacks, leaves, ribbon, status bar.
 * Layout model mirrors Obsidian: a tree of splits/tabs/leaves with drag-split
 * handles and JSON workspace persistence in .obsidian/workspace.json.
 *
 * DOM lifecycle:
 *  - a View owns a stable root element (view._rootEl, class "view-content")
 *    that is built once in onOpen and re-parented by render() when the layout
 *    changes. Views never get rebuilt just because the layout re-renders.
 */
import { Events } from './events.js';
import { t } from './i18n.js';
import { setIcon } from './icons.js';
import { Notice } from './notices.js';
import { Menu } from './menu.js';
import { Desktop } from './ipc.js';

function genId() { return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10); }

export class WorkspaceItem {
  constructor(workspace) {
    this.workspace = workspace;
    this.app = workspace.app;
    this.parent = null;
    this.id = genId();
  }
}

export class WorkspaceSplit extends WorkspaceItem {
  constructor(workspace, direction) {
    super(workspace);
    this.direction = direction; // 'vertical' (children side by side) | 'horizontal' (rows)
    this.children = [];
    this.size = null;
    this.side = null;
    this.collapsed = false;
    this.containerEl = null;
  }
  insertChild(index, child) {
    child.parent = this;
    this.children.splice(index, 0, child);
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }
}

export class WorkspaceTabs extends WorkspaceItem {
  constructor(workspace) {
    super(workspace);
    this.children = [];
    this.currentTab = 0;
    this.containerEl = null;
  }
  get activeLeaf() { return this.children[this.currentTab] || null; }
  addLeaf(leaf, index) {
    leaf.parent = this;
    if (index === undefined || index === null || index < 0 || index > this.children.length) this.children.push(leaf);
    else this.children.splice(index, 0, leaf);
    this.currentTab = this.children.indexOf(leaf);
  }
  removeLeaf(leaf) {
    const i = this.children.indexOf(leaf);
    if (i >= 0) this.children.splice(i, 1);
    leaf.parent = null;
    if (this.currentTab >= this.children.length) this.currentTab = this.children.length - 1;
    if (this.currentTab < 0) this.currentTab = 0;
  }
}

export class WorkspaceLeaf extends WorkspaceItem {
  constructor(workspace) {
    super(workspace);
    this.view = null;
    this.viewState = null;
    this.containerEl = null;   // .workspace-leaf
    this.contentEl = null;     // .workspace-leaf-content
    this.width = 0;
    this.height = 0;
    this.activeTime = 0;
    this._closed = false;
  }
  get active() { return this.workspace.activeLeaf === this; }

  async setViewState(state, eState) {
    if (!state || !state.type) return;
    const prev = this.view;
    const sameType = prev && prev.getViewType() === state.type;
    if (sameType && prev.setState) {
      await prev.setState(state.state || {}, state);
      this.viewState = state;
      this.updateTabHeader();
      this.workspace._refreshLeafContent(this);
      this.workspace.trigger('layout-change');
      return;
    }
    if (prev) {
      try { await prev.onClose(); } catch (e) { console.error(e); }
      prev._children && prev._children.forEach && prev._children.forEach((cb) => cb && cb());
      if (prev._rootEl) { prev._rootEl.detach(); prev._rootEl = null; }
    }
    const factory = this.workspace.app.viewRegistry.getViewCreator(state.type);
    if (!factory) {
      console.warn('No view registered for type:', state.type);
      const emptyFactory = this.workspace.app.viewRegistry.getViewCreator('empty');
      this.view = emptyFactory ? emptyFactory(this) : null;
      if (this.view) this.view.setState && this.view.setState({ missing: state.type });
    } else {
      this.view = factory(this);
    }
    if (!this.view) return;
    this.view.app = this.workspace.app;
    this.view.leaf = this;
    this.view._rootEl = createDiv('view-content');
    this.view.contentEl = this.view._rootEl;
    this.view.containerEl = null;
    this.viewState = state;
    try {
      await this.view.load();
    } catch (e) {
      console.error('View failed to load', state.type, e);
      this.view._rootEl.setText('Failed to load view: ' + state.type);
    }
    if (this.view.setState) {
      try { await this.view.setState(state.state || {}, state); } catch (e) { console.error('setState failed', state.type, e); }
    }
    if (eState) this.view.setEphemeralState && this.view.setEphemeralState(eState);
    this.workspace._ensureLeafDom(this);
    this.updateTabHeader();
    this.workspace.trigger('layout-change');
  }

  updateTabHeader() {
    if (!this._tabHeaderEl || !this.view) return;
    const titleEl = this._tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
    const iconEl = this._tabHeaderEl.querySelector('.workspace-tab-header-inner-icon');
    const title = this.view.getDisplayText();
    if (titleEl) titleEl.setText(typeof title === 'string' ? title : '');
    if (iconEl) {
      iconEl.empty();
      const icon = this.view.getIcon();
      if (icon) setIcon(iconEl, icon);
    }
    this._tabHeaderEl.setAttr('aria-label', typeof title === 'string' ? title : '');
    this._tabHeaderEl.setAttr('data-type', this.view.getViewType());
  }

  detach() { this.workspace.detachLeaf(this); }

  getEphemeralState() { return this.view ? this.view.getEphemeralState() : {}; }
  setEphemeralState(state) { this.view && this.view.setEphemeralState(state); }
  open() { return this.setViewState({ type: 'empty' }); }
}

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
  // Mount
  // -------------------------------------------------------------------------
  mount(container) {
    this.containerEl = container;
    container.addClass('workspace');
    // platform state classes, mirroring the original body classes
    container.addClass('is-frameless');
    container.addClass('is-hidden-frameless');
    if (navigator.platform.startsWith('Mac')) container.addClass('mod-macos');
    else if (navigator.platform.startsWith('Win')) container.addClass('mod-windows');
    else container.addClass('mod-linux');

    this.ribbonEl = this._createRibbon();
    container.appendChild(this.ribbonEl);

    this.rootSplit = new WorkspaceSplit(this, 'vertical');
    this.rootSplit.isRoot = true;
    this.leftSplit = new WorkspaceSplit(this, 'horizontal'); this.leftSplit.side = 'left'; this.leftSplit.size = 300;
    this.centerSplit = new WorkspaceSplit(this, 'horizontal'); this.centerSplit.side = 'center';
    this.rightSplit = new WorkspaceSplit(this, 'horizontal'); this.rightSplit.side = 'right'; this.rightSplit.size = 300;
    this.rootSplit.insertChild(0, this.leftSplit);
    this.rootSplit.insertChild(1, this.centerSplit);
    this.rootSplit.insertChild(2, this.rightSplit);

    this.statusBar = createDiv('status-bar');
    container.appendChild(this.statusBar);

    // titlebar for frameless window
    const titlebar = container.createDiv('titlebar');
    const inner = titlebar.createDiv('titlebar-inner');
    this.titlebarTextEl = inner.createDiv('titlebar-text');
    inner.createDiv('titlebar-button-container');

    this.leftSplit.containerEl = null;
    window.addEventListener('focus', () => container.addClass('is-focused'));
    window.addEventListener('blur', () => container.removeClass('is-focused'));
    if (document.hasFocus()) container.addClass('is-focused');
  }

  // -------------------------------------------------------------------------
  // Rendering (model -> DOM)
  // -------------------------------------------------------------------------
  render() {
    const rootEl = this._getRootEl();
    rootEl.empty();
    for (let i = 0; i < this.rootSplit.children.length; i++) {
      const child = this.rootSplit.children[i];
      const el = this._renderNode(child);
      rootEl.appendChild(el);
      if (i < this.rootSplit.children.length - 1) {
        const handle = this._createResizeHandle(this.rootSplit, i, 'vertical');
        rootEl.appendChild(handle);
      }
    }
    this._updateLeafSizes();
    this.trigger('layout-change');
  }

  _getRootEl() {
    if (!this._rootEl) {
      this._rootEl = createDiv('workspace-split mod-root');
      this.containerEl.appendChild(this._rootEl);
    }
    return this._rootEl;
  }

  _renderNode(node) {
    if (node instanceof WorkspaceSplit) {
      const el = createDiv('workspace-split');
      el.addClass('mod-' + node.direction);
      if (node.side === 'left') el.addClass('mod-left-split');
      if (node.side === 'right') el.addClass('mod-right-split');
      if (node.side === 'center') el.addClass('mod-root');
      node.containerEl = el;
      el._split = node;
      if (node.side && node.collapsed) {
        el.addClass('is-collapsed');
        el.style.display = 'none';
      }
      if (node.side && (node.side === 'left' || node.side === 'right')) {
        el.style.flex = `0 0 ${node.size || 300}px`;
        el.style.width = (node.size || 300) + 'px';
        el.style.order = node.side === 'left' ? '-1' : '1';
      }
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        el.appendChild(this._renderNode(child));
        if (i < node.children.length - 1) {
          el.appendChild(this._createResizeHandle(node, i, node.direction));
        }
      }
      return el;
    }
    if (node instanceof WorkspaceTabs) {
      return this._renderTabs(node);
    }
    if (node instanceof WorkspaceLeaf) {
      return this._renderLeaf(node);
    }
    return createDiv();
  }

  _renderTabs(tabs) {
    const el = createDiv('workspace-tabs');
    el._tabs = tabs;
    tabs.containerEl = el;
    const side = this._sideOf(tabs);
    const isRoot = side === 'center';
    if (isRoot) el.addClass('mod-root');
    else el.addClass('mod-top');
    if (side === 'left') el.addClass('mod-top-left-space');
    if (side === 'right') el.addClass('mod-top-right-space');

    const headersOuter = el.createDiv('workspace-tab-header-container');
    tabs._headersOuter = headersOuter;
    const headersInner = headersOuter.createDiv('workspace-tab-header-container-inner');
    tabs._headersInner = headersInner;

    const newTabBtn = headersOuter.createDiv('workspace-tab-header-new-tab clickable-icon');
    newTabBtn.setAttr('aria-label', t('menu-items.new-tab') || 'New tab');
    setIcon(newTabBtn, 'plus');
    newTabBtn.onclick = () => this._onNewTab(tabs);
    const tabListBtn = headersOuter.createDiv('workspace-tab-header-tab-list clickable-icon');
    tabListBtn.setAttr('aria-label', 'Tab list');
    setIcon(tabListBtn, 'chevrons-up-down');
    tabListBtn.onclick = (ev) => { ev.stopPropagation(); this._showTabListMenu(ev, tabs); };
    headersOuter.createDiv('workspace-tab-header-spacer');

    for (const leaf of tabs.children) {
      const header = this._createTabHeader(leaf);
      headersInner.appendChild(header);
      el.appendChild(this._renderLeaf(leaf));
      leaf.updateTabHeader();
    }
    this._syncTabsVisibility(tabs);
    this._makeTabBarSortable(tabs);
    return el;
  }

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

  _renderLeaf(leaf) {
    const el = createDiv('workspace-leaf');
    leaf._leafEl = el;
    el._leaf = leaf;
    const content = el.createDiv('workspace-leaf-content');
    leaf.contentEl = content;
    const side = this._sideOf(leaf);
    content.setAttr('data-type', leaf.view ? leaf.view.getViewType() : 'empty');
    if (leaf.view) leaf.view.containerEl = content;

    const header = content.createDiv('view-header');
    const titleContainer = header.createDiv('view-header-title-container');
    leaf._viewTitleEl = titleContainer.createDiv('view-header-title');
    const actions = header.createDiv('view-actions');
    leaf._viewActionsEl = actions;
    if (leaf.view) {
      leaf.view._viewHeaderEl = header;
      leaf.view._viewActionsEl = actions;
      leaf.view._viewTitleEl = leaf._viewTitleEl;
      this._fillViewHeader(leaf);
    }
    // breadcrumbs path for markdown views
    content.appendChild(leaf.view && leaf.view._rootEl ? leaf.view._rootEl : createDiv('view-content'));

    // focus
    content.addEventListener('mousedown', () => {
      if (this.activeLeaf !== leaf) this.setActiveLeaf(leaf, { focus: false });
    }, true);

    // drag over for tab/leaf drops
    this._setupLeafDrop(el, leaf);

    if (leaf._resizeObserver) leaf._resizeObserver.disconnect();
    leaf._resizeObserver = new ResizeObserver(() => {
      if (leaf._resizePending) return;
      leaf._resizePending = true;
      requestAnimationFrame(() => {
        leaf._resizePending = false;
        leaf.view && leaf.view.onResize && leaf.view.onResize();
      });
    });
    leaf._resizeObserver.observe(content);
    return el;
  }

  _fillViewHeader(leaf) {
    const view = leaf.view;
    if (!view) return;
    if (leaf._viewTitleEl) {
      leaf._viewTitleEl.empty();
      const title = view.getDisplayText();
      leaf._viewTitleEl.setText(typeof title === 'string' ? title : '');
    }
    const actions = leaf._viewActionsEl;
    if (actions) {
      actions.empty();
      view._fillViewActions && view._fillViewActions(actions);
    }
  }

  _refreshLeafContent(leaf) {
    if (!leaf.contentEl) return;
    const type = leaf.view ? leaf.view.getViewType() : 'empty';
    leaf.contentEl.setAttr('data-type', type);
    if (leaf.view && leaf.view._rootEl && leaf.view._rootEl.parentElement !== leaf.contentEl) {
      leaf.contentEl.appendChild(leaf.view._rootEl);
    }
    this._fillViewHeader(leaf);
    leaf.updateTabHeader();
  }

  _ensureLeafDom(leaf) {
    if (leaf._leafEl && leaf._leafEl.isConnected) { this._refreshLeafContent(leaf); return; }
    const tabs = leaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) {
      // leaf not attached to a tabs node yet: create one
      const newTabs = new WorkspaceTabs(this);
      newTabs.addLeaf(leaf);
      this.centerSplit.insertChild(this.centerSplit.children.length, newTabs);
    }
    const parentTabs = leaf.parent;
    if (!parentTabs.containerEl || !parentTabs.containerEl.isConnected) {
      this.render();
      return;
    }
    const el = this._renderLeaf(leaf);
    parentTabs.containerEl.appendChild(el);
    // ensure tab header exists
    if (!leaf._tabHeaderEl) {
      const header = this._createTabHeader(leaf);
      parentTabs._headersInner.appendChild(header);
    }
    // insert header in right position
    this._syncTabsHeaders(parentTabs);
    this._syncTabsVisibility(parentTabs);
    this._makeTabBarSortable(parentTabs);
    leaf.updateTabHeader();
  }

  // -------------------------------------------------------------------------
  // Tab headers
  // -------------------------------------------------------------------------
  _createTabHeader(leaf) {
    const header = createDiv('workspace-tab-header');
    const inner = header.createDiv('workspace-tab-header-inner');
    const iconEl = inner.createDiv('workspace-tab-header-inner-icon');
    const titleEl = inner.createDiv('workspace-tab-header-inner-title');
    const closeEl = inner.createDiv('workspace-tab-header-inner-close-button');
    closeEl.setAttr('aria-label', t('interface.menu.close') || 'Close');
    setIcon(closeEl, 'x');
    header._leaf = leaf;
    leaf._tabHeaderEl = header;
    header.setAttr('draggable', 'true');
    closeEl.onclick = (ev) => { ev.stopPropagation(); leaf.detach(); };
    header.onclick = (ev) => {
      if (ev.target.closest('.workspace-tab-header-inner-close-button')) return;
      const tabs = leaf.parent;
      if (tabs) tabs.currentTab = tabs.children.indexOf(leaf);
      this.setActiveLeaf(leaf, { focus: true, clear: true });
    };
    header.onauxclick = (ev) => {
      if (ev.button === 1) { ev.preventDefault(); leaf.detach(); }
    };
    header.oncontextmenu = (ev) => { ev.preventDefault(); ev.stopPropagation(); this._showTabContextMenu(ev, leaf); };
    this._setupTabDrag(header, leaf);
    return header;
  }

  _syncTabsHeaders(tabs) {
    const inner = tabs._headersInner;
    if (!inner) return;
    // remove headers of removed leaves
    for (const h of Array.from(inner.children)) {
      if (h._leaf && !tabs.children.includes(h._leaf)) h.detach();
    }
    tabs.children.forEach((leaf, i) => {
      let h = leaf._tabHeaderEl;
      if (!h) h = this._createTabHeader(leaf);
      if (h.parentElement !== inner) {
        const ref = inner.children[i] || null;
        inner.insertBefore(h, ref);
      } else if (inner.children[i] !== h) {
        inner.insertBefore(h, inner.children[i] || null);
      }
    });
  }

  _syncTabsVisibility(tabs) {
    for (const leaf of tabs.children) {
      const isActive = tabs.activeLeaf === leaf;
      if (leaf._leafEl) leaf._leafEl.toggle(isActive);
      if (leaf._tabHeaderEl) {
        leaf._tabHeaderEl.toggleClass('is-active', isActive);
        leaf._tabHeaderEl.toggleClass('is-pinned', !!leaf.pinned);
      }
    }
  }

  _syncAllTabs() {
    const walk = (node) => {
      if (node instanceof WorkspaceTabs) this._syncTabsVisibility(node);
      else if (node.children) node.children.forEach(walk);
    };
    if (this.rootSplit) walk(this.rootSplit);
  }

  // -------------------------------------------------------------------------
  // Leaf management
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
    else if (this.activeLeaf && this.activeLeaf.parent instanceof WorkspaceTabs) tabs = this.activeLeaf.parent;

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
    if (prev && prev !== leaf && this._sideOf(prev) === 'center' && this._sideOf(leaf) === 'center') {
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
  // Opening files
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
    await leaf.setViewState(state);
    this._addLastOpenFile(file.path);
    // “始终聚焦新标签页”关闭时，新标签页在后台打开（保持当前标签页激活）
    if (!options.newLeaf || this.app.settings.appSettings.focusNewTab === true) {
      this.setActiveLeaf(leaf, { focus: true });
    }
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
    const file = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
    if (!file) {
      new Notice(t('plugins.page-preview.label-empty-attachment', { linktext }) !== 'plugins.page-preview.label-empty-attachment'
        ? t('plugins.page-preview.label-empty-attachment', { linktext })
        : `“${linktext}” could not be found.`);
      return;
    }
    const hashIdx = linktext.indexOf('#');
    const subpath = hashIdx >= 0 ? linktext.slice(hashIdx + 1) : '';
    await this.openFile(file, { newLeaf: !!newLeaf, eState: subpath ? { subpath } : undefined });
  }

  // -------------------------------------------------------------------------
  // Sidebars
  // -------------------------------------------------------------------------
  async ensureSideLeaf(type, side, options = {}) {
    const leaves = this.getLeavesOfType(type).filter((l) => this._sideOf(l) === side);
    if (leaves.length) {
      this.revealLeaf(leaves[0]);
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
    this.revealLeaf(leaf);
    this.showSidebar(side);
    return leaf;
  }

  showSidebar(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (!split.collapsed) return;
    split.collapsed = false;
    this.render();
  }

  hideSidebar(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (split.collapsed) return;
    split.collapsed = true;
    this.render();
  }

  toggleSidebar(side) {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (split.collapsed) this.showSidebar(side); else this.hideSidebar(side);
  }

  getSidebarCollapsed(side) {
    return !!(side === 'left' ? this.leftSplit.collapsed : this.rightSplit.collapsed);
  }

  // -------------------------------------------------------------------------
  // Resizing
  // -------------------------------------------------------------------------
  _createResizeHandle(split, childIndex, direction) {
    const handle = createDiv('workspace-leaf-resize-handle');
    handle.addClass(direction === 'vertical' ? 'mod-vertical' : 'mod-horizontal');
    let startPos = 0, sizes = [];
    const isSidebar = split === this.leftSplit || split === this.rightSplit;
    const onMove = (ev) => {
      if (isSidebar) {
        const delta = ev.clientX - startPos;
        const size = Math.max(180, Math.min(800, sizes[0] + (split === this.leftSplit ? delta : -delta)));
        split.size = size;
        if (split.containerEl) {
          split.containerEl.style.flex = `0 0 ${size}px`;
          split.containerEl.style.width = size + 'px';
        }
      } else {
        const delta = direction === 'vertical' ? ev.clientX - startPos : ev.clientY - startPos;
        const total = sizes[0] + sizes[1];
        const s0 = Math.max(80, Math.min(total - 80, sizes[0] + delta));
        const s1 = total - s0;
        const c0 = split.children[childIndex], c1 = split.children[childIndex + 1];
        const el0 = c0 && (c0.containerEl || c0._leafEl);
        const el1 = c1 && (c1.containerEl || c1._leafEl);
        if (el0) { el0.style.flex = `0 0 ${s0}px`; }
        if (el1) { el1.style.flex = `0 0 ${s1}px`; }
      }
      this._updateLeafSizes();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.removeClass('is-resizing');
      this.trigger('layout-change');
    };
    handle.onmousedown = (ev) => {
      ev.preventDefault();
      startPos = direction === 'vertical' ? ev.clientX : ev.clientY;
      const c0 = split.children[childIndex], c1 = split.children[childIndex + 1];
      const el0 = c0 && (c0.containerEl || c0._leafEl);
      const el1 = c1 && (c1.containerEl || c1._leafEl);
      sizes = [
        el0 ? (direction === 'vertical' ? el0.offsetWidth : el0.offsetHeight) : 300,
        el1 ? (direction === 'vertical' ? el1.offsetWidth : el1.offsetHeight) : 300,
      ];
      document.body.addClass('is-resizing');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    return handle;
  }

  _updateLeafSizes() {
    this.iterateAllLeaves((leaf) => {
      if (leaf._leafEl) {
        leaf.width = leaf._leafEl.offsetWidth;
        leaf.height = leaf._leafEl.offsetHeight;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ribbon
  // -------------------------------------------------------------------------
  _createRibbon() {
    const ribbon = createDiv('workspace-ribbon mod-left');
    const actions = ribbon.createDiv('side-dock-actions');
    this.ribbonActionsEl = actions;
    const bottom = ribbon.createDiv('side-dock-settings');
    this.ribbonSettingsEl = bottom;
    const toggle = ribbon.createDiv('workspace-ribbon-collapse-btn clickable-icon');
    toggle.setAttr('aria-label', 'Collapse');
    setIcon(toggle, 'chevrons-left');
    toggle.onclick = () => {
      const collapsed = ribbon.toggleClass('is-collapsed');
      setIcon(toggle, collapsed ? 'chevrons-right' : 'chevrons-left');
    };
    return ribbon;
  }

  addRibbonItem(icon, title, callback, target) {
    const el = createDiv('side-dock-ribbon-action clickable-icon');
    el.setAttr('aria-label', title);
    setIcon(el, icon);
    el.onclick = (ev) => callback(ev);
    const container = target === 'bottom' ? this.ribbonSettingsEl : this.ribbonActionsEl;
    container.appendChild(el);
    return el;
  }

  // -------------------------------------------------------------------------
  // Tabs UI actions
  // -------------------------------------------------------------------------
  _onNewTab(tabs) {
    const leaf = this.createLeafInTabGroup(tabs);
    leaf.setViewState({ type: 'empty' });
    this.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }

  _showTabContextMenu(ev, leaf) {
    const menu = new Menu(this.app);
    const isPinned = leaf.pinned;
    menu.addItem((item) => item.setTitle(isPinned ? (t('interface.menu.unpin') || 'Unpin') : (t('interface.menu.pin') || 'Pin')).setIcon('pin').onClick(() => { leaf.pinned = !leaf.pinned; this._syncAllTabs(); }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t('menu-items.close-tab') || 'Close').setIcon('x').onClick(() => leaf.detach()));
    menu.addItem((item) => item.setTitle(t('interface.menu.close-others') || 'Close others').onClick(() => {
      const tabs = leaf.parent;
      if (tabs) for (const l of [...tabs.children]) if (l !== leaf) l.detach();
    }));
    menu.addItem((item) => item.setTitle(t('commands.close-tab-group') || 'Close tab group').onClick(() => {
      const tabs = leaf.parent;
      if (tabs) for (const l of [...tabs.children]) l.detach();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t('menu-items.new-tab') || 'New tab').setIcon('plus').onClick(() => {
      const newLeaf = this.getLeaf('tab', leaf.parent);
      newLeaf.setViewState({ type: 'empty' });
      this.setActiveLeaf(newLeaf, { focus: true });
    }));
    menu.addItem((item) => item.setTitle(t('menu-items.split-right') || 'Split right').setIcon('separator-vertical').onClick(async () => {
      const newLeaf = this.createLeafBySplit(leaf, 'vertical');
      const st = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
      await newLeaf.setViewState(st && st.file ? { type: leaf.view.getViewType(), state: { file: st.file, mode: st.mode } } : { type: 'empty' });
      this.setActiveLeaf(newLeaf, { focus: true });
    }));
    menu.addItem((item) => item.setTitle(t('menu-items.split-down') || 'Split down').setIcon('separator-horizontal').onClick(async () => {
      const newLeaf = this.createLeafBySplit(leaf, 'horizontal');
      const st = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
      await newLeaf.setViewState(st && st.file ? { type: leaf.view.getViewType(), state: { file: st.file, mode: st.mode } } : { type: 'empty' });
      this.setActiveLeaf(newLeaf, { focus: true });
    }));
    if (leaf.parent && leaf.parent.children.length > 1) {
      menu.addItem((item) => item.setTitle(t('interface.menu.move-to-new-window') || 'Move to new window').setIcon('picture-in-picture-2').onClick(() => {
        new Notice('Opening new windows is not supported in this replica.');
      }));
    }
    menu.showAtMouseEvent(ev);
  }

  _showTabListMenu(ev, tabs) {
    const menu = new Menu(this.app);
    for (const leaf of tabs.children) {
      const active = tabs.activeLeaf === leaf;
      menu.addItem((item) => item.setTitle(leaf.view ? leaf.view.getDisplayText() : 'Tab').setChecked(active).onClick(() => this.setActiveLeaf(leaf, { focus: true })));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t('menu-items.new-tab') || 'New tab').setIcon('plus').onClick(() => this._onNewTab(tabs)));
    menu.showAtMouseEvent(ev);
  }

  // -------------------------------------------------------------------------
  // Tab drag & drop
  // -------------------------------------------------------------------------
  _setupTabDrag(header, leaf) {
    header.addEventListener('dragstart', (ev) => {
      if (leaf.pinned) { ev.preventDefault(); return; }
      this._dragData = { leaf };
      try { ev.dataTransfer.setData('text/plain', leaf.view ? leaf.view.getDisplayText() : 'tab'); } catch (e) {}
      ev.dataTransfer.effectAllowed = 'move';
      header.addClass('is-being-dragged');
      this._dragGhost(ev);
    });
    header.addEventListener('dragend', () => {
      header.removeClass('is-being-dragged');
      this._dragData = null;
      this._clearDropIndicators();
    });
    // dropping onto the tab bar reorders / un-tabs
    const bar = header.parentElement;
    if (bar && !bar._dropBound) {
      bar._dropBound = true;
      bar.addEventListener('dragover', (ev) => {
        if (!this._dragData) return;
        ev.preventDefault();
        const target = ev.target.closest('.workspace-tab-header');
        for (const h of bar.children) h.removeClass('is-tab-drop-before', 'is-tab-drop-after');
        if (target && target._leaf && target._leaf !== this._dragData.leaf) {
          const rect = target.getBoundingClientRect();
          target.toggleClass('is-tab-drop-before', ev.clientX < rect.left + rect.width / 2);
          target.toggleClass('is-tab-drop-after', ev.clientX >= rect.left + rect.width / 2);
        }
        this._tabDropTarget = target;
      });
      bar.addEventListener('dragleave', (ev) => {
        if (!bar.contains(ev.relatedTarget)) {
          for (const h of bar.children) h.removeClass('is-tab-drop-before', 'is-tab-drop-after');
        }
      });
      bar.addEventListener('drop', async (ev) => {
        if (!this._dragData) return;
        ev.preventDefault();
        ev.stopPropagation();
        const drag = this._dragData;
        const target = this._tabDropTarget;
        const tabsEl = bar.closest('.workspace-tabs');
        const tabs = tabsEl && tabsEl._tabs;
        for (const h of bar.children) h.removeClass('is-tab-drop-before', 'is-tab-drop-after');
        if (!tabs) return;
        const after = target && target._leaf ? target : null;
        const draggedLeaf = drag.leaf;
        const idx = after ? tabs.children.indexOf(after._leaf) + (after.hasClass('is-tab-drop-after') ? 1 : 0) : tabs.children.length;
        const state = draggedLeaf.view && draggedLeaf.view.getState ? draggedLeaf.view.getState() : {};
        const type = draggedLeaf.view ? draggedLeaf.view.getViewType() : 'empty';
        if (draggedLeaf.parent === tabs) {
          // reorder within same stack
          const from = tabs.children.indexOf(draggedLeaf);
          let to = idx;
          if (from < to) to -= 1;
          tabs.children.splice(from, 1);
          tabs.children.splice(to, 0, draggedLeaf);
          tabs.currentTab = to;
          this._syncTabsHeaders(tabs);
          this._syncTabsVisibility(tabs);
        } else {
          draggedLeaf.detach();
          const newLeaf = this.createLeafInTabGroup(tabs, idx);
          await newLeaf.setViewState({ type, state });
          this.setActiveLeaf(newLeaf, { focus: true });
        }
        this._dragData = null;
      });
    }
  }

  _dragGhost(ev) {}

  _setupLeafDrop(el, leaf) {
    el.addEventListener('dragover', (ev) => {
      if (!this._dragData) return;
      if (this._dragData.leaf === leaf) return;
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      const zone = this._dropZone(x, y);
      leaf._dropZone = zone;
      this._clearLeafDropIndicators();
      el.toggleClass('is-drop-target', zone === 'center');
      el.toggleClass('mod-drop-left', zone === 'left');
      el.toggleClass('mod-drop-right', zone === 'right');
      el.toggleClass('mod-drop-top', zone === 'top');
      el.toggleClass('mod-drop-bottom', zone === 'bottom');
    });
    el.addEventListener('dragleave', (ev) => {
      if (!el.contains(ev.relatedTarget)) this._clearLeafDropIndicators();
    });
    el.addEventListener('drop', async (ev) => {
      const drag = this._dragData;
      if (!drag) return;
      ev.preventDefault();
      ev.stopPropagation();
      const zone = leaf._dropZone || 'center';
      this._clearLeafDropIndicators();
      this._dragData = null;
      const draggedLeaf = drag.leaf;
      const type = draggedLeaf.view ? draggedLeaf.view.getViewType() : 'empty';
      const state = draggedLeaf.view && draggedLeaf.view.getState ? draggedLeaf.view.getState() : {};
      if (zone === 'center') {
        const tabs = leaf.parent;
        const idx = tabs.children.indexOf(leaf);
        draggedLeaf.detach();
        const newLeaf = this.createLeafInTabGroup(tabs, idx + 1);
        await newLeaf.setViewState({ type, state });
        this.setActiveLeaf(newLeaf, { focus: true });
      } else {
        const direction = (zone === 'left' || zone === 'right') ? 'vertical' : 'horizontal';
        const before = (zone === 'left' || zone === 'top');
        const newLeaf = this.createLeafBySplit(leaf, direction, before);
        draggedLeaf.detach();
        await newLeaf.setViewState({ type, state });
        this.setActiveLeaf(newLeaf, { focus: true });
      }
    });
  }

  _dropZone(x, y) {
    const margin = 0.25;
    if (x < margin && x < y && x < 1 - y) return 'left';
    if (x > 1 - margin && 1 - x < y && 1 - x < 1 - y) return 'right';
    if (y < margin && y < x && y < 1 - x) return 'top';
    if (y > 1 - margin && 1 - y < x && 1 - y < 1 - x) return 'bottom';
    return 'center';
  }

  _clearLeafDropIndicators() {
    this.containerEl.findAll('.workspace-leaf.is-drop-target, .workspace-leaf.mod-drop-left, .workspace-leaf.mod-drop-right, .workspace-leaf.mod-drop-top, .workspace-leaf.mod-drop-bottom')
      .forEach((el) => el.removeClass('is-drop-target', 'mod-drop-left', 'mod-drop-right', 'mod-drop-top', 'mod-drop-bottom'));
  }

  _clearDropIndicators() {
    this._clearLeafDropIndicators();
    this.containerEl.findAll('.workspace-tab-header.is-tab-drop-before, .workspace-tab-header.is-tab-drop-after')
      .forEach((el) => el.removeClass('is-tab-drop-before', 'is-tab-drop-after'));
  }

  _makeTabBarSortable(tabs) {
    // handled via header drag events
  }

  // -------------------------------------------------------------------------
  // Serialization
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
    // title
    this.updateTitle();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  getActiveFile() {
    const view = this.activeLeaf && this.activeLeaf.view;
    if (view && view.getViewType() === 'markdown') {
      const st = view.getState();
      if (st && st.file) return this.app.vault.getFileByPath(st.file);
    }
    return null;
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
    let title = 'Obsidian Copy';
    if (file) {
      title = `${file.basename} - ${vaultName} - Obsidian Copy`;
      if (this.titlebarTextEl) {
        this.titlebarTextEl.empty();
        const pathEl = this.titlebarTextEl.createDiv('titlebar-text');
        pathEl.setText(`${vaultName}/${file.path}`);
      }
    } else {
      if (this.titlebarTextEl) this.titlebarTextEl.setText(vaultName);
    }
    Desktop.setTitle(title);
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

  // Called when settings change
  refreshHeaderVisibility() {
    const show = this.app.settings.config.showViewHeader !== false;
    this.containerEl.findAll('.view-header').forEach((el) => el.toggleClass('is-hidden', !show));
  }
}

export function parseSubpath(linktext) {
  if (!linktext) return '';
  const i = linktext.indexOf('#');
  return i < 0 ? '' : linktext.slice(i + 1);
}
