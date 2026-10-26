/**
 * [INPUT]: BasesController 的结果、属性类型、局部写回、切换与生命周期。
 * [OUTPUT]: 导出 renderBasesToolbar、openBasesFilters、applyBaseSearch 与 disposeBasesUI。
 * [POS]: 原版 Bases 工具栏的视图/结果/排序/分组/筛选/属性/搜索/新建入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BaseQueryRow, BaseQueryResult } from './bases-types.js';
import type { ReadyBasesController as BasesController, BasesController as BaseController } from './bases-view.js';
import { tt } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { propertyValue } from './bases-model.js';
import { formatBaseValue } from './bases-values.js';
import { BASE_LAYOUTS, propertyLabel } from './bases-layouts.js';
import { availableProperties, openBasesConfig } from './bases-config.js';
import { renderBasesFilterBuilder, baseFilterPropertyType } from './bases-ui-filters.js';
import { toggleBaseNewItem } from './bases-ui-new-item.js';
const tr = (key: string, fallback: string|undefined) => tt('plugins.bases.' + key, fallback);
const ICONS: Record<string, string> = { table: 'lucide-table', list: 'lucide-list', cards: 'lucide-layout-grid', kanban: 'lucide-kanban-square' };
function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string) {
  const node = parent.ownerDocument.createElement(tag); node.className = cls || '';
  if (text !== undefined) node.textContent = text; parent.appendChild(node); return node;
}
function icon(parent: HTMLElement, name: string, cls = 'text-button-icon') { const node = el(parent, 'span', cls); setIcon(node, name); return node; }
function button(parent: HTMLElement, text: string | undefined, glyph: string, action: (event: MouseEvent) => unknown, cls = '') {
  const node = el(parent, 'button', 'text-icon-button ' + cls); node.type = 'button'; node.setAttribute('aria-label', text || ''); node.title = text || '';
  if (glyph) icon(node, glyph); el(node, 'span', 'text-button-label', text);
  node.addEventListener('click', action); return node;
}
function select(parent: HTMLElement, label: string, entries: string[][], current: string, action: (value: string) => unknown) {
  const node = el(parent, 'select'); node.setAttribute('aria-label', label);
  for (const [id, name] of entries) { const option = el(node, 'option', '', name); option.value = id; }
  node.value = current; node.addEventListener('change', () => action(node.value)); return node;
}
export function disposeBasesUI(controller: BaseController) { controller._basesMenuAbort?.abort(); controller._basesMenuAbort = null; controller.container.querySelectorAll('.bases-filter-builder').forEach((node) => node.basesFilterDestroy?.()); }
function close(controller: BasesController) {
  controller._basesSortState = null;
  disposeBasesUI(controller); controller.container.querySelectorAll('.bases-config-menu').forEach((node) => node.remove());
  controller.container.querySelectorAll('.has-active-menu').forEach((node: { classList: { remove: (arg0: string) => void; }; setAttribute: (arg0: string,arg1: string) => void; }) => { node.classList.remove('has-active-menu'); node.setAttribute('aria-expanded', 'false'); });
}
function menu(controller: BasesController, anchor: HTMLElement | null | undefined, title: string|undefined, cls = '') {
  close(controller); const panel = el(controller.container, 'div', 'bases-config-menu bases-toolbar-menu ' + cls);
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title || '');
  const abort = controller._basesMenuAbort = new AbortController(), doc = panel.ownerDocument;
  const head = el(panel, 'div', 'bases-toolbar-menu-container-header'); el(head, 'div', 'menu-title', title);
  button(head, tt('interface.action-close', '关闭'), 'lucide-x', () => close(controller), 'close-icon');
  if (anchor) {
    anchor.classList.add('has-active-menu'); anchor.setAttribute('aria-expanded', 'true');
    const rootRect = controller.container.getBoundingClientRect(), rect = anchor.getBoundingClientRect();
    panel.style.top = rect.bottom - rootRect.top + controller.container.scrollTop + 4 + 'px';
    panel.style.left = Math.max(4, Math.min(rect.left - rootRect.left, rootRect.width - (cls.includes('filter') ? 520 : 300) - 4)) + 'px'; panel.style.right = 'auto';
  }
  doc.addEventListener('pointerdown', (event) => { if (!panel.contains(event.target instanceof Node ? event.target : null) && !anchor?.contains(event.target instanceof Node ? event.target : null)) close(controller); }, { signal: abort.signal });
  panel.addEventListener('keydown', (event: { key: string; preventDefault: () => void; }) => { if (event.key === 'Escape') { event.preventDefault(); close(controller); anchor?.focus(); } });
  return el(panel, 'div', 'menu-scroll');
}
export function openBasesFilters(controller: BasesController, anchor: HTMLElement | null | undefined) {
  const panel = menu(controller, anchor, tr('label-filter', '筛选'), 'bases-toolbar-filter-menu');
  const properties = availableProperties(controller);
  for (const [key, title, value] of [['global', tr('label-all-views', '所有视图'), controller.document.data.filters], ['view', tr('label-current-view', '当前视图'), controller.view.filters]] as Array<[string, string, unknown]>) {
    const section = el(panel, 'details', 'bases-toolbar-section'); section.open = key === 'view';
    el(section, 'summary', 'bases-toolbar-section-header', title);
    renderBasesFilterBuilder(el(section, 'div', 'bases-toolbar-section-content'), value, {
      properties, propertyType: (key: string) => baseFilterPropertyType(controller, key), onApply: (next) => key === 'global' ? controller.patch(['filters'], next) : controller.patchView('filters', next),
    });
  }
  return panel.parentElement;
}
function viewsMenu(controller: BasesController, anchor: HTMLElement | null | undefined) {
  const content = menu(controller, anchor, tr('label-views', '视图'), 'bases-views-page');
  const search = el(content, 'input', 'bases-menu-search'); search.type = 'search'; search.placeholder = tr('placeholder-search-views', '查找视图…'); search.setAttribute('aria-label', search.placeholder);
  const list = el(content, 'div', 'bases-toolbar-items suggestion-group'); list.dataset.group = 'views';
  for (const view of controller.document.data.views) {
    const row = el(list, 'div', 'bases-toolbar-menu-item'); row.dataset.view = view.name;
    const choose = button(row, view.name, ICONS[view.type] || 'lucide-layout-list', () => { close(controller); controller.switchView(view.name); });
    choose.setAttribute('aria-pressed', String(controller.view.name === view.name));
    if (Object.hasOwn(BASE_LAYOUTS, view.type)) button(row, tr('label-configure-view', '配置视图') + ' ' + view.name, 'lucide-settings-2', () => { close(controller); controller.switchView(view.name); openBasesConfig(controller); }, 'bases-view-settings');
  }
  search.addEventListener('input', () => { for (const row of list.querySelectorAll<HTMLElement>(':scope > *')) row.hidden = !(row.dataset.view || '').toLocaleLowerCase().includes(search.value.toLocaleLowerCase()); });
  button(content, tr('button-add-view', '添加视图'), 'lucide-plus', () => { close(controller); const panel = openBasesConfig(controller); panel.querySelector('.bases-add-view')?.scrollIntoView({ block: 'nearest' }); panel.querySelector<HTMLInputElement>('[aria-label="新视图名称"]')?.focus(); });
  search.focus({ preventScroll: true });
}
function resultMenu(controller: BasesController, anchor: HTMLElement | null | undefined) {
  const panel = menu(controller, anchor, tr('label-results', '结果'), 'bases-results-page');
  const row = el(panel, 'label', 'input-row bases-config-row', tr('label-limit', '结果上限'));
  const input = el(row, 'input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.placeholder = tr('placeholder-limit', '不限'); input.value = (controller.view.limit || 0) > 0 ? String(controller.view.limit) : ''; input.setAttribute('aria-label', '结果上限');
  input.addEventListener('change', () => {
    const value = input.value === '' ? 0 : Number(input.value);
    input.setCustomValidity(Number.isInteger(value) && value >= 0 ? '' : '请输入非负整数');
    if (input.checkValidity()) controller.patchView('limit', value);
  });
  button(panel, '重置结果上限', 'lucide-rotate-ccw', () => controller.patchView('limit', 0)); input.focus();
}
function sortMenu(controller: BasesController, anchor: HTMLElement, previous: NonNullable<BaseController['_basesSortState']> | null = null) {
  const state = previous?.viewName === controller.view.name ? previous : { viewName: controller.view.name, draft: (controller.view.sort || []).map((sort) => ({ ...sort })) };
  const content = menu(controller, anchor, tr('label-sort', '排序'), 'bases-sort-page');
  controller._basesSortState = state;
  const rows = el(content, 'div', 'bases-sort-container bases-toolbar-items');
  const props = [['', tr('label-sort-by', '选择属性')], ...availableProperties(controller).map(key => [key, propertyLabel(controller, key)])];
  const persist = () => controller.patchView('sort', state.draft.filter((sort) => sort.property || sort.column).map((sort) => ({ ...sort })));
  const draw = () => {
    rows.replaceChildren();
    state.draft.forEach((sort, index) => {
      const row = el(rows, 'div', 'base-toolbar-sort-item');
      select(row, '排序属性', props, sort.property || sort.column || '', (value) => { sort.property = value; delete sort.column; persist(); });
      select(row, '排序方向', [['ASC', tr('label-sort-a-z', '升序')], ['DESC', tr('label-sort-z-a', '降序')]], sort.direction || 'ASC', (value) => { sort.direction = value; persist(); }).disabled = !(sort.property || sort.column);
      button(row, '删除排序', 'lucide-x', () => { state.draft.splice(index, 1); draw(); persist(); });
    });
  };
  button(content, tr('label-add-sort', '添加排序'), 'lucide-plus', () => { state.draft.push({ property: '', direction: 'ASC' }); draw(); rows.lastElementChild?.querySelector('select')?.focus(); }); draw();
}
function groupMenu(controller: BasesController, anchor: HTMLElement | null | undefined) {
  const content = menu(controller, anchor, tr('label-group', '分组'), 'bases-group-page');
  const row = el(content, 'label', 'bases-config-row', tr('label-group-by', '分组依据'));
  const props = [['', tr('list.option-none', '无')], ...availableProperties(controller).map(key => [key, propertyLabel(controller, key)])];
  select(row, '分组属性', props, controller.view.groupBy?.property || '', async (property) => {
    if (controller.view.groupOrder) await controller.patchView('groupOrder', null);
    await controller.patchView('groupBy', property ? { property, direction: 'ASC' } : null);
  });
  if (controller.view.groupBy) select(content, '分组方向', [['ASC', '升序'], ['DESC', '降序']], controller.view.groupBy.direction || 'ASC', (direction) => controller.patchView('groupBy', { ...controller.view.groupBy, direction }));
  button(content, '编辑分组', 'lucide-settings-2', () => { close(controller); openBasesConfig(controller).querySelector('.bases-group-config')?.scrollIntoView({ block: 'nearest' }); });
}
function propertiesMenu(controller: BasesController, anchor: HTMLElement | null | undefined) {
  const content = menu(controller, anchor, tr('label-properties', '属性'), 'bases-properties-page');
  const search = el(content, 'input', 'bases-menu-search'); search.type = 'search'; search.placeholder = tr('placeholder-search-property', '查找属性…'); search.setAttribute('aria-label', search.placeholder);
  const list = el(content, 'div', 'bases-toolbar-items');
  for (const property of availableProperties(controller)) {
    const row = el(list, 'label', 'bases-property-toggle bases-toolbar-menu-item'); row.dataset.property = property;
    const check = el(row, 'input'); check.type = 'checkbox'; check.checked = controller.result.columns.includes(property); check.setAttribute('aria-label', '显示属性 ' + property);
    icon(row, property.startsWith('file.') ? 'lucide-file' : property.startsWith('formula.') ? 'lucide-function-square' : 'lucide-text');
    el(row, 'span', 'bases-toolbar-menu-item-name', propertyLabel(controller, property));
    check.addEventListener('change', () => controller.patchView('order', check.checked ? [...controller.result.columns.filter((key: string) => key !== property), property] : controller.result.columns.filter((key: string) => key !== property)));
  }
  search.addEventListener('input', () => { for (const row of list.querySelectorAll<HTMLElement>(':scope > *')) row.hidden = !(row.textContent || '').toLocaleLowerCase().includes(search.value.toLocaleLowerCase()); }); search.focus();
}
export function applyBaseSearch(controller: BaseController, result: BaseQueryResult): BaseQueryResult {
  const search = controller.searchQuery?.trim().toLocaleLowerCase();
  if (!search) return result;
  return { ...result, rows: result.rows.filter((row: BaseQueryRow) => result.columns.some((property: string) => {
    try { return formatBaseValue(propertyValue(row.context, property)).toLocaleLowerCase().includes(search); } catch { return false; }
  })) };
}
export function renderBasesToolbar(controller: BasesController, header: HTMLElement, options: { unknown?: boolean } = {}) {
  disposeBasesUI(controller); const view = controller.view;
  const toolbar = el(header, 'div', 'bases-toolbar');
  const item = (cls: string, label: string|undefined, glyph: string, action: (node: HTMLButtonElement) => unknown) => {
    const wrap = el(toolbar, 'div', 'bases-toolbar-item ' + cls);
    let node: HTMLButtonElement; node = button(wrap, label, glyph, () => action(node)); node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-expanded', 'false'); return node;
  };
  const switcher = item('bases-toolbar-views-menu', view.name, ICONS[view.type] || 'lucide-layout-list', (node) => viewsMenu(controller, node));
  switcher.classList.add('bases-view-switcher'); icon(switcher, 'lucide-chevrons-up-down', 'text-button-icon mod-aux');
  switcher.addEventListener('contextmenu', (event: { preventDefault: () => void; }) => { if (Object.hasOwn(BASE_LAYOUTS, view.type)) { event.preventDefault(); openBasesConfig(controller); } });
  const count = controller.result?.rows.length || 0;
  const result = item('bases-toolbar-results-menu bases-toolbar-result-count', tt('nouns.result-with-count', `${count} 条结果`, { count }), 'lucide-text-align-start', (node) => resultMenu(controller, node));
  result.classList.toggle('is-active', !!view.limit && (controller.result?.total || 0) > count);
  if (options.unknown) { toolbar.querySelector('.bases-toolbar-result-count')?.remove(); return toolbar; }
  const sort = item('bases-toolbar-sort-menu', tr('label-sort', '排序'), 'lucide-arrow-up-down', (node: HTMLButtonElement) => sortMenu(controller, node));
  sort.classList.toggle('is-active', !!view.sort?.length);
  item('bases-toolbar-group-menu', tr('label-group', '分组'), 'lucide-stretch-horizontal', (node) => groupMenu(controller, node)).classList.toggle('is-active', !!view.groupBy);
  const filter = item('bases-toolbar-filter-menu', tr('label-filter', '筛选'), 'lucide-list-filter', (node) => openBasesFilters(controller, node)); filter.classList.add('bases-filter-button');
  filter.classList.toggle('is-active', !!view.filters || !!controller.document.data.filters);
  item('bases-toolbar-properties-menu', tr('label-properties', '属性'), 'list', (node) => propertiesMenu(controller, node));
  item('bases-toolbar-search', tr('label-search', '搜索'), 'lucide-search', (node: HTMLButtonElement) => {
    close(controller); const row = controller.container.querySelector<HTMLElement>('.bases-search-row'); if (!row) return; row.hidden = !row.hidden; controller.searchOpen = !row.hidden; node.classList.toggle('is-active', !row.hidden); if (!row.hidden) row.querySelector('input')?.focus();
  });
  item('bases-toolbar-new-item-menu', tr('label-new-item', '新建'), 'lucide-plus', (node) => { close(controller); toggleBaseNewItem(controller, node); });
  const searchRow = el(controller.container, 'div', 'bases-search-row'); searchRow.hidden = !controller.searchOpen && !controller.searchQuery;
  const input = el(searchRow, 'input', 'document-search-input'); input.type = 'search'; input.placeholder = tr('label-search', '搜索'); input.setAttribute('aria-label', '搜索数据库'); input.value = controller.searchQuery || '';
  input.addEventListener('input', () => { const position = input.selectionStart; controller.searchQuery = input.value; controller.render(); const next = controller.container.querySelector<HTMLInputElement>('.bases-search-row input'); next?.focus(); if (next && position != null) { try { next.setSelectionRange(position, position); } catch {} } });
  input.addEventListener('keydown', (event: { key: string; preventDefault: () => void; }) => { if (event.key === 'Escape') { event.preventDefault(); controller.searchQuery = ''; controller.searchOpen = false; controller.render(); } });
  if (controller._basesSortState?.viewName === view.name) sortMenu(controller, sort, controller._basesSortState);
  else controller._basesSortState = null;
  return toolbar;
}
