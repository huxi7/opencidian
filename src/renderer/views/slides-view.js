/**
 * [INPUT]: 依赖 ../core/view.js 的 View 基类；依赖 ../core/icons.js 的 setIcon；依赖 ../markdown/reading.js 的 renderMarkdown/stripFrontmatter/getMarkdownIt
 * [OUTPUT]: 导出 SlidesView 类（视图类型 'slides'）、splitSlides(text)（按 thematicBreak 分页的纯函数）
 * [POS]: views/ 的幻灯片视图，由 plugins-core/slides.js 注册。DOM 沿用原版类名 .slides-container/.slides-close-btn，外加 .slides-deck/.slides-section/.slides-progress。原版是 reveal.js 全屏覆盖层；本实现是工作区视图（布局可序列化、可随标签页切换），故 .slides-container 填满 leaf 而非视口。按 --- 分页（frontmatter 之后，用 markdown-it 的 hr 令牌定位，代码块内的 --- 不分页），每页用阅读渲染器渲染。Esc/关闭按钮退出回 markdown，←/→ 与点击左右半屏翻页。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Slides view — paginated presentation of a markdown file. */
import { View } from '../core/view.js';
import { setIcon } from '../core/icons.js';
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
    breaks = tokens.filter((tk) => tk.type === 'hr' && tk.map).map((tk) => tk.map[0]).sort((a, b) => a - b);
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
  }

  getViewType() { return 'slides'; }
  getIcon() { return 'lucide-monitor'; }
  getDisplayText() { return this.file ? this.file.basename : 'Slides'; }
  getState() { return { file: this.file ? this.file.path : undefined }; }

  async setState(state) {
    state = state || {};
    if (state.file && (!this.file || this.file.path !== state.file)) {
      const file = this.app.vault.getFileByPath(state.file);
      if (file) { this.file = file; await this._render(); }
    }
  }

  async onOpen() {
    this.contentEl.addClass('slides-view');
    this.slidesEl = this.contentEl.createDiv('slides-container');
    this.deckEl = this.slidesEl.createDiv('slides-deck');
    this.progressEl = this.slidesEl.createDiv('slides-progress');
    const closeBtn = this.slidesEl.createDiv('slides-close-btn');
    setIcon(closeBtn, 'lucide-x');
    closeBtn.setAttr('aria-label', 'Close');
    closeBtn.onclick = () => this.exit();
    this.deckEl.addEventListener('click', (ev) => this._onDeckClick(ev));
    this._onKeyDown = (ev) => {
      if (this.leaf !== this.app.workspace.activeLeaf) return;
      // 有弹窗时让弹窗处理按键（Esc 先关弹窗）
      if (document.querySelector('.modal-container.is-open')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); this.exit(); return; }
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === ' ' || ev.key === 'PageDown') {
        ev.preventDefault(); this.next(); return;
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'PageUp') {
        ev.preventDefault(); this.prev(); return;
      }
      if (ev.key === 'Home') { ev.preventDefault(); this.show(0); return; }
      if (ev.key === 'End') { ev.preventDefault(); this.show(this.pages.length - 1); }
    };
    document.addEventListener('keydown', this._onKeyDown, true);
  }

  async onClose() {
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown, true);
    this._onKeyDown = null;
  }

  /* ------------------------------------------------------------ 渲染 */
  async _render() {
    this.deckEl.empty();
    this.pages = [];
    this.current = 0;
    let text = '';
    try { text = await this.app.vault.cachedRead(this.file); } catch (e) { text = ''; }
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
    }
    this.show(0);
  }

  /* ------------------------------------------------------------ 翻页 */
  show(index) {
    const count = this.pages.length;
    if (!count) return;
    this.current = Math.max(0, Math.min(index, count - 1));
    this.pages.forEach((page, i) => page.toggleClass('is-active', i === this.current));
    if (this.progressEl) this.progressEl.setText((this.current + 1) + ' / ' + count);
    const active = this.pages[this.current];
    if (active) active.scrollTop = 0;
  }

  next() { this.show(this.current + 1); }
  prev() { this.show(this.current - 1); }

  _onDeckClick(ev) {
    // 链接与控件照常工作，不触发翻页
    if (ev.target.closest && ev.target.closest('a, button, input, textarea, select')) return;
    const rect = this.deckEl.getBoundingClientRect();
    if (ev.clientX - rect.left < rect.width / 2) this.prev();
    else this.next();
  }

  /** 退出演示：回到该文件的 markdown 视图（文件已删除时回到空视图）。 */
  async exit() {
    const file = this.file;
    if (file && this.app.vault.getFileByPath(file.path)) {
      await this.leaf.setViewState({ type: 'markdown', state: { file: file.path } });
    } else {
      await this.leaf.setViewState({ type: 'empty', state: {} });
    }
  }
}
