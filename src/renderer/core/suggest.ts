/**
 * [INPUT]: 依赖 ./modals.js 的 Modal；依赖 ./keymap.js 的 IS_MAC。
 * [OUTPUT]: 导出具体结果泛型的模糊匹配、SuggestModal、GenericSuggester 与输入建议层。
 * [POS]: 命令、模板、文件选择的公共入口。SuggestModal 的 DOM 与按键逐字对齐原版 OT/IT：
 *         `.prompt` 直挂输入容器/结果/指令栏；选择器环绕、分页、Home/End、Ctrl+P/N、Tab 补全，
 *         悬停不滚动，回车交给 onChooseSuggestion。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Suggestion framework: fuzzy matching + SuggestModal (quick switcher etc). */
import type { KeymapScope } from './keymap.js';
import { Modal } from './modals.js';
import { IS_MAC } from './keymap.js';

export function fuzzyMatch(query: string, text: string): { score: number; matches: number[] } | null {
  if (!query) return { score: 0, matches: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  const matches = [];
  let lastMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) { found = i; break; }
    }
    if (found === -1) return null;
    let add = 1;
    if (found === lastMatch + 1) add += 3; // consecutive
    if (found === 0 || /[\s\-_/.]/.test(t[found - 1] || '')) add += 2; // word start
    const rel = found / t.length;
    add += Math.max(0, 2 - rel * 2);
    score += add;
    lastMatch = found;
    matches.push(found);
    ti = found + 1;
  }
  // prefer shorter text
  score += Math.max(0, 10 - text.length * 0.02);
  return { score, matches };
}

export function renderHighlightedText(el: HTMLElement, text: string, matches: Array<number | number[]> | null) {
  el.empty();
  if (!matches || !matches.length) { el.setText(text); return; }
  // 兼容两种匹配表示：索引数组（旧 fuzzyMatch）与区间数组 [start,end]（原版 ux/cx）。
  const ranges: Array<[number, number]> = [];
  if (Array.isArray(matches[0])) {
    for (const range of matches) if (Array.isArray(range)) ranges.push([range[0], range[1]]);
    ranges.sort((a, b) => a[0] - b[0]);
  } else {
    const indices = matches.filter((value) => typeof value === 'number').sort((a, b) => a - b);
    for (const index of indices) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === index) last[1] = index + 1;
      else ranges.push([index, index + 1]);
    }
  }
  let cursor = 0;
  for (const [start, end] of ranges) {
    const from = Math.max(0, start);
    const to = Math.min(text.length, end);
    if (to <= from) continue;
    if (from > cursor) el.appendText(text.slice(cursor, from));
    el.createSpan({ cls: 'suggestion-highlight', text: text.slice(from, to) });
    cursor = to;
  }
  if (cursor < text.length) el.appendText(text.slice(cursor));
}

/**
 * 原版 OT + IT：prompt 基类与建议选择器。
 * 子类契约（与原版一致）：
 *   getSuggestions(query) -> values[]；null 值表示「创建项」
 *   renderSuggestion(value, el, query)
 *   onChooseSuggestion(value: T | null, ev: MouseEvent | KeyboardEvent)
 *   onNoSuggestion()  可覆写；默认按 supportsCreate 决定创建项或空态文案
 *   getCompletionText(value)  Tab 补全文本；返回 null 表示不补全
 */
export interface SuggestionInstruction { command: string; purpose: string; }

export class SuggestModal<T = unknown> extends Modal {
  onSelectedChange?: (item: T | null, event?: Event | null) => void;

  declare limit: number;
  declare emptyStateText: string;
  declare noRecentFilesText: string;
  declare allowCreateNewFile: boolean;
  declare shouldShowMarkdown: boolean;
  declare shouldShowNonAttachments: boolean;
  declare shouldShowAlias: boolean;
  declare shouldShowUnresolved: boolean;
  declare shouldShowNonImageAttachments: boolean;
  declare shouldShowImages: boolean;
  declare shouldShowAllTypes: boolean;
  declare shouldShowNonFileBookmarks: boolean;
  declare context: string;
  declare _selectedIndex: number;
  declare results: Array<T | null>;
  declare suggestions: HTMLDivElement[];
  declare inputEl: HTMLInputElement;
  declare ctaEl: HTMLDivElement;
  declare clearButtonEl: HTMLDivElement;
  declare resultContainerEl: HTMLDivElement;
  declare instructionsEl: HTMLDivElement;
  declare scope: KeymapScope | null;
  declare instructions: SuggestionInstruction[] | undefined;

  constructor(app: App) {
    super(app);
    this.limit = 100;
    this.emptyStateText = 'No results found.';
    this.noRecentFilesText = 'No recent files found. Type to search...';
    this.allowCreateNewFile = false;
    this.shouldShowMarkdown = false;
    this.shouldShowNonAttachments = true;
    this.shouldShowAlias = true;
    this.shouldShowUnresolved = false;
    this.shouldShowNonImageAttachments = true;
    this.shouldShowImages = true;
    this.shouldShowAllTypes = false;
    this.shouldShowNonFileBookmarks = false;
    this.context = 'view';
    this._selectedIndex = 0;
    this.results = [];
    this.suggestions = [];
    // 原版 OT：modalEl 去掉 .modal，换成 .prompt，并清空基类骨架
    this.modalEl.removeClass('modal');
    this.modalEl.addClass('prompt');
    this.headerEl.detach();
    this.closeButtonEl.detach();
    this.buttonContainerEl.detach();
    this.contentEl.detach();

    const inputContainer = this.modalEl.createDiv('prompt-input-container mod-raised');
    this.inputEl = inputContainer.createEl('input', {
      cls: 'prompt-input', type: 'text',
      attr: { autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' },
    });
    this.ctaEl = inputContainer.createDiv('prompt-input-cta');
    this.clearButtonEl = inputContainer.createDiv('search-input-clear-button');
    this.clearButtonEl.addEventListener('mousedown', (ev) => {
      if (this.inputEl.value !== '') ev.preventDefault();
    });
    this.clearButtonEl.addEventListener('click', () => {
      if (this.inputEl.value !== '') {
        this.inputEl.value = '';
        this.inputEl.dispatchEvent(new Event('input'));
      } else {
        this.close();
      }
    });

    this.resultContainerEl = this.modalEl.createDiv('prompt-results');
    this.instructionsEl = createDiv('prompt-instructions');
    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (ev) => this.onInputKeyDown(ev));
    this.scope = app.keymap ? app.keymap.createScope() : null;
    this.inputEl.placeholder = this.getPlaceholder() || '';
    const instructions = this.getInstructions();
    if (instructions && instructions.length) this.setInstructions(instructions);
  }

  getPlaceholder() { return ''; }
  getInstructions() {
    return this.instructions || [
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to select' },
      { command: 'esc', purpose: 'to dismiss' },
    ];
  }
  /** 原版 supportsCreate：允许创建且展示 Markdown。 */
  get supportsCreate() { return !!this.allowCreateNewFile && !!this.shouldShowMarkdown; }

  renderInstructions(instructions = this.getInstructions()) {
    this.instructionsEl.empty();
    for (const inst of instructions || []) {
      this.instructionsEl.createDiv('prompt-instruction', (el) => {
        el.createSpan({ cls: 'prompt-instruction-command', text: inst.command });
        el.createSpan({ text: inst.purpose });
      });
    }
  }
  setInstructions(instructions: SuggestionInstruction[]) {
    this.instructions = instructions;
    this.renderInstructions(instructions);
    if (instructions && instructions.length) {
      if (!this.instructionsEl.parentElement) this.modalEl.appendChild(this.instructionsEl);
    } else {
      this.instructionsEl.detach();
    }
    return this;
  }
  setPlaceholder(text: string) { this.inputEl.placeholder = text; return this; }

  onOpen() {
    this.inputEl.value = '';
    this.inputEl.focus();
    this.updateSuggestions();
  }
  onInput() { this.updateSuggestions(); }

  getSuggestions(query: string): Array<T | null> | Promise<Array<T | null>> { return []; }
  renderSuggestion(value: T | null, el: HTMLElement, query?: string): void { el.setText(String(value)); }
  onChooseSuggestion(value: T | null, ev: MouseEvent | KeyboardEvent) {}
  getCompletionText(value: T | null, query?: string): string | null { return null; }

  updateSuggestions() {
    const query = this.inputEl.value;
    const values = this.getSuggestions(query);
    const apply = (list: Array<T | null>) => {
      if (list && list.length) {
        if (this.limit && this.limit > 0) list = list.slice(0, this.limit);
        this.setSuggestions(list);
      } else {
        this.onNoSuggestion();
      }
    };
    if (Array.isArray(values)) apply(values);
    else Promise.resolve(values).then(apply);
  }

  /** 原版 D5.onNoSuggestion：非空输入且可创建时给创建项，否则空态文案。 */
  onNoSuggestion() {
    const query = this.inputEl.value.trim();
    if (query && this.supportsCreate) {
      this.setSuggestions([null]);
      return;
    }
    this.setSuggestions(null);
    this.resultContainerEl.createDiv({
      cls: 'suggestion-empty',
      text: query ? this.emptyStateText : this.noRecentFilesText,
    });
  }

  setSuggestions(values: Array<T | null> | null) {
    this.results = values ? values.slice() : [];
    this.resultContainerEl.empty();
    const query = this.inputEl.value;
    this.suggestions = this.results.map((value, i) => {
      const el = this.resultContainerEl.createDiv('suggestion-item');
      this.renderSuggestion(value, el, query);
      el.onmousemove = (ev) => this.setSelectedIndex(i, ev);
      el.onclick = (ev) => {
        if (ev.defaultPrevented) return;
        ev.preventDefault();
        this.setSelectedIndex(i, ev);
        this.selectSuggestion(value, ev);
      };
      el.onauxclick = el.onclick;
      return el;
    });
    this._selectedIndex = 0;
    this.setSelectedIndex(0, null);
  }

  /** 原版 IT.setSelectedItem：越界环绕；键盘触发滚动，鼠标悬停不滚动。 */
  setSelectedIndex(index: number, ev: MouseEvent | KeyboardEvent | null) {
    const n = this.results.length;
    if (!n) { this._selectedIndex = 0; return; }
    if (index < 0) index = n - 1;
    else if (index >= n) index = 0;
    const previous = this.suggestions[this._selectedIndex];
    if (previous) previous.removeClass('is-selected');
    this._selectedIndex = index;
    const el = this.suggestions[index];
    if (el) {
      el.addClass('is-selected');
      if (!(ev instanceof MouseEvent)) el.scrollIntoView({ block: 'nearest' });
    }
    if (this.onSelectedChange) this.onSelectedChange(this.results[index], ev);
  }

  rowHeight() {
    const el = this.suggestions[this._selectedIndex];
    return el ? el.clientHeight : 0;
  }
  numVisibleItems() {
    const rowHeight = this.rowHeight();
    return rowHeight > 0 ? Math.floor(this.resultContainerEl.clientHeight / rowHeight) : 0;
  }
  pageUp(ev: KeyboardEvent) {
    const rowHeight = this.rowHeight();
    if (!rowHeight) return;
    const container = this.resultContainerEl;
    const visible = this.numVisibleItems();
    const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
    let row = Math.floor((container.scrollTop - paddingTop) / rowHeight);
    if (this._selectedIndex <= row) row -= visible;
    this.setSelectedIndex(Math.max(0, row), ev);
  }
  pageDown(ev: KeyboardEvent) {
    const rowHeight = this.rowHeight();
    if (!rowHeight) return;
    const container = this.resultContainerEl;
    const visible = this.numVisibleItems();
    const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
    let row = Math.floor((container.scrollTop - paddingTop) / rowHeight) + (visible - 1);
    if (this._selectedIndex >= row) row += visible;
    this.setSelectedIndex(Math.min(this.results.length - 1, row), ev);
  }

  /** Tab：把选中项的补全文本写入输入框；已相等则补一个 "/"（原版 D5 的 Tab 补全）。 */
  completeSelection(ev: KeyboardEvent) {
    const value = this.results[this._selectedIndex];
    if (value === undefined) return;
    let text = this.getCompletionText(value, this.inputEl.value);
    if (text === null || text === undefined) return;
    if (text === this.inputEl.value) text += '/';
    this.inputEl.value = text;
    this.updateSuggestions();
  }

  onInputKeyDown(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    const key = ev.key;
    if (key === 'ArrowDown') { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex + 1, ev); }
    else if (key === 'ArrowUp') { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex - 1, ev); }
    else if (key === 'PageDown') { ev.preventDefault(); this.pageDown(ev); }
    else if (key === 'PageUp') { ev.preventDefault(); this.pageUp(ev); }
    else if (key === 'Home') { ev.preventDefault(); this.setSelectedIndex(0, ev); }
    else if (key === 'End') { ev.preventDefault(); this.setSelectedIndex(this.results.length - 1, ev); }
    else if (IS_MAC && ev.ctrlKey && (key === 'n' || key === 'N')) { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex + 1, ev); }
    else if (IS_MAC && ev.ctrlKey && (key === 'p' || key === 'P')) { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex - 1, ev); }
    else if (key === 'Tab') { ev.preventDefault(); this.completeSelection(ev); }
    else if (key === 'Enter') {
      ev.preventDefault();
      if (ev.shiftKey && this.supportsCreate) { this.selectSuggestion(null, ev); return; }
      this.selectActiveSuggestion(ev);
    }
  }

  selectActiveSuggestion(ev: KeyboardEvent) {
    const value = this.results[this._selectedIndex];
    if (value === undefined) return;
    this.selectSuggestion(value, ev);
  }
  selectSuggestion(value: T | null, ev: MouseEvent | KeyboardEvent) {
    this.close();
    this.onChooseSuggestion(value, ev);
  }
}

export type LabeledSuggestion = string | { label?: string };
export interface SuggesterOptions<T> { placeholder?: string; emptyStateText?: string; title?: string; onChoose?(item: T): unknown; }
export class GenericSuggester<T extends LabeledSuggestion> extends SuggestModal<T> {
  items: T[];
  options: SuggesterOptions<T>;

  constructor(app: App, items: T[], options: SuggesterOptions<T> = {}) {
    super(app);
    this.items = items;
    this.options = options;
    this.setPlaceholder(options.placeholder || '');
    this.emptyStateText = options.emptyStateText || 'No results';
    this.setTitle(options.title || '');
  }
  getSuggestions(query: string): T[] {
    if (!query) return this.items;
    const out: Array<{ item: T; score: number }> = [];
    for (const item of this.items) {
      const text = typeof item === 'string' ? item : (item.label || '');
      const match = fuzzyMatch(query, text);
      if (match) out.push({ item, score: match.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map(entry => entry.item);
  }
  renderSuggestion(value: T | null, el: HTMLElement, query: string): void {
    if (value === null) return;
    const label = typeof value === 'string' ? value : (value.label || '');
    const match = fuzzyMatch(query, label);
    if (match) renderHighlightedText(el, label, match.matches);
    else el.setText(label);
  }
  onChooseSuggestion(value: T | null): void {
    if (value !== null) this.options.onChoose?.(value);
  }
}

export function suggest<T extends LabeledSuggestion>(app: App, items: T[], options: SuggesterOptions<T> = {}): Promise<T | null> {
  return new Promise(resolve => {
    const selector = new GenericSuggester(app, items, { ...options, onChoose: item => resolve(item) });
    selector.onClose = () => queueMicrotask(() => resolve(null));
    selector.open();
  });
}

// Inline input suggestions (used by properties, aliases, etc.)
export class AbstractInputSuggest<T = string> {
  declare app: App;
  declare inputEl: HTMLInputElement;
  declare limit: number;
  declare popoverEl: HTMLDivElement | null;
  declare suggestions: T[];
  declare selectedIndex: number;

  constructor(app: App, inputEl: HTMLInputElement) {
    this.app = app;
    this.inputEl = inputEl;
    this.limit = 100;
    this.popoverEl = null;
    this.suggestions = [];
    this.selectedIndex = -1;
    inputEl.addEventListener('input', () => this.update());
    inputEl.addEventListener('focus', () => this.update());
    inputEl.addEventListener('blur', () => setTimeout(() => this.close(), 150));
    inputEl.addEventListener('keydown', (ev) => this.onKeyDown(ev));
  }
  getSuggestions(query: string): T[] { return []; }
  renderSuggestion(value: T, el: HTMLElement, query?: string): void { el.setText(String(value)); }
  selectSuggestion(value: T) {}
  update() {
    const query = this.inputEl.value;
    const results = (this.getSuggestions(query) || []).slice(0, this.limit);
    this.suggestions = results;
    this.selectedIndex = results.length ? 0 : -1;
    if (!results.length) { this.close(); return; }
    this.renderPopover();
  }
  renderPopover() {
    if (!this.popoverEl) {
      this.popoverEl = createDiv('suggestion-container input-suggest');
      document.body.appendChild(this.popoverEl);
    }
    const popover = this.popoverEl;
    if (!popover) return;
    const rect = this.inputEl.getBoundingClientRect();
    this.popoverEl.style.left = rect.left + 'px';
    this.popoverEl.style.top = (rect.bottom + 2) + 'px';
    this.popoverEl.style.minWidth = Math.max(rect.width, 180) + 'px';
    this.popoverEl.empty();
    this.suggestions.forEach((value, i) => {
      const el = popover.createDiv('suggestion-item');
      el.toggleClass('is-selected', i === this.selectedIndex);
      this.renderSuggestion(value, el);
      el.onmousedown = (ev) => { ev.preventDefault(); this.pick(i); };
    });
  }
  onKeyDown(ev: KeyboardEvent) {
    if (!this.popoverEl) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length;
      this.renderPopover();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.suggestions.length) % this.suggestions.length;
      this.renderPopover();
    } else if (ev.key === 'Enter' || ev.key === 'Tab') {
      if (this.selectedIndex >= 0 && this.suggestions.length) {
        ev.preventDefault();
        this.pick(this.selectedIndex);
      }
    } else if (ev.key === 'Escape') {
      this.close();
    }
  }
  pick(i: number) {
    const value = this.suggestions[i];
    this.close();
    if (value !== undefined) {
      this.inputEl.value = String(value);
      this.selectSuggestion(value);
      this.inputEl.dispatchEvent(new Event('input'));
    }
  }
  close() {
    if (this.popoverEl) { this.popoverEl.detach(); this.popoverEl = null; }
  }
}
