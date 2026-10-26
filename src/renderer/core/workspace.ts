/**
 * [INPUT]: 依赖 Events、WorkspaceEvents、metadata/vault、视图注册表与桌面 IPC。
 * 依赖 workspace-file-view 的文件分派、workspace-model 的节点；委托 renderer、interactions、close 与 sidebar-transition。
 * [OUTPUT]: 导出 Workspace、WorkspaceItem、WorkspaceSplit、WorkspaceTabs、
 * WorkspaceLeaf 与 parseSubpath。getLeaf 按聚焦偏好创建后台标签，显式激活由 setActiveLeaf 完成。
 * [POS]: 装配分割树与导航。侧栏工具固定，文档新标签始终进入中心。侧栏沿用最近中心文件，链接路径由 vault 转为文件。
 * moveLeafToTabs 是标签跨组/同组重排的唯一入口：搬既有叶子与 DOM，不重开视图；createTabsBySplit 只建空目标组。
 * loadLayout 先隔离验证布局，再确认保存、关闭与替换；失败保留原工作区。
 * 活动编辑器（原版 workspace.activeEditor）：getActiveEditor 取登记项（画布卡片宿主），否则回落活动叶子的编辑器视图；
 * setActiveEditor/unsetActiveEditor 是登记与清空入口，切换活动叶子即清空登记。命令层经此拿到当前应作用的内嵌编辑器。
 * 菜单事件：构造时 attachFileMenuHandler 把 core/file-menu.js 接到 file-menu/files-menu；
 * buildLinkMenu 提供原版链接元素菜单的分节表，handleLink/ExternalLinkContextMenu 负责填充。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Events } from './events.js';
import { setSidebarCollapsed, settleSidebarTransitions } from './workspace-sidebar-transition.js';
import { detachLeafGuarded, closeWorkspaceViews, prepareWorkspaceLayout } from './workspace-close.js';
import { viewStateForFile } from './workspace-file-view.js';
import { t } from './i18n.js';
import { Notice } from './notices.js';
import { FileNameModal } from './modals.js';
import type { DropZone, TabDragState, RibbonAction } from './workspace-types.js';
import type { WorkspaceEvents } from './workspace-events.js';
import type { WorkspaceNode } from './workspace-model.js';
import type { TFile } from './vault.js';
import type { View } from './view.js';
import type { ViewState } from '../../contracts.js';
import { assertWorkspaceLayout } from './workspace-layout.js';
import type { WorkspaceLayoutData, WorkspaceLayoutNode, WorkspaceLeafData, WorkspaceTabsData, WorkspaceSplitData } from './workspace-layout.js';
import type { ActiveEditorHost } from './commands.js';
import { normalizePath } from './vault.js';
import { Desktop } from './ipc.js';
import { WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from './workspace-model.js';
import { createTabsBySplit as createTabsBySplitImpl, moveLeafToTabs as moveLeafToTabsImpl } from './workspace-tab-move.js';
import { getLayout as getLayoutImpl, serializeNode as serializeNodeImpl } from './workspace-serialize.js';
import * as workspaceRenderer from './workspace-renderer.js';
import * as workspaceInteractions from './workspace-interactions.js';
import { reconcileSidebars, canCloseLeaf } from './workspace-sidebar.js';
import { attachFileMenuHandler } from './file-menu.js';
import { Menu } from './menu.js';

export { WorkspaceItem, WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from './workspace-model.js';

export class Workspace extends Events<WorkspaceEvents> {
  _fileMenuAttached = false;
  titlebarTextEl: HTMLElement | null = null;
  _sidebarReady = false;
  _stackedSerialization = false;
  _dividerHandles: Partial<Record<'left' | 'right', HTMLElement>> = {};
  _rootEl: HTMLElement | null = null;
  _workspaceResizeSession: { handle: HTMLElement; finish(): boolean } | null = null;
  vaultProfileEl: HTMLElement | null = null;
  leftSidebarToggleEl: HTMLElement | null = null;
  rightSidebarToggleEl: HTMLElement | null = null;
  ribbonActionsEl: HTMLElement | null = null;
  ribbonSettingsEl: HTMLElement | null = null;
  _ribbonSettingsFallback: HTMLElement | null = null;
  _ribbonState?: { hidden: Set<string>; order: string[] };
  ribbonItems: RibbonItem[] = [];
  backlinkInDocument = false;
  _dragLeaf: WorkspaceLeaf | null = null;
  _draggingLeaf: WorkspaceLeaf | null = null;
  _draggedLeaf: WorkspaceLeaf | null = null;
  _dragGhostEl: HTMLElement | null = null;
  _leafDropIndicator: HTMLElement | null = null;
  _dragEnterCount = 0;
  _dragData: TabDragState | null = null;
  _tabDropOverlay: HTMLElement | null = null;
  _tabDropTarget: HTMLElement | null = null;

  app: App;
  private _containerEl: HTMLElement | null = null;
  get containerEl(): HTMLElement { if (!this._containerEl) throw Error('工作区尚未挂载：containerEl'); return this._containerEl; }
  set containerEl(value: HTMLElement) { this._containerEl = value; }
  private _rootSplit: WorkspaceSplit | null = null;
  get rootSplit(): WorkspaceSplit { if (!this._rootSplit) throw Error('工作区尚未挂载：rootSplit'); return this._rootSplit; }
  set rootSplit(value: WorkspaceSplit) { this._rootSplit = value; }
  private _leftSplit: WorkspaceSplit | null = null;
  get leftSplit(): WorkspaceSplit { if (!this._leftSplit) throw Error('工作区尚未挂载：leftSplit'); return this._leftSplit; }
  set leftSplit(value: WorkspaceSplit) { this._leftSplit = value; }
  private _rightSplit: WorkspaceSplit | null = null;
  get rightSplit(): WorkspaceSplit { if (!this._rightSplit) throw Error('工作区尚未挂载：rightSplit'); return this._rightSplit; }
  set rightSplit(value: WorkspaceSplit) { this._rightSplit = value; }
  private _centerSplit: WorkspaceSplit | null = null;
  get centerSplit(): WorkspaceSplit { if (!this._centerSplit) throw Error('工作区尚未挂载：centerSplit'); return this._centerSplit; }
  set centerSplit(value: WorkspaceSplit) { this._centerSplit = value; }
  ribbonEl: HTMLElement | null;
  statusBar: HTMLElement | null;
  activeLeaf: WorkspaceLeaf | null;
  lastOpenFiles: string[];
  _leafMap: Map<string, WorkspaceLeaf>;
  _lastActiveLeaves: WorkspaceLeaf[];
  _activeEditor: ActiveEditorHost | null;
  _sidebarUpdate: Promise<void> | undefined;

  constructor(app: App) {
    super();
    this.app = app;
    this.ribbonEl = null;
    this.statusBar = null;
    this.activeLeaf = null;
    this.lastOpenFiles = [];
    this._leafMap = new Map();
    this._lastActiveLeaves = [];
    this._activeEditor = null;
    attachFileMenuHandler(this);
  }

  // -------------------------------------------------------------------------
  // 挂载
  // -------------------------------------------------------------------------
  mount(container: HTMLElement) { return workspaceRenderer.mount(this, container); }

  // -------------------------------------------------------------------------
  // 模型到 DOM
  // -------------------------------------------------------------------------
  render() { return workspaceRenderer.render(this); }

  _getRootEl() { return workspaceRenderer._getRootEl(this); }

  _renderNode(node: WorkspaceNode) { return workspaceRenderer._renderNode(this, node); }

  _renderTabs(tabs: WorkspaceTabs) { return workspaceRenderer._renderTabs(this, tabs); }

  _sideOf(node: WorkspaceNode | null | undefined) {
    let n: WorkspaceNode | null | undefined = node;
    while (n) {
      if (n === this.leftSplit) return 'left';
      if (n === this.rightSplit) return 'right';
      if (n === this.centerSplit) return 'center';
      n = n.parent;
    }
    return 'center';
  }

  _renderLeaf(leaf: WorkspaceLeaf) { return workspaceRenderer._renderLeaf(this, leaf); }

  _fillViewHeader(leaf: WorkspaceLeaf) { return workspaceRenderer._fillViewHeader(this, leaf); }

  _refreshLeafContent(leaf: WorkspaceLeaf) { return workspaceRenderer._refreshLeafContent(this, leaf); }

  _ensureLeafDom(leaf: WorkspaceLeaf) { return workspaceRenderer._ensureLeafDom(this, leaf); }

  // -------------------------------------------------------------------------
  // 标签同步
  // -------------------------------------------------------------------------
  _createTabHeader(leaf: WorkspaceLeaf) { return workspaceRenderer._createTabHeader(this, leaf); }

  _syncTabsHeaders(tabs: WorkspaceTabs) { return workspaceRenderer._syncTabsHeaders(this, tabs); }

  _syncTabsVisibility(tabs: WorkspaceTabs) { return workspaceRenderer._syncTabsVisibility(this, tabs); }

  _syncAllTabs() { return workspaceRenderer._syncAllTabs(this); }

  // -------------------------------------------------------------------------
  // 叶子与分割树
  // -------------------------------------------------------------------------
  getLeaf(newLeaf: boolean | string = false, parent?: WorkspaceTabs | WorkspaceLeaf): WorkspaceLeaf {
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
    else if (parent instanceof WorkspaceLeaf && parent.parent instanceof WorkspaceTabs) tabs = parent.parent;
    else if (this.activeLeaf && this._sideOf(this.activeLeaf) === 'center' && this.activeLeaf.parent instanceof WorkspaceTabs) tabs = this.activeLeaf.parent;
    if (!tabs && !parent) tabs = this._firstTabsIn(this.centerSplit);

    if (newLeaf === 'split') {
      const relativeTabs = tabs || this._firstTabsIn(this.centerSplit);
      const splitParent = relativeTabs ? relativeTabs.parent : this.centerSplit;
      const newTabs = new WorkspaceTabs(this);
      if (splitParent instanceof WorkspaceSplit && splitParent.direction === 'vertical' && splitParent !== this.leftSplit && splitParent !== this.rightSplit) {
        const idx = relativeTabs ? splitParent.children.indexOf(relativeTabs) : -1;
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
      leaf = this.createLeafInTabGroup(tabs, idx + 1 >= tabs.children.length ? undefined : idx + 1,
        { active: this.app.settings.appSettings.focusNewTab !== false });
    } else {
      leaf = this.createLeafInTabGroup(tabs, undefined,
        { active: this.app.settings.appSettings.focusNewTab !== false });
    }
    return leaf;
  }

  createLeafInTabGroup(tabs: WorkspaceTabs, index?: number, options: { active?: boolean } = {}) {
    const leaf = new WorkspaceLeaf(this);
    this._leafMap.set(leaf.id, leaf);
    tabs.addLeaf(leaf, index, options.active !== false);
    if (tabs.containerEl && tabs.containerEl.isConnected) {
      // keep DOM in sync immediately
      const el = this._renderLeaf(leaf);
      tabs.containerEl.appendChild(el);
      const header = this._createTabHeader(leaf);
      tabs._headersInner?.appendChild(header);
      this._syncTabsHeaders(tabs);
      this._syncTabsVisibility(tabs);
    }
    this.trigger('layout-change');
    return leaf;
  }

  /** 搬叶子入口；实现见 workspace-tab-move.js。 */
  moveLeafToTabs(leaf: WorkspaceLeaf, targetTabs: WorkspaceTabs, index?: number) {
    return moveLeafToTabsImpl(this, leaf, targetTabs, index ?? targetTabs.children.length);
  }

  /** 建空标签组入口；实现见 workspace-tab-move.js。 */
  createTabsBySplit(referenceLeaf: WorkspaceLeaf, direction: 'horizontal' | 'vertical', before = false) {
    return createTabsBySplitImpl(this, referenceLeaf, direction, before);
  }

  createLeafBySplit(referenceLeaf: WorkspaceLeaf, direction: 'horizontal' | 'vertical', before = false) {
    const newTabs = this.createTabsBySplit(referenceLeaf, direction, before);
    return this.createLeafInTabGroup(newTabs);
  }

  canCloseLeaf(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf { return !!leaf && canCloseLeaf(this, leaf); }

  reconcileSidebars() {
    const previous = this._sidebarUpdate || Promise.resolve();
    this._sidebarUpdate = previous.then(() => reconcileSidebars(this));
    return this._sidebarUpdate;
  }

  detachLeaf(leaf: WorkspaceLeaf) { return detachLeafGuarded(this, leaf); }

  _removeTabsNode(tabs: WorkspaceTabs) {
    const parent = tabs.parent;
    if (!(parent instanceof WorkspaceSplit)) { tabs.containerEl && tabs.containerEl.detach(); return; }
    parent.removeChild(tabs);
    // collapse single-child splits
    let node: WorkspaceSplit | null = parent;
    while (node && node !== this.rootSplit && node !== this.centerSplit && node !== this.leftSplit && node !== this.rightSplit) {
      const grand: WorkspaceSplit | null = node.parent;
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

  setActiveLeaf(leaf: WorkspaceLeaf | null | undefined, options: { clear?: boolean; focus?: boolean } = {}) {
    if (!leaf) return;
    const prev = this.activeLeaf;
    // 原版：活动叶子变化即丢弃画布卡片登记，命令回落到新叶子的编辑器
    if (prev !== leaf) this.unsetActiveEditor();
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

  revealLeaf(leaf: WorkspaceLeaf) {
    if (!leaf) return;
    // uncollapse sidebars containing leaf
    const side = this._sideOf(leaf);
    if (side === 'left') this.showSidebar('left');
    if (side === 'right') this.showSidebar('right');
    this.setActiveLeaf(leaf, { focus: true });
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    const out: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((leaf) => { if (leaf.view && leaf.view.getViewType() === type) out.push(leaf); });
    return out;
  }

  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => void) {
    const walk = (node: WorkspaceNode) => {
      if (node instanceof WorkspaceLeaf) { cb(node); return; }
      if ('children' in node) node.children.forEach(walk);
    };
    if (this.rootSplit) walk(this.rootSplit);
  }

  _firstLeafInCenter(): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    const first = (node: WorkspaceNode) => {
      if (found) return;
      if (node instanceof WorkspaceLeaf) { found = node; return; }
      if ('children' in node) for (const c of node.children) { first(c); if (found) return; }
    };
    if (this.centerSplit) first(this.centerSplit);
    return found;
  }

  _firstTabsIn(split: WorkspaceSplit): WorkspaceTabs | null {
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
  async openFile(file: TFile | null | undefined, options: OpenFileOptions = {}) {
    if (!file) {
      const leaf = this.getLeaf(options.newLeaf ? 'tab' : false);
      await leaf.setViewState({ type: 'empty' });
      return leaf;
    }
    const state: ViewState = this._getViewStateForFile(file);
    if (options.eState) state.state = { ...(state.state || {}), ...options.eState };
    // If same file already open in some center leaf, focus it (like "open in new tab" de-dupe)
    if (options.newLeaf !== 'always') {
      const existing = this.getLeavesOfType(state.type || 'empty').find((l) => {
        const st = l.view?.getState();
        return st && st.file === file.path && this._sideOf(l) === 'center';
      });
      if (existing && options.newLeaf) {
        if (this.app.settings.appSettings.focusNewTab !== false) this.revealLeaf(existing);
        this._addLastOpenFile(file.path);
        if (this.activeLeaf === existing) this.trigger('file-open', file);
        return existing;
      }
    }
    // 查重先于创建，复用已有文件时不留下未装载的空标签。
    let leaf = null;
    if (!options.newLeaf) leaf = this.activeLeaf && this._sideOf(this.activeLeaf) === 'center' ? this.activeLeaf : this._firstLeafInCenter();
    if (!leaf) leaf = this.getLeaf(options.newLeaf === 'split' ? 'split' : 'tab');
    // 先激活再异步加载：避免加载较慢时，迟到的 setActiveLeaf 把用户随后切到的标签抢回来
    // （原版同样是"标签立即激活，内容随后加载"的语义）
    if (!options.newLeaf || this.app.settings.appSettings.focusNewTab === true) {
      this.setActiveLeaf(leaf, { focus: true });
    }
    if (await leaf.setViewState(state) === false) return leaf;
    this._addLastOpenFile(file.path);
    if (options.eState) leaf.view?.setEphemeralState(options.eState);
    if (this.activeLeaf === leaf) this.trigger('file-open', file);
    return leaf;
  }

  _getViewStateForFile(file: TFile) { return viewStateForFile(this.app, file); }

  _addLastOpenFile(path: string) {
    this.lastOpenFiles = [path, ...this.lastOpenFiles.filter((p) => p !== path)].slice(0, 40);
  }

  async openLinkText(linktext: string, sourcePath: string, newLeaf: boolean | string = false) {
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
   * 原版 ES.forEvent(e) 的链接菜单：阅读视图链接、搜索结果行、反链/出链条目共用的分节表。
   * 调用方随后用 handleLinkContextMenu / handleExternalLinkContextMenu 填充。
   */
  buildLinkMenu() {
    const menu = new Menu(this.app);
    menu.addSections(['title', 'open', 'action', 'view', 'info', 'info.copy', '', 'danger']);
    return menu;
  }

  /**
   * 原版 handleLinkContextMenu：已解析 → 新标签页/新标签组/重命名（并触发 file-menu）；
   * 未解析 → 创建此文件。返回是否已填充菜单。
   */
  handleLinkContextMenu(menu: Menu, linktext: string, sourcePath: string, ctx?: unknown) {
    if (!linktext) return false;
    const dest = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath || '');
    const file = dest ? this.app.vault.getFileByPath(dest) : null;
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
  handleExternalLinkContextMenu(menu: Menu, href: string) {
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
  async ensureSideLeaf(type: string, side: 'left' | 'right', options: { reveal?: boolean; state?: Record<string, unknown> } = {}) {
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

  showSidebar(side: 'left' | 'right') { return setSidebarCollapsed(this, side, false); }

  hideSidebar(side: 'left' | 'right') { return setSidebarCollapsed(this, side, true); }

  toggleSidebar(side: 'left' | 'right') {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    if (split.collapsed) this.showSidebar(side); else this.hideSidebar(side);
  }

  getSidebarCollapsed(side: 'left' | 'right') {
    return !!(side === 'left' ? this.leftSplit.collapsed : this.rightSplit.collapsed);
  }

  // -------------------------------------------------------------------------
  // 尺寸
  // -------------------------------------------------------------------------
  _createResizeHandle(split: WorkspaceSplit, childIndex: number, direction: 'horizontal' | 'vertical') { return workspaceRenderer._createResizeHandle(this, split, childIndex, direction); }

  _updateLeafSizes() { return workspaceRenderer._updateLeafSizes(this); }

  // -------------------------------------------------------------------------
  // 功能区
  // -------------------------------------------------------------------------
  _createRibbon() { return workspaceRenderer._createRibbon(this); }

  addRibbonItem(icon: string, title: string, callback: RibbonAction, target?: string) { return workspaceRenderer.addRibbonItem(this, icon, title, callback, target); }

  getRibbonItems() { return workspaceRenderer.getRibbonItems(this); }

  isRibbonItemHidden(key: string) { return workspaceRenderer.isRibbonItemHidden(this, key); }

  setRibbonItemHidden(key: string, hidden: boolean) { return workspaceRenderer.setRibbonItemHidden(this, key, hidden); }

  setRibbonOrder(keys: string[]) { return workspaceRenderer.setRibbonOrder(this, keys); }

  // -------------------------------------------------------------------------
  // 标签交互
  // -------------------------------------------------------------------------
  _onNewTab(tabs: WorkspaceTabs) { return workspaceInteractions._onNewTab(this, tabs); }

  _showTabContextMenu(ev: MouseEvent, leaf: WorkspaceLeaf) { return workspaceInteractions._showTabContextMenu(this, ev, leaf); }

  _showTabListMenu(ev: MouseEvent, tabs: WorkspaceTabs) { return workspaceInteractions._showTabListMenu(this, ev, tabs); }

  // -------------------------------------------------------------------------
  // 标签拖拽
  // -------------------------------------------------------------------------
  _setupTabDrag(header: HTMLElement, leaf: WorkspaceLeaf) { return workspaceInteractions._setupTabDrag(this, header, leaf); }

  _dragGhost(ev: DragEvent) { return workspaceInteractions._dragGhost(this, ev); }

  _setupLeafDrop(el: HTMLElement, leaf: WorkspaceLeaf) { return workspaceInteractions._setupLeafDrop(this, el, leaf); }

  _dropZone(x: number, y: number, allowed?: string[] | null) { return workspaceInteractions._dropZone(this, x, y, allowed); }

  _clearLeafDropIndicators() { return workspaceInteractions._clearLeafDropIndicators(this); }

  _clearDropIndicators() { return workspaceInteractions._clearDropIndicators(this); }

  _endTabDrag() { return workspaceInteractions._endTabDrag(this); }

  _makeTabBarSortable(tabs: WorkspaceTabs) { return workspaceInteractions._makeTabBarSortable(this, tabs); }

  // 布局序列化（实现见 workspace-serialize.js）
  serializeNode(node: WorkspaceLeaf): WorkspaceLeafData;
  serializeNode(node: WorkspaceTabs): WorkspaceTabsData;
  serializeNode(node: WorkspaceSplit): WorkspaceSplitData;
  serializeNode(node: WorkspaceNode): WorkspaceLayoutNode;
  serializeNode(node: WorkspaceNode): WorkspaceLayoutNode { return serializeNodeImpl(this, node); }
  getLayout() { return getLayoutImpl(this); }

  async deserializeNode(data: WorkspaceLayoutNode | null): Promise<WorkspaceNode | null> {
    if (!data) return null;
    if (data.type === 'leaf') {
      const leaf = new WorkspaceLeaf(this);
      if (data.id) leaf.id = data.id;
      if (typeof data.dimension === 'number' && Number.isFinite(data.dimension) && data.dimension > 0) leaf.dimension = data.dimension;
      leaf._pendingState = data.state || { type: 'empty', state: {} };
      this._leafMap.set(leaf.id, leaf);
      return leaf;
    }
    if (data.type === 'tabs') {
      const tabs = new WorkspaceTabs(this);
      if (data.id) tabs.id = data.id;
      if (typeof data.dimension === 'number' && Number.isFinite(data.dimension) && data.dimension > 0) tabs.dimension = data.dimension;
      for (const child of data.children || []) {
        const node = await this.deserializeNode(child);
        if (node instanceof WorkspaceLeaf) tabs.addLeaf(node);
      }
      tabs.currentTab = Math.max(0, Math.min(data.currentTab || 0, tabs.children.length - 1));
      return tabs;
    }
    if (data.type === 'split') {
      const split = new WorkspaceSplit(this, data.direction || 'vertical');
      if (data.id) split.id = data.id;
      if (typeof data.dimension === 'number' && Number.isFinite(data.dimension) && data.dimension > 0) split.dimension = data.dimension;
      if (data.size) split.size = data.size;
      for (const child of data.children || []) {
        const node = await this.deserializeNode(child);
        if (node) split.insertChild(split.children.length, node);
      }
      return split;
    }
    return null;
  }

  async loadLayout(data: unknown) {
    if (!data) return false;
    let staged;
    try { assertWorkspaceLayout(data); staged = await prepareWorkspaceLayout(this, data, Workspace.prototype.deserializeNode); }
    catch (error) { new Notice('无法载入布局：' + (error instanceof Error ? error.message : String(error))); return false; }
    settleSidebarTransitions(this);
    if (await closeWorkspaceViews(this) === false) return false;
    this._leafMap = staged.leafMap; this.activeLeaf = null; this._lastActiveLeaves = [];
    this.centerSplit = this._replaceInRoot(this.centerSplit, staged.main); this.centerSplit.side = 'center';
    this.leftSplit = this._replaceInRoot(this.leftSplit, staged.left); this.leftSplit.side = 'left';
    this.rightSplit = this._replaceInRoot(this.rightSplit, staged.right); this.rightSplit.side = 'right';
    this.lastOpenFiles = data.lastOpenFiles || [];
    this.leftSplit.collapsed = !!data.leftCollapsed; this.rightSplit.collapsed = !!data.rightCollapsed;
    if (data.leftWidth) this.leftSplit.size = data.leftWidth;
    if (data.rightWidth) this.rightSplit.size = data.rightWidth;
    return data.active || null;
  }

  _replaceInRoot(oldNode: WorkspaceSplit, newNode: WorkspaceSplit) {
    const idx = this.rootSplit.children.indexOf(oldNode);
    if (idx >= 0) {
      this.rootSplit.removeChild(oldNode);
      this.rootSplit.insertChild(idx, newNode);
    }
    return newNode;
  }

  async postLayoutLoad(activeId: string | null) {
    // load every leaf's view first so DOM rendering can attach content
    const leaves: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((l) => leaves.push(l));
    for (const leaf of leaves) {
      const state = leaf._pendingState || { type: 'empty', state: {} };
      leaf._pendingState = null;
      leaf.viewState = state;
      const factory = this.app.viewRegistry.getViewCreator(state.type || 'empty') || this.app.viewRegistry.getViewCreator('empty');
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

  /**
   * 活动编辑器宿主（原版 workspace.activeEditor 的 getter）：
   * 优先本次登记的画布卡片宿主，否则回落到活动叶子的编辑器视图（原版 getActiveViewOfType(MarkdownView)）。
   * 返回对象带 { editor, file, containerEl }；活动叶子没有编辑器时返回 null。
   */
  getActiveEditor(): ActiveEditorHost | null {
    if (this._activeEditor) return this._activeEditor;
    const view = this.activeLeaf && this.activeLeaf.view;
    return view?.editor ? view as View & ActiveEditorHost : null;
  }

  /** 登记活动编辑器（原版 activeEditor 的 setter）：markdown 视图不登记，由回落路径命中；null 清空。 */
  setActiveEditor(editor: ActiveEditorHost | null) {
    if (editor && editor.getViewType && editor.getViewType() === 'markdown') return;
    this._activeEditor = editor;
  }

  /** 清空登记：无参或与登记项相同时清空（原版 unsetActiveEditor）。 */
  unsetActiveEditor(editor?: ActiveEditorHost | null) {
    if (!editor || this._activeEditor === editor) this._activeEditor = null;
  }

  /** 原版属性访问形式：workspace.activeEditor。 */
  get activeEditor() { return this.getActiveEditor(); }

  set activeEditor(editor) { this.setActiveEditor(editor); }

  getActiveFile() {
    const active = this.activeLeaf;
    const leaf = active && this._sideOf(active) !== 'center'
      ? this._lastActiveLeaves.find((item) => !item._closed && this._leafMap.has(item.id) && this._sideOf(item) === 'center')
      : active;
    const view = leaf && leaf.view;
    const statePath = view?.getState().file;
    const path = view?.file?.path || (typeof statePath === 'string' ? statePath : '');
    return path ? this.app.vault.getFileByPath(path) : null;
  }

  getActiveViewOfType<T extends View>(type: abstract new (...args: never[]) => T): T | null;
  getActiveViewOfType(type: string): View | null;
  getActiveViewOfType<T extends View>(type: (abstract new (...args: never[]) => T) | string): T | View | null {
    const view = this.activeLeaf && this.activeLeaf.view;
    if (!view) return null;
    // The original takes a view class; string type names are also accepted so
    // core plugins can look views up without importing their classes.
    if (typeof type === 'string') return view.getViewType() === type ? view : null;
    if (view instanceof type) return view;

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

  getShownSidebarLeaves(side: 'left' | 'right') {
    const split = side === 'left' ? this.leftSplit : this.rightSplit;
    const out: WorkspaceLeaf[] = [];
    for (const child of split.children) {
      if (child instanceof WorkspaceLeaf) out.push(child);
      else if (child.children) {
        const collect = (n: WorkspaceNode) => {
          if (n instanceof WorkspaceLeaf) out.push(n);
          else if ('children' in n) n.children.forEach(collect);
        };
        child.children.forEach(collect);
      }
    }
    return out;
  }

  // 设置变更后同步标题栏
  refreshHeaderVisibility() { return workspaceRenderer.refreshHeaderVisibility(this); }
}

export function parseSubpath(linktext: string) {
  if (!linktext) return '';
  const i = linktext.indexOf('#');
  return i < 0 ? '' : linktext.slice(i + 1);
}

export interface OpenFileOptions { newLeaf?: boolean | string; eState?: Record<string, unknown>; }
export interface RibbonItem { key: string; icon: string; title: string; el: HTMLElement; target?: string; }
