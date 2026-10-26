/**
 * [INPUT]: 依赖 icons 绘制标签图标、i18n 与 Menu（标签列表菜单，原版建在 Tabs 类内）；
 * 视图由 workspace.app.viewRegistry 创建。
 * [OUTPUT]: 导出 WorkspaceItem、WorkspaceSplit、WorkspaceTabs、WorkspaceLeaf、
 * installStackedSerialization。
 * [POS]: 定义分割树节点与叶子视图生命周期。节点通过 workspace 调用宿主；setState/onClose 明确失败时保留旧视图。
 * 视图持有稳定 _rootEl；树重排只迁移根元素。
 * 标签组持有堆叠状态和当前叶子。后台插入按身份保持可见项；DOM 由 workspace-renderer 建。
 * 模型不导入 Workspace，确保构造器身份唯一。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DropZone } from './workspace-types.js';
import type { Workspace } from './workspace.js';
import type { View } from './view.js';
import type { ViewState } from '../../contracts.js';
import type { WorkspaceLayoutNode } from './workspace-layout.js';
import { setIcon } from './icons.js';
import { t } from './i18n.js';
import { Menu } from './menu.js';

function genId() { return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10); }

export class WorkspaceItem {
  workspace: Workspace;
  app: App;
  parent: WorkspaceSplit | WorkspaceTabs | null;
  id: string;

  constructor(workspace: Workspace) {
    this.workspace = workspace;
    this.app = workspace.app;
    this.parent = null;
    this.id = genId();
  }
}

export class WorkspaceSplit extends WorkspaceItem {
  declare parent: WorkspaceSplit | null;
  dimension: number | undefined;

  direction: 'vertical' | 'horizontal';
  children: WorkspaceNode[];
  size: number | null;
  side: 'left' | 'right' | 'center' | null;
  declare collapsed: boolean;
  isRoot = false;
  containerEl: HTMLElement | null;

  constructor(workspace: Workspace, direction: 'vertical' | 'horizontal') {
    super(workspace);
    this.direction = direction; // 'vertical' (children side by side) | 'horizontal' (rows)
    this.children = [];
    this.size = null;
    this.side = null;
    this.collapsed = false;
    this.containerEl = null;
  }
  insertChild(index: number, child: WorkspaceNode) {
    child.parent = this;
    this.children.splice(index, 0, child);
  }
  removeChild(child: WorkspaceNode) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }
}

export class WorkspaceTabs extends WorkspaceItem {
  declare parent: WorkspaceSplit | null;
  dimension: number | undefined;

  children: WorkspaceLeaf[];
  declare currentTab: number;
  containerEl: HTMLElement | null;
  _headersInner: HTMLElement | null;
  _tabContainerEl: HTMLElement | null;
  declare isStacked: boolean;
  _headersOuter: HTMLElement | null = null;
  _slidingObserver: ResizeObserver | null = null;
  _animatedLeaves: Set<WorkspaceLeaf> | undefined;

  constructor(workspace: Workspace) {
    super(workspace);
    this.children = [];
    this.currentTab = 0;
    this.containerEl = null;       // .workspace-tabs，由 renderer 建
    this._headersInner = null;     // .workspace-tab-header-container-inner（非堆叠态的头宿主）
    this._tabContainerEl = null;   // .workspace-tab-container（叶子宿主；堆叠态头与叶交替）
    this.isStacked = false;        // 原版 VD.isStacked，序列化键 stacked
  }
  get activeLeaf() { return this.children[this.currentTab] || null; }
  addLeaf(leaf: WorkspaceLeaf, index?: number | null, active = true) {
    const selected = this.activeLeaf;
    leaf.parent = this;
    if (index === undefined || index === null || index < 0 || index > this.children.length) this.children.push(leaf);
    else this.children.splice(index, 0, leaf);
    // 后台插入按叶子身份保留当前项，不能保留会随插入漂移的数字索引。
    this.currentTab = this.children.indexOf(active || !selected ? leaf : selected);
  }
  removeLeaf(leaf: WorkspaceLeaf) {
    const i = this.children.indexOf(leaf);
    if (i >= 0) this.children.splice(i, 1);
    leaf.parent = null;
    if (this.currentTab >= this.children.length) this.currentTab = this.children.length - 1;
    if (this.currentTab < 0) this.currentTab = 0;
  }

  /**
   * 原版 VD.setStacked：切换 mod-stacked，刷新标签显示，并请求布局保存。
   * 未渲染（反序列化、装载中）时只记状态；容器类由 renderer 建时按状态落上。
   */
  setStacked(stacked: boolean) {
    stacked = !!stacked;
    if (this.isStacked === stacked) return;
    this.isStacked = stacked;
    if (!this.containerEl) return;
    this.containerEl.toggleClass('mod-stacked', stacked);
    if (this.workspace._syncAllTabs) this.workspace._syncAllTabs();
    this.workspace.trigger('layout-change');   // 原版 requestSaveLayout：本仓库在 layout-change 上防抖落库
  }

  /**
   * 原版 VD.updateTabDisplay：标签头与叶子的落位。
   * 非堆叠 → 头回 tab-header-container-inner，叶留在 tab-container；
   * 堆叠 → 头与叶交替排入 tab-container（头0, 叶0, 头1, 叶1…），活动标签滚入视口。
   * 标签头的拖拽在落位后绑定（原版 onDragLeaf 读 header.parentElement：宿主随堆叠态改变）。
   */
  updateTabDisplay() {
    const container = this._tabContainerEl;
    if (!container) return;
    const inner = this._headersInner;
    const bindDrag = (leaf: WorkspaceLeaf) => {
      const header = leaf._tabHeaderEl;
      const host = header && header.parentElement;
      if (!header || !host) return;
      if (leaf._dragHost === host) return;
      leaf._dragHost = host;
      this.workspace._setupTabDrag && this.workspace._setupTabDrag(header, leaf);
    };
    if (this.isStacked) {
      for (const leaf of this.children) {
        if (leaf._tabHeaderEl) container.appendChild(leaf._tabHeaderEl);
        if (leaf._leafEl) container.appendChild(leaf._leafEl);
        bindDrag(leaf);
      }
      this.updateSlidingTabs();
      this.scrollIntoView(this.currentTab);
      return;
    }
    for (const leaf of this.children) {
      if (inner && leaf._tabHeaderEl && leaf._tabHeaderEl.parentElement !== inner) inner.appendChild(leaf._tabHeaderEl);
      if (leaf._leafEl && leaf._leafEl.parentElement !== container) container.appendChild(leaf._leafEl);
      bindDrag(leaf);
    }
    this.updateSlidingTabs();
  }

  /**
   * 非堆叠态：标签头 DOM 顺序跟随 children（原版 insertChild + updateTabDisplay 的等价物）。
   * 只重排、不新建；堆叠态由 updateTabDisplay 交替落位。
   */
  syncHeaderOrder() {
    const inner = this._headersInner;
    if (!inner || this.isStacked) return;
    const current = Array.from(inner.children).filter((el) => el._leaf);
    const desired = this.children.map((leaf) => leaf._tabHeaderEl).filter((header) => header !== null);
    if (current.length === desired.length && current.every((el, i) => el === desired[i])) return;
    for (const header of desired) if (header.parentElement === inner) inner.appendChild(header);
  }

  /**
   * 原版 VD.updateSlidingTabs：堆叠态下头按累计宽度取 left/right（position: sticky 吸附），
   * pane 取 left 与 min/max 宽度；非堆叠态清空这些内联样式。
   */
  updateSlidingTabs() {
    const container = this._tabContainerEl;
    if (!container) return;
    const children = this.children;
    if (this.isStacked) {
      const widths = children.map((leaf) => (leaf._tabHeaderEl ? leaf._tabHeaderEl.offsetWidth : 0));
      const headerWidth = widths.reduce((sum, width) => sum + width, 0);
      const paneWidth = Math.max(300, (container.clientWidth || 0) - headerWidth);
      const minWidth = paneWidth / (children.length || 1);
      let left = 0, right = headerWidth;
      children.forEach((leaf, index) => {
        const width = widths[index];
        if (leaf._tabHeaderEl) {
          leaf._tabHeaderEl.style.left = left + 'px';
          leaf._tabHeaderEl.style.right = (right - width) + 'px';
        }
        left += width;
        right -= width;
        if (leaf._leafEl) {
          leaf._leafEl.style.left = left + 'px';
          leaf._leafEl.style.minWidth = minWidth + 'px';
          leaf._leafEl.style.maxWidth = paneWidth + 'px';
        }
      });
      this.onContainerScroll();
      return;
    }
    for (const leaf of children) {
      if (leaf._tabHeaderEl) { leaf._tabHeaderEl.style.left = ''; leaf._tabHeaderEl.style.right = ''; }
      if (leaf._leafEl) { leaf._leafEl.style.left = ''; leaf._leafEl.style.minWidth = ''; leaf._leafEl.style.maxWidth = ''; }
    }
  }

  /** 原版 VD.onContainerScroll：完全滚出视口的非活动 pane 标 is-hidden（CSS 只隐藏其子元素）。 */
  onContainerScroll() {
    const container = this._tabContainerEl;
    if (!container || !this.isStacked) return;
    const scrollLeft = container.scrollLeft || 0;
    const viewRight = scrollLeft + (container.clientWidth || 0);
    let cursor = 0;
    this.children.forEach((leaf, index) => {
      const headerWidth = leaf._tabHeaderEl ? leaf._tabHeaderEl.offsetWidth : 0;
      const paneLeft = cursor + headerWidth;
      const paneRight = paneLeft + (leaf._leafEl ? leaf._leafEl.offsetWidth : 0);
      cursor = paneRight;
      if (leaf._leafEl) {
        leaf._leafEl.toggleClass('is-hidden', index !== this.currentTab && (paneRight <= scrollLeft || paneLeft >= viewRight));
      }
    });
  }

  /** 原版 VD.scrollIntoView：横向滚动，使指定标签的头与 pane 完整进入视口。 */
  scrollIntoView(index: number) {
    const container = this._tabContainerEl;
    const leaf = this.children[index];
    if (!container || !leaf || typeof container.scrollTo !== 'function') return;
    let before = 0, start = 0, after = 0;
    this.children.forEach((child, i) => {
      const headerWidth = child._tabHeaderEl ? child._tabHeaderEl.offsetWidth : 0;
      if (i <= index) {
        before += headerWidth;
        start += headerWidth;
        if (i < index && child._leafEl) start += child._leafEl.offsetWidth;
      } else {
        after += headerWidth;
      }
    });
    const paneWidth = leaf._leafEl ? leaf._leafEl.offsetWidth : 0;
    const minScroll = start - before;
    const maxScroll = start + paneWidth - (container.clientWidth || 0) + after;
    const current = container.scrollLeft || 0;
    if (current < maxScroll) container.scrollTo({ behavior: 'smooth', left: maxScroll });
    else if (current > minScroll) container.scrollTo({ behavior: 'smooth', left: minScroll });
  }

  /**
   * 原版 VD 的标签列表菜单：action（堆叠/取消堆叠）→ close（全部关闭）→ tablist（每个标签）。
   * 原版把该菜单建在 Tabs 类内部，本实现同层放置；侧栏组不提供文档标签菜单。
   */
  showTabListMenu(ev: MouseEvent, parentEl: HTMLElement) {
    if (!this.workspace._sideOf || this.workspace._sideOf(this) !== 'center') return;
    const menu = new Menu(this.workspace.app);
    // 原版 VD 的分节表：action（堆叠/取消堆叠）→ close（全部关闭）→ tablist（每个标签）
    menu.addSections(['action', 'close', '', 'tablist', '']);
    menu.onShow = () => { if (menu.dom) menu.dom.addClass('mod-tab-list'); };   // 原版 n.dom.addClass("mod-tab-list")
    menu.addItem((item) => item.setSection('action')
      .setTitle(t(this.isStacked ? 'interface.menu.unstack-tabs' : 'interface.menu.stack-tabs'))
      .setIcon('lucide-layers')
      .onClick(() => this.setStacked(!this.isStacked)));
    const closable = this.children.filter((leaf) => !leaf.pinned);
    if (closable.length) {
      menu.addItem((item) => item.setSection('close')
        .setTitle(t('interface.menu.close-all'))
        .setIcon('lucide-x')
        .onClick(() => { for (const leaf of [...closable]) leaf.detach(); }));
    }
    for (const leaf of this.children) {
      const view = leaf.view;
      if (!view) continue;
      menu.addItem((item) => item.setSection('tablist')
        .setTitle(view.getDisplayText())
        .setChecked(leaf === this.activeLeaf)
        .setIcon(view.getIcon())
        .onClick(() => this.workspace.setActiveLeaf(leaf)));
    }
    this.workspace.trigger('tab-group-menu', menu, this);
    if (menu.setParentElement) menu.setParentElement(parentEl);
    menu.showAtMouseEvent(ev);
  }
}

/**
 * 原版 VD.serialize 写出的 stacked 键。本仓库的 layout JSON 由 workspace.js 组装
 * （该文件本批不改），因此模型在挂载时补一层装饰器：只读写 tabs 节点的 stacked 键。
 * 序列化/反序列化的递归经实例属性回到装饰后的版本，整棵树的键一致。
 */
export function installStackedSerialization(workspace: Workspace) {
  if (workspace._stackedSerialization) return;
  workspace._stackedSerialization = true;
  const serializeNode = workspace.serializeNode.bind(workspace);
  workspace.serializeNode = ((node: WorkspaceNode) => {
    const data = serializeNode(node);
    if (data && data.type === 'tabs' && node instanceof WorkspaceTabs && node.isStacked) data.stacked = true;
    return data;
  }) as typeof workspace.serializeNode;
  const deserializeNode = workspace.deserializeNode.bind(workspace);
  workspace.deserializeNode = async (data) => {
    const node = await deserializeNode(data);
    if (node instanceof WorkspaceTabs && data?.type === 'tabs' && data.stacked) node.setStacked(true);
    return node;
  };
}

export class WorkspaceLeaf extends WorkspaceItem {
  _viewNavBackEl?: HTMLElement;
  _viewNavForwardEl?: HTMLElement;
  _viewTitleParentEl?: HTMLElement;
  _updateTitleFade?: () => void;
  declare parent: WorkspaceTabs | WorkspaceSplit | null;
  _tabHeaderEl: HTMLElement | null = null;
  _leafEl: HTMLElement | null = null;
  _dragHost: HTMLElement | null = null;
  _headersOuter?: HTMLElement;
  _viewHeaderEl?: HTMLElement;
  _viewActionsEl?: HTMLElement;
  _viewTitleEl?: HTMLElement;
  _resizeObserver: ResizeObserver | null = null;
  _resizePending = false;
  _detachPending: Promise<boolean> | null = null;
  pinned = false;
  _dropZone: DropZone | undefined;
  dimension: number | undefined;
  _pendingState: ViewState | null = null;

  view: View | null;
  viewState: ViewState | null;
  containerEl: HTMLElement | null;
  contentEl: HTMLElement | null;
  declare width: number;
  declare height: number;
  declare activeTime: number;
  declare _closed: boolean;

  constructor(workspace: Workspace) {
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

  async setViewState(state: ViewState, eState?: Record<string, unknown>) {
    if (!state || !state.type) return;
    const prev = this.view;
    const sameType = prev && prev.getViewType() === state.type;
    if (sameType && prev.setState) {
      if (await prev.setState(state.state || {}, state) === false) return false;
      this.viewState = state;
      this.updateTabHeader();
      this.workspace._refreshLeafContent(this);
      this.workspace.trigger('layout-change');
      return;
    }
    if (prev) {
      try { if (await prev.onClose() === false) return false; } catch { return false; }
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

  detach() { return this.workspace.detachLeaf(this); }

  getEphemeralState() { return this.view ? this.view.getEphemeralState() : {}; }
  setEphemeralState(state: Record<string, unknown>) { this.view && this.view.setEphemeralState(state); }
  open() { return this.setViewState({ type: 'empty' }); }
}

export type WorkspaceNode = WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf;
