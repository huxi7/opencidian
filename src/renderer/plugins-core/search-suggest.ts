/**
 * [INPUT]: 搜索输入框元素、app（读 localStorage 与打开外链）。
 * [OUTPUT]: SearchSuggest（attach/update/open/close/select/apply/loadHistory/saveHistory/clearHistory）与 OPERATORS 算子表。
 * [POS]: global-search 的输入建议层。对齐原版 k2（CB 子类）：
 *        DOM 为 .suggestion-container.mod-search-suggestion > .suggestion > .suggestion-item；
 *        算子建议（path:/file:/tag:/line:/section:/[property]，带说明）成组显示在“搜索选项”组下，
 *        tag: 后给标签、path: 后给目录（原版匹配器栈上下文分支），
 *        空输入时追加“搜索历史”组（localStorage recent-searches，最多 20 条，最近在前）；
 *        面板宽 max(输入框宽, 300px)、贴输入框下方 5px，500ms 后若输入框已隐藏则自动收起。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t, getLanguage } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Desktop } from '../core/ipc.js';
import { createDiv } from '../core/dom.js';
import { TFolder } from '../core/vault.js';

export const HISTORY_KEY = 'recent-searches';
export const HISTORY_LIMIT = 20;
const AUTO_CLOSE_DELAY = 500;
const MIN_WIDTH = 300;
const GAP = 5;

/** 原版 w2：算子建议表（name 用于前缀匹配，token 用于插入，descKey 为说明文案）。 */
export const OPERATORS = [
  { type: 'operator', name: 'path:', token: 'path:', descKey: 'plugins.search.label-path-option-description' },
  { type: 'operator', name: 'file:', token: 'file:', descKey: 'plugins.search.label-file-name-option-description' },
  { type: 'operator', name: 'tag:', token: 'tag:', descKey: 'plugins.search.label-tag-option-description' },
  { type: 'operator', name: 'line:', token: 'line:()', descKey: 'plugins.search.label-line-option-description' },
  { type: 'operator', name: 'section:', token: 'section:()', descKey: 'plugins.search.label-section-option-description' },
  { type: 'operator', name: '[property]', token: '[]', descKey: 'plugins.search.label-property-option-description' },
];

/** 原版 ob("plugins/search")：按界面语言拼出的帮助页地址。 */
function docsUrl() {
  const lang = getLanguage();
  const base = lang === 'en' ? 'https://obsidian.md/help' : 'https://obsidian.md/' + lang + '/help';
  return base + '/plugins/search';
}

export class SearchSuggest {
  declare app: App;
  declare inputEl: any;
  declare showHistory: any;
  declare values: any[];
  declare items: any[];
  declare selectedIndex: number;
  declare popoverEl: any;
  declare _autoClose: any;
  declare _listeners: any[];

  constructor(app: App, inputEl, options: Record<string, any> = {}) {
    this.app = app;
    this.inputEl = inputEl;
    this.showHistory = options.showHistory !== false;
    this.values = [];
    this.items = [];
    this.selectedIndex = -1;
    this.popoverEl = null;
    this._autoClose = null;
    this._listeners = [];
    this._bind('input', () => this.update());
    this._bind('focus', () => this.update());
    this._bind('blur', () => this.close());
    this._bind('keydown', (ev) => this.onKeyDown(ev));
  }

  _bind(type, handler) {
    this.inputEl.addEventListener(type, handler);
    this._listeners.push([type, handler]);
  }

  destroy() {
    for (const [type, handler] of this._listeners) this.inputEl.removeEventListener(type, handler);
    this._listeners = [];
    this.close();
  }

  get isOpen() {
    return !!this.popoverEl;
  }

  /* ------------------------------------------------------------ 历史 */

  loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : null;
      return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
    } catch (error) {
      return [];
    }
  }

  /** 原版 saveSearch：最近在前、去重、最多 20 条。 */
  saveHistory(query) {
    const text = String(query || '').trim();
    if (!text) return;
    const list = this.loadHistory().filter((item) => item !== text);
    list.unshift(text);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
    } catch (error) { /* 存储不可用时忽略 */ }
  }

  clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (error) { /* ignore */ }
  }

  /* ------------------------------------------------------------ 建议 */

  /** 原版 k2.getSuggestions：算子建议 + 空输入时的历史组。 */
  getSuggestions() {
    const value = this.inputEl.value;
    if (this.inputEl.selectionStart !== this.inputEl.selectionEnd) return [];
    const token = this.token();
    const context = this.contextSuggestions();
    if (context) return context;
    const out = [];
    // 原版：算子名按当前词元前缀匹配；词元已含冒号说明是算子上下文（原版走匹配器栈分支，不再给算子建议）
    if (!token.text.includes(':')) {
      const lower = token.text.toLowerCase();
      const matched = OPERATORS.filter((op) => op.name.toLowerCase().startsWith(lower));
      if (matched.length) {
        out.push({
          type: 'group',
          name: t('plugins.search.label-search-options'),
          icon: 'info',
          iconTooltip: t('plugins.search.tooltip-read-more'),
          callback: () => this.openDocs(),
        });
        for (const op of matched) out.push(op);
      }
    }
    if (this.showHistory && !value) {
      const history = this.loadHistory();
      if (history.length) {
        out.push({
          type: 'group',
          name: t('plugins.search.label-history'),
          icon: 'x',
          iconTooltip: t('plugins.search.tooltip-clear-history'),
          callback: () => this.clearHistory(),
        });
        for (const item of history) out.push({ type: 'history', name: item });
      }
    }
    return out;
  }

  /** 原版 k2 的上下文分支：tag: 后给标签、path: 后给目录。 */
  contextSuggestions() {
    const before = this.inputEl.value.slice(0, this.inputEl.selectionStart);
    const tagMatch = /(?:^|\s)tag:([^\s]*)$/.exec(before);
    if (tagMatch) {
      const prefix = tagMatch[1].toLowerCase();
      const tags = Object.keys((this.app.metadataCache && this.app.metadataCache.getTags()) || {}).sort();
      const matched = tags.filter((tag) => tag.slice(1).toLowerCase().startsWith(prefix));
      if (!matched.length) return null;
      return [
        { type: 'group', name: t('plugins.search.label-tags-group'), icon: 'info', iconTooltip: t('plugins.search.tooltip-read-more'), callback: () => this.openDocs() },
        ...matched.map((tag) => ({ type: 'string', name: tag })),
      ];
    }
    const pathMatch = /(?:^|\s)path:([^\s]*)$/.exec(before);
    if (pathMatch) {
      const prefix = pathMatch[1].toLowerCase();
      const folders = this.folders().filter((path) => path.toLowerCase().startsWith(prefix));
      if (!folders.length) return null;
      return folders.map((path) => ({ type: 'string', name: path }));
    }
    return null;
  }

  /** 库内目录路径（原版 app.vault.getAllLoadedFiles 的目录部分）。 */
  folders() {
    const out = [];
    const walk = (folder) => {
      for (const child of (folder && folder.children) || []) {
        if (!(child instanceof TFolder)) continue;
        out.push(child.path);
        walk(child);
      }
    };
    const root = this.app.vault.getRoot();
    if (root) walk(root);
    return out;
  }

  /** 当前词元：空白与括号为界；算子后的取值（tag:/path: 之后）单独成词元。 */
  token() {
    const value = this.inputEl.value;
    const pos = this.inputEl.selectionStart;
    const isDelim = (ch) => ch === undefined || /[\s()[\]]/.test(ch);
    let start = pos;
    let end = pos;
    while (start > 0 && !isDelim(value[start - 1])) start--;
    while (end < value.length && !isDelim(value[end])) end++;
    const colon = value.lastIndexOf(':', pos - 1);
    if (colon >= 0 && /(?:^|\s)(?:tag|path):$/.test(value.slice(0, colon + 1))) start = colon + 1;
    return { start, end, text: value.slice(start, end) };
  }

  openDocs() {
    Desktop.openExternal(docsUrl());
  }

  /* ------------------------------------------------------------ 面板 */

  update() {
    const values = this.getSuggestions();
    if (!values.length) {
      this.close();
      return;
    }
    this.values = values;
    this.render();
    this.setSelected(values[0].type === 'group' ? 1 : 0);
    this.open();
    this.position();
    this.scheduleAutoClose();
  }

  render() {
    if (!this.popoverEl) {
      this.popoverEl = createDiv('suggestion-container mod-search-suggestion');
      this.popoverEl.createDiv('suggestion');
      document.body.appendChild(this.popoverEl);
      // 原版 suggestEl.on("mousedown", ".suggestion-item", preventDefault)：点条目时输入框不失焦
      this.popoverEl.addEventListener('mousedown', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('.suggestion-item')) ev.preventDefault();
      });
    }
    const inner = this.popoverEl.firstElementChild;
    inner.empty();
    this.items = this.values.map((value, index) => this.renderItem(value, index, inner));
  }

  renderItem(value, index, parent) {
    const el = parent.createDiv('suggestion-item');
    el.addClass('mod-complex');
    el.addClass('search-suggest-item');
    if (value.type === 'group') el.addClass('mod-group');
    const content = el.createDiv('suggestion-content');
    const title = content.createDiv('suggestion-title');
    if (value.type === 'group') {
      title.addClass('list-item-part');
      title.addClass('mod-extended');
    }
    title.createSpan({ text: value.name });
    if (value.type === 'operator') {
      title.createSpan({ cls: 'search-suggest-info-text', text: t(value.descKey) });
    }
    const aux = el.createDiv('suggestion-aux');
    if (value.type === 'group') {
      const icon = aux.createDiv('list-item-part search-suggest-icon clickable-icon');
      setIcon(icon, value.icon);
      icon.setAttr('aria-label', value.iconTooltip);
      icon.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (value.callback) value.callback();
        this.update();
      };
    }
    el.onmousemove = () => this.setSelected(index);
    el.onclick = (ev) => {
      ev.preventDefault();
      this.setSelected(index);
      this.apply(value, ev);
    };
    return el;
  }

  open() {
    if (this.popoverEl) this.popoverEl.style.display = '';
  }

  close() {
    if (this.popoverEl) {
      this.popoverEl.detach();
      this.popoverEl = null;
    }
    this.values = [];
    this.items = [];
    this.selectedIndex = -1;
    clearTimeout(this._autoClose);
    this._autoClose = null;
  }

  position() {
    if (!this.popoverEl) return;
    const rect = this.inputEl.getBoundingClientRect();
    this.popoverEl.style.position = 'absolute';
    this.popoverEl.style.width = Math.max(this.inputEl.offsetWidth, MIN_WIDTH) + 'px';
    this.popoverEl.style.left = rect.left + 'px';
    this.popoverEl.style.top = (rect.bottom + GAP) + 'px';
  }

  /** 原版 setAutoDestroy：输入框不可见时收起面板。 */
  scheduleAutoClose() {
    clearTimeout(this._autoClose);
    this._autoClose = setTimeout(() => {
      this._autoClose = null;
      if (!this.inputEl.isShown || !this.inputEl.isShown()) this.close();
    }, AUTO_CLOSE_DELAY);
  }

  setSelected(index) {
    const count = this.values.length;
    if (!count) { this.selectedIndex = -1; return; }
    if (index < 0) index = count - 1;
    else if (index >= count) index = 0;
    const previous = this.items[this.selectedIndex];
    if (previous) previous.removeClass('is-selected');
    this.selectedIndex = index;
    const el = this.items[index];
    if (el) {
      el.addClass('is-selected');
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }

  onKeyDown(ev) {
    if (!this.isOpen || ev.isComposing) return;
    const key = ev.key;
    if (key === 'ArrowDown') { ev.preventDefault(); this.setSelected(this.selectedIndex + 1); }
    else if (key === 'ArrowUp') { ev.preventDefault(); this.setSelected(this.selectedIndex - 1); }
    else if (key === 'Home') { ev.preventDefault(); this.setSelected(0); }
    else if (key === 'End') { ev.preventDefault(); this.setSelected(this.values.length - 1); }
    else if (key === 'Enter') { ev.preventDefault(); this.apply(this.values[this.selectedIndex], ev); }
    else if (key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.close(); }
  }

  /** 原版 selectSuggestion：算子插入 token（末尾带括号时光标前移一格），标签/目录插入原文并补空格。 */
  apply(value, ev) {
    if (!value || value.type === 'group') {
      if (ev) ev.preventDefault();
      return;
    }
    const token = this.token();
    let text = value.type === 'operator' ? value.token : value.name;
    if (value.type === 'string') {
      if (/[\[\]\(\)\s:]/.test(text)) text = '"' + text + '"';
      text += ' ';
    }
    const next = this.inputEl.value.slice(0, token.start) + text + this.inputEl.value.slice(token.end).trimStart();
    let caret = token.start + text.length;
    if (value.type === 'operator' && /[)\]]$/.test(text)) caret -= 1;
    this.inputEl.value = next;
    this.inputEl.setSelectionRange(caret, caret);
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}
