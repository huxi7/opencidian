/**
 * [INPUT]: vault 文件对象、Markdown 正文与 metadataCache 的 headings/tags/frontmatter。
 * [OUTPUT]: createSearchDocument、searchDocument（返回 content/fields/properties/score/flair）、
 *           canvasNodeText（canvas 文本节点正文）、searchFile、searchVault（无 DOM 的兼容检索入口）。
 * [POS]: global-search 查询内核的匹配半部：正文按行/章节/块切片，字段、正文与属性命中分开返回。
 *        score 计入文件名命中（原版 QI 口径），flair 排除文件名（原版标题徽标口径）；
 *        canvas 文件只匹配文本节点文字且节点命中不计入计数（countContent=false）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { parseQuery } from './search-query-parse.js';

const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+/;
const MAX_MATCHES = 500;

/* ------------------------------------------------------------------ docs */

function lineOffsets(lines) {
  const offsets = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function buildSections(lines, headings) {
  const list = headings || [];
  const out = [];
  const firstLine = list.length ? list[0].position.start.line : lines.length;
  if (firstLine > 0) out.push({ startLine: 0, endLine: firstLine - 1 });
  for (let i = 0; i < list.length; i++) {
    const startLine = list[i].position.start.line;
    const endLine = i + 1 < list.length ? list[i + 1].position.start.line - 1 : lines.length - 1;
    if (endLine >= startLine) out.push({ startLine, endLine });
  }
  return out;
}

function buildBlocks(lines) {
  const out = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const empty = lines[i].trim() === '';
    if (!empty && start < 0) start = i;
    if (empty && start >= 0) { out.push({ startLine: start, endLine: i - 1 }); start = -1; }
  }
  if (start >= 0) out.push({ startLine: start, endLine: lines.length - 1 });
  return out;
}

function withOffsets(ranges, offsets, lines) {
  return ranges.map((range) => ({
    startLine: range.startLine,
    endLine: range.endLine,
    start: offsets[range.startLine],
    end: (offsets[range.endLine] || 0) + (lines[range.endLine] || '').length,
  })).filter((range) => range.end >= range.start);
}

export function createSearchDocument(file, text, cache) {
  const lines = text.split('\n');
  const offsets = lineOffsets(lines);
  const headings = (cache && cache.headings) || [];
  return {
    file,
    text,
    cache: cache || {},
    lines,
    offsets,
    sections: withOffsets(buildSections(lines, headings), offsets, lines),
    blocks: withOffsets(buildBlocks(lines), offsets, lines),
  };
}

/* --------------------------------------------------------------- matching */

function literalRanges(text, needle, caseSensitive) {
  if (!needle) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const search = caseSensitive ? needle : needle.toLowerCase();
  const out = [];
  let index = 0;
  while (out.length < MAX_MATCHES) {
    const found = haystack.indexOf(search, index);
    if (found < 0) break;
    out.push({ start: found, end: found + needle.length });
    index = found + Math.max(1, needle.length);
  }
  return out;
}

function regexRanges(text, regex) {
  let compiled;
  try {
    const flags = (regex.flags || '').replace(/[gy]/g, '') + 'g';
    compiled = new RegExp(regex.source, flags);
  } catch (error) {
    return [];
  }
  const out = [];
  let match;
  while (out.length < MAX_MATCHES && (match = compiled.exec(text))) {
    out.push({ start: match.index, end: match.index + match[0].length });
    if (!match[0].length) compiled.lastIndex++;
  }
  return out;
}

function propertyValueText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(propertyValueText).join(', ');
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch (error) { return String(value); }
  }
  return String(value);
}

function wholeWordRanges(text, phrase, caseSensitive) {
  if (!phrase) return [];
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(^|\\W)' + escaped + '(?=\\W|$)', caseSensitive ? 'g' : 'gi');
  const out = [];
  let match;
  while (out.length < MAX_MATCHES && (match = regex.exec(text))) {
    const start = match.index + match[1].length;
    out.push({ start, end: start + phrase.length });
    if (!match[0].length) regex.lastIndex++;
  }
  return out;
}

function propertyRanges(node, text, caseSensitive) {
  if (!node) return [];
  if (node.regex) return regexRanges(text, node.regex);
  if (node.exact) return wholeWordRanges(text, node.value || '', caseSensitive);
  return literalRanges(text, node.value || '', caseSensitive);
}

function propertyKeyMatches(node, key, caseSensitive) {
  if (!node) return false;
  if (node.regex) return regexRanges(key, node.regex).length > 0;
  if (!node.value) return false;
  if (node.exact) {
    return caseSensitive ? key === node.value : key.toLowerCase() === node.value.toLowerCase();
  }
  return literalRanges(key, node.value, caseSensitive).length > 0;
}

function evalProperty(node, doc, caseSensitive) {
  const frontmatter = doc.cache && doc.cache.frontmatter;
  const properties = [];
  if (!frontmatter || typeof frontmatter !== 'object') return { ok: false, content: [], fields: [], properties };
  for (const key of Object.keys(frontmatter)) {
    if (!propertyKeyMatches(node.key, key, caseSensitive)) continue;
    const value = frontmatter[key];
    if (!node.value) {
      properties.push({ key, value: propertyValueText(value), ranges: [] });
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      const text = propertyValueText(item);
      const ranges = propertyRanges(node.value, text, caseSensitive);
      if (ranges.length) properties.push({ key, value: text, ranges });
      if (properties.length >= MAX_MATCHES) break;
    }
  }
  return { ok: properties.length > 0, content: [], fields: [], properties };
}

function testRanges(text, node, caseSensitive) {
  if (node.regex) return regexRanges(text, node.regex);
  return literalRanges(text, node.value || '', caseSensitive);
}

function contentRanges(text, node, caseSensitive) {
  if (node.regex) return regexRanges(text, node.regex);
  if (node.exact) return wholeWordRanges(text, node.value || '', caseSensitive);
  return literalRanges(text, node.value || '', caseSensitive);
}

function dedupeRanges(ranges) {
  const seen = new Set();
  const out = [];
  for (const range of ranges) {
    const key = range.start + ':' + range.end;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(range);
  }
  return out;
}

function valueResult(node, doc, caseSensitive, range) {
  const field = node.field || 'any';
  const content = [];
  const fields = [];
  if (!node.value && !node.regex) {
    return { ok: field === 'tag' && !!(doc.cache.tags && doc.cache.tags.length), content, fields };
  }

  if (field === 'any' || field === 'file') {
    const ranges = testRanges(doc.file.name, node, caseSensitive);
    if (ranges.length) fields.push({ field: 'filename', ranges });
  }
  if (field === 'path') {
    const ranges = testRanges(doc.file.path, node, caseSensitive);
    if (ranges.length) fields.push({ field: 'path', ranges });
  }
  if (field === 'tag') {
    const tags = doc.cache.tags || [];
    const needle = (node.value || '').replace(/^#/, '');
    for (const entry of tags) {
      const tag = String(entry.tag || '');
      let hit = false;
      if (node.regex) {
        hit = regexRanges(tag, node.regex).length > 0;
      } else if (caseSensitive) {
        hit = tag === '#' + needle || tag.startsWith('#' + needle + '/');
      } else {
        const lower = tag.toLowerCase();
        const target = ('#' + needle).toLowerCase();
        hit = lower === target || lower.startsWith(target + '/');
      }
      if (hit) { fields.push({ field: 'tag', value: tag }); break; }
    }
  }

  if (field === 'any' || field === 'content') {
    const start = range ? range.start : 0;
    const end = range ? range.end : doc.text.length;
    const slice = doc.text.slice(start, end);
    for (const found of contentRanges(slice, node, caseSensitive)) {
      content.push({ start: found.start + start, end: found.end + start });
    }
  }

  const ok = content.length > 0 || fields.length > 0;
  return { ok, content, fields };
}

function scopeRanges(scope, doc) {
  if (scope === 'line' || scope === 'task') {
    return doc.lines.map((line, index) => ({
      startLine: index,
      endLine: index,
      start: doc.offsets[index],
      end: doc.offsets[index] + line.length,
    }));
  }
  if (scope === 'section') return doc.sections;
  if (scope === 'block') return doc.blocks;
  return [];
}

function evalScope(node, doc, context, outerRange) {
  let ranges = scopeRanges(node.scope, doc);
  if (outerRange) {
    ranges = ranges.filter((range) => range.start >= outerRange.start && range.end <= outerRange.end);
  }
  const content = [];
  let ok = false;
  for (const range of ranges) {
    if (node.scope === 'task') {
      const line = doc.lines[range.startLine] || '';
      const task = TASK_RE.exec(line);
      if (!task) continue;
      if (node.state !== null && node.state !== undefined) {
        const done = task[1].toLowerCase() === 'x';
        if (done !== node.state) continue;
      }
    }
    if (!node.child) {
      ok = true;
      content.push({ start: range.start, end: range.end });
      continue;
    }
    const result = evalNode(node.child, doc, context, range);
    if (!result.ok) continue;
    ok = true;
    content.push(...result.content);
    if (content.length > MAX_MATCHES) break;
  }
  return { ok, content: dedupeRanges(content), fields: [] };
}

function mergeResults(results) {
  const content = [];
  const fields = [];
  const properties = [];
  for (const result of results) {
    content.push(...result.content);
    fields.push(...result.fields);
    properties.push(...(result.properties || []));
  }
  return {
    ok: results.length > 0,
    content: dedupeRanges(content),
    fields,
    properties,
  };
}

function evalNode(node, doc, context, range) {
  if (!node) return { ok: false, content: [], fields: [] };
  switch (node.type) {
    case 'and': {
      const results = [];
      for (const child of node.children) {
        const result = evalNode(child, doc, context, range);
        if (!result.ok) return { ok: false, content: [], fields: [] };
        results.push(result);
      }
      return mergeResults(results);
    }
    case 'or': {
      const results = [];
      for (const child of node.children) {
        const result = evalNode(child, doc, context, range);
        if (result.ok) results.push(result);
      }
      if (!results.length) return { ok: false, content: [], fields: [] };
      return mergeResults(results);
    }
    case 'not': {
      const result = evalNode(node.child, doc, context, range);
      return { ok: !result.ok, content: [], fields: [] };
    }
    case 'case':
      return evalNode(node.child, doc, { ...context, caseSensitive: node.caseSensitive }, range);
    case 'scope':
      return evalScope(node, doc, context, range);
    case 'value':
      return valueResult(node, doc, context.caseSensitive, range);
    case 'property':
      return evalProperty(node, doc, context.caseSensitive);
    default:
      return { ok: false, content: [], fields: [] };
  }
}

function lineForOffset(doc, offset) {
  const offsets = doc.offsets;
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, high);
}

export function searchDocument(doc, ast, options: Record<string, any> = {}) {
  const context = { caseSensitive: !!options.matchCase };
  const result = evalNode(ast, doc, context, null);
  if (!result.ok) return null;  const content = dedupeRanges(result.content).sort((a, b) => a.start - b.start || a.end - b.end).map((range) => {
    const line = lineForOffset(doc, range.start);
    return {
      line,
      start: range.start,
      end: range.end,
      lineStart: doc.offsets[line],
      lineEnd: doc.offsets[line] + (doc.lines[line] || '').length,
    };
  });
  const properties = [];
  const seenProperties = new Set();
  for (const property of result.properties || []) {
    const key = property.key + ':' + property.value + ':' + property.ranges.map((range) => range.start + '-' + range.end).join(',');
    if (seenProperties.has(key)) continue;
    seenProperties.add(key);
    properties.push(property);
  }
  const fields = [];
  const seenFields = new Set();
  for (const field of result.fields) {
    const key = field.field + ':' + (field.ranges ? field.ranges.map((r) => r.start + '-' + r.end).join(',') : field.value);
    if (seenFields.has(key)) continue;
    seenFields.add(key);
    fields.push(field);
  }
  // 原版 QI 口径：文件名/路径/正文/属性名/标签命中数之和；标题徽标再排除文件名命中。
  // countContent=false 用于 canvas：原版把节点命中单列，不计入结果数与徽标。
  let fieldHits = 0;
  let flairHits = 0;
  for (const field of fields) {
    const count = field.ranges ? field.ranges.length : 1;
    fieldHits += count;
    if (field.field !== 'filename') flairHits += count;
  }
  const contentHits = options.countContent === false ? 0 : content.length;
  return {
    content,
    fields,
    properties,
    score: contentHits + fieldHits + properties.length,
    flair: contentHits + flairHits + properties.length,
  };
}

/**
 * 原版 NL.match 的 canvas 分支：只把文本节点的文字当正文，
 * 节点按 y 再 x 排序（与原版一致），原文 JSON 不参与匹配。
 */
export function canvasNodeText(text) {
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.nodes)) return null;
    const nodes = data.nodes
      .filter((node) => node && node.type === 'text' && typeof node.text === 'string')
      .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
    if (!nodes.length) return null;
    return nodes.map((node) => node.text).join('\n');
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------- 无 DOM 兼容检索入口 */

export function searchFile(text, file, terms, matchCase) {
  const query = terms.map((term) => {
    const prefix = term.negated ? '-' : '';
    if (term.type && term.type !== 'content') return prefix + term.type + ':' + term.value;
    if (term.regex) return prefix + '/' + term.value + '/' + (term.regex.flags || '');
    if (term.exact) return prefix + '"' + term.value + '"';
    return prefix + term.value;
  }).join(' ');
  const parsed = parseQuery(query);
  if (!parsed.ast) return null;
  const doc = createSearchDocument(file, text, file._cache);
  const result = searchDocument(doc, parsed.ast, { matchCase });
  if (!result) return null;
  return {
    matches: result.content.map((match) => ({
      line: match.line,
      text: doc.lines[match.line] || '',
      start: match.start - match.lineStart,
      end: match.end - match.lineStart,
    })),
    score: result.score,
  };
}

export async function searchVault(app: App, query, options: Record<string, any> = {}) {
  const parsed = parseQuery(query);
  if (!parsed.ast) return { results: [], total: 0, count: 0 };
  const results = [];
  let total = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    let text = '';
    try { text = await app.vault.cachedRead(file); } catch (error) { continue; }
    const doc = createSearchDocument(file, text, app.metadataCache.getFileCache(file));
    const evaluation = searchDocument(doc, parsed.ast, {
      matchCase: parsed.forceCase === null ? options.matchCase : parsed.forceCase,
    });
    if (!evaluation) continue;
    results.push({ file, matches: evaluation.content.map((match) => ({
      line: match.line,
      text: doc.lines[match.line] || '',
      start: match.start - match.lineStart,
      end: match.end - match.lineStart,
    })), score: evaluation.score });
    total += evaluation.score;
  }
  return { results, total, count: results.length };
}
