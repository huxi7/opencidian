/**
 * [INPUT]: Bases 控制器、单元格 DOM、共用属性写入、属性候选浮层与富值格式。
 * [OUTPUT]: 导出单元格编辑、表头交互绑定及全局指针监听释放。
 * [POS]: 表格交互适配器。事件只提交用户操作的键，编辑失败保留输入和错误原因。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BaseQueryRow } from './bases-types.js';
import type { ReadyBasesController as BasesController, BasesController as BaseController } from './bases-view.js';
import { baseWriteInfo, parseBaseEditInput, writeBaseProperty, formatBaseEditValue } from './bases-edit-values.js';
import { attachBaseSuggestions } from './bases-edit-suggest.js';
const columnDrags = new WeakMap<BaseController, string>();
export function disposeBaseEditing(controller: BaseController) {
  for (const release of controller.editCleanups || []) release();
  controller.editCleanups?.clear(); columnDrags.delete(controller);
}
const element = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string) => { const node = parent.ownerDocument.createElement(tag); node.className = cls; parent.appendChild(node); return node; };
export function bindBaseCell(controller: BasesController, cell: HTMLElement, row: BaseQueryRow, property: string) {
  cell.dataset.property = property;
  const info = baseWriteInfo(controller, row, property);
  if (!info.writable) { cell.dataset.readonly = 'true'; cell.title = info.reason; return; }
  cell.tabIndex = 0; cell.dataset.editable = 'true';
  const begin = (event: MouseEvent | KeyboardEvent) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== 'F2') return;
    if (event.target instanceof Element && event.target.closest('a,button,input,textarea,select') || cell.querySelector('.bases-cell-editor')) return;
    event.preventDefault(); event.stopPropagation();
    const latest = baseWriteInfo(controller, row, property);
    if (!latest.writable) return;
    const previous = [...cell.childNodes]; cell.replaceChildren(); cell.classList.add('is-editing');
    const editor = element(cell, 'input', 'bases-cell-editor'); editor.setAttribute('aria-label', property);
    editor.style.cssText = 'width:100%;min-width:40px;box-sizing:border-box';
    editor.type = latest.type === 'number' ? 'number' : latest.type === 'date' ? 'date' : latest.type === 'datetime' ? 'datetime-local' : 'text';
    if (latest.type === 'number') editor.step = 'any';
    if (latest.type === 'datetime') editor.step = '1';
    const initialValue = formatBaseEditValue(latest); editor.value = initialValue;
    const error = element(cell, 'div', 'bases-cell-error'); error.setAttribute('role', 'alert');
    let finished = false, saving = false;
    let suggestions: ReturnType<typeof attachBaseSuggestions> | undefined;
    const cancel = () => { if (finished || saving) return; finished = true; suggestions?.destroy(); cell.replaceChildren(...previous); cell.classList.remove('is-editing'); cell.focus(); if (controller.pendingEditRefresh) controller.refresh(); };
    const save = () => {
      if (finished || saving) return;
      if (editor.value === initialValue) { cancel(); return; }
      let target;
      try { target = latest.folder ? editor.value : parseBaseEditInput(editor.value, latest.type); }
      catch (cause) { error.textContent = (cause instanceof Error ? cause.message : String(cause)); editor.setAttribute('aria-invalid', 'true'); editor.focus(); return; }
      suggestions?.close(); saving = true; editor.disabled = true;
      controller.queue = controller.queue.catch(() => {}).then(() => writeBaseProperty(controller, row, latest, target)).then(async () => {
        finished = true; await controller.refresh();
      }).catch((cause) => { saving = false; editor.disabled = false; error.textContent = (cause instanceof Error ? cause.message : String(cause)); editor.setAttribute('aria-invalid', 'true'); editor.focus(); });
    };
    suggestions = attachBaseSuggestions(controller, editor, { ...latest, sourcePath: row.file.path }, () => save());
    editor.addEventListener('keydown', (key: KeyboardEvent) => { if (suggestions.handleKey(key)) return; key.stopPropagation(); if (key.key === 'Escape') { key.preventDefault(); cancel(); } else if (key.key === 'Enter') { key.preventDefault(); save(); } });
    editor.addEventListener('blur', () => { if (!error.textContent) save(); });
    editor.focus(); editor.select();
  };
  cell.addEventListener('dblclick', begin); cell.addEventListener('keydown', begin);
  if (info.type === 'checkbox') {
    cell.replaceChildren();
    const checkbox = element(cell, 'input', 'bases-checkbox'); checkbox.type = 'checkbox'; checkbox.checked = !!info.value; checkbox.setAttribute('aria-label', property);
    checkbox.addEventListener('change', () => {
      checkbox.disabled = true;
      controller.queue = controller.queue.catch(() => {}).then(() => writeBaseProperty(controller, row, info, checkbox.checked)).then(() => controller.refresh()).catch((error) => { checkbox.checked = !!info.value; checkbox.disabled = false; controller.warning(error.message); });
    });
  }
}
export function bindBaseColumn(controller: BasesController, cell: HTMLElement, property: string) {
  cell.dataset.property = property; cell.draggable = true; cell.style.position = 'relative';
  const width = controller.view.columnSize?.[property];
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) { cell.style.width = width + 'px'; cell.style.minWidth = width + 'px'; }
  const resizer = element(cell, 'div', 'bases-table-header-resizer');
  resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-label', '调整列宽：' + property); resizer.setAttribute('aria-orientation', 'vertical'); resizer.tabIndex = 0;
  resizer.style.cssText = 'position:absolute;right:0;top:0;height:100%;width:6px;cursor:col-resize;touch-action:none';
  const save = (value: number) => controller.patchViewKey('columnSize', property, Math.max(40, Math.round(value)));
  resizer.addEventListener('click', (event) => event.stopPropagation());
  resizer.addEventListener('dblclick', (event: { stopPropagation: () => void; }) => { event.stopPropagation(); controller.patchViewKey('columnSize', property, null); });
  resizer.addEventListener('keydown', (event: { key: string; preventDefault: () => void; }) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); save(cell.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 10 : -10)); });
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const start = event.clientX, initial = cell.getBoundingClientRect().width, doc = cell.ownerDocument;
    const move = (drag: PointerEvent) => { const value = Math.max(40, initial + drag.clientX - start); cell.style.width = value + 'px'; cell.style.minWidth = value + 'px'; };
    const up = (drag: PointerEvent) => { cancel(); save(initial + drag.clientX - start); };
    const cancel = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', cancel); controller.editCleanups?.delete(cancel); };
    (controller.editCleanups ||= new Set()).add(cancel);
    doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', cancel);
  });
  cell.addEventListener('dragstart', (event) => {
    if (event.target === resizer || !event.dataTransfer) { event.preventDefault(); return; }
    columnDrags.set(controller, property); event.dataTransfer.setData('application/x-opensidian-base-column', property); event.dataTransfer.effectAllowed = 'move';
  });
  cell.addEventListener('dragend', () => columnDrags.delete(controller));
  cell.addEventListener('dragover', (event: DragEvent) => { if (columnDrags.has(controller)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; } });
  cell.addEventListener('drop', (event: { preventDefault: () => void; stopPropagation: () => void; }) => {
    const from = columnDrags.get(controller); if (!from || from === property) return;
    event.preventDefault(); event.stopPropagation(); columnDrags.delete(controller);
    controller.reorderColumn(from, property);
  });
}
