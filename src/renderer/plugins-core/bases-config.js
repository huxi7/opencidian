/**
 * [INPUT]: BasesController 局部写回、布局汇总清单、封面选项与可视筛选构造器。
 * [OUTPUT]: 导出 openBasesConfig 与 availableProperties，返回原版结构的视图配置页。
 * [POS]: 配置只提交用户操作的键。选择由成功事务更新；拒写保留当前视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { tt } from '../core/i18n.js';
import { BASE_LAYOUTS, appendBaseElement as el, propertyLabel } from './bases-layouts.js';
import { groupRows, summaryNamesFor } from './bases-grouping.js';
import { baseEquals, formatBaseValue } from './bases-values.js';
import { exportBaseCsv } from './bases-csv.js';
import { setIcon } from '../core/icons.js';
import { renderBasesFilterBuilder, baseFilterPropertyType } from './bases-ui-filters.js';

const tr = (key, fallback) => tt('plugins.bases.' + key, fallback);

function select(parent, label, options, value, action) {
  const row = el(parent, 'label', 'bases-config-row input-row', label);
  const control = el(row, 'select'); control.setAttribute('aria-label', label);
  for (const [key, text] of options) { const option = el(control, 'option', '', text); option.value = key; }
  control.value = value; control.addEventListener('change', () => action(control.value)); return control;
}
function input(parent, label, value, action, type = 'text') {
  const row = el(parent, 'label', 'bases-config-row input-row', label);
  const control = el(row, 'input'); control.type = type; control.value = value;
  control.setAttribute('aria-label', label); control.addEventListener('change', () => { control.setCustomValidity(''); action(control.value, control); }); return control;
}
export function availableProperties(controller) {
  const properties = new Set(['file.name', 'file.file', 'file.path', 'file.folder', 'file.ext', 'file.size', 'file.ctime', 'file.mtime']);
  for (const key of controller.result.columns) properties.add(key);
  for (const file of controller.app.vault.getMarkdownFiles()) {
    const frontmatter = controller.app.metadataCache.getFileCache(file)?.frontmatter || {};
    for (const key of Object.keys(frontmatter)) if (key !== 'position') properties.add('note.' + key);
  }
  for (const key of Object.keys(controller.document.data.formulas || {})) properties.add('formula.' + key);
  return [...properties];
}
export function openBasesConfig(controller) {
  controller._basesSortState = null;
  controller.container.querySelectorAll('.bases-filter-builder').forEach(node => node.basesFilterDestroy?.());
  controller._basesMenuAbort?.abort(); controller._basesMenuAbort = null;
  controller.closeConfig();
  controller.container.querySelectorAll('.has-active-menu').forEach(node => { node.classList.remove('has-active-menu'); node.setAttribute('aria-expanded', 'false'); });
  const root = controller.container, view = controller.view;
  const panel = el(root, 'div', 'bases-config-menu bases-toolbar-menu bases-toolbar-menu-form view-config-menu'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', tr('label-configure-view', '配置视图'));
  const title = el(panel, 'div', 'bases-config-title bases-toolbar-menu-container-header');
  el(title, 'span', 'menu-title', tr('label-configure-view', '配置视图'));
  const close = el(title, 'button', 'clickable-icon close-icon'); close.type = 'button'; close.setAttribute('aria-label', tt('interface.action-close', '关闭')); setIcon(close, 'lucide-x'); close.addEventListener('click', () => controller.closeConfig());
  const csv = el(panel, 'button', 'bases-export-csv'); csv.type = 'button';
  setIcon(el(csv, 'span', 'bases-export-icon'), 'lucide-file-down');
  el(csv, 'span', '', tr('action-export-c-s-v', '导出 CSV…'));
  csv.addEventListener('click', () => exportBaseCsv(controller));
  const error = el(panel, 'div', 'bases-filter-error'); error.setAttribute('role', 'status');
  const properties = availableProperties(controller), propertyOptions = properties.map(key => [key, propertyLabel(controller, key)]);
  input(panel, tr('label-view-name', '视图名称'), view.name, async (value, control) => {
    const name = value.trim();
    if (!name || /[\[\]#|^\\]/.test(name)) { control.setCustomValidity('名称不能为空或含有 []#|^\\'); error.textContent = control.validationMessage; return; }
    if (controller.document.data.views.some(other => other !== view && other.name === name)) { error.textContent = tr('msg-duplicate-view-name', '视图名称已存在'); return; }
    const saved = await controller.patchView('name', name);
    if (!saved) { control.value = controller.view?.name || view.name; control.setCustomValidity('视图名称未保存，请查看保存失败提示。'); error.textContent = control.validationMessage; }
    // 成功后的选择与布局同步由控制器事务完成；拒写时不改变当前视图。
  });
  select(panel, tr('label-view-layout', '布局'), Object.entries(BASE_LAYOUTS), view.type, type => controller.patchView('type', type)).dataset.configField = 'type';
  if (view.type === 'table') select(panel, tr('table.label-row-height', '行高'), [['', tr('table.option-short', '矮')], ['medium', tr('table.option-medium', '中')], ['tall', tr('table.option-tall', '高')], ['extra', tr('table.option-extra-tall', '超高')]], view.rowHeight || '', value => controller.patchView('rowHeight', value)).dataset.configField = 'rowHeight';
  const groupOptions = [['', tr('list.option-none', '不分组')], ...propertyOptions];
  select(panel, tr('label-group-by', '分组属性'), groupOptions, view.groupBy?.property || '', async property => {
    if (Array.isArray(view.groupOrder) && property !== view.groupBy?.property) await controller.patchView('groupOrder', null);
    await controller.patchView('groupBy', property ? { property, direction: view.groupBy?.direction || 'ASC' } : null);
  }).dataset.configField = 'groupBy';
  const groupDirection = select(panel, tr('label-sort-by', '分组排序'), [['ASC', tr('label-sort-a-z', 'A → Z')], ['DESC', tr('label-sort-z-a', 'Z → A')]], view.groupBy?.direction || 'ASC', direction => {
    if (view.groupBy?.property) controller.patchView('groupBy', { ...view.groupBy, direction });
  });
  groupDirection.dataset.configField = 'groupDirection'; groupDirection.disabled = !view.groupBy;
  if (view.groupBy) {
    const section = el(panel, 'div', 'bases-config-section bases-group-config', tr('kanban.action-edit-columns', '编辑分组'));
    let groups = [];
    try { groups = groupRows(controller.result.rows, { ...view, groupOrder: null }); }
    catch (failure) { error.textContent = failure.message; }
    const keys = groups.map(group => group.key);
    for (const key of view.groupOrder || []) if (!keys.some(other => baseEquals(key, other))) keys.push(key);
    const current = Array.isArray(view.groupOrder) ? view.groupOrder : groups.map(group => group.key);
    for (const key of keys) {
      const row = el(section, 'label', 'bases-group-toggle');
      const toggle = el(row, 'input'); toggle.type = 'checkbox'; toggle.checked = current.some(other => baseEquals(key, other));
      el(row, 'span', '', key == null ? tr('label-group-key-none', '无') : formatBaseValue(key));
      toggle.addEventListener('change', () => controller.patchView('groupOrder', toggle.checked ? [...current, key] : current.filter(other => !baseEquals(key, other))));
      const index = current.findIndex(other => baseEquals(key, other));
      for (const [offset, symbol] of [[-1, '↑'], [1, '↓']]) {
        const move = el(row, 'button', '', symbol); move.type = 'button';
        move.setAttribute('aria-label', (offset < 0 ? '上移分组 ' : '下移分组 ') + formatBaseValue(key));
        move.disabled = index < 0 || index + offset < 0 || index + offset >= current.length;
        move.addEventListener('click', event => {
          event.preventDefault(); const order = [...current];
          [order[index], order[index + offset]] = [order[index + offset], order[index]];
          controller.patchView('groupOrder', order);
        });
      }
    }
    if (Array.isArray(view.groupOrder)) {
      const reset = el(section, 'button', 'bases-group-order-reset', tr('table.action-sort-default', '清除手动排序'));
      reset.type = 'button'; reset.addEventListener('click', () => controller.patchView('groupOrder', null));
    }
  }
  select(panel, tr('label-sort', '排序属性'), [['', tr('table.action-sort-default', '默认排序')], ...propertyOptions], view.sort?.[0]?.property || view.sort?.[0]?.column || '', property => controller.patchView('sort', property ? [{ property, direction: view.sort?.[0]?.direction || 'ASC' }] : []));
  select(panel, tr('label-sort-by', '排序方向'), [['ASC', tr('label-sort-a-z', '升序')], ['DESC', tr('label-sort-z-a', '降序')]], view.sort?.[0]?.direction || 'ASC', direction => {
    const sort = view.sort?.[0]; if (sort) controller.patchView('sort', [{ ...sort, direction }, ...view.sort.slice(1)]);
  }).disabled = !view.sort?.length;
  const limit = input(panel, tr('label-limit', '结果上限'), view.limit > 0 ? view.limit : '', (value, control) => {
    const number = value === '' ? 0 : Number(value);
    if (!Number.isInteger(number) || number < 0) { control.setCustomValidity('请输入非负整数'); error.textContent = control.validationMessage; return; }
    controller.patchView('limit', number);
  }, 'number'); limit.min = '0';
  const filterSection = el(panel, 'details', 'bases-config-filter bases-toolbar-section');
  el(filterSection, 'summary', 'bases-toolbar-section-header', tr('label-view-filters', '视图筛选'));
  renderBasesFilterBuilder(filterSection, view.filters, { properties, propertyType: key => baseFilterPropertyType(controller, key), onApply: value => controller.patchView('filters', value) });
  if (view.type === 'list') {
    select(panel, tr('list.label-markers', '列表标记'), [['bullet', tr('list.option-bullet', '项目符号')], ['number', tr('list.option-number', '编号')], ['none', tr('list.option-none', '无')]], view.markers || 'bullet', value => controller.patchView('markers', value));
    input(panel, tr('list.label-property-separator', '属性分隔符'), view.separator || ', ', value => controller.patchView('separator', value));
    select(panel, tr('list.label-indent-properties', '缩进属性'), [['false', '关闭'], ['true', '开启']], String(!!view.indentProperties), value => controller.patchView('indentProperties', value === 'true'));
  }
  if (view.type === 'cards' || view.type === 'kanban') {
    const key = view.type === 'cards' ? 'cardSize' : 'columnWidth';
    input(panel, view.type === 'cards' ? tr('cards.label-card-size', '卡片宽度') : tr('kanban.label-column-width', '列宽'), view[key] || (view.type === 'cards' ? 200 : 280), (value, control) => {
      const size = Number(value);
      if (!Number.isFinite(size) || size < 100 || size > 1000) { control.setCustomValidity('请输入 100 到 1000'); error.textContent = control.validationMessage; return; }
      controller.patchView(key, size);
    }, 'number');
    const imageOptions = [['', tr('list.option-none', '无')], ...propertyOptions.filter(([property]) => property === 'file.file' || !property.startsWith('file.'))];
    const image = select(panel, tr('cards.label-image-property', '图片属性'), imageOptions, (Object.hasOwn(view, 'image') ? view.image : view.imageProperty) || '', value => controller.patchView('image', value));
    image.dataset.configField = 'image';
    const fit = select(panel, tr('cards.label-image-fit', '图片适应方式'), [['', tr('cards.option-image-fit-cover', '填充')], ['contain', tr('cards.option-image-fit-contain', '适应')]], view.imageFit || '', value => controller.patchView('imageFit', value));
    fit.dataset.configField = 'imageFit';
    const ratio = input(panel, tr('cards.label-image-aspect-ratio', '图片纵横比'), view.imageAspectRatio || (view.type === 'cards' ? 1 : .5), (value, control) => {
      const aspect = Number(value);
      if (!Number.isFinite(aspect) || aspect < .25 || aspect > 2.5) { control.setCustomValidity('请输入 0.25 到 2.5'); error.textContent = control.validationMessage; return; }
      controller.patchView('imageAspectRatio', aspect);
    }, 'number'); ratio.min = '.25'; ratio.max = '2.5'; ratio.step = '.05'; ratio.dataset.configField = 'imageAspectRatio';
  }
  el(panel, 'div', 'bases-config-section', tr('label-properties', '显示属性'));
  for (const property of properties) {
    const label = el(panel, 'label', 'bases-property-toggle');
    const toggle = el(label, 'input'); toggle.type = 'checkbox'; toggle.checked = controller.result.columns.includes(property);
    toggle.setAttribute('aria-label', '显示属性 ' + property); toggle.dataset.property = property; el(label, 'span', '', propertyLabel(controller, property));
    toggle.addEventListener('change', () => {
      const columns = controller.result.columns.filter(key => key !== property);
      if (toggle.checked) columns.push(property); controller.patchView('order', columns);
    });
  }
  el(panel, 'div', 'bases-config-section', tr('table.label-summary', '汇总'));
  for (const property of controller.result.columns) {
    const selected = view.summaries?.[property] || '';
    const available = [...summaryNamesFor(controller.result.rows, property), ...Object.keys(controller.document.data.summaries || {})];
    const names = available.includes(selected) || !selected ? available : [...available, selected];
    select(panel, tr('table.label-summary', '汇总') + ' ' + property, [['', tr('list.option-none', '无')], ...names.map(name => [name, name])], selected, name => {
      const summaries = { ...(controller.view.summaries || {}) };
      if (name) summaries[property] = name; else delete summaries[property];
      controller.patchView('summaries', summaries);
    });
  }
  const add = el(panel, 'div', 'bases-config-section bases-add-view', tr('button-add-view', '添加视图'));
  const name = el(add, 'input'); name.placeholder = tr('label-view-name', '视图名称'); name.setAttribute('aria-label', '新视图名称');
  const type = el(add, 'select'); type.setAttribute('aria-label', '新视图布局');
  for (const [key, label] of Object.entries(BASE_LAYOUTS)) { const option = el(type, 'option', '', label); option.value = key; }
  const create = el(add, 'button', '', tr('button-add-view', '添加视图')); create.type = 'button';
  create.addEventListener('click', async () => {
    const value = name.value.trim();
    if (!value || /[\[\]#|^\\]/.test(value)) { error.textContent = '请输入有效视图名称'; return; }
    if (controller.document.data.views.some(other => other.name === value)) { error.textContent = tr('msg-duplicate-view-name', '视图名称已存在'); return; }
    await controller.transact(current => {
      if (current.data.views.some(other => other.name === value)) throw Error(tr('msg-duplicate-view-name', '视图名称已存在'));
      return current.patch(['views'], [...current.data.views, { type: type.value, name: value, order: [...controller.result.columns] }]);
    });
    controller.switchView(value);
  });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); controller.closeConfig(); } });
  panel.querySelector('input')?.focus({ preventScroll: true }); return panel;
}
