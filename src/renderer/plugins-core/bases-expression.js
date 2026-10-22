/**
 * [INPUT]: 接收数据库表达式与笔记属性上下文。
 * [OUTPUT]: 导出 compileExpression，生成无副作用的求值函数。
 * [POS]: Bases 的安全表达式子集。仅执行白名单操作；未知能力抛错，禁止静默放宽筛选。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

function tokenize(source) {
  const out = [];
  let index = 0;
  while (index < source.length) {
    const tail = source.slice(index);
    const space = /^\s+/.exec(tail);
    if (space) { index += space[0].length; continue; }
    const match = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|[\p{L}_$][\p{L}\p{N}_$]*|&&|\|\||==|!=|>=|<=|[()[\].,!+*/%<>-])/u.exec(tail);
    if (!match) throw new Error('尚不支持的表达式：' + tail.slice(0, 30));
    out.push(match[0]); index += match[0].length;
  }
  return out;
}
function scalar(token) {
  if (token[0] === '"') return JSON.parse(token);
  if (token[0] === "'") return token.slice(1, -1).replace(/\\(['\\])/g, '$1');
  if (/^\d/.test(token)) return Number(token);
  return { true: true, false: false, null: null }[token];
}
function same(a, b) { return a === b || (a == null && b == null); }
function binary(op, a, b) {
  switch (op) {
    case '||': return a || b;
    case '&&': return a && b;
    case '==': return same(a, b);
    case '!=': return !same(a, b);
    case '>': return a != null && b != null && a > b;
    case '<': return a != null && b != null && a < b;
    case '>=': return a != null && b != null && a >= b;
    case '<=': return a != null && b != null && a <= b;
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : a / b;
    case '%': return b === 0 ? null : a % b;
  }
}
function call(name, object, args, context) {
  if (BLOCKED.has(name)) throw new Error('禁止访问属性：' + name);
  if (object === context.file) {
    if (name === 'inFolder') return object.folder === args[0] || object.folder.startsWith(String(args[0]).replace(/\/$/, '') + '/');
    if (name === 'hasTag') return context.tags.some(tag => tag === String(args[0]).replace(/^#/, '') || tag.startsWith(String(args[0]).replace(/^#/, '') + '/'));
    if (name === 'hasProperty') return Object.hasOwn(context.note, args[0]);
    if (name === 'hasLink') return context.links.includes(args[0]);
  }
  if (name === 'isEmpty') return object == null || object === '' || (Array.isArray(object) && object.length === 0);
  if (name === 'contains') return Array.isArray(object) ? object.some(value => same(value, args[0])) : typeof object === 'string' && object.includes(String(args[0]));
  if (name === 'containsAny' || name === 'containsAll') {
    const candidates = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const contains = value => Array.isArray(object) ? object.includes(value) : typeof object === 'string' && object.includes(String(value));
    return name === 'containsAll' ? candidates.every(contains) : candidates.some(contains);
  }
  if (name === 'startsWith') return typeof object === 'string' && object.startsWith(String(args[0]));
  if (name === 'endsWith') return typeof object === 'string' && object.endsWith(String(args[0]));
  if (name === 'lower') return typeof object === 'string' ? object.toLowerCase() : null;
  if (name === 'upper') return typeof object === 'string' ? object.toUpperCase() : null;
  if (name === 'toString') return object == null ? '' : String(object);
  if (object === undefined) {
    if (name === 'if') return args[0] ? args[1] : args[2];
    if (name === 'list') return args;
    if (name === 'number') return args[0] === null || args[0] === '' ? null : Number(args[0]);
  }
  throw new Error('尚不支持的函数：' + name);
}
export function compileExpression(source) {
  if (typeof source !== 'string') throw new Error('表达式必须是字符串');
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expect = token => { if (take() !== token) throw new Error('表达式缺少 ' + token); };
  function args(end) {
    const values = [];
    if (peek() !== end) do { values.push(expression(0)); if (peek() !== ',') break; take(); } while (true);
    expect(end); return values;
  }
  function primary() {
    const token = take();
    if (!token) throw new Error('表达式不完整');
    let node;
    if (token === '!' || token === '-') {
      const inner = primary(); node = context => token === '!' ? !inner(context) : -inner(context);
    } else if (token === '(') { node = expression(0); expect(')'); }
    else if (token === '[') { const values = args(']'); node = context => values.map(value => value(context)); }
    else if (/^["'\d]/.test(token) || ['true', 'false', 'null'].includes(token)) { const value = scalar(token); node = () => value; }
    else if (/^[\p{L}_$]/u.test(token)) {
      if (BLOCKED.has(token)) throw new Error('禁止访问属性：' + token);
      if (peek() === '(') { take(); const values = args(')'); node = context => call(token, undefined, values.map(value => value(context)), context); }
      else node = context => token === 'file' ? context.file : token === 'note' ? context.note : token === 'formula' ? context.formula : context.note[token] ?? null;
    } else throw new Error('表达式无效：' + token);
    while (peek() === '.' || peek() === '[') {
      const previous = node;
      if (take() === '[') { const key = expression(0); expect(']'); node = context => access(previous(context), key(context)); }
      else {
        const key = take();
        if (!key || BLOCKED.has(key)) throw new Error('禁止访问属性：' + key);
        if (peek() === '(') { take(); const values = args(')'); node = context => call(key, previous(context), values.map(value => value(context)), context); }
        else node = context => access(previous(context), key);
      }
    }
    return node;
  }
  function expression(min) {
    let left = primary();
    while ((PRECEDENCE[peek()] || 0) > min) {
      const op = take(), right = expression(PRECEDENCE[op]), previous = left;
      left = context => {
        const first = previous(context);
        if (op === '&&' && !first) return false;
        if (op === '||' && first) return first;
        return binary(op, first, right(context));
      };
    }
    return left;
  }
  const result = expression(0);
  if (position !== tokens.length) throw new Error('尚不支持的表达式：' + tokens.slice(position).join(' '));
  return result;
}
function access(object, key) {
  if (BLOCKED.has(String(key))) throw new Error('禁止访问属性：' + key);
  if (object == null) return null;
  if (key === 'length' && (typeof object === 'string' || Array.isArray(object))) return object.length;
  return Object.hasOwn(object, key) ? object[key] : null;
}
