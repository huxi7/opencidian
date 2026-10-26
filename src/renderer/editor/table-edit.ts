/**
 * [INPUT]: 依赖 editor/table-model.js 的 cellTextFromInput/cellTextToInput；使用 dom.js 安装的元素助手。
 * [OUTPUT]: 导出 beginCellEdit、closeCellEdit、cancelCellEdit、commitCellEdit、tabFromCell、enterFromCell、nextCellIn。
 * [POS]: editor/ 表格部件的原位置编辑层。原版每个单元格是一个 CM 编辑器（mq/iZ），这里以单元格内的 textarea 对齐其可观察语义：
 *        进入即全选（Tab/Enter 换格）、Enter 下移或末行加行、Tab/Shift+Tab 逐格移动（末格加行、首格上方插行）、Esc 取消、
 *        blur 提交（trim + 换行落 <br> + 未转义 | 补反斜杠）、IME 合成期间挂起提交。
 *        进入时调 widget.setActiveDragHandles（原版 editTableCell），关闭时 unsetActiveDragHandles（原版 destroyTableCell）。
 *        table-widget.js 是唯一调用方。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TableEditState, TableViewState } from './table-types.js';
import type { EditorView } from '@codemirror/view';
import type { TableWidget } from './table-widget.js';
import type { CellPosition } from './table-types.js';
import type { TableModel } from './table-model.js';
import { cellTextFromInput, cellTextToInput } from './table-model.js';

/** 原版 getNextCell：end 指阅读顺序下一格（行末跳下一行首），start 指上一格（行首跳上一行尾）。 */
export function nextCellIn(model: TableModel, cell: CellPosition, direction: string) {
  const { row, col } = cell;
  if (direction === 'end') {
    const rowCells = model.rows[row];
    if (col === rowCells.length - 1) {
      return row === model.rows.length - 1 ? null : { row: row + 1, col: 0 };
    }
    return { row, col: col + 1 };
  }
  if (col === 0 && row === 0) return null;
  if (col === 0) return { row: row - 1, col: model.rows[row - 1].length - 1 };
  return { row, col: col - 1 };
}

/** 在单元格内挂 textarea 并聚焦；options.selectAll 对应原版换格后的全选。 */
export function beginCellEdit(widget: TableWidget, view: EditorView, row: number, col: number, options: { selectAll?: boolean } = {}) {
  const model = widget.model();
  if (!model || !model.rows[row] || row < 0 || col < 0 || col >= model.alignments.length) return null;
  const cell = widget.cellElement(row, col);
  const wrapper = cell && cell.querySelector<HTMLElement>('.table-cell-wrapper');
  if (!wrapper) return null;
  if (widget.edit && widget.edit.row === row && widget.edit.col === col) return widget.edit.textarea;
  closeCellEdit(widget);

  const selectAll = !!(options && options.selectAll);
  const win = (wrapper.ownerDocument || document).defaultView || window;
  const textarea = wrapper.createEl('textarea', { cls: 'table-cell-editor' });
  textarea.value = cellTextToInput(model.rows[row][col]);
  wrapper.addClass('mod-editing');
  const state = { row, col, textarea, wrapper, composing: false, pendingCommit: false };
  widget.edit = state;
  widget.focusCell = { row, col };
  widget.setActiveDragHandles(row, col);

  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(textarea.scrollHeight, 20) + 'px';
  };
  textarea.addEventListener('input', resize);
  textarea.addEventListener('compositionstart', () => { state.composing = true; });
  textarea.addEventListener('compositionend', () => {
    state.composing = false;
    if (state.pendingCommit && widget.edit === state) commitCellEdit(widget, view, state, null);
  });
  textarea.addEventListener('keydown', (event) => onEditorKeyDown(widget, view, state, event));
  textarea.addEventListener('blur', () => {
    if (widget.edit !== state) return;
    // IME 合成期间不得提交：挂起到 compositionend
    if (state.composing) { state.pendingCommit = true; return; }
    commitCellEdit(widget, view, state, null);
  });
  textarea.addEventListener('pointerdown', (event) => event.stopPropagation());
  textarea.addEventListener('mousedown', (event) => event.stopPropagation());
  win.setTimeout(() => {
    if (widget.edit !== state) return;
    resize();
    try { textarea.focus({ preventScroll: true }); } catch (error) { textarea.focus(); }
    if (selectAll) textarea.select();
    else {
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    }
  }, 0);
  resize();
  return textarea;
}

/** 卸载 textarea 回到渲染态；不写文档。 */
export function closeCellEdit(widget: TableWidget) {
  const state = widget.edit;
  if (!state) return;
  widget.edit = null;
  state.textarea.detach();
  if (state.wrapper) state.wrapper.removeClass('mod-editing');
  widget.unsetActiveDragHandles();
}

/** Esc：丢弃编辑内容，焦点回到表格容器（选区与 Tab 导航仍可用）。 */
export function cancelCellEdit(widget: TableWidget) {
  if (!widget.edit) return;
  closeCellEdit(widget);
  widget.focusContainer();
}

function onEditorKeyDown(widget: TableWidget, view: EditorView, state: TableEditState, event: KeyboardEvent) {
  if (widget.edit !== state) return;
  event.stopPropagation();
  if (event.isComposing || state.composing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelCellEdit(widget);
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    commitCellEdit(widget, view, state, 'down');
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    commitCellEdit(widget, view, state, event.shiftKey ? 'prev' : 'next');
  }
}

/** blur / Enter / Tab 提交：trim 后写回；方向决定焦点去向（原版 cell editor 的 Tab/Enter 语义）。 */
export function commitCellEdit(widget: TableWidget, view: EditorView, state: TableEditState, direction: string|null) {
  if (widget.edit !== state) return false;
  const text = cellTextFromInput(state.textarea.value.trim());
  closeCellEdit(widget);
  return advanceFromCell(widget, view, state.row, state.col, direction || null, text);
}

/** 容器（非编辑态）Tab：从选区头或最后按下的单元格出发换格。 */
export function tabFromCell(widget: TableWidget, view: EditorView, row: number, col: number, shift: boolean) {
  return advanceFromCell(widget, view, row, col, shift ? 'prev' : 'next', undefined);
}

/** 容器（非编辑态）Enter：语义同编辑器内的 Enter。 */
export function enterFromCell(widget: TableWidget, view: EditorView, row: number, col: number) {
  return advanceFromCell(widget, view, row, col, 'down', undefined);
}

/**
 * direction：'next' 下一格（末格追加行到表尾）、'prev' 上一格（首格在表头前插行）、'down' 下方一格（末行追加行）、
 * null 只提交。text 为 undefined 表示没有待提交的文本（纯导航）。
 */
function advanceFromCell(widget: TableWidget, view: EditorView, row: number, col: number, direction: string|null, text: string|undefined) {
  const model = widget.model();
  if (!model) return false;
  const pending = { row, col, text };
  if (direction === 'next' || direction === 'prev') {
    const target = nextCellIn(model, { row, col }, direction === 'next' ? 'end' : 'start');
    if (target) {
      return applyStep(widget, view, pending, { focus: { row: target.row, col: target.col, selectAll: true } });
    }
    if (direction === 'prev') {
      return applyStep(widget, view, pending, {
        insert: 0,
        focus: { row: 0, col: Math.max(0, model.alignments.length - 1), selectAll: true },
      });
    }
    return applyStep(widget, view, pending, {
      insert: model.rows.length,
      focus: { row: model.rows.length, col: 0, selectAll: true },
    });
  }
  if (direction === 'down') {
    if (row >= model.rows.length - 1) {
      return applyStep(widget, view, pending, { insert: row + 1, focus: { row: row + 1, col, selectAll: true } });
    }
    return applyStep(widget, view, pending, { focus: { row: row + 1, col, selectAll: true } });
  }
  return applyStep(widget, view, pending, null);
}

function applyStep(widget: TableWidget, view: EditorView, pending: { row: number; col: number; text?: string }, plan: TableViewState | null) {
  const state = plan && plan.focus ? { focus: plan.focus } : undefined;
  if (plan && plan.insert !== undefined) {
    widget.insertRow(view, plan.insert, state);
    return true;
  }
  if (pending.text === undefined) {
    if (state) widget.applyState(view, state);
    return false;
  }
  return widget.updateCell(view, pending.row, pending.col, pending.text, state);
}
