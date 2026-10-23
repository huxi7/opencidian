/**
 * [INPUT]: Events 提供事件；宿主提供 leaf 与视图根节点；view-pane-menu 提供文件面板菜单。
 * [OUTPUT]: 导出 View 生命周期基类与 ViewRegistry 注册表。
 * [POS]: 视图契约边界。插件登记扩展名，工作区按注册表分派文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* View base class + view registry. */
import { Events } from './events.js';
import { fillFilePaneMenu } from './view-pane-menu.js';

export class View extends Events {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = null;
    this.contentEl = null;
    this.scope = null;
    this.icon = null;
    this.navigation = false;
    this._children = [];
    this._loaded = false;
  }

  getViewType() { return 'empty'; }
  getDisplayText() { return this.getViewType(); }
  getIcon() { return this.icon || 'lucide-file'; }
  getState() { return {}; }
  setState(state, result) { return Promise.resolve(); }
  async onOpen() {}
  async onClose() {}
  onResize() {}
  onPaneMenu(menu, source) { if (this.file) fillFilePaneMenu(this, menu, source); }

  async load() {
    if (this._loaded) return;
    this._loaded = true;
    await this.onOpen();
  }

  getEphemeralState() { return {}; }
  setEphemeralState(state) { this.ephemeralState = state; }
}

export class ViewRegistry {
  constructor() {
    this.views = new Map();
    this.viewByType = new Map();
  }
  registerView(type, factory) {
    this.views.set(type, factory);
  }
  unregisterView(type) {
    this.views.delete(type);
  }
  getViewCreator(type) {
    return this.views.get(type);
  }
  getTypeByExtension(ext) {
    for (const [type, factory] of this.views) {
      if (factory.extensions && factory.extensions.includes(ext)) return type;
    }
    return null;
  }
}
