/**
 * [INPUT]: vault 文件树、事件、YAML 与 user-ignore 的路径规则判定器。
 * [OUTPUT]: 导出 MetadataCache，提供正文索引、链接解析与 isUserIgnored。
 * [POS]: 库元数据索引。忽略规则统一供数据库与导航消费者调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Metadata cache — parses every markdown file and indexes links, embeds,
 * tags, headings, blocks and frontmatter. Powers backlinks, outgoing links,
 * tags pane, graph view, quick switcher and search.
 */
import { Events } from './events.js';
import { TFile, TFolder } from './vault.js';
import { createUserIgnoreMatcher } from './user-ignore.js';

const yaml = require('js-yaml');

const WIKILINK_RE = /(!?)\[\[([^\[\]]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]]*)\]\(([^()\s]+(?:\s+"[^"]*")?)\)/g;
const TAG_RE = /(?:^|[\s(【（[,;：:])#([\p{L}\p{N}_\-\/]+)/gu;
const HEX_COLOR_RE = /^[0-9a-fA-F]{3,8}$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/;
const BLOCK_ID_RE = /\^([A-Za-z0-9-]+)\s*$/;

export class MetadataCache extends Events {
  declare app: App;
  declare _isUserIgnored: any;
  declare caches: any;
  declare resolvedLinks: any;
  declare unresolvedLinks: any;
  declare _basenameIndex: any;
  declare _aliasIndex: any;
  declare _initialized: boolean;
  declare _parseQueue: any[];
  declare _flushTimer: any;

  constructor(app: App) {
    super();
    this.app = app;
    this._isUserIgnored = createUserIgnoreMatcher(() => {
      const settings = this.app.settings?.appSettings || this.app.settings?.config || {};
      return settings.userIgnoreFilters;
    });
    this.caches = new Map();          // path -> cache
    this.resolvedLinks = {};          // sourcePath -> { destPath: count }
    this.unresolvedLinks = {};        // sourcePath -> { linktext: count }
    this._basenameIndex = new Map();  // lowercase basename -> [paths]
    this._aliasIndex = new Map();     // lowercase alias -> [paths]
    this._initialized = false;
    this._parseQueue = [];
    this._flushTimer = null;
  }

  isUserIgnored(fileOrPath) { return this._isUserIgnored(fileOrPath); }

  async initialize() {
    const files = this.app.vault.getMarkdownFiles();
    let i = 0;
    const chunk = async () => {
      const start = Date.now();
      while (i < files.length && Date.now() - start < 40) {
        const file = files[i++];
        await this.parseFile(file, true);
      }
      if (i < files.length) {
        setTimeout(chunk, 0);
      } else {
        this.rebuildIndices();
        this._initialized = true;
        this.trigger('resolved');
      }
    };
    await chunk();
  }

  rebuildIndices() {
    this._basenameIndex.clear();
    this._aliasIndex.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const key = file.basename.toLowerCase();
      if (!this._basenameIndex.has(key)) this._basenameIndex.set(key, []);
      this._basenameIndex.get(key).push(file.path);
      const cache = this.caches.get(file.path);
      if (cache && cache.aliases) {
        for (const alias of cache.aliases) {
          const akey = String(alias).toLowerCase();
          if (!this._aliasIndex.has(akey)) this._aliasIndex.set(akey, []);
          this._aliasIndex.get(akey).push(file.path);
        }
      }
    }
    this.rebuildLinkResolution();
  }

  rebuildLinkResolution() {
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    for (const [path, cache] of this.caches) {
      const resolved = {};
      const unresolved = {};
      const allLinks = [...(cache.links || []), ...(cache.embeds || [])];
      for (const link of allLinks) {
        const dest = this.getFirstLinkpathDest(link.link, path, true);
        if (dest) resolved[dest] = (resolved[dest] || 0) + 1;
        else {
          const key = link.link;
          unresolved[key] = (unresolved[key] || 0) + 1;
        }
      }
      if (Object.keys(resolved).length) this.resolvedLinks[path] = resolved;
      if (Object.keys(unresolved).length) this.unresolvedLinks[path] = unresolved;
    }
    this.trigger('resolved');
  }

  async parseFile(file, silent = false) {
    let text = '';
    try { text = await this.app.vault.cachedRead(file); }
    catch (e) { return; }
    const cache = parseMarkdown(text, file);
    this.caches.set(file.path, cache);
    if (!silent) {
      // update indices for single file
      const key = file.basename.toLowerCase();
      if (!this._basenameIndex.has(key)) this._basenameIndex.set(key, []);
      const arr = this._basenameIndex.get(key);
      if (!arr.includes(file.path)) arr.push(file.path);
      if (cache.aliases) for (const alias of cache.aliases) {
        const akey = String(alias).toLowerCase();
        if (!this._aliasIndex.has(akey)) this._aliasIndex.set(akey, []);
        const aarr = this._aliasIndex.get(akey);
        if (!aarr.includes(file.path)) aarr.push(file.path);
      }
      this.scheduleResolution();
      this.trigger('changed', file, text, cache);
    }
  }

  scheduleResolution() {
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.rebuildLinkResolution(), 150);
  }

  onFileModify(file) {
    if (file.extension === 'md') this.parseFile(file).catch((e) => console.error(e));
    else this.trigger('changed', file);
  }

  onFileDelete(file) {
    this.caches.delete(file.path);
    this._basenameIndex.forEach((arr, key) => {
      const i = arr.indexOf(file.path);
      if (i >= 0) arr.splice(i, 1);
    });
    this._aliasIndex.forEach((arr) => {
      const i = arr.indexOf(file.path);
      if (i >= 0) arr.splice(i, 1);
    });
    this.scheduleResolution();
  }

  onFileRename(file, oldPath) {
    const cache = this.caches.get(oldPath);
    if (cache) {
      this.caches.delete(oldPath);
      this.caches.set(file.path, cache);
    }
    for (const index of [this._basenameIndex, this._aliasIndex]) {
      index.forEach((arr) => {
        const i = arr.indexOf(oldPath);
        if (i >= 0) arr[i] = file.path;
      });
    }
    // 不迁移 resolvedLinks 的旧键：链接文本是否更新由 FileManager 决定（对齐原版语义）。
    // 更新过链接的源文件会因 vault.modify 触发重新解析，自然得到新路径。
    this.scheduleResolution();
  }

  getCache(path) {
    if (path instanceof TFile) path = path.path;
    return this.caches.get(path) || null;
  }

  getFileCache(file) { return this.getCache(file.path); }

  getFirstLinkpathDest(linkpath, sourcePath, fromCache = false) {
    if (!linkpath) return null;
    let link = String(linkpath).split('|')[0];
    link = link.split('#')[0].split('^')[0];
    link = link.trim();
    if (!link) {
      // same-file reference like [[#heading]]
      if (sourcePath) {
        const self = this.app.vault.getFileByPath(sourcePath);
        return self ? self.path : null;
      }
      return null;
    }
    link = link.replace(/\\/g, '/');
    const clean = link.replace(/^\.\//, '');

    const candidates = [];
    const hasExt = /\.[a-z0-9]+$/i.test(clean);
    if (hasExt) candidates.push(clean);
    else candidates.push(clean + '.md', clean);

    // 1) direct vault path
    for (const c of candidates) {
      const f = this.app.vault.getFileByPath(c);
      if (f) return f.path;
    }
    // 2) relative to source file's folder
    if (sourcePath && clean.startsWith('.')) {
      const baseDir = sourcePath.split('/').slice(0, -1).join('/');
      const rel = normalizeJoin(baseDir, clean);
      for (const c of (hasExt ? [rel] : [rel + '.md', rel])) {
        const f = this.app.vault.getFileByPath(c);
        if (f) return f.path;
      }
    }
    // 3) basename index (last path segment)
    const base = clean.split('/').pop().toLowerCase();
    let arr = this._basenameIndex.get(hasExt ? base : base);
    if (!arr) {
      const withoutExt = base.replace(/\.md$/i, '');
      arr = this._basenameIndex.get(withoutExt);
    }
    if (arr && arr.length) {
      if (arr.length === 1) return arr[0];
      // prefer same folder as source, then shortest, then alphabetical
      const srcFolder = sourcePath ? sourcePath.split('/').slice(0, -1).join('/') : '';
      const sameFolder = arr.filter((p) => p.split('/').slice(0, -1).join('/') === srcFolder);
      const pool = sameFolder.length ? sameFolder : arr;
      const sorted = [...pool].sort((a, b) => {
        const da = a.split('/').length, db = b.split('/').length;
        if (da !== db) return da - db;
        return a.localeCompare(b);
      });
      return sorted[0];
    }
    // 4) alias index
    const aliasArr = this._aliasIndex.get(base);
    if (aliasArr && aliasArr.length) return aliasArr[0];
    return null;
  }

  getBacklinksForFile(file) {
    const target = file.path;
    const result = new Map(); // sourcePath -> count
    for (const [source, links] of Object.entries(this.resolvedLinks)) {
      if (source === target) continue;
      if (links[target]) result.set(source, links[target]);
    }
    const backlinks = {};
    for (const [source, count] of result) {
      const srcFile = this.app.vault.getFileByPath(source);
      if (srcFile instanceof TFile) backlinks[source] = { link: srcFile, count };
    }
    // unresolved links that match this file's basename
    const unresolved = {};
    const key = file.basename.toLowerCase();
    for (const [source, links] of Object.entries(this.unresolvedLinks)) {
      for (const [text, count] of Object.entries(links)) {
        const clean = text.split('|')[0].split('#')[0].trim().toLowerCase();
        const base = clean.split('/').pop();
        if (base === key) {
          if (!unresolved[source]) unresolved[source] = {};
          unresolved[source][text] = count;
        }
      }
    }
    return { backlinks, unresolved, resolved: this.resolvedLinks };
  }

  getUnlinkedMentions(file) {
    // files that mention the basename/alias but don't link
    const names = new Set([file.basename]);
    const cache = this.getCache(file.path);
    if (cache && cache.aliases) for (const a of cache.aliases) names.add(String(a));
    const out = [];
    for (const [path, c] of this.caches) {
      if (path === file.path) continue;
      const linked = this.resolvedLinks[path] && this.resolvedLinks[path][file.path];
      if (linked) continue;
      const text = c._rawText || '';
      for (const name of names) {
        const idx = text.indexOf(name);
        if (idx >= 0) { out.push({ file: this.app.vault.getFileByPath(path), name }); break; }
      }
    }
    return out;
  }

  getTags() {
    const counts = {};
    for (const [, cache] of this.caches) {
      for (const tag of cache.tags || []) {
        const key = tag.tag;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }

  getFilesWithTag(tag) {
    const out = [];
    const needle = tag.startsWith('#') ? tag : '#' + tag;
    for (const [path, cache] of this.caches) {
      for (const tagEntry of cache.tags || []) {
        if (tagEntry.tag === needle || tagEntry.tag.startsWith(needle + '/')) {
          const f = this.app.vault.getFileByPath(path);
          if (f) out.push(f);
          break;
        }
      }
    }
    return out;
  }

  getCachedFiles() {
    const out = [];
    for (const [path, cache] of this.caches) {
      const f = this.app.vault.getFileByPath(path);
      if (f) out.push({ file: f, cache });
    }
    return out;
  }

  getAliases(file) {
    const cache = this.getCache(file.path);
    return cache && cache.aliases ? cache.aliases : [];
  }

  isInitialized() { return this._initialized; }
}

function normalizeJoin(dir, rel) {
  const parts = (dir ? dir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------
export function parseMarkdown(text, file) {
  const lines = text.split('\n');
  const cache: Record<string, any> = {
    file, _rawText: text,
    frontmatter: {}, aliases: [], tags: [], headings: [], links: [], embeds: [],
    sections: [], blocks: {},
    position: null,
  };
  let i = 0;
  // frontmatter
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    let end = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === '---' || lines[j].trim() === '...') { end = j; break; }
    }
    if (end > 0) {
      const fmText = lines.slice(1, end).join('\n');
      try {
        const fm = yaml.load(fmText);
        if (fm && typeof fm === 'object') {
          cache.frontmatter = fm;
          if (fm.aliases) {
            if (Array.isArray(fm.aliases)) cache.aliases = fm.aliases.map(String);
            else cache.aliases = [String(fm.aliases)];
          }
          if (fm.tags) {
            const tags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags).split(/[,\s]+/);
            for (const tag of tags) {
              if (!tag) continue;
              const t = '#' + String(tag).replace(/^#/, '').trim();
              if (t.length > 1) cache.tags.push({ tag: t, position: { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } }, frontmatter: true });
            }
          }
          if (fm.cssclasses) { /* handled by renderer */ }
        }
      } catch (e) {
        cache.frontmatterError = String(e.message || e);
      }
      cache.frontmatterPosition = {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: end, col: lines[end].length, offset: lines.slice(0, end + 1).join('\n').length },
      };
      i = end + 1;
    }
  }

  // offsets per line
  const lineOffsets = [];
  {
    let off = 0;
    for (const line of lines) { lineOffsets.push(off); off += line.length + 1; }
  }

  let inFence = false;
  let fenceMarker = '';
  let sectionStart = null;
  let currentSection = { type: 'paragraph', position: null };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = lineOffsets[i];

    // fenced code blocks
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/);
    if (fenceMatch) {
      if (!inFence) { inFence = true; fenceMarker = fenceMatch[1][0]; }
      else if (fenceMatch[1][0] === fenceMarker) { inFence = false; fenceMarker = ''; }
      continue;
    }
    if (inFence) continue;

    // headings
    const hm = line.match(HEADING_RE);
    if (hm) {
      cache.headings.push({
        heading: hm[2],
        level: hm[1].length,
        position: {
          start: { line: i, col: 0, offset: lineStart },
          end: { line: i, col: line.length, offset: lineStart + line.length },
        },
      });
      continue;
    }

    // block ids
    const bm = line.match(BLOCK_ID_RE);
    if (bm) {
      cache.blocks[bm[1]] = {
        id: bm[1],
        position: {
          start: { line: i, col: 0, offset: lineStart },
          end: { line: i, col: line.length, offset: lineStart + line.length },
        },
      };
      continue;
    }

    // inline code spans are stripped before link/tag scanning
    const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

    // wiki links & embeds
    WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = WIKILINK_RE.exec(stripped))) {
      const isEmbed = match[1] === '!';
      const inner = match[2];
      const idxInLine = match.index + (isEmbed ? 1 : 0);
      const parts = inner.split('|');
      const linktext = parts[0].trim();
      const displayText = parts.length > 1 ? parts.slice(1).join('|').trim() : undefined;
      let link = linktext;
      let subpath = undefined;
      {
        const hashIdx = linktext.indexOf('#');
        if (hashIdx >= 0) { subpath = linktext.slice(hashIdx + 1); link = linktext.slice(0, hashIdx); }
      }
      const entry = {
        link, displayText, original: match[0], subpath,
        position: {
          start: { line: i, col: idxInLine, offset: lineStart + idxInLine },
          end: { line: i, col: idxInLine + match[0].length, offset: lineStart + idxInLine + match[0].length },
        },
      };
      if (isEmbed) cache.embeds.push(entry);
      else cache.links.push(entry);
    }

    // markdown links (external or internal)
    MDLINK_RE.lastIndex = 0;
    while ((match = MDLINK_RE.exec(stripped))) {
      const isEmbed = match[1] === '!';
      let url = match[3];
      const titleMatch = url.match(/\s+"[^"]*"$/);
      if (titleMatch) url = url.slice(0, -titleMatch[0].length);
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) continue; // external protocol
      const idxInLine = match.index + (isEmbed ? 1 : 0);
      const entry = {
        link: url,
        displayText: match[2] || undefined,
        original: match[0],
        isExternal: /^[a-z][a-z0-9+.-]*:/i.test(url),
        position: {
          start: { line: i, col: idxInLine, offset: lineStart + idxInLine },
          end: { line: i, col: idxInLine + match[0].length, offset: lineStart + idxInLine + match[0].length },
        },
      };
      if (isEmbed) cache.embeds.push(entry);
      else cache.links.push(entry);
    }

    // tags
    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(stripped))) {
      const tagBody = match[1];
      if (!tagBody || HEX_COLOR_RE.test(tagBody)) continue;
      if (/^#?\d+$/.test(tagBody)) continue;
      const tagText = '#' + tagBody;
      const idxInLine = match.index + match[0].indexOf('#');
      // skip if inside an already-recorded link
      cache.tags.push({
        tag: tagText,
        position: {
          start: { line: i, col: idxInLine, offset: lineStart + idxInLine },
          end: { line: i, col: idxInLine + tagText.length, offset: lineStart + idxInLine + tagText.length },
        },
      });
    }
  }
  return cache;
}

export function parseFrontmatterText(text) {
  const lines = text.split('\n');
  if (lines[0] === undefined || lines[0].trim() !== '---') return { frontmatter: {}, body: text, startLine: -1, endLine: -1 };
  for (let j = 1; j < lines.length; j++) {
    if (lines[j].trim() === '---' || lines[j].trim() === '...') {
      try {
        const fm = yaml.load(lines.slice(1, j).join('\n'));
        return {
          frontmatter: (fm && typeof fm === 'object') ? fm : {},
          body: lines.slice(j + 1).join('\n'),
          startLine: 0, endLine: j,
          rawFrontmatter: lines.slice(1, j).join('\n'),
        };
      } catch (e) {
        return { frontmatter: {}, body: text, startLine: 0, endLine: j, error: e };
      }
    }
  }
  return { frontmatter: {}, body: text, startLine: -1, endLine: -1 };
}
