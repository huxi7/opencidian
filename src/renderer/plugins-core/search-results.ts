/**
 * [INPUT]: 滚动容器（.search-result-container）、结果子容器（.search-results-children）、
 *          vault 命中的结果集（file + doc + evaluation）、折叠状态与更多上下文开关。
 * [OUTPUT]: SearchVirtualList（视口窗口/行高实测/占位块）与 SearchResults（分组模型、渲染、焦点、计数、悬停预览）。
 * [POS]: global-search 的结果列表内核。对齐原版 QW（SearchResults）+ uO（InfinityScroll）：
 *        只渲染视口内的结果组，上下占位块撑出总高使滚动条与总条目数成比例；
 *        折叠分组不参与键盘导航，命中行可按段落边界向上/向下展开上下文；
 *        悬停结果行抛 workspace 的 hover-link（source=search），由 page-preview 弹页面预览。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createDiv } from '../core/dom.js';
import { setIcon } from '../core/icons.js';
import { t } from '../core/i18n.js';

const BUFFER_RATIO = 0.25;
const MIN_BUFFER = 300;
const DEFAULT_ROW_HEIGHT = 30;
const MAX_MEASURE_PASS = 3;

/* ------------------------------------------------------------ 虚拟窗口 */

export class SearchVirtualList {
  declare scrollEl: any;
  declare childrenEl: any;
  declare renderGroup: any;
  declare onRender: any;
  declare groups: any[];
  declare groupHeights: any;
  declare rowHeights: any;
  declare rowElements: any;
  declare groupElements: any;
  declare samples: any;
  declare range: any;
  declare _pass: number;
  declare _onScroll: any;
  declare topSpacer: any;
  declare bottomSpacer: any;

  constructor(options) {
    this.scrollEl = options.scrollEl;
    this.childrenEl = options.childrenEl;
    this.renderGroup = options.renderGroup;
    this.onRender = options.onRender || (() => {});
    this.groups = [];
    this.groupHeights = new Map();
    this.rowHeights = new Map();
    this.rowElements = new Map();
    this.groupElements = new Map();
    this.samples = { file: { sum: 0, n: 0 }, match: { sum: 0, n: 0 } };
    this.range = { start: 0, end: 0, top: 0, total: 0 };
    this._pass = 0;
    this._onScroll = () => this.render();
    this.scrollEl.addEventListener('scroll', this._onScroll, { passive: true });
    this.topSpacer = createDiv('search-results-spacer');
    this.bottomSpacer = createDiv('search-results-spacer');
  }

  /** 换一批结果：重建组模型并重绘（行高缓存保留，同名行仍复用实测高度）。 */
  setGroups(groups) {
    this.groups = groups || [];
    this.render();
  }

  /** 清空行高缓存：内容变化后重新实测。 */
  resetHeights() {
    this.groupHeights.clear();
    this.rowHeights.clear();
    this.samples = { file: { sum: 0, n: 0 }, match: { sum: 0, n: 0 } };
  }

  destroy() {
    this.scrollEl.removeEventListener('scroll', this._onScroll);
    this.groupElements.clear();
    this.rowElements.clear();
  }

  /** 行 key → 渲染出的 DOM 元素（未在窗口内则为空）。 */
  elementOf(key) {
    const entry = this.rowElements.get(key);
    return entry ? entry.el : null;
  }

  /** 行高估值：实测优先，其次同类均值，最后固定值。 */
  _heightOf(row) {
    const measured = this.rowHeights.get(row.key);
    if (measured) return measured;
    if (row.height) return row.height;
    const sample = this.samples[row.kind];
    if (sample && sample.n) return sample.sum / sample.n;
    return DEFAULT_ROW_HEIGHT;
  }

  /** 组偏移表：已渲染过的组用实测高，未渲染的组用行高估值求和。 */
  _layout() {
    const layout = [];
    let offset = 0;
    for (const group of this.groups) {
      const measured = this.groupHeights.get(group.key);
      let height = measured;
      if (!height) {
        height = 0;
        for (const row of group.rows) height += this._heightOf(row);
      }
      layout.push({ group, start: offset, end: offset + height, height });
      offset += height;
    }
    return layout;
  }

  render() {
    this.rowElements.clear();
    if (!this.groups.length) {
      this.childrenEl.empty();
      this.range = { start: 0, end: 0, top: 0, total: 0 };
      this.onRender(this.range);
      return;
    }
    const layout = this._layout();
    const total = layout[layout.length - 1].end;
    const viewHeight = this.scrollEl.clientHeight || 0;
    const scrollTop = this.scrollEl.scrollTop;
    const buffer = Math.max(viewHeight * BUFFER_RATIO, MIN_BUFFER);
    const top = scrollTop - buffer;
    const bottom = scrollTop + viewHeight + buffer;
    let first = -1;
    let last = -1;
    for (let i = 0; i < layout.length; i++) {
      const item = layout[i];
      if (item.end < top) continue;
      if (item.start > bottom) break;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) { first = layout.length - 1; last = layout.length - 1; }
    if (!viewHeight) {
      // 视口尚未布局（首帧）：先渲染全部，随后由 onResize/滚动事件收敛到窗口
      first = 0;
      last = layout.length - 1;
    }

    const children = [];
    this.topSpacer.style.height = layout[first].start + 'px';
    children.push(this.topSpacer);
    for (let i = first; i <= last; i++) {
      const group = layout[i].group;
      let el = this.groupElements.get(group.key);
      if (!el) {
        el = createDiv();
        this.groupElements.set(group.key, el);
      }
      this.renderGroup(group, el, (key, rowEl, kind) => this.rowElements.set(key, { el: rowEl, kind }));
      children.push(el);
    }
    this.bottomSpacer.style.height = Math.max(0, total - layout[last].end) + 'px';
    children.push(this.bottomSpacer);
    this._setChildren(children);
    this.range = { start: first, end: last, top: layout[first].start, total };
    this._measure();
    this.onRender(this.range);
  }

  /** 把行滚进视口：行不在窗口内时改写 scrollTop，随后重绘窗口。 */
  scrollToRow(key) {
    const layout = this._layout();
    for (let i = 0; i < layout.length; i++) {
      const item = layout[i];
      const index = item.group.rows.findIndex((row) => row.key === key);
      if (index < 0) continue;
      let offset = item.start;
      for (let r = 0; r < index; r++) offset += this._heightOf(item.group.rows[r]);
      const height = this._heightOf(item.group.rows[index]);
      const view = this.scrollEl.clientHeight || 0;
      let target = this.scrollEl.scrollTop;
      if (offset < target) target = offset;
      else if (offset + height > target + view) target = offset + height - view;
      if (target !== this.scrollEl.scrollTop) this.scrollEl.scrollTop = Math.max(0, target);
      this.render();
      return true;
    }
    return false;
  }

  /** 实测窗口内行高与组高：变了就重排一次（最多三遍，避免抖动）。 */
  _measure() {
    if (this._pass >= MAX_MEASURE_PASS) return;
    this.samples = { file: { sum: 0, n: 0 }, match: { sum: 0, n: 0 } };
    let changed = false;
    for (const [key, entry] of this.rowElements) {
      const height = entry.el.offsetHeight;
      if (!height) continue;
      if (this.rowHeights.get(key) !== height) {
        this.rowHeights.set(key, height);
        changed = true;
      }
      const sample = this.samples[entry.kind];
      if (sample) { sample.sum += height; sample.n++; }
    }
    for (const [key, el] of this.groupElements) {
      const height = el.offsetHeight;
      if (!height) continue;
      if (this.groupHeights.get(key) !== height) {
        this.groupHeights.set(key, height);
        changed = true;
      }
    }
    if (!changed) return;
    this._pass++;
    const savedTop = this.scrollEl.scrollTop;
    this.render();
    if (this.scrollEl.scrollTop !== savedTop) this.scrollEl.scrollTop = savedTop;
    this._pass--;
  }

  /** 原版 setChildrenInPlace：保留仍在用的节点，按目标顺序就地换位。 */
  _setChildren(list) {
    const parent = this.childrenEl;
    const wanted = new Set(list);
    for (const el of [...parent.children]) {
      if (!wanted.has(el)) el.remove();
    }
    let anchor = parent.firstChild;
    for (const el of list) {
      if (el === anchor) { anchor = anchor.nextSibling; continue; }
      parent.insertBefore(el, anchor);
    }
  }
}

/* ---------------------------------------------------------- 结果列表 */

function setHighlighted(el, text, ranges) {
  el.empty();
  if (!text) return;
  const sorted = (ranges || [])
    .filter((range) => range && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  for (const range of sorted) {
    const start = Math.max(cursor, Math.min(text.length, range.start));
    const end = Math.max(start, Math.min(text.length, range.end));
    if (start > cursor) el.appendText(text.slice(cursor, start));
    if (end > start) el.createSpan({ cls: 'search-result-file-matched-text', text: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) el.appendText(text.slice(cursor));
}

/**
 * 结果列表：持有结果集、分组模型、虚拟窗口与焦点。
 * results 项结构：{ file, doc, evaluation }，evaluation 需含 content/fields/properties/score/flair。
 */
export class SearchResults {
  declare app: App;
  declare scrollEl: any;
  declare childrenEl: any;
  declare onOpenFile: any;
  declare onContextMenu: any;
  declare _results: any[];
  declare _collapsed: any;
  declare _collapseAll: boolean;
  declare _extraContext: boolean;
  declare _expanded: any;
  declare _groups: any[];
  declare _focusRows: any[];
  declare _focusedIndex: number;
  declare _focusEl: any;
  declare _virtual: SearchVirtualList;

  constructor(options) {
    this.app = options.app;
    this.scrollEl = options.scrollEl;
    this.childrenEl = options.childrenEl;
    this.onOpenFile = options.onOpenFile || (() => {});
    this.onContextMenu = options.onContextMenu || (() => {});
    this._results = [];
    this._collapsed = new Map();
    this._collapseAll = false;
    this._extraContext = false;
    this._expanded = new Map();
    this._groups = [];
    this._focusRows = [];
    this._focusedIndex = -1;
    this._focusEl = null;
    this._virtual = new SearchVirtualList({
      scrollEl: this.scrollEl,
      childrenEl: this.childrenEl,
      renderGroup: (group, el, track) => this._renderGroup(group, el, track),
      onRender: () => this._restoreFocus(),
    });
  }

  dispose() {
    this._virtual.destroy();
  }

  /** 视口变化后重绘窗口（原版 onResize → infinityScroll.onResize）。 */
  render() {
    this._virtual.render();
  }

  /* ------------------------------------------------------------ 数据 */

  setResults(results) {
    this._results = results || [];
    this._expanded.clear();
    this._virtual.resetHeights();
    this.rebuild();
  }

  getFiles() {
    return this._results.map((result) => result.file);
  }

  /** 原版 getMatchCount：各结果命中数之和。 */
  getMatchCount() {
    return this._results.reduce((sum, result) => sum + result.evaluation.score, 0);
  }

  isCollapsed(path) {
    return this._collapsed.has(path) ? this._collapsed.get(path) : this._collapseAll;
  }

  setCollapseAll(value) {
    this._collapseAll = !!value;
    for (const result of this._results) this._collapsed.set(result.file.path, this._collapseAll);
    this.rebuild();
  }

  setExtraContext(value) {
    this._extraContext = !!value;
    this.rebuild();
  }

  toggleCollapse(path) {
    this._collapsed.set(path, !this.isCollapsed(path));
    this.rebuild();
  }

  setCollapsed(path, value) {
    this._collapsed.set(path, !!value);
    this.rebuild();
  }

  /** 重建分组模型并重绘（折叠/上下文/排序变化后调用）。 */
  rebuild() {
    const current = this._focusRows[this._focusedIndex];
    const key = current ? current.key : null;
    const groupKey = current ? current.groupKey : null;
    this._groups = this._buildGroups();
    this._focusRows = this._groups.flatMap((group) => group.rows);
    let index = -1;
    if (key) index = this._focusRows.findIndex((row) => row.key === key);
    if (index < 0 && groupKey) {
      index = this._focusRows.findIndex((row) => row.kind === 'file' && row.groupKey === groupKey);
    }
    this._focusedIndex = index;
    this._virtual.setGroups(this._groups);
  }

  /** 命中行描述：正文按行合并成一行（带高亮区间），属性单独成行。 */
  _matchRows(result) {
    const { doc, evaluation } = result;
    const rows = [];
    const groups = new Map();
    for (const match of evaluation.content) {
      if (!groups.has(match.line)) groups.set(match.line, []);
      groups.get(match.line).push(match);
    }
    const lines = [...groups.keys()].sort((a, b) => a - b);
    const block = this._extraContext
      ? doc.blocks.find((item) => lines.length && item.startLine <= lines[0] && item.endLine >= lines[0])
      : null;
    for (const line of lines) {
      const matches = groups.get(line);
      let startOffset = doc.offsets[line];
      let endOffset = doc.offsets[line] + (doc.lines[line] || '').length;
      if (block) {
        startOffset = Math.min(startOffset, block.start);
        endOffset = Math.max(endOffset, block.end);
      }
      const text = doc.text.slice(startOffset, Math.min(endOffset, startOffset + 1200));
      if (!text) continue;
      const first = matches[0];
      rows.push({
        key: 'm:' + result.file.path + ':L' + line,
        kind: 'match',
        groupKey: result.file.path,
        result,
        plain: false,
        text,
        ranges: matches.map((match) => ({ start: match.start, end: match.end })),
        start: startOffset,
        end: startOffset + text.length,
        line,
        ch: first.start - first.lineStart,
      });
    }
    for (const property of evaluation.properties || []) {
      const prefix = property.key + ': ';
      rows.push({
        key: 'm:' + result.file.path + ':P' + property.key + ':' + property.value,
        kind: 'match',
        groupKey: result.file.path,
        result,
        plain: true,
        text: prefix + property.value,
        ranges: property.ranges.map((range) => ({ start: range.start + prefix.length, end: range.end + prefix.length })),
        start: 0,
        end: 0,
        line: null,
        ch: 0,
      });
    }
    return rows;
  }

  /** 分组模型：一个文件一个分组，折叠的分组只保留标题行（对齐原版折叠后不参与键盘导航）。 */
  _buildGroups() {
    const groups = [];
    for (const result of this._results) {
      const rows = [{ key: 'f:' + result.file.path, kind: 'file', groupKey: result.file.path, result }];
      if (!this.isCollapsed(result.file.path)) {
        for (const row of this._matchRows(result)) rows.push(row);
      }
      groups.push({ key: result.file.path, result, rows });
    }
    return groups;
  }

  /* ------------------------------------------------------------ 渲染 */

  _renderGroup(group, el, track) {
    const { file, evaluation } = group.result;
    el.empty();
    el.addClass('tree-item');
    el.addClass('search-result');
    const collapsed = this.isCollapsed(file.path);
    el.toggleClass('is-collapsed', collapsed);
    const titleEl = el.createDiv('tree-item-self search-result-file-title is-clickable');
    const collapseEl = titleEl.createDiv('tree-item-icon collapse-icon');
    setIcon(collapseEl, 'right-triangle');
    const collapsible = (evaluation.content || []).length > 0 || (evaluation.properties || []).length > 0;
    collapseEl.style.visibility = collapsible ? '' : 'hidden';
    collapseEl.toggleClass('is-collapsed', collapsed);
    const inner = titleEl.createDiv('tree-item-inner');
    this._renderTitle(inner, file, evaluation);
    if (evaluation.flair > 0) {
      const flair = titleEl.createDiv('tree-item-flair-outer').createSpan('tree-item-flair');
      flair.setText(String(evaluation.flair));
    }
    track(group.rows[0].key, titleEl, 'file');
    titleEl.onclick = (event) => {
      if (event.target && event.target.closest && event.target.closest('.collapse-icon')) return;
      this.onOpenFile(file, null, 0, event);
    };
    titleEl.oncontextmenu = (event) => this.onContextMenu(event, file, el, true);
    // 原版 KW.onResultMouseover：悬停结果行抛 hover-link，页面预览据此弹出。
    titleEl.addEventListener('mouseover', (event) => this.onHover(event, file, titleEl, null));
    collapseEl.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleCollapse(file.path);
      this._applyFocus();
    };
    const matchesEl = el.createDiv('search-result-file-matches');
    for (const row of group.rows) {
      if (row.kind !== 'match') continue;
      this._renderMatch(matchesEl, row, group.result, track);
    }
  }

  /** 原版 KW 标题规则：md 用不含扩展名的短名，其它文件（白板等）用带扩展名的全名。 */
  _renderTitle(inner, file, evaluation) {
    const pathFields = evaluation.fields.filter((field) => field.field === 'path');
    const nameFields = evaluation.fields.filter((field) => field.field === 'filename');
    if (pathFields.length) {
      const offset = file.path.length - file.name.length;
      const ranges = pathFields.flatMap((field) => field.ranges)
        .concat(nameFields.flatMap((field) => field.ranges.map((range) => ({ start: range.start + offset, end: range.end + offset }))));
      setHighlighted(inner, file.path, ranges);
    } else if (nameFields.length) {
      const ranges = nameFields.flatMap((field) => field.ranges);
      const last = ranges[ranges.length - 1];
      const useFullName = file.extension !== 'md' || last.end > file.basename.length;
      setHighlighted(inner, useFullName ? file.name : file.basename, ranges);
    } else {
      inner.setText(file.extension === 'md' ? file.basename : file.name);
    }
  }

  _renderMatch(matchesEl, row, result, track) {
    const file = result.file;
    const rowEl = matchesEl.createDiv('search-result-file-match tappable');
    const expansion = this._expanded.get(row.key);
    const start = expansion ? expansion.start : row.start;
    const end = expansion ? expansion.end : row.end;
    const text = row.plain ? row.text : result.doc.text.slice(start, end);
    const ranges = row.plain
      ? row.ranges
      : row.ranges.map((range) => ({ start: range.start - start, end: range.end - start }));
    setHighlighted(rowEl, text, ranges);
    rowEl._line = row.line;
    rowEl._result = result;
    rowEl.onclick = (event) => this.onOpenFile(file, row.line, row.ch, event);
    rowEl.oncontextmenu = (event) => this.onContextMenu(event, file, rowEl, false);
    // 原版 XW.onFocusEnter：悬停命中行同样抛 hover-link，并带上命中行号供预览定位。
    rowEl.addEventListener('mouseover', (event) => this.onHover(event, file, rowEl, row));
    const before = rowEl.createDiv('search-result-hover-button mod-top');
    setIcon(before, 'chevron-up');
    before.setAttr('aria-label', t('plugins.search.label-more-context'));
    before.style.display = 'none';
    before.onclick = (event) => { event.preventDefault(); event.stopPropagation(); this.expandMatch(row, -1); };
    const after = rowEl.createDiv('search-result-hover-button mod-bottom');
    setIcon(after, 'chevron-down');
    after.setAttr('aria-label', t('plugins.search.label-more-context'));
    after.style.display = 'none';
    after.onclick = (event) => { event.preventDefault(); event.stopPropagation(); this.expandMatch(row, 1); };
    rowEl._moreButtons = { before, after };
    rowEl.addEventListener('mouseover', () => this._toggleMoreButtons(rowEl, row, true));
    rowEl.addEventListener('mouseout', () => this._toggleMoreButtons(rowEl, row, false));
    track(row.key, rowEl, 'match');
  }

  /* ------------------------------------------------------------ 悬停预览 */

  /** 原版 KW.onResultMouseover：结果行悬停时抛 hover-link（source=search），页面预览据此弹出。 */
  onHover(event, file, targetEl, row) {
    if (event.defaultPrevented) return;
    if (!this.app || !this.app.workspace || typeof this.app.workspace.trigger !== 'function') return;
    this.app.workspace.trigger('hover-link', {
      event,
      source: 'search',
      hoverParent: this,
      targetEl,
      linktext: file.path,
      state: row && row.line !== null && row.line !== undefined ? { line: row.line } : null,
    });
  }

  /* -------------------------------------------------------- 更多上下文 */

  /** 原版 showMoreBefore/showMoreAfter：把上下文扩到相邻段落边界。 */
  expandMatch(row, direction) {
    if (!row || row.plain) return false;
    const doc = row.result.doc;
    const current = this._expanded.get(row.key) || { start: row.start, end: row.end };
    if (direction < 0) {
      let best = null;
      for (const block of doc.blocks) {
        if (block.end <= current.start && (!best || block.end > best.end)) best = block;
      }
      if (!best || best.start >= current.start) return false;
      this._expanded.set(row.key, { start: best.start, end: current.end });
    } else {
      let best = null;
      for (const block of doc.blocks) {
        if (block.start >= current.end && (!best || block.start < best.start)) best = block;
      }
      if (!best || best.end <= current.end) return false;
      this._expanded.set(row.key, { start: current.start, end: best.end });
    }
    this._virtual.render();
    return true;
  }

  _toggleMoreButtons(el, row, show) {
    const buttons = el._moreButtons;
    if (!buttons) return;
    const expansion = this._expanded.get(row.key);
    const start = expansion ? expansion.start : row.start;
    const end = expansion ? expansion.end : row.end;
    const length = row.result ? row.result.doc.text.length : 0;
    buttons.before.style.display = show && !row.plain && start > 0 ? '' : 'none';
    buttons.after.style.display = show && !row.plain && end < length ? '' : 'none';
  }

  /* ------------------------------------------------------------ 焦点 */

  get focusRows() {
    return this._focusRows;
  }

  get focusedIndex() {
    return this._focusedIndex;
  }

  get focusedRow() {
    return this._focusRows[this._focusedIndex] || null;
  }

  focusedElement() {
    return this._focusEl;
  }

  /** 焦点移动：跨虚拟边界按行模型走，滚出窗口的行先滚进视口。 */
  moveFocus(direction) {
    if (!this._focusRows.length) return null;
    if (this._focusedIndex < 0) this._focusedIndex = direction > 0 ? 0 : this._focusRows.length - 1;
    else this._focusedIndex = Math.max(0, Math.min(this._focusRows.length - 1, this._focusedIndex + direction));
    this._applyFocus();
    return this.focusedRow;
  }

  setFocusedIndex(index) {
    this._focusedIndex = index;
    this._applyFocus();
  }

  /** 焦点落到某个文件行（折叠命中行后原版把焦点收回文件标题）。 */
  focusGroup(groupKey) {
    const index = this._focusRows.findIndex((row) => row.kind === 'file' && row.groupKey === groupKey);
    if (index >= 0) this._focusedIndex = index;
    this._applyFocus();
  }

  clearFocus() {
    this._focusedIndex = -1;
    if (this._focusEl) this._focusEl.removeClass('has-focus');
    this._focusEl = null;
  }

  _applyFocus() {
    const row = this.focusedRow;
    if (!row) return;
    this._virtual.scrollToRow(row.key);
    this._restoreFocus();
  }

  /** 重绘后焦点类可能随 DOM 重建丢失：按行 key 重新挂上。 */
  _restoreFocus() {
    const row = this.focusedRow;
    if (!row) return;
    const el = this._virtual.elementOf(row.key);
    if (!el) return;
    const target = row.kind === 'file' ? el.closest('.search-result') : el;
    if (!target) return;
    if (this._focusEl && this._focusEl !== target) this._focusEl.removeClass('has-focus');
    target.addClass('has-focus');
    this._focusEl = target;
    if (row.kind === 'match') this._toggleMoreButtons(el, row, true);
  }
}
