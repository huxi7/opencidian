/**
 * [INPUT]: 依赖 View/setIcon/isModalOpen；依赖 reading 的 renderMarkdown/stripFrontmatter/getMarkdownIt
 * [OUTPUT]: 导出 SlidesView、splitSlides；序列化文件、页码与返回编辑状态
 * [POS]: views/ 的演示视图。只按顶层 hr 分页，保留代码围栏与引用内部的分隔线。每页复用阅读渲染；焦点在演示内时键盘翻页。Esc 恢复原模式、滚动与选区，关闭后取消在途渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Slides view — paginated presentation of a markdown file. */
import { View } from '../core/view.js';
import { setIcon } from '../core/icons.js';
import { isModalOpen } from '../core/modals.js';
import { renderMarkdown, stripFrontmatter, getMarkdownIt } from '../markdown/reading.js';

/**
 * 把 markdown 正文按主题分隔线（---）切成页。
 * 用 markdown-it 的 hr 令牌取行号，避免误切 setext 标题与代码块内的 ---。
 */
export function splitSlides(text) {
  if (!text) return [];
  let breaks = [];
  try {
    const tokens = getMarkdownIt().parse(text, {});
    breaks = tokens.filter((tk) => tk.type === 'hr' && tk.level === 0 && tk.map)
      .map((tk) => tk.map[0]).sort((a, b) => a - b);
  } catch (e) { breaks = []; }
  const lines = text.split('\n');
  const pages = [];
  let start = 0;
  for (const lineNo of breaks) {
    if (lineNo < start || lineNo >= lines.length) continue;
    pages.push(lines.slice(start, lineNo).join('\n'));
    start = lineNo + 1;
  }
  pages.push(lines.slice(start).join('\n'));
  // 空页跳过（连续分隔线/首尾空内容），对齐原版跳过空 section 的行为
  return pages.filter((page) => page.trim().length > 0);
}

export class SlidesView extends View {
  constructor(leaf) {
    super(leaf);
    this.file = null;
    this.pages = [];
    this.current = 0;
    this.icon = 'lucide-monitor';
    this.slidesEl = null;
    this.deckEl = null;
    this.progressEl = null;
    this._onKeyDown = null;
    this.returnState = null;
    this.returnEphemeral = null;
    this.selection = null;
    this._renderVersion = 0;
    this._exiting = null;
  }

  getViewType() { return 'slides'; }
  getIcon() { return 'lucide-monitor'; }
  getDisplayText() { return this.file ? this.file.basename : 'Slides'; }
  getState() {
    return { file: this.file ? this.file.path : undefined, slide: this.current,
      returnState: this.returnState, returnEphemeral: this.returnEphemeral, selection: this.selection };
  }

  async setState(state) {
    state = state || {};
    this.returnState = state.returnState || null;
    this.returnEphemeral = state.returnEphemeral || null;
    this.selection = state.selection || null;
    if (state.file && (!this.file || this.file.path !== state.file)) {
      const file = this.app.vault.getFileByPath(state.file);
      if (file) { this.file = file; await this._render(); }
    }
    this.show(Number.isInteger(state.slide) ? state.slide : 0);
  }

  async onOpen() {
    this.contentEl.addClass('slides-view');
    this.slidesEl = this.contentEl.createDiv('slides-container');
    this.slidesEl.setAttr('tabindex', '-1');
    this.slidesEl.setAttr('aria-label', 'Slides');
    this.deckEl = this.slidesEl.createDiv('slides-deck');
    this.progressEl = this.slidesEl.createDiv('slides-progress');
    this.progressEl.setAttr('aria-live', 'polite');
    const closeBtn = this.slidesEl.createEl('button', { cls: 'slides-close-btn clickable-icon', type: 'button' });
    setIcon(closeBtn, 'lucide-x');
    closeBtn.setAttr('aria-label', 'Close');
    closeBtn.onclick = () => this.exit().catch((error) => console.error('slides: exit failed', error));
    this.deckEl.addEventListener('click', (ev) => this._onDeckClick(ev));
    this._onKeyDown = (ev) => {
      if (this.leaf !== this.app.workspace.activeLeaf) return;
      // 有弹窗时让弹窗处理按键（Esc 先关弹窗）
      if (isModalOpen() || ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const target = ev.target;
      const focus = document.activeElement;
      if (focus && focus !== document.body && !this.contentEl.contains(focus)) return;
      if (target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const handled = ['Escape', 'ArrowRight', 'ArrowDown', ' ', 'PageDown', 'ArrowLeft', 'ArrowUp', 'PageUp', 'Home', 'End'];
      if (!handled.includes(ev.key)) return;
      if (ev.key === ' ' && target.closest && target.closest('button, a')) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') { this.exit().catch((error) => console.error('slides: exit failed', error)); return; }
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === ' ' || ev.key === 'PageDown') {
        this.next(); return;
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'PageUp') {
        this.prev(); return;
      }
      if (ev.key === 'Home') { this.show(0); return; }
      if (ev.key === 'End') this.show(this.pages.length - 1);
    };
    document.addEventListener('keydown', this._onKeyDown, true);
  }

  async onClose() {
    this._renderVersion += 1;
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown, true);
    this._onKeyDown = null;
  }

  onFocus() { if (this.slidesEl) this.slidesEl.focus({ preventScroll: true }); }
  onLayoutReady() { if (this.leaf === this.app.workspace.activeLeaf) this.onFocus(); }

  /* ------------------------------------------------------------ 渲染 */
  async _render() {
    const version = ++this._renderVersion;
    this.deckEl.empty();
    this.pages = [];
    this.current = 0;
    let text = '';
    try { text = await this.app.vault.cachedRead(this.file); } catch (e) { text = ''; }
    if (version !== this._renderVersion) return;
    const body = stripFrontmatter(text);
    const pageTexts = splitSlides(body);
    if (!pageTexts.length) pageTexts.push('');
    for (const pageText of pageTexts) {
      const section = this.deckEl.createEl('section', { cls: 'slides-section markdown-rendered' });
      this.pages.push(section);
      try {
        await renderMarkdown(this.app, pageText, section, this.file.path);
      } catch (e) {
        section.setText(pageText);
      }
      if (version !== this._renderVersion) return;
    }
    this.show(0);
    requestAnimationFrame(() => {
      if (version === this._renderVersion && this.leaf === this.app.workspace.activeLeaf) this.onFocus();
    });
  }

  /* ------------------------------------------------------------ 翻页 */
  show(index) {
    const count = this.pages.length;
    if (!count) return;
    const previous = this.current;
    this.current = Math.max(0, Math.min(index, count - 1));
    this.pages.forEach((page, i) => {
      page.toggleClass('is-active', i === this.current);
      page.hidden = i !== this.current;
      page.setAttr('aria-hidden', String(i !== this.current));
    });
    if (this.progressEl) this.progressEl.setText((this.current + 1) + ' / ' + count);
    const active = this.pages[this.current];
    if (active) active.scrollTop = 0;
    if (previous !== this.current) this.app.workspace.trigger('layout-change');
  }

  next() { this.show(this.current + 1); }
  prev() { this.show(this.current - 1); }

  _onDeckClick(ev) {
    // 链接与控件照常工作，不触发翻页
    if (ev.target.closest && ev.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;
    const rect = this.deckEl.getBoundingClientRect();
    if (ev.clientX - rect.left < rect.width / 2) this.prev();
    else this.next();
  }

  /** 退出演示：回到该文件的 markdown 视图（文件已删除时回到空视图）。 */
  exit() {
    if (!this._exiting) this._exiting = this._exit();
    return this._exiting;
  }

  async _exit() {
    if (this.leaf.view !== this) return;
    const file = this.file;
    if (file && this.app.vault.getFileByPath(file.path)) {
      await this.leaf.setViewState({ type: 'markdown', state: { ...this.returnState, file: file.path } }, this.returnEphemeral);
      const view = this.leaf.view;
      if (view.editor && this.selection) view.editor.setSelection(this.selection.anchor, this.selection.head);
      if (view.editor && this.returnState && this.returnState.scroll !== undefined) {
        view.editor.applyScrollInfo({ top: this.returnState.scroll });
      }
      this.app.workspace.trigger('file-open', file);
      this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    } else {
      await this.leaf.setViewState({ type: 'empty', state: {} });
    }
  }
}
