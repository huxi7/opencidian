/**
 * [INPUT]: BasesController 查询、分组汇总、富值、编辑、组层与记录窗口化及锚定新建浮层。
 * [OUTPUT]: 导出 renderBaseLayout、renderBaseValue、BASE_LAYOUTS 与 appendBaseElement。
 * [POS]: 四种 Bases 布局共用值渲染与笔记导航；不拥有数据订阅或持久化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BaseQueryRow } from './bases-types.js';
import type { ReadyBasesController as BasesController } from './bases-view.js';
import { tt } from '../core/i18n.js';
import { propertyValue } from './bases-model.js';
import { renderBaseRichValue } from './bases-values-render.js';
import { groupRows, summarizeRows, formatBaseValue } from './bases-grouping.js';
import { renderBaseCover } from './bases-card-media.js';
import { mountBaseVirtualRows, mountBaseVirtualGrid } from './bases-virtual.js';
import { mountBaseGroupWindow } from './bases-ui-group-window.js';
import { toggleBaseNewItem } from './bases-ui-new-item.js';
import { setIcon } from '../core/icons.js';
import { renderBaseAddGroup } from './bases-edit-groups.js';
import { bindBaseCell, bindBaseColumn } from './bases-edit-cells.js';
import { bindKanbanCard, bindKanbanColumn, kanbanWriteInfo } from './bases-kanban.js';

export const BASE_LAYOUTS = {
  get table() { return tt('plugins.bases.table.name', '表格'); },
  get list() { return tt('plugins.bases.list.name', '列表'); },
  get cards() { return tt('plugins.bases.cards.name', '卡片'); },
  get kanban() { return tt('plugins.bases.kanban.name', '看板'); },
};
export function appendBaseElement<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string) {
  const node = parent.ownerDocument.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node); return node;
}
const el = appendBaseElement;
export function propertyLabel(controller: BasesController, property: string) {
  return controller.document.data.properties?.[property]?.displayName || property.replace(/^note\./, '');
}
export function renderBaseValue(controller: BasesController, parent: HTMLElement, row: BaseQueryRow, property: string) {
  try {
    const value = propertyValue(row.context, property);
    if (['file', 'file.file', 'file.name', 'file.basename', 'file.fullname', 'file.path'].includes(property)) {
      const link = el(parent, 'a', 'internal-link bases-rendered-value', formatBaseValue(value));
      link.href = '#'; link.dataset.href = row.file.path;
      link.addEventListener('click', (event) => { event.preventDefault(); controller.app.workspace.openFile(row.file, { newLeaf: event.metaKey || event.ctrlKey ? 'tab' : false }); });
      return link;
    }
    return renderBaseRichValue(controller, parent, value, row.file.path);
  } catch (error) { return el(parent, 'div', 'bases-warning', (error instanceof Error ? error.message : String(error))); }
}
function summaryText(controller: BasesController, rows: BaseQueryRow[], property: string) {
  const name = controller.view.summaries?.[property];
  if (!name) return '';
  try { return name + ': ' + formatBaseValue(summarizeRows(rows, property, name, controller.document)); }
  catch (error) { return (error instanceof Error ? error.message : String(error)); }
}
function renderSummaries(controller: BasesController, parent: HTMLElement, rows: BaseQueryRow[], columns: string[]) {
  if (!controller.view.summaries) return;
  const footer = el(parent, 'div', 'bases-summary');
  for (const property of columns) {
    if (controller.view.summaries[property]) {
      const summary = el(footer, 'span', 'bases-summary-value', propertyLabel(controller, property) + ' · ' + summaryText(controller, rows, property));
      summary.dataset.property = property;
    }
  }
}
function renderTable(controller: BasesController, parent: HTMLElement, rows: BaseQueryRow[], columns: string[]) {
  const view = controller.view;
  const wrap = el(parent, 'div', 'bases-table-container');
  const heights: Record<string, number> = { medium: 2, tall: 4, extra: 8 };
  const multiplier = heights[view.rowHeight || ''] || 1;
  const baseHeight = parseFloat(parent.ownerDocument.defaultView?.getComputedStyle(parent).getPropertyValue('--bases-table-row-height') || '') || 30;
  const rowHeight = baseHeight * multiplier;
  wrap.style.setProperty('--bases-table-current-row-height', rowHeight + 'px'); wrap.classList.toggle('mod-multiline', multiplier > 1);
  const table = el(wrap, 'table', 'bases-table');
  const head = el(el(table, 'thead', 'bases-thead'), 'tr', 'bases-tr');
  for (const property of columns) {
    const cell = el(head, 'th', 'bases-td'); cell.scope = 'col';
    bindBaseColumn(controller, cell, property);
    const button = el(cell, 'button', 'bases-table-header', propertyLabel(controller, property));
    const active = view.sort?.find((sort) => (sort.property || sort.column) === property);
    if (active) { button.dataset.sort = active.direction; el(button, 'span', 'bases-sort-indicator', active.direction === 'DESC' ? ' ↓' : ' ↑'); }
    button.addEventListener('click', () => {
      const sorts = (view.sort || []).filter((sort) => (sort.property || sort.column) !== property);
      if (!active || active.direction !== 'DESC') sorts.unshift({ property, direction: active?.direction === 'ASC' ? 'DESC' : 'ASC' });
      controller.patchView('sort', sorts);
    });
  }
  const body = el(table, 'tbody', 'bases-tbody');
  const virtual = mountBaseVirtualRows(body, rows, (row: BaseQueryRow) => {
    const tr = body.ownerDocument.createElement('tr'); tr.className = 'bases-tr'; tr.dataset.path = row.file.path; tr.style.height = rowHeight + 'px';
    for (const property of columns) {
      const cell = el(tr, 'td', 'bases-td');
      const width = view.columnSize?.[property];
      if (typeof width === 'number' && Number.isFinite(width) && width > 0) { cell.style.width = width + 'px'; cell.style.minWidth = width + 'px'; }
      const value = el(cell, 'div', 'bases-table-cell');
      renderBaseValue(controller, value, row, property); bindBaseCell(controller, cell, row, property);
    }
    return tr;
  }, { viewport: wrap, columns: columns.length, rowHeight });
  controller.virtualizers.add(virtual);
  if (view.summaries) {
    const tr = el(el(table, 'tfoot', 'bases-summary'), 'tr', 'bases-tr');
    for (const property of columns) {
      const cell = el(tr, 'td', 'bases-td bases-summary-value', summaryText(controller, rows, property)); cell.dataset.property = property;
    }
  }
}
function renderList(controller: BasesController, parent: HTMLElement, rows: BaseQueryRow[], columns: string[]) {
  const view = controller.view, list = el(parent, 'div', 'bases-list-group-list');
  const virtual = mountBaseVirtualGrid(list, rows, (row: BaseQueryRow, index: number) => {
    const item = list.ownerDocument.createElement('div'); item.className = 'bases-list-item'; item.dataset.path = row.file.path;
    const properties = el(item, 'div', 'bases-list-item-properties');
    const nested = view.indentProperties ? el(item, 'div', 'bases-list-item-properties nested') : properties;
    if (view.markers !== 'none') el(properties, 'span', view.markers === 'number' ? 'list-number' : 'list-bullet', view.markers === 'number' ? (index + 1) + '.' : '•');
    columns.forEach((property: string, column: number) => {
      let value;
      try { value = propertyValue(row.context, property); } catch { renderBaseValue(controller, el(column > 0 ? nested : properties, 'span', 'bases-list-property'), row, property); return; }
      if (value == null || value === '' || Array.isArray(value) && !value.length) return;
      const owner = column > 0 ? nested : properties;
      if (column > 0 && !view.indentProperties) el(owner, 'span', 'bases-list-separator', String(view.separator || ', '));
      renderBaseValue(controller, el(owner, 'span', 'bases-list-property'), row, property);
    });
    return item;
  }, { viewport: list, columns: 1, gap: 0, estimatedHeight: 30 });
  controller.virtualizers.add(virtual);
  renderSummaries(controller, parent, rows, columns);
}
function renderCards(controller: BasesController, parent: HTMLElement, rows: BaseQueryRow[], columns: string[], kanban: boolean|undefined) {
  const cards = el(parent, 'div', kanban ? 'bases-kanban-column-content' : 'bases-cards-group');
  const size = kanban ? controller.view.columnWidth : controller.view.cardSize;
  if (typeof size === 'number' && Number.isFinite(size) && size >= 100 && size <= 1000) cards.style.setProperty('--bases-card-width', size + 'px');
  const virtual = mountBaseVirtualGrid(cards, rows, (row: BaseQueryRow) => {
    const card = cards.ownerDocument.createElement('article'); card.className = kanban ? 'bases-kanban-item bases-cards-item' : 'bases-cards-item'; card.dataset.path = row.file.path;
    renderBaseCover(controller, card, row, kanban);
    if (kanban) bindKanbanCard(controller, card, row);
    for (const [index, property] of columns.entries()) {
      const prop = el(card, 'div', 'bases-cards-property' + (index ? '' : ' mod-title'));
      if (index) el(prop, 'div', 'bases-cards-label', propertyLabel(controller, property));
      renderBaseValue(controller, prop, row, property);
    }
    return card;
  }, { viewport: cards, cardWidth: size || 200, columns: kanban ? 1 : undefined, estimatedHeight: kanban ? 160 : 180, gap: kanban ? 8 : 12 });
  controller.virtualizers.add(virtual);
  renderSummaries(controller, parent, rows, columns);
}
export function renderBaseLayout(controller: BasesController) {
  const { rows, columns } = controller.result, view = controller.view, root = controller.container;
  if (view.type === 'kanban' && !view.groupBy) {
    const placeholder = el(root, 'div', 'bases-kanban-placeholder');
    el(placeholder, 'div', 'bases-kanban-placeholder-title', tt('plugins.bases.kanban.title-no-group-by', '添加列'));
    el(placeholder, 'div', 'bases-kanban-placeholder-text', tt('plugins.bases.kanban.text-no-group-by', '选择用于分组的属性。'));
    const button = el(placeholder, 'button', '', tt('plugins.bases.kanban.action-choose-property', '选择属性')); button.addEventListener('click', () => controller.openConfig()); return;
  }
  let groups;
  try { groups = groupRows(rows, view); }
  catch (error) { controller.warning((error instanceof Error ? error.message : String(error))); return; }
  const layout = el(root, 'div', 'bases-' + view.type + '-container');
  if (!groups.length && view.type === 'kanban') {
    const placeholder = el(layout, 'div', 'bases-kanban-placeholder');
    el(placeholder, 'div', 'bases-kanban-placeholder-title', tt('plugins.bases.kanban.title-no-columns', '没有列'));
    el(placeholder, 'div', 'bases-kanban-placeholder-text', tt('plugins.bases.kanban.text-no-columns', '选择显示为列的分组。'));
    const configure = el(placeholder, 'button', '', tt('plugins.bases.kanban.action-edit-columns', '编辑分组'));
    configure.addEventListener('click', () => controller.openConfig());
  }
  mountBaseGroupWindow(controller, layout, groups, (group) => {
    const section = layout.ownerDocument.createElement('section'); section.className = view.type === 'kanban' ? 'bases-kanban-column' : 'bases-' + view.type + '-section';
    if (view.type === 'kanban') bindKanbanColumn(controller, section, group);
    if (view.type === 'kanban' && typeof view.columnWidth === 'number' && Number.isFinite(view.columnWidth) && view.columnWidth >= 100 && view.columnWidth <= 1000) section.style.setProperty('--bases-card-width', view.columnWidth + 'px');
    if (group.grouped) {
      const heading = el(section, 'div', 'bases-group-heading');
      heading.setAttribute('role', 'button'); heading.tabIndex = 0; heading.dataset.group = group.id;
      el(heading, 'span', 'bases-group-property', propertyLabel(controller, (view.groupBy?.property || '')));
      el(heading, 'span', 'bases-group-value', group.key == null ? tt('plugins.bases.label-group-key-none', '无') : formatBaseValue(group.key));
      el(heading, 'span', 'bases-group-count', String(group.rows.length));
      heading.setAttribute('aria-expanded', String(!controller.folded.has(group.id)));
      const fold = () => { controller.folded.has(group.id) ? controller.folded.delete(group.id) : controller.folded.add(group.id); controller.render(); };
      heading.addEventListener('click', (event) => { if (!(event.target instanceof Element && event.target.closest('.bases-group-new-item'))) fold(); });
      heading.addEventListener('keydown', (event) => { if (event.target === heading && ['Enter', ' '].includes(event.key)) { event.preventDefault(); fold(); } });
      if (kanbanWriteInfo(controller, group.rows[0], (view.groupBy?.property || '')).writable) {
        const create = el(heading, 'button', 'clickable-icon bases-group-new-item'); create.type = 'button'; create.setAttribute('aria-label', '在分组中新建笔记'); setIcon(create, 'lucide-plus');
        create.addEventListener('click', (event: { stopPropagation: () => void; }) => { event.stopPropagation(); toggleBaseNewItem(controller, create, group.key, true); });
      }
    }
    const body = el(section, 'div', 'bases-group-body'); body.hidden = controller.folded.has(group.id);
    if (view.type === 'table') renderTable(controller, body, group.rows, columns);
    else if (view.type === 'list') renderList(controller, body, group.rows, columns);
    else renderCards(controller, body, group.rows, columns, view.type === 'kanban');
    return section;
  });
  renderBaseAddGroup(controller, groups.length > 20 ? el(root, 'div', 'bases-group-actions') : layout);
  if (!rows.length) el(layout, 'div', 'bases-empty', '没有符合条件的笔记');
  if (view.type === 'kanban') {
    const unsupported = [kanbanWriteInfo(controller), ...rows.map((row: BaseQueryRow) => kanbanWriteInfo(controller, row))].find(info => !info.writable);
    if (unsupported) controller.warning(unsupported.reason);
  }
}
