/**
 * [INPUT]: Bases 控制器、富值组键、库级属性类型与候选浮层。
 * [OUTPUT]: 导出新组编辑行与 groupOrder 合并操作。
 * [POS]: 空组创建入口。按当前属性类型验证用户输入，只添加组键，不伪造笔记。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BaseQueryRow } from './bases-types.js';
import type { ReadyBasesController as BasesController } from './bases-view.js';
import { baseEquals } from './bases-values.js';
import { attachBaseSuggestions } from './bases-edit-suggest.js';
import { groupRows } from './bases-grouping.js';
import { baseWriteInfo, basePropertyType, parseBaseEditInput, baseValueToFrontmatter } from './bases-edit-values.js';
export function appendBaseGroup(controller: BasesController, value: unknown) {
  return controller.updateView((current, view, index) => {
    const info = baseWriteInfo(controller, null, view.groupBy?.property || '');
    if (!info.writable) throw Error(info.reason);
    const rows = controller.result.rows;
    const order = Array.isArray(view.groupOrder) ? [...view.groupOrder] : groupRows(rows, { ...view, groupOrder: null }).map((group: { key: unknown; }) => baseValueToFrontmatter(group.key));
    const key = baseValueToFrontmatter(value);
    if (order.some((existing: unknown) => baseEquals(existing, key))) throw Error('分组已存在。');
    return current.patch(['views', index, 'groupOrder'], [...order, key]);
  });
}
export function openBaseGroupEditor(controller: BasesController, parent: HTMLElement) {
  const old = controller.container.querySelector('.bases-group-add-line');
  if (old) { old.querySelector('input')?.focus(); return old; }
  const info = baseWriteInfo(controller, null, controller.view.groupBy?.property || '');
  if (!info.writable) { controller.warning(info.reason); return null; }
  const doc = parent.ownerDocument, line = doc.createElement('div'); line.className = 'bases-group-add-line'; parent.appendChild(line);
  const input = doc.createElement('input'); input.className = 'bases-group-add-input'; input.setAttribute('aria-label', '新分组'); line.appendChild(input);
  const button = doc.createElement('button'); button.type = 'button'; button.textContent = '添加分组'; line.appendChild(button);
  const message = doc.createElement('div'); message.className = 'bases-filter-error'; message.setAttribute('role', 'alert'); line.appendChild(message);
  const sample = controller.result.rows.map((row: BaseQueryRow) => baseWriteInfo(controller, row, info.property)).find((item) => item.value != null);
  const type = info.folder ? 'text' : basePropertyType(controller.app, info.name || '', sample?.value);
  input.type = type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : type === 'number' ? 'number' : 'text';
  const save = () => {
    let value;
    try { value = info.folder ? input.value : parseBaseEditInput(input.value, type); if (value == null || value === '') throw Error('请输入分组值。'); }
    catch (error) { message.textContent = (error instanceof Error ? error.message : String(error)); return; }
    if (info.folder && !controller.app.vault.getFolderByPath(String(value))) { message.textContent = '目标文件夹不存在。'; return; }
    appendBaseGroup(controller, value);
  };
  const suggestions = attachBaseSuggestions(controller, input, { ...info, type }, () => save());
  button.addEventListener('click', save);
  input.addEventListener('keydown', (event: KeyboardEvent) => { if (suggestions.handleKey(event)) return; if (event.key === 'Enter') { event.preventDefault(); save(); } else if (event.key === 'Escape') { suggestions.destroy(); line.remove(); } });
  input.focus(); return line;
}
export function renderBaseAddGroup(controller: BasesController, parent: HTMLElement) {
  if (!controller.view.groupBy || !baseWriteInfo(controller, null, controller.view.groupBy.property || '').writable) return;
  const button = parent.ownerDocument.createElement('button'); button.className = 'bases-add-group'; button.type = 'button'; button.textContent = '+ 添加分组';
  button.addEventListener('click', () => openBaseGroupEditor(controller, parent)); parent.appendChild(button);
}
