/**
 * [INPUT]: 依赖 markdown-it、footnote/task-lists、Desktop、图标和 vault 路径；代码块委托 highlight.js，公式委托 math.js，图表委托 mermaid.js，取消等待委托 render-cancel.js；子路径滚动与块标记委托 reading-subpath.js；转义、frontmatter 剥离与图片尺寸语法来自 source-text.js；画布嵌入委托 views/canvas-minimap.js，数据库嵌入委托 plugins-core/bases-embed.js，保留宿主文件上下文。
 * [OUTPUT]: 导出 getMarkdownIt、renderMarkdown、attachMarkdownInteractions、stripFrontmatter、scrollToSubpath、resolvePath、resolveFileUrl 与 escapeHtml；渲染与交互支持可选 AbortSignal
 * [POS]: markdown/ 的阅读视图渲染器，被 markdown-view.js（阅读模式）与 live-preview.js（块级 widget 内嵌 HTML）共同调用。callout 渲染为 div.callout（原版 DOM 非 blockquote），标题行 softbreak 剥离且图标走 lucide- 原名（note=pencil，不走 pencil→edit-3 别名）。图片尺寸语法 `|300` / `|300x200` 由 source-text.js 解析，这里负责落成 img 的 width/height 与 .image-wrapper 结构；带尺寸的图片另外带 data-source-* 区间提示，图片右键交给 source-text.js 的 fillImageContextMenu。渲染后由 decorateReadingDom 补齐原版阅读 DOM：无序列表的 has-list-bullet/.list-bullet 圆点、任务项的 data-task/is-checked 与可点击复选框、脚注的 .footnote-link；笔记嵌块走原版 inline-embed 结构（标题 + 内容 + 右上角链接按钮），不可渲染附件走 .file-embed.mod-generic。.canvas 嵌入改走「画布嵌入」（原版 cte）：这里只放占位标记，容器与缩略图由 views/canvas-minimap.js 异步补齐；目标文件不存在时按原版落 .file-embed.mod-empty 提示。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Reading view renderer — markdown-it with Obsidian-flavored extensions:
 * wikilinks/embeds, tags, highlights, callouts, math, footnotes, task lists.
 */
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import { Desktop } from '../core/ipc.js';
import { createIcon, setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { normalizePath, parentPathOf } from '../core/vault.js';
import { codeLanguageName, highlightCodeBlocks, cancelCodeHighlight } from './highlight.js';
import { renderMathBlocks, cancelMath } from './math.js';
import { renderMermaidBlocks, cancelMermaidBlocks } from './mermaid.js';
import { RENDER_ABORTED, waitForRender } from './render-cancel.js';
export { renderMermaidBlocks } from './mermaid.js';
import {
  escapeAttr, escapeHtml, fillImageContextMenu, installSourceOffsets, sizeAttrText,
  sourceRangeAttrs, splitEmbedSize, splitImageSize, stripFrontmatter,
} from './source-text.js';
import { missingCanvasNote, mountCanvasEmbed } from '../views/canvas-minimap.js';
import { mountBaseEmbed } from '../plugins-core/bases-embed.js';
import { scrollToSubpath, annotateBlocks } from './reading-subpath.js';
export { scrollToSubpath } from './reading-subpath.js';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'opus'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'mov', 'mkv'];
const MAX_EMBED_DEPTH = 5;

let mdInstance = null;

export function getMarkdownIt() {
  if (mdInstance) return mdInstance;
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    typographer: false,
  });
  md.use(footnote);
  md.use(taskLists, { disabled: false });

  installWikilinks(md);
  installHighlight(md);
  installComments(md);
  installMath(md);
  installTags(md);
  installCallouts(md);
  installSourceOffsets(md);

  // external links get a class; internal file links get handled later
  const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') || '';
    if (/^https?:/i.test(href)) {
      token.attrSet('class', 'external-link');
      token.attrSet('rel', 'noopener');
      token.attrSet('target', '_blank');
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      // other protocols: leave alone
    } else {
      token.attrSet('class', 'internal-link');
      token.attrSet('data-href', decodeURIComponent(href));
      token.attrSet('href', 'javascript:void(0)');
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // images
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const split = splitImageSize(token.content || '');
    let resolved = src;
    if (!/^(https?|data|app):/i.test(src)) {
      resolved = resolveFileUrl(env.app, decodeURIComponent(src), env.sourcePath) || src;
    }
    const cls = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(src) ? 'internal-embed image-embed' : '';
    const attrs = sourceRangeAttrs(env, token, token.content || '');
    // data-href：右键"复制图片"用原始目标（路径或 URL）解析
    return `<span class="${cls}" data-href="${escapeAttr(src)}"${attrs}>` +
      `<span class="image-wrapper"><img src="${escapeAttr(resolved)}" alt="${escapeAttr(split.text)}" class="cm-inline-image"${sizeAttrText(split.size)}></span></span>`;
  };

  // ---- 围栏代码块：Mermaid 独立渲染，其余共用 Lezer 高亮 ---------------------
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';
    const lang = codeLanguageName(info);
    if (lang === 'mermaid') {
      return `<div class="mermaid-source" data-source="${escapeAttr(token.content)}"></div>`;
    }
    return `<pre><code class="language-${escapeAttr(lang)}" data-lang="${escapeAttr(lang)}">${escapeHtml(token.content)}</code></pre>`;
  };

  mdInstance = md;
  return md;
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------
function installWikilinks(md) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const start = state.pos;
    const src = state.src;
    let embed = false;
    let pos = start;
    if (src[pos] === '!' && src[pos + 1] === '[' && src[pos + 2] === '[') { embed = true; pos += 3; }
    else if (src[pos] === '[' && src[pos + 1] === '[') { pos += 2; }
    else return false;
    // pos 已越过 "[[" 或 "![["；此前误写为 pos+2，导致所有 wiki 链接被切掉前两个字符
    const end = src.indexOf(']]', pos);
    if (end < 0) return false;
    const inner = src.slice(pos, end);
    if (inner.includes('[') || inner.includes(']') || inner.includes('\n')) return false;
    if (silent) return true;
    const token = state.push(embed ? 'wikilink_embed' : 'wikilink', '', 0);
    token.content = inner;
    token.meta = { embed };
    state.pos = end + 2;
    return true;
  });

  const renderWiki = (embed) => (tokens, idx, options, env) => {
    const token = tokens[idx];
    const inner = token.content;
    const parts = inner.split('|');
    let target = parts[0].trim();
    const alias = parts.length > 1 ? parts.slice(1).join('|').trim() : '';
    let subpath = '';
    const hashIdx = target.indexOf('#');
    if (hashIdx >= 0) { subpath = target.slice(hashIdx + 1); target = target.slice(0, hashIdx); }
    const display = alias || subpath || target || inner;
    if (embed) {
      return renderEmbed(env, target, subpath, alias, token, inner);
    }
    const destPath = resolvePath(env, target);
    const cls = 'internal-link' + (destPath ? '' : ' is-unresolved');
    const href = destPath ? destPath + (subpath ? '#' + subpath : '') : inner;
    return `<a class="${cls}" data-href="${escapeAttr(href)}" href="javascript:void(0)" target="_blank" rel="noopener">${escapeHtml(display)}</a>`;
  };
  md.renderer.rules.wikilink = renderWiki(false);
  md.renderer.rules.wikilink_embed = renderWiki(true);
}

function installHighlight(md) {
  md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '==') return false;
    const end = state.src.indexOf('==', start + 2);
    if (end < 0 || end === start + 2) return false;
    if (silent) return true;
    const token = state.push('mark_open', 'mark', 1);
    token.markup = '==';
    const content = state.push('text', '', 0);
    content.content = state.src.slice(start + 2, end);
    state.push('mark_close', 'mark', -1).markup = '==';
    state.pos = end + 2;
    return true;
  });
}

function installComments(md) {
  md.inline.ruler.before('emphasis', 'obsidian_comment', (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '%%') return false;
    const end = state.src.indexOf('%%', start + 2);
    if (end < 0) return false;
    if (silent) return true;
    const token = state.push('obsidian_comment', '', 0);
    token.content = state.src.slice(start + 2, end);
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.obsidian_comment = () => '';
}

function installMath(md) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== '$') return false;
    if (state.src[start + 1] === '$') return false;
    // find closing $ not escaped
    let i = start + 1;
    while (i < state.src.length) {
      if (state.src[i] === '\\') { i += 2; continue; }
      if (state.src[i] === '$') break;
      if (state.src[i] === '\n') return false;
      i++;
    }
    if (i >= state.src.length) return false;
    if (silent) return true;
    const token = state.push('math_inline', 'math', 0);
    token.content = state.src.slice(start + 1, i);
    state.pos = i + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, idx) => mathPlaceholder(tokens[idx].content, false);

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.slice(start, start + 2) !== '$$') return false;
    let nextLine = startLine;
    let found = false;
    let content = '';
    const firstLineEnd = state.eMarks[startLine];
    const firstRemainder = state.src.slice(start + 2, firstLineEnd);
    if (firstRemainder.trim().endsWith('$$') && firstRemainder.trim().length > 2) {
      content = firstRemainder.trim().slice(0, -2);
      found = true;
    } else {
      content = firstRemainder;
      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineEnd = state.eMarks[nextLine];
        const text = state.src.slice(lineStart, lineEnd);
        if (text.trim().endsWith('$$')) {
          content += '\n' + text.slice(0, text.lastIndexOf('$$'));
          found = true;
          break;
        }
        content += '\n' + text;
      }
    }
    if (!found) return false;
    if (silent) return true;
    state.line = nextLine + 1;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content;
    token.map = [startLine, state.line];
    return true;
  });
  md.renderer.rules.math_block = (tokens, idx) => mathPlaceholder(tokens[idx].content, true);
}

function mathPlaceholder(content, display) {
  const tag = display ? 'div' : 'span';
  const mode = display ? 'math-block' : 'math-inline';
  return `<${tag} class="math ${mode}" data-math="${escapeAttr(content)}">${escapeHtml(content)}</${tag}>`;
}

function installTags(md) {
  md.core.ruler.push('obsidian_tags', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline') continue;
      const children = token.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type !== 'text') continue;
        const text = child.content;
        const re = /(^|[\s(【（[,;：:])#([\p{L}\p{N}_\-\/]+)/gu;
        let lastIndex = 0;
        let m;
        const newTokens = [];
        let matched = false;
        while ((m = re.exec(text))) {
          const tagBody = m[2];
          if (/^[0-9a-fA-F]{3,8}$/.test(tagBody)) continue;
          if (/^\d+$/.test(tagBody)) continue;
          matched = true;
          const tagStart = m.index + m[1].length;
          if (tagStart > lastIndex) {
            const textToken = new state.Token('text', '', 0);
            textToken.content = text.slice(lastIndex, tagStart);
            newTokens.push(textToken);
          }
          const open = new state.Token('link_open', 'a', 1);
          open.attrSet('class', 'tag');
          open.attrSet('href', 'javascript:void(0)');
          open.attrSet('data-tag', '#' + tagBody);
          const inner = new state.Token('text', '', 0);
          inner.content = '#' + tagBody;
          const close = new state.Token('link_close', 'a', -1);
          newTokens.push(open, inner, close);
          lastIndex = tagStart + tagBody.length + 1;
        }
        if (matched) {
          if (lastIndex < text.length) {
            const textToken = new state.Token('text', '', 0);
            textToken.content = text.slice(lastIndex);
            newTokens.push(textToken);
          }
          children.splice(i, 1, ...newTokens);
          i += newTokens.length - 1;
        }
      }
    }
    return true;
  });
}

const CALLOUT_RE = /^\[!([\w-]+)\]([+-])?\s*(.*)$/;

function installCallouts(md) {
  md.core.ruler.after('inline', 'callouts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'blockquote_open') continue;
      const paraOpen = tokens[i + 1];
      if (!paraOpen || paraOpen.type !== 'paragraph_open') continue;
      const inline = tokens[i + 2];
      if (!inline || inline.type !== 'inline' || !inline.children.length) continue;
      const first = inline.children[0];
      if (first.type !== 'text') continue;
      const m = first.content.match(CALLOUT_RE);
      if (!m) continue;
      // locate the matching blockquote_close before mutating the token list
      let depth = 0, closeIdx = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') depth++;
        else if (tokens[j].type === 'blockquote_close') {
          if (depth === 0) { closeIdx = j; break; }
          depth--;
        }
      }
      if (closeIdx < 0) continue;
      const type = m[1].toLowerCase();
      const fold = m[2] || '';
      const title = m[3] || '';
      token.attrJoin('class', 'callout');
      token.attrJoin('class', 'callout-' + type);
      token.attrSet('data-callout', type);
      if (fold) { token.attrSet('data-callout-fold', fold); token.attrJoin('class', 'is-collapsible'); }
      if (fold === '-') token.attrJoin('class', 'is-collapsed');
      tokens[closeIdx].meta = { callout: true };
      first.content = first.content.slice(m[0].length);
      // 标题行末的换行在 markdown-it 中成为 softbreak；原版 callout 正文前没有 <br>。
      // 删掉标题留下的空 text 与紧随其后的 softbreak，正文首段才与 1.14.4 同构。
      if (first.content === '' && inline.children[0] === first) {
        let remove = 1;
        if (inline.children[1] && inline.children[1].type === 'softbreak') remove = 2;
        inline.children.splice(0, remove);
      }
      if (inline.children.length && inline.children[0].type === 'text') {
        inline.children[0].content = inline.children[0].content.replace(/^[ \t]+/, '');
      }
      const titleToken = new state.Token('html_block', '', 0);
      titleToken.block = true;
      titleToken.content = `<div class="callout-title" data-callout-title="${escapeAttr(type)}"><div class="callout-icon">${calloutIcon(type)}</div><div class="callout-title-inner">${escapeHtml(title || defaultCalloutTitle(type))}</div>${fold ? `<div class="callout-fold${fold === '-' ? ' is-collapsed' : ''}">${calloutFoldIcon()}</div>` : ''}</div><div class="callout-content"${fold === '-' ? ' style="display: none;"' : ''}>`;
      const closeToken = new state.Token('html_block', '', 0);
      closeToken.block = true;
      closeToken.content = '</div>';
      let insertAt = i + 1;
      if (inline.children.length === 0) {
        // the title line carried the whole first paragraph — drop the empty one
        tokens.splice(insertAt, 3);
        closeIdx -= 3;
      }
      tokens.splice(insertAt, 0, titleToken);
      closeIdx += 1;
      tokens.splice(closeIdx, 0, closeToken);
      i = closeIdx;
    }
    return true;
  });
  // callouts render as div.callout (not blockquote) — matches the original DOM
  const defaultBqOpen = md.renderer.rules.blockquote_open
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const cls = tokens[idx].attrGet('class') || '';
    if (cls.split(/\s+/).includes('callout')) {
      return `<div${self.renderAttrs(tokens[idx])}>\n`;
    }
    return defaultBqOpen(tokens, idx, options, env, self);
  };
  const defaultBqClose = md.renderer.rules.blockquote_close
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
    if (tokens[idx].meta && tokens[idx].meta.callout) return '</div>\n';
    return defaultBqClose(tokens, idx, options, env, self);
  };
}

function calloutFoldIcon() {
  try { return createIcon('chevron-down').outerHTML; } catch (e) { return ''; }
}

/** 笔记嵌块右上角链接按钮图标（原版 .markdown-embed-link + lucide-maximize-2）。
    原版 svg 自带 width/height="24"，其 CSS 同样以 --icon-size 定尺寸；
    这里省略这两个属性，让嵌入内容里的 [width] 只可能来自图片尺寸语法。 */
function embedLinkIcon() {
  try {
    const svg = createIcon('maximize-2');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return svg.outerHTML;
  } catch (e) { return ''; }
}

/** 非可渲染附件的通用嵌块图标（原版 .file-embed-icon 用 lucide-file）。 */
function fileEmbedIcon() {
  try { return createIcon('file').outerHTML; } catch (e) { return ''; }
}

function defaultCalloutTitle(type) {
  const names = {
    note: 'Note', abstract: 'Abstract', summary: 'Summary', tldr: 'Tldr', info: 'Info', todo: 'Todo', tip: 'Tip',
    hint: 'Hint', important: 'Important', success: 'Success', check: 'Check', done: 'Done', question: 'Question',
    help: 'Help', faq: 'Faq', warning: 'Warning', caution: 'Caution', attention: 'Attention', failure: 'Failure',
    fail: 'Fail', missing: 'Missing', danger: 'Danger', error: 'Error', bug: 'Bug', example: 'Example', quote: 'Quote', cite: 'Cite',
  };
  return names[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function calloutIcon(type) {
  const icons = {
    note: 'pencil', abstract: 'clipboard-list', info: 'info', todo: 'check-circle-2', tip: 'flame', success: 'check',
    question: 'help-circle', warning: 'alert-triangle', failure: 'x', danger: 'zap', bug: 'bug', example: 'list', quote: 'quote',
  };
  const name = icons[type] || 'pencil';
  try {
    const svg = createIcon('lucide-' + name);
    return svg.outerHTML;
  } catch (e) { return ''; }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
export function resolvePath(env, target) {
  if (!target) return null;
  if (!env.app || !env.sourcePath) return target;
  let clean = target;
  try { clean = decodeURIComponent(target); } catch (e) {}
  return env.app.metadataCache.getFirstLinkpathDest(clean, env.sourcePath, true);
}

export function resolveFileUrl(app: App, target, sourcePath) {
  const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath, true);
  const file = dest && app.vault.getFileByPath(dest);
  if (file) return app.vault.adapter.getResourcePath(file.path);
  return null;
}

function renderEmbed(env, target, subpath, alias, token, inner) {
  const app = env.app;
  if (!app) return `<span>${escapeHtml(target)}</span>`;
  const dest = app.metadataCache.getFirstLinkpathDest(target, env.sourcePath, true);
  const file = dest && app.vault.getFileByPath(dest);
  if (!file) {
    // 原版画布嵌入缺文件时落到通用附件嵌块（.file-embed.mod-empty + 「未创建，点击以创建。」）
    if (/\.canvas$/i.test(target)) return `<span class="internal-embed is-loaded file-embed mod-empty" data-href="${escapeAttr(target)}">${escapeHtml(missingCanvasNote(target))}</span>`;
    return `<span class="internal-embed is-unresolved">${escapeHtml(target)}</span>`;
  }
  const ext = file.extension;
  const url = app.vault.adapter.getResourcePath(file.path);
  if (ext === 'base' && app.plugins?.getInternalPlugin?.('bases')?.enabled) {
    const id = 'embed-' + Math.random().toString(36).slice(2);
    pendingEmbeds.push({ id, kind: 'base', path: file.path, viewName: subpath, sourcePath: env.sourcePath });
    return `<div class="internal-embed bases-embed" data-base-embed="${id}"></div>`;
  }
  if (ext === 'canvas' && app.plugins?.getInternalPlugin?.('canvas')?.enabled !== false) {
    // 原版 cte：.canvas 走画布嵌入（容器由 views/canvas-minimap.js 造）；插件停用时原版注销该扩展，退回通用附件嵌块
    const id = 'embed-' + Math.random().toString(36).slice(2);
    pendingEmbeds.push({ id, kind: 'canvas', path: file.path, linktext: target, sourcePath: env.sourcePath });
    return `<span data-canvas-embed="${id}"></span>`;
  }
  if (IMAGE_EXTS.includes(ext)) {
    const split = splitEmbedSize(alias);
    const size = sizeAttrText(split.size);
    return `<span class="internal-embed image-embed is-loaded" data-href="${escapeAttr(file.path)}"${sourceRangeAttrs(env, token, inner || '')}>` +
      `<span class="image-wrapper"><img src="${escapeAttr(url)}" alt="${escapeAttr(split.text || file.basename)}"${size}></span></span>`;
  }
  if (AUDIO_EXTS.includes(ext)) {
    return `<span class="internal-embed audio-embed is-loaded" data-href="${escapeAttr(file.path)}"><audio controls src="${escapeAttr(url)}"></audio></span>`;
  }
  if (VIDEO_EXTS.includes(ext)) {
    return `<span class="internal-embed video-embed is-loaded" data-href="${escapeAttr(file.path)}"><video controls src="${escapeAttr(url)}"></video></span>`;
  }
  if (ext === 'pdf') {
    return `<span class="internal-embed pdf-embed is-loaded" data-href="${escapeAttr(file.path)}"><iframe src="${escapeAttr(url)}" width="100%" height="480"></iframe></span>`;
  }
  if (ext === 'md') {
    const depth = (env.depth || 0) + 1;
    if (depth > MAX_EMBED_DEPTH) {
      return `<span class="internal-embed markdown-embed">${escapeHtml(file.basename)}</span>`;
    }
    // nested content is rendered asynchronously by the caller's post-process step
    const id = 'embed-' + Math.random().toString(36).slice(2);
    pendingEmbeds.push({ id, path: file.path, subpath, depth });
    // 原版阅读视图 embeds 走 inline-embed 分支（app.css 10955-10966）：标题 + 内容 + 右上角链接按钮
    return `<span class="internal-embed markdown-embed is-loaded inline-embed" data-embed-id="${id}" data-href="${escapeAttr(file.path)}">` +
      `<span class="embed-title markdown-embed-title">${escapeHtml(file.basename)}</span>` +
      `<span class="markdown-embed-content markdown-rendered" data-embed-mount="${id}">…</span>` +
      `<span class="markdown-embed-link" role="button" aria-label="${escapeAttr(file.path)}">${embedLinkIcon()}</span></span>`;
  }
  return `<span class="internal-embed file-embed mod-generic" data-href="${escapeAttr(file.path)}">` +
    `<span class="file-embed-title"><span class="file-embed-icon">${fileEmbedIcon()}</span>${escapeHtml(file.basename)}</span></span>`;
}

let pendingEmbeds = [];

// ---------------------------------------------------------------------------
// Main render entry
// ---------------------------------------------------------------------------
export async function renderMarkdown(app: App, markdown, el, sourcePath, options: Record<string, any> = {}) {
  const signal = options.signal;
  const cancelled = () => ({ el, cancelled: true });
  if (signal?.aborted) return cancelled();
  const stop = () => {
    for (const math of el.querySelectorAll('.math')) cancelMath(math);
    for (const code of el.querySelectorAll('pre > code')) cancelCodeHighlight(code);
    cancelMermaidBlocks(el);
    for (const embedded of el.querySelectorAll('[data-base-embed]')) embedded._baseEmbedCleanup?.();
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const md = getMarkdownIt();
    pendingEmbeds = [];
    const env = { app, sourcePath, depth: options.depth || 0 };
    const html = md.render(markdown, env);
    for (const old of el.querySelectorAll('[data-base-embed]')) old._baseEmbedCleanup?.();
    el.innerHTML = html;
    decorateReadingDom(el);
    const highlighting = highlightCodeBlocks(el);
    addCodeBlockCopyButtons(el);
    const mathematics = renderMathBlocks(el);
    const embeds = pendingEmbeds;
    pendingEmbeds = [];
    for (const emb of embeds) {
      if (signal?.aborted) return cancelled();
      if (emb.kind === 'base') {
        const mount = el.querySelector(`[data-base-embed="${emb.id}"]`);
        const file = app.vault.getFileByPath(emb.path);
        if (mount && file) {
          mount._baseEmbedCleanup = mountBaseEmbed(app, mount, file, { viewName: emb.viewName, sourcePath: emb.sourcePath });
          if (await waitForRender(mount._baseEmbedCleanup.ready, signal) === RENDER_ABORTED) return cancelled();
        }
        continue;
      }
      if (emb.kind === 'canvas') {
        if (await waitForRender(mountCanvasEmbed(app, el, emb), signal) === RENDER_ABORTED) return cancelled();
        continue;
      }
      const mount = el.querySelector(`[data-embed-mount="${emb.id}"]`);
      if (!mount) continue;
      const file = app.vault.getFileByPath(emb.path);
      if (!file) { mount.setText(''); continue; }
      try {
        const text = await waitForRender(app.vault.cachedRead(file), signal);
        if (text === RENDER_ABORTED || signal?.aborted) return cancelled();
        const body = stripFrontmatter(text);
        await renderMarkdown(app, body, mount, file.path, { depth: emb.depth, signal });
        if (signal?.aborted) return cancelled();
        if (emb.subpath) scrollToSubpath(mount.parentElement || mount, emb.subpath);
      } catch (error) { if (!signal?.aborted) console.error('embed failed', error); }
    }
    if (signal?.aborted) return cancelled();
    el.findAll('.block-ref-id').forEach(element => element.detach());
    if (await waitForRender(renderMermaidBlocks(el, { signal }), signal) === RENDER_ABORTED) return cancelled();
    if (await waitForRender(highlighting, signal) === RENDER_ABORTED) return cancelled();
    if (await waitForRender(mathematics, signal) === RENDER_ABORTED) return cancelled();
    if (signal?.aborted) return cancelled();
    annotateHeadings(el);
    annotateBlocks(el);
    return { el };
  } finally { signal?.removeEventListener('abort', stop); }
}

/**
 * 原版阅读 DOM 修正（app.css 12149-12191 / 12984-13003）：
 * 1. 无序列表挂 has-list-bullet，并在每个 li 首位插入 .list-bullet（0.3em 圆点由 CSS 绘制）；
 * 2. 任务项按原版写 data-task / is-checked 并去掉 disabled，复选框因此可点击改源文本。
 */
function decorateReadingDom(el) {
  for (const ul of el.querySelectorAll('ul')) {
    ul.addClass('has-list-bullet');
    for (const li of ul.children) {
      if (li.tagName !== 'LI') continue;
      if (li.querySelector(':scope > .list-bullet')) continue;
      li.insertBefore(createDiv('list-bullet'), li.firstChild);
    }
  }
  for (const li of el.querySelectorAll('li.task-list-item')) {
    const box = li.querySelector(':scope > .task-list-item-checkbox, :scope > p > .task-list-item-checkbox');
    if (!box) continue;
    const done = box.checked || box.hasAttribute('checked');
    box.removeAttribute('disabled');
    li.setAttr('data-task', done ? 'x' : ' ');
    li.toggleClass('is-checked', done);
  }
  // 脚注引用与回跳同挂 .footnote-link（app.css 11091）
  for (const a of el.querySelectorAll('.footnote-ref > a, a.footnote-backref')) a.addClass('footnote-link');
}

/** 原版 post-processor：为每个 pre > code 添加 .copy-code-button（悬停显示，点击复制）。 */
function addCodeBlockCopyButtons(el) {
  for (const code of el.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    if (!pre || pre.querySelector(':scope > .copy-code-button')) continue;
    const button = createEl('button', { cls: 'copy-code-button' });
    setIcon(button, 'lucide-copy');
    button.setAttr('aria-label', tt('interface.menu.copy', '复制'));
    button.onclick = (ev) => {
      ev.preventDefault();
      try { const p = navigator.clipboard.writeText(code.textContent || ''); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    };
    pre.appendChild(button);
  }
}

function annotateHeadings(el) {
  const used = new Set();
  for (const h of el.findAll('h1, h2, h3, h4, h5, h6')) {
    const text = h.textContent;
    let slug = text.toLowerCase().trim().replace(/[^\w\u4e00-\u9fff- ]/g, '').replace(/\s+/g, '-');
    let candidate = slug, i = 1;
    while (used.has(candidate)) candidate = slug + '-' + i++;
    used.add(candidate);
    h.setAttr('data-heading', text);
    h.id = candidate;
    h.addClass('heading');
  }
}

// ---------------------------------------------------------------------------
// Interactivity: clicks inside a rendered markdown container
// ---------------------------------------------------------------------------
export function attachMarkdownInteractions(app: App, container, getSourcePath, options: Record<string, any> = {}) {
  const listen = (type, callback) => container.addEventListener(type, callback, options.signal ? { signal: options.signal } : undefined);
  listen('click', async (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;

    const tagEl = target.closest('.tag[data-tag]');
    if (tagEl) {
      ev.preventDefault();
      openTagSearch(app, tagEl.getAttr('data-tag'));
      return;
    }

    // 笔记嵌块右上角链接按钮：原版 getLeaf(isModEvent) 打开目标文件
    const embedLink = target.closest('.markdown-embed-link');
    if (embedLink) {
      ev.preventDefault();
      const embed = embedLink.closest('.internal-embed[data-href]');
      const href = embed && embed.getAttr('data-href');
      if (href) app.workspace.openLinkText(href, getSourcePath ? getSourcePath() : '', ev.metaKey || ev.ctrlKey ? 'tab' : false);
      return;
    }

    // 通用附件嵌块（.file-embed）单击打开
    const fileEmbed = target.closest('.file-embed[data-href]');
    if (fileEmbed) {
      ev.preventDefault();
      app.workspace.openLinkText(fileEmbed.getAttr('data-href'), getSourcePath ? getSourcePath() : '', false);
      return;
    }

    const link = target.closest('a.internal-link');
    if (link) {
      ev.preventDefault();
      const href = link.getAttr('data-href');
      if (href) {
        const newLeaf = ev.metaKey || ev.ctrlKey ? 'tab' : false;
        app.workspace.openLinkText(href, getSourcePath ? getSourcePath() : '', newLeaf);
      }
      return;
    }

    const ext = target.closest('a.external-link');
    if (ext) {
      ev.preventDefault();
      Desktop.openExternal(ext.getAttribute('href'));
      return;
    }

    // task checkbox toggling
    if (target.classList && target.classList.contains('task-list-item-checkbox')) {
      const cb = target;
      const container2 = cb.closest('.markdown-rendered') || container;
      const checkboxes = Array.from(container2.querySelectorAll('.task-list-item-checkbox'));
      const index = checkboxes.indexOf(cb);
      if (index >= 0) {
        const sourcePath = getSourcePath ? getSourcePath() : '';
        const file = app.vault.getFileByPath(sourcePath);
        if (file) {
          const text = await app.vault.read(file);
          const lines = text.split('\n');
          let count = -1;
          for (let i = 0; i < lines.length; i++) {
            if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(lines[i])) {
              count++;
              if (count === index) {
                const checked = /\[[xX]\]/.test(lines[i]);
                lines[i] = checked ? lines[i].replace(/\[[xX]\]/, '[ ]') : lines[i].replace(/\[[ ]\]/, '[x]');
                await app.vault.modify(file, lines.join('\n'));
                break;
              }
            }
          }
        }
      }
    }
  });

  // callout folding
  listen('click', (ev) => {
    const fold = ev.target.closest && ev.target.closest('.callout-title .callout-fold');
    if (fold) {
      const callout = fold.closest('.callout');
      if (callout) {
        const collapsed = !callout.hasClass('is-collapsed');
        callout.toggleClass('is-collapsed', collapsed);
        fold.toggleClass('is-collapsed', collapsed);
        const content = callout.querySelector(':scope > .callout-content');
        if (content) content.style.display = collapsed ? 'none' : '';
      }
    }
  });

  // 原版阅读视图右键：内部链接 / 外部链接 / 图片（复制图片 + 重置大小 + 删除图片）
  listen('contextmenu', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const sourcePath = getSourcePath ? getSourcePath() : '';
    const img = target.closest('.internal-embed.image-embed img, img.cm-inline-image');
    if (img) {
      ev.preventDefault();
      const menu = app.workspace.buildLinkMenu();
      fillImageContextMenu(app, menu, img, sourcePath, ev);
      menu.showAtMouseEvent(ev);
      return;
    }
    const link = target.closest('a.internal-link');
    if (link) {
      ev.preventDefault();
      const menu = app.workspace.buildLinkMenu();
      app.workspace.handleLinkContextMenu(menu, link.getAttr('data-href'), sourcePath, ev);
      menu.showAtMouseEvent(ev);
      return;
    }
    // 笔记/音频/视频/PDF 嵌块：原版同样挂链接菜单；原版只对链接/标签/图片派发右键，
    // 画布嵌入（.canvas-embed）无右键菜单，故排除。
    const embed = target.closest('.internal-embed[data-href]:not(.image-embed):not(.canvas-embed)');
    if (embed) {
      ev.preventDefault();
      const menu = app.workspace.buildLinkMenu();
      app.workspace.handleLinkContextMenu(menu, embed.getAttr('data-href'), sourcePath, ev);
      menu.showAtMouseEvent(ev);
      return;
    }
    const ext = target.closest('a.external-link');
    if (ext) {
      ev.preventDefault();
      const menu = app.workspace.buildLinkMenu();
      app.workspace.handleExternalLinkContextMenu(menu, ext.getAttribute('href'));
      menu.showAtMouseEvent(ev);
    }
  });
}

function openTagSearch(app: App, tag) {
  const leaf = app.workspace.getLeavesOfType('search')[0];
  if (leaf) {
    leaf.view.setQuery && leaf.view.setQuery(`tag:${tag}`);
    app.workspace.revealLeaf(leaf);
  } else {
    app.workspace.ensureSideLeaf('search', 'left', { state: { query: `tag:${tag}` } });
  }
}

export { escapeHtml, stripFrontmatter };
