/**
 * [INPUT]: vault 文件对象、Markdown 正文与 metadataCache 的 headings/tags。
 * [OUTPUT]: parseQuery、searchDocument、createSearchDocument、queryInfo；搜索语法 AST 与文档匹配结果。
 * [POS]: global-search 的无 DOM 查询内核。正文范围按行/章节/块/任务切片，字段、正文与属性命中分开返回。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const FIELD_OPERATORS = new Set(['path', 'file', 'tag', 'content']);
const SCOPE_OPERATORS = new Set(['line', 'section', 'block', 'task', 'task-todo', 'task-done']);
const CASE_OPERATORS = new Set(['match-case', 'ignore-case']);
const OPERATOR_RE = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+/;
const REGEX_PARSE_ERROR = 'Failed to parse regular expression. ';

/* ------------------------------------------------------------------ lexer */

function readQuoted(input, start) {
  let text = '';
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      text += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') return { text, end: i + 1 };
    text += ch;
    i++;
  }
  return { text, end: i };
}

function readRegex(input, start) {
  let source = '';
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      source += ch + input[i + 1];
      i += 2;
      continue;
    }
    if (ch === '/') {
      const flags = /^[a-z]*/.exec(input.slice(i + 1))[0];
      return { source, flags, end: i + 1 + flags.length };
    }
    source += ch;
    i++;
  }
  return null;
}

function readProperty(input, start) {
  let i = start + 1;
  let quote = false;
  let regex = false;
  let escaped = false;
  while (i < input.length) {
    const ch = input[i];
    if (escaped) { escaped = false; i++; continue; }
    if (ch === '\\') { escaped = true; i++; continue; }
    if (quote) { if (ch === '"') quote = false; i++; continue; }
    if (regex) { if (ch === '/') regex = false; i++; continue; }
    if (ch === '"') { quote = true; i++; continue; }
    if (ch === '/' && (i === start + 1 || input[i - 1] === ':')) { regex = true; i++; continue; }
    if (ch === ']') return { text: input.slice(start + 1, i), end: i + 1 };
    i++;
  }
  return null;
}

function splitProperty(raw) {
  let quote = false;
  let regex = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (quote) { if (ch === '"') quote = false; continue; }
    if (regex) { if (ch === '/') regex = false; continue; }
    if (ch === '"') { quote = true; continue; }
    if (ch === '/' && (i === 0 || raw[i - 1] === ':')) { regex = true; continue; }
    if (ch === ':') return { key: raw.slice(0, i), value: raw.slice(i + 1) };
  }
  return { key: raw, value: null };
}

function scan(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') {
      tokens.push({ kind: ch });
      i++;
      continue;
    }
    if (ch === '[') {
      const property = readProperty(input, i);
      if (property) {
        tokens.push({ kind: 'property', text: property.text });
        i = property.end;
        continue;
      }
    }
    if (ch === '-') {
      const boundary = i === 0 || /[\s(]/.test(input[i - 1]);
      if (boundary) {
        tokens.push({ kind: 'not' });
        i++;
        continue;
      }
    }
    if (ch === '"') {
      const value = readQuoted(input, i);
      tokens.push({ kind: 'string', text: value.text });
      i = value.end;
      continue;
    }
    if (ch === '/') {
      const regex = readRegex(input, i);
      if (regex) {
        tokens.push({ kind: 'regex', ...regex });
        i = regex.end;
        continue;
      }
    }
    let j = i;
    while (j < input.length && !/[\s()"]/.test(input[j])) j++;
    const raw = input.slice(i, j);
    if (raw === 'OR' || raw === '|') tokens.push({ kind: 'or' });
    else if (raw) tokens.push({ kind: 'word', text: raw });
    i = j;
  }
  return tokens;
}

/* ----------------------------------------------------------------- parser */

function textNode(value, exact, regex) {
  return { type: 'value', field: 'any', value, exact, regex };
}

function inlineValue(rest) {
  if (rest.length > 1 && rest[0] === '/') {
    const last = rest.lastIndexOf('/');
    if (last > 0) {
      try {
        const source = rest.slice(1, last);
        const flags = rest.slice(last + 1).replace(/[gy]/g, '');
        new RegExp(source, flags);
        return { value: source, exact: false, regex: { source, flags } };
      } catch (error) {
        return { invalidRegex: REGEX_PARSE_ERROR + error.message };
      }
    }
  }
  return { value: rest, exact: false, regex: null };
}

function propertyMatcher(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (text.length > 1 && text[0] === '/' && text.lastIndexOf('/') > 0) {
    const last = text.lastIndexOf('/');
    const source = text.slice(1, last);
    const flags = text.slice(last + 1).replace(/[gy]/g, '');
    try {
      new RegExp(source, flags);
    } catch (error) {
      return { error: REGEX_PARSE_ERROR + error.message };
    }
    return { node: textNode(source, false, { source, flags }) };
  }
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    return { node: textNode(text.slice(1, -1), true, null) };
  }
  return { node: textNode(text, false, null) };
}

function valueFromToken(token) {
  if (token.kind === 'string') return { value: token.text, exact: true, regex: null };
  if (token.kind === 'regex') {
    try {
      new RegExp(token.source, token.flags.replace(/[gy]/g, ''));
      return { value: token.source, exact: false, regex: { source: token.source, flags: token.flags.replace(/[gy]/g, '') } };
    } catch (error) {
      return { invalidRegex: REGEX_PARSE_ERROR + error.message };
    }
  }
  return inlineValue(token.text || '');
}

export function parseQuery(source) {
  const tokens = scan(source || '');
  let index = 0;
  let error = null;
  const flags = { forceCase: null };

  const peek = () => tokens[index];
  const take = () => tokens[index++];

  function consumeGroup() {
    if (peek() && peek().kind === '(') {
      index++;
      const node = parseOr();
      if (peek() && peek().kind === ')') index++;
      return node;
    }
    return null;
  }

  function parseOr() {
    const parts = [parseAnd()].filter(Boolean);
    while (peek() && peek().kind === 'or') {
      index++;
      const node = parseAnd();
      if (node) parts.push(node);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { type: 'or', children: parts };
  }

  function parseAnd() {
    const parts = [];
    while (peek() && peek().kind !== 'or' && peek().kind !== ')') {
      const node = parseUnary();
      if (node) parts.push(node);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { type: 'and', children: parts };
  }

  function parseUnary() {
    if (peek() && peek().kind === 'not') {
      index++;
      const child = parseUnary();
      return child ? { type: 'not', child } : null;
    }
    return parsePrimary();
  }

  function wrapField(op, value) {
    if (SCOPE_OPERATORS.has(op)) {
      let scope = op;
      let state = null;
      if (op === 'task-todo') { scope = 'task'; state = false; }
      else if (op === 'task-done') { scope = 'task'; state = true; }
      return { type: 'scope', scope, state, child: value ? { type: 'value', field: 'content', ...value } : null };
    }
    return { type: 'value', field: op, value: value.value, exact: value.exact, regex: value.regex };
  }

  function fromWord(raw) {
    const match = OPERATOR_RE.exec(raw);
    if (!match) return textNode(raw, false, null);
    const op = match[1];
    const rest = match[2];
    const known = FIELD_OPERATORS.has(op) || SCOPE_OPERATORS.has(op) || CASE_OPERATORS.has(op);
    if (!known) return textNode(raw, false, null);

    if (CASE_OPERATORS.has(op)) {
      const wantCase = op === 'match-case';
      if (rest) {
        const value = inlineValue(rest);
        if (value.invalidRegex) { error = value.invalidRegex; return null; }
        return { type: 'case', caseSensitive: wantCase, child: textNode(value.value, value.exact, value.regex) };
      }
      const next = peek();
      if (next && next.kind !== ')' && next.kind !== 'or') {
        const child = parseUnary();
        return child ? { type: 'case', caseSensitive: wantCase, child } : null;
      }
      flags.forceCase = wantCase;
      return { type: 'true' };
    }

    if (rest) {
      const value = inlineValue(rest);
      if (value.invalidRegex) { error = value.invalidRegex; return null; }
      return wrapField(op, value);
    }

    if (peek() && peek().kind === '(') {
      const child = consumeGroup();
      if (!child) return null;
      if (SCOPE_OPERATORS.has(op)) return { ...wrapField(op, null), child };
      return child;
    }

    if (peek() && (peek().kind === 'string' || peek().kind === 'regex')) {
      const token = take();
      const value = valueFromToken(token);
      if (value.invalidRegex) { error = value.invalidRegex; return null; }
      return wrapField(op, value);
    }

    if (SCOPE_OPERATORS.has(op)) return wrapField(op, null);
    return { type: 'value', field: op, value: '', exact: false, regex: null };
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return null;
    if (token.kind === '(') {
      index++;
      const node = parseOr();
      if (peek() && peek().kind === ')') index++;
      return node;
    }
    if (token.kind === 'property') {
      index++;
      const parts = splitProperty(token.text);
      const key = propertyMatcher(parts.key);
      if (key.error) { error = key.error; return null; }
      let value = null;
      if (parts.value !== null) {
        const parsedValue = propertyMatcher(parts.value);
        if (parsedValue.error) { error = parsedValue.error; return null; }
        value = parsedValue.node;
      }
      return { type: 'property', key: key.node, value };
    }
    if (token.kind === 'string') {
      index++;
      return textNode(token.text, true, null);
    }
    if (token.kind === 'regex') {
      index++;
      const value = valueFromToken(token);
      if (value.invalidRegex) { error = value.invalidRegex; return null; }
      return textNode(value.value, false, value.regex);
    }
    if (token.kind === 'word') {
      index++;
      if (token.text === 'OR' || token.text === '|') return null;
      return fromWord(token.text);
    }
    index++;
    return null;
  }

  const ast = parseOr();
  while (peek()) {
    if (peek().kind === ')') { index++; continue; }
    error = error || 'Unexpected token in search query.';
    index++;
  }
  if (error) return { ast: null, error, forceCase: flags.forceCase };
  if (!ast || ast.type === 'true') return { ast: null, error: null, forceCase: flags.forceCase };
  return { ast, error: null, forceCase: flags.forceCase };
}

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

const MAX_MATCHES = 500;

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

export function searchDocument(doc, ast, options = {}) {
  const context = { caseSensitive: !!options.matchCase };
  const result = evalNode(ast, doc, context, null);
  if (!result.ok) return null;
  const content = dedupeRanges(result.content).sort((a, b) => a.start - b.start || a.end - b.end).map((range) => {
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
  return { content, fields, properties, score: content.length + fields.length + properties.length };
}

/* ------------------------------------------------------------------ info */

function displayValue(node) {
  if (node.regex) return '/' + node.regex.source + '/' + (node.regex.flags || '');
  if (node.field === 'tag' && node.value && !String(node.value).startsWith('#')) return '#' + node.value;
  return '"' + (node.value || '') + '"';
}

function valueLabel(node) {
  if (node.regex) return 'plugins.search.label-match-regex';
  if (node.exact) return 'plugins.search.label-match-exact-text';
  return 'plugins.search.label-match-text';
}

const SCOPE_LABELS = {
  path: 'plugins.search.label-match-file-path',
  file: 'plugins.search.label-match-file-name',
  content: 'plugins.search.label-match-content',
  line: 'plugins.search.label-match-line',
  section: 'plugins.search.label-match-section',
  block: 'plugins.search.label-match-block',
  tag: 'plugins.search.label-match-tag',
  task: 'plugins.search.label-match-task',
  'task-todo': 'plugins.search.label-match-task-todo',
  'task-done': 'plugins.search.label-match-task-done',
};

export function queryInfo(node) {
  if (!node) return [];
  if (node.type === 'and') {
    if (node.children.length === 1) return queryInfo(node.children[0]);
    return [{ label: 'plugins.search.label-match-all', children: node.children.flatMap(queryInfo) }];
  }
  if (node.type === 'or') {
    return [{ label: 'plugins.search.label-match-any', children: node.children.flatMap(queryInfo) }];
  }
  if (node.type === 'not') {
    return [{ label: 'plugins.search.label-excluding', children: queryInfo(node.child) }];
  }
  if (node.type === 'case') {
    return [{
      label: node.caseSensitive ? 'plugins.search.label-case-sensitive' : 'plugins.search.label-case-insensitive',
      children: queryInfo(node.child),
    }];
  }
  if (node.type === 'scope') {
    const label = node.scope === 'task' && node.state === false
      ? SCOPE_LABELS['task-todo']
      : node.scope === 'task' && node.state === true
        ? SCOPE_LABELS['task-done']
        : SCOPE_LABELS[node.scope] || 'plugins.search.label-match-text';
    return [{ label, children: node.child ? queryInfo(node.child) : [] }];
  }
  if (node.type === 'property') {
    const children = [{ label: 'Key:', children: queryInfo(node.key) }];
    if (node.value) children.push({ label: 'Value:', children: queryInfo(node.value) });
    return [{ label: 'plugins.search.label-match-property', children }];
  }
  if (node.type === 'value') {
    const label = SCOPE_LABELS[node.field] || valueLabel(node);
    const value = node.value || node.regex ? displayValue(node) : '';
    return [{ label, value }];
  }
  return [];
}
