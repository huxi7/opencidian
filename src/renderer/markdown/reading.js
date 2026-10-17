/**
 * [INPUT]: 依赖 markdown-it、footnote/task-lists、Desktop、图标和 vault 路径；代码块委托 highlight.js，公式委托 math.js。
 * [OUTPUT]: 导出 getMarkdownIt、renderMarkdown、attachMarkdownInteractions、stripFrontmatter、scrollToSubpath、resolvePath、resolveFileUrl、parseFrontmatterText 之外的 escapeHtml
 * [POS]: markdown/ 的阅读视图渲染器，被 markdown-view.js（阅读模式）与 live-preview.js（块级 widget 内嵌 HTML）共同调用。callout 渲染为 div.callout（原版 DOM 非 blockquote），核心规则挂在 core.ruler 的 inline 之后。
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
import { codeLanguageName, highlightCodeBlocks } from './highlight.js';
import { renderMathBlocks } from './math.js';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'opus'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'mov', 'mkv'];
const MAX_EMBED_DEPTH = 5;

let mdInstance = null;
let mermaidInstance = null;

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
    const alt = token.content || '';
    let resolved = src;
    if (!/^(https?|data|app):/i.test(src)) {
      resolved = resolveFileUrl(env.app, decodeURIComponent(src), env.sourcePath) || src;
    }
    const cls = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(src) ? 'internal-embed image-embed' : '';
    return `<span class="${cls}"><img src="${escapeAttr(resolved)}" alt="${escapeAttr(alt)}" class="cm-inline-image"></span>`;
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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
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
      return renderEmbed(env, target, subpath, alias);
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
      const titleToken = new state.Token('html_block', '', 0);
      titleToken.block = true;
      titleToken.content = `<div class="callout-title" data-callout-title="${escapeAttr(type)}"><div class="callout-icon">${calloutIcon(type)}</div><div class="callout-title-inner">${escapeHtml(title || defaultCalloutTitle(type))}</div>${fold ? `<div class="callout-fold${fold === '-' ? ' is-collapsed' : ''}">${calloutFoldIcon()}</div>` : ''}</div><div class="callout-content"${fold === '-' ? ' style="display: none;"' : ''}>`;
      const closeToken = new state.Token('html_block', '', 0);
      closeToken.block = true;
      closeToken.content = '</div>';
      let insertAt = i + 1;
      if (first.content.trim() === '' && inline.children.length === 1) {
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

function defaultCalloutTitle(type) {
  const names = {
    note: 'Note', abstract: 'Abstract', summary: 'Summary', tldr: 'Tldr', info: 'Info', todo: 'Todo',
    tip: 'Tip', hint: 'Hint', important: 'Important', success: 'Success', check: 'Check', done: 'Done',
    question: 'Question', help: 'Help', faq: 'Faq', warning: 'Warning', caution: 'Caution', attention: 'Attention',
    failure: 'Failure', fail: 'Fail', missing: 'Missing', danger: 'Danger', error: 'Error', bug: 'Bug',
    example: 'Example', quote: 'Quote', cite: 'Cite',
  };
  return names[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function calloutIcon(type) {
  const icons = {
    note: 'pencil', abstract: 'clipboard-list', info: 'info', todo: 'check-circle-2', tip: 'flame',
    success: 'check', question: 'help-circle', warning: 'alert-triangle', failure: 'x', danger: 'zap',
    bug: 'bug', example: 'list', quote: 'quote',
  };
  const name = icons[type] || 'pencil';
  try {
    const svg = createIcon(name);
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

export function resolveFileUrl(app, target, sourcePath) {
  const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath, true);
  const file = dest && app.vault.getFileByPath(dest);
  if (file) return app.vault.adapter.getResourcePath(file.path);
  return null;
}

function renderEmbed(env, target, subpath, alias) {
  const app = env.app;
  if (!app) return `<span>${escapeHtml(target)}</span>`;
  const dest = app.metadataCache.getFirstLinkpathDest(target, env.sourcePath, true);
  const file = dest && app.vault.getFileByPath(dest);
  if (!file) {
    return `<span class="internal-embed is-unresolved">${escapeHtml(target)}</span>`;
  }
  const ext = file.extension;
  const url = app.vault.adapter.getResourcePath(file.path);
  if (IMAGE_EXTS.includes(ext)) {
    return `<span class="internal-embed image-embed is-loaded"><img src="${escapeAttr(url)}" alt="${escapeAttr(alias || file.basename)}"></span>`;
  }
  if (AUDIO_EXTS.includes(ext)) {
    return `<span class="internal-embed audio-embed is-loaded"><audio controls src="${escapeAttr(url)}"></audio></span>`;
  }
  if (VIDEO_EXTS.includes(ext)) {
    return `<span class="internal-embed video-embed is-loaded"><video controls src="${escapeAttr(url)}"></video></span>`;
  }
  if (ext === 'pdf') {
    return `<span class="internal-embed pdf-embed is-loaded"><iframe src="${escapeAttr(url)}" width="100%" height="480"></iframe></span>`;
  }
  if (ext === 'md') {
    const depth = (env.depth || 0) + 1;
    if (depth > MAX_EMBED_DEPTH) {
      return `<span class="internal-embed markdown-embed">${escapeHtml(file.basename)}</span>`;
    }
    // nested content is rendered asynchronously by the caller's post-process step
    const id = 'embed-' + Math.random().toString(36).slice(2);
    pendingEmbeds.push({ id, path: file.path, subpath, depth });
    return `<span class="internal-embed markdown-embed is-loaded" data-embed-id="${id}">` +
      `<span class="markdown-embed-title">${escapeHtml(file.basename)}</span>` +
      `<span class="markdown-embed-content markdown-rendered" data-embed-mount="${id}">…</span></span>`;
  }
  return `<span class="internal-embed"><a class="internal-link" data-href="${escapeAttr(file.path)}" href="javascript:void(0)">${escapeHtml(file.basename)}</a></span>`;
}

let pendingEmbeds = [];

// ---------------------------------------------------------------------------
// Main render entry
// ---------------------------------------------------------------------------
export async function renderMarkdown(app, markdown, el, sourcePath, options = {}) {
  const md = getMarkdownIt();
  pendingEmbeds = [];
  const env = { app, sourcePath, depth: options.depth || 0 };
  let html = md.render(markdown, env);
  el.innerHTML = html;
  const highlighting = highlightCodeBlocks(el);
  addCodeBlockCopyButtons(el);
  const mathematics = renderMathBlocks(el);

  // nested embeds
  const embeds = pendingEmbeds;
  pendingEmbeds = [];
  for (const emb of embeds) {
    const mount = el.querySelector(`[data-embed-mount="${emb.id}"]`);
    if (!mount) continue;
    const file = app.vault.getFileByPath(emb.path);
    if (!file) { mount.setText(''); continue; }
    try {
      const text = await app.vault.cachedRead(file);
      // strip frontmatter
      const body = stripFrontmatter(text);
      await renderMarkdown(app, body, mount, file.path, { depth: emb.depth });
      if (emb.subpath) scrollToSubpath(mount.parentElement || mount, emb.subpath);
    } catch (e) { console.error('embed failed', e); }
  }

  // block refs: remove trailing ^id
  el.findAll('.block-ref-id').forEach((e) => e.detach());

  // mermaid diagrams
  await renderMermaidBlocks(el);
  await highlighting;
  await mathematics;

  // annotate headings for subpath navigation
  annotateHeadings(el);

  return { el };
}

/**
 * 渲染容器内所有 .mermaid-source 节点为图表（阅读视图与实时预览共用）。
 * 惰性加载 mermaid（首次调用时 initialize，主题跟随 body.theme-dark）。
 */
export async function renderMermaidBlocks(el) {
  const mermaidEls = el.findAll ? el.findAll('.mermaid-source') : el.querySelectorAll('.mermaid-source');
  if (!mermaidEls.length) return;
  try {
    if (!mermaidInstance) {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, theme: document.body.hasClass('theme-dark') ? 'dark' : 'default', securityLevel: 'loose' });
      mermaidInstance = mermaid;
    }
    let i = 0;
    for (const src of mermaidEls) {
      const code = src.getAttr('data-source') || '';
      try {
        const { svg } = await mermaidInstance.render('mermaid-' + Date.now() + '-' + (i++), code);
        src.innerHTML = svg;
        src.addClass('mermaid');
        src.removeClass('mermaid-source');
      } catch (e) {
        src.addClass('mermaid-error');
      }
    }
  } catch (e) { console.error('mermaid load failed', e); }
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

export function stripFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] === undefined || lines[0].trim() !== '---') return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') return lines.slice(i + 1).join('\n');
  }
  return text;
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

export function scrollToSubpath(container, subpath) {
  if (!subpath) return false;
  const target = subpath.trim();
  // block ref: ^id
  if (target.startsWith('^')) {
    const id = target.slice(1);
    const el = container.querySelector(`[id="${cssEscape(id)}"]`) || container.querySelector(`[data-block-id="${cssEscape(id)}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); return true; }
  }
  // heading: exact text match first, then slug-ish
  const heading = Array.from(container.querySelectorAll('[data-heading]')).find((h) => h.getAttr('data-heading').toLowerCase() === target.toLowerCase())
    || Array.from(container.querySelectorAll('[data-heading]')).find((h) => h.getAttr('data-heading').toLowerCase().includes(target.toLowerCase()));
  if (heading) {
    heading.scrollIntoView({ block: 'start' });
    heading.addClass('is-flashing');
    setTimeout(() => heading.removeClass('is-flashing'), 1500);
    return true;
  }
  return false;
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Interactivity: clicks inside a rendered markdown container
// ---------------------------------------------------------------------------
export function attachMarkdownInteractions(app, container, getSourcePath) {
  container.addEventListener('click', async (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;

    const tagEl = target.closest('.tag[data-tag]');
    if (tagEl) {
      ev.preventDefault();
      openTagSearch(app, tagEl.getAttr('data-tag'));
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
  container.addEventListener('click', (ev) => {
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
}

function openTagSearch(app, tag) {
  const leaf = app.workspace.getLeavesOfType('search')[0];
  if (leaf) {
    leaf.view.setQuery && leaf.view.setQuery(`tag:${tag}`);
    app.workspace.revealLeaf(leaf);
  } else {
    app.workspace.ensureSideLeaf('search', 'left', { state: { query: `tag:${tag}` } });
  }
}

export { escapeHtml };
