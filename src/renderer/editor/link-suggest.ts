/**
 * [INPUT]: 依赖 CM6 的 EditorView.updateListener；依赖 completions.js 的上下文、候选与替换；依赖 core/icons.js 的 setIcon；依赖 core/i18n.js 的 t。
 * [OUTPUT]: 导出 LinkSuggest；构造时监听本编辑器的更新/滚动/缩放/失焦，destroy 解除全部监听。
 * [POS]: editor/ 的 [[链接]] 单列浮窗。DOM 逐字对齐原版 EditorSuggest：body > .suggestion-container > .suggestion + .prompt-instructions；
 *        不使用 CM6 autocompletion，因此不会出现 .cm-completionInfo 或第二预览列。容器宽度由内容收缩（max 500），高度由条目与指令栏决定（max 300）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Extension } from '@codemirror/state';
import type { Editor } from './editor.js';
import { EditorView } from '@codemirror/view';
import {
  buildLinkContext, collectLinkSuggestions, buildLinkInsertion, emptyItem, noMatchLabel, type LinkContext, type LinkSuggestion, type LinkMode,
} from './completions.js';
import { setIcon } from '../core/icons.js';
import { renderHighlightedText } from '../core/suggest.js';
import { t } from '../core/i18n.js';

const GAP = 5;
const EDGE = 10;

export class LinkSuggest {
  declare editor: Editor;
  declare app: App;
  declare view: EditorView;
  declare isOpen: boolean;
  declare context: LinkContext | null;
  declare mode: string;
  declare items: LinkSuggestion[];
  declare selectedIndex: number;
  declare containerEl: HTMLDivElement;
  declare suggestionEl: HTMLDivElement;
  declare instructionsEl: HTMLDivElement;
  declare onKeyDownBound: (event: KeyboardEvent) => void;
  declare onScrollBound: () => void;
  declare onResizeBound: () => void;
  declare onBlurBound: () => void;
  declare onWindowBlurBound: () => void;
  declare onFocusOutBound: (event: FocusEvent) => void;
  declare onEditorMouseDownBound: () => void;
  declare onDocumentMouseDownBound: (event: MouseEvent) => void;
  declare updateExtension: Extension;

  constructor(editor: Editor) {
    this.editor = editor;
    this.app = editor.app;
    this.view = editor.cm;
    this.isOpen = false;
    this.context = null;
    this.mode = 'file';
    this.items = [];
    this.selectedIndex = -1;

    this.containerEl = createDiv('suggestion-container link-suggest');
    this.suggestionEl = this.containerEl.createDiv('suggestion');
    this.instructionsEl = this.containerEl.createDiv('prompt-instructions');
    this.containerEl.addEventListener('mousedown', (event) => event.preventDefault());
    this.suggestionEl.addEventListener('mousemove', (event) => this.onMouseMove(event));
    this.suggestionEl.addEventListener('click', (event) => this.onMouseClick(event));
    this.suggestionEl.addEventListener('auxclick', (event) => this.onMouseClick(event));

    this.onKeyDownBound = (event) => this.onKeyDown(event);
    this.onScrollBound = () => { if (this.isOpen) this.updatePosition(); };
    this.onResizeBound = () => { if (this.isOpen) this.updatePosition(); };
    this.onBlurBound = () => this.close();
    this.onWindowBlurBound = () => this.close();
    this.onFocusOutBound = (event) => {
      if (!this.containerEl.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) this.close();
    };
    this.onEditorMouseDownBound = () => this.close();
    this.onDocumentMouseDownBound = (event) => {
      if (!this.isOpen) return;
      if (this.containerEl.contains(event.target instanceof Node ? event.target : null)) return;
      if (this.view.contentDOM.contains(event.target instanceof Node ? event.target : null)) return;
      this.close();
    };

    this.updateExtension = EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
      this.onEditorUpdate();
    });
    this.editor.addExtensions(this.updateExtension);

    document.addEventListener('keydown', this.onKeyDownBound, true);
    document.addEventListener('mousedown', this.onDocumentMouseDownBound, true);
    this.view.scrollDOM.addEventListener('scroll', this.onScrollBound, { passive: true });
    window.addEventListener('resize', this.onResizeBound);
    window.addEventListener('blur', this.onWindowBlurBound);
    this.view.contentDOM.addEventListener('blur', this.onBlurBound);
    this.view.dom.addEventListener('focusout', this.onFocusOutBound);
    this.view.contentDOM.addEventListener('mousedown', this.onEditorMouseDownBound, true);
  }

  isFocused() {
    return this.view.hasFocus || document.activeElement === this.view.contentDOM;
  }

  onEditorUpdate() {
    if (!this.isFocused()) {
      this.close();
      return;
    }
    const context = buildLinkContext(this.view);
    if (!context) {
      this.close();
      return;
    }
    this.context = context;
    const result = collectLinkSuggestions(this.app, context, this.editor.sourcePath || '');
    this.mode = result.mode;
    this.items = result.items && result.items.length ? result.items : [emptyItem()];
    this.open();
    this.render();
    this.updatePosition();
  }

  open() {
    if (!this.containerEl.isConnected) document.body.appendChild(this.containerEl);
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.context = null;
    this.items = [];
    this.selectedIndex = -1;
    if (this.containerEl.isConnected) this.containerEl.remove();
  }

  /** 原版 showSuggestions：空查询或单独的 ^ / # 不预选任何行。 */
  initialSelection() {
    const query = this.context ? this.context.query : '';
    if (!query || query === '^' || query === '#') return -1;
    return 0;
  }

  render() {
    this.suggestionEl.empty();
    this.items.forEach((item) => {
      const itemEl = this.suggestionEl.createDiv('suggestion-item mod-complex');
      if (item.downranked) itemEl.addClass('mod-downranked');
      const contentEl = itemEl.createDiv('suggestion-content');
      const titleEl = contentEl.createDiv('suggestion-title');
      const noteEl = contentEl.createDiv('suggestion-note');
      const auxEl = itemEl.createDiv('suggestion-aux');
      this.renderItem(item, titleEl, noteEl, auxEl);
    });
    this.renderInstructions();
    this.selectedIndex = this.initialSelection();
    this.applySelection(this.selectedIndex >= 0);
  }

  renderItem(item: LinkSuggestion, titleEl: HTMLElement, noteEl: HTMLElement, auxEl: HTMLElement) {
    if (item.type === 'none') {
      titleEl.setText(noMatchLabel());
      return;
    }
    if (item.type === 'file') {
      renderHighlightedText(titleEl, item.title, item.matches);
      if (item.noteMatches) renderHighlightedText(noteEl, item.note || '', item.noteMatches);
      else noteEl.setText(item.note || '');
      return;
    }
    if (item.type === 'alias') {
      if (item.alias) renderHighlightedText(titleEl, item.alias, item.matches);
      else titleEl.createSpan({ cls: 'suggestion-empty-suggestion', text: t('editor.link-suggestion.label-no-alias') });
      noteEl.setText(item.note || '');
      const flair = auxEl.createSpan('suggestion-flair');
      setIcon(flair, 'lucide-forward');
      flair.setAttr('aria-label', t('interface.tooltip.alias'));
      return;
    }
    if (item.type === 'heading') {
      if (item.heading) renderHighlightedText(titleEl, item.heading, item.matches);
      else titleEl.createSpan({ cls: 'suggestion-empty-suggestion', text: t('editor.link-suggestion.label-no-heading') });
      noteEl.setText(item.note || '');
      if (item.level > 0) auxEl.createSpan({ cls: 'suggestion-flair', text: 'H' + item.level });
      return;
    }
    if (item.type === 'block') {
      renderHighlightedText(titleEl, item.display || item.blockId || '', item.matches);
      if (item.noteMatches) renderHighlightedText(noteEl, item.note || '', item.noteMatches);
      else noteEl.setText(item.note || '');
      return;
    }
    if (item.type === 'linktext') {
      renderHighlightedText(titleEl, item.path || '', item.matches);
    }
  }

  renderInstructions() {
    this.instructionsEl.empty();
    const instructions = this.mode === 'file'
      ? [
        { command: t('editor.link-suggestion.label-type-hash'), purpose: t('editor.link-suggestion.label-link-heading') },
        { command: t('editor.link-suggestion.label-type-block'), purpose: t('editor.link-suggestion.label-link-block') },
        { command: t('editor.link-suggestion.label-type-pipe'), purpose: t('editor.link-suggestion.label-change-display-text') },
      ]
      : [{ command: '↵', purpose: t('editor.link-suggestion.label-accept') }];
    for (const instruction of instructions) {
      this.instructionsEl.createDiv('prompt-instruction', (el: { createSpan: (arg0: { cls?: string; text: string; }) => void; }) => {
        el.createSpan({ cls: 'prompt-instruction-command', text: instruction.command });
        el.createSpan({ text: instruction.purpose });
      });
    }
  }

  itemElements() {
    return Array.from<HTMLElement>(this.suggestionEl.querySelectorAll('.suggestion-item'));
  }

  applySelection(scroll: boolean) {
    const elements = this.itemElements();
    elements.forEach((el, index) => el.toggleClass('is-selected', index === this.selectedIndex));
    if (scroll && this.selectedIndex >= 0) {
      const selected = elements[this.selectedIndex];
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }
  }

  setSelectedIndex(index: number) {
    const count = this.items.length;
    if (!count) return;
    if (index < 0) index = count - 1;
    else if (index >= count) index = 0;
    this.selectedIndex = index;
    this.applySelection(true);
  }

  pageSize() {
    const first = this.itemElements()[0];
    const rowHeight = first ? first.getBoundingClientRect().height : 0;
    if (!rowHeight) return 1;
    return Math.max(1, Math.floor(this.suggestionEl.clientHeight / rowHeight));
  }

  updatePosition() {
    if (!this.isOpen || !this.context) return;
    const length = this.view.state.doc.length;
    if (this.context.start > length || this.context.end > length) {
      this.close();
      return;
    }
    const start = this.view.coordsAtPos(this.context.start);
    const end = this.view.coordsAtPos(this.context.end);
    if (!start || !end) {
      this.close();
      return;
    }
    this.reposition({
      top: start.top,
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      bottom: end.bottom,
    });
  }

  /** 原版 Ov：gap=5、左右 10px 边距、下方不够翻上方、两侧都不够时限制高度。 */
  reposition(anchor: { top: number; left: number; right: number; bottom: number }) {
    const el = this.containerEl;
    const reference = el.offsetParent || document.documentElement;
    const scrollTop = reference.scrollTop || 0;
    const scrollLeft = reference.scrollLeft || 0;
    const topLimit = scrollTop + EDGE;
    const bottomLimit = scrollTop + reference.clientHeight - EDGE;
    const safeTop = Math.min(anchor.top, bottomLimit);
    const safeBottom = Math.max(anchor.bottom, topLimit);
    const height = el.offsetHeight;
    const width = el.offsetWidth;
    const above = anchor.top - topLimit;
    const below = bottomLimit - anchor.bottom;
    let top = null;
    let bottom = null;
    let maxHeight = '';

    if (below >= height + GAP) {
      top = safeBottom + GAP;
    } else if (above >= height + GAP) {
      bottom = scrollTop + reference.clientHeight - (safeTop - GAP);
    } else if (above > below) {
      bottom = scrollTop + reference.clientHeight - (safeTop - GAP);
      maxHeight = Math.max(0, above - GAP) + 'px';
    } else {
      top = safeBottom + GAP;
      maxHeight = Math.max(0, below - GAP) + 'px';
    }

    const minimumLeft = scrollLeft + EDGE;
    const maximumLeft = scrollLeft + reference.clientWidth - EDGE;
    let left = anchor.left;
    if (left < minimumLeft) left = minimumLeft;
    if (left + width > maximumLeft) left = maximumLeft - width;

    el.style.left = left + 'px';
    el.style.top = top === null ? '' : top + 'px';
    el.style.bottom = bottom === null ? '' : bottom + 'px';
    el.style.maxHeight = maxHeight;
  }

  onKeyDown(event: KeyboardEvent) {
    if (!this.isOpen || !this.isFocused()) return;
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (key === 'p' || key === 'n')) {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(this.selectedIndex + (key === 'n' ? 1 : -1));
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const shiftNavigation = event.shiftKey &&
      ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Tab'].includes(key);
    if (shiftNavigation) return;
    if (key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(this.selectedIndex + 1);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(this.selectedIndex - 1);
      return;
    }
    if (key === 'PageDown') {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(Math.min(this.items.length - 1, this.selectedIndex + this.pageSize()));
      return;
    }
    if (key === 'PageUp') {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(Math.max(0, this.selectedIndex - this.pageSize()));
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(0);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      this.setSelectedIndex(this.items.length - 1);
      return;
    }
    if (key === 'Enter') {
      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.accept(emptyItem(), event);
        return;
      }
      if (this.selectedIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        this.accept(this.items[this.selectedIndex], event);
      }
      return;
    }
    if (key === 'Tab') {
      if (this.selectedIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        this.accept(this.items[this.selectedIndex], event);
      }
      return;
    }
    if (key === '#' && (this.mode === 'file' || this.mode === 'heading') && this.selectedIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      this.accept(this.items[this.selectedIndex], event, '#');
      return;
    }
    if (key === '^' && this.mode === 'file' && this.selectedIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      this.accept(this.items[this.selectedIndex], event, '^');
    }
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isOpen) return;
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('.suggestion-item') : null;
    if (!item) return;
    const index = this.itemElements().indexOf(item);
    if (index < 0 || index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.applySelection(false);
  }

  onMouseClick(event: MouseEvent) {
    if (!this.isOpen || event.defaultPrevented) return;
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('.suggestion-item') : null;
    if (!item) return;
    event.preventDefault();
    const index = this.itemElements().indexOf(item);
    if (index < 0) return;
    const value = this.items[index];
    if (value) this.accept(value, event);
  }

  accept(item: LinkSuggestion, event: KeyboardEvent | MouseEvent, marker = '') {
    if (!this.context) return;
    const context = this.context;
    const insertion = buildLinkInsertion(item, context, { marker });
    this.close();
    this.view.dispatch({
      changes: { from: insertion.from, to: insertion.to, insert: insertion.insert },
      selection: { anchor: insertion.caret },
      userEvent: marker ? 'input.complete' : 'input.autocomplete',
    });
    this.view.focus();
  }

  destroy() {
    this.close();
    document.removeEventListener('keydown', this.onKeyDownBound, true);
    document.removeEventListener('mousedown', this.onDocumentMouseDownBound, true);
    this.view.scrollDOM.removeEventListener('scroll', this.onScrollBound);
    window.removeEventListener('resize', this.onResizeBound);
    window.removeEventListener('blur', this.onWindowBlurBound);
    this.view.contentDOM.removeEventListener('blur', this.onBlurBound);
    this.view.dom.removeEventListener('focusout', this.onFocusOutBound);
    this.view.contentDOM.removeEventListener('mousedown', this.onEditorMouseDownBound, true);
    this.editor.removeExtensions(this.updateExtension);
    this.containerEl.remove();
  }
}
