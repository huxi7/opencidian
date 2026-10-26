/**
 * [INPUT]: 数据库公式文本、白名单函数表与笔记属性上下文。
 * [OUTPUT]: 导出 compileExpression(source: string): BaseExpression，生成无副作用的求值函数。
 * [POS]: Bases 安全语言前端。闭包树解析运算、正则和集合回调；禁止 eval、Function 与原型访问。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BaseDate, BaseDuration, baseAccess, baseEquals, baseTruthy, baseValueType, baseTypeNames, formatBaseValue, ownKey, safeKey, parseBaseDuration } from './bases-values.js';
import { callBaseFunction } from './bases-formula-functions.js';
import type { FormulaContext, BaseExpression } from './bases-types.js';
type Token = string | { kind: 'regexp'; value: RegExp };
const PRECEDENCE: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7 };
function tokenize(source: string): Token[] {
  if (source.length > 20000) throw new Error('表达式超出长度上限');
  const out: Token[] = [];
  let index = 0, operand = true;
  while (index < source.length) {
    const tail = source.slice(index), space = /^\s+/.exec(tail);
    if (space) { index += space[0].length; continue; }
    if (tail[0] === '/' && operand) {
      const regex = /^\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\r\n])*)\/([dgimsuvy]*)/.exec(tail);
      if (!regex || regex[1].length > 500) throw new Error('正则表达式无效或过长');
      // 拒绝容易指数回溯的嵌套量词，避免筛选阻塞渲染线程。
      if (/\([^)]*[+*][^)]*\)[+*{]/.test(regex[1])) throw new Error('正则不支持嵌套重复量词');
      out.push({ kind: 'regexp', value: new RegExp(regex[1], regex[2]) }); index += regex[0].length; operand = false; continue;
    }
    const match = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_$][\p{L}\p{N}_$]*|===|!==|&&|\|\||==|!=|>=|<=|\*\*|[(){}[\].,:!+*/%<>-])/u.exec(tail);
    if (!match) throw new Error('尚不支持的表达式：' + tail.slice(0, 30));
    const token = match[0]; out.push(token); index += token.length;
    operand = !(/^["'\d\p{L}_$]/u.test(token) || [')', ']', '}'].includes(token));
  }
  return out;
}
function scalar(token: string): unknown {
  if (token[0] === '"') return JSON.parse(token);
  if (token[0] === "'") return token.slice(1, -1).replace(/\\(u[\da-f]{4}|.)/gi, (_: string, escape: string) => escape[0] === 'u' ? String.fromCharCode(parseInt(escape.slice(1), 16)) : (({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[escape] ?? escape));
  if (/^(?:\d|\.\d)/.test(token)) return Number(token);
  return ({ true: true, false: false, null: null } as Record<string, boolean | null>)[token.toLowerCase()];
}
function numeric(value: unknown, op: string): number { if (typeof value !== 'number') throw new Error(op + ' 需要 Number，实际为 ' + baseValueType(value)); return value; }
function binary(op: string, a: unknown, b: unknown, context: FormulaContext): unknown {
  if (op === '==' || op === '!=') return baseEquals(a, b) !== (op === '!=');
  if (op === '===' || op === '!==') return baseEquals(a, b, true) !== (op === '!==');
  if (['<', '>', '<=', '>='].includes(op)) {
    if (a == null || b == null) return null;
    if (a instanceof BaseDate && b instanceof BaseDate) { a = +a.date; b = +b.date; }
    else if (a instanceof BaseDuration && b instanceof BaseDuration) { const reference = context.now ? context.now() : new Date(); a = a.milliseconds(reference); b = b.milliseconds(reference); }
    else if (typeof a !== typeof b || !['number', 'string'].includes(typeof a)) throw new Error(op + ' 比较类型不兼容');
    if (typeof a === 'number' && typeof b === 'number') return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    if (typeof a === 'string' && typeof b === 'string') return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    throw Error(op + ' 比较类型不兼容');
  }
  if (op === '+' || op === '-') {
    if (a instanceof BaseDate && typeof b === 'string') b = parseBaseDuration(b) || b;
    if (a instanceof BaseDate && b instanceof BaseDuration) return b.add(a, op === '+' ? 1 : -1);
    if (op === '+' && a instanceof BaseDuration && b instanceof BaseDate) return a.add(b);
    if (op === '-' && a instanceof BaseDate && b instanceof BaseDate) return new BaseDuration({ milliseconds: a.date.getTime() - b.date.getTime() });
    if (a instanceof BaseDuration && b instanceof BaseDuration) {
      const parts = { ...a.parts };
      for (const [unit, amount] of Object.entries(b.parts)) parts[unit] = (parts[unit] || 0) + amount * (op === '+' ? 1 : -1);
      return new BaseDuration(parts);
    }
    if (op === '+' && Array.isArray(a) && Array.isArray(b)) return a.concat(b);
    if (op === '+' && (baseTypeNames(a).includes('string') || baseTypeNames(b).includes('string'))) return formatBaseValue(a) + formatBaseValue(b);
  }
  if (a == null || b == null) return null;
  const x = numeric(a, op), y = numeric(b, op);
  return op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : op === '%' ? x % y : x ** y;
}
function identifier(context: FormulaContext, token: string) {
  const name = token.toLowerCase();
  const variable = ownKey(context.vars || {}, token);
  if (variable !== undefined) return context.vars[variable];
  if (name === 'file' || name === 'note' || name === 'formula' || name === 'this') return context[name] ?? null;
  const key = ownKey(context.note || {}, token); return key === undefined ? null : context.note[key];
}
export function compileExpression(source: string): BaseExpression {
  if (typeof source !== 'string') throw new Error('表达式必须是字符串');
  const tokens = tokenize(source); let position = 0, depth = 0;
  const peek = () => tokens[position], take = () => tokens[position++];
  const expect = (token: string) => { if (take() !== token) throw new Error('表达式缺少 ' + token); };
  function args(end: string): BaseExpression[] {
    const values: BaseExpression[] = [];
    if (peek() !== end) do { values.push(expression(0)); if (peek() !== ',') break; take(); } while (peek() !== end);
    expect(end); return values;
  }
  function primary(): BaseExpression {
    if (++depth > 100) throw new Error('表达式嵌套过深');
    const token = take(); if (!token) throw new Error('表达式不完整');
    let node: BaseExpression;
    if (token === '!' || token === '-' || token === '+') { const inner = primary(); node = (context: FormulaContext) => { const value = inner(context); return value == null ? null : token === '!' ? !baseTruthy(value) : token === '-' ? -numeric(value, token) : numeric(value, token); }; }
    else if (token === '(') { node = expression(0); expect(')'); }
    else if (token === '[') { const values = args(']'); node = (context: FormulaContext) => values.map(value => value(context)); }
    else if (token === '{') {
      const values: [string, BaseExpression][] = [];
      if (peek() !== '}') do {
        const keyToken = take(); if (typeof keyToken !== 'string') throw Error('对象键无效');
        const key = safeKey(/^["']/.test(keyToken) ? scalar(keyToken) : keyToken);
        expect(':'); values.push([key, expression(0)]); if (peek() !== ',') break; take();
      } while (peek() !== '}');
      expect('}'); node = (context: FormulaContext) => Object.assign(Object.create(null), Object.fromEntries(values.map(([key, value]) => [key, value(context)])));
    } else if (typeof token === 'object') node = () => token.value;
    else if (/^(?:["'\d]|\.\d)/.test(token) || ['true', 'false', 'null'].includes(token.toLowerCase())) { const value = scalar(token); node = () => value; }
    else if (/^[\p{L}_$]/u.test(token)) {
      safeKey(token);
      if (peek() === '(') { take(); const values = args(')'); node = (context: FormulaContext) => callBaseFunction(token, undefined, values, context); }
      else node = (context: FormulaContext) => identifier(context, token);
    } else throw new Error('表达式无效：' + token);
    while (peek() === '.' || peek() === '[') {
      const previous = node;
      if (take() === '[') { const key = expression(0); expect(']'); node = (context: FormulaContext) => baseAccess(previous(context), key(context), context); }
      else {
        const key = take(); if (typeof key !== 'string' || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(key)) throw new Error('属性名无效：' + key); safeKey(key);
        if (peek() === '(') { take(); const values = args(')'); node = (context: FormulaContext) => callBaseFunction(key, previous(context), values, context); }
        else node = (context: FormulaContext) => baseAccess(previous(context), key, context);
      }
    }
    depth--;
    return (context: FormulaContext) => {
      if (context.__baseBudget && --context.__baseBudget.remaining < 0) throw new Error('表达式超出运算上限');
      return node(context);
    };
  }
  const precedence = (token: Token | undefined) => typeof token === 'string' ? PRECEDENCE[token] || 0 : 0;
  function expression(min: number): BaseExpression {
    let left = primary();
    while (precedence(peek()) > min) {
      const op = take(); if (typeof op !== 'string') throw Error('运算符无效');
      const right = expression(PRECEDENCE[op] - (op === '**' ? 1 : 0)), previous = left;
      left = (context: FormulaContext) => {
        const first = previous(context);
        if (op === '&&') return baseTruthy(first) && baseTruthy(right(context));
        if (op === '||') return baseTruthy(first) || baseTruthy(right(context));
        return binary(op, first, right(context), context);
      };
    }
    return left;
  }
  const result = expression(0);
  if (position !== tokens.length) throw new Error('尚不支持的表达式：' + tokens.slice(position).join(' '));
  return (context: FormulaContext) => result({ ...context, __baseBudget: context.__baseBudget || { remaining: 100000 } });
}
