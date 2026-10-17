/**
 * [INPUT]: 依赖 icons 绘制标签图标；视图由 workspace.app.viewRegistry 创建。
 * [OUTPUT]: 导出 WorkspaceItem、WorkspaceSplit、WorkspaceTabs、WorkspaceLeaf。
 * [POS]: 定义分割树节点与叶子视图生命周期。节点通过 workspace 调用宿主。
 * 视图持有稳定 _rootEl；树重排只迁移根元素。
 * 模型不导入 Workspace，确保构造器身份唯一。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setIcon } from './icons.js';

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
