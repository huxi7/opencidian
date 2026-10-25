/**
 * [INPUT]: 依赖 CM6 装饰与折叠状态；依赖 reading.js、highlight.js、math.js、properties.js 的块渲染及 metadata.js 的属性解析；图片尺寸语法来自 markdown/source-text.js；表格块委托 editor/table-widget.js 的 TableWidget；画布嵌入委托 views/canvas-minimap.js 的 createCanvasEmbedWidget。
 * [OUTPUT]: 导出 livePreviewExtension(app, getSourcePath)，返回 [appFacet, sourcePathFacet, fmSourceField, blockLayerField, ViewPlugin]
 * [POS]: editor/ 的实时预览装饰层，由 editor.js 经 _livePreviewCompartment 装载/卸载。行内装饰走 ViewPlugin；块级 widget（属性面板/表格/callout/块级数学/代码块/mermaid）必须走 StateField，因为 CM6 禁止 ViewPlugin 提供 block 装饰。表格的渲染与行列编辑在 table-widget.js。内嵌图片的 `|300` / `|300x200` 尺寸语法走 markdown/source-text.js 的解析，落成 .image-wrapper > img 的 width/height 属性。![[白板.canvas]] 在实时预览里渲染成画布嵌入（div 容器 + 标题 + 缩略图，原版 cte）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Live preview for the markdown editor — a CodeMirror 6 layer that:
 *  - hides markdown syntax the cursor is not inside
 *  - renders checkboxes, bullets, images, math, hr and links as widgets
 *  - renders block widgets (frontmatter properties, tables, callouts, math,
 *    fenced code blocks, mermaid) from a StateField: CM6 only allows block
 *    decorations via state fields
 *  - styles headings, quotes, code blocks and lists like the original app
 */
import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';
import { RangeSet, Facet, StateField, StateEffect } from '@codemirror/state';
import { foldedRanges } from '@codemirror/language';
import { getMarkdownIt, attachMarkdownInteractions, renderMermaidBlocks } from '../markdown/reading.js';
import { splitImageSize, splitEmbedSize } from '../markdown/source-text.js';
import { buildMetadataContainer } from '../markdown/properties.js';
import { parseFrontmatterText } from '../core/metadata.js';
import { codeLanguageName, highlightCodeElement, cancelCodeHighlight } from '../markdown/highlight.js';
import { renderMath } from '../markdown/math.js';
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { TableWidget } from './table-widget.js';
import {
  appFacet, CheckboxWidget, BulletWidget, imageWidget, MathWidget, HrWidget, LangWidget, LinkWidget,
} from './live-preview-inline-widgets.js';

const sourcePathFacet = Facet.define({ combine: (values) => values[0] });

// ---------------------------------------------------------------------------
// Block widgets
// ---------------------------------------------------------------------------

/** 原版 addEditButton：块 widget 右上角"编辑这个区块"，点击把光标放回源码（widget 让位）。 */
function addEditBlockButton(el, view, from, to) {
  if (typeof from !== 'number') return null;
  const btn = el.createDiv('edit-block-button');
  setIcon(btn, 'lucide-code-2');
  btn.setAttr('aria-label', tt('editor.menu.label-edit-block', 'Edit this block'));
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  });
  return btn;
}

class MathBlockWidget extends WidgetType {
  declare tex: any;
  declare from: any;
  declare to: any;

  constructor(tex, from, to) { super(); this.tex = tex; this.from = from; this.to = to; }
  eq(o) { return o.tex === this.tex && o.from === this.from && o.to === this.to; }
  toDOM(view) {
    const el = createDiv({ cls: 'math math-block' });
    // renderMath 异步写入内容：按钮在渲染完成后再挂，避免被覆盖
    renderMath(el, this.tex, true).then(() => {
      if (!el.querySelector('.edit-block-button')) addEditBlockButton(el, view, this.from, this.to);
      if (view.dom.isConnected) view.requestMeasure();
    });
    return el;
  }
}

/** 实时预览代码块 widget：光标不在块内时以 <pre><code> 呈现（对齐阅读视图样式）。 */
class CodeBlockWidget extends WidgetType {
  declare lang: any;
  declare code: any;
  declare from: any;
  declare to: any;

  constructor(lang, code, from, to) { super(); this.lang = lang; this.code = code; this.from = from; this.to = to; }
  eq(other) { return other.lang === this.lang && other.code === this.code && other.from === this.from && other.to === this.to; }
  toDOM(view) {
    const pre = createEl('pre', { cls: 'lp-codeblock' });
    const code = pre.createEl('code', { cls: 'language-' + (this.lang || 'plain') });
    if (this.lang) code.setAttr('data-lang', this.lang);
    code.setText(this.code);
    highlightCodeElement(code, this.lang).then(() => {
      if (view.dom.isConnected) view.requestMeasure();
    });
    // 原版 code-block-flair：显示语言名（无语言显示复制图标），点击复制代码
    const flair = pre.createSpan({ cls: 'code-block-flair' });
    if (this.lang) flair.setText(this.lang);
    else setIcon(flair, 'lucide-copy');
    flair.setAttr('aria-label', tt('interface.menu.copy', '复制'));
    flair.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { const p = navigator.clipboard.writeText(this.code); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    };
    addEditBlockButton(pre, view, this.from, this.to);
    return pre;
  }
  destroy(dom) { cancelCodeHighlight(dom.querySelector('code')); }
  ignoreEvent() { return false; }
}

/** 实时预览 mermaid widget：惰性渲染为 SVG（复用阅读视图的 renderMermaidBlocks）。 */
class MermaidWidget extends WidgetType {
  declare code: any;
  declare from: any;
  declare to: any;

  constructor(code, from, to) { super(); this.code = code; this.from = from; this.to = to; }
  eq(other) { return other.code === this.code && other.from === this.from && other.to === this.to; }
  toDOM(view) {
    const wrap = createDiv({ cls: 'cm-lp-mermaid' });
    const el = wrap.createDiv({ cls: 'mermaid-source' });
    el.setAttr('data-source', this.code);
    // renderMermaidBlocks 异步重建内容：按钮在渲染完成后再挂
    renderMermaidBlocks(wrap).catch(() => {}).then(() => {
      if (!wrap.querySelector('.edit-block-button')) addEditBlockButton(wrap, view, this.from, this.to);
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

class CalloutWidget extends WidgetType {
  declare text: any;
  declare sourcePath: any;

  constructor(text, sourcePath) { super(); this.text = text; this.sourcePath = sourcePath || ''; }
  eq(o) { return o.text === this.text; }
  toDOM(view) {
    const app = view.state.facet(appFacet);
    const wrap = createDiv({ cls: 'cm-callout' });
    try {
      wrap.innerHTML = getMarkdownIt().render(this.text, { app, sourcePath: this.sourcePath, depth: 0 });
    } catch (e) { console.error('callout widget render failed', e); wrap.setText(this.text); }
    if (app) attachMarkdownInteractions(app, wrap, () => this.sourcePath);
    return wrap;
  }
  ignoreEvent(e) {
    // let the fold chevron toggle; everything else goes to the editor (cursor in)
    return !(e.target && e.target.closest && e.target.closest('.callout-fold'));
  }
}

class PropertiesWidget extends WidgetType {
  declare app: App;
  declare file: any;
  declare fmText: any;
  declare from: any;

  constructor(app: App, file, fmText, from) {
    super();
    this.app = app; this.file = file; this.fmText = fmText; this.from = from;
  }
  eq(o) { return o.file === this.file && o.fmText === this.fmText; }
  toDOM(view) {
    const parsed = parseFrontmatterText(this.fmText);
    const el = buildMetadataContainer(this.app, this.file, {
      editable: true,
      showAddButton: true,
      frontmatter: parsed.frontmatter,
      fmError: parsed.error,
      onShowSource: () => {
        view.dispatch({ effects: fmSourceEffect.of(true), selection: { anchor: this.from }, scrollIntoView: true });
        view.focus();
      },
    });
    if (!el) return createDiv('metadata-container');
    return el;
  }
  ignoreEvent() { return false; }
}

// frontmatter raw-source flag: set by the properties widget "show source"
// button, cleared automatically when the cursor leaves the frontmatter
const fmSourceEffect = StateEffect.define<boolean>();

const fmSourceField = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(fmSourceEffect)) value = !!e.value;
    if (value) {
      const fm = classifyBlocks(tr.state.doc).frontmatter;
      const sel = tr.state.selection.ranges;
      const inside = fm && sel.some((r) => r.from <= fm.to && r.to >= fm.from);
      if (!inside) value = false;
    }
    return value;
  },
});

// ---------------------------------------------------------------------------
// Block classification (whole-document scan, cached per Text instance)
// ---------------------------------------------------------------------------
const RE_FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const RE_FENCE_INFO = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const RE_MATH_ONLY = /^\s{0,3}\$\$\s*$/;
const RE_MATH_SINGLE = /^\s{0,3}\$\$(.+?)\$\$\s*$/;
const RE_TABLE_ROW = /^\s{0,3}\|/;
const RE_TABLE_DELIM = /^\s{0,3}\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const RE_CALLOUT = /^\s{0,3}>\s?\[!([\w-]+)\]([+-])?\s*(.*)$/;
const RE_QUOTE_LINE = /^\s{0,3}>/;

const blocksCache = new WeakMap();

function closesFence(text, fence) {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(text);
  return match && match[1][0] === fence.marker && match[1].length >= fence.len;
}

function classifyBlocks(doc) {
  const hit = blocksCache.get(doc);
  if (hit) return hit;
  const out = { frontmatter: null, blocks: [] };
  const total = doc.lines;

  if (total > 0 && doc.line(1).text.trim() === '---') {
    for (let n = 2; n <= Math.min(total, 201); n++) {
      const tr = doc.line(n).text.trim();
      if (tr === '---' || tr === '...') {
        out.frontmatter = { startLine: 1, endLine: n, from: 0, to: doc.line(n).to };
        break;
      }
    }
  }
  const inFm = (n) => out.frontmatter && n >= out.frontmatter.startLine && n <= out.frontmatter.endLine;

  let fence = null; // { marker, len, startLine, lang }
  for (let n = 1; n <= total; n++) {
    if (inFm(n)) continue;
    const line = doc.line(n);
    const text = line.text;
    const fm = text.match(RE_FENCE_INFO);
    if (fence) {
      if (closesFence(text, fence)) {
        out.blocks.push({
          kind: 'code',
          startLine: fence.startLine, endLine: n,
          from: doc.line(fence.startLine).from, to: line.to,
          lang: fence.lang,
          closed: true,
          code: doc.sliceString(doc.line(fence.startLine).to + 1, line.from),
        });
        fence = null;
      }
      continue;
    }
    if (fm) { fence = { marker: fm[1][0], len: fm[1].length, startLine: n, lang: codeLanguageName(fm[2]) }; continue; }

    // ---- block math: $$ ... $$
    if (RE_MATH_ONLY.test(text)) {
      for (let k = n + 1; k <= total; k++) {
        if (inFm(k)) break;
        if (RE_MATH_ONLY.test(doc.line(k).text)) {
          out.blocks.push({
            kind: 'math', startLine: n, endLine: k,
            from: line.from, to: doc.line(k).to,
            tex: doc.sliceString(line.to, doc.line(k).from).trim(),
          });
          n = k;
          break;
        }
      }
      continue;
    }
    const ms = text.match(RE_MATH_SINGLE);
    if (ms) {
      out.blocks.push({ kind: 'math', startLine: n, endLine: n, from: line.from, to: line.to, tex: ms[1] });
      continue;
    }

    // ---- table: header row + delimiter row
    if (RE_TABLE_ROW.test(text) && n + 1 <= total
      && RE_TABLE_DELIM.test(doc.line(n + 1).text) && doc.line(n + 1).text.includes('-')) {
      let endN = n + 1;
      while (endN + 1 <= total && RE_TABLE_ROW.test(doc.line(endN + 1).text)
        && !RE_FENCE_OPEN.test(doc.line(endN + 1).text)) endN++;
      out.blocks.push({ kind: 'table', startLine: n, endLine: endN, from: line.from, to: doc.line(endN).to });
      n = endN;
      continue;
    }

    // ---- callout: > [!type] ...
    if (RE_CALLOUT.test(text)) {
      let endN = n;
      while (endN + 1 <= total && RE_QUOTE_LINE.test(doc.line(endN + 1).text)) endN++;
      out.blocks.push({ kind: 'callout', startLine: n, endLine: endN, from: line.from, to: doc.line(endN).to });
      n = endN;
      continue;
    }
  }

  if (fence) {
    const opening = doc.line(fence.startLine);
    out.blocks.push({ kind: 'code', startLine: fence.startLine, endLine: total,
      from: opening.from, to: doc.length, lang: fence.lang, closed: false,
      code: doc.sliceString(Math.min(opening.to + 1, doc.length)),
    });
  }
  blocksCache.set(doc, out);
  return out;
}

// ---------------------------------------------------------------------------
// Block decoration layer (StateField — block widgets are only legal here)
// ---------------------------------------------------------------------------
function computeBlockLayer(state) {
  const app = state.facet(appFacet);
  const getPath = state.facet(sourcePathFacet);
  const sourcePath = getPath ? getPath() : '';
  const doc = state.doc;
  const { frontmatter, blocks } = classifyBlocks(doc);
  const sel = state.selection.ranges;
  const touched = (from, to) => {
    for (const r of sel) if (r.from <= to && r.to >= from) return true;
    return false;
  };

  const decorations = [];
  const coveredLines = new Set();
  const settings = (app && app.settings && app.settings.appSettings) || {};
  const propsMode = settings.propertiesInDocument || 'visible';
  const folded = (from, to) => {
    let hidden = false;
    foldedRanges(state).between(from, to, (start, end) => { if (start < to && end > from) hidden = true; });
    return hidden;
  };

  if (frontmatter && !folded(frontmatter.from, frontmatter.to)) {
    for (let n = frontmatter.startLine; n <= frontmatter.endLine; n++) coveredLines.add(n);
    const file = app && app.vault ? app.vault.getFileByPath(sourcePath) : null;
    const fmRaw = state.field(fmSourceField, false);
    const showWidget = propsMode === 'visible' && file && !fmRaw;
    if (propsMode === 'hidden') {
      // 隐藏模式：属性不显示（源码仍在文件中，切换为“源码”模式可编辑）
      decorations.push(Decoration.replace({ block: true }).range(frontmatter.from, frontmatter.to));
    } else if (showWidget) {
      const fmText = doc.sliceString(frontmatter.from, frontmatter.to);
      decorations.push(Decoration.replace({
        widget: new PropertiesWidget(app, file, fmText, frontmatter.from), block: true,
      }).range(frontmatter.from, frontmatter.to));
    } else {
      for (let n = frontmatter.startLine; n <= frontmatter.endLine; n++) {
        decorations.push(Decoration.line({ class: 'cm-hmd-frontmatter' }).range(doc.line(n).from));
      }
    }
  }

  for (const b of blocks) {
    if (touched(b.from, b.to) || folded(b.from, b.to)) continue;
    let widget = null;
    if (b.kind === 'math') widget = new MathBlockWidget(b.tex, b.from, b.to);
    else if (b.kind === 'table') widget = new TableWidget(app, doc.sliceString(b.from, b.to), sourcePath, b.from, b.to);
    else if (b.kind === 'callout') widget = new CalloutWidget(doc.sliceString(b.from, b.to), sourcePath);
    else if (b.kind === 'code') widget = b.lang === 'mermaid' ? new MermaidWidget(b.code, b.from, b.to) : new CodeBlockWidget(b.lang, b.code, b.from, b.to);
    if (!widget) continue;
    for (let n = b.startLine; n <= b.endLine; n++) coveredLines.add(n);
    decorations.push(Decoration.replace({ widget, block: true }).range(b.from, b.to));
  }

  return { decorations: Decoration.set(decorations, true), coveredLines };
}

const blockLayerField = StateField.define({
  create(state) { return computeBlockLayer(state); },
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length) return computeBlockLayer(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

// ---------------------------------------------------------------------------
// Line classification helpers
// ---------------------------------------------------------------------------
const RE_HEADING = /^(\s{0,3})(#{1,6})(\s+)(.*)$/;
const RE_QUOTE = /^(\s{0,3}(?:>\s?)+)(.*)$/;
const RE_TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]([ \t]?)/;
const RE_BULLET = /^(\s*)([-*+])(\s+)/;
const RE_ORDERED = /^(\s*)(\d+)([.)])(\s+)/;
const RE_HR = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

function computeFenceLines(doc) {
  const map = new Map();
  for (const block of classifyBlocks(doc).blocks) {
    if (block.kind !== 'code') continue;
    for (let n = block.startLine; n <= block.endLine; n++) {
      map.set(n - 1, n === block.startLine ? 'begin' : n === block.endLine && block.closed ? 'end' : 'body');
    }
  }
  return map;
}

function lineClass(line, cls) {
  return Decoration.line({ class: cls }).range(line.from);
}

// ---------------------------------------------------------------------------
// Build inline decorations (ViewPlugin — no block decorations allowed here)
// ---------------------------------------------------------------------------
function buildDecorations(view, app: App) {
  const doc = view.state.doc;
  const decorations = [];
  const sel = view.state.selection.ranges;
  const touches = (from, to) => {
    for (const r of sel) {
      if (r.from <= to && r.to >= from) return true;
    }
    return false;
  };

  const field = view.state.field(blockLayerField, false);
  const covered = field ? field.coveredLines : new Set();

  const fenceLines = view.__fenceCacheDoc === doc ? view.__fenceCache : computeFenceLines(doc);
  view.__fenceCache = fenceLines;
  view.__fenceCacheDoc = doc;
  const getPath = view.state.facet(sourcePathFacet);
  const sourcePath = getPath ? getPath() : '';

  for (const { from, to } of view.visibleRanges) {
    const startLineNo = doc.lineAt(from).number;
    const endLineNo = doc.lineAt(to).number;
    for (let n = startLineNo; n <= endLineNo; n++) {
      if (covered.has(n)) continue;
      const line = doc.line(n);
      const l = n - 1;
      const text = line.text;
      const lineStart = line.from;
      if (text) {
        // ---- fenced code blocks
        const fenceState = fenceLines.get(l);
        if (fenceState) {
          decorations.push(lineClass(line, 'HyperMD-codeblock'));
          if (fenceState === 'begin') {
            decorations.push(lineClass(line, 'HyperMD-codeblock-begin HyperMD-codeblock-bg'));
            if (!touches(lineStart, lineStart + text.length)) {
              const m = text.match(RE_FENCE_OPEN);
              const lang = text.slice(m[1].length).trim().split(/\s+/)[0] || '';
              decorations.push(Decoration.replace({}).range(lineStart, lineStart + text.length));
              decorations.push(Decoration.widget({ widget: new LangWidget(lang), side: 1 }).range(lineStart));
            }
          } else if (fenceState === 'end') {
            decorations.push(lineClass(line, 'HyperMD-codeblock-end HyperMD-codeblock-bg'));
            if (!touches(lineStart, lineStart + text.length)) {
              decorations.push(Decoration.replace({}).range(lineStart, lineStart + text.length));
            }
          } else {
            decorations.push(lineClass(line, 'HyperMD-codeblock-bg'));
          }
        } else {
          // ---- headings
          const hm = text.match(RE_HEADING);
          if (hm) {
            const level = hm[2].length;
            decorations.push(lineClass(line, `HyperMD-header HyperMD-header-${level} cm-header cm-header-${level}`));
            const markFrom = lineStart + hm[1].length;
            const markTo = markFrom + hm[2].length + hm[3].length;
            if (!touches(markFrom, markTo)) {
              decorations.push(Decoration.replace({}).range(markFrom, markTo));
            }
          }

          // ---- blockquote
          const qm = text.match(RE_QUOTE);
          if (qm && qm[1]) {
            decorations.push(lineClass(line, 'HyperMD-quote'));
            const markTo = lineStart + qm[1].length;
            if (!touches(lineStart, markTo)) {
              decorations.push(Decoration.replace({}).range(lineStart, markTo));
            }
          }

          // ---- horizontal rule
          if (RE_HR.test(text) && !RE_HEADING.test(text)) {
            if (!touches(lineStart, lineStart + text.length)) {
              decorations.push(Decoration.replace({ widget: new HrWidget() }).range(lineStart, lineStart + text.length));
            }
            continue;
          }

          // ---- tasks & bullets
          const tm = text.match(RE_TASK);
          if (tm) {
            // 原版：非光标行的任务标记只留缩进位（- 不可见），[x] 换成复选框
            const leadMatch = tm[1].match(/^\s*/);
            const markFrom = lineStart + leadMatch[0].length;
            const cbStart = lineStart + tm[1].length;
            if (!touches(markFrom, cbStart)) {
              decorations.push(Decoration.replace({ widget: new BulletWidget(/\d/.test(tm[1]), 0, true) }).range(markFrom, cbStart));
            }
            decorations.push(Decoration.replace({ widget: new CheckboxWidget(tm[2].toLowerCase() === 'x', cbStart) }).range(cbStart, cbStart + 3));
            decorations.push(lineClass(line, tm[2].toLowerCase() === 'x' ? 'HyperMD-task-line cm-task-checked' : 'HyperMD-task-line'));
          } else {
            bulletDecoration(decorations, line, text, lineStart, touches, 0);
          }

          // ---- inline formats
          applyInline(decorations, app, line, text, lineStart, sourcePath, touches);
        }
      }
    }
  }
  return Decoration.set(decorations, true);
}

function bulletDecoration(decorations, line, text, lineStart, touches, offset) {
  const sub = text.slice(offset);
  if (RE_HR.test(text)) return;
  const om = sub.match(RE_ORDERED);
  if (om) {
    decorations.push(lineClass(line, 'HyperMD-list-line cm-list-line-ol'));
    const from = lineStart + offset + om[1].length;
    const to = from + om[2].length + 1;
    if (!touches(from, to)) {
      decorations.push(Decoration.replace({ widget: new BulletWidget(true, om[2]) }).range(from, to));
    }
    return;
  }
  const bm = sub.match(RE_BULLET);
  if (bm) {
    decorations.push(lineClass(line, 'HyperMD-list-line cm-list-line-ul'));
    const from = lineStart + offset + bm[1].length;
    if (!touches(from, from + 1)) {
      decorations.push(Decoration.replace({ widget: new BulletWidget(false) }).range(from, from + 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Inline patterns
// ---------------------------------------------------------------------------
function resolveImageSrc(app: App, url, sourcePath) {
  if (/^(https?|data|app):/i.test(url)) return url;
  let clean = url;
  try { clean = decodeURIComponent(url); } catch (e) {}
  const dest = app.metadataCache.getFirstLinkpathDest(clean, sourcePath, true);
  const file = dest && app.vault.getFileByPath(dest);
  if (file) return app.vault.adapter.getResourcePath(file.path);
  return url;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

function applyInline(decorations, app: App, line, text, lineStart, sourcePath, touches) {
  // images: ![alt](url) — 竖线后的宽度/宽高与阅读视图同一套解析
  let m;
  const imgRe = /!\[([^\]]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = imgRe.exec(text))) {
    const from = lineStart + m.index, to = from + m[0].length;
    if (touches(from, to)) continue;
    const src = resolveImageSrc(app, m[2], sourcePath);
    const split = splitImageSize(m[1]);
    decorations.push(Decoration.replace({ widget: imageWidget(src, split.text, split.size) }).range(from, to));
  }

  // inline math $...$
  const mathRe = /\$([^$\n]+?)\$/g;
  while ((m = mathRe.exec(text))) {
    const from = lineStart + m.index, to = from + m[0].length;
    if (touches(from, to)) continue;
    decorations.push(Decoration.replace({ widget: new MathWidget(m[1], false) }).range(from, to));
  }

  // comments %%...%%
  const cRe = /%%[\s\S]*?%%/g;
  while ((m = cRe.exec(text))) {
    const from = lineStart + m.index;
    decorations.push(Decoration.mark({ class: 'cm-comment' }).range(from, Math.min(from + m[0].length, lineStart + text.length)));
  }

  // formats
  const formats: Array<[RegExp, string]> = [
    [/\*\*([^*\n]+?)\*\*/g, 'cm-strong'],
    [/__([^_\n]+?)__/g, 'cm-strong'],
    [/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, 'cm-em'],
    [/(?<![\w_])_([^_\n]+?)_(?![\w_])/g, 'cm-em'],
    [/~~([^~\n]+?)~~/g, 'cm-strikethrough'],
    [/==([^=\n]+?)==/g, 'cm-highlight'],
    [/`([^`\n]+?)`/g, 'cm-inline-code'],
  ];
  for (const [re, cls] of formats) {
    let mm;
    while ((mm = re.exec(text))) {
      const full = mm[0];
      const inner = mm[1];
      const leftLen = full.indexOf(inner);
      const from = lineStart + mm.index + leftLen;
      const to = from + inner.length;
      if (touches(from, to)) continue;
      decorations.push(Decoration.mark({ class: cls }).range(from, to));
      if (leftLen > 0) decorations.push(Decoration.replace({}).range(lineStart + mm.index, from));
      const fullEnd = lineStart + mm.index + full.length;
      if (to < fullEnd) decorations.push(Decoration.replace({}).range(to, fullEnd));
    }
  }

  // wikilinks [[target|alias]] and embeds ![[target]]
  const wlRe = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  let wm;
  while ((wm = wlRe.exec(text))) {
    const from = lineStart + wm.index, to = from + wm[0].length;
    if (touches(from, to)) continue;
    const embed = wm[1] === '!';
    const inner = wm[2];
    const parts = inner.split('|');
    let target = parts[0].trim();
    const alias = parts.length > 1 ? parts.slice(1).join('|').trim() : null;
    let display = alias || target;
    const hash = target.indexOf('#');
    if (hash >= 0) {
      const sub = target.slice(hash + 1);
      target = target.slice(0, hash);
      if (!alias) display = sub ? sub : display;
    }
    if (embed) {
      const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath, true);
      const file = dest && app.vault.getFileByPath(dest);
      if (file && IMAGE_EXTS.includes(file.extension)) {
        const src = app.vault.adapter.getResourcePath(file.path);
        const split = splitEmbedSize(alias);
        decorations.push(Decoration.replace({ widget: imageWidget(src, split.text || file.basename, split.size) }).range(from, to));
        continue;
      }
    }
    decorations.push(Decoration.replace({ widget: new LinkWidget(display || target, inner, embed, sourcePath) }).range(from, to));
  }

  // markdown links [text](url)
  const mlRe = /(?<!!)\[([^\[\]\n]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
  let mm2;
  while ((mm2 = mlRe.exec(text))) {
    const from = lineStart + mm2.index, to = from + mm2[0].length;
    if (touches(from, to)) continue;
    const label = mm2[1];
    const url = mm2[2];
    if (/^(https?|obsidian):/i.test(url)) {
      decorations.push(Decoration.replace({ widget: new LinkWidget(label || url, url, false, sourcePath, true) }).range(from, to));
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || /^file:/i.test(url)) {
      decorations.push(Decoration.replace({ widget: new LinkWidget(label || url, url, false, sourcePath) }).range(from, to));
    }
  }

  // tags
  const tagRe = /(^|[\s(【（[,;：:])#([\p{L}\p{N}_\-\/]+)/gu;
  let tg;
  while ((tg = tagRe.exec(text))) {
    const tagStart = lineStart + tg.index + tg[1].length;
    const tagBody = tg[2];
    if (/^[0-9a-fA-F]{3,8}$/.test(tagBody)) continue;
    if (/^\d+$/.test(tagBody)) continue;
    decorations.push(Decoration.mark({ class: 'cm-tag' }).range(tagStart, tagStart + tagBody.length + 1));
  }
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------
export function livePreviewExtension(app: App, getSourcePath) {
  return [
    appFacet.of(app),
    sourcePathFacet.of(getSourcePath || (() => '')),
    fmSourceField,
    blockLayerField,
    ViewPlugin.fromClass(class {
  declare decorations: any;

      constructor(view) {
        this.decorations = RangeSet.empty;
        try { this.decorations = buildDecorations(view, app); } catch (e) { console.error('live preview', e); }
      }
      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.geometryChanged) {
          try { this.decorations = buildDecorations(update.view, app); } catch (e) { console.error('live preview', e); }
        }
      }
    }, {
      decorations: (v) => v.decorations,
    }),
  ];
}
