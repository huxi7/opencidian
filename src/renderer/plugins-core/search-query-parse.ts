/**
 * [INPUT]: 查询字符串（无 DOM 依赖）。
 * [OUTPUT]: parseQuery（返回 { ast, error, forceCase }）与 queryInfo（解释视图条目树）。
 * [POS]: global-search 查询内核的语法半部：词法（引号/正则/属性/否定/括号/OR）与递归下降解析。
 *        作用域算子 line/section/block/task 与大小写算子 match-case/ignore-case 归一为 AST 节点；
 *        解释文案按原版 plugins.search.label-* 键输出，供 search-info-container 渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const FIELD_OPERATORS = new Set(['path', 'file', 'tag', 'content']);
const SCOPE_OPERATORS = new Set(['line', 'section', 'block', 'task', 'task-todo', 'task-done']);
const CASE_OPERATORS = new Set(['match-case', 'ignore-case']);
const OPERATOR_RE = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/;
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
