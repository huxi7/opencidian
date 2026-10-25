/**
 * [INPUT]: View 生命周期、workspace 文件打开、metadataCache/vault 正文、Menu、search-query 查询内核、
 *          search-copy 复制弹窗、search-results 结果列表内核与 search-suggest 输入建议层。
 * [OUTPUT]: SearchView、CopySearchResultsModal 转导出、searchFile/searchVault 兼容导出与插件 create。
 * [POS]: global-search 视图。DOM 对齐 1.14.4：search-row、search-params、search-results-info、tree-item 结果分组；
 *        结果集交给 search-results.js 的虚拟列表（只渲染视口内的分组，滚动条与总条目数成比例），
 *        键盘导航按行模型跨虚拟边界移动；输入框挂 search-suggest.js 的算子建议与搜索历史；
 *        搜索范围为 Markdown 全部文件 + 白板文本节点（原版 NL.match 口径）；
 *        查询语法/命中判定委托 search-query.js，复制弹窗委托 search-copy.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { View } from '../core/view.js';
import { t, tt } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { Setting } from '../core/setting.js';
import { TFolder } from '../core/vault.js';
import { CopySearchResultsModal } from './search-copy.js';
import { parseQuery, searchDocument, createSearchDocument, canvasNodeText, queryInfo } from './search-query.js';
import { SearchResults } from './search-results.js';
import { SearchSuggest } from './search-suggest.js';

export { CopySearchResultsModal } from './search-copy.js';
export { searchFile, searchVault } from './search-query-match.js';

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
  return t('plugins.search.label-result-count', { count: Number(count).toLocaleString() });
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
  declare collapseToggle: any;
  declare extraContextToggle: any;
  declare explainToggle: any;

  declare icon: string;
  declare navigation: boolean;
  declare _query: string;
  declare _matchCase: boolean;
  declare _explain: boolean;
  declare _collapseAll: boolean;
  declare _extraContext: boolean;
  declare _sortOrder: string;
  declare _results: any[];
  declare _searchSeq: number;
  declare _searching: boolean;
  declare _applyingState: boolean;
  declare _listeners: any[];
  declare _onKeyDown: any;
  declare _historyTimer: any;
  declare _suggest: SearchSuggest | null | undefined;
  declare _list: SearchResults | null | undefined;
  declare inputEl: any;
  declare clearButtonEl: any;
  declare caseButtonEl: any;
  declare filterButtonEl: any;
  declare _showParams: any;
  declare searchInfoEl: any;
  declare paramsEl: any;
  declare resultsInfoEl: any;
  declare countEl: any;
  declare resultCountEl: any;
  declare sortSelect: any;
  declare sortMeasureEl: any;
  declare sortMeasureOptionEl: any;
  declare resultEl: any;
  declare childrenEl: any;
  declare emptyEl: any;

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
    this._results = [];
    this._searchSeq = 0;
    this._searching = false;
    this._applyingState = false;
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
        if (this._list) this._list.setCollapseAll(this._collapseAll);
      }
      if (typeof state.extraContext === 'boolean') {
        this._extraContext = state.extraContext;
        if (this._list) this._list.setExtraContext(this._extraContext);
      }
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
    // 原版 onTabHeaderClick：点搜索标签头即全选输入框内容并聚焦。
    const tabHeaderEl = this.leaf && this.leaf._tabHeaderEl;
    if (tabHeaderEl) {
      const onTabHeaderClick = () => {
        if (!this.inputEl) return;
        this.inputEl.setSelectionRange(0, this.inputEl.value.length);
        this.inputEl.focus({ preventScroll: true });
      };
      tabHeaderEl.addEventListener('click', onTabHeaderClick);
      this._listeners.push({ unregister: () => tabHeaderEl.removeEventListener('click', onTabHeaderClick) });
    }
    this._syncControls();
    if (this._query) await this.runSearch();
  }

  onClose() {
    this._searchSeq++;
    for (const listener of this._listeners) listener.unregister && listener.unregister();
    this._listeners = [];
    this._results = [];
    clearTimeout(this._historyTimer);
    this._historyTimer = null;
    if (this._suggest) this._suggest.destroy();
    this._suggest = null;
    if (this._list) this._list.dispose();
    this._list = null;
  }

  /** 原版 onResize：视口变化后重算虚拟窗口。 */
  onResize() {
    if (this._list) this._list.render();
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
      this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
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
    // 原版 k2.attach：输入框聚焦/输入时弹出算子建议与搜索历史。
    this._suggest = new SearchSuggest(this.app, this.inputEl);
    this.inputEl.addEventListener('input', () => {
      this._query = this.inputEl.value;
      clearTimeout(timer);
      timer = setTimeout(() => this.runSearch(), 0);
    });
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.isComposing || event.defaultPrevented) return;
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
    // 原版 search-params 只有三个开关：折叠结果 / 显示更多上下文 / 说明搜索含义。
    const toggles: Array<[string, string, () => boolean, (value: boolean) => void]> = [
      ['plugins.search.label-collapse-results', 'collapseToggle', () => this._collapseAll, (value) => this.setCollapseAll(value)],
      ['plugins.search.label-more-context', 'extraContextToggle', () => this._extraContext, (value) => this.setExtraContext(value)],
      ['plugins.search.label-explain-search-term', 'explainToggle', () => this._explain, (value) => this.setExplainSearch(value)],
    ];
    for (const [key, field, read, apply] of toggles) {
      new Setting(this.paramsEl)
        .setName(t(key))
        .setClass('mod-toggle')
        .addToggle((toggle) => {
          toggle.setValue(read()).onChange((value) => {
            if (this._applyingState) return;
            apply(value);
          });
          this[field] = toggle;
        });
    }
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
      // 原版：结果菜单同时抛出 search:results-menu 事件，供外部补充菜单项。
      this.app.workspace.trigger('search:results-menu', menu, this);
      menu.setParentElement(this.countEl).showAtMouseEvent(event);
    };
    this.sortSelect = this.resultsInfoEl.createEl('select', { cls: 'dropdown' });
    for (const [value, key, fallback] of SORT_OPTIONS) {
      this.sortSelect.createEl('option', { value, text: tt(key, fallback) });
    }
    this.sortSelect.value = this._sortOrder;
    // 原版 bT 下拉：隐藏的测量 select 记录当前项宽度，写回 --dropdown-fitted-width。
    this.sortMeasureEl = this.resultsInfoEl.createEl('select', { cls: 'dropdown is-measuring' });
    this.sortMeasureEl.setAttr('aria-hidden', 'true');
    this.sortMeasureEl.tabIndex = -1;
    this.sortMeasureOptionEl = this.sortMeasureEl.createEl('option');
    this.sortSelect.onchange = () => {
      this.setSortOrder(this.sortSelect.value);
      this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
    };
    this._resizeSortSelect();
  }

  _resizeSortSelect() {
    if (!this.sortSelect || !this.sortMeasureOptionEl) return;
    const option = this.sortSelect.options[this.sortSelect.selectedIndex];
    if (!option) return;
    this.sortMeasureOptionEl.setText(option.text);
    this.sortSelect.style.setProperty('--dropdown-fitted-width', this.sortSelect.offsetWidth + 'px');
  }

  _buildResults() {
    this.resultEl = this.contentEl.createDiv('search-result-container mod-global-search');
    this.childrenEl = this.resultEl.createDiv('search-results-children');
    this.emptyEl = this.resultEl.createDiv({
      cls: 'search-empty-state',
      text: t('plugins.search.label-no-matches') || 'No matches found.',
    });
    this.emptyEl.hide();
    this._list = new SearchResults({
      app: this.app,
      scrollEl: this.resultEl,
      childrenEl: this.childrenEl,
      onOpenFile: (file, line, ch, event) => this._openFile(file, line, ch, event),
      onContextMenu: (event, file, el, allowDelete) => this._openResultMenu(event, file, el, allowDelete),
    });
  }

  _syncControls() {
    if (this.caseButtonEl) this.caseButtonEl.toggleClass('is-active', this._matchCase);
    if (this.collapseToggle) this.collapseToggle.setValue(this._collapseAll);
    if (this.extraContextToggle) this.extraContextToggle.setValue(this._extraContext);
    if (this.explainToggle) this.explainToggle.setValue(this._explain);
    if (this.sortSelect) {
      this.sortSelect.value = this._sortOrder;
      this._resizeSortSelect();
    }
  }

  _clearResults() {
    this._searchSeq++;
    if (this.childrenEl) this.childrenEl.empty();
    if (this.emptyEl) this.emptyEl.hide();
    if (this.resultsInfoEl) this.resultsInfoEl.hide();
    if (this.searchInfoEl) this.searchInfoEl.hide();
    if (this.resultEl) this.resultEl.removeClass('is-loading');
    this._results = [];
    if (this._list) this._list.setResults([]);
    this._searching = false;
  }

  _setLoading(loading) {
    this._searching = loading;
    if (this.resultEl) this.resultEl.toggleClass('is-loading', loading);
  }

  async runSearch() {
    const query = this._query;
    const seq = ++this._searchSeq;
    if (this._list) this._list.clearFocus();
    if (!this.childrenEl) return;
    this.searchInfoEl.empty();
    if (!query.trim()) {
      // 原版：清空查询后隐藏结果信息行，保留上次计数文案，结果清空并显示空态。
      this._results = [];
      this.childrenEl.empty();
      this.emptyEl.show();
      this.searchInfoEl.hide();
      this.resultsInfoEl.hide();
      this.resultEl.removeClass('is-loading');
      this._searching = false;
      if (this._list) this._list.setResults([]);
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
      if (this._list) this._list.setResults([]);
      return;
    }
    this._renderInfo(parsed);
    this.searchInfoEl.toggle(this._explain);
    const results = [];
    const matchCase = parsed.forceCase === null ? this._matchCase : parsed.forceCase;
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
      const evaluation = searchDocument(doc, parsed.ast, { matchCase });
      if (evaluation) results.push({ file, doc, evaluation });
      scanned++;
      if (scanned % 25 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (seq !== this._searchSeq) return;
      }
    }
    // 原版 NL.match 的 canvas 分支：白板只匹配文本节点文字，节点命中不计入结果数。
    for (const file of this._canvasFiles()) {
      if (seq !== this._searchSeq) return;
      let text = '';
      try {
        text = await this.app.vault.cachedRead(file);
      } catch (error) {
        continue;
      }
      const body = canvasNodeText(text);
      const doc = createSearchDocument(file, body === null ? '' : body, null);
      const evaluation = searchDocument(doc, parsed.ast, { matchCase, countContent: false });
      if (evaluation) results.push({ file, doc, evaluation });
    }
    if (seq !== this._searchSeq) return;
    this._results = results;
    this._searching = false;
    this.resultEl.removeClass('is-loading');
    this._applySort();
    this.renderResults();
    this.resultCountEl.setText(formatCount(this._countMatches()));
    this._scheduleHistorySave();
  }

  /** 原版搜索范围：Markdown 全部文件 + 白板（canvas）文件。 */
  _canvasFiles() {
    const all = this.app.vault.getFiles ? this.app.vault.getFiles() : [];
    return all.filter((file) => file.extension === 'canvas');
  }

  /** 原版 requestSaveSearch：搜索结束 5 秒后把当前查询写入最近搜索。 */
  _scheduleHistorySave() {
    clearTimeout(this._historyTimer);
    this._historyTimer = setTimeout(() => {
      this._historyTimer = null;
      if (this._suggest) this._suggest.saveHistory(this._query);
    }, 5000);
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
    return this._list ? this._list.getMatchCount() : 0;
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
    if (!this._list) return;
    if (!this._results.length) {
      this._list.setResults([]);
      this.emptyEl.show();
      return;
    }
    this.emptyEl.hide();
    this._list.setResults(this._results);
  }

  _openFile(file, line, ch, event) {
    const newLeaf = !!(event && (event.metaKey || event.ctrlKey));
    const options: { newLeaf: boolean; eState?: { line: number; ch: number } } = { newLeaf };
    if (line !== null && line !== undefined) options.eState = { line, ch: ch || 0 };
    this.app.workspace.openFile(file, options);
  }

  /** 原版 onResultContextMenu：结果行右键弹出链接菜单；删除文件项只在文件标题上出现。 */
  _openResultMenu(event, file, el, allowDelete) {
    event.preventDefault();
    const menu = this.app.workspace.buildLinkMenu();
    if (!this.app.workspace.handleLinkContextMenu(menu, file.path, '', event)) return;
    if (allowDelete) {
      menu.addItem((item) => item
        .setSection('danger')
        .setTitle(t('interface.menu.delete-file') || 'Delete file')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => this.app.fileManager.promptForDeletion(file)));
    }
    menu.setParentElement(el);
    menu.showAtMouseEvent(event);
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
    if (this._list) this._list.setCollapseAll(this._collapseAll);
    this._syncControls();
    this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
  }

  setExtraContext(value) {
    this._extraContext = !!value;
    if (this._list) this._list.setExtraContext(this._extraContext);
    this._syncControls();
    this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
  }

  setExplainSearch(value) {
    this._explain = !!value;
    this._syncControls();
    if (this.searchInfoEl) this.searchInfoEl.toggle(this._explain);
    this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
  }

  getFiles() {
    return this._list ? this._list.getFiles() : [];
  }

  // ------------------------------------------------------------------ 键盘

  _handleKeyDown(event) {
    if (event.defaultPrevented || !this._list) return;
    const inInput = event.target === this.inputEl;
    const row = this._list.focusedRow;
    if (event.key === 'ArrowDown' && !event.shiftKey) {
      if (!this._list.focusRows.length) return;
      event.preventDefault();
      if (document.activeElement === this.inputEl) (document.activeElement as HTMLElement).blur();
      this._list.moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp' && !event.shiftKey) {
      if (!this._list.focusRows.length) return;
      event.preventDefault();
      if (document.activeElement === this.inputEl) (document.activeElement as HTMLElement).blur();
      this._list.moveFocus(-1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // 原版 Shift+↑/↓：在焦点命中行上展开上/下更多上下文。
      if (!row || row.kind !== 'match') return;
      event.preventDefault();
      this._list.expandMatch(row, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Enter') {
      if (inInput) return;
      if (!row) return;
      event.preventDefault();
      this._openFile(row.result.file, row.kind === 'match' ? row.line : null, row.kind === 'match' ? row.ch : 0, event);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (inInput) return;
      const result = row ? row.result : null;
      if (!result) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') this.setCollapseAll(true);
        else this.setCollapseAll(false);
        return;
      }
      if (event.key === 'ArrowRight' && row.kind === 'match') return;
      event.preventDefault();
      const next = event.key === 'ArrowLeft';
      this._list.setCollapsed(result.file.path, next);
      if (next && row.kind === 'match') this._list.focusGroup(result.file.path);
      else this._list.setFocusedIndex(this._list.focusedIndex);
    }
  }
}

// ---------------------------------------------------------------------------
// 插件注册
// ---------------------------------------------------------------------------

/** 原版 openGlobalSearch：确保左栏搜索视图存在，并带上查询词。 */
async function openGlobalSearch(app: App, query) {
  let leaf = app.workspace.getLeavesOfType('search')[0];
  if (!leaf) leaf = await app.workspace.ensureSideLeaf('search', 'left', { reveal: true });
  if (query !== null && query !== undefined) {
    await leaf.setViewState({ type: 'search', state: { query } });
  }
  app.workspace.revealLeaf(leaf);
  if (leaf.view && leaf.view.focus) leaf.view.focus();
  return leaf;
}

/** 原版命令与编辑器菜单取选区作查询词：含空格则整体加引号。 */
function selectionQuery(app: App) {
  const editor = app.workspace.activeEditor;
  let text = '';
  if (editor && editor.getSelection && editor.getRange) {
    const range = editor.getSelection();
    if (range && range.anchor) text = editor.getRange(range.anchor, range.head) || '';
  }
  if (!text && typeof window.getSelection === 'function') text = window.getSelection().toString();
  text = String(text || '').trim();
  if (!text) return null;
  return text.includes(' ') ? '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : text;
}

/** 原版 E2.onEditorMenu：选区右键加“查找 …”，关键词截断到 25 字。 */
function keywordLabel(text) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 25 ? flat.slice(0, 25) : flat;
}

export function create(app: App) {
  const refs = [];
  return {
    onload() {
      app.viewRegistry.registerView('search', (leaf) => new SearchView(leaf));
      app.commands.addCommand({
        id: 'global-search:open',
        name: t('plugins.search.action-open-search') || 'Search in all files',
        icon: 'search',
        callback: () => { openGlobalSearch(app, selectionQuery(app)); },
      });
      // 原版 E2.onFileMenu：文件树里文件夹右键加“在文件夹中查找”。
      refs.push(app.workspace.on('file-menu', (menu, file, source) => {
        if (source !== 'file-explorer-context-menu') return;
        if (!(file instanceof TFolder) || file.isRoot()) return;
        menu.addItem((item) => item
          .setSection('action')
          .setTitle(t('plugins.search.menu-opt-search-in-folder'))
          .setIcon('folder-search')
          .onClick(() => { openGlobalSearch(app, 'path:"' + file.path + '/" '); }));
      }));
      // 原版 E2.onEditorMenu：编辑器选区右键加“查找 …”。
      refs.push(app.workspace.on('editor-menu', (menu, editor) => {
        const range = editor && editor.getSelection ? editor.getSelection() : null;
        const text = range && range.anchor ? editor.getRange(range.anchor, range.head) : '';
        if (!text || !text.trim()) return;
        menu.addItem((item) => item
          .setSection('selection')
          .setTitle(t('plugins.search.menu-opt-search-for', { keyword: keywordLabel(text.trim()) }))
          .setIcon('search')
          .onClick(() => { openGlobalSearch(app, selectionQuery(app)); }));
      }));
    },
    onunload() {
      app.viewRegistry.unregisterView('search');
      for (const ref of refs) ref && ref.unregister && ref.unregister();
      refs.length = 0;
    },
    deregister(app: App) {
      app.viewRegistry.unregisterView('search');
      for (const ref of refs) ref && ref.unregister && ref.unregister();
      refs.length = 0;
    },
  };
}
