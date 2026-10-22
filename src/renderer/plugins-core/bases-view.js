/**
 * [INPUT]: View 生命周期、BaseDocument 与 queryBase、数据库样式安装器与富值 DOM 适配器。
 * [OUTPUT]: 导出 BasesView、mountBaseEmbed 与插件启停同步函数；嵌入返回释放订阅的函数。
 * [POS]: Bases 文件与笔记嵌入共用的渲染器。文件变化重读磁盘，关闭撤销订阅。查询的 this 读取数据库或嵌入宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { View } from '../core/view.js';
import { formatBaseValue as format } from './bases-values.js';
import { renderBaseRichValue } from './bases-values-render.js';
import { BaseDocument, queryBase, propertyValue } from './bases-model.js';
import { installBasesStyles } from './bases-styles.js';

const controllers = new Set();
export function setBasesEnabled(app, enabled) {
  for (const controller of controllers) if (controller.app === app) controller.setEnabled(enabled);
}

function el(parent, tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node); return node;
}
export class BasesController {
  constructor(app, container, file, options = {}) {
    this.app = app; this.container = container; this.file = file; this.viewName = options.viewName || '';
    this.sourceFile = options.sourceFile || app.vault.getFileByPath(options.sourcePath || '') || file;
    this.document = null; this.refs = []; this.closed = false; this.sequence = 0; this.queue = Promise.resolve();
    installBasesStyles(container.ownerDocument);
    container.classList.add('bases-embed');
    controllers.add(this);
    this.setEnabled(app.plugins.getInternalPlugin('bases')?.enabled !== false);
  }
  setEnabled(enabled) {
    for (const ref of this.refs) ref.unregister?.(); this.refs = [];
    clearTimeout(this.timer); ++this.sequence; this.enabled = enabled;
    if (!enabled) { this.container.replaceChildren(); this.warning('数据库核心插件已停用'); this.ready = Promise.resolve(); return; }
    const schedule = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 70); };
    for (const event of ['create', 'modify', 'delete', 'rename']) this.refs.push(this.app.vault.on(event, schedule));
    this.refs.push(this.app.metadataCache.on('changed', schedule));
    this.ready = this.refresh();
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
      const next = current.patch(path, value);
      await this.app.vault.modify(this.file, next.source);
      this.document = next; this.render();
    }).catch(error => { if (!this.closed) this.warning('保存失败：' + error.message); });
    return this.queue;
  }
  patchView(key, value) {
    const index = this.document.data.views.indexOf(this.view);
    return this.patch(['views', index, key], value);
  }
  render() {
    if (this.closed || !this.enabled || !this.document) return;
    const root = this.container; root.replaceChildren();
    const view = this.view;
    if (!view) { this.warning(this.viewName ? '找不到视图：' + this.viewName : '未定义视图'); return; }
    if (view.type !== 'table') {
      this.result = queryBase(this.app, this.document, view, this.sourceFile);
      for (const warning of this.result.warnings) this.warning(warning);
      return;
    }
    const header = el(root, 'div', 'bases-header');
    el(header, 'span', 'bases-view-name', view.name);
    const filter = el(header, 'button', 'bases-filter-button', '筛选');
    filter.type = 'button'; filter.addEventListener('click', () => this.openFilters(header));
    const limitLabel = el(header, 'label', 'bases-limit', '结果上限 ');
    const limit = el(limitLabel, 'input'); limit.type = 'number'; limit.min = '0'; limit.placeholder = '不限';
    limit.value = view.limit > 0 ? String(view.limit) : '';
    limit.setAttribute('aria-label', '结果上限');
    limit.addEventListener('change', () => {
      const value = limit.value === '' ? 0 : Number(limit.value);
      if (!Number.isInteger(value) || value < 0) { limit.setCustomValidity('请输入非负整数'); limit.value = String(view.limit || ''); return; }
      this.patchView('limit', value);
    });
    let result;
    try { result = queryBase(this.app, this.document, view, this.sourceFile); }
    catch (error) { this.warning('无法计算数据库：' + error.message); return; }
    this.result = result;
    for (const warning of result.warnings) this.warning(warning);
    if (view.type !== 'table') return;
    if (view.groupBy || view.summaries) this.warning('分组和汇总尚未实现；当前显示平铺表格，原始配置已保留。');
    const wrap = el(root, 'div', 'bases-table-container');
    const table = el(wrap, 'table', 'bases-table');
    const head = el(el(table, 'thead', 'bases-thead'), 'tr', 'bases-tr');
    for (const property of result.columns) {
      const label = this.document.data.properties?.[property]?.displayName || property.replace(/^note\./, '');
      const cell = el(head, 'th', 'bases-td'); cell.scope = 'col';
      const button = el(cell, 'button', 'bases-table-header', label);
      const active = view.sort?.find(sort => (sort.property || sort.column) === property);
      if (active) { button.setAttribute('data-sort', active.direction); el(button, 'span', 'bases-sort-indicator', active.direction === 'DESC' ? ' ↓' : ' ↑'); }
      button.addEventListener('click', () => {
        const sorts = (view.sort || []).filter(sort => (sort.property || sort.column) !== property);
        if (!active || active.direction !== 'DESC') sorts.unshift({ property, direction: active?.direction === 'ASC' ? 'DESC' : 'ASC' });
        this.patchView('sort', sorts);
      });
    }
    const body = el(table, 'tbody', 'bases-tbody');
    for (const row of result.rows) {
      const tr = el(body, 'tr', 'bases-tr'); tr.dataset.path = row.file.path;
      for (const property of result.columns) {
        const cell = el(tr, 'td', 'bases-td');
        try {
          const value = propertyValue(row.context, property);
          if (['file', 'file.file', 'file.name', 'file.basename', 'file.fullname', 'file.path'].includes(property)) {
            const link = el(cell, 'a', 'internal-link bases-rendered-value', format(value)); link.href = '#'; link.dataset.href = row.file.path;
            link.addEventListener('click', event => { event.preventDefault(); this.app.workspace.openFile(row.file, { newLeaf: event.metaKey || event.ctrlKey ? 'tab' : false }); });
          } else renderBaseRichValue(this, cell, value, row.file.path);
        } catch (error) { el(cell, 'div', 'bases-warning', error.message); }
      }
    }
    if (!result.rows.length && !result.warnings.length) el(wrap, 'div', 'bases-empty', '没有符合条件的笔记');
    el(root, 'div', 'bases-results-count', '显示 ' + result.rows.length + (result.total > result.rows.length ? ' / ' + result.total : '') + ' 条结果');
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
    if (container.isConnected) connected = true;
    else if (connected) cleanup();
  });
  const cleanup = () => { observer.disconnect(); controller.destroy(); delete container.basesController; };
  observer.observe(container.ownerDocument.body, { childList: true, subtree: true });
  cleanup.ready = controller.ready;
  return cleanup;
}
export class BasesView extends View {
  constructor(leaf) { super(leaf); this.file = null; this.navigation = true; this.icon = 'lucide-layout-list'; this.controller = null; }
  getViewType() { return 'bases'; }
  getIcon() { return this.controller?.view?.type === 'table' ? 'lucide-table' : 'lucide-layout-list'; }
  getDisplayText() { return this.file?.basename || '数据库'; }
  getState() { return { file: this.file?.path, viewName: this.controller?.viewName || '' }; }
  async onOpen() {}
  async setState(state) {
    this.controller?.destroy(); this.controller = null;
    this.file = this.app.vault.getFileByPath(state?.file || '');
    if (this.file) { this.controller = new BasesController(this.app, this.contentEl, this.file, { viewName: state.viewName }); await this.controller.ready; }
  }
  async onClose() { this.controller?.destroy(); this.controller = null; }
}
