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
  declare file: import('./vault.js').TFile;

  declare leaf: any;
  declare app: App;
  declare containerEl: any;
  declare contentEl: any;
  declare scope: any;
  declare icon: any;
  declare navigation: boolean;
  declare _children: any[];
  declare _loaded: boolean;
  declare ephemeralState: any;

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
  setState(state?: Record<string, unknown>, result?: unknown): void | boolean | Promise<void | boolean> { return Promise.resolve(); }
  async onOpen() {}
  onClose(): void | boolean | Promise<void | boolean> { return Promise.resolve(); }
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
  declare views: any;
  declare viewByType: any;

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
