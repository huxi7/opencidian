/**
 * [INPUT]: View 生命周期、BaseDocument/queryBase、布局渲染器与视图配置弹层。
 * [OUTPUT]: 导出 BasesView、mountBaseEmbed 与插件启停同步函数；嵌入返回释放订阅的函数。
 * [POS]: Bases 文件与嵌入共用控制器。持有视图选择、组折叠与数据订阅。未知布局保留返回已支持视图的入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { tt } from '../core/i18n.js';
import { View } from '../core/view.js';
import { BaseDocument, queryBase } from './bases-model.js';
import { installBasesStyles } from './bases-styles.js';
import { BASE_LAYOUTS, renderBaseLayout, appendBaseElement as el } from './bases-layouts.js';
import { openBasesConfig } from './bases-config.js';

const controllers = new Set();
export function setBasesEnabled(app, enabled) {
  for (const controller of controllers) if (controller.app === app) controller.setEnabled(enabled);
}

export class BasesController {
  constructor(app, container, file, options = {}) {
    this.app = app; this.container = container; this.file = file; this.viewName = options.viewName || '';
    this.sourceFile = options.sourceFile || app.vault.getFileByPath(options.sourcePath || '') || file;
    this.onViewChange = options.onViewChange; this.folded = new Set();
    this.document = null; this.refs = []; this.closed = false; this.sequence = 0; this.queue = Promise.resolve();
    installBasesStyles(container.ownerDocument);
    container.classList.add('bases-embed');
    controllers.add(this);
    this.setEnabled(app.plugins.getInternalPlugin('bases')?.enabled !== false);
  }
  setEnabled(enabled) {
    if (this.closed) return;
    const active = enabled && !this.suspended;
    for (const ref of this.refs) ref.unregister?.(); this.refs = [];
    clearTimeout(this.timer); ++this.sequence; this.enabled = active;
    if (!active) { this.container.replaceChildren(); if (!enabled) this.warning('数据库核心插件已停用'); this.ready = Promise.resolve(); return; }
    const schedule = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 70); };
    for (const event of ['create', 'modify', 'delete', 'rename']) this.refs.push(this.app.vault.on(event, schedule));
    this.refs.push(this.app.metadataCache.on('changed', schedule));
    this.ready = this.refresh();
  }
  setSuspended(suspended) {
    if (!!this.suspended === suspended) return;
    this.suspended = suspended;
    this.setEnabled(this.app.plugins.getInternalPlugin('bases')?.enabled !== false);
  }
  async refresh() {
    const sequence = ++this.sequence;
    try {
      const source = await this.app.vault.cachedRead(this.file);
      if (this.closed || !this.enabled || sequence !== this.sequence) return;
      this.document = new BaseDocument(source); this.render();
    } catch (error) { if (!this.closed && sequence === this.sequence) { this.container.replaceChildren(); this.warning('无法读取数据库：' + error.message); } }
  }
  warning(text) { return el(this.container, 'div', 'bases-warning', text); }
  get view() { return this.document?.getView(this.viewName); }
  patch(path, value) {
    // 多窗口与外部编辑均以最新磁盘为起点，避免旧视图覆盖未知配置。
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (this.closed || !this.enabled) return;
      const current = new BaseDocument(await this.app.vault.read(this.file));
      if (this.closed || !this.enabled) return;
      const next = current.patch(path, value);
      await this.app.vault.modify(this.file, next.source);
      if (this.closed || !this.enabled) return;
      this.document = next; this.render();
    }).catch(error => { if (!this.closed) this.warning('保存失败：' + error.message); });
    return this.queue;
  }
  patchView(key, value) {
    const index = this.document.data.views.indexOf(this.view);
    return this.patch(['views', index, key], value);
  }
  switchView(name) {
    if (!this.document?.getView(name)) return;
    this.viewName = name; this.folded.clear(); this.render(); this.onViewChange?.();
  }
  closeConfig() { this.container.querySelector('.bases-config-menu')?.remove(); }
  openConfig() { return openBasesConfig(this); }
  render() {
    if (this.closed || !this.enabled || !this.document) return;
    const root = this.container; root.replaceChildren();
    const view = this.view;
    if (!view) { this.warning(this.viewName ? '找不到视图：' + this.viewName : '未定义视图'); return; }
    if (!Object.hasOwn(BASE_LAYOUTS, view.type)) {
      this.renderViewSwitcher(el(root, 'div', 'bases-header'), view);
      this.result = queryBase(this.app, this.document, view, this.sourceFile);
      for (const warning of this.result.warnings) this.warning(warning);
      return;
    }
    const header = el(root, 'div', 'bases-header');
    this.renderViewSwitcher(header, view);
    const configure = el(header, 'button', 'bases-config-button', tt('plugins.bases.label-configure-view', '配置视图'));
    configure.type = 'button'; configure.addEventListener('click', () => this.openConfig());
    const filter = el(header, 'button', 'bases-filter-button', '筛选');
    filter.type = 'button'; filter.addEventListener('click', () => this.openFilters(header));
    const limitLabel = el(header, 'label', 'bases-limit', '结果上限 ');
    const limit = el(limitLabel, 'input'); limit.type = 'number'; limit.min = '0'; limit.placeholder = '不限';
    limit.value = view.limit > 0 ? String(view.limit) : ''; limit.setAttribute('aria-label', '结果上限');
    limit.addEventListener('change', () => {
      const value = limit.value === '' ? 0 : Number(limit.value);
      if (!Number.isInteger(value) || value < 0) { limit.setCustomValidity('请输入非负整数'); limit.value = String(view.limit || ''); return; }
      this.patchView('limit', value);
    });
    try { this.result = queryBase(this.app, this.document, view, this.sourceFile); }
    catch (error) { this.warning('无法计算数据库：' + error.message); return; }
    for (const warning of this.result.warnings) this.warning(warning);
    renderBaseLayout(this);
    el(root, 'div', 'bases-results-count', '显示 ' + this.result.rows.length + (this.result.total > this.result.rows.length ? ' / ' + this.result.total : '') + ' 条结果');
  }
  renderViewSwitcher(header, view) {
    const switcher = el(header, 'select', 'bases-view-switcher'); switcher.setAttribute('aria-label', tt('plugins.bases.command-change-view', '切换视图'));
    for (const item of this.document.data.views) {
      const option = el(switcher, 'option', '', item.name); option.value = item.name;
    }
    switcher.value = view.name; switcher.addEventListener('change', () => this.switchView(switcher.value));
  }
  openFilters(header) {
    const existing = this.container.querySelector('.bases-filter-editor');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div'); panel.className = 'bases-filter-editor'; header.after(panel);
    el(panel, 'label', '', '全局筛选（YAML：字符串或 and / or / not）');
    const textarea = el(panel, 'textarea'); textarea.setAttribute('aria-label', '全局筛选');
    const yaml = require('js-yaml');
    textarea.value = this.document.data.filters === undefined ? '' : yaml.dump(this.document.data.filters, { lineWidth: -1 }).trimEnd();
    const message = el(panel, 'div', 'bases-filter-error');
    const apply = el(panel, 'button', '', '应用'); apply.type = 'button';
    apply.addEventListener('click', () => {
      try {
        const value = textarea.value.trim() ? yaml.load(textarea.value) : null;
        // 保存前验证，不把错误筛选写回文件。
        new BaseDocument(yaml.dump({ ...this.document.data, filters: value }));
        this.patch(['filters'], value);
      } catch (error) { message.textContent = error.message; }
    });
  }
  destroy() {
    this.closed = true; controllers.delete(this); ++this.sequence; clearTimeout(this.timer);
    for (const ref of this.refs) ref.unregister?.(); this.refs = [];
    this.container.replaceChildren();
  }
}
export function mountBaseEmbed(app, container, file, options = {}) {
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
  constructor(leaf) { super(leaf); this.file = null; this.navigation = true; this.icon = 'lucide-layout-list'; this.controller = null; }
  getViewType() { return 'bases'; }
  getIcon() { return ({ table: 'lucide-table', list: 'lucide-list', cards: 'lucide-layout-grid', kanban: 'lucide-kanban-square' })[this.controller?.view?.type] || 'lucide-layout-list'; }
  getDisplayText() { return this.file?.basename || '数据库'; }
  getState() { return { file: this.file?.path, viewName: this.controller?.viewName || '' }; }
  async onOpen() {}
  async setState(state) {
    this.controller?.destroy(); this.controller = null;
    this.file = this.app.vault.getFileByPath(state?.file || '');
    if (this.file) { this.controller = new BasesController(this.app, this.contentEl, this.file, { viewName: state.viewName, onViewChange: () => this.app.saveLayout?.() }); await this.controller.ready; }
  }
  async onClose() { this.controller?.destroy(); this.controller = null; }
}
