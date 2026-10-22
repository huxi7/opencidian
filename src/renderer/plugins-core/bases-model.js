/**
 * [INPUT]: js-yaml 读取数据库文本；表达式模块计算筛选；Vault 与 MetadataCache 提供笔记。
 * [OUTPUT]: 导出 BaseDocument、queryBase 与属性读取函数；块式 YAML 局部写回。
 * [POS]: Bases 数据边界。保留未知键和视图；流式或锚点冲突时保留值重写。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { compileExpression } from './bases-expression.js';
const yaml = require('js-yaml');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dump = value => yaml.dump(value, { lineWidth: -1, noRefs: true, quotingType: '"' }).trimEnd();
export const EMPTY_BASE = 'views:\n  - type: table\n    name: Table\n';

export class BaseDocument {
  constructor(source) {
    this.source = source;
    this.data = yaml.load(source) || {};
    if (!object(this.data)) throw new Error('数据库必须是 YAML 对象');
    if (this.data.views != null && !Array.isArray(this.data.views)) throw new Error('views 必须是数组');
    if (this.data.formulas != null && !object(this.data.formulas)) throw new Error('formulas 必须是对象');
    if (this.data.properties != null && !object(this.data.properties)) throw new Error('properties 必须是对象');
    for (const [key, value] of Object.entries(this.data.formulas || {})) if (typeof value !== 'string') throw new Error('公式必须是字符串：' + key);
    compileFilter(this.data.filters);
    for (const view of this.data.views || []) {
      if (!object(view) || typeof view.type !== 'string' || typeof view.name !== 'string' || !view.name) throw new Error('视图需要 type 与 name');
      compileFilter(view.filters);
    }
  }
  getView(name) { return name ? (this.data.views || []).find(view => view.name === name) : this.data.views?.[0]; }
  /** 普通块 YAML 原地替换；流式 YAML 只重写最近父区段，未知数据仍保留。 */
  patch(path, value) {
    const next = yaml.load(dump(this.data));
    let owner = next;
    for (const key of path.slice(0, -1)) { if (!owner[key] || typeof owner[key] !== 'object') owner[key] = {}; owner = owner[key]; }
    owner[path.at(-1)] = value;
    const lines = this.source.split(/\r?\n/);
    if (/^\s*\{/.test(this.source)) return new BaseDocument(dump(next) + '\n');
    const range = findRange(lines, path, 0, lines.length, 0);
    let output;
    if (range) {
      const { start, end, indent, key, insert } = range;
      const serialized = dump({ [key]: value }).split('\n').map(line => ' '.repeat(indent) + line);
      lines.splice(start, insert ? 0 : end - start, ...serialized);
      output = lines.join(this.source.includes('\r\n') ? '\r\n' : '\n');
    } else {
      const top = path[0], topRange = findRange(lines, [top], 0, lines.length, 0);
      const replacement = dump({ [top]: next[top] });
      if (topRange && (!topRange.insert || !Object.hasOwn(this.data, top))) { lines.splice(topRange.start, topRange.end - topRange.start, replacement); output = lines.join('\n'); }
      else if (Object.hasOwn(this.data, top)) output = dump(next) + '\n';
      else output = this.source.trimEnd() + '\n' + replacement + '\n';
    }
    try { return new BaseDocument(output); }
    catch (error) {
      // 修改锚点定义会使原文别名失效；退回无别名序列化，保留每个键的值。
      if (/unidentified alias/.test(error.message)) return new BaseDocument(dump(next) + '\n');
      throw error;
    }
  }
}
function findRange(lines, path, start, end, indent) {
  if (typeof path[0] === 'number') {
    const items = [];
    for (let i = start; i < end; i++) if (new RegExp('^ {' + indent + '}-\\s').test(lines[i])) items.push(i);
    const row = items[path[0]];
    if (row === undefined) return null;
    // 首项键写在短横线后，修改该键需回退到父区段。
    const key = String(path[1]);
    if (new RegExp('^ {' + indent + '}-\\s*(?:' + escapeRE(key) + '|"' + escapeRE(key) + '")\\s*:').test(lines[row])) return null;
    return findRange(lines, path.slice(1), row + 1, items[path[0] + 1] ?? end, indent + 2);
  }
  const key = String(path[0]);
  const pattern = new RegExp('^ {' + indent + '}(?:' + escapeRE(key) + '|"' + escapeRE(key) + '"|\'' + escapeRE(key) + '\')\\s*:');
  for (let i = start; i < end; i++) {
    if (!pattern.test(lines[i])) continue;
    let stop = i + 1;
    while (stop < end && (!lines[stop].trim() || lines[stop].trimStart().startsWith('#') || lines[stop].search(/\S/) > indent)) stop++;
    // 保留目标区段之后的空行与独立注释。
    while (stop > i + 1 && (!lines[stop - 1].trim() || lines[stop - 1].trimStart().startsWith('#'))) stop--;
    if (path.length === 1) return { start: i, end: stop, indent, key };
    if (lines[i].slice(lines[i].indexOf(':') + 1).trim()) return null;
    const childIndent = lines.slice(i + 1, stop).find(line => line.trim() && !line.trimStart().startsWith('#'))?.search(/\S/);
    return findRange(lines, path.slice(1), i + 1, stop, childIndent ?? indent + 2);
  }
  if (path.length === 1) return { start: end, end, indent, key, insert: true };
  return null;
}
function escapeRE(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function compileFilter(filter) {
  if (filter == null) return () => true;
  if (typeof filter === 'string') { const expression = compileExpression(filter); return context => !!expression(context); }
  if (!object(filter) || Object.keys(filter).length !== 1) throw new Error('filters 只允许一个 and、or 或 not 键');
  const key = Object.keys(filter)[0], values = filter[key];
  if (!['and', 'or', 'not'].includes(key) || !Array.isArray(values)) throw new Error('and、or、not 必须是数组');
  const tests = values.map(compileFilter);
  return context => key === 'and' ? tests.every(test => test(context)) : key === 'or' ? tests.some(test => test(context)) : !tests.some(test => test(context));
}
export function createContext(app, file, formulas = {}) {
  const cache = app.metadataCache.getFileCache(file) || {};
  const note = { ...(cache.frontmatter || {}) }; delete note.position;
  const tags = [...(Array.isArray(note.tags) ? note.tags : typeof note.tags === 'string' ? note.tags.split(/[,\s]+/) : []), ...(cache.tags || []).map(tag => tag.tag)].map(tag => String(tag).replace(/^#/, ''));
  const fileProps = {
    file: file.basename, name: file.basename, basename: file.basename, fullname: file.name, path: file.path,
    folder: file.parent?.path || '', ext: file.extension, size: file.stat?.size || 0,
    ctime: file.stat?.ctime || 0, mtime: file.stat?.mtime || 0, tags,
    links: (cache.links || []).map(link => link.link), embeds: (cache.embeds || []).map(link => link.link),
    backlinks: Object.keys(app.metadataCache.resolvedLinks || {}).filter(path => app.metadataCache.resolvedLinks[path]?.[file.path]),
  };
  const context = { file: fileProps, note, tags, links: fileProps.links, formula: Object.create(null) };
  const evaluating = new Set(), cached = new Map();
  for (const [name, source] of Object.entries(formulas)) Object.defineProperty(context.formula, name, { enumerable: true, get() {
    if (cached.has(name)) return cached.get(name);
    if (evaluating.has(name)) throw new Error('公式循环引用：' + name);
    evaluating.add(name);
    try { const value = compileExpression(source)(context); cached.set(name, value); return value; }
    finally { evaluating.delete(name); }
  } });
  return context;
}
export function propertyValue(context, property) {
  if (property === 'file' || property === 'file.file') return context.file.file;
  if (property.startsWith('file.')) return context.file[property.slice(5)] ?? null;
  if (property.startsWith('formula.')) return context.formula[property.slice(8)] ?? null;
  return context.note[property.startsWith('note.') ? property.slice(5) : property] ?? null;
}
export function queryBase(app, document, view) {
  if (!view) return { rows: [], columns: [], warnings: ['未定义视图'] };
  if (view.type !== 'table') return { rows: [], columns: [], warnings: ['尚不支持的视图类型：' + view.type + '。原始配置已保留。'] };
  const tests = [compileFilter(document.data.filters), compileFilter(view.filters)];
  const rows = [], warnings = new Set();
  for (const file of app.vault.getMarkdownFiles()) {
    const context = createContext(app, file, document.data.formulas);
    try { if (tests.every(test => test(context))) rows.push({ file, context }); }
    catch (error) { warnings.add('筛选无法计算：' + error.message); }
  }
  // 未知筛选不能产生看似完整的结果。
  if (warnings.size) return { rows: [], columns: [], warnings: [...warnings] };
  const sorts = Array.isArray(view.sort) ? view.sort : [{ property: 'file.name', direction: 'ASC' }];
  rows.sort((a, b) => {
    for (const sort of sorts) {
      const property = sort.property || sort.column;
      if (!property) continue;
      let x, y;
      try { x = propertyValue(a.context, property); y = propertyValue(b.context, property); }
      catch (error) { warnings.add(error.message); continue; }
      const value = x == null ? (y == null ? 0 : -1) : y == null ? 1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      if (value) return sort.direction === 'DESC' ? -value : value;
    }
    return a.file.path.localeCompare(b.file.path, undefined, { numeric: true });
  });
  const columns = Array.isArray(view.order) ? view.order : ['file.name'];
  const limited = typeof view.limit === 'number' && view.limit > 0 ? rows.slice(0, Math.floor(view.limit)) : rows;
  return { rows: limited, columns, warnings: [...warnings], total: rows.length };
}
