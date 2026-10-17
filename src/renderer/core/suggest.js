/**
 * [INPUT]: Modal、DOM 助手与 i18n 的 tt。
 * [OUTPUT]: 模糊匹配、SuggestModal、GenericSuggester 与输入建议层。
 * [POS]: 命令、模板、文件选择的公共入口。输入位于结果前，接受选择后关闭。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Suggestion framework: fuzzy matching + SuggestModal (quick switcher etc). */
import { Modal } from './modals.js';
import { tt } from './i18n.js';
import { IS_MAC } from './keymap.js';

export function fuzzyMatch(query, text) {
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

export function renderHighlightedText(el, text, matches) {
  el.empty();
  if (!matches || !matches.length) { el.setText(text); return; }
  const set = new Set(matches);
  let current = null;
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    if (current) el.createSpan({ text: buffer, cls: 'suggestion-highlight' });
    else el.appendText(buffer);
    buffer = '';
  };
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i);
    if (current === null) current = isMatch;
    if (isMatch !== current) { flush(); current = isMatch; }
    buffer += text[i];
  }
  flush();
}

export class SuggestModal extends Modal {
  constructor(app) {
    super(app);
    this.inputEl = null;
    this.clearButtonEl = null;
    this.modalEl.removeClass('modal');
    this.modalEl.addClass('prompt');
    this.headerEl.detach();
    this.closeButtonEl.detach();
    this.buttonContainerEl.detach();
    // 输入容器：input 在前，清空按钮在后(原版 ob)
    const inputContainer = this.modalEl.createDiv('prompt-input-container');
    this.inputEl = inputContainer.createEl('input', {
      cls: 'prompt-input', type: 'text', attr: { autocapitalize: 'off', spellcheck: 'false' },
    });
    this.inputEl.placeholder = this.getPlaceholder() || '';
    this.clearButtonEl = inputContainer.createDiv('search-input-clear-button');
    this.clearButtonEl.addEventListener('mousedown', (ev) => ev.preventDefault());
    this.clearButtonEl.addEventListener('click', () => {
      if (this.inputEl.value !== '') { this.inputEl.value = ''; this.inputEl.dispatchEvent(new Event('input')); }
      else this.close();
    });
    this.modalEl.insertBefore(inputContainer, this.contentEl);
    this.resultContainerEl = this.contentEl.createDiv('suggestion-container');
    this.resultContainerEl.addClass('prompt-results');
    this.limit = 100;
    this.emptyStateText = tt('setting.third-party-plugin.label-no-results-found', '无结果');
    this._selectedIndex = 0;
    this.results = [];
    this.instructionsEl = this.modalEl.createDiv('prompt-instructions');
    this.renderInstructions();
    this.inputEl.oninput = () => this.updateSuggestions();
    this.inputEl.onkeydown = (ev) => this.onInputKeyDown(ev);
    this.scope = app.keymap ? app.keymap.createScope() : null;
  }
  getPlaceholder() { return ''; }
  getInstructions() {
    return this.instructions || [
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to select' },
      { command: 'esc', purpose: 'to dismiss' },
    ];
  }
  renderInstructions() {
    this.instructionsEl.empty();
    for (const inst of this.getInstructions()) {
      const el = this.instructionsEl.createDiv('prompt-instruction');
      el.createSpan({ cls: 'prompt-instruction-command', text: inst.command });
      el.createSpan({ text: inst.purpose });
    }
  }
  onOpen() {
    setTimeout(() => { this.inputEl.focus(); this.updateSuggestions(); }, 10);
  }
  setPlaceholder(text) { this.inputEl.placeholder = text; return this; }
  setInstructions(instructions) { this.instructions = instructions; this.renderInstructions(); return this; }
  getSuggestions(query) { return []; }
  renderSuggestion(value, el) { el.setText(String(value)); }
  onChooseSuggestion(value, ev) {}
  updateSuggestions() {
    const query = this.inputEl.value;
    this.results = this.getSuggestions(query) || [];
    if (this.results.length > this.limit) this.results = this.results.slice(0, this.limit);
    this._selectedIndex = 0;
    this.renderResults();
  }
  renderResults() {
    this.resultContainerEl.empty();
    if (!this.results.length) {
      this.resultContainerEl.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText });
      return;
    }
    this.results.forEach((value, i) => {
      const el = this.resultContainerEl.createDiv('suggestion-item');
      el.toggleClass('is-selected', i === this._selectedIndex);
      this.renderSuggestion(value, el, this.inputEl.value);
      el.onmousemove = () => this.setSelectedIndex(i);
      el.onclick = (ev) => this.selectSuggestion(i, ev);
    });
    const selected = this.resultContainerEl.children[this._selectedIndex];
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }
  setSelectedIndex(i) {
    const n = this.results.length;
    if (!n) return;
    this._selectedIndex = ((i % n) + n) % n;
    for (let k = 0; k < this.resultContainerEl.children.length; k++) {
      this.resultContainerEl.children[k].toggleClass('is-selected', k === this._selectedIndex);
    }
    const selected = this.resultContainerEl.children[this._selectedIndex];
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }
  onInputKeyDown(ev) {
    if (ev.isComposing) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex - 1); }
    else if (ev.key === 'PageDown') { ev.preventDefault(); this.pageDown(); }
    else if (ev.key === 'PageUp') { ev.preventDefault(); this.pageUp(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); this.selectSuggestion(this._selectedIndex, ev); }
    else if (ev.key === 'Home' && !ev.shiftKey) { ev.preventDefault(); this.setSelectedIndex(0); }
    else if (ev.key === 'End') { ev.preventDefault(); this.setSelectedIndex(this.results.length - 1); }
    else if (IS_MAC && ev.ctrlKey && ev.key === 'n') { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex + 1); }
    else if (IS_MAC && ev.ctrlKey && ev.key === 'p') { ev.preventDefault(); this.setSelectedIndex(this._selectedIndex - 1); }
  }
  /** 行高与可视行数：滚动量按结果容器实测，超出即整页跳跃(原版 ib.pageUp/pageDown)。 */
  rowHeight() {
    const selected = this.resultContainerEl.children[this._selectedIndex];
    return selected ? selected.clientHeight : 0;
  }
  numVisibleItems() {
    const height = this.rowHeight();
    return height > 0 ? Math.floor(this.resultContainerEl.clientHeight / height) : 0;
  }
  pageUp() {
    const container = this.resultContainerEl;
    const rowHeight = this.rowHeight();
    if (!rowHeight) return;
    const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
    let row = Math.floor((container.scrollTop - paddingTop) / rowHeight);
    if (this._selectedIndex <= row) row -= this.numVisibleItems();
    this.setSelectedIndex(Math.max(0, row));
  }
  pageDown() {
    const container = this.resultContainerEl;
    const rowHeight = this.rowHeight();
    if (!rowHeight) return;
    const visible = this.numVisibleItems();
    const paddingTop = parseFloat(getComputedStyle(container).paddingTop) || 0;
    let row = Math.floor((container.scrollTop - paddingTop) / rowHeight) + (visible - 1);
    if (this._selectedIndex >= row) row += visible;
    this.setSelectedIndex(Math.min(this.results.length - 1, row));
  }
  selectSuggestion(i, ev) {
    const value = this.results[i];
    if (value === undefined) return;
    this.close();
    this.onChooseSuggestion(value, ev);
  }
}

export class GenericSuggester extends SuggestModal {
  constructor(app, items, options = {}) {
    super(app);
    this.items = items;
    this.options = options;
    this.setPlaceholder(options.placeholder || '');
    this.emptyStateText = options.emptyStateText || 'No results';
    this.setTitle(options.title || '');
  }
  getSuggestions(query) {
    if (!query) return this.items;
    const out = [];
    for (const item of this.items) {
      const text = typeof item === 'string' ? item : (item.label || '');
      const m = fuzzyMatch(query, text);
      if (m) out.push({ item, score: m.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map((o) => o.item);
  }
  renderSuggestion(value, el, query) {
    const label = typeof value === 'string' ? value : (value.label || '');
    const m = fuzzyMatch(query, label);
    if (m) renderHighlightedText(el, label, m.matches);
    else el.setText(label);
  }
  onChooseSuggestion(value) {
    this.options.onChoose && this.options.onChoose(value);
  }
}

export function suggest(app, items, options = {}) {
  return new Promise((resolve) => {
    const s = new GenericSuggester(app, items, {
      ...options,
      onChoose: (item) => resolve(item),
    });
    s.onClose = () => queueMicrotask(() => resolve(null));
    s.open();
  });
}

// Inline input suggestions (used by properties, aliases, etc.)
export class AbstractInputSuggest {
  constructor(app, inputEl) {
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
  getSuggestions(query) { return []; }
  renderSuggestion(value, el) { el.setText(String(value)); }
  selectSuggestion(value) {}
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
    const rect = this.inputEl.getBoundingClientRect();
    this.popoverEl.style.left = rect.left + 'px';
    this.popoverEl.style.top = (rect.bottom + 2) + 'px';
    this.popoverEl.style.minWidth = Math.max(rect.width, 180) + 'px';
    this.popoverEl.empty();
    this.suggestions.forEach((value, i) => {
      const el = this.popoverEl.createDiv('suggestion-item');
      el.toggleClass('is-selected', i === this.selectedIndex);
      this.renderSuggestion(value, el);
      el.onmousedown = (ev) => { ev.preventDefault(); this.pick(i); };
    });
  }
  onKeyDown(ev) {
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
  pick(i) {
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
