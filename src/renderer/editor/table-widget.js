/**
 * [INPUT]: 依赖 @codemirror/view 的 WidgetType；依赖 core/menu.js 的 Menu、core/icons.js 的 setIcon、core/i18n.js 的 t；依赖 markdown/reading.js 的 getMarkdownIt 与 attachMarkdownInteractions。
 * [OUTPUT]: 导出 TableWidget 与 parseTableText、serializeTable、splitRow 纯函数。
 * [POS]: editor/ 的实时预览表格部件，由 live-preview.js 的块层在表格块上实例化（构造时带 Markdown 文本与文档区间）。部件不保存可变状态：每个动作都重新解析 this.text，经 view.dispatch 改写文档，DOM 由 CM6 重建。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Live-preview table widget — the original `.cm-table-widget`:
 *   .table-wrapper > (table.table-editor + .table-row-btn + .table-col-btn)
 * per-cell `.table-row-drag-handle` / `.table-col-drag-handle` (lucide grip)
 * with row / column / alignment / sort context menus.
 * The widget is a pure view of the markdown block it replaces: every edit
 * re-parses the stored text, mutates the model and dispatches the new text.
 */
import { WidgetType } from '@codemirror/view';
import { Menu } from '../core/menu.js';
import { setIcon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { getMarkdownIt, attachMarkdownInteractions } from '../markdown/reading.js';

/** 列最小宽度。原版从 5 起算；这里取 7，使任意对齐的分隔行都至少三个连字符（居中是 `:---:`）。 */
const MIN_COL_WIDTH = 7;
/** 原版 lb：大小写不敏感、数字感知的排序比较器。 */
const compareText = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true }).compare;

// ---------------------------------------------------------------------------
// Table model — parse / serialize (mirrors the original getTableString)
// ---------------------------------------------------------------------------

/** 拆一行表格：按未转义的 `|` 切分，去掉首尾空段，单元格取 trim 后的原文。 */
export function splitRow(line) {
  let body = String(line == null ? '' : line).trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let current = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '\\' && index + 1 < body.length) {
      current += char + body[index + 1];
      index++;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** 分隔行单元格 → 对齐：`:--` 左、`:-:` 中、`--:` 右、`---` 默认（null）。 */
function parseAlignment(cell) {
  const value = String(cell == null ? '' : cell).trim();
  if (!/^:?-+:?$/.test(value)) return null;
  const start = value.startsWith(':');
  const end = value.endsWith(':');
  if (start && end) return 'center';
  if (start) return 'left';
  if (end) return 'right';
  return null;
}

/** 解析表格 Markdown 为 { rows, alignments }；rows[0] 是表头行，分隔行不入模型。 */
export function parseTableText(text) {
  const lines = String(text == null ? '' : text).split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delimiter = splitRow(lines[1]);
  if (!header.length || header.length !== delimiter.length) return null;
  if (!delimiter.every((cell) => /^:?-+:?$/.test(cell))) return null;
  const alignments = delimiter.map(parseAlignment);
  const rows = [header];
  for (let index = 2; index < lines.length; index++) rows.push(splitRow(lines[index]));
  for (const row of rows) {
    while (row.length < alignments.length) row.push('');
    row.length = alignments.length;
  }
  return { rows, alignments };
}

/** 分隔行：镜像原版 makeAlignmentRow 的冒号与连字符写回。 */
function alignmentRow(alignments, widths) {
  let line = '';
  for (let col = 0; col < alignments.length; col++) {
    const width = Math.max(MIN_COL_WIDTH, widths[col]);
    switch (alignments[col]) {
      case 'left': line += '| :' + '-'.repeat(width - 3) + ' '; break;
      case 'center': line += '| :' + '-'.repeat(width - 4) + ': '; break;
      case 'right': line += '| ' + '-'.repeat(width - 3) + ': '; break;
      default: line += '| ' + '-'.repeat(width - 2) + ' ';
    }
  }
  return line + '|';
}

/** 序列化回 Markdown：单元格按列宽补空格，左/中/右对齐决定留白位置。 */
export function serializeTable(rows, alignments) {
  const colCount = alignments.length;
  const widths = new Array(colCount).fill(MIN_COL_WIDTH);
  for (const row of rows) {
    for (let col = 0; col < colCount; col++) {
      widths[col] = Math.max(widths[col], String(row[col] == null ? '' : row[col]).length + 2);
    }
  }
  const lines = [];
  for (let index = 0; index < rows.length; index++) {
    let line = '';
    for (let col = 0; col < colCount; col++) {
      const cell = String(rows[index][col] == null ? '' : rows[index][col]);
      const pad = Math.max(2, widths[col] - cell.length);
      let left = 1;
      let right = pad - 1;
      if (alignments[col] === 'right') { left = pad - 1; right = 1; }
      else if (alignments[col] === 'center') { left = Math.floor(pad / 2); right = Math.ceil(pad / 2); }
      line += '|' + ' '.repeat(left) + cell + ' '.repeat(right);
    }
    lines.push(line + '|');
    if (index === 0) lines.push(alignmentRow(alignments, widths));
  }
  return lines.join('\n');
}

/** 原版 ac：把数组元素从 from 移到 to。 */
function moveInArray(array, from, to) {
  const value = array.splice(from, 1)[0];
  array.splice(to, 0, value);
  return array;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 单元格内容：按行内 Markdown 渲染（链接/强调/wiki 链接），失败时退回纯文本。 */
function renderCellHtml(app, text, sourcePath) {
  if (!text) return '';
  try {
    return getMarkdownIt().renderInline(text, { app, sourcePath, depth: 0 });
  } catch (error) {
    console.error('table widget cell render failed', error);
    const span = createSpan();
    span.setText(text);
    return span.outerHTML;
  }
}

function setTip(el, text) {
  if (typeof el.setTooltip === 'function') el.setTooltip(text);
  else el.setAttr('aria-label', text);
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export class TableWidget extends WidgetType {
  constructor(app, text, sourcePath, from, to) {
    super();
    this.app = app;
    this.text = text;
    this.sourcePath = sourcePath || '';
    this.from = from;
    this.to = to;
  }

  eq(other) {
    return other.text === this.text && other.from === this.from && other.to === this.to;
  }

  toDOM(view) {
    const container = createDiv({ cls: 'cm-embed-block cm-table-widget markdown-rendered' });
    container.addEventListener('pointerdown', (event) => {
      if (event.target === container) event.preventDefault();
    });
    container.addEventListener('click', (event) => {
      const target = event.target;
      if (target !== container && !(target.closest && target.closest('.table-cell-wrapper'))) return;
      if (target.closest && (target.closest('a') || target.closest('.tag'))) return;
      const row = target.closest && target.closest('.table-cell-wrapper')
        ? target.closest('tr').rowIndex
        : 0;
      this.placeCursor(view, row);
    });
    const model = parseTableText(this.text);
    if (!model) {
      container.setText(this.text);
      return container;
    }
    const wrapper = container.createDiv('table-wrapper');
    const table = wrapper.createEl('table', { cls: 'table-editor' });
    table.tabIndex = -1;
    const head = table.createEl('thead');
    const headRow = head.createEl('tr');
    for (let col = 0; col < model.alignments.length; col++) {
      this.buildCell(headRow, 'th', model, 0, col, view);
    }
    const body = table.createEl('tbody');
    for (let row = 1; row < model.rows.length; row++) {
      const rowEl = body.createEl('tr');
      for (let col = 0; col < model.alignments.length; col++) {
        this.buildCell(rowEl, 'td', model, row, col, view);
      }
    }
    this.buildAddButton(wrapper, 'table-row-btn', t('table.action-row-after'),
      () => this.insertRow(view, model.rows.length));
    this.buildAddButton(wrapper, 'table-col-btn', t('table.action-column-after'),
      () => this.insertColumn(view, model.alignments.length, null));
    if (this.app) attachMarkdownInteractions(this.app, container, () => this.sourcePath);
    return container;
  }

  // ---- DOM ---------------------------------------------------------------

  buildCell(rowEl, tag, model, row, col, view) {
    const cell = rowEl.createEl(tag);
    const align = model.alignments[col];
    if (align) cell.setAttr('align', align);
    const wrapper = cell.createDiv('table-cell-wrapper');
    wrapper.innerHTML = renderCellHtml(this.app, model.rows[row][col], this.sourcePath);
    if (!wrapper.firstChild) wrapper.createEl('br');
    if (row === 0) this.buildDragHandle(cell, 'col', row, col, view);
    if (col === 0) this.buildDragHandle(cell, 'row', row, col, view);
    return cell;
  }

  buildDragHandle(cell, axis, row, col, view) {
    const handle = cell.createDiv('table-' + axis + '-drag-handle');
    setIcon(handle, axis === 'col' ? 'lucide-grip-horizontal' : 'lucide-grip-vertical');
    handle.dataset.ignoreSwipe = 'true';
    handle.addEventListener('pointerdown', (event) => event.preventDefault());
    handle.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const model = parseTableText(this.text);
      if (!model) return;
      const target = { row, col };
      const menu = new Menu(this.app);
      if (axis === 'col') {
        this.makeSortMenu(menu, target, view);
        this.makeColMenu(menu, model, target, view);
      } else {
        this.makeRowMenu(menu, model, target, view);
      }
      menu.setParentElement(handle);
      menu.showAtMouseEvent(event);
    });
  }

  buildAddButton(wrapper, cls, title, action) {
    const button = wrapper.createDiv(cls);
    setIcon(button, 'lucide-plus');
    setTip(button, title);
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', action);
  }

  // ---- menus -------------------------------------------------------------

  /** 按组添加条目，只在非空组之间插入分隔线（原版 setSection 的视觉语义）。 */
  addMenuGroups(menu, groups) {
    groups.filter((group) => group.length).forEach((group, index) => {
      if (index > 0) menu.addSeparator();
      for (const entry of group) {
        menu.addItem((item) => item
          .setSection(entry.section)
          .setIcon(entry.icon)
          .setTitle(entry.title)
          .onClick(entry.onClick));
      }
    });
  }

  makeRowMenu(menu, model, cell, view) {
    const rowCount = model.rows.length;
    this.addMenuGroups(menu, [
      [
        { section: 'table-add', icon: 'lucide-panel-top-close', title: t('table.action-row-before'),
          onClick: () => this.insertRow(view, cell.row, cell.col) },
        { section: 'table-add', icon: 'lucide-panel-bottom-close', title: t('table.action-row-after'),
          onClick: () => this.insertRow(view, cell.row + 1, cell.col) },
      ],
      [
        cell.row > 0 ? { section: 'table-move', icon: 'lucide-arrow-up', title: t('table.action-row-up'),
          onClick: () => this.moveRow(view, cell.row, cell.row - 1) } : null,
        cell.row < rowCount - 1 ? { section: 'table-move', icon: 'lucide-arrow-down', title: t('table.action-row-down'),
          onClick: () => this.moveRow(view, cell.row, cell.row + 1) } : null,
      ].filter(Boolean),
      [
        { section: 'table-modify', icon: 'lucide-copy', title: t('table.action-duplicate-row'),
          onClick: () => this.duplicateRow(view, cell.row) },
        { section: 'table-modify', icon: 'lucide-trash-2', title: t('table.action-delete-row'),
          onClick: () => this.removeRow(view, cell.row) },
      ],
    ]);
  }

  makeSortMenu(menu, cell, view) {
    this.addMenuGroups(menu, [[
      { section: 'table-sort', icon: 'lucide-arrow-down-az', title: t('table.action-sort-a-z'),
        onClick: () => this.sortColumn(view, cell.col, false) },
      { section: 'table-sort', icon: 'lucide-arrow-up-za', title: t('table.action-sort-z-a'),
        onClick: () => this.sortColumn(view, cell.col, true) },
    ]]);
  }

  makeColMenu(menu, model, cell, view) {
    const colCount = model.alignments.length;
    const align = model.alignments[cell.col];
    this.addMenuGroups(menu, [
      [
        { section: 'table-add', icon: 'lucide-panel-left-close', title: t('table.action-column-before'),
          onClick: () => this.insertColumn(view, cell.col, align) },
        { section: 'table-add', icon: 'lucide-panel-right-close', title: t('table.action-column-after'),
          onClick: () => this.insertColumn(view, cell.col + 1, align) },
      ],
      [
        cell.col > 0 ? { section: 'table-move', icon: 'lucide-arrow-left', title: t('table.action-column-left'),
          onClick: () => this.moveColumn(view, cell.col, cell.col - 1) } : null,
        cell.col < colCount - 1 ? { section: 'table-move', icon: 'lucide-arrow-right', title: t('table.action-column-right'),
          onClick: () => this.moveColumn(view, cell.col, cell.col + 1) } : null,
      ].filter(Boolean),
      [
        { section: 'table-align', icon: 'lucide-align-left', title: t('table.action-align-left'),
          onClick: () => this.setAlignment(view, cell.col, 'left') },
        { section: 'table-align', icon: 'lucide-align-center', title: t('table.action-align-center'),
          onClick: () => this.setAlignment(view, cell.col, 'center') },
        { section: 'table-align', icon: 'lucide-align-right', title: t('table.action-align-right'),
          onClick: () => this.setAlignment(view, cell.col, 'right') },
      ],
      [
        { section: 'table-modify', icon: 'lucide-copy', title: t('table.action-duplicate-column'),
          onClick: () => this.duplicateColumn(view, cell.col) },
        { section: 'table-modify', icon: 'lucide-trash-2', title: t('table.action-delete-column'),
          onClick: () => this.removeColumn(view, cell.col) },
      ],
    ]);
  }

  // ---- document plumbing -------------------------------------------------

  /** 表格块在文档中的真实区间；位置被其它编辑改动时按文本回退查找，找不到返回 null。 */
  range(view) {
    const doc = view.state.doc;
    if (this.from <= this.to && this.to <= doc.length && doc.sliceString(this.from, this.to) === this.text) {
      return { from: this.from, to: this.to };
    }
    const index = doc.toString().indexOf(this.text);
    return this.text && index >= 0 ? { from: index, to: index + this.text.length } : null;
  }

  dispatch(view, model) {
    const range = this.range(view);
    if (!range) return false;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: serializeTable(model.rows, model.alignments) } });
    return true;
  }

  removeTable(view) {
    const range = this.range(view);
    if (!range) return;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: '' }, selection: { anchor: range.from } });
    view.focus();
  }

  /** 点击单元格/容器：光标落到对应源码行，部件让位给原始 Markdown。 */
  placeCursor(view, row) {
    const range = this.range(view);
    if (!range) return;
    const doc = view.state.doc;
    const firstLine = doc.lineAt(range.from).number;
    const lineNo = clamp(firstLine + (row === 0 ? 0 : row + 1), 1, doc.lines);
    view.dispatch({ selection: { anchor: doc.line(lineNo).from } });
    view.focus();
  }

  // ---- actions (each rebuilds the markdown from the current text) --------

  insertRow(view, index) {
    const model = parseTableText(this.text);
    if (!model) return;
    const at = clamp(index, 0, model.rows.length);
    model.rows.splice(at, 0, new Array(model.alignments.length).fill(''));
    this.dispatch(view, model);
  }

  duplicateRow(view, index) {
    const model = parseTableText(this.text);
    if (!model || index < 0 || index >= model.rows.length) return;
    model.rows.splice(index, 0, model.rows[index].slice());
    this.dispatch(view, model);
  }

  moveRow(view, from, to) {
    const model = parseTableText(this.text);
    if (!model || to < 0 || to >= model.rows.length) return;
    moveInArray(model.rows, from, to);
    this.dispatch(view, model);
  }

  removeRow(view, index) {
    const model = parseTableText(this.text);
    if (!model || index < 0 || index >= model.rows.length) return;
    if (model.rows.length === 1) {
      this.removeTable(view);
      return;
    }
    model.rows.splice(index, 1);
    this.dispatch(view, model);
  }

  insertColumn(view, index, align) {
    const model = parseTableText(this.text);
    if (!model) return;
    const at = clamp(index, 0, model.alignments.length);
    model.alignments.splice(at, 0, align || null);
    for (const row of model.rows) row.splice(at, 0, '');
    this.dispatch(view, model);
  }

  duplicateColumn(view, index) {
    const model = parseTableText(this.text);
    if (!model || index < 0 || index >= model.alignments.length) return;
    const align = model.alignments[index];
    model.alignments.splice(index + 1, 0, align);
    for (const row of model.rows) row.splice(index + 1, 0, row[index]);
    this.dispatch(view, model);
  }

  moveColumn(view, from, to) {
    const model = parseTableText(this.text);
    if (!model || to < 0 || to >= model.alignments.length) return;
    moveInArray(model.alignments, from, to);
    for (const row of model.rows) moveInArray(row, from, to);
    this.dispatch(view, model);
  }

  removeColumn(view, index) {
    const model = parseTableText(this.text);
    if (!model || index < 0 || index >= model.alignments.length) return;
    if (model.alignments.length === 1) {
      this.removeTable(view);
      return;
    }
    model.alignments.splice(index, 1);
    for (const row of model.rows) row.splice(index, 1);
    this.dispatch(view, model);
  }

  setAlignment(view, col, align) {
    const model = parseTableText(this.text);
    if (!model || col < 0 || col >= model.alignments.length) return;
    model.alignments[col] = align;
    this.dispatch(view, model);
  }

  /** 排序表体（保留表头），比较单元格原文；reverse 即 Z→A。 */
  sortColumn(view, col, reverse) {
    const model = parseTableText(this.text);
    if (!model || col < 0 || col >= model.alignments.length) return;
    const head = model.rows[0];
    const body = model.rows.slice(1).sort((left, right) => {
      const order = compareText(String(left[col] == null ? '' : left[col]), String(right[col] == null ? '' : right[col]));
      return reverse ? -order : order;
    });
    model.rows = [head].concat(body);
    this.dispatch(view, model);
  }
}
