/**
 * [INPUT]: View 生命周期、workspace 文件打开、metadataCache/vault 正文、Menu、search-query 查询内核与 search-copy 复制弹窗。
 * [OUTPUT]: SearchView、CopySearchResultsModal 转导出、searchFile/searchVault 兼容导出与插件 create。
 * [POS]: global-search 视图。DOM 对齐 1.14.4：search-row、search-params、search-results-info、tree-item 结果分组；
 *        查询语法/命中判定委托 search-query.js，复制弹窗委托 search-copy.js，本文件负责状态、DOM、排序、折叠与键盘。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { View } from '../core/view.js';
import { t, tt } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { Setting } from '../core/setting.js';
import { CopySearchResultsModal } from './search-copy.js';
import { parseQuery, searchDocument, createSearchDocument, queryInfo } from './search-query.js';

export { CopySearchResultsModal } from './search-copy.js';

export const nameKey = 'plugins.search';

// 原版 search view 使用 Obsidian 自有 Aa 图标；icons.json 未收录，按原版 SVG 内联。
const CASE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
  + 'class="svg-icon uppercase-lowercase-a"><path d="M10.5 14L4.5 14"></path><path d="M12.5 18L7.5 6"></path>'
  + '<path d="M3 18L7.5 6"></path><path d="M15.9526 10.8322C15.9526 10.8322 16.6259 10 18.3832 10C20.1406 9.99999 '
  + '20.9986 11.0587 20.9986 11.9682V16.7018C20.9986 17.1624 21.2815 17.7461 21.7151 18"></path>'
  + '<path d="M20.7151 13.5C18.7151 13.5 15.7151 14.2837 15.7151 16C15.7151 17.7163 17.5908 18.2909 '
  + '18.7151 18C19.5635 17.7804 20.5265 17.3116 20.889 16.6199"></path></svg>';

const SORT_OPTIONS = [
  ['alphabetical', 'plugins.file-explorer.label-sort-a-to-z', 'File name (A to Z)'],
  ['alphabeticalReverse', 'plugins.file-explorer.label-sort-z-to-a', 'File name (Z to A)'],
  ['byModifiedTime', 'plugins.file-explorer.label-sort-new-to-old', 'Modified time (new to old)'],
  ['byModifiedTimeReverse', 'plugins.file-explorer.label-sort-old-to-new', 'Modified time (old to new)'],
  ['byCreatedTime', 'plugins.file-explorer.label-sort-created-new-to-old', 'Created time (new to old)'],
  ['byCreatedTimeReverse', 'plugins.file-explorer.label-sort-created-old-to-new', 'Created time (old to new)'],
];

function setCaseIcon(el) {
  el.innerHTML = CASE_ICON;
  return el.firstElementChild;
}

function formatCount(count) {
  return t('plugins.search.label-result-count', { count });
}

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

function renderInfoItem(parent, item) {
  const line = parent.createDiv();
  line.setText(t(item.label) + (item.value ? ' ' + item.value : ''));
  if (item.children && item.children.length) {
    const children = parent.createDiv('search-info-children');
    for (const child of item.children) renderInfoItem(children, child);
  }
}

function dateOrder(file, key) {
  const stat = file.stat || {};
  return Number(stat[key] || 0);
}

// ---------------------------------------------------------------------------
// Search view
// ---------------------------------------------------------------------------
export class SearchView extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'lucide-search';
    this.navigation = true;
    this._query = '';
    this._matchCase = false;
    this._explain = false;
    this._collapseAll = false;
    this._extraContext = false;
    this._sortOrder = 'alphabetical';
    this._collapsed = new Map();
    this._results = [];
    this._searchSeq = 0;
    this._searching = false;
    this._applyingState = false;
    this._focusItems = [];
    this._focusedIndex = -1;
    this._listeners = [];
    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  getViewType() { return 'search'; }
  getDisplayText() { return t('plugins.search.name') || 'Search'; }
  getIcon() { return 'search'; }

  getState() {
    return {
      query: this._query,
      matchingCase: this._matchCase,
      explainSearch: this._explain,
      collapseAll: this._collapseAll,
      extraContext: this._extraContext,
      sortOrder: this._sortOrder,
    };
  }

  async setState(state, result) {
    state = state || {};
    this._applyingState = true;
    try {
      if (typeof state.query === 'string' && state.query !== this._query) {
        this._query = state.query;
        if (this.inputEl) this.inputEl.value = state.query;
      }
      if (typeof state.matchingCase === 'boolean') this._matchCase = state.matchingCase;
      if (typeof state.explainSearch === 'boolean') this._explain = state.explainSearch;
      if (typeof state.collapseAll === 'boolean') {
        this._collapseAll = state.collapseAll;
        this._collapsed.clear();
      }
      if (typeof state.extraContext === 'boolean') this._extraContext = state.extraContext;
      if (typeof state.sortOrder === 'string' && SORT_OPTIONS.some(([value]) => value === state.sortOrder)) {
        this._sortOrder = state.sortOrder;
      }
      this._syncControls();
    } finally {
      this._applyingState = false;
    }
    if (this.inputEl && this._query) await this.runSearch();
    else if (this.inputEl) this._clearResults();
  }

  setEphemeralState(state) {
    if (state && state.focus && this.inputEl) {
      this.inputEl.setSelectionRange(0, this.inputEl.value.length);
      this.inputEl.focus({ preventScroll: true });
    }
  }

  setQuery(query) {
    this._query = String(query || '');
    if (this.inputEl) this.inputEl.value = this._query;
    return this.runSearch();
  }

  focus() {
    if (this.inputEl) this.inputEl.focus();
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('search-view');
    this._buildHeader();
    this._buildSearchInfo();
    this._buildParams();
    this._buildResultsInfo();
    this._buildResults();
    this.contentEl.addEventListener('keydown', this._onKeyDown);
    this._listeners.push({ unregister: () => this.contentEl.removeEventListener('keydown', this._onKeyDown) });
    this._syncControls();
    if (this._query) await this.runSearch();
  }

  onClose() {
    this._searchSeq++;
    for (const listener of this._listeners) listener.unregister && listener.unregister();
    this._listeners = [];
    this._results = [];
    this._focusItems = [];
  }

  _buildHeader() {
    const row = this.contentEl.createDiv('search-row');
    const inputContainer = row.createDiv('search-input-container global-search-input-container');
    this.inputEl = inputContainer.createEl('input', {
      type: 'search',
      attr: {
        enterkeyhint: 'search',
        spellcheck: 'false',
        placeholder: t('plugins.search.prompt-start-search') || 'Search...',
      },
    });
    this.clearButtonEl = inputContainer.createDiv('search-input-clear-button');
    this.clearButtonEl.setAttr('aria-label', t('plugins.search.tooltip-clear-search') || 'Clear search');
    this.clearButtonEl.onclick = () => {
      this.inputEl.value = '';
      this._query = '';
      this.inputEl.focus();
      this.runSearch();
    };
    this.caseButtonEl = inputContainer.createDiv('input-right-decorator clickable-icon');
    setCaseIcon(this.caseButtonEl);
    this.caseButtonEl.setAttr('aria-label', t('plugins.search.label-match-case') || 'Match case');
    this.caseButtonEl.onclick = () => {
      this._matchCase = !this._matchCase;
      this._syncControls();
      if (this.inputEl.value !== '') this.runSearch();
    };

    this.filterButtonEl = row.createDiv('clickable-icon');
    setIcon(this.filterButtonEl, 'sliders-horizontal');
    this.filterButtonEl.setAttr('aria-label', t('plugins.search.label-toggle-search-settings') || 'Search settings');
    this.filterButtonEl.onclick = () => {
      this._showParams = !this._showParams;
      this.filterButtonEl.toggleClass('is-active', this._showParams);
      this.paramsEl.toggle(this._showParams);
    };

    let timer = null;
    this.inputEl.addEventListener('input', () => {
      this._query = this.inputEl.value;
      clearTimeout(timer);
      timer = setTimeout(() => this.runSearch(), 0);
    });
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.runSearch();
        return;
      }
      if (event.key === 'Escape') {
        if (this.inputEl.value) {
          event.preventDefault();
          this.inputEl.value = '';
          this._query = '';
          this.runSearch();
        }
      }
    });
    this._listeners.push({ unregister: () => clearTimeout(timer) });
  }

  _buildSearchInfo() {
    this.searchInfoEl = this.contentEl.createDiv('search-info-container');
    this.searchInfoEl.hide();
  }

  _buildParams() {
    this.paramsEl = this.contentEl.createDiv('search-params');
    this.paramsEl.hide();
    this._showParams = false;
    new Setting(this.paramsEl)
      .setName(t('plugins.search.label-collapse-results'))
      .setClass('mod-toggle')
      .addToggle((toggle) => {
        this.collapseToggle = toggle;
        toggle.setValue(this._collapseAll).onChange((value) => {
          if (this._applyingState) return;
          this.setCollapseAll(value);
        });
      });
    new Setting(this.paramsEl)
      .setName(t('plugins.search.label-more-context'))
      .setClass('mod-toggle')
      .addToggle((toggle) => {
        this.extraContextToggle = toggle;
        toggle.setValue(this._extraContext).onChange((value) => {
          if (this._applyingState) return;
          this.setExtraContext(value);
        });
      });
    new Setting(this.paramsEl)
      .setName(t('plugins.search.label-explain-search-term'))
      .setClass('mod-toggle')
      .addToggle((toggle) => {
        this.explainToggle = toggle;
        toggle.setValue(this._explain).onChange((value) => {
          if (this._applyingState) return;
          this.setExplainSearch(value);
        });
      });
  }

  _buildResultsInfo() {
    this.resultsInfoEl = this.contentEl.createDiv('search-results-info');
    this.resultsInfoEl.hide();
    this.countEl = this.resultsInfoEl.createDiv('clickable-icon search-results-result-count');
    this.resultCountEl = this.countEl.createSpan();
    const more = this.countEl.createDiv('more-options-icon');
    setIcon(more, 'more-horizontal');
    this.countEl.onclick = (event) => {
      if (this.countEl.hasClass && this.countEl.hasClass('has-active-menu')) return;
      const menu = new Menu(this.app);
      menu.addSections(['action']);
      menu.addItem((item) => item
        .setSection('action')
        .setIcon('copy')
        .setTitle(t('plugins.search.label-copy-search-results'))
        .onClick(() => new CopySearchResultsModal(this.app, this).open()));
      menu.setParentElement(this.countEl).showAtMouseEvent(event);
    };
    this.sortSelect = this.resultsInfoEl.createEl('select', { cls: 'dropdown' });
    for (const [value, key, fallback] of SORT_OPTIONS) {
      this.sortSelect.createEl('option', { value, text: tt(key, fallback) });
    }
    this.sortSelect.value = this._sortOrder;
    this.sortSelect.onchange = () => {
      this.setSortOrder(this.sortSelect.value);
      this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
    };
  }

  _buildResults() {
    this.resultEl = this.contentEl.createDiv('search-result-container mod-global-search');
    this.childrenEl = this.resultEl.createDiv('search-results-children');
    this.emptyEl = this.resultEl.createDiv({
      cls: 'search-empty-state',
      text: t('plugins.search.label-no-matches') || 'No matches found.',
    });
    this.emptyEl.hide();
  }

  _syncControls() {
    if (this.caseButtonEl) this.caseButtonEl.toggleClass('is-active', this._matchCase);
    if (this.collapseToggle) this.collapseToggle.setValue(this._collapseAll);
    if (this.extraContextToggle) this.extraContextToggle.setValue(this._extraContext);
    if (this.explainToggle) this.explainToggle.setValue(this._explain);
    if (this.sortSelect) this.sortSelect.value = this._sortOrder;
  }

  _clearResults() {
    this._searchSeq++;
    if (this.childrenEl) this.childrenEl.empty();
    if (this.emptyEl) this.emptyEl.hide();
    if (this.resultsInfoEl) this.resultsInfoEl.hide();
    if (this.searchInfoEl) this.searchInfoEl.hide();
    if (this.resultEl) this.resultEl.removeClass('is-loading');
    this._results = [];
    this._focusItems = [];
    this._focusedIndex = -1;
    this._searching = false;
  }

  _setLoading(loading) {
    this._searching = loading;
    if (this.resultEl) this.resultEl.toggleClass('is-loading', loading);
  }

  async runSearch() {
    const query = this._query;
    const seq = ++this._searchSeq;
    this._focusedIndex = -1;
    this._focusItems = [];
    if (!this.childrenEl) return;
    this.searchInfoEl.empty();
    if (!query.trim()) {
      // 原版清空查询后保留结果信息行与上次计数，只清结果并展示空态。
      this._results = [];
      this.childrenEl.empty();
      this.emptyEl.show();
      this.searchInfoEl.hide();
      this.resultEl.removeClass('is-loading');
      this._searching = false;
      return;
    }

    this.resultsInfoEl.show();
    this.emptyEl.hide();
    this._setLoading(true);

    const parsed = parseQuery(query);
    if (parsed.error || !parsed.ast) {
      // 原版把解析错误写入解释区；仅在开启解释时可见，计数保持上次结果。
      this._results = [];
      this.childrenEl.empty();
      this.searchInfoEl.createDiv({ cls: 'search-info', text: parsed.error || t('plugins.search.label-no-matches') });
      this.searchInfoEl.toggle(this._explain);
      this.emptyEl.show();
      this._setLoading(false);
      return;
    }
    this._renderInfo(parsed);
    this.searchInfoEl.toggle(this._explain);
    const results = [];
    const files = this.app.vault.getMarkdownFiles();
    let scanned = 0;
    for (const file of files) {
      if (seq !== this._searchSeq) return;
      let text = '';
      try {
        text = await this.app.vault.cachedRead(file);
      } catch (error) {
        continue;
      }
      const doc = createSearchDocument(file, text, this.app.metadataCache.getFileCache(file));
      const evaluation = searchDocument(doc, parsed.ast, {
        matchCase: parsed.forceCase === null ? this._matchCase : parsed.forceCase,
      });
      if (evaluation) results.push({ file, doc, evaluation });
      scanned++;
      if (results.length >= 500) break;
      if (scanned % 25 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (seq !== this._searchSeq) return;
      }
    }
    if (seq !== this._searchSeq) return;
    this._results = results;
    this._searching = false;
    this.resultEl.removeClass('is-loading');
    this._applySort();
    this.renderResults();
    this.resultCountEl.setText(formatCount(this._countMatches()));
  }

  _renderInfo(parsed) {
    this.searchInfoEl.empty();
    const items = queryInfo(parsed.ast);
    for (const item of items) renderInfoItem(this.searchInfoEl, item);
    if (parsed.forceCase !== null && !this._queryHasCaseOperator(parsed.ast)) {
      renderInfoItem(this.searchInfoEl, {
        label: parsed.forceCase ? 'plugins.search.label-case-sensitive' : 'plugins.search.label-case-insensitive',
        children: [],
      });
    }
  }

  _queryHasCaseOperator(ast) {
    if (!ast) return false;
    if (ast.type === 'case') return true;
    if (ast.children) return ast.children.some((child) => this._queryHasCaseOperator(child));
    if (ast.child) return this._queryHasCaseOperator(ast.child);
    return false;
  }

  _countMatches() {
    return this._results.reduce((sum, result) => sum + result.evaluation.score, 0);
  }

  _applySort() {
    const order = this._sortOrder;
    const byName = (a, b) => a.file.basename.localeCompare(b.file.basename);
    const compare = {
      alphabetical: byName,
      alphabeticalReverse: (a, b) => -byName(a, b),
      byModifiedTime: (a, b) => dateOrder(b.file, 'mtime') - dateOrder(a.file, 'mtime'),
      byModifiedTimeReverse: (a, b) => dateOrder(a.file, 'mtime') - dateOrder(b.file, 'mtime'),
      byCreatedTime: (a, b) => dateOrder(b.file, 'ctime') - dateOrder(a.file, 'ctime'),
      byCreatedTimeReverse: (a, b) => dateOrder(a.file, 'ctime') - dateOrder(b.file, 'ctime'),
    }[order] || byName;
    this._results.sort((a, b) => compare(a, b) || byName(a, b));
  }

  renderResults() {
    if (!this.childrenEl) return;
    this.childrenEl.empty();
    this._focusItems = [];
    this._focusedIndex = -1;
    if (!this._results.length) {
      this.emptyEl.show();
      return;
    }
    this.emptyEl.hide();
    for (const result of this._results.slice(0, 500)) this._renderResult(result);
  }

  _renderResult(result) {
    const { file, doc, evaluation } = result;
    const path = file.path;
    const collapsed = this._collapsed.has(path) ? this._collapsed.get(path) : this._collapseAll;
    const container = this.childrenEl.createDiv('tree-item search-result');
    container.toggleClass('is-collapsed', collapsed);
    const titleEl = container.createDiv('tree-item-self search-result-file-title is-clickable');
    const collapseEl = titleEl.createDiv('tree-item-icon collapse-icon');
    setIcon(collapseEl, 'right-triangle');
    const contentMatches = evaluation.content;
    const propertyMatches = evaluation.properties || [];
    const collapsible = contentMatches.length > 0 || propertyMatches.length > 0;
    collapseEl.style.visibility = collapsible ? '' : 'hidden';
    collapseEl.toggleClass('is-collapsed', collapsed);
    const inner = titleEl.createDiv('tree-item-inner');
    const pathFields = evaluation.fields.filter((field) => field.field === 'path');
    const nameFields = evaluation.fields.filter((field) => field.field === 'filename');
    if (pathFields.length) {
      const offset = path.length - file.name.length;
      const ranges = pathFields.flatMap((field) => field.ranges)
        .concat(nameFields.flatMap((field) => field.ranges.map((range) => ({ start: range.start + offset, end: range.end + offset }))));
      setHighlighted(inner, path, ranges);
    } else if (nameFields.length) {
      const ranges = nameFields.flatMap((field) => field.ranges);
      const useFullName = ranges.some((range) => range.end > file.basename.length);
      setHighlighted(inner, useFullName ? file.name : file.basename, ranges);
    } else {
      inner.setText(file.basename);
    }
    if (evaluation.score > 0) {
      const flair = titleEl.createDiv('tree-item-flair-outer').createSpan('tree-item-flair');
      flair.setText(String(evaluation.score));
    }
    this._focusItems.push({ el: container, kind: 'file', file, result });
    titleEl.onclick = (event) => {
      if (event.target && event.target.closest && event.target.closest('.collapse-icon')) return;
      this._openFile(file, null, 0, event);
    };
    collapseEl.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = !(this._collapsed.has(path) ? this._collapsed.get(path) : this._collapseAll);
      this._collapsed.set(path, next);
      container.toggleClass('is-collapsed', next);
      collapseEl.toggleClass('is-collapsed', next);
    };

    const matchesEl = container.createDiv('search-result-file-matches');
    const groups = new Map();
    for (const match of contentMatches) {
      if (!groups.has(match.line)) groups.set(match.line, []);
      groups.get(match.line).push(match);
    }
    const lines = [...groups.keys()].sort((a, b) => a - b);
    const block = this._extraContext ? doc.blocks.find((item) => lines.length && item.startLine <= lines[0] && item.endLine >= lines[0]) : null;
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
      const row = matchesEl.createDiv('search-result-file-match tappable');
      const ranges = matches.map((match) => ({ start: match.start - startOffset, end: match.end - startOffset }));
      setHighlighted(row, text, ranges);
      const first = matches[0];
      row._line = line;
      row._result = result;
      row.onclick = (event) => this._openFile(file, line, first.start - first.lineStart, event);
      this._focusItems.push({ el: row, kind: 'match', file, result, line });
    }
    for (const property of propertyMatches) {
      const prefix = property.key + ': ';
      const text = prefix + property.value;
      const row = matchesEl.createDiv('search-result-file-match tappable');
      const ranges = property.ranges.map((range) => ({ start: range.start + prefix.length, end: range.end + prefix.length }));
      setHighlighted(row, text, ranges);
      row._line = null;
      row._result = result;
      row.onclick = (event) => this._openFile(file, null, 0, event);
      this._focusItems.push({ el: row, kind: 'match', file, result, line: null });
    }
  }

  _openFile(file, line, ch, event) {
    const newLeaf = !!(event && (event.metaKey || event.ctrlKey));
    const options = { newLeaf };
    if (line !== null && line !== undefined) options.eState = { line, ch: ch || 0 };
    this.app.workspace.openFile(file, options);
  }

  setSortOrder(order) {
    if (!SORT_OPTIONS.some(([value]) => value === order)) return;
    this._sortOrder = order;
    this._syncControls();
    this._applySort();
    this.renderResults();
  }

  setCollapseAll(value) {
    this._collapseAll = !!value;
    for (const result of this._results) this._collapsed.set(result.file.path, this._collapseAll);
    this._syncControls();
    this.renderResults();
  }

  setExtraContext(value) {
    this._extraContext = !!value;
    this._syncControls();
    this.renderResults();
  }

  setExplainSearch(value) {
    this._explain = !!value;
    this._syncControls();
    if (this.searchInfoEl) this.searchInfoEl.toggle(this._explain);
    this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
  }

  getFiles() {
    return this._results.map((result) => result.file);
  }

  _handleKeyDown(event) {
    if (event.defaultPrevented) return;
    const target = event.target;
    const inInput = target === this.inputEl;
    if (event.key === 'ArrowDown') {
      if (!this._focusItems.length) return;
      event.preventDefault();
      this._moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!this._focusItems.length) return;
      event.preventDefault();
      this._moveFocus(-1);
      return;
    }
    if (event.key === 'Enter') {
      if (inInput) return;
      const item = this._focusItems[this._focusedIndex];
      if (!item) return;
      event.preventDefault();
      if (item.kind === 'match') this._openFile(item.file, item.line, 0, event);
      else this._openFile(item.file, null, 0, event);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (inInput) return;
      const item = this._focusItems[this._focusedIndex];
      const result = item ? item.result : null;
      if (!result) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') this.setCollapseAll(true);
        else this.setCollapseAll(false);
        return;
      }
      if (event.key === 'ArrowRight' && item.kind === 'match') return;
      event.preventDefault();
      const path = result.file.path;
      const next = event.key === 'ArrowLeft';
      this._collapsed.set(path, next);
      const container = item.el.closest('.search-result');
      if (container) {
        container.toggleClass('is-collapsed', next);
        const arrow = container.querySelector(':scope > .search-result-file-title > .collapse-icon');
        if (arrow) arrow.toggleClass('is-collapsed', next);
        const matches = container.querySelector(':scope > .search-result-file-matches');
        if (matches) matches.toggle(!next);
      }
      if (next && item.kind === 'match') {
        const fileIndex = this._focusItems.findIndex((entry) => entry.kind === 'file' && entry.result === result);
        if (fileIndex >= 0) this._focusedIndex = fileIndex;
      }
      this._applyFocus();
    }
  }

  _moveFocus(direction) {
    if (!this._focusItems.length) return;
    if (this._focusedIndex < 0) this._focusedIndex = direction > 0 ? 0 : this._focusItems.length - 1;
    else this._focusedIndex = Math.max(0, Math.min(this._focusItems.length - 1, this._focusedIndex + direction));
    this._applyFocus();
  }

  _applyFocus() {
    for (const item of this._focusItems) item.el.removeClass('has-focus');
    const item = this._focusItems[this._focusedIndex];
    if (!item) return;
    item.el.addClass('has-focus');
    if (item.el.scrollIntoView) item.el.scrollIntoView({ block: 'nearest' });
  }
}

// ---------------------------------------------------------------------------
// Compatibility search API: 老调用方只需正文匹配时复用文档内核。
// ---------------------------------------------------------------------------
export function searchFile(text, file, terms, matchCase) {
  const query = terms.map((term) => {
    const prefix = term.negated ? '-' : '';
    if (term.type && term.type !== 'content') return prefix + term.type + ':' + term.value;
    if (term.regex) return prefix + '/' + term.value + '/' + (term.regex.flags || '');
    if (term.exact) return prefix + '"' + term.value + '"';
    return prefix + term.value;
  }).join(' ');
  const parsed = parseQuery(query);
  if (!parsed.ast) return null;
  const doc = createSearchDocument(file, text, file._cache);
  const result = searchDocument(doc, parsed.ast, { matchCase });
  if (!result) return null;
  return { matches: result.content.map((match) => ({ line: match.line, text: doc.lines[match.line] || '', start: match.start - match.lineStart, end: match.end - match.lineStart })), score: result.score };
}

export async function searchVault(app, query, options = {}) {
  const parsed = parseQuery(query);
  if (!parsed.ast) return { results: [], total: 0, count: 0 };
  const results = [];
  let total = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    let text = '';
    try { text = await app.vault.cachedRead(file); } catch (error) { continue; }
    const doc = createSearchDocument(file, text, app.metadataCache.getFileCache(file));
    const evaluation = searchDocument(doc, parsed.ast, {
      matchCase: parsed.forceCase === null ? options.matchCase : parsed.forceCase,
    });
    if (!evaluation) continue;
    results.push({ file, matches: evaluation.content.map((match) => ({
      line: match.line,
      text: doc.lines[match.line] || '',
      start: match.start - match.lineStart,
      end: match.end - match.lineStart,
    })), score: evaluation.score });
    total += evaluation.score;
  }
  return { results, total, count: results.length };
}

export function create(app) {
  return {
    onload() {
      app.viewRegistry.registerView('search', (leaf) => new SearchView(leaf));
      app.commands.addCommand({
        id: 'global-search:open',
        name: t('plugins.search.action-open-search') || 'Search in all files',
        icon: 'search',
        callback: () => {
          const leaf = app.workspace.getLeavesOfType('search')[0];
          const open = (target) => { app.workspace.revealLeaf(target); target.view.focus && target.view.focus(); };
          if (leaf) open(leaf);
          else app.workspace.ensureSideLeaf('search', 'left', { reveal: true }).then(open);
        },
      });
    },
    onunload() { app.viewRegistry.unregisterView('search'); },
    deregister(app) { app.viewRegistry.unregisterView('search'); },
  };
}
