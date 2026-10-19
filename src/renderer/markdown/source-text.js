/**
 * [INPUT]: 依赖 @codemirror/commands 的 isolateHistory 注解；依赖 core/i18n.js 的 tt 与 core/notices.js 的 Notice。
 * [OUTPUT]: 导出 escapeHtml、escapeAttr、stripFrontmatter、parseImageSize、sizeAttrText、splitImageSize、splitEmbedSize、imageSizeSpan、installSourceOffsets、sourceRangeAttrs、fillImageContextMenu。
 * [POS]: markdown/ 的源文本层，服务阅读视图：解析 `|300` / `|300x200` 尺寸语法、把行内图片/嵌入的源区间标注进 token.meta 与 DOM、把阅读 DOM 的图片右键改写回源文本。reading.js 的渲染器与 live-preview.js 的内嵌图片部件都从这里取尺寸解析，保证两处口径一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Source-text layer for the reading view: escaping, frontmatter stripping,
 * Obsidian image-size syntax, source-range annotation and the source rewrites
 * behind the image context menu (reset size / delete image).
 */
import { isolateHistory } from '@codemirror/commands';
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** 去掉开头的 YAML frontmatter，返回正文（必是原文本的后缀）。 */
export function stripFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] === undefined || lines[0].trim() !== '---') return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') return lines.slice(i + 1).join('\n');
  }
  return text;
}

// ---------------------------------------------------------------------------
// 图片尺寸语法（原版 Vx / Hx / c6）
// ---------------------------------------------------------------------------
const IMAGE_SIZE_RE = /^\s*(\d+)\s*(?:x\s*(\d+)\s*)?$/;

/** 原版 Vx(e)：解析 `300` 或 `300x200`（允许两侧空白），解析失败返回 null。 */
export function parseImageSize(text) {
  const m = IMAGE_SIZE_RE.exec(text == null ? '' : String(text));
  if (!m) return null;
  return { x: parseInt(m[1], 10), y: m[2] ? parseInt(m[2], 10) : 0 };
}

/** 原版 Hx：尺寸落成 img 属性。无高度参数时只写 width，高度由浏览器按原始比例缩放。 */
export function sizeAttrText(size) {
  if (!size || size.x <= 0) return '';
  return ` width="${size.x}"` + (size.y > 0 ? ` height="${size.y}"` : '');
}

/**
 * 原版 image transformer：`![alt|300](url)` 的尺寸段必须跟在竖线后。
 * 没有竖线时整段都算 alt——`![300](url)` 不生效。
 */
export function splitImageSize(text) {
  const s = text == null ? '' : String(text);
  const i = s.lastIndexOf('|');
  if (i === -1) return { size: null, text: s };
  const size = parseImageSize(s.slice(i + 1));
  return size ? { size, text: s.slice(0, i) } : { size: null, text: s };
}

/**
 * 原版 d6.applyTitle：`![[pic.png|300]]` 的别名没有竖线时整段按尺寸判定，
 * 尺寸段被摘掉后别名回退到文件名。
 */
export function splitEmbedSize(text) {
  const s = text == null ? '' : String(text);
  const i = s.lastIndexOf('|');
  if (i === -1) {
    const size = parseImageSize(s);
    return size ? { size, text: '' } : { size: null, text: s };
  }
  const size = parseImageSize(s.slice(i + 1));
  return size ? { size, text: s.slice(0, i) } : { size: null, text: s };
}

/**
 * 原版 c6 的删除分支：定位文本里要移除的尺寸段（含前导竖线）。
 * 无尺寸段返回 null；整段就是尺寸时返回整段。
 */
export function imageSizeSpan(text) {
  const s = text == null ? '' : String(text);
  if (!s) return null;
  if (parseImageSize(s)) return { start: 0, end: s.length };
  const i = s.lastIndexOf('|');
  if (i !== -1 && parseImageSize(s.slice(i + 1))) return { start: i, end: s.length };
  return null;
}

// ---------------------------------------------------------------------------
// 源区间标注（原版 widget.start / widget.end 的等价物）
// ---------------------------------------------------------------------------
/** 行内子 token 在源文本里的字面量；返回 null 表示无法定位，标注就地停止。 */
function childNeedle(child) {
  switch (child.type) {
    case 'text': return child.content;
    case 'code_inline': { const m = child.markup || '`'; return m + child.content + m; }
    case 'math_inline': return '$' + child.content + '$';
    case 'obsidian_comment': return '%%' + child.content + '%%';
    case 'wikilink': return '[[' + child.content + ']]';
    case 'wikilink_embed': return '![[' + child.content + ']]';
    case 'image': return '![' + child.content + ']';
    case 'softbreak':
    case 'hardbreak': return '\n';
    case 'html_inline': return child.content;
    default: return child.content === undefined || child.content === '' ? '' : child.content;
  }
}

/**
 * 把行内图片与嵌入在源文本里的绝对起点记进 token.meta.srcFrom。
 * 光标随 token 顺序单调推进，任一字面量对不上就停止标注——宁可没有区间，也不写错位置。
 */
export function installSourceOffsets(md) {
  md.core.ruler.push('obsidian_source_offsets', (state) => {
    const src = state.src;
    const lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.map || !token.children) continue;
      const from = lineStarts[token.map[0]];
      if (from === undefined) continue;
      const to = lineStarts[token.map[1]] === undefined ? src.length : lineStarts[token.map[1]] - 1;
      const window = src.slice(from, to);
      let cursor = 0;
      for (const child of token.children) {
        const needle = childNeedle(child);
        if (needle === null) break;
        const at = needle === '' ? cursor : window.indexOf(needle, cursor);
        if (at < 0) break;
        cursor = at + needle.length;
        const head = child.type === 'image' ? 2 : child.type === 'wikilink_embed' ? 3 : 0;
        if (!head) continue;
        child.meta = Object.assign({}, child.meta, { srcFrom: from + at + head });
      }
    }
    return true;
  });
}

/**
 * 把"这段链接文本在源文件中的位置"写进 DOM：来源文件 + 内层文本起点 + 内层原文 + 语法种类。
 * 阅读视图图片右键据此改写源文本。
 */
export function sourceRangeAttrs(env, token, innerText) {
  const meta = token && token.meta;
  if (!meta || typeof meta.srcFrom !== 'number' || !env.sourcePath) return '';
  const kind = token.type === 'wikilink_embed' ? 'wiki' : 'md';
  return ` data-source-path="${escapeAttr(env.sourcePath)}" data-source-from="${meta.srcFrom}"` +
    ` data-source-text="${escapeAttr(innerText)}" data-source-kind="${kind}"`;
}

// ---------------------------------------------------------------------------
// 图片右键：重置大小 / 删除图片（原版 h6）
// ---------------------------------------------------------------------------
/** 图片目标解析为库内文件；外部 URL 返回 null（原版 d6 与 p6 的分野）。 */
function resolveEmbeddedFile(app, href, sourcePath) {
  if (!href) return null;
  let clean = href;
  try { clean = decodeURIComponent(href); } catch (e) { /* 保留原样 */ }
  const dest = app.metadataCache.getFirstLinkpathDest(clean, sourcePath || '');
  const path = dest && dest.path ? dest.path : dest;
  return typeof path === 'string' ? app.vault.getFileByPath(path) : null;
}

/** 找到承载这段阅读 DOM 的源编辑器；跨文件（嵌套嵌入、悬停预览）返回 null。 */
function findReadingEditor(app, el) {
  const workspace = app.workspace;
  if (!workspace || !workspace.iterateAllLeaves) return null;
  let found = null;
  workspace.iterateAllLeaves((leaf) => {
    const view = leaf && leaf.view;
    if (found || !view || !view.editor || !view.readingEl || !view.editor.cm) return;
    if (view.readingEl.contains(el)) found = view.editor;
  });
  return found;
}

/**
 * 内层文本在编辑器文档中的区间。渲染用的是 stripFrontmatter 后的正文，
 * 这里补齐前言偏移并逐字校验；校验不过再退回"全文唯一出现"定位，
 * 仍不成立返回 null——绝不改错位置。
 */
function locateInnerRange(editor, holder, innerText) {
  const path = holder.getAttr('data-source-path');
  if (!path || path !== editor.sourcePath || !innerText) return null;
  const base = parseInt(holder.getAttr('data-source-from'), 10);
  if (!Number.isFinite(base)) return null;
  const doc = editor.cm.state.doc;
  const full = doc.toString();
  const body = stripFrontmatter(full);
  let delta = full.length - body.length;
  if (delta < 0 || full.slice(delta) !== body) delta = full.indexOf(body);
  if (delta < 0) return null;
  const verify = (from) => (doc.sliceString(from, from + innerText.length) === innerText
    ? { from, to: from + innerText.length } : null);
  const direct = verify(delta + base);
  if (direct) return direct;
  const idx = body.indexOf(innerText);
  if (idx < 0 || body.indexOf(innerText, idx + 1) >= 0) return null;
  return verify(delta + idx);
}

/** 整段链接文本的区间：`![[...]]` 按固定括号，`![...](...)` 扫到配对右括号。 */
function embedTextRange(doc, kind, innerRange) {
  if (kind === 'wiki') return { from: innerRange.from - 3, to: innerRange.to + 2 };
  if (kind !== 'md' || doc.sliceString(innerRange.to, innerRange.to + 1) !== '(') return null;
  let depth = 0;
  for (let i = innerRange.to; i < doc.length; i++) {
    const ch = doc.sliceString(i, i + 1);
    if (ch === '\\') { i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return { from: innerRange.from - 2, to: i + 1 }; }
    else if (ch === '\n') return null;
  }
  return null;
}

/** 原版 h6 的 reset-size 项：img 上有 width 属性且能定位源区间时才出现。 */
function addResetSizeItem(app, menu, img, holder) {
  if (img.getAttribute('width') === null) return;
  const innerText = holder.getAttr('data-source-text') || '';
  const span = imageSizeSpan(innerText);
  if (!span) return;
  const editor = findReadingEditor(app, img);
  if (!editor) return;
  if (!locateInnerRange(editor, holder, innerText)) return;
  menu.addItem((i) => i.setSection('image').setTitle(tt('editor.menu.reset-size', 'Reset size')).setIcon('lucide-rotate-ccw')
    .onClick(() => {
      const inner = locateInnerRange(editor, holder, innerText);
      if (!inner) return;
      // 走编辑器事务：撤销栈与自动保存链路与原版一致。
      // isolateHistory：把这次改写与相邻编辑切成分组，undo 只回退这一格属性，
      // 不会把前后编辑一起吞掉（装载用的 Editor.setValue 已重建历史、不入栈）。
      editor.cm.dispatch({
        changes: { from: inner.from + span.start, to: inner.from + span.end, insert: '' },
        annotations: [isolateHistory.of('before')],
      });
      img.removeAttribute('width');
      img.removeAttribute('height');
    }));
}

/** 原版 h6 的 delete-image 项：先走库内删除确认，确认后连同整段链接文本一起移除。 */
function addDeleteImageItem(app, menu, img, holder, file) {
  const innerText = holder.getAttr('data-source-text') || '';
  const editor = findReadingEditor(app, img);
  if (!editor || !innerText) return;
  menu.addItem((i) => i.setSection('danger').setTitle(tt('editor.menu.delete-image', 'Delete image')).setWarning(true).setIcon('lucide-trash-2')
    .onClick(async () => {
      const confirmed = await app.fileManager.promptForDeletion(file);
      if (!confirmed) return;
      const inner = locateInnerRange(editor, holder, innerText);
      if (!inner) return;
      const whole = embedTextRange(editor.cm.state.doc, holder.getAttr('data-source-kind'), inner);
      if (!whole) return;
      editor.cm.dispatch({
        userEvent: 'select.pointer',
        selection: { anchor: whole.from },
        changes: { from: whole.from, to: whole.to, insert: '' },
      });
    }));
}

/** 复制图片：库内文件读二进制，URL/data 走 fetch（原版 interface.menu.copy-image）。 */
function addCopyImageItem(app, menu, href, sourcePath) {
  menu.addItem((i) => i.setSection('image').setTitle(tt('interface.menu.copy-image', 'Copy image')).setIcon('lucide-copy')
    .onClick(async () => {
      try {
        let bytes = null;
        let type = 'image/png';
        const file = resolveEmbeddedFile(app, href, sourcePath);
        if (file) {
          bytes = await app.vault.readBinary(file);
          type = mimeForExtension(file.extension) || type;
        } else if (href && /^(data:|https?:|app:|blob:)/i.test(href)) {
          const res = await fetch(href);
          const blob = await res.blob();
          bytes = new Uint8Array(await blob.arrayBuffer());
          if (blob.type) type = blob.type;
        }
        if (!bytes) throw new Error('no image');
        await navigator.clipboard.write([new ClipboardItem({ [type]: new Blob([bytes], { type }) })]);
      } catch (e) {
        new Notice(tt('interface.copy-failed', 'Failed to copy'));
      }
    }));
}

function mimeForExtension(ext) {
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  };
  return map[String(ext || '').toLowerCase()] || '';
}

/**
 * 阅读视图图片右键菜单（原版 h6 的分支与顺序）：
 * 复制图片 → 库内图片再挂链接菜单 → 重置大小（仅带 width）→ 删除图片。
 * 分节表 addSections(['title','image'])：图片项自成一节，链接菜单项排在其后，danger 段在末尾。
 */
export function fillImageContextMenu(app, menu, img, sourcePath, ev) {
  // 原版 addSections(["title","image"])：图片项自成一节，链接菜单项排列其后，danger 段在末尾
  menu.addSections(['title', 'image']);
  const holder = img.closest('[data-source-text]') || img.closest('[data-href]');
  const href = holder ? holder.getAttr('data-href') : '';
  addCopyImageItem(app, menu, href, sourcePath);
  const file = resolveEmbeddedFile(app, href, sourcePath);
  if (file) app.workspace.handleLinkContextMenu(menu, file.path, sourcePath, ev);
  if (!holder) return;
  if (img.getAttribute('width') !== null) addResetSizeItem(app, menu, img, holder);
  if (file) addDeleteImageItem(app, menu, img, holder, file);
}
