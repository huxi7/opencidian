/**
 * [INPUT]: 依赖 CM6、folding.js 折叠策略、live-preview.js 装饰与 markdown/highlight.js 语义颜色。
 * [OUTPUT]: 导出 Editor、EditorState、EditorView、ViewPlugin；Editor.setFolding 热切换标题与缩进折叠。
 * [POS]: editor/ 的 CM6 包装层。独立 Compartment 保留文档与撤销栈；位置采用零基 {line, ch}。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Editor — CodeMirror 6 wrapper exposing the Obsidian `Editor` API subset.
 * Positions are {line, ch} 0-based (EditorPosition / EditorRange / EditorSelection).
 */
import { EditorState, EditorSelection, Compartment, Prec } from '@codemirror/state';
import {
  EditorView, keymap as cmKeymap, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, highlightSpecialChars, lineNumbers, rectangularSelection,
  crosshairCursor, placeholder as cmPlaceholder, ViewPlugin,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit, indentOnInput,
} from '@codemirror/language';
import { tags as hlTags } from '@lezer/highlight';
import {
  searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, searchPanelOpen,
} from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { livePreviewExtension } from './live-preview.js';
import { wikilinkCompletionSource } from './completions.js';
import { eventToHotkey } from '../core/keymap.js';
import { markdownEditing, foldingExtensions, unfoldDisabledFolds } from './folding.js';
import { codeHighlighter } from '../markdown/highlight.js';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function themeSpec(dark) {
  return EditorView.theme({
    '&': {
      color: 'var(--text-normal)',
      backgroundColor: 'transparent',
      height: '100%',
      fontFamily: 'var(--font-text)',
      fontSize: 'var(--font-text-size)',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'var(--line-height-normal)',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: 'var(--caret-color, var(--text-normal))',
      padding: 'var(--file-margins, 12px) 0',
    },
    '.cm-line': { padding: '0 16px 0 8px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-normal)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--text-selection)',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--text-faint)',
      border: 'none',
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--text-selection)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--background-modifier-hover)',
      outline: 'none',
    },
    '.cm-searchMatch': { backgroundColor: 'var(--text-highlight-bg)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--text-highlight-bg-active)' },
    '.cm-foldGutter span, .cm-foldGutter': { color: 'var(--text-faint)' },
    '.cm-panels': { backgroundColor: 'var(--background-secondary)', color: 'var(--text-normal)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--background-secondary)',
      border: '1px solid var(--background-modifier-border)',
      borderRadius: 'var(--radius-s)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--background-modifier-hover)',
      color: 'var(--text-normal)',
    },
  }, { dark });
}

const markdownHighlightDark = HighlightStyle.define([
  { tag: hlTags.heading1, color: 'var(--h1-color)', fontWeight: 'var(--h1-weight)' },
  { tag: hlTags.heading2, color: 'var(--h2-color)', fontWeight: 'var(--h2-weight)' },
  { tag: hlTags.heading3, color: 'var(--h3-color)', fontWeight: 'var(--h3-weight)' },
  { tag: hlTags.heading4, color: 'var(--h4-color)', fontWeight: 'var(--h4-weight)' },
  { tag: hlTags.heading5, color: 'var(--h5-color)', fontWeight: 'var(--h5-weight)' },
  { tag: hlTags.heading6, color: 'var(--h6-color)', fontWeight: 'var(--h6-weight)' },
  { tag: hlTags.strong, fontWeight: 'var(--bold-weight)', color: 'var(--bold-color)' },
  { tag: hlTags.emphasis, fontStyle: 'italic', color: 'var(--italic-color)' },
  { tag: hlTags.strikethrough, textDecoration: 'line-through' },
  { tag: hlTags.link, color: 'var(--link-color)' },
  { tag: hlTags.url, color: 'var(--link-color)' },
  { tag: hlTags.monospace, fontFamily: 'var(--font-monospace)', fontSize: 'var(--code-size)' },
  { tag: hlTags.quote, color: 'var(--text-muted)' },
  { tag: hlTags.comment, color: 'var(--text-faint)' },
  { tag: hlTags.processingInstruction, color: 'var(--text-faint)' },
  { tag: hlTags.contentSeparator, color: 'var(--text-muted)' },
  { tag: hlTags.meta, color: 'var(--text-muted)' },
  { tag: hlTags.escape, color: 'var(--text-muted)' },
  { tag: hlTags.keyword, color: 'var(--code-keyword)' },
  { tag: hlTags.string, color: 'var(--code-string)' },
  { tag: hlTags.number, color: 'var(--code-value)' },
  { tag: hlTags.function(hlTags.variableName), color: 'var(--code-function)' },
]);

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
export class Editor {
  constructor(containerEl, app, options = {}) {
    this.app = app;
    this.containerEl = containerEl;
    this.options = options;
    this.sourcePath = '';
    this.changeListeners = [];
    this.selectionListeners = [];
    this._themeCompartment = new Compartment();
    this._livePreviewCompartment = new Compartment();
    this._readonlyCompartment = new Compartment();
    this._lineNumbersCompartment = new Compartment();
    this._wrapCompartment = new Compartment();
    this._keymapCompartment = new Compartment();
    this._extCompartment = new Compartment();
    this._indentCompartment = new Compartment();
    this._bracketsCompartment = new Compartment();
    this._foldingCompartment = new Compartment();
    const settings = app.settings?.appSettings || {};
    this._foldHeading = settings.foldHeading !== false;
    this._foldIndent = settings.foldIndent !== false;
    this._extensions = [];

    const extensions = this._baseExtensions();
    const state = EditorState.create({ doc: options.doc || '', extensions });

    this.cm = new EditorView({ state, parent: containerEl });
    this.cm.dom.classList.toggle('is-folding', this._foldHeading || this._foldIndent);
    this.setSpellcheck(app.settings && app.settings.appSettings.spellcheck === true);

    // intercept Obsidian-style keys before the default browser behavior
    this._containerKeyHandler = (ev) => this._onKeyDown(ev);
    containerEl.addEventListener('keydown', this._containerKeyHandler, true);
  }

  _baseExtensions() {
    const app = this.app;
    const dark = document.body.hasClass ? document.body.hasClass('theme-dark') : true;
    const vim = false; // vim mode not implemented yet
    return [
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      EditorState.allowMultipleSelections.of(true),
      this._indentCompartment.of(this._indentUnitExt()),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      this._bracketsCompartment.of((app.settings && app.settings.appSettings.autoPairBrackets !== false) ? closeBrackets() : []),
      autocompletion({
        override: [wikilinkCompletionSource(app)],
        activateOnTyping: true,
      }),
      Prec.high(cmKeymap.of([
        { key: 'Mod-f', run: (v) => { openSearchPanel(v); return true; }, preventDefault: true },
      ])),
      cmKeymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      markdownEditing,
      this._foldingCompartment.of(foldingExtensions(this._foldHeading, this._foldIndent)),
      syntaxHighlighting(markdownHighlightDark),
      syntaxHighlighting(codeHighlighter),
      highlightSelectionMatches(),
      this._themeCompartment.of(themeSpec(dark)),
      this._livePreviewCompartment.of(livePreviewExtension(app, () => this.sourcePath)),
      this._lineNumbersCompartment.of((app.settings && app.settings.appSettings.showLineNumber) ? [lineNumbers(), highlightActiveLineGutter()] : []),
      this._wrapCompartment.of(EditorView.lineWrapping),
      this._extCompartment.of([]),
      this._readonlyCompartment.of(EditorView.editable.of(!this.options.readOnly)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this._emitChange(update);
        }
        if (update.selectionSet) {
          this._emitSelection();
        }
        if (update.focusChanged && update.view.hasFocus) {
          this._focused = true;
        }
      }),
      EditorView.domEventHandlers({
        blur: () => { this._focused = false; },
        focus: () => { this._focused = true; },
        dragover: (event) => {
          // 文件树拖拽带 text/plain JSON；允许放置以插入链接
          const dt = event.dataTransfer;
          if (dt && dt.types && Array.from(dt.types).includes('text/plain')) { event.preventDefault(); return true; }
          return false;
        },
        drop: (event, view) => this._handleDrop(event, view),
      }),
    ];
  }

  /** 文件树拖入编辑器：在落点插入内部链接（原版 drop → 插入 wiki/markdown 链接）。 */
  _handleDrop(event, view) {
    const dt = event.dataTransfer;
    if (!dt) return false;
    let payload = null;
    try { payload = JSON.parse(dt.getData('text/plain')); } catch (e) { payload = null; }
    if (!payload || typeof payload.path !== 'string' || payload.type !== 'file') return false;
    const file = this.app.vault.getFileByPath(payload.path);
    if (!file) return false;
    event.preventDefault();
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const from = pos == null ? view.state.selection.main.head : pos;
    const link = this.app.fileManager.generateMarkdownLink(file, this.sourcePath || '', '', '', undefined);
    view.dispatch({ changes: { from, insert: link }, selection: { anchor: from + link.length } });
    return true;
  }

  // -------------------------------------------------------------------------
  // Change events
  // -------------------------------------------------------------------------
  onChange(cb) { this.changeListeners.push(cb); }
  onSelectionChange(cb) { this.selectionListeners.push(cb); }
  _emitSelection() {
    for (const cb of this.selectionListeners) {
      try { cb(); } catch (e) { console.error(e); }
    }
  }
  _emitChange(update) {
    const text = this.getValue();
    for (const cb of this.changeListeners) {
      try { cb(text, update); } catch (e) { console.error(e); }
    }
  }
  triggerChange() { this._emitChange(null); }

  // -------------------------------------------------------------------------
  // Obsidian Editor API
  // -------------------------------------------------------------------------
  getDoc() { return this.cm.state.doc; }
  getValue() { return this.cm.state.doc.toString(); }

  setValue(content) {
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: content } });
  }

  getLine(line) {
    const doc = this.cm.state.doc;
    const n = Math.max(1, Math.min(doc.lines, line + 1));
    return doc.line(n).text;
  }

  setLine(line, text) {
    const doc = this.cm.state.doc;
    const n = Math.max(1, Math.min(doc.lines, line + 1));
    const l = doc.line(n);
    this.cm.dispatch({ changes: { from: l.from, to: l.to, insert: text } });
  }

  get lineCount() { return this.cm.state.doc.lines; }
  lastLine() { return this.lineCount - 1; }

  getSelection() {
    const range = this.cm.state.selection.main;
    return { anchor: this.offsetToPos(range.anchor), head: this.offsetToPos(range.head) };
  }

  listSelections() {
    return this.cm.state.selection.ranges.map((r) => ({
      anchor: this.offsetToPos(r.anchor),
      head: this.offsetToPos(r.head),
      from: this.offsetToPos(r.from),
      to: this.offsetToPos(r.to),
    }));
  }

  setSelection(anchor, head) {
    if (typeof anchor === 'number') anchor = this.offsetToPos(anchor);
    if (head === undefined) head = anchor;
    else if (typeof head === 'number') head = this.offsetToPos(head);
    this.cm.dispatch({ selection: { anchor: this.posToOffset(anchor), head: this.posToOffset(head) } });
  }

  setSelections(ranges) {
    this.cm.dispatch({
      selection: { ranges: ranges.map((r) => ({ anchor: this.posToOffset(r.anchor), head: this.posToOffset(r.head) })) },
    });
  }

  somethingSelected() { return !this.cm.state.selection.main.empty; }

  getCursor(string) {
    const sel = this.cm.state.selection.main;
    const offset = string === 'from' ? sel.from : string === 'to' ? sel.to : string === 'head' ? sel.head : sel.anchor;
    return this.offsetToPos(offset);
  }

  setCursor(line, ch) {
    if (line && typeof line === 'object') {
      this.setSelection(line);
      return;
    }
    if (typeof line === 'number') {
      this.setSelection({ line, ch: ch || 0 });
      return;
    }
    const sel = this.cm.state.selection.main;
    const map = { from: sel.from, to: sel.to, anchor: sel.anchor, head: sel.head };
    const offset = map[line];
    if (offset !== undefined) this.cm.dispatch({ selection: { anchor: offset, head: offset } });
  }

  getRange(from, to) {
    return this.cm.state.sliceDoc(this.posToOffset(from), this.posToOffset(to));
  }

  replaceRange(replacement, from, to) {
    this.cm.dispatch({ changes: { from: this.posToOffset(from), to: this.posToOffset(to === undefined ? from : to), insert: replacement } });
  }

  replaceSelection(replacement) {
    const sel = this.cm.state.selection.main;
    this.cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: replacement }, selection: { anchor: sel.from + replacement.length } });
  }

  undo() { undo(this.cm); }
  redo() { redo(this.cm); }

  focus() { this.cm.focus(); }
  blur() { this.cm.contentDOM.blur(); }
  hasFocus() { return this.cm.hasFocus; }

  scrollIntoView(range, center = false) {
    const from = this.posToOffset(range.from || range);
    const to = this.posToOffset(range.to || range);
    this.cm.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: center ? 'center' : 'nearest' }) });
  }

  scrollTo(line, ch = 0) {
    const l = Math.max(0, Math.min(this.cm.state.doc.lines - 1, line));
    this.scrollIntoView({ from: { line: l, ch }, to: { line: l, ch } }, true);
  }

  posToOffset(pos) {
    const doc = this.cm.state.doc;
    if (!pos) return 0;
    const line = Math.max(0, Math.min(doc.lines - 1, pos.line || 0));
    const l = doc.line(line + 1);
    const ch = Math.max(0, Math.min(l.length, pos.ch || 0));
    return l.from + ch;
  }

  offsetToPos(offset) {
    const doc = this.cm.state.doc;
    const len = doc.length;
    offset = Math.max(0, Math.min(len, offset));
    const line = doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  }

  transaction(tx) {
    // Obsidian EditorTransaction subset: changes (string) and selection
    if (typeof tx === 'string') {
      this.replaceSelection(tx);
      return;
    }
    if (tx && typeof tx.changes === 'string') {
      this.replaceSelection(tx.changes);
    }
    if (tx && tx.selection) {
      if (tx.selection.from !== undefined) {
        this.setSelection(this.offsetToPos(tx.selection.from), this.offsetToPos(tx.selection.to !== undefined ? tx.selection.to : tx.selection.from));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Commands / extensions
  // -------------------------------------------------------------------------
  refresh() { this.cm.requestMeasure(); }

  addExtensions(ext) {
    this._extensions.push(...[].concat(ext));
    this.cm.dispatch({ effects: this._extCompartment.reconfigure(this._extensions) });
  }

  removeExtensions(ext) {
    const arr = [].concat(ext);
    this._extensions = this._extensions.filter((e) => !arr.includes(e));
    this.cm.dispatch({ effects: this._extCompartment.reconfigure(this._extensions) });
  }

  toggleLineNumbers(show) {
    const ext = show ? [lineNumbers(), highlightActiveLineGutter()] : [];
    this.cm.dispatch({ effects: this._lineNumbersCompartment.reconfigure(ext) });
  }

  /** 缩进单位：useTab=true 用制表符，否则用 tabSize 个空格；同时刷新 Tab 显示宽度。 */
  _indentUnitExt() {
    const s = (this.app.settings && this.app.settings.appSettings) || {};
    const size = s.tabSize || 4;
    return [
      EditorState.tabSize.of(size),
      indentUnit.of(s.useTab === false ? ' '.repeat(size) : '\t'),
    ];
  }

  setIndentUnit() {
    this.cm.dispatch({ effects: this._indentCompartment.reconfigure(this._indentUnitExt()) });
  }

  setCloseBrackets(enabled) {
    this.cm.dispatch({ effects: this._bracketsCompartment.reconfigure(enabled ? closeBrackets() : []) });
  }

  setSpellcheck(enabled) {
    if (this.cm && this.cm.contentDOM) this.cm.contentDOM.spellcheck = !!enabled;
  }

  setFolding(heading, indent) {
    heading = !!heading;
    indent = !!indent;
    if (heading === this._foldHeading && indent === this._foldIndent) return;
    const effects = unfoldDisabledFolds(this.cm.state, heading, indent);
    effects.push(this._foldingCompartment.reconfigure(foldingExtensions(heading, indent)));
    this._foldHeading = heading;
    this._foldIndent = indent;
    this.cm.dispatch({ effects });
    this.cm.dom.classList.toggle('is-folding', heading || indent);
  }

  setReadOnly(ro) {
    this.cm.dispatch({ effects: this._readonlyCompartment.reconfigure(EditorView.editable.of(!ro)) });
  }

  setLineWrapping(wrap) {
    this.cm.dispatch({ effects: this._wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  setLivePreview(enabled) {
    this.livePreview = !!enabled;
    this.cm.dispatch({
      effects: this._livePreviewCompartment.reconfigure(enabled ? livePreviewExtension(this.app, () => this.sourcePath) : []),
    });
  }

  requestSave() {
    if (this.options.onSaveRequest) this.options.onSaveRequest();
  }

  openSearch() {
    if (!searchPanelOpen(this.cm.state)) openSearchPanel(this.cm);
  }
  closeSearch() { closeSearchPanel(this.cm); }

  getScrollInfo() { return { top: this.cm.scrollDOM.scrollTop, left: this.cm.scrollDOM.scrollLeft }; }
  applyScrollInfo(info) {
    if (!info) return;
    this.cm.scrollDOM.scrollTop = info.top || 0;
    this.cm.scrollDOM.scrollLeft = info.left || 0;
  }

  destroy() {
    this.containerEl.removeEventListener('keydown', this._containerKeyHandler, true);
    this.cm.destroy();
  }

  // -------------------------------------------------------------------------
  // Key handling: let editor-specific Obsidian commands run first
  // -------------------------------------------------------------------------
  _onKeyDown(ev) {
    const app = this.app;
    if (!app || !app.hotkeyManager) return;
    const manager = app.hotkeyManager;
    const hk = manager.customKeys;
    // Only intercept when this editor is focused
    if (!this.cm.hasFocus && document.activeElement !== this.cm.contentDOM) return;
    if (ev.defaultPrevented) return;
    // Let CM6 handle keys that it knows, but first check for editor commands
    // bound to hotkeys that CM6 does not handle (e.g. toggle-bold).
    const canon = hotkeyToCanonical(eventToHotkey(ev));
    if (!canon) return;
    const commandId = hk[canon];
    if (!commandId) return;
    // Editors have priority for editor: commands
    if (commandId.startsWith('editor:') || commandId.startsWith('markdown:')) {
      const handled = app.commands.executeCommandById(commandId, ev);
      if (handled) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }
  }
}

function hotkeyToCanonical(hk) {
  if (!hk) return null;
  const order = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
  const mods = new Set(hk.modifiers || []);
  const sorted = order.filter((m) => mods.has(m));
  return sorted.join('+') + ':' + (hk.key || '').toLowerCase();
}

// Re-export commonly needed pieces
export { EditorState, EditorView, ViewPlugin };
