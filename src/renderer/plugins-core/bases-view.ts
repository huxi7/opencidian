/**
 * [INPUT]: View 生命周期、增量 queryBase、布局、工具栏、配置与新建浮层；设置事件更新排除规则。
 * [OUTPUT]: 导出 BasesView、mountBaseEmbed 与可拒绝停用的插件同步函数。
 * save/setState/onClose 传播草稿保存失败；嵌入返回订阅释放函数。
 * [POS]: Bases 文件与嵌入共用控制器。持有视图选择、组折叠、行缓存与数据订阅；配置写入按最新文档和唯一视图名称定位。未知布局保留返回已支持视图的入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { tt } from '../core/i18n.js';
import { View } from '../core/view.js';
import { BaseDocument, queryBase } from './bases-model.js';
import { installBasesStyles } from './bases-styles.js';
import { BASE_LAYOUTS, renderBaseLayout, appendBaseElement as el } from './bases-layouts.js';
import { openBasesConfig } from './bases-config.js';
import { transactBaseDocument, resolveBaseView } from './bases-edit-store.js';
import { disposeBaseRichController } from './bases-rich-lifecycle.js';
import { closeBaseNewItem } from './bases-ui-new-item.js';
import { disposeBaseEditing } from './bases-edit-cells.js';
import { renderBasesToolbar, applyBaseSearch, openBasesFilters, disposeBasesUI } from './bases-ui.js';

const controllers = new Set<BasesController>();
export function setBasesEnabled(app: App, enabled) {
  const owned = [...controllers].filter(controller => controller.app === app);
  if (enabled) { for (const controller of owned) controller.setEnabled(true); return true; }
  return (async () => {
    // 所有控制器先证明草稿已保存，再一起停订阅。失败时保留插件和浮层。
    for (const controller of owned) if (!await closeBaseNewItem(controller, { preserveOnFailure: true })) return false;
    for (const controller of owned) controller.setEnabled(false);
    return true;
  })();
}

export class BasesController {
  declare _basesNewItem: any;

  declare app: App;
  declare container: any;
  declare file: any;
  declare viewName: any;
  declare sourceFile: any;
  declare onViewChange: any;
  declare folded: any;
  declare virtualizers: any;
  declare queryCache: any;
  declare document: any;
  declare refs: any[];
  declare closed: boolean;
  declare sequence: number;
  declare queue: any;
  declare settingsRef: any;
  declare typeRef: any;
  declare enabled: any;
  declare result: any;
  declare ready: Promise<void> | undefined;
  declare timer: NodeJS.Timeout | undefined;
  declare suspended: any;
  declare pendingEditRefresh: boolean | undefined;
  declare editIdentity: { name: any; } | undefined;

  constructor(app: App, container, file, options: Record<string, any> = {}) {
    this.app = app; this.container = container; this.file = file; this.viewName = options.viewName || '';
    this.sourceFile = options.sourceFile || app.vault.getFileByPath(options.sourcePath || '') || file;
    this.onViewChange = options.onViewChange; this.folded = new Set(); this.virtualizers = new Set(); this.queryCache = { dirty: new Set() };
    this.document = null; this.refs = []; this.closed = false; this.sequence = 0; this.queue = Promise.resolve();
    installBasesStyles(container.ownerDocument);
    container.classList.add('bases-embed');
    controllers.add(this);
    this.setEnabled(app.plugins.getInternalPlugin('bases')?.enabled !== false);
  }
  setEnabled(enabled) {
    if (this.closed) return true;
    if ((!enabled || this.suspended) && this._basesNewItem) return closeBaseNewItem(this, { preserveOnFailure: true }).then(saved => saved ? this.setEnabled(enabled) : false);
    const active = enabled && !this.suspended;
    if (active) this.queryCache.document = null;
    for (const ref of this.refs) ref.unregister?.(); this.refs = [];
    this.settingsRef?.unregister(); this.settingsRef = null;
    this.typeRef?.unregister(); this.typeRef = null;
    clearTimeout(this.timer); ++this.sequence; this.enabled = active;
    if (!active) { this.disposeRender(); this.queryCache.entries?.clear(); this.queryCache.document = null; this.result = null; this.container.replaceChildren(); if (!enabled) this.warning('数据库核心插件已停用'); this.ready = Promise.resolve(); return; }
    const schedule = (file?) => {
      if (file?.path) this.queryCache.dirty.add(file.path); else this.queryCache.document = null;
      clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 70);
    };
    for (const event of ['create', 'modify', 'delete', 'rename']) this.refs.push(this.app.vault.on(event, schedule));
    this.refs.push(this.app.metadataCache.on('changed', schedule));
    this.settingsRef = this.app.workspace.on('settings-changed', () => schedule());
    this.typeRef = this.app.workspace.on('properties-type-change', () => {
      const editing = !!this.container.querySelector('.bases-cell-editor');
      this.queryCache.document = null; this.render();
      if (editing) this.warning('属性类型已变化，请重新编辑。');
    });
    this.ready = this.refresh();
  }
  setSuspended(suspended) {
    if (!!this.suspended === suspended) return;
    this.suspended = suspended;
    this.setEnabled(this.app.plugins.getInternalPlugin('bases')?.enabled !== false);
  }
  async refresh() {
    if (this.container.querySelector('.bases-cell-editor:not(:disabled)')) { this.pendingEditRefresh = true; return; }
    this.pendingEditRefresh = false;
    const sequence = ++this.sequence;
    try {
      const source = await this.app.vault.cachedRead(this.file);
      if (this.closed || !this.enabled || sequence !== this.sequence) return;
      if (this.document?.source !== source) this.document = new BaseDocument(source);
      if (!this.viewName) this.viewName = this.document.getView()?.name || '';
      this.render();
    } catch (error) { if (!this.closed && sequence === this.sequence) { this.container.replaceChildren(); this.warning('无法读取数据库：' + error.message); } }
  }
  warning(text) { return el(this.container, 'div', 'bases-warning', text); }
  get view() { return this.document?.getView(this.viewName); }
  patch(path, value) { return this.transact(current => current.patch(path, value)); }
  transact(action, onSaved = null) {
    const operation = transactBaseDocument(this.app, this.file, current => {
      if (this.closed || !this.enabled) return current;
      return action(current);
    }, onSaved);
    this.queue = operation.then(next => {
      if (!this.closed && this.enabled) { this.document = next; this.render(); }
      return next;
    }).catch(error => { if (!this.closed) this.warning('保存失败：' + error.message); });
    return this.queue;
  }
  viewIdentity() {
    const view = this.view;
    if (!view) throw Error('视图不存在。');
    if (!this.editIdentity || this.editIdentity.name !== view.name) this.editIdentity = { name: view.name };
    return this.editIdentity;
  }
  updateView(update) {
    const identity = this.viewIdentity(); let renamed = identity.name;
    return this.transact(current => {
      const { view, index } = resolveBaseView(current, identity);
      const result = update(current, view, index);
      renamed = result.data.views[index]?.name;
      return result;
    }, () => {
      if (renamed !== identity.name) {
        const selected = this.viewName === identity.name; identity.name = renamed;
        if (selected) { this.viewName = renamed; this.onViewChange?.(); }
      }
    });
  }
  patchView(key, value) {
    return this.updateView((current, view, index) => {
      if (key === 'name' && current.data.views.some((item, position) => position !== index && item.name === value)) throw Error('视图名称已存在。');
      return current.patch(['views', index, key], value);
    });
  }
  patchViewKey(key, property, value) {
    return this.updateView((current, view, index) => {
      const next = { ...(view[key] || {}) };
      if (value == null) delete next[property]; else next[property] = value;
      return current.patch(['views', index, key], next);
    });
  }
  reorderColumn(from, to) {
    return this.updateView((current, view, index) => {
      const order = [...(view.order || ['file.name'])], source = order.indexOf(from), target = order.indexOf(to);
      if (source < 0 || target < 0) throw Error('列已变化，请重新拖动。');
      order.splice(source, 1); order.splice(target, 0, from);
      return current.patch(['views', index, 'order'], order);
    });
  }
  switchView(name) {
    if (!this.document?.getView(name)) return;
    this.viewName = name; this.folded.clear(); this.render(); this.onViewChange?.();
  }
  closeConfig() { disposeBasesUI(this); this.container.querySelector('.bases-config-menu')?.remove(); }
  openConfig() { return openBasesConfig(this); }
  disposeRender() {
    disposeBaseEditing(this); disposeBasesUI(this); disposeBaseRichController(this);
    for (const handle of this.virtualizers) handle.destroy(); this.virtualizers.clear();
  }
  render() {
    if (this.closed || !this.enabled || !this.document) return;
    this.disposeRender();
    const root = this.container; root.replaceChildren();
    const view = this.view;
    if (!view) { this.warning(this.viewName ? '找不到视图：' + this.viewName : '未定义视图'); return; }
    const unknown = !Object.hasOwn(BASE_LAYOUTS, view.type);
    try { this.result = applyBaseSearch(this, queryBase(this.app, this.document, view, this.sourceFile, this.queryCache)); }
    catch (error) { this.warning('无法计算数据库：' + error.message); return; }
    renderBasesToolbar(this, el(root, 'div', 'bases-header'), { unknown });
    for (const warning of this.result.warnings) this.warning(warning);
    if (!unknown) renderBaseLayout(this);
  }
  openFilters(header) { return openBasesFilters(this, header?.querySelector?.('.bases-filter-button')); }
  destroy() {
    if (this.closed) return true;
    if (this._basesNewItem) return closeBaseNewItem(this, { preserveOnFailure: true }).then(saved => saved ? this.destroy() : false);
    this.disposeRender();
    this.closed = true; controllers.delete(this); ++this.sequence; clearTimeout(this.timer);
    this.typeRef?.unregister(); this.typeRef = null;
    for (const ref of this.refs) ref.unregister?.(); this.refs = [];
    this.settingsRef?.unregister(); this.settingsRef = null;
    this.queryCache.entries?.clear(); this.queryCache.document = null; this.result = null; this.document = null; this.onViewChange = null;
    this.container.replaceChildren(); return true;
  }
}
export function mountBaseEmbed(app: App, container, file, options: Record<string, any> = {}) {
  const controller = new BasesController(app, container, file, options);
  container.basesController = controller;
  let connected = container.isConnected;
  const observer = new MutationObserver(() => {
    if (container.isConnected) {
      connected = true;
      // 阅读视图切换模式时保留 DOM；隐藏期间释放数据订阅，重现后重读磁盘。
      const reading = container.closest('.markdown-reading-view');
      controller.setSuspended(!!reading && reading.style.display === 'none');
    }
    else if (connected) cleanup();
  });
  const cleanup = () => { observer.disconnect(); controller.destroy(); delete container.basesController; };
  observer.observe(container.ownerDocument.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  cleanup.ready = controller.ready;
  return cleanup;
}
export class BasesView extends View {
  declare file: any;
  declare navigation: boolean;
  declare icon: string;
  declare controller: any;

  constructor(leaf) { super(leaf); this.file = null; this.navigation = true; this.icon = 'lucide-layout-list'; this.controller = null; }
  getViewType() { return 'bases'; }
  getIcon() { return ({ table: 'lucide-table', list: 'lucide-list', cards: 'lucide-layout-grid', kanban: 'lucide-kanban-square' })[this.controller?.view?.type] || 'lucide-layout-list'; }
  getDisplayText() { return this.file?.basename || '数据库'; }
  getState() { return { file: this.file?.path, viewName: this.controller?.viewName || '' }; }
  async onOpen() {}
  async setState(state) {
    if (this.controller && !await closeBaseNewItem(this.controller)) return false;
    if (this.controller && await this.controller.destroy() === false) return false; this.controller = null;
    this.file = this.app.vault.getFileByPath(state?.file || '');
    if (this.file) { this.controller = new BasesController(this.app, this.contentEl, this.file, { viewName: state.viewName, onViewChange: () => this.app.saveLayout?.() }); await this.controller.ready; }
  }
  async save() { if (this.controller?._basesNewItem && !await this.controller._basesNewItem.flush()) return false; await this.controller?.queue; return true; }
  async onClose() { if (this.controller && !await closeBaseNewItem(this.controller)) return false; if (this.controller && await this.controller.destroy() === false) return false; this.controller = null; return true; }
}
