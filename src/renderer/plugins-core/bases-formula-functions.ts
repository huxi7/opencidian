/**
 * [INPUT]: 表达式求值器传入白名单函数名、接收值、延迟参数与行上下文。
 * [OUTPUT]: 导出 callBaseFunction；实现原版 formulas.funcs 的全局和实例函数。
 * [POS]: Bases 函数注册边界。类型、参数数目和回调作用域集中验证，不调用任意宿主函数。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BaseDate, BaseLink, BaseTag, BaseDisplay, baseValueType, baseTypeNames, baseTruthy, baseEquals, formatBaseValue, sortCompare, parseBaseDate, parseBaseDuration } from './bases-values.js';
import { BaseFile, resolveBaseFile } from './bases-values-file.js';
import type { FormulaContext, BaseExpression } from './bases-types.js';
const moment: typeof import('moment') = require('moment');
function count(name: string, args: readonly unknown[], min: number, max = min) { if (args.length < min || args.length > max) throw new Error(name + ' 参数数目应为 ' + min + (max !== min ? ' 至 ' + (max === Infinity ? '任意' : max) : '') + '，实际为 ' + args.length); }
function expect(value: unknown, types: string[], name: string) {
  const type = baseValueType(value);
  if (!types.some(expected => baseTypeNames(value).includes(expected) || type === expected)) throw new Error(name + ' 类型错误：需要 ' + types.join('/') + '，实际为 ' + type);
  return value;
}
const string = (value: unknown, name: string) => { expect(value, ['string', 'tag', 'link', 'url', 'icon', 'image', 'html', 'markdown'], name); return value instanceof BaseLink ? value.path : formatBaseValue(value); };
const number = (value: unknown, name: string) => { expect(value, ['number'], name); return value as number; };
const now = (context: FormulaContext) => new Date(context.now ? context.now() : Date.now());
const listContains = (array: unknown[], value: unknown) => array.some(item => item instanceof BaseTag ? item.matches(value) : baseEquals(item, value));
const candidates = (args: unknown[]) => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
const GLOBAL_PARAMETERS: Record<string, string[]> = {
  now: [], today: [], random: [], date: ['string|date'], min: ['number...'], max: ['number...'],
  list: ['value'], link: ['string|file', 'any?'], number: ['value'], duration: ['string'],
  image: ['string|file'], icon: ['string'], file: ['string|file'], html: ['string'], markdown: ['string'], escapehtml: ['string'],
};
const COMMON_PARAMETERS: Record<string, string[]> = { tostring: [], istruthy: [], istype: ['string'] };
const TEXT_PARAMETERS: Record<string, string[]> = {
  startswith: ['string'], endswith: ['string'], trim: [], title: [], isempty: [], replace: ['string|regexp', 'string'],
  lower: [], upper: [], reverse: [], split: ['string|regexp', 'number?'], contains: ['string'], containsany: ['string...'],
  containsall: ['string...'], slice: ['number', 'number?'], repeat: ['number'],
};
const TYPE_PARAMETERS: Record<string, Record<string, string[]>> = {
  null: { isempty: [] }, number: { abs: [], floor: [], ceil: [], round: ['number?'], tofixed: ['number'], isempty: [] },
  list: { isempty: [], earliest: [], latest: [], median: [], mean: [], min: [], max: [], sum: [], stddev: [], join: ['string'], reverse: [], flat: [], unique: [], contains: ['any'], containsany: ['any...'], containsall: ['any...'], slice: ['number', 'number?'], sort: [] },
  object: { isempty: [], keys: [], values: [] }, regexp: { matches: ['string'] },
  date: { format: ['string'], date: [], time: [], relative: [], isempty: [] },
  file: { aslink: ['any?'], haslink: ['file|string'], infolder: ['string'], hastag: ['string...'], hasproperty: ['string'] },
  link: { asfile: [], linksto: ['file'] }, tag: { matches: ['string'] },
};
function parameterContract(name: string, object: unknown): string[] | undefined {
  if (object === undefined) return GLOBAL_PARAMETERS[name];
  if (Object.hasOwn(COMMON_PARAMETERS, name)) return COMMON_PARAMETERS[name];
  const type = baseValueType(object);
  if (Object.hasOwn(TYPE_PARAMETERS[type] || {}, name)) return TYPE_PARAMETERS[type][name];
  if (baseTypeNames(object).includes('string')) return TEXT_PARAMETERS[name];
}
function argumentsFor(name: string, signature: string[], sources: BaseExpression[], context: FormulaContext): unknown[] | null {
  const args: unknown[] = [];
  for (let index = 0; index < sources.length; index++) {
    const parameter = signature[index] ?? (signature.at(-1)?.endsWith('...') ? signature.at(-1) : undefined);
    if (parameter === undefined) throw new Error(name + ' 参数数目过多');
    const value = sources[index](context), optional = parameter.endsWith('?'), types = parameter.replace(/\?$|\.\.\.$/g, '').split('|');
    if (value == null && optional) { args.push(undefined); continue; }
    if (value == null && !types.includes('any')) return null;
    const actual = baseTypeNames(value);
    if (!types.includes('any') && !types.includes('value') && !types.some(type => actual.includes(type))) throw new Error(name + ' 类型错误：需要 ' + types.join('/') + '，实际为 ' + baseValueType(value));
    args.push(value);
  }
  const required = signature.filter(parameter => !parameter.endsWith('?') && !parameter.endsWith('...')).length;
  if (args.length < required) throw new Error(name + ' 参数数目不足');
  return args;
}
function stats(name: string, array: unknown[]) {
  const numbers = array.filter(value => typeof value === 'number');
  if (!numbers.length) return null;
  const sum = numbers.reduce((a, b) => a + b, 0);
  if (name === 'sum') return sum;
  if (name === 'mean') return sum / array.length; // 原版分母为列表长度，非数字项不进入分子。
  if (name === 'min') return Math.min(...numbers);
  if (name === 'max') return Math.max(...numbers);
  if (name === 'stddev') { const mean = sum / numbers.length; return Math.sqrt(numbers.reduce((acc, value) => acc + (value - mean) ** 2, 0) / numbers.length); }
  numbers.sort((a, b) => a - b); const mid = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;
}
function global(name: string, args: unknown[], context: FormulaContext): unknown {
  switch (name) {
    case 'now': count(name, args, 0); return new BaseDate(now(context));
    case 'today': count(name, args, 0); return new BaseDate(now(context)).dateOnly();
    case 'date': count(name, args, 1); expect(args[0], ['date', 'string'], name); return parseBaseDate(args[0]);
    case 'random': count(name, args, 0); return (context.random || Math.random)();
    case 'min': case 'max': {
      const values = args.filter(value => value != null).map(value => number(value, name));
      return values.length ? Math[name](...values) : null;
    }
    case 'list': count(name, args, 1); return Array.isArray(args[0]) ? args[0] : [args[0]];
    case 'link': count(name, args, 1, 2); expect(args[0], ['string', 'link', 'url', 'file'], name); return args[0] instanceof BaseFile ? args[0].asLink(args[1]) : new BaseLink(args[0] instanceof BaseLink ? args[0].path : string(args[0], name), args[1], context.app);
    case 'number': {
      count(name, args, 1); const value = args[0];
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return Number(value);
      if (value instanceof BaseDate) return +value.date;
      if (typeof value === 'string') { const parsed = parseFloat(value); if (!Number.isNaN(parsed)) return parsed; }
      throw new Error('number 无法转换：' + formatBaseValue(value, { nullText: 'null' }));
    }
    case 'duration': count(name, args, 1); return parseBaseDuration(string(args[0], name));
    case 'file': count(name, args, 1); expect(args[0], ['file', 'link', 'string'], name); return resolveBaseFile(context, args[0]);
    case 'image': {
      count(name, args, 1); expect(args[0], ['string', 'file', 'link', 'url'], name);
      const value = args[0];
      if (value instanceof BaseLink && value.kind === 'link') { const file = value.resolve(); return file ? new BaseDisplay('image', file.path) : null; }
      return new BaseDisplay('image', value instanceof BaseFile ? value.path : value instanceof BaseLink ? value.path : string(value, name));
    }
    case 'icon': case 'html': case 'markdown': count(name, args, 1); return new BaseDisplay(name, string(args[0], name));
    case 'escapehtml': count(name, args, 1); return string(args[0], name).replace(/[&<>"']/g, char => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[char]));
    default: throw new Error('尚不支持的函数：' + name);
  }
}
function universal(name: string, object: unknown, args: unknown[]): unknown {
  if (name === 'tostring') { count(name, args, 0); return formatBaseValue(object, { nullText: 'null' }); }
  if (name === 'istruthy') { count(name, args, 0); return baseTruthy(object); }
  if (name === 'istype') {
    count(name, args, 1); const type = string(args[0], name).toLowerCase();
    return baseTypeNames(object).includes(type);
  }
  return undefined;
}
function textFunction(name: string, object: unknown, args: unknown[]): unknown {
  const text = object instanceof BaseLink ? object.path : formatBaseValue(object);
  switch (name) {
    case 'startswith': case 'endswith': count(name, args, 1); return text[name === 'startswith' ? 'startsWith' : 'endsWith'](string(args[0], name));
    case 'trim': count(name, args, 0); return text.trim();
    case 'title': count(name, args, 0); return text.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    case 'lower': count(name, args, 0); return text.toLowerCase();
    case 'upper': count(name, args, 0); return text.toUpperCase();
    case 'reverse': count(name, args, 0); return text.split('').reverse().join('');
    case 'replace': {
      count(name, args, 2); expect(args[0], ['string', 'regexp'], name); const replacement = string(args[1], name);
      return args[0] instanceof RegExp ? text.replace(args[0], replacement) : args[0] === '' ? text : text.split(string(args[0], name)).join(replacement);
    }
    case 'split': count(name, args, 1, 2); expect(args[0], ['string', 'regexp'], name); if (args[1] !== undefined) number(args[1], name); return text.split(args[0] instanceof RegExp ? args[0] : string(args[0], name), args[1] === undefined ? undefined : number(args[1], name));
    case 'contains': count(name, args, 1); { const query = string(args[0], name); return query !== '' && text.toLowerCase().includes(query.toLowerCase()); }
    case 'containsany': case 'containsall': {
      const queries = args.map(value => string(value, name).toLowerCase());
      return queries[name === 'containsany' ? 'some' : 'every'](value => text.toLowerCase().includes(value));
    }
    case 'slice': count(name, args, 1, 2); args.filter(value => value !== undefined).forEach(value => number(value, name)); return text.slice(number(args[0], name), args[1] === undefined ? undefined : number(args[1], name));
    case 'repeat': count(name, args, 1); { const repeats = number(args[0], name); if (repeats < 0 || repeats * text.length > 1000000) throw new Error('repeat 超出文本上限'); return text.repeat(repeats); }
  }
  throw new Error('尚不支持的函数：' + name + ' on String');
}
function listFunction(name: string, array: unknown[], args: unknown[]): unknown {
  if (['sum', 'mean', 'min', 'max', 'median', 'stddev'].includes(name)) { count(name, args, 0); return stats(name, array); }
  switch (name) {
    case 'earliest': case 'latest': {
      count(name, args, 0); const dates = array.map(value => parseBaseDate(value, false)).filter((date) => date !== null);
      if (!dates.length) return null;
      return new BaseDate(dates.reduce((a, b) => name === 'earliest' ? +a.date < +b.date ? a : b : +a.date > +b.date ? a : b).date);
    }
    case 'join': count(name, args, 1); return array.map(value => formatBaseValue(value, { nullText: 'null' })).join(string(args[0], name));
    case 'reverse': count(name, args, 0); return array.slice().reverse();
    case 'flat': count(name, args, 0); return array.flat(Infinity);
    case 'unique': count(name, args, 0); return array.filter((value, index) => array.findIndex(other => baseEquals(value, other, true)) === index);
    case 'contains': count(name, args, 1); return listContains(array, args[0]);
    case 'containsany': case 'containsall': return candidates(args)[name === 'containsany' ? 'some' : 'every'](value => listContains(array, value));
    case 'slice': count(name, args, 1, 2); args.filter(value => value !== undefined).forEach(value => number(value, name)); return array.slice(number(args[0], name), args[1] === undefined ? undefined : number(args[1], name));
    case 'sort': count(name, args, 0); return array.slice().sort(sortCompare);
  }
  throw new Error('尚不支持的函数：' + name + ' on List');
}
function callbackFunction(name: string, object: unknown[] | Record<string, unknown>, sources: BaseExpression[], context: FormulaContext): unknown {
  count(name, sources, name === 'reduce' ? 2 : 1);
  const list = Array.isArray(object), keys = list ? object.map((_, index) => index) : Object.keys(object);
  if (!list && name === 'reduce') throw new Error('Object 不支持 reduce');
  let acc = name === 'reduce' ? sources[1](context) : null;
  const outputList: unknown[] = [];
  const outputObject: Record<string, unknown> = Object.create(null);
  const read = (key: string | number) => Array.isArray(object) ? object[Number(key)] : object[String(key)];
  for (const key of keys) {
    const scoped = { ...context, vars: { ...context.vars, value: read(key), index: list ? key : null, key: list ? null : key, acc } };
    const value = sources[0](scoped);
    if (name === 'map') outputList.push(value);
    else if (name === 'filter') { if (baseTruthy(value)) list ? outputList.push(read(key)) : outputObject[key] = read(key); }
    else acc = value;
  }
  return name === 'reduce' ? acc : list || name === 'map' ? outputList : outputObject;
}
export function callBaseFunction(rawName: string, object: unknown, sources: BaseExpression[], context: FormulaContext): unknown {
  const name = rawName.toLowerCase();
  if (name === 'if') {
    const instance = object !== undefined;
    count(name, sources, instance ? 1 : 2, instance ? 2 : 3);
    const condition = instance ? object : sources[0](context), branches = instance ? sources : sources.slice(1);
    return baseTruthy(condition) ? branches[0](context) : branches[1]?.(context) ?? null;
  }
  const type = baseValueType(object), signature = parameterContract(name, object);
  // 原版 Null 上未登记的方法直接传播 Null，不求值参数。
  if (object !== undefined && object == null && !signature) return null;
  if (object !== undefined && ['map', 'filter', 'reduce'].includes(name) && (Array.isArray(object) || object !== null && typeof object === 'object' && type === 'object')) return callbackFunction(name, object as unknown[] | Record<string, unknown>, sources, context);
  if (!signature) throw new Error('尚不支持的函数：' + rawName + (object === undefined ? '' : ' on ' + type));
  const args = argumentsFor(name, signature, sources, context);
  if (args === null) return null;
  if (object === undefined) return global(name, args, context);
  const common = universal(name, object, args); if (common !== undefined) return common;
  if (name === 'isempty') {
    count(name, args, 0);
    if (object == null || typeof object === 'string' || Array.isArray(object)) return object == null || object.length === 0;
    if (object !== null && typeof object === 'object' && type === 'object') return Object.keys(object).length === 0;
    if (['number', 'date'].includes(type)) return false;
  }
  if (object instanceof BaseFile) {
    switch (name) {
      case 'aslink': count(name, args, 0, 1); return object.asLink(args[0]);
      case 'haslink': count(name, args, 1); expect(args[0], ['file', 'link', 'string'], name); return object.hasLink(args[0]);
      case 'infolder': count(name, args, 1); return object.inFolder(string(args[0], name));
      case 'hastag': return object.hasTag(...args.map(value => string(value, name)));
      case 'hasproperty': count(name, args, 1); return object.hasProperty(string(args[0], name));
    }
  }
  if (object instanceof BaseLink) {
    if (name === 'asfile') { count(name, args, 0); return resolveBaseFile(context, object); }
    if (name === 'linksto') { count(name, args, 1); expect(args[0], ['file'], name); return object.resolve()?.path === (args[0] instanceof BaseFile ? args[0].path : undefined); }
  }
  if (object instanceof BaseTag && name === 'matches') { count(name, args, 1); return object.matches(string(args[0], name)); }
  if (object instanceof RegExp && name === 'matches') { count(name, args, 1); return object.test(string(args[0], name)); }
  if (object instanceof BaseDate) {
    count(name, args, name === 'format' ? 1 : 0);
    if (name === 'format') return moment(object.date).format(string(args[0], name));
    if (name === 'date') return object.dateOnly();
    if (name === 'time') return [object.date.getHours(), object.date.getMinutes(), object.date.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
    if (name === 'relative') return new BaseDate(object.date, object.time, true, now(context));
  }
  if (typeof object === 'number') {
    if (['abs', 'floor', 'ceil'].includes(name)) { count(name, args, 0); return Math[name as 'abs' | 'floor' | 'ceil'](object); }
    if (name === 'round') { count(name, args, 0, 1); if (args[0] !== undefined) number(args[0], name); const precision = args[0] === undefined ? 0 : number(args[0], name); const factor = precision > 0 ? 10 ** precision : 1; return Math.round(object * factor) / factor; }
    if (name === 'tofixed') { count(name, args, 1); return object.toFixed(number(args[0], name)); }
  }
  if (Array.isArray(object)) return listFunction(name, object, args);
  if (object !== null && typeof object === 'object' && type === 'object') {
    if (name === 'keys') { count(name, args, 0); return Object.keys(object); }
    if (name === 'values') { count(name, args, 0); return Object.values(object); }
  }
  if (['string', 'tag', 'link', 'url', 'icon', 'image', 'html', 'markdown'].includes(type)) return textFunction(name, object, args);
  throw new Error('尚不支持的函数：' + rawName + ' on ' + type);
}
