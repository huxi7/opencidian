/**
 * [INPUT]: BaseDocument 校验、局部保存回调、属性清单与库级类型。
 * [OUTPUT]: 导出筛选构造器与属性类型解析器，提供嵌套条件和类型正确的标量输入。
 * [POS]: 数据库筛选菜单的纯 UI；保持原始表达式，不向用户暴露 YAML。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReadyBasesController as BasesController } from './bases-view.js';
import { tt } from '../core/i18n.js';
import { BaseDocument, propertyValue, createContext } from './bases-model.js';
import { basePropertyType } from './bases-edit-values.js';
import { setIcon } from '../core/icons.js';
import { mountBasesFormulaEditor } from './bases-ui-formula.js';
const tr = (key: string, fallback: string|undefined) => tt('plugins.bases.' + key, fallback);
function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string) {
  const node = parent.ownerDocument.createElement(tag); node.className = cls || '';
  if (text !== undefined) node.textContent = text; parent.appendChild(node); return node;
}
function button(parent: HTMLElement, text: string | undefined, icon: string, action: (event: MouseEvent) => unknown) {
  const node = el(parent, 'button', 'text-icon-button', text); node.type = 'button'; node.setAttribute('aria-label', text || '');
  if (icon) { const glyph = el(node, 'span', 'text-button-icon'); setIcon(glyph, icon); }
  node.addEventListener('click', action); return node;
}
function select(parent: HTMLElement, entries: string[][], value: string, label: string, change: (value: string) => unknown) {
  const node = el(parent, 'select'); node.setAttribute('aria-label', label);
  for (const [id, name] of entries) { const item = el(node, 'option', '', name); item.value = id; }
  node.value = value; node.addEventListener('change', () => change(node.value)); return node;
}
export function baseFilterPropertyType(controller: BasesController, property: string) {
  let value: unknown = null;
  try {
    const row = controller.result?.rows[0], file = controller.app.vault.getMarkdownFiles()[0];
    const context = row?.context || (file && createContext(controller.app, file, controller.document.data.formulas, controller.sourceFile));
    if (context) value = propertyValue(context, property);
  } catch {}
  if (!property.startsWith('file.') && !property.startsWith('formula.')) {
    const type = basePropertyType(controller.app, property.replace(/^note\./, ''), value);
    return type === 'number' ? 'number' : type === 'checkbox' ? 'boolean' : 'string';
  }
  return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
}
const clone = (value: unknown) => value == null ? null : structuredClone(value);
const GROUPS = [['and', '全部满足'], ['or', '任一满足'], ['not', '全部不满足']];
const OPS = [['==', '等于'], ['!=', '不等于'], ['>', '大于'], ['>=', '大于等于'], ['<', '小于'], ['<=', '小于等于'], ['contains', '包含'], ['empty', '为空'], ['!empty', '不为空']];
const propertyExpression = (key: string) => key.startsWith('file.') || key.startsWith('formula.') ? key : `note[${JSON.stringify(key.replace(/^note\./, ''))}]`;
function parseCondition(expression: unknown) {
  if (typeof expression !== 'string') return null;
  const found = expression.match(/^([\w.]+|note\["[^"\n]+"\])\s*(==|!=|>=|<=|>|<)\s*(.*)$/);
  if (!found) return null;
  const property = found[1].startsWith('note[') ? 'note.' + JSON.parse(found[1].slice(5, -1)) : found[1];
  let value; try { value = JSON.parse(found[3]); } catch { return null; }
  return { property, op: found[2], value: value == null ? '' : String(value), literal: value === null ? 'null' : typeof value };
}
function expressionFor(property: string, op: string, value: string, literal: string) {
  const source = propertyExpression(property);
  if (op === 'empty' || op === '!empty') return (op === '!empty' ? '!' : '') + source + '.isEmpty()';
  let typed: string | number | boolean | null = value;
  if (literal === 'number') { if (value === '' || !Number.isFinite(Number(value))) throw Error('请输入有效数字'); typed = Number(value); }
  else if (literal === 'boolean') typed = value === 'true';
  else if (literal === 'null') typed = null;
  return op === 'contains' ? source + '.contains(' + JSON.stringify(typed) + ')' : source + ' ' + op + ' ' + JSON.stringify(typed);
}
export function renderBasesFilterBuilder(parent: HTMLElement, initial: unknown, options: {
  properties?: string[]; propertyType?: (property: string) => string; onApply?: (value: unknown) => unknown;
} = {}) {
  let draft: unknown = clone(initial); const root = el(parent, 'div', 'bases-filter-builder');
  const tree = el(root, 'div', 'bases-filter-tree'); const message = el(root, 'div', 'bases-filter-error'); message.setAttribute('role', 'status');
  const properties = options.properties?.length ? options.properties : ['file.name'];
  let editors: ReturnType<typeof mountBasesFormulaEditor>[] = [];
  const redraw = () => { editors.forEach(editor => editor.destroy()); editors = []; tree.replaceChildren(); render(tree, draft, (value: unknown, repaint = true) => { draft = value; if (repaint) redraw(); }, 0); };
  function render(owner: HTMLElement, value: unknown, update: (value: unknown, repaint?: boolean) => void, depth: number) {
    const groupKey = value && typeof value === 'object' && !Array.isArray(value) ? ['and', 'or', 'not'].find(key => Object.hasOwn(value, key)) : null;
    if (groupKey && value && typeof value === 'object' && !Array.isArray(value)) {
      let groupValue: Record<string, unknown> = { ...value };
      const group = el(owner, 'div', 'bases-filter-group'); group.dataset.operator = groupKey;
      const heading = el(group, 'div', 'bases-filter-group-header');
      select(heading, GROUPS, groupKey, '条件组合', (key) => update({ [key]: clone(groupValue[groupKey]) }));
      if (depth) button(heading, '删除条件组', 'lucide-trash-2', () => update(null));
      const entries = groupValue[groupKey];
      let children: unknown[] = Array.isArray(entries) ? entries : [entries];
      const body = el(group, 'div', 'bases-filter-group-children');
      children.forEach((child, index) => render(body, child, (next: unknown, repaint = true) => {
        const changed = [...children]; if (next == null) changed.splice(index, 1); else changed[index] = next;
        children = changed; groupValue = { ...groupValue, [groupKey]: changed }; update(groupValue, repaint);
      }, depth + 1));
      addActions(group, (entry) => update({ ...groupValue, [groupKey]: [...children, entry] }));
      return;
    }
    if (value == null) { addActions(owner, update); return; }
    const row = el(owner, 'div', 'bases-filter-row');
    const parsed = parseCondition(value);
    if (parsed) {
      const literalFor = (property: string) => options.propertyType?.(property) || parsed.literal;
      const state = { ...parsed };
      const save = (control?: { setCustomValidity: (arg0: string) => void; }|undefined) => {
        try { const expression = expressionFor(state.property, state.op, state.value, state.literal); control?.setCustomValidity(''); message.textContent = ''; update(expression); }
        catch (error) { control?.setCustomValidity((error instanceof Error ? error.message : String(error))); message.textContent = (error instanceof Error ? error.message : String(error)); }
      };
      const choices = [...new Set([...properties, parsed.property])].map(key => [key, key.replace(/^note\./, '')]);
      select(row, choices, state.property, '筛选属性', (val: string) => {
        state.property = val; state.literal = literalFor(val);
        if (state.literal === 'number' && (state.value === '' || !Number.isFinite(Number(state.value)))) state.value = '0';
        if (state.literal === 'boolean' && !['true', 'false'].includes(state.value)) state.value = 'true';
        save();
      });
      select(row, OPS, state.op, '筛选条件', (val: string) => { state.op = val; save(); });
      const input = el(row, state.literal === 'boolean' ? 'select' : 'input', 'bases-filter-value'); input.setAttribute('aria-label', '筛选值');
      if (state.literal === 'boolean') for (const value of ['true', 'false']) { const option = el(input, 'option', '', value); option.value = value; }
      else if (input instanceof HTMLInputElement) { input.type = state.literal === 'number' ? 'number' : 'text'; if (state.literal === 'number') input.step = 'any'; }
      input.value = state.value;
      input.addEventListener('change', () => { state.value = input.value; if (state.literal === 'null' && input.value !== '') state.literal = literalFor(state.property); save(input); });
      button(row, '编辑公式', 'lucide-code-2', () => { row.replaceChildren(); formula(row, value, update); button(row, '删除条件', 'lucide-trash-2', () => update(null)); });
    } else formula(row, value, update);
    button(row, '删除条件', 'lucide-trash-2', () => update(null));
  }
  function formula(row: HTMLElement, value: unknown, update: (value: unknown, repaint?: boolean) => void) {
    if (typeof value !== 'string') { el(row, 'span', 'bases-warning', '保留未知筛选格式；请先移除此条件，再创建新条件。'); return; }
    const holder = el(row, 'div', 'bases-filter-formula');
    editors.push(mountBasesFormulaEditor(holder, value, { properties, onChange: (next: string) => update(next, false) }));
  }
  function addActions(owner: HTMLElement, add: (value: unknown) => void) {
    const actions = el(owner, 'div', 'bases-filter-actions');
    button(actions, tr('label-add-filter', '添加筛选'), 'lucide-plus', () => add(propertyExpression(properties[0]) + ' == ""'));
    button(actions, '添加条件组', 'lucide-list-filter', () => add({ and: [] }));
    button(actions, '添加公式', 'lucide-code-2', () => add('true'));
  }
  const apply = button(root, tt('interface.action-apply', '应用'), 'lucide-check', async () => {
    message.textContent = '';
    try {
      const invalid = root.querySelector<HTMLInputElement>(':invalid'); if (invalid) throw Error(invalid.validationMessage || '筛选值无效');
      const yaml = require('js-yaml');
      const source = yaml.dump({ filters: draft, views: [{ type: 'table', name: 'validate' }] });
      new BaseDocument(source);
      await options.onApply?.(clone(draft));
    } catch (error) { message.textContent = (error instanceof Error ? error.message : String(error)); }
  });
  apply.classList.add('mod-cta', 'bases-filter-apply'); redraw();
  const destroy = () => { editors.forEach(editor => editor.destroy()); editors = []; };
  root.basesFilterDestroy = destroy;
  return { root, getValue: () => clone(draft), destroy };
}
