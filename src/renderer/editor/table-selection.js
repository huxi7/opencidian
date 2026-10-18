/**
 * [INPUT]: 依赖 core/menu.js 的 Menu、core/i18n.js 的 t、markdown/reading.js 的 getMarkdownIt（复制 HTML）；依赖 editor/table-model.js 的 serializeTable 与 clamp。
 * [OUTPUT]: 导出 cellElement、cellPosition、closestCell、selectionBounds、clampBounds、attachCellSelection、buildSelectionMenu、copySelection、pasteSelection。
 * [POS]: editor/ 表格部件的选区层。逐字移植原版 mq.init/gq 的 pointerdown 矩形选择（getClosestCell 命中、is-selected/start/end/top/bottom 类）、
 *        选区右键菜单（clipboard → 对齐 → 清空/删除；原版 onContextMenu 的 selection 分支，去掉 formatting 子菜单）与子表格剪贴板载荷
 *        （原版 obsidian/table MIME；浏览器剪贴板写不了自定义类型，用同进程缓存实现等价语义，正文仍写 text/plain 与 text/html）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Menu } from '../core/menu.js';
import { t } from '../core/i18n.js';
import { getMarkdownIt } from '../markdown/reading.js';
import { serializeTable, parseTableText, clamp } from './table-model.js';

/** 原版 obsidian/table 载荷的同进程等价物；系统剪贴板在无权限时读不回自定义类型。 */
let tableClipboard = null;

export function cellElement(container, row, col) {
  const table = container && container.querySelector('table.table-editor');
  if (!table) return null;
  const rowEl = table.rows[row];
  return rowEl && rowEl.cells[col] ? rowEl.cells[col] : null;
}

export function cellPosition(cellEl) {
  const rowEl = cellEl && cellEl.parentElement;
  const table = rowEl && rowEl.closest ? rowEl.closest('table') : null;
  if (!table) return null;
  return { row: Array.prototype.indexOf.call(table.rows, rowEl), col: cellEl.cellIndex };
}

/** 原版 getClosestCell：先按纵向找最近行（含表头），再按横向找最近列。 */
export function closestCell(container, x, y) {
  const table = container && container.querySelector('table.table-editor');
  if (!table || !table.rows.length) return null;
  const rows = Array.from(table.rows);
  let currentRow = rows[0];
  let bestRow = Infinity;
  for (const row of rows) {
    if (!row.cells.length) continue;
    const rect = row.cells[0].getBoundingClientRect();
    if (rect.top <= y && y <= rect.bottom) { currentRow = row; break; }
    const distance = Math.min(Math.abs(rect.bottom - y), Math.abs(rect.top - y));
    if (distance > bestRow) break;
    currentRow = row;
    bestRow = distance;
  }
  const cells = Array.from(currentRow.cells);
  let currentCell = cells[0];
  let bestCol = Infinity;
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    if (rect.left <= x && x <= rect.right) { currentCell = cell; break; }
    const distance = Math.min(Math.abs(rect.left - x), Math.abs(rect.right - x));
    if (distance > bestCol) break;
    currentCell = cell;
    bestCol = distance;
  }
  return currentCell || null;
}

export function selectionBounds(anchor, head) {
  if (!anchor || !head) return null;
  return {
    minRow: Math.min(anchor.row, head.row),
    maxRow: Math.max(anchor.row, head.row),
    minCol: Math.min(anchor.col, head.col),
    maxCol: Math.max(anchor.col, head.col),
  };
}

/** 原版 validateSelectionBounds：把越界行列夹回表格范围。 */
export function clampBounds(bounds, rowCount, colCount) {
  if (!bounds) return null;
  return {
    minRow: clamp(bounds.minRow, 0, rowCount - 1),
    maxRow: clamp(bounds.maxRow, 0, rowCount - 1),
    minCol: clamp(bounds.minCol, 0, colCount - 1),
    maxCol: clamp(bounds.maxCol, 0, colCount - 1),
  };
}

/**
 * 单元格按下 → 框选：原版 mq.init 的 pointerdown 分支。
 * 单格按下先清空旧选区；拖过其它单元格时按矩形重画选中类；pointerup 后保留选区并聚焦容器（Tab 换格的入口）。
 */
export function attachCellSelection(widget, view, container) {
  container.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target.closest && target.closest('.table-row-drag-handle, .table-col-drag-handle, .table-row-btn, .table-col-btn')) return;
    const cellEl = target.closest ? target.closest('th, td') : null;
    if (cellEl && container.contains(cellEl)) {
      if (event.button === 2) {
        // 原版：右键落在已选单元格上要保住选区，供 contextmenu 构建选区菜单
        if (widget.selectedCells.includes(cellEl)) event.preventDefault();
        return;
      }
      if (!event.isPrimary || event.button !== 0 || widget.edit) return;
      startCellDrag(widget, view, container, event, cellEl);
      return;
    }
    if (target === container) {
      event.preventDefault();
      widget.deselectCells();
    }
  });

  container.addEventListener('contextmenu', (event) => {
    const target = event.target;
    const cellEl = target.closest ? target.closest('th, td') : null;
    if (!cellEl || !container.contains(cellEl)) return;
    if (widget.edit && cellEl.contains(widget.edit.textarea)) return;
    if (widget.selectedCells.includes(cellEl)) {
      event.preventDefault();
      event.stopPropagation();
      buildSelectionMenu(widget, view, event);
      return;
    }
    // 原版：选区之外的单元格先取消选择（随后的文本菜单交回编辑器菜单）
    if (widget.selectionAnchor) widget.deselectCells();
  });
}

function startCellDrag(widget, view, container, event, cellEl) {
  const win = (container.ownerDocument || document).defaultView || window;
  let anchor = cellPosition(cellEl);
  if (!anchor) return;
  let head = anchor;
  let moved = false;
  widget.focusCell = anchor;
  widget.selectCells(view, anchor, head);

  const cleanup = () => {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onFinish);
    win.removeEventListener('pointercancel', onCancel);
    win.removeEventListener('keydown', onKeyDown);
    container.removeClass('mod-selecting');
  };
  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    const over = closestCell(container, moveEvent.clientX, moveEvent.clientY);
    if (!over) return;
    const position = cellPosition(over);
    if (!position || (position.row === head.row && position.col === head.col)) return;
    if (!moved) {
      moved = true;
      moveEvent.preventDefault();
      container.addClass('mod-selecting');
    }
    head = position;
    widget.selectCells(view, anchor, head);
  };
  const onFinish = (upEvent) => {
    if (upEvent.pointerId !== event.pointerId) return;
    cleanup();
    if (!moved && upEvent.button !== event.button) return;
    if (moved) widget.suppressClick = true;
    widget.focusContainer();
  };
  const onCancel = () => cleanup();
  const onKeyDown = (keyEvent) => { if (keyEvent.key === 'Escape') cleanup(); };

  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onFinish);
  win.addEventListener('pointercancel', onCancel);
  win.addEventListener('keydown', onKeyDown);
}

/** 选区右键菜单 —— 原版 onContextMenu 的 selection 分支（桌面 clipboard 三项 + 对齐 + 清空/删除）。 */
export function buildSelectionMenu(widget, view, event) {
  const menu = new Menu(widget.app);
  menu.addItem((item) => item.setSection('clipboard').setIcon('lucide-scissors').setTitle(t('interface.menu.cut'))
    .onClick(() => copySelection(widget, view, true)));
  menu.addItem((item) => item.setSection('clipboard').setIcon('lucide-copy').setTitle(t('interface.menu.copy'))
    .onClick(() => copySelection(widget, view, false)));
  menu.addItem((item) => item.setSection('clipboard').setIcon('lucide-clipboard-check').setTitle(t('interface.menu.paste'))
    .onClick(() => pasteSelection(widget, view)));
  menu.addSeparator();
  menu.addItem((item) => item.setSection('table-align').setIcon('lucide-align-left').setTitle(t('table.action-align-left'))
    .onClick(() => widget.setSelectionAlignment(view, 'left')));
  menu.addItem((item) => item.setSection('table-align').setIcon('lucide-align-center').setTitle(t('table.action-align-center'))
    .onClick(() => widget.setSelectionAlignment(view, 'center')));
  menu.addItem((item) => item.setSection('table-align').setIcon('lucide-align-right').setTitle(t('table.action-align-right'))
    .onClick(() => widget.setSelectionAlignment(view, 'right')));
  menu.addSeparator();
  menu.addItem((item) => item.setSection('table').setIcon('lucide-eraser').setTitle(t('table.action-clear-selection'))
    .onClick(() => widget.clearSelectedCells(view)));
  menu.addItem((item) => item.setSection('table').setIcon('lucide-trash-2').setTitle(t('table.action-delete-selection'))
    .onClick(() => widget.deleteSelection(view, -1)));
  menu.setParentElement(widget.containerEl);
  menu.showAtMouseEvent(event);
  return menu;
}

/** 选区 → 子表格 Markdown，并写系统剪贴板：原版 copySelection 的四个 MIME 砍到 text/plain 与 text/html。 */
export function copySelection(widget, view, cut) {
  const model = widget.model();
  const bounds = widget.getSelectionBounds();
  if (!model || !bounds) return false;
  const rows = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    rows.push(model.rows[row].slice(bounds.minCol, bounds.maxCol + 1));
  }
  const alignment = model.alignments.slice(bounds.minCol, bounds.maxCol + 1);
  const markdown = serializeTable(rows, alignment);
  tableClipboard = { rows, alignment };
  writeClipboard(markdown);
  if (cut) widget.deleteSelection(view, -1);
  return true;
}

function writeClipboard(markdown) {
  const writeText = () => {
    try {
      const written = navigator.clipboard.writeText(markdown);
      if (written && written.catch) written.catch(() => { /* 剪贴板不可用 */ });
    } catch (error) { /* 剪贴板不可用 */ }
  };
  try {
    const html = getMarkdownIt().render(markdown);
    const item = new ClipboardItem({
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    });
    const written = navigator.clipboard.write([item]);
    if (written && written.catch) written.catch(writeText);
  } catch (error) {
    writeText();
  }
}

/** 从同进程缓存取原版 obsidian/table 载荷；没有时退回系统剪贴板里的 Markdown 表格。 */
async function readClipboardPayload() {
  if (tableClipboard) return tableClipboard;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = text ? parseTableText(text) : null;
    if (parsed) return { rows: parsed.rows, alignment: parsed.alignments };
  } catch (error) { /* 剪贴板不可用 */ }
  return null;
}

/** 粘贴子表格：原版 pasteSelection —— 从选区左上角（或最后按下的单元格）起写，缺行补行、缺列补列；落在表头行时改写对齐。 */
export async function pasteSelection(widget, view) {
  const model = widget.model();
  if (!model) return false;
  const bounds = widget.getSelectionBounds();
  const origin = bounds ? { row: bounds.minRow, col: bounds.minCol } : widget.focusCell;
  if (!origin) return false;
  const payload = await readClipboardPayload();
  if (!payload || !payload.rows.length || !payload.alignment.length) return false;
  const startRow = origin.row;
  const startCol = origin.col;
  const endRow = startRow + payload.rows.length - 1;
  const endCol = startCol + payload.alignment.length - 1;
  const rowCount = Math.max(endRow + 1, model.rows.length);
  if (startRow === 0) {
    for (let col = startCol; col <= endCol; col++) model.alignments[col] = payload.alignment[col - startCol];
  } else {
    const existing = model.alignments.length;
    for (let col = existing; col <= endCol; col++) model.alignments[col] = payload.alignment[col - existing];
  }
  const colCount = model.alignments.length;
  for (let row = 0; row < rowCount; row++) {
    if (!model.rows[row]) model.rows[row] = [];
    for (let col = 0; col < colCount; col++) {
      if (row >= startRow && row <= endRow && col >= startCol && col <= endCol) {
        model.rows[row][col] = payload.rows[row - startRow][col - startCol];
      } else if (model.rows[row][col] === undefined) {
        model.rows[row][col] = '';
      }
    }
  }
  widget.dispatch(view, model, { focus: { row: endRow, col: endCol, selectAll: false } });
  return true;
}
