/**
 * [INPUT]: 依赖 ../core/icons.js 的 setIcon；依赖 ../core/modals.js 的 isModalOpen；依赖 ../markdown/reading.js 的 renderMarkdown/stripFrontmatter/getMarkdownIt。
 * [OUTPUT]: 导出 SlidesPresentation 与 splitSlides。openFile(file) 在 document.body 建 .slides-container 并渲染分页；destroy() 摘除容器并释放监听（幂等）。
 * [POS]: views/ 的全窗口演示宿主（对齐原版 M9：body 级 .slides-container + Escape 关闭；本复刻无 reveal.js，分页与翻页为自有实现）。
 *        演示期间不动底层 markdown 视图，退出后模式、滚动与选区天然保持。同一时间只允许一个宿主，生命周期由 plugins-core/slides.js 管理。
 *        键盘在 document 捕获：有弹窗或焦点在输入控件时不响应；Esc 关闭，方向键/空格/PageUp/Down/Home/End 翻页。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Full-window slides presentation host — mirrors the original M9 overlay. */
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

export class SlidesPresentation {
  constructor(app, onDestroy) {
    this.app = app;
    this.onDestroy = onDestroy || null;
    this.file = null;
    this.containerEl = null;
    this.slidesEl = null;
    this.deckEl = null;
    this.progressEl = null;
    this.pages = [];
    this.current = 0;
    this._onKeyDown = null;
    this._renderVersion = 0;
    this._destroyed = true;
  }

  /** 读取文件并建立覆盖层；构造后调用一次。重复调用先销毁旧容器。 */
  async openFile(file) {
    this.destroy();
    this._destroyed = false;
    this.file = file;
    let text = '';
    try { text = await this.app.vault.read(file); } catch (e) { text = ''; }
    if (this._destroyed) return;
    this._buildDom();
    await this._render(text);
  }

  _buildDom() {
    const containerEl = this.containerEl = document.body.createDiv('slides-container');
    containerEl.setAttr('tabindex', '-1');
    containerEl.setAttr('aria-label', 'Slides');
    this.slidesEl = containerEl;
    this.deckEl = containerEl.createDiv('slides-deck');
    this.progressEl = containerEl.createDiv('slides-progress');
    this.progressEl.setAttr('aria-live', 'polite');
    const closeBtn = containerEl.createDiv('slides-close-btn');
    setIcon(closeBtn, 'lucide-x-square');
    closeBtn.setAttr('aria-label', 'Close');
    this.deckEl.addEventListener('click', (ev) => this._onDeckClick(ev));
    this._onKeyDown = (ev) => this._handleKey(ev);
    document.addEventListener('keydown', this._onKeyDown, true);
    containerEl.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ 键盘/点击 */

  _handleKey(ev) {
    if (this._destroyed || ev.defaultPrevented) return;
    // 有弹窗时让弹窗处理按键（Esc 先关弹窗）
    if (isModalOpen() || ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.destroy();
      return;
    }
    const handled = ['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'ArrowLeft', 'ArrowUp', 'PageUp', 'Home', 'End'];
    if (!handled.includes(ev.key)) return;
    const target = ev.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"], button, a')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === ' ' || ev.key === 'PageDown') { this.next(); return; }
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'PageUp') { this.prev(); return; }
    if (ev.key === 'Home') { this.show(0); return; }
    this.show(this.pages.length - 1);
  }

  _onDeckClick(ev) {
    // 链接与控件照常工作，不触发翻页
    if (ev.target.closest && ev.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;
    const rect = this.deckEl.getBoundingClientRect();
    if (ev.clientX - rect.left < rect.width / 2) this.prev();
    else this.next();
  }

  /* ------------------------------------------------------------ 渲染 */

  async _render(text) {
    const version = ++this._renderVersion;
    this.deckEl.empty();
    this.pages = [];
    this.current = 0;
    const body = stripFrontmatter(text || '');
    const pageTexts = splitSlides(body);
    if (!pageTexts.length) pageTexts.push('');
    for (const pageText of pageTexts) {
      const section = this.deckEl.createEl('section', { cls: 'slides-section markdown-rendered' });
      this.pages.push(section);
      try {
        await renderMarkdown(this.app, pageText, section, this.file ? this.file.path : '');
      } catch (e) {
        section.setText(pageText);
      }
      if (version !== this._renderVersion) return;
    }
    this.show(0);
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

  /* ------------------------------------------------------------ 生命周期 */

  /** 退出演示：摘除覆盖层并释放监听；底层视图不受影响。幂等。 */
  destroy() {
    if (this._destroyed && !this.containerEl) return;
    this._destroyed = true;
    this._renderVersion += 1;
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown, true);
    this._onKeyDown = null;
    if (this.containerEl) { this.containerEl.detach(); this.containerEl = null; }
    this.slidesEl = null;
    this.deckEl = null;
    this.progressEl = null;
    this.pages = [];
    this.file = null;
    if (this.onDestroy) this.onDestroy(this);
  }
}
