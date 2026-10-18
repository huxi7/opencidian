/**
 * [INPUT]: 依赖 @codemirror/view 的 WidgetType；依赖 core/menu.js 的 Menu、core/icons.js 的 setIcon、core/i18n.js 的 t；依赖 markdown/reading.js 的 getMarkdownIt 与 attachMarkdownInteractions；
 *          依赖 editor/table-model.js 的模型纯函数、table-drag.js 的手柄拖拽、table-selection.js 的矩形选区与剪贴板、table-edit.js 的原位置编辑。
 * [OUTPUT]: 导出 TableWidget，并转出 parseTableText、serializeTable、splitRow。
 * [POS]: editor/ 的实时预览表格部件，由 live-preview.js 的块层在表格块上实例化（构造时带 Markdown 文本与文档区间）。
 *        部件不保存可变文档状态：每个动作重新解析 this.text，经 view.dispatch 改写整块文本，DOM 由 CM6 重建；
 *        拖拽期间的选区与换格焦点经模块级 carriedState 交接给重建后的实例（原版 render() 末尾重放 selectionAnchor/Head 的等价物）。
 *        拖拽重排在 table-drag.js，选区菜单与剪贴板在 table-selection.js，单元格原位置编辑在 table-edit.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Live-preview table widget — the original `.cm-table-widget`:
 *   .table-wrapper > (table.table-editor + .table-row-btn + .table-col-btn)
 * per-cell `.table-row-drag-handle` / `.table-col-drag-handle` (lucide grip)
 * with drag reorder, rectangle cell selection, row / column / alignment /
 * sort / selection context menus and in-place cell editing.
 * The widget is a pure view of the markdown block it replaces: every edit
 * re-parses the stored text, mutates the model and dispatches the new text.
 */
import { WidgetType } from '@codemirror/view';
import { Menu } from '../core/menu.js';
import { setIcon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { getMarkdownIt, attachMarkdownInteractions } from '../markdown/reading.js';
import { clamp, moveInArray, parseTableText, serializeTable, splitRow } from './table-model.js';
import { attachDragHandle } from './table-drag.js';
import { attachCellSelection, cellElement, clampBounds, selectionBounds } from './table-selection.js';
import { beginCellEdit, enterFromCell, tabFromCell } from './table-edit.js';

export { parseTableText, serializeTable, splitRow };

/** 原版 lb：大小写不敏感、数字感知的排序比较器。 */
const compareText = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true }).compare;

/** 跨重建携带的视图状态（选区和换格焦点）；dispatch 后由新实例在 toDOM 里认领，未重建时 settle 落到当前实例。 */
let carriedState = null;

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
    this.containerEl = null;
    this.tableElement = null;
    this.selectionAnchor = null;
    this.selectionHead = null;
    this.selectedCells = [];
    this.focusCell = null;
    this.edit = null;
    this.suppressClick = false;
  }

  eq(other) {
    return other.text === this.text && other.from === this.from && other.to === this.to;
  }

  toDOM(view) {
    const container = createDiv({ cls: 'cm-embed-block cm-table-widget markdown-rendered' });
    container.tabIndex = -1;
    this.containerEl = container;
    const model = parseTableText(this.text);
    if (!model) {
      container.setText(this.text);
      return container;
    }
    const wrapper = container.createDiv('table-wrapper');
    const table = wrapper.createEl('table', { cls: 'table-editor' });
    table.tabIndex = -1;
    this.tableElement = table;
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

    container.addEventListener('click', (event) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      if (this.edit) return;
      const target = event.target;
      if (target !== container && !(target.closest && target.closest('.table-cell-wrapper'))) return;
      if (target.closest && (target.closest('a') || target.closest('.tag'))) return;
      const row = target.closest && target.closest('.table-cell-wrapper') ? target.closest('tr').rowIndex : 0;
      this.placeCursor(view, row);
    });
    container.addEventListener('keydown', (event) => {
      if (this.edit || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (this.selectionAnchor) { this.deselectCells(); event.preventDefault(); }
        return;
      }
      const start = this.selectionHead || this.focusCell || { row: 0, col: 0 };
      if (event.key === 'Tab') {
        event.preventDefault();
        this.deselectCells();
        tabFromCell(this, view, start.row, start.col, event.shiftKey);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.deselectCells();
        enterFromCell(this, view, start.row, start.col);
      }
    });
    attachCellSelection(this, view, container);

    if (this.app) attachMarkdownInteractions(this.app, container, () => this.sourcePath);
    const staged = carriedState;
    if (staged && staged.from === this.from && staged.text === this.text) {
      carriedState = null;
      this.applyState(view, staged);
    }
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
    handle.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || event.defaultPrevented) return;
      const tableEl = this.tableEl();
      if (!tableEl) return;
      attachDragHandle(this, view, { event, handle, axis, row, col, container: this.containerEl, tableEl });
    });
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
      menu.onHide = () => this.deselectCells();
    });
  }

  buildAddButton(wrapper, cls, title, action) {
    const button = wrapper.createDiv(cls);
    setIcon(button, 'lucide-plus');
    setTip(button, title);
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', action);
  }

  // ---- accessors ---------------------------------------------------------

  /** 当前 DOM 里的表格元素；实例与 DOM 生命周期不完全重合，查不到就回退到子树查询。 */
  tableEl() {
    if (this.tableElement && this.tableElement.isConnected) return this.tableElement;
    return this.containerEl ? this.containerEl.querySelector('table.table-editor') : null;
  }

  model() {
    return parseTableText(this.text);
  }

  cellElement(row, col) {
    return this.containerEl ? cellElement(this.containerEl, row, col) : null;
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
          onClick: () => this.insertRow(view, cell.row) },
        { section: 'table-add', icon: 'lucide-panel-bottom-close', title: t('table.action-row-after'),
          onClick: () => this.insertRow(view, cell.row + 1) },
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

  /** 写回整块文本；state 里的选区/焦点交给重建后的实例认领。 */
  dispatch(view, model, state) {
    const range = this.range(view);
    if (!range) return false;
    const text = serializeTable(model.rows, model.alignments);
    if (state) carriedState = { from: range.from, text, ...state };
    view.dispatch({ changes: { from: range.from, to: range.to, insert: text } });
    this.settle(view);
    return true;
  }

  /** 没触发重建（文本等价）时，携带状态落到当前实例。 */
  settle(view) {
    const staged = carriedState;
    if (!staged) return;
    if (staged.from === this.from && staged.text === this.text) this.applyState(view, staged);
    carriedState = null;
  }

  applyState(view, state) {
    if (!state) return;
    if (state.selection) this.selectCells(view, state.selection.anchor, state.selection.head);
    if (state.focus) beginCellEdit(this, view, state.focus.row, state.focus.col, { selectAll: !!state.focus.selectAll });
  }

  removeTable(view) {
    const range = this.range(view);
    if (!range) return;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: '' }, selection: { anchor: range.from } });
    view.focus();
  }

  /** 点击单元格/容器：光标落到对应源码行，部件让位给原始 Markdown（T0 验收锁定的行为）。 */
  placeCursor(view, row) {
    const range = this.range(view);
    if (!range) return;
    const doc = view.state.doc;
    const firstLine = doc.lineAt(range.from).number;
    const lineNo = clamp(firstLine + (row === 0 ? 0 : row + 1), 1, doc.lines);
    view.dispatch({ selection: { anchor: doc.line(lineNo).from } });
    view.focus();
  }

  focusContainer() {
    if (!this.containerEl || !this.containerEl.isConnected) return;
    try { this.containerEl.focus({ preventScroll: true }); } catch (error) { this.containerEl.focus(); }
  }

  // ---- selection ---------------------------------------------------------

  /** 原版 selectCells：单格 anchor===head 时只清空旧选区；否则按矩形打 is-selected 系列类。 */
  selectCells(view, anchor, head, dragging) {
    this.deselectCells();
    if (!anchor || !head) return;
    if (anchor.row === head.row && anchor.col === head.col) return;
    const model = this.model();
    if (!model) return;
    const bounds = clampBounds(selectionBounds(anchor, head), model.rows.length, model.alignments.length);
    if (!bounds) return;
    this.selectionAnchor = anchor;
    this.selectionHead = head;
    const cells = [];
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        const cell = this.cellElement(row, col);
        if (!cell) continue;
        const classes = ['is-selected'];
        if (dragging) classes.push('mod-dragging');
        if (col === bounds.minCol) classes.push('start');
        if (col === bounds.maxCol) classes.push('end');
        if (row === bounds.minRow) classes.push('top');
        if (row === bounds.maxRow) classes.push('bottom');
        cell.addClasses(classes);
        cells.push(cell);
      }
    }
    this.selectedCells = cells;
    if (this.containerEl) this.containerEl.addClass('has-selection');
  }

  deselectCells() {
    for (const cell of this.selectedCells) {
      cell.removeClasses(['mod-dragging', 'is-selected', 'start', 'end', 'top', 'bottom']);
    }
    this.selectedCells = [];
    this.selectionAnchor = null;
    this.selectionHead = null;
    if (this.containerEl) this.containerEl.removeClass('has-selection');
  }

  /** 当前选区的行列范围（夹回表格内）；无选区返回 null。 */
  getSelectionBounds() {
    const model = this.model();
    if (!model) return null;
    return clampBounds(selectionBounds(this.selectionAnchor, this.selectionHead), model.rows.length, model.alignments.length);
  }

  // ---- selection actions -------------------------------------------------

  /** 原版 actionClearSelection：选中格文本清空，保持选区。 */
  clearSelectedCells(view) {
    const model = this.model();
    const bounds = this.getSelectionBounds();
    if (!model || !bounds) return;
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) model.rows[row][col] = '';
    }
    this.dispatch(view, model, { selection: { anchor: this.selectionAnchor, head: this.selectionHead } });
  }

  /** 原版 actionDeleteSelection → deleteSelection(-1)：整表删块、整行/整列删行/列、矩形清空单元格。 */
  deleteSelection(view, edge) {
    const model = this.model();
    const bounds = this.getSelectionBounds();
    if (!model || !bounds) return;
    const { minRow, maxRow, minCol, maxCol } = bounds;
    const lastCol = model.alignments.length - 1;
    const lastRow = model.rows.length - 1;
    const head = this.selectionHead || { row: minRow, col: minCol };
    this.deselectCells();
    if (minCol === 0 && maxCol === lastCol) {
      if (minRow === 0 && maxRow === lastRow) {
        this.removeTable(view);
        return;
      }
      model.rows.splice(minRow, maxRow - minRow + 1);
      this.dispatch(view, model, { focus: { row: edge === -1 ? minRow - 1 : minRow, col: head.col } });
      return;
    }
    if (minRow === 0 && maxRow === lastRow) {
      model.alignments.splice(minCol, maxCol - minCol + 1);
      for (const row of model.rows) row.splice(minCol, maxCol - minCol + 1);
      this.dispatch(view, model, { focus: { row: head.row, col: edge === -1 ? minCol - 1 : minCol } });
      return;
    }
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) model.rows[row][col] = '';
    }
    this.dispatch(view, model, { focus: { row: edge === -1 ? minRow : maxRow, col: edge === -1 ? minCol : maxCol } });
  }

  /** 对齐应用到选区覆盖的所有列（原版 makeAlignmentMenu 的列集合）。 */
  setSelectionAlignment(view, align) {
    const model = this.model();
    const bounds = this.getSelectionBounds();
    if (!model || !bounds) return;
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) model.alignments[col] = align;
    this.dispatch(view, model, { selection: { anchor: this.selectionAnchor, head: this.selectionHead } });
  }

  // ---- actions (each rebuilds the markdown from the current text) --------

  insertRow(view, index, state) {
    const model = this.model();
    if (!model) return;
    const at = clamp(index, 0, model.rows.length);
    model.rows.splice(at, 0, new Array(model.alignments.length).fill(''));
    const next = state && state.focus ? { ...state, focus: { ...state.focus, row: at } } : state;
    this.dispatch(view, model, next);
  }

  duplicateRow(view, index) {
    const model = this.model();
    if (!model || index < 0 || index >= model.rows.length) return;
    model.rows.splice(index, 0, model.rows[index].slice());
    this.dispatch(view, model);
  }

  moveRow(view, from, to, state) {
    const model = this.model();
    if (!model || to < 0 || to >= model.rows.length) return;
    moveInArray(model.rows, from, to);
    this.dispatch(view, model, state);
  }

  removeRow(view, index) {
    const model = this.model();
    if (!model || index < 0 || index >= model.rows.length) return;
    if (model.rows.length === 1) {
      this.removeTable(view);
      return;
    }
    model.rows.splice(index, 1);
    this.dispatch(view, model);
  }

  insertColumn(view, index, align) {
    const model = this.model();
    if (!model) return;
    const at = clamp(index, 0, model.alignments.length);
    model.alignments.splice(at, 0, align || null);
    for (const row of model.rows) row.splice(at, 0, '');
    this.dispatch(view, model);
  }

  duplicateColumn(view, index) {
    const model = this.model();
    if (!model || index < 0 || index >= model.alignments.length) return;
    const align = model.alignments[index];
    model.alignments.splice(index + 1, 0, align);
    for (const row of model.rows) row.splice(index + 1, 0, row[index]);
    this.dispatch(view, model);
  }

  moveColumn(view, from, to, state) {
    const model = this.model();
    if (!model || to < 0 || to >= model.alignments.length) return;
    moveInArray(model.alignments, from, to);
    for (const row of model.rows) moveInArray(row, from, to);
    this.dispatch(view, model, state);
  }

  removeColumn(view, index) {
    const model = this.model();
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
    const model = this.model();
    if (!model || col < 0 || col >= model.alignments.length) return;
    model.alignments[col] = align;
    this.dispatch(view, model);
  }

  /** 单元格文本写回：内容不变时只按 state 移动焦点，不写文档。 */
  updateCell(view, row, col, text, state) {
    const model = this.model();
    if (!model || !model.rows[row] || model.rows[row][col] === undefined) return false;
    if (model.rows[row][col] === text) {
      if (state) this.applyState(view, state);
      return false;
    }
    model.rows[row][col] = text;
    this.dispatch(view, model, state);
    return true;
  }

  /** 排序表体（保留表头），比较单元格原文；reverse 即 Z→A。 */
  sortColumn(view, col, reverse) {
    const model = this.model();
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
