/**
 * [INPUT]: 依赖 core/menu.js 的 Menu、core/i18n.js 的 t、markdown/reading.js 的 getMarkdownIt（复制 HTML）；依赖 editor/table-model.js 的 serializeTable 与 clamp；
 *          依赖 editor/table-format.js 的 buildFormattingSubmenu（单元格文本格式子菜单）。
 * [OUTPUT]: 导出 cellElement、cellPosition、closestCell、selectionBounds、clampBounds、attachCellSelection、buildSelectionMenu、buildCellMenu、
 *           appendPendingTableMenu、copySelection、pasteSelection、writeClipboardText、readClipboardText。
 * [POS]: editor/ 表格部件的选区层。逐字移植原版 mq.init/gq 的 pointerdown 矩形选择（getClosestCell 命中、is-selected/start/end/top/bottom 类）、
 *        选区右键菜单（clipboard → 对齐 → 清空/删除；原版 onContextMenu 的 selection 分支，去掉 formatting 子菜单）与子表格剪贴板载荷
 *        （原版 obsidian/table MIME；浏览器剪贴板写不了自定义类型，用同进程缓存实现等价语义，正文仍写 text/plain 与 text/html；
 *        窗口未聚焦时 Chromium 拒绝系统剪贴板，纯文本同样留同进程副本兜底）。
 *        无选区单元格右键菜单 = clipboard 三项 + 文本格式子菜单 + Table 子菜单（widget.appendTableMenuItems）；
 *        剪切/复制落在单元格文本上（编辑器选区 > DOM 选区 > 整格），原版由主进程 editFlags 判定，部件渲染态没有可选文本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Menu } from '../core/menu.js';
import { t } from '../core/i18n.js';
import { getMarkdownIt } from '../markdown/reading.js';
import { serializeTable, parseTableText, clamp, cellTextFromInput, cellTextToInput } from './table-model.js';
import { buildFormattingSubmenu } from './table-format.js';

/** 原版 obsidian/table 载荷的同进程等价物；系统剪贴板在无权限时读不回自定义类型。 */
let tableClipboard = null;

/** 纯文本的同进程副本：窗口未聚焦时 Chromium 拒绝系统剪贴板（NotAllowedError），读回走它。 */
let textClipboard = null;

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
    if (widget.selectedCells.includes(cellEl)) {
      event.preventDefault();
      event.stopPropagation();
      buildSelectionMenu(widget, view, event);
      return;
    }
    // 原版：选区之外的单元格先取消选择，随后的菜单按无选区分支构建
    if (widget.selectionAnchor) widget.deselectCells();
    const position = cellPosition(cellEl);
    if (!position) return;
    if (widget.edit && cellEl.contains(widget.edit.textarea)) {
      // 原位编辑中的单元格：原版走单元格 CM 的文本菜单（这里由编辑器菜单承接，含拼写与剪贴板），
      // 菜单末尾由 appendPendingTableMenu 追加表格子菜单（原版 iZ.onMenu）。
      pendingCellMenu = { widget, view, position, time: Date.now() };
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    buildCellMenu(widget, view, position, event);
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

// ---------------------------------------------------------------------------
// 无选区单元格菜单（原版 iZ.onContextMenu + onMenu 的等价物）
// ---------------------------------------------------------------------------

/** 原位编辑中的单元格菜单交回编辑器菜单，由它追加表格子菜单；这里记住待追加的目标。 */
let pendingCellMenu = null;

/** 供 table-widget 的 editor-menu 钩子调用：原版 onMenu 末尾的 table.onContextMenu(cell)。 */
export function appendPendingTableMenu(menu) {
  const pending = pendingCellMenu;
  pendingCellMenu = null;
  if (!pending || Date.now() - pending.time > 1000) return false;
  if (!pending.widget.containerEl || !pending.widget.containerEl.isConnected) return false;
  pending.widget.appendTableMenuItems(menu, pending.position, pending.view);
  return true;
}

/**
 * 无选区单元格右键菜单：clipboard 三项 + 文本格式子菜单 + Table 子菜单（Row/Column/Sort）。
 * 部件渲染态没有可选的单元格文本（Chromium 对 user-select:none 的部件不给选区），所以剪切/复制落在
 * 单元格文本上：编辑器内的选区 > 部件内的 DOM 选区 > 整格文本；粘贴优先用同进程的表格载荷。
 */
export function buildCellMenu(widget, view, position, event) {
  const source = cellClipboardSource(widget, position);
  const menu = new Menu(widget.app);
  menu.addItem((item) => item.setSection('clipboard').setIcon('lucide-scissors').setTitle(t('interface.menu.cut'))
    .setDisabled(!source).onClick(() => cutCellText(widget, view, position, source)));
  menu.addItem((item) => item.setSection('clipboard').setIcon('lucide-copy').setTitle(t('interface.menu.copy'))
    .setDisabled(!source).onClick(() => {
      if (!source) return;
      // 剪贴板现在装的是纯文本，同进程表格载荷随之失效（原版 obsidian/table 类型被覆盖）
      tableClipboard = null;
      writeClipboardText(source.text);
    }));
  menu.addItem((item) => item.setSection('clipboard').setIcon('lucide-clipboard-check').setTitle(t('interface.menu.paste'))
    .onClick(() => pasteIntoCell(widget, view, position)));
  menu.addSeparator();
  buildFormattingSubmenu(menu, widget, view, position);
  menu.addSeparator();
  widget.appendTableMenuItems(menu, position, view);
  menu.setParentElement(widget.containerEl);
  menu.showAtMouseEvent(event);
  return menu;
}

/** 单元格内可剪贴的文本；空单元格返回 null（原版 editFlags.canCut/canCopy 的等价判定）。 */
function cellClipboardSource(widget, position) {
  const editor = widget.edit && widget.edit.row === position.row && widget.edit.col === position.col
    ? widget.edit.textarea
    : null;
  if (editor && editor.selectionEnd > editor.selectionStart) {
    return { text: editor.value.slice(editor.selectionStart, editor.selectionEnd), from: 'editor' };
  }
  const dom = widgetTextSelection(widget);
  if (dom) return { text: dom.text, from: 'dom' };
  const model = widget.model();
  const text = model && model.rows[position.row] ? cellTextToInput(model.rows[position.row][position.col]) : '';
  return text ? { text, from: 'cell' } : null;
}

/** 部件内的 DOM 文本选区；没有选区返回 null。 */
function widgetTextSelection(widget) {
  const selection = window.getSelection ? window.getSelection() : null;
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!widget.containerEl || !widget.containerEl.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString();
  return text ? { text, range } : null;
}

/** 剪切：文本进剪贴板，并从来源（编辑器选区 / DOM 选区 / 整格）删掉它。 */
function cutCellText(widget, view, position, source) {
  if (!source) return false;
  tableClipboard = null;
  writeClipboardText(source.text);
  widget.deselectCells();
  if (source.from === 'editor') {
    const editor = widget.edit && widget.edit.row === position.row && widget.edit.col === position.col
      ? widget.edit.textarea
      : null;
    if (!editor) return true;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + editor.value.slice(end);
    editor.setSelectionRange(start, start);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const model = widget.model();
  const current = model && model.rows[position.row] ? model.rows[position.row][position.col] : null;
  if (current == null) return false;
  const index = source.from === 'cell' ? 0 : current.indexOf(source.text);
  if (index < 0) return true;
  const length = source.from === 'cell' ? current.length : source.text.length;
  const next = (current.slice(0, index) + current.slice(index + length)).trim();
  return widget.updateCell(view, position.row, position.col, next, null);
}

/** 粘贴：表格载荷从按下的单元格起写入；纯文本进编辑器光标处，否则整格替换。 */
async function pasteIntoCell(widget, view, position) {
  widget.deselectCells();
  widget.focusCell = { row: position.row, col: position.col };
  const payload = await readClipboardPayload();
  if (payload && payload.rows.length && payload.alignment.length) return pasteSelection(widget, view);
  const text = await readClipboardText();
  if (!text) return false;
  const editor = widget.edit && widget.edit.row === position.row && widget.edit.col === position.col
    ? widget.edit.textarea
    : null;
  if (editor) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    const caret = start + text.length;
    editor.setSelectionRange(caret, caret);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return widget.updateCell(view, position.row, position.col, cellTextFromInput(text), {
    focus: { row: position.row, col: position.col, selectAll: false },
  });
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
  const writeText = () => writeClipboardText(markdown);
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

/** 纯文本写剪贴板：navigator.clipboard 失败时退回隐藏 textarea + execCommand("copy")；两条路都留同进程副本。 */
export function writeClipboardText(text) {
  const value = String(text == null ? '' : text);
  textClipboard = value;
  const fallback = () => execCommandCopy(value);
  try {
    const written = navigator.clipboard.writeText(value);
    if (written && written.catch) written.catch(fallback);
    return true;
  } catch (error) {
    return fallback();
  }
}

/** 隐藏缓冲区：原版剪贴板兜底用的离屏 textarea（fixed + 透明 + 负 z-index）。 */
function clipboardBuffer() {
  const buffer = document.body.createEl('textarea');
  buffer.style.position = 'fixed';
  buffer.style.opacity = '0';
  buffer.style.zIndex = '-9999';
  return buffer;
}

function execCommandCopy(text) {
  try {
    const buffer = clipboardBuffer();
    buffer.value = text;
    buffer.focus();
    buffer.select();
    const copied = document.execCommand('copy');
    buffer.detach();
    return copied;
  } catch (error) {
    return false;
  }
}

/** 读系统剪贴板文本：navigator.clipboard 失败时退回 execCommand("paste")，再退回同进程副本。 */
export async function readClipboardText() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) return text;
  } catch (error) { /* 剪贴板不可用（窗口未聚焦/无权限） */ }
  return execCommandPaste() || textClipboard;
}

function execCommandPaste() {
  try {
    const buffer = clipboardBuffer();
    buffer.value = '';
    buffer.focus();
    const pasted = document.execCommand('paste');
    const text = pasted ? buffer.value : '';
    buffer.detach();
    return text || null;
  } catch (error) {
    return null;
  }
}

/** 从同进程缓存取原版 obsidian/table 载荷；没有时退回系统剪贴板里的 Markdown 表格。 */
async function readClipboardPayload() {
  if (tableClipboard) return tableClipboard;
  const text = await readClipboardText();
  const parsed = text ? parseTableText(text) : null;
  if (parsed) return { rows: parsed.rows, alignment: parsed.alignments };
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
