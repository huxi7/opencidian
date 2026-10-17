/* View base class + view registry. */
import { Events } from './events.js';

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
  onPaneMenu(menu, source) {}

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
