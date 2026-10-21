/**
 * [INPUT]: 依赖 CM6 的 WidgetType/Facet；依赖 ../markdown/reading.js 的 renderMarkdown/stripFrontmatter/attachMarkdownInteractions；
 *          依赖 ../markdown/math.js 的 renderMath；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/icons.js 的 setIcon；
 *          依赖 ../core/i18n.js 的 tt；画布嵌入委托 ../views/canvas-minimap.js 的 createCanvasEmbedWidget/missingCanvasNote。
 * [OUTPUT]: 导出 appFacet 与 CheckboxWidget/BulletWidget/ImageWidget/imageWidget/MathWidget/HrWidget/LangWidget/LinkWidget。
 * [POS]: editor/ 实时预览的**行内** widget 层（从 live-preview.js 拆出以守住 800 行上限）。
 *        复选框、列表记号、图片（尺寸语法已在上游解析）、行内数学、水平线、代码块语言角标与链接/嵌入；
 *        ![[白板.canvas]] 在实时预览里按原版 cte 渲染成画布嵌入（容器 + 标题 + 缩略图）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Inline widgets for the live preview layer. */
import { WidgetType } from '@codemirror/view';
import { Facet } from '@codemirror/state';
import { Desktop } from '../core/ipc.js';
import { attachMarkdownInteractions, renderMarkdown, stripFrontmatter } from '../markdown/reading.js';
import { renderMath } from '../markdown/math.js';
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { createCanvasEmbedWidget, missingCanvasNote } from '../views/canvas-minimap.js';

export const appFacet = Facet.define({ combine: (values) => values[0] });

// ---------------------------------------------------------------------------
// Inline widgets
// ---------------------------------------------------------------------------
export class CheckboxWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(other) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view) {
    const input = createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox' });
    input.checked = this.checked;
    input.onmousedown = (e) => {
      e.preventDefault();
      const insert = this.checked ? '[ ]' : '[x]';
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert } });
    };
    return input;
  }
  ignoreEvent() { return false; }
}

export class BulletWidget extends WidgetType {
  constructor(ordered, number, silent) { super(); this.ordered = ordered; this.number = number; this.silent = !!silent; }
  eq(other) {
    return other.ordered === this.ordered && other.number === this.number && other.silent === this.silent;
  }
  toDOM() {
    // 原版 app.css 12114/12164：无序记号是 .cm-formatting-list-ul 内嵌 .list-bullet，圆点由
    // :after 画出；记号 span 自带 --list-padding-inline-start 缩进。silent 用于任务行：
    // 保留记号 span（缩进位）但不画圆点，复选框紧随其后。
    const span = createSpan({ cls: this.ordered ? 'cm-formatting-list cm-formatting-list-ol' : 'cm-formatting-list cm-formatting-list-ul' });
    if (this.silent) return span;
    if (this.ordered) span.setText(`${this.number}.`);
    else span.createSpan('list-bullet');
    return span;
  }
}

/** 图片部件：尺寸语法写进 img 的 width/height，无高度参数时高度按原始比例。 */
export class ImageWidget extends WidgetType {
  constructor(src, alt, width, height) {
    super();
    this.src = src; this.alt = alt; this.width = width || 0; this.height = height || 0;
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt
      && other.width === this.width && other.height === this.height;
  }
  toDOM() {
    const wrap = createDiv({ cls: 'image-embed' });
    const img = wrap.createDiv({ cls: 'image-wrapper' }).createEl('img', { cls: 'cm-inline-image' });
    img.src = this.src;
    img.alt = this.alt || '';
    if (this.width > 0) img.width = this.width;
    if (this.height > 0) img.height = this.height;
    return wrap;
  }
  ignoreEvent() { return false; }
}

export function imageWidget(src, alt, size) {
  return new ImageWidget(src, alt, size ? size.x : 0, size ? size.y : 0);
}

export class MathWidget extends WidgetType {
  constructor(tex, display) { super(); this.tex = tex; this.display = display; }
  eq(other) { return other.tex === this.tex && other.display === this.display; }
  toDOM(view) {
    const el = createSpan({ cls: this.display ? 'math math-block' : 'math math-inline' });
    renderMath(el, this.tex, this.display).then(() => {
      if (view.dom.isConnected) view.requestMeasure();
    });
    return el;
  }
}

export class HrWidget extends WidgetType {
  toDOM() { return createEl('hr', { cls: 'cm-hr' }); }
}

export class LangWidget extends WidgetType {
  constructor(lang) { super(); this.lang = lang; }
  eq(o) { return o.lang === this.lang; }
  toDOM() {
    // 原版 code-block-flair：语言名（无语言时给复制图标）
    const el = createSpan({ cls: 'code-block-flair' });
    if (this.lang) el.setText(this.lang);
    else setIcon(el, 'lucide-copy');
    return el;
  }
}

export class LinkWidget extends WidgetType {
  constructor(text, target, embed, sourcePath, external) {
    super();
    this.text = text; this.target = target; this.embed = embed;
    this.sourcePath = sourcePath || ''; this.external = !!external;
  }
  eq(other) {
    return other.text === this.text && other.target === this.target &&
      other.embed === this.embed && other.sourcePath === this.sourcePath && other.external === this.external;
  }
  toDOM(view) {
    const app = view.state.facet(appFacet);
    // 原版：![[笔记]] 在实时预览中渲染为 markdown-embed（只读预览 + 打开源文件按钮）
    if (this.embed && app) {
      const dest = app.metadataCache.getFirstLinkpathDest(this.target, this.sourcePath);
      const file = dest ? app.vault.getFileByPath(dest) : null;
      if (file && file.extension === 'canvas') {
        // 原版 cte：实时预览里的 ![[白板.canvas]] 是画布嵌入（div 容器 + 标题 + 缩略图）
        const opts = { tag: 'div', linktext: this.target, href: file.path, sourcePath: this.sourcePath, tabindex: true };
        return createCanvasEmbedWidget(app, file, opts, () => { if (view.dom.isConnected) view.requestMeasure(); });
      }
      if (!file && /\.canvas$/i.test(this.target)) {
        // 原版 h2：目标不存在时落通用附件嵌块（.file-embed.mod-empty）
        const wrap = createDiv({ cls: 'internal-embed is-loaded file-embed mod-empty', text: missingCanvasNote(this.target) });
        wrap.setAttr('data-href', this.target);
        return wrap;
      }
      if (file && file.extension === 'md') {
        const wrap = createDiv({ cls: 'markdown-embed inline-embed' });
        wrap.createDiv({ cls: 'markdown-embed-title', text: file.basename });
        const content = wrap.createDiv({ cls: 'markdown-embed-content' });
        const body = content.createDiv({ cls: 'markdown-preview-view markdown-rendered' });
        body.setText('');
        app.vault.read(file).then((text) => renderMarkdown(app, stripFrontmatter(text), body, file.path, { depth: 1 }))
          .then(() => { if (view.dom.isConnected) view.requestMeasure(); })
          .catch(() => {});
        attachMarkdownInteractions(app, wrap, () => file.path);
        const linkBtn = wrap.createDiv({ cls: 'markdown-embed-link clickable-icon' });
        setIcon(linkBtn, 'lucide-maximize-2');
        linkBtn.setAttr('aria-label', tt('editor.link-popover.tooltip-open-link', '打开链接'));
        linkBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          app.workspace.openLinkText(this.target, this.sourcePath, e.metaKey || e.ctrlKey);
        };
        return wrap;
      }
    }
    const span = createSpan({ cls: this.embed ? 'cm-wikilink cm-wikilink-embed' : this.external ? 'cm-url cm-external-link' : 'cm-wikilink' });
    span.setText(this.text);
    span.setAttr('data-href', this.target);
    span.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!app) return;
      if (this.external) {
        Desktop.openExternal(this.target);
        return;
      }
      const newLeaf = (e.metaKey || e.ctrlKey) ? 'tab' : this.embed ? 'tab' : false;
      app.workspace.openLinkText(this.target, this.sourcePath, newLeaf);
    };
    return span;
  }
  ignoreEvent() { return false; }
}

