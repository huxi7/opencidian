/**
 * [INPUT]: 接收 YAML 属性、公式标量与 Moment 日期运算。
 * [OUTPUT]: 导出日期、时长、链接、标签与展示值，以及统一格式化和比较函数。
 * [POS]: Bases 富值边界。公式、查询、视图和 CSV 共用类型语义，不暴露宿主对象原型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const moment = require('moment');
export const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
export function safeKey(key) {
  if (BLOCKED_KEYS.has(String(key).toLowerCase())) throw new Error('禁止访问属性：' + key);
  return String(key);
}
export function ownKey(object, key) {
  safeKey(key);
  if (Object.hasOwn(object, key)) return key;
  return Object.keys(object).find(candidate => candidate.toLowerCase() === String(key).toLowerCase());
}
export class BaseDate {
  declare kind: string;
  declare date: Date;
  declare time: any;
  declare relative: any;
  declare now: any;

  constructor(date, time = true, relative = false, now = undefined) {
    this.kind = 'date'; this.date = new Date(date); this.time = time; this.relative = relative; this.now = now;
  }
  toString() {
    if (this.relative) return moment(this.date).from(this.now ?? new Date());
    const date = this.date, pad = value => String(value).padStart(2, '0');
    const day = String(date.getFullYear()).padStart(4, '0') + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    return this.time ? day + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) : day;
  }
  dateOnly() { return new BaseDate(moment(this.date).startOf('day').toDate(), false); }
  access(key) {
    const getters = { year: 'getFullYear', month: 'getMonth', day: 'getDate', hour: 'getHours', minute: 'getMinutes', second: 'getSeconds', millisecond: 'getMilliseconds', timestamp: 'getTime' };
    const name = String(key).toLowerCase();
    if (!getters[name]) throw new Error('日期没有属性：' + key);
    return this.date[getters[name]]() + (name === 'month' ? 1 : 0);
  }
}
export function parseBaseDate(input, compact = true) {
  if (input instanceof BaseDate) return input;
  if (typeof input !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.test(input)) return new BaseDate(new Date(input));
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return new BaseDate(new Date(input + 'T00:00:00'), false);
  if (compact && /^(?:\d{8}|\d{12})$/.test(input)) {
    const year = Number(input.slice(0, 4)), month = Number(input.slice(4, 6)) - 1, day = Number(input.slice(6, 8));
    const time = input.length === 12;
    return new BaseDate(new Date(year, month, day, time ? Number(input.slice(8, 10)) : 0, time ? Number(input.slice(10, 12)) : 0), time);
  }
  return null;
}
export class BaseDuration {
  declare kind: string;
  declare parts: Record<string, number>;

  constructor(parts) { this.kind = 'duration'; this.parts = { ...parts }; }
  toString() { return moment.duration(this.parts).humanize(); }
  add(date, sign = 1) {
    const result = new Date(date.date);
    const fields = { years: ['getFullYear', 'setFullYear'], months: ['getMonth', 'setMonth'], days: ['getDate', 'setDate'], hours: ['getHours', 'setHours'], minutes: ['getMinutes', 'setMinutes'], seconds: ['getSeconds', 'setSeconds'], milliseconds: ['getMilliseconds', 'setMilliseconds'] };
    for (const [unit, [get, set]] of Object.entries(fields)) {
      const amount = (this.parts[unit] || 0) + (unit === 'days' ? (this.parts.weeks || 0) * 7 : 0);
      if (amount) result[set](result[get]() + amount * sign);
    }
    const hasTime = ['hours', 'minutes', 'seconds', 'milliseconds'].some(unit => this.parts[unit]);
    return new BaseDate(result, date.time || hasTime);
  }
  milliseconds(now = new Date()) { return this.add(new BaseDate(now)).date.getTime() - new Date(now).getTime(); }
  access(key, now = new Date()) {
    const unit = String(key).toLowerCase();
    if (!['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'].includes(unit)) throw new Error('时长没有属性：' + key);
    return moment(this.add(new BaseDate(now)).date).diff(moment(now), unit, true);
  }
}
export function parseBaseDuration(input) {
  if (typeof input !== 'string') return null;
  // 原版 ISO 子串必须含 T。字段允许小数或逗号，但按整数解析。
  const iso = /P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/.exec(input);
  if (iso) {
    const [years, months, weeks, days, hours, minutes, seconds] = iso.slice(1).map(value => value === undefined ? 0 : parseInt(value, 10));
    return new BaseDuration({ years, months, days: days + weeks * 7, hours, minutes, seconds, milliseconds: 0 });
  }
  const short = /^(-?\d+) ?([dhmswMy]|(?:second|minute|hour|day|week|month|year)s?)$/.exec(input);
  if (!short) return null;
  const aliases = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days', w: 'weeks', M: 'months', y: 'years' };
  const unit = aliases[short[2]] || short[2].replace(/s$/, '') + 's';
  return new BaseDuration({ [unit]: Number(short[1]) });
}
const linkOwners = new WeakMap();
export class BaseLink {
  declare kind: any;
  declare path: any;
  declare display: any;

  constructor(path, display = null, app: App = null, sourcePath = '') {
    this.kind = /^(?:[a-z][\w+.-]*:|\/\/)/i.test(path) ? 'url' : 'link';
    const match = /^\[\[([\s\S]*?)\]\]$/.exec(path);
    const text = match ? match[1] : path;
    const pipe = text.lastIndexOf('|');
    this.path = pipe >= 0 ? text.slice(0, pipe) : text;
    this.display = display ?? (pipe >= 0 ? text.slice(pipe + 1) : null);
    linkOwners.set(this, { app, sourcePath });
  }
  toString() { return this.kind === 'url' ? this.path : '[[' + this.path + (this.display == null ? '' : '|' + formatBaseValue(this.display)) + ']]'; }
  resolve() { const owner = linkOwners.get(this), dest = owner.app?.metadataCache.getFirstLinkpathDest(this.path.split('#')[0], owner.sourcePath); return typeof dest === 'string' ? owner.app.vault.getFileByPath(dest) : dest || null; }
  owner() { return linkOwners.get(this); }
}
export class BaseTag {
  declare kind: string;
  declare value: any;

  constructor(tag) { this.kind = 'tag'; this.value = '#' + String(tag).replace(/^#/, ''); }
  toString() { return this.value; }
  matches(tag) { const a = this.value.toLowerCase(), b = '#' + String(tag).replace(/^#/, '').toLowerCase(); return a === b || a.startsWith(b + '/'); }
}
export class BaseDisplay {
  declare kind: any;
  declare value: any;

  constructor(kind, value) { this.kind = kind; this.value = value; }
  toString() { return this.value; }
}
export function baseValueType(value) {
  if (value == null) return 'null';
  if (value instanceof BaseDate) return 'date';
  if (value instanceof BaseDuration) return 'duration';
  if (value instanceof BaseLink) return value.kind;
  if (value instanceof BaseTag) return 'tag';
  if (value instanceof BaseDisplay) return value.kind;
  if (value.kind === 'file' && typeof value.access === 'function') return 'file';
  if (Array.isArray(value)) return 'list';
  if (value instanceof RegExp) return 'regexp';
  return typeof value;
}
/** 原版显式 type 与继承类型；kind 只供渲染分派，不自动成为公式类型名。 */
export function baseTypeNames(value) {
  const kind = baseValueType(value);
  if (kind === 'tag' || kind === 'icon') return ['string', 'any'];
  if (['link', 'url', 'image', 'html', 'markdown'].includes(kind)) return [kind, 'string', 'any'];
  if (kind === 'file' && value.constructor.name === 'BaseThisFile') return ['thisfile', 'file', 'any'];
  return [kind, 'any'];
}
export function baseTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof BaseDuration) return Object.values(value.parts).some(Boolean);
  if (value && baseValueType(value) === 'object') return Object.keys(value).length > 0;
  return !!value;
}
export function formatBaseValue(value, { nullText = '' } = {}) {
  if (value == null) return nullText;
  if (Array.isArray(value)) return value.map(item => formatBaseValue(item, { nullText: 'null' })).join(', ');
  if (baseValueType(value) === 'object') {
    const object = Object.fromEntries(Object.keys(value).map(key => [key, formatBaseValue(value[key], { nullText: 'null' })]));
    return JSON.stringify(object);
  }
  return String(value);
}
export function baseEquals(a, b, strict = false) {
  if (a === b || a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (!strict) {
    if (a instanceof BaseDate && typeof b === 'string') b = parseBaseDate(b, false) || b;
    if (b instanceof BaseDate && typeof a === 'string') a = parseBaseDate(a, false) || a;
    if (a instanceof BaseDuration && typeof b === 'string') b = parseBaseDuration(b) || b;
    if (b instanceof BaseDuration && typeof a === 'string') a = parseBaseDuration(a) || a;
    if (Array.isArray(a) && a.length === 1 && !Array.isArray(b)) return baseEquals(a[0], b);
    if (Array.isArray(b) && b.length === 1 && !Array.isArray(a)) return baseEquals(a, b[0]);
    if (a instanceof BaseLink && typeof b === 'string' && /^\[\[.*\]\]$/.test(b)) b = new BaseLink(b, null, a.owner().app);
    if (b instanceof BaseLink && typeof a === 'string' && /^\[\[.*\]\]$/.test(a)) a = new BaseLink(a, null, b.owner().app);
  }
  if (a instanceof BaseDate && b instanceof BaseDate) return strict ? a.time === b.time && +a.date === +b.date : +(a.time && b.time ? a : a.dateOnly()).date === +(a.time && b.time ? b : b.dateOnly()).date;
  if (a instanceof BaseDuration && b instanceof BaseDuration) return strict ? JSON.stringify(a.parts) === JSON.stringify(b.parts) : a.milliseconds() === b.milliseconds();
  if (a instanceof BaseTag && (b instanceof BaseTag || typeof b === 'string')) return a.value === String(b);
  if (a instanceof BaseLink && b instanceof BaseLink) return !strict && a.resolve() && b.resolve() ? a.resolve() === b.resolve() : a.path === b.path && (!strict || formatBaseValue(a.display) === formatBaseValue(b.display));
  if (baseValueType(a) === 'file' && (baseValueType(b) === 'file' || typeof b === 'string')) return a.path === (b.path ?? b);
  if (a instanceof BaseLink && baseValueType(b) === 'file') return a.resolve()?.path === b.path;
  if (b instanceof BaseLink && baseValueType(a) === 'file') return b.resolve()?.path === a.path;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => baseEquals(value, b[index], strict));
  if (baseValueType(a) === 'object' && baseValueType(b) === 'object') return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && baseEquals(a[key], b[key], strict));
  return false;
}
export function sortCompare(a, b) {
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  if (a instanceof BaseDate && b instanceof BaseDate) return a.date.getTime() - b.date.getTime();
  if (a instanceof BaseDuration && b instanceof BaseDuration) return a.milliseconds() - b.milliseconds();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return formatBaseValue(a).localeCompare(formatBaseValue(b), undefined, { numeric: true, sensitivity: 'base' });
}
export const compareBaseValues = sortCompare;
export function baseAccess(value, key, context: { now?: () => Date } = {}) {
  safeKey(key);
  if (value == null) return null;
  if (value instanceof BaseDate || value instanceof BaseDuration || baseValueType(value) === 'file') return value.access(key, context.now?.());
  if (typeof key === 'number') {
    if (!Number.isInteger(key)) throw new Error('索引必须是整数');
    if (Array.isArray(value)) return value[key < 0 ? value.length + key : key] ?? null;
    if (typeof value === 'string') return value.charAt(key);
    throw new Error('此值不支持数字索引');
  }
  if (String(key).toLowerCase() === 'length' && (typeof value === 'string' || Array.isArray(value) || value instanceof BaseTag || value instanceof BaseLink)) return (value instanceof BaseTag ? value.value : value instanceof BaseLink ? value.path : value).length;
  if (baseValueType(value) === 'object') { const name = ownKey(value, key); return name === undefined ? null : value[name]; }
  throw new Error(baseValueType(value) + ' 没有属性：' + key);
}
