/**
 * [INPUT]: 依赖 CM6、folding.js 折叠策略、live-preview.js 装饰、link-suggest.js 的 [[链接]] 浮窗与 markdown/highlight.js 语义颜色。
 * [OUTPUT]: 导出 Editor、EditorState、EditorView、ViewPlugin；Editor.setFolding 热切换标题与缩进折叠；Editor.setValue 整弹重建 state（撤销栈不跨文档边界）。
 * [POS]: editor/ 的 CM6 包装层。构造原版 file layout DOM（.cm-sizer/.cm-contentContainer）。独立 Compartment 保留文档与撤销栈；位置采用零基 {line, ch}。
 *        [[链接]] 不注册 CM6 autocompletion（不产生 .cm-completionInfo 双列），由 LinkSuggest 的 EditorSuggest 单列浮窗接管。
 *        拖放：payload.type=file 插入单条链接；type=files 按 items 顺序插入全部文件链接（原版 IR）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Editor — CodeMirror 6 wrapper exposing the Obsidian `Editor` API subset.
 * Positions are {line, ch} 0-based (EditorPosition / EditorRange / EditorSelection).
 */
import { EditorState, EditorSelection, Compartment, Prec, type Extension } from '@codemirror/state';
import {
  EditorView, keymap as cmKeymap, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, highlightSpecialChars, lineNumbers, rectangularSelection,
  crosshairCursor, placeholder as cmPlaceholder, ViewPlugin, type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit, indentOnInput,
} from '@codemirror/language';
import { tags as hlTags } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { livePreviewExtension } from './live-preview.js';
import { saveAttachment, pastedImageBaseName } from './attachments.js';
import { LinkSuggest } from './link-suggest.js';
import { eventToHotkey } from '../core/keymap.js';
import { TFile } from '../core/vault.js';
import { markdownEditing, foldingExtensions, unfoldDisabledFolds } from './folding.js';
import { codeHighlighter } from '../markdown/highlight.js';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function themeSpec(dark: boolean) {
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
/** 从剪贴板数据挑选图片：文件优先，其次 HTML 里的 data URL（原版同序）。 */
function isFileDrop(value: unknown): value is { type: 'file'; path: string } {
  return value !== null && typeof value === 'object' && 'type' in value && value.type === 'file' && 'path' in value && typeof value.path === 'string';
}
type ClipboardImage = { kind: 'file'; file: File } | { kind: 'dataurl'; dataUrl: string; ext: string };
export interface EditorPosition { line: number; ch: number; }
export interface EditorRange { anchor: EditorPosition; head: EditorPosition; }
export interface EditorOptions { doc?: string; readOnly?: boolean; livePreview?: boolean; onSaveRequest?: () => void; }
type CursorSide = 'from' | 'to' | 'anchor' | 'head';

function pickClipboardImage(dt: DataTransfer): ClipboardImage | null {
  const files = dt.files ? Array.from(dt.files) : [];
  const direct = files.find((f) => /^image\//.test(f.type || ''));
  if (direct) return { kind: 'file', file: direct };
  const items = dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it.kind === 'file' && /^image\//.test(it.type || '')) {
      const f = it.getAsFile();
      if (f) return { kind: 'file', file: f };
    }
  }
  let html = '';
  try { html = dt.getData('text/html') || ''; } catch (e) { html = ''; }
  const m = html.match(/src="(data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[^"]+)"/i);
  if (m) return { kind: 'dataurl', dataUrl: m[1], ext: m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase() };
  return null;
}

async function readClipboardImage(picked: ClipboardImage) {
  if (picked.kind === 'file') {
    const type = (picked.file.type || '').toLowerCase();
    const ext = type === 'image/jpeg' ? 'jpg' : ((type.split('/')[1] || 'png').replace('svg+xml', 'svg'));
    return { bytes: new Uint8Array(await picked.file.arrayBuffer()), ext };
  }
  const b64 = picked.dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext: picked.ext };
}

export class Editor {
  inTableCell?: boolean;
  declare app: App;
  declare containerEl: HTMLElement;
  declare options: EditorOptions;
  declare sourcePath: string;
  declare changeListeners: Array<(text: string, update: ViewUpdate | null) => void>;
  declare selectionListeners: Array<() => void>;
  declare _themeCompartment: Compartment;
  declare _livePreviewCompartment: Compartment;
  declare _readonlyCompartment: Compartment;
  declare _lineNumbersCompartment: Compartment;
  declare _wrapCompartment: Compartment;
  declare _keymapCompartment: Compartment;
  declare _extCompartment: Compartment;
  declare _indentCompartment: Compartment;
  declare _bracketsCompartment: Compartment;
  declare _foldingCompartment: Compartment;
  declare _foldHeading: boolean;
  declare _foldIndent: boolean;
  declare _extensions: Extension[];
  declare cm: EditorView;
  declare linkSuggest: LinkSuggest;
  declare _containerKeyHandler: (event: KeyboardEvent) => void;
  declare sizerEl: HTMLElement;
  declare contentContainerEl: HTMLElement;
  declare _focused: boolean | undefined;
  declare livePreview: boolean | undefined;

  constructor(containerEl: HTMLElement, app: App, options: EditorOptions = {}) {
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
    this._buildSizerDom();
    this.linkSuggest = new LinkSuggest(this);
    this.cm.dom.classList.toggle('is-folding', this._foldHeading || this._foldIndent);
    this.setSpellcheck(app.settings && app.settings.appSettings.spellcheck === true);

    // intercept Obsidian-style keys before the default browser behavior
    this._containerKeyHandler = (ev) => this._onKeyDown(ev);
    containerEl.addEventListener('keydown', this._containerKeyHandler, true);
  }

  /**
   * 原版 rZ 构造：CM6 原生没有 .cm-sizer/.cm-contentContainer；
   * 这里自建并把 .cm-content 移入，行宽（is-readable-line-width）与居中规则才会生效。
   * CM6 挂载 gutter 时假设 .cm-content 仍是 .cm-scroller 直接子元素（insertBefore 引用它），
   * 故重定向到 .cm-contentContainer —— 与原版同形 DOM。
   */
  _buildSizerDom() {
    const scroller = this.cm.scrollDOM;
    const content = this.cm.contentDOM;
    const nativeInsertBefore = scroller.insertBefore.bind(scroller);
    scroller.insertBefore = (node, reference) => {
      if (reference === content && content.parentElement && content.parentElement !== scroller) {
        return content.parentElement.insertBefore(node, content);
      }
      return nativeInsertBefore(node, reference);
    };
    content.detach();
    const sizer = scroller.createDiv('cm-sizer');
    const contentContainer = sizer.createDiv('cm-contentContainer');
    const gutters = scroller.querySelector('.cm-gutters');
    if (gutters) contentContainer.appendChild(gutters);
    contentContainer.appendChild(content);
    this.sizerEl = sizer;
    this.contentContainerEl = contentContainer;
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
      Prec.high(cmKeymap.of([
        { key: 'Mod-f', run: (v) => { openSearchPanel(v); return true; }, preventDefault: true },
      ])),
      cmKeymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
      markdownEditing,
      this._foldingCompartment.of(foldingExtensions(this._foldHeading, this._foldIndent)),
      syntaxHighlighting(markdownHighlightDark),
      syntaxHighlighting(codeHighlighter),
      highlightSelectionMatches(),
      this._themeCompartment.of(themeSpec(dark)),
      this._livePreviewCompartment.of(this.options.livePreview === false ? [] : livePreviewExtension(app, () => this.sourcePath)),
      this._lineNumbersCompartment.of((app.settings && app.settings.appSettings.showLineNumber) ? [lineNumbers(), highlightActiveLineGutter()] : []),
      this._wrapCompartment.of(EditorView.lineWrapping),
      this._extCompartment.of(this._extensions),
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
          // 文件树拖拽带 text/plain JSON；系统外部文件拖入带 Files；都允许放置
          const dt = event.dataTransfer;
          if (!dt || !dt.types) return false;
          const types = Array.from(dt.types);
          if (types.includes('Files') || types.includes('text/plain')) { event.preventDefault(); return true; }
          return false;
        },
        drop: (event, view) => this._handleDrop(event, view),
        paste: (event) => this._handlePaste(event),
      }),
    ];
  }

  /** 文件树拖入编辑器：在落点插入内部链接；系统外部文件：复制进库并插入嵌入（原版 handleDropIntoEditor）。 */
  _handleDrop(event: DragEvent, view: EditorView) {
    const dt = event.dataTransfer;
    if (!dt) return false;
    const files = dt.files && dt.files.length ? Array.from(dt.files) : [];
    if (files.length) {
      event.preventDefault();
      this._insertDroppedFiles(files, view, event);
      return true;
    }
    let payload: unknown = null;
    try { payload = JSON.parse(dt.getData('text/plain')); } catch (e) { payload = null; }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const from = pos == null ? view.state.selection.main.head : pos;
    // 原版 IR：type=files 时按顺序插入全部文件链接，type=file 插入单条
    if (payload && typeof payload === 'object' && 'type' in payload && payload.type === 'files' && 'items' in payload && Array.isArray(payload.items)) {
      const files = payload.items
        .filter(isFileDrop)
        .map(item => this.app.vault.getFileByPath(item.path))
        .filter((file) => file instanceof TFile);
      if (!files.length) return false;
      event.preventDefault();
      const links = files.map((file) => this.app.fileManager.generateMarkdownLink(file, this.sourcePath || '', '', '', undefined)).join('\n');
      view.dispatch({ changes: { from, insert: links }, selection: { anchor: from + links.length } });
      return true;
    }
    if (!isFileDrop(payload)) return false;
    const file = this.app.vault.getFileByPath(payload.path);
    if (!file) return false;
    event.preventDefault();
    const link = this.app.fileManager.generateMarkdownLink(file, this.sourcePath || '', '', '', undefined);
    view.dispatch({ changes: { from, insert: link }, selection: { anchor: from + link.length } });
    return true;
  }

  /**
   * 原版粘贴：剪贴板图片（截图 / 复制的图片 / HTML data URL）落盘为
   * 'Pasted image <时间戳>.png' 并插入嵌入；纯文本粘贴交回 CM6。
   */
  _handlePaste(event: ClipboardEvent) {
    const dt = event.clipboardData;
    if (!dt) return false;
    const picked = pickClipboardImage(dt);
    if (!picked) return false;
    event.preventDefault();
    this._insertClipboardImage(picked);
    return true;
  }

  async _insertClipboardImage(picked: ClipboardImage) {
    const { bytes, ext } = await readClipboardImage(picked).catch(() => ({ bytes: null, ext: 'png' }));
    if (!bytes) return;
    const file = await saveAttachment(this.app, pastedImageBaseName(), ext, bytes, this.sourcePath);
    const link = '!' + this.app.fileManager.generateMarkdownLink(file, this.sourcePath || '', '', '', undefined);
    this.replaceSelection(link);
  }

  /**
   * 原版 handleDropIntoEditor：外部文件复制进库（附件目录）并插入 `![[…]]`；
   * 按住 Alt（macOS，其它平台 Ctrl）时直接链接：库内文件 → 内链，库外 → file:// 链接。
   */
  async _insertDroppedFiles(files: File[], view: EditorView, event: DragEvent) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const from = pos == null ? view.state.selection.main.head : pos;
    const isMac = /mac/i.test(navigator.platform || '');
    const direct = isMac ? event.altKey : event.ctrlKey;
    const parts = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      const dot = f.name.lastIndexOf('.');
      const name = dot > 0 ? f.name.slice(0, dot) : f.name;
      const ext = dot > 0 ? f.name.slice(dot + 1) : '';
      let link = null;
      if (direct) link = this._linkForExternalFile(f);
      if (!link) {
        let data = null;
        try { data = await f.arrayBuffer(); } catch (e) { data = null; }
        if (data == null) continue;
        const file = await saveAttachment(this.app, name, ext, data, this.sourcePath);
        link = '!' + this.app.fileManager.generateMarkdownLink(file, this.sourcePath || '', '', '', undefined);
      }
      parts.push(link + (i < files.length - 1 ? '\n\n' : ''));
    }
    if (!parts.length) return;
    const text = parts.join('');
    view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length } });
  }

  /** Alt/Ctrl 拖入：解析系统路径；库内文件转内链，库外生成 file:// 链接；无路径返回 null 走复制路径。 */
  _linkForExternalFile(file: File) {
    let abs = '';
    try {
      const { webUtils } = require('electron');
      if (webUtils && typeof webUtils.getPathForFile === 'function') abs = webUtils.getPathForFile(file) || '';
    } catch (e) { abs = ''; }
    if (!abs) return null;
    const adapter = this.app.vault.adapter;
    const rel = adapter && typeof adapter.toRel === 'function' ? adapter.toRel(abs) : '';
    const inside = rel ? this.app.vault.getFileByPath(rel) : null;
    if (inside) return '!' + this.app.fileManager.generateMarkdownLink(inside, this.sourcePath || '', '', '', undefined);
    const uri = 'file://' + abs.split('/').map((s) => encodeURIComponent(s)).join('/');
    return '[' + file.name + '](' + uri + ')';
  }

  // -------------------------------------------------------------------------
  // Change events
  // -------------------------------------------------------------------------
  onChange(cb: (text: string, update: ViewUpdate | null) => void) { this.changeListeners.push(cb); }
  onSelectionChange(cb: () => void) { this.selectionListeners.push(cb); }
  _emitSelection() {
    for (const cb of this.selectionListeners) {
      try { cb(); } catch (e) { console.error(e); }
    }
  }
  _emitChange(update: ViewUpdate | null) {
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

  setValue(content: string) {
    const insert = typeof content === 'string' ? content : content == null ? '' : String(content);
    // 撤销栈不跨文档边界：装载/整文档替换必须重建历史。
    // 否则一次 Mod+Z 会撤消"装入"本身（空文档被自动保存写盘），
    // 且切文件后会把上一文件编辑的逆操作打进当前文件。
    // history() 是模块级 StateField（compartment 重配清不掉），故整弹重建 state。
    if (this.linkSuggest) this.linkSuggest.close();
    const extensions = this._baseExtensions();
    this.cm.setState(EditorState.create({ doc: insert, extensions }));
    // setState 不派发事务：手动通知订阅者（markdown-view / 画布卡片靠它同步数据），
    // 保持与旧 dispatch 时代相同的观察语义，只是不再入撤销栈。
    this._emitChange(null);
  }

  getLine(line: number) {
    const doc = this.cm.state.doc;
    const n = Math.max(1, Math.min(doc.lines, line + 1));
    return doc.line(n).text;
  }

  setLine(line: number, text: string) {
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

  setSelection(anchor: EditorPosition | number, head?: EditorPosition | number) {
    if (typeof anchor === 'number') anchor = this.offsetToPos(anchor);
    if (head === undefined) head = anchor;
    else if (typeof head === 'number') head = this.offsetToPos(head);
    this.cm.dispatch({ selection: { anchor: this.posToOffset(anchor), head: this.posToOffset(head) } });
  }

  setSelections(ranges: EditorRange[]) {
    this.cm.dispatch({
      selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(this.posToOffset(r.anchor), this.posToOffset(r.head)))),
    });
  }

  somethingSelected() { return !this.cm.state.selection.main.empty; }

  getCursor(string?: CursorSide) {
    const sel = this.cm.state.selection.main;
    const offset = string === 'from' ? sel.from : string === 'to' ? sel.to : string === 'head' ? sel.head : sel.anchor;
    return this.offsetToPos(offset);
  }

  setCursor(line: number | EditorPosition | CursorSide, ch?: number) {
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
    const offset = typeof line === 'string' ? map[line] : undefined;
    if (offset !== undefined) this.cm.dispatch({ selection: { anchor: offset, head: offset } });
  }

  getRange(from: EditorPosition, to: EditorPosition) {
    return this.cm.state.sliceDoc(this.posToOffset(from), this.posToOffset(to));
  }

  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition) {
    this.cm.dispatch({ changes: { from: this.posToOffset(from), to: this.posToOffset(to === undefined ? from : to), insert: replacement } });
  }

  replaceSelection(replacement: string) {
    const sel = this.cm.state.selection.main;
    this.cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: replacement }, selection: { anchor: sel.from + replacement.length } });
  }

  undo() { undo(this.cm); }
  redo() { redo(this.cm); }

  focus() { this.cm.focus(); }
  blur() { this.cm.contentDOM.blur(); }
  hasFocus() { return this.cm.hasFocus; }

  scrollIntoView(range: EditorPosition | { from: EditorPosition; to?: EditorPosition }, center = false) {
    const from = this.posToOffset('from' in range ? range.from : range);
    const to = this.posToOffset('from' in range ? range.to || range.from : range);
    this.cm.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: center ? 'center' : 'nearest' }) });
  }

  scrollTo(line: number, ch = 0) {
    const l = Math.max(0, Math.min(this.cm.state.doc.lines - 1, line));
    this.scrollIntoView({ from: { line: l, ch }, to: { line: l, ch } }, true);
  }

  posToOffset(pos: EditorPosition | null | undefined) {
    const doc = this.cm.state.doc;
    if (!pos) return 0;
    const line = Math.max(0, Math.min(doc.lines - 1, pos.line || 0));
    const l = doc.line(line + 1);
    const ch = Math.max(0, Math.min(l.length, pos.ch || 0));
    return l.from + ch;
  }

  offsetToPos(offset: number) {
    const doc = this.cm.state.doc;
    const len = doc.length;
    offset = Math.max(0, Math.min(len, offset));
    const line = doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  }

  transaction(tx: string | { changes?: string; selection?: { from: number; to?: number } }) {
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

  addExtensions(ext: Extension) {
    this._extensions.push(...(Array.isArray(ext) ? ext : [ext]));
    this.cm.dispatch({ effects: this._extCompartment.reconfigure(this._extensions) });
  }

  removeExtensions(ext: Extension) {
    const arr: Extension[] = Array.isArray(ext) ? ext : [ext];
    this._extensions = this._extensions.filter((e) => !arr.includes(e));
    this.cm.dispatch({ effects: this._extCompartment.reconfigure(this._extensions) });
  }

  toggleLineNumbers(show: boolean) {
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

  setCloseBrackets(enabled: boolean) {
    this.cm.dispatch({ effects: this._bracketsCompartment.reconfigure(enabled ? closeBrackets() : []) });
  }

  setSpellcheck(enabled: boolean) {
    if (this.cm && this.cm.contentDOM) this.cm.contentDOM.spellcheck = !!enabled;
  }

  setFolding(heading: boolean, indent: boolean) {
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

  setReadOnly(ro: boolean) {
    this.cm.dispatch({ effects: this._readonlyCompartment.reconfigure(EditorView.editable.of(!ro)) });
  }

  setLineWrapping(wrap: boolean) {
    this.cm.dispatch({ effects: this._wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  setLivePreview(enabled: boolean) {
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
  applyScrollInfo(info: { top?: number; left?: number } | null) {
    if (!info) return;
    this.cm.scrollDOM.scrollTop = info.top || 0;
    this.cm.scrollDOM.scrollLeft = info.left || 0;
  }

  destroy() {
    this.containerEl.removeEventListener('keydown', this._containerKeyHandler, true);
    if (this.linkSuggest) this.linkSuggest.destroy();
    this.cm.destroy();
  }

  // -------------------------------------------------------------------------
  // Key handling: let editor-specific Obsidian commands run first
  // -------------------------------------------------------------------------
  _onKeyDown(ev: KeyboardEvent) {
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

function hotkeyToCanonical(hk: { modifiers?: string[]; key?: string } | null | undefined) {
  if (!hk) return null;
  const order = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
  const mods = new Set(hk.modifiers || []);
  const sorted = order.filter((m) => mods.has(m));
  return sorted.join('+') + ':' + (hk.key || '').toLowerCase();
}

// Re-export commonly needed pieces
export { EditorState, EditorView, ViewPlugin };
