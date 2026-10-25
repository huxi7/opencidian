/**
 * [INPUT]: 依赖 app.vault / app.metadataCache / app.settings 的文件、标题、块与别名索引；依赖 core/suggest.js 的 fuzzyMatch；依赖 core/i18n.js 的 t。
 * [OUTPUT]: 导出 buildLinkContext、collectLinkSuggestions、buildLinkInsertion、linkTextForFile、sanitizeHeading、emptyItem、noMatchLabel。
 * [POS]: editor/ 的 [[链接]] 补全数据层。link-suggest.js 只负责浮窗 DOM、键盘与定位；本文件不创建节点。
 *        模式与原版 EditorSuggest 一致：file / heading / block / display；文件项含别名与未创建的 linktext，空结果返回 type=none 的“未找到匹配结果”项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { fuzzyMatch } from '../core/suggest.js';
import { t } from '../core/i18n.js';

const NONE_TYPE = 'none';

/** 原版 trigger 的触发范围：同一行、光标前最后一个 [[ 之后，且其后没有 ]。 */
export function buildLinkContext(view) {
  const selection = view.state.selection.main;
  if (!selection.empty) return null;
  const head = selection.head;
  const line = view.state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  if (before.lastIndexOf(']') > open) return null;
  return {
    start: line.from + open + 2,
    end: head,
    query: before.slice(open + 2),
    lineFrom: line.from,
    lineTo: line.to,
    lineText: line.text,
  };
}

/** 原版 CT：第一个 # 之前是链接路径，之后（含 #）是子路径。 */
export function splitSubpath(text) {
  const index = text.indexOf('#');
  if (index < 0) return { path: text, subpath: '' };
  return { path: text.slice(0, index), subpath: text.slice(index) };
}

/** 原版 PT：标题写入链接前清掉分隔符并压缩空白。 */
export function sanitizeHeading(heading) {
  return String(heading || '')
    .replace(/[:#|^\\\r\n]|%%|\[\[|\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fullPath(file) {
  return file.extension === 'md' ? file.path.replace(/\.md$/i, '') : file.path;
}

function pathBasename(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

function pathFolder(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index + 1);
}

function relativeLinkPath(fromDir, target) {
  const from = fromDir ? fromDir.split('/') : [];
  const to = target.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
  const up = from.slice(common).map(() => '..');
  return up.concat(to.slice(common)).join('/');
}

/** 原版 fileToLinktext 的最短路径策略：唯一 basename 用文件名，其余按 newLinkFormat。 */
export function linkTextForFile(app: App, file, sourcePath = '') {
  const settings = (app.settings && app.settings.appSettings) || {};
  const format = settings.newLinkFormat || 'shortest';
  const isMarkdown = file.extension === 'md';
  if (format === 'absolute' || !sourcePath) {
    return isMarkdown ? file.path.replace(/\.md$/i, '') : file.path;
  }
  const key = file.basename.toLowerCase();
  const candidates = app.metadataCache && app.metadataCache._basenameIndex
    ? app.metadataCache._basenameIndex.get(key) : null;
  const unique = !candidates || candidates.length <= 1;
  if (format === 'shortest' && unique) return isMarkdown ? file.basename : file.name;
  if (format === 'relative') {
    const sourceDir = sourcePath.split('/').slice(0, -1).join('/');
    const relative = relativeLinkPath(sourceDir, file.path);
    return isMarkdown ? relative.replace(/\.md$/i, '') : relative;
  }
  // shortest 且 basename 不唯一：原版回退到库内完整路径（不写相对路径）
  return isMarkdown ? file.path.replace(/\.md$/i, '') : file.path;
}

/** 原版 isUserIgnored：路径前缀或 /正则/；命中的文件降权而不是隐藏。 */
function compileIgnoreRules(app: App) {
  const values = ((app.settings && app.settings.appSettings) || {}).userIgnoreFilters || [];
  return values.flatMap((value) => {
    const rule = String(value).trim();
    if (!rule) return [];
    try {
      return [rule.length > 2 && rule.startsWith('/') && rule.endsWith('/')
        ? new RegExp(rule.slice(1, -1), 'i')
        : new RegExp('^' + rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')];
    } catch (error) {
      return [];
    }
  });
}

function isIgnored(rules, path) {
  return rules.some((rule) => {
    rule.lastIndex = 0;
    return rule.test(path);
  });
}

function mtimeOf(file) {
  return (file && file.stat && Number(file.stat.mtime)) || 0;
}

function noneItem() {
  return { type: NONE_TYPE, matches: null, score: 0 };
}

function baseFileItem(app: App, file, sourcePath, rules) {
  const path = fullPath(file);
  return {
    type: 'file',
    file,
    path,
    linkText: linkTextForFile(app, file, sourcePath),
    title: pathBasename(path),
    note: pathFolder(path),
    score: mtimeOf(file),
    matches: null,
    downranked: isIgnored(rules, file.path),
  };
}

function aliasItems(app: App, file, sourcePath, rules) {
  const aliases = app.metadataCache ? app.metadataCache.getAliases(file) : [];
  if (!aliases.length) return null;
  const path = fullPath(file);
  return aliases.map((alias) => ({
    type: 'alias',
    file,
    path,
    linkText: linkTextForFile(app, file, sourcePath),
    alias: String(alias),
    title: String(alias),
    note: path,
    score: mtimeOf(file),
    matches: null,
    downranked: isIgnored(rules, file.path),
  }));
}

/** 文件模式：文件与 frontmatter 别名同列；空查询按 mtime 倒序（原版）。 */
function collectFiles(app: App, query, sourcePath) {
  const rules = compileIgnoreRules(app);
  const files = app.vault.getFiles().filter((file) => {
    if (!file || file.extension === undefined) return false;
    // 配置目录与隐藏目录不进入链接候选（原版 getLinkSuggestions 同语义）
    if (file.path.startsWith('.') || file.path.includes('/.')) return false;
    return true;
  });
  const entries = [];
  for (const file of files) {
    entries.push(baseFileItem(app, file, sourcePath, rules));
    const aliases = aliasItems(app, file, sourcePath, rules);
    if (aliases) entries.push(...aliases);
  }
  // 原版 getLinkSuggestions 的 linktext：库里被引用但尚未创建的目标也参与补全
  const unresolved = new Map();
  const unresolvedLinks = (app.metadataCache && app.metadataCache.unresolvedLinks) || {};
  for (const links of Object.values(unresolvedLinks)) {
    for (const linktext of Object.keys(links || {})) {
      const path = String(linktext).split('|')[0].split('#')[0].trim();
      if (path) unresolved.set(path, true);
    }
  }
  for (const path of unresolved.keys()) {
    entries.push({
      type: 'linktext', file: null, path, title: path, note: '', linkText: path,
      score: 0, matches: null,
    });
  }
  const trimmed = query.trim();
  if (!trimmed) {
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, 100);
  }
  const matches = [];
  for (const entry of entries) {
    let match = fuzzyMatch(trimmed, entry.title);
    if (match) {
      entry.matches = match.matches;
    } else {
      match = fuzzyMatch(trimmed, entry.path);
      if (match) {
        match.score -= 1;
        if (entry.type === 'file') {
          // 原版 Dy：路径命中时把区间平移给标题，落在目录部分的区间留给 note
          const folderLength = entry.path.length - entry.title.length;
          const noteMatches = match.matches.filter((index) => index < folderLength);
          const titleMatches = match.matches
            .map((index) => index - folderLength)
            .filter((index) => index >= 0 && index < entry.title.length);
          entry.matches = titleMatches.length ? titleMatches : null;
          entry.noteMatches = noteMatches.length ? noteMatches : null;
        } else {
          entry.matches = null;
        }
      }
    }
    if (!match) continue;
    entry.score = match.score + (entry.downranked ? -10 : 0);
    matches.push(entry);
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 100);
}

function linkTextForSubpath(app: App, file, sourcePath) {
  if (file && sourcePath && file.path === sourcePath) return '';
  return linkTextForFile(app, file, sourcePath);
}

/**
 * 原版 VI 的标题层级匹配：最后一段模糊匹配标题，之前的段必须按文档顺序命中祖先。
 * 返回的 subpath 含前缀（[[A#B]] 的 "#A#B"）。
 */
function collectLocalHeadingItems(app: App, file, subpath, sourcePath) {
  const cache = app.metadataCache.getFileCache(file);
  const headings = (cache && cache.headings) || [];
  const raw = subpath.startsWith('#') ? subpath.slice(1) : subpath;
  const segments = raw.split('#').filter((segment) => !!segment);
  if (raw.endsWith('#')) segments.push('');
  if (!segments.length) segments.push('');
  const prefix = '#' + segments.slice(0, -1).join('#') + (segments.length > 1 ? '#' : '');
  const items = [];
  let matched = 0;
  let parentLevel = 0;
  for (const heading of headings) {
    if (heading.level <= parentLevel || matched >= segments.length) break;
    const segment = segments[matched];
    if (matched === segments.length - 1) {
      if (!segment) {
        items.push({
          type: 'heading', file, path: fullPath(file), linkText: linkTextForSubpath(app, file, sourcePath),
          heading: heading.heading, level: heading.level,
          subpath: prefix + sanitizeHeading(heading.heading), matches: null, score: 0,
        });
      } else {
        const match = fuzzyMatch(segment, heading.heading);
        if (match) {
          items.push({
            type: 'heading', file, path: fullPath(file), linkText: linkTextForSubpath(app, file, sourcePath),
            heading: heading.heading, level: heading.level,
            subpath: prefix + sanitizeHeading(heading.heading), matches: match.matches, score: match.score,
          });
        }
      }
    } else if (heading.heading.toLowerCase() === segment.toLowerCase()) {
      matched += 1;
      parentLevel = heading.level;
    }
  }
  items.sort((a, b) => b.score - a.score);
  if (items.length) return items;
  // 原版 fallback：把用户输入原样作为标题项，标题为空时渲染“小标题”
  const typed = raw;
  return [{
    type: 'heading', file, path: fullPath(file), linkText: linkTextForSubpath(app, file, sourcePath),
    heading: typed, level: 0, subpath, matches: null, score: 0, fallback: true,
  }];
}

function collectGlobalHeadingItems(app: App, query, sourcePath) {
  const rules = compileIgnoreRules(app);
  const items = [];
  const trimmed = query.trim();
  for (const file of app.vault.getMarkdownFiles()) {
    if (isIgnored(rules, file.path)) continue;
    const cache = app.metadataCache.getFileCache(file);
    if (!cache || !cache.headings) continue;
    for (const heading of cache.headings) {
      let match = null;
      if (!trimmed) match = { score: 0, matches: null };
      else match = fuzzyMatch(trimmed, heading.heading);
      if (!match) continue;
      const path = fullPath(file);
      items.push({
        type: 'heading', file, path, linkText: linkTextForSubpath(app, file, sourcePath),
        note: path, heading: heading.heading, level: heading.level,
        subpath: '#' + sanitizeHeading(heading.heading), matches: match.matches, score: match.score,
      });
    }
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, 100);
}

function blockDisplay(cache, block) {
  const raw = (cache && cache._rawText) || '';
  const line = block && block.position && block.position.start ? raw.split('\n')[block.position.start.line] : '';
  const id = block && block.id;
  let text = String(line || '');
  if (id) text = text.replace(new RegExp('\\^' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '');
  text = text.replace(/^\s*(?:>\s*)*/, '').replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim();
  return text || (id ? String(id) : '');
}

function collectLocalBlockItems(app: App, file, blockQuery, sourcePath) {
  const cache = app.metadataCache.getFileCache(file);
  const blocks = (cache && cache.blocks) || {};
  const trimmed = blockQuery.trim();
  const items = [];
  for (const id of Object.keys(blocks)) {
    const display = blockDisplay(cache, blocks[id]);
    const displayMatch = trimmed ? fuzzyMatch(trimmed, display) : { score: 0, matches: null };
    const idMatch = trimmed ? fuzzyMatch(trimmed, id) : null;
    if (!displayMatch && !idMatch) continue;
    items.push({
      type: 'block', file, path: fullPath(file), linkText: linkTextForSubpath(app, file, sourcePath),
      blockId: id, display, note: id, subpath: '#^' + id,
      matches: displayMatch ? displayMatch.matches : null,
      noteMatches: idMatch ? idMatch.matches : null,
      score: idMatch ? 0 : displayMatch.score,
    });
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, 100);
}

function collectGlobalBlockItems(app: App, query, sourcePath) {
  const rules = compileIgnoreRules(app);
  const trimmed = query.trim().toLowerCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const items = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (isIgnored(rules, file.path)) continue;
    const cache = app.metadataCache.getFileCache(file);
    const blocks = (cache && cache.blocks) || {};
    for (const id of Object.keys(blocks)) {
      const display = blockDisplay(cache, blocks[id]);
      let match = null;
      const idMatch = trimmed ? fuzzyMatch(trimmed, id.toLowerCase()) : null;
      if (!words.length) match = { score: 0, matches: null };
      else {
        for (const word of words) {
          const found = fuzzyMatch(word, display.toLowerCase());
          if (found) match = { score: found.score, matches: found.matches };
          if (match) break;
        }
        if (!match && idMatch) match = { score: 0, matches: null };
      }
      if (!match) continue;
      const path = fullPath(file);
      const note = path + ' > ' + id;
      items.push({
        type: 'block', file, path, linkText: linkTextForSubpath(app, file, sourcePath),
        blockId: id, display, note, subpath: '#^' + id,
        matches: match.matches,
        noteMatches: idMatch ? idMatch.matches.map((index) => index + path.length + 3) : null,
        score: idMatch ? 0 : match.score,
      });
    }
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, 100);
}

function collectDisplayItems(app: App, pathText, subpath, displayText, sourcePath) {
  const file = resolveFile(app, pathText, sourcePath);
  if (!file) return [];
  const note = pathText + subpath;
  const linkText = linkTextForFile(app, file, sourcePath) + subpath;
  const aliases = (app.metadataCache.getAliases(file) || []).map(String);
  const trimmed = displayText.trim();
  const items = [];
  for (const alias of aliases) {
    const match = trimmed ? fuzzyMatch(trimmed, alias) : { score: 0, matches: null };
    if (!match) continue;
    items.push({
      type: 'alias', file, path: note, linkText, alias, title: alias, note,
      matches: match.matches, score: match.score, displayFallback: false,
    });
  }
  if (items.length) return items;
  return [{
    type: 'alias', file, path: note, linkText, alias: displayText, title: displayText, note,
    matches: null, score: 0, displayFallback: true,
  }];
}

function resolveFile(app: App, pathText, sourcePath) {
  if (!pathText && sourcePath) return app.vault.getFileByPath(sourcePath);
  const destination = app.metadataCache.getFirstLinkpathDest(pathText, sourcePath);
  return destination ? app.vault.getFileByPath(destination) : null;
}

/**
 * @returns {{mode: 'file'|'heading'|'block'|'display', items: object[]}}
 */
export function collectLinkSuggestions(app: App, context, sourcePath = '') {
  const query = String(context.query || '').trim();
  let body = query;
  let display = null;
  const pipe = body.indexOf('|');
  if (pipe >= 0) {
    display = body.slice(pipe + 1);
    body = body.slice(0, pipe);
  }
  if (display === null && body.startsWith('##')) {
    return { mode: 'heading', items: collectGlobalHeadingItems(app, body.slice(2), sourcePath) };
  }
  if (display === null && body.startsWith('^^')) {
    return { mode: 'block', items: collectGlobalBlockItems(app, body.slice(2), sourcePath) };
  }
  const split = splitSubpath(body);
  if (display !== null) {
    return { mode: 'display', items: collectDisplayItems(app, split.path, split.subpath, display, sourcePath) };
  }
  if (split.subpath) {
    const file = resolveFile(app, split.path, sourcePath);
    if (!file || file.extension !== 'md') return { mode: 'block', items: [] };
    if (split.subpath.startsWith('#^')) {
      return { mode: 'block', items: collectLocalBlockItems(app, file, split.subpath.slice(2), sourcePath) };
    }
    return { mode: 'heading', items: collectLocalHeadingItems(app, file, split.subpath, sourcePath) };
  }
  const caret = split.path.lastIndexOf('^');
  if (caret >= 0) {
    const pathText = split.path.slice(0, caret);
    const file = resolveFile(app, pathText, sourcePath);
    if (!file || file.extension !== 'md') return { mode: 'block', items: [] };
    return { mode: 'block', items: collectLocalBlockItems(app, file, split.path.slice(caret + 1), sourcePath) };
  }
  return { mode: 'file', items: collectFiles(app, split.path, sourcePath) };
}

export function emptyItem() {
  return noneItem();
}

export function noMatchLabel() {
  return t('editor.link-suggestion.label-no-match-found');
}

const MEDIA_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf',
  'mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'mp4', 'webm', 'mov', 'mkv',
]);

/**
 * 按原版 qI 生成替换：start 回溯两个字符吞掉 [[，尾部已有 ]] 时一并吞掉。
 * marker 用于 #/^ 键：先接受当前文件，再把模式切到标题或块。
 */
export function buildLinkInsertion(item, context, options: Record<string, any> = {}) {
  const marker = options.marker || '';
  let alias = item.type === 'alias' ? (item.alias || '') : '';
  let end = context.end;
  const tail = context.lineText.slice(context.end - context.lineFrom);
  const tailMatch = /^(\s*)(\|)?(.*?)(\]\])/.exec(tail);
  if (tailMatch && !tailMatch[0].includes('[[')) {
    if (tailMatch[2] && !alias) alias = tailMatch[3];
    end += tailMatch[0].length;
  }

  let inner = '';
  if (item.type === 'none') {
    inner = context.query;
  } else if (item.type === 'file') {
    inner = item.linkText;
    // 原版：非媒体文件使用完整路径时补显示文本，[[DupB/Dupe|Dupe]]
    if (!alias && inner.includes('/') && item.file && !MEDIA_EXTENSIONS.has(item.file.extension)) {
      alias = item.title || '';
    }
  } else if (item.type === 'alias') {
    inner = item.linkText;
  } else if (item.type === 'heading') {
    inner = (item.linkText || '') + item.subpath;
  } else if (item.type === 'block') {
    inner = (item.linkText || '') + item.subpath;
  } else if (item.type === 'linktext') {
    inner = item.linkText;
  }
  if (marker) inner += marker;
  if (alias) inner += '|' + alias;
  const replacement = '[[' + inner + ']]';
  const from = context.start - 2;
  let caret = from + replacement.length;
  const raw = context.query;
  if (marker) {
    caret = from + replacement.length - 2;
    if (alias) caret -= alias.length + 1;
  } else if (alias && raw.endsWith('|')) caret = from + replacement.length - 2 - alias.length - 1;
  else if (!alias && (raw.endsWith('#') || raw.endsWith('^') || raw.endsWith('|'))) {
    caret = from + replacement.length - 2;
  }
  return { from, to: end, insert: replacement, caret };
}
