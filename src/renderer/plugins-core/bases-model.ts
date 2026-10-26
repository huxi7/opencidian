/**
 * [INPUT]: js-yaml 读取数据库文本；表达式计算筛选；上下文与值层定义属性、真值和排序；MetadataCache 排除笔记。
 * [OUTPUT]: 导出 BaseDocument、queryBase 与属性读取函数；查询供四类视图复用，按文件失效行上下文缓存。块式 YAML 局部写回，拒绝越界索引与原型键。
 * [POS]: Bases 数据边界。缺失或空视图仅在内存补默认表格；首次视图编辑才写盘。流式根保留前导注释与文档头。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { compileExpression } from './bases-expression.js';
import { createContext, propertyValue } from './bases-context.js';
import { baseTruthy, compareBaseValues, safeKey } from './bases-values.js';
import { t } from '../core/i18n.js';
import type { FormulaContext, BaseFilter, BaseViewConfig, BaseDocumentData, BaseQueryRow, BaseQueryResult, BaseQueryCache } from './bases-types.js';
import type { TFile } from '../core/vault.js';
export { createContext, propertyValue } from './bases-context.js';
const yaml: typeof import('js-yaml') = require('js-yaml');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const dump = (value: unknown): string => yaml.dump(value, { lineWidth: -1, noRefs: true, quotingType: '"' }).trimEnd();
export const EMPTY_BASE = 'views:\n  - type: table\n    name: Table\n';

export class BaseDocument {
  source: string;
  data: BaseDocumentData;
  missingViews: boolean;
  implicitViews: boolean;

  constructor(source: string) {
    this.source = source;
    const loaded: unknown = yaml.load(source) ?? {};
    assertBaseData(loaded);
    this.data = loaded;
    this.missingViews = !Object.hasOwn(this.data, 'views');
    this.implicitViews = !this.data.views?.length;
    if (this.implicitViews) this.data.views = [{ type: 'table', name: t('plugins.bases.label-default-view') }];
  }
  getView(name?: string) { return name ? (this.data.views || []).find((view) => view.name === name) : this.data.views?.[0]; }
  /** 普通块 YAML 原地替换；流式 YAML 只重写最近父区段，未知数据仍保留。 */
  patch(path: (string | number)[], value: unknown): BaseDocument {
    if (!Array.isArray(path) || !path.length) throw Error('写入路径不能为空。');
    const next: Record<string, unknown> = yaml.load(dump(this.data)) as Record<string, unknown>;
    let owner: Record<string, unknown> | unknown[] = next;
    for (const key of path.slice(0, -1)) {
      safeKey(key);
      if (Array.isArray(owner) && (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key >= owner.length)) throw Error('写入数组索引无效。');
      let child: unknown = Array.isArray(owner) ? owner[Number(key)] : owner[String(key)];
      if (!child || typeof child !== 'object') { child = {}; if (Array.isArray(owner)) owner[Number(key)] = child; else owner[String(key)] = child; }
      owner = child as Record<string, unknown> | unknown[];
    }
    const last = path.at(-1); safeKey(last);
    if (Array.isArray(owner) && (typeof last !== 'number' || !Number.isInteger(last) || last < 0 || last >= owner.length)) throw Error('写入数组索引无效。');
    if (Array.isArray(owner)) owner[Number(last)] = value; else owner[String(last)] = value;
    // 整段或流式写回也不能把未操作的内存默认表格序列化。
    if (path[0] !== 'views' && this.implicitViews) {
      if (this.missingViews) delete next.views;
      else { const original: unknown = yaml.load(this.source); next.views = object(original) ? original.views : undefined; }
    }
    const lines = this.source.split(/\r?\n/);
    const prefix = flowRootPrefix(this.source);
    if (prefix !== null) {
      const newline = this.source.includes('\r\n') ? '\r\n' : '\n';
      return new BaseDocument(prefix + dump(next).replace(/\n/g, newline) + newline);
    }
    const range = findRange(lines, path, 0, lines.length, 0);
    let output;
    if (range) {
      const { start, end, indent, key, insert } = range;
      const serialized = dump({ [key]: value }).split('\n').map((line: string) => ' '.repeat(indent) + line);
      lines.splice(start, insert ? 0 : end - start, ...serialized);
      output = lines.join(this.source.includes('\r\n') ? '\r\n' : '\n');
    } else {
      const top = path[0], topRange = findRange(lines, [top], 0, lines.length, 0);
      const replacement = dump({ [top]: next[top] });
      if (topRange && (!topRange.insert || !Object.hasOwn(this.data, top) || (top === 'views' && this.missingViews))) { lines.splice(topRange.start, topRange.end - topRange.start, replacement); output = lines.join('\n'); }
      else if (Object.hasOwn(this.data, top)) output = dump(next) + '\n';
      else output = this.source.trimEnd() + '\n' + replacement + '\n';
    }
    try { return new BaseDocument(output); }
    catch (error) {
      // 修改锚点定义会使原文别名失效；退回无别名序列化，保留每个键的值。
      if (/unidentified alias/.test(error instanceof Error ? error.message : String(error))) return new BaseDocument(dump(next) + '\n');
      throw error;
    }
  }
}
/** 只识别首个 YAML 实体；前导注释、指令和文档头留在原位。 */
function flowRootPrefix(source: string) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n', lines = source.split(/\r?\n/);
  let first = 0;
  while (first < lines.length) {
    const line = lines[first].trim();
    if (line && !line.startsWith('#') && !line.startsWith('%') && !/^---(?:\s*#.*)?$/.test(line)) break;
    first++;
  }
  if (!lines[first]?.trimStart().startsWith('{')) return null;
  return lines.slice(0, first).join(newline) + (first ? newline : source.startsWith('\uFEFF') ? '\uFEFF' : '');
}
function findRange(lines: string[], path: (string | number)[], start: number, end: number, indent: number): { start: number; end: number; indent: number; key: string; insert?: boolean } | null {
  if (typeof path[0] === 'number') {
    const items: number[] = [];
    for (let i = start; i < end; i++) if (new RegExp('^ {' + indent + '}-\\s').test(lines[i])) items.push(i);
    const row = items[path[0]];
    if (row === undefined) return null;
    // 首项键写在短横线后，修改该键需回退到父区段。
    const key = String(path[1]);
    if (new RegExp('^ {' + indent + '}-\\s*(?:' + escapeRE(key) + '|"' + escapeRE(key) + '")\\s*:').test(lines[row])) return null;
    return findRange(lines, path.slice(1), row + 1, items[Number(path[0]) + 1] ?? end, indent + 2);
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
    const childIndent = lines.slice(i + 1, stop).find((line: string) => line.trim() && !line.trimStart().startsWith('#'))?.search(/\S/);
    return findRange(lines, path.slice(1), i + 1, stop, childIndent ?? indent + 2);
  }
  if (path.length === 1) return { start: end, end, indent, key, insert: true };
  return null;
}
function escapeRE(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function compileFilter(filter: unknown): BaseFilter {
  if (filter == null) return () => true;
  if (typeof filter === 'string') { const expression = compileExpression(filter); return (context: FormulaContext) => baseTruthy(expression(context)); }
  if (!object(filter) || Object.keys(filter).length !== 1) throw new Error('filters 只允许一个 and、or 或 not 键');
  const key = Object.keys(filter)[0], values = filter[key];
  if (!['and', 'or', 'not'].includes(key) || !Array.isArray(values)) throw new Error('and、or、not 必须是数组');
  const tests = values.map(compileFilter);
  return (context) => key === 'and' ? tests.every((test) => test(context)) : key === 'or' ? tests.some((test) => test(context)) : !tests.some((test) => test(context));
}
export function queryBase(app: App, document: BaseDocument, view: BaseViewConfig | undefined, sourceFile: TFile | null = null, cache: BaseQueryCache | null = null): BaseQueryResult {
  if (!view) return { rows: [], columns: [], warnings: ['未定义视图'] };
  if (!['table', 'list', 'cards', 'kanban'].includes(view.type)) return { rows: [], columns: [], warnings: ['尚不支持的视图类型：' + view.type + '。原始配置已保留。'] };
  const tests = [compileFilter(document.data.filters), compileFilter(view.filters)];
  const rows: BaseQueryRow[] = [], warnings = new Set<string>();
  const reusable = cache && cache.document === document && cache.view === view && cache.sourceFile === sourceFile;
  const entries = reusable ? cache!.entries || new Map<string, BaseQueryRow>() : new Map<string, BaseQueryRow>(), alive = new Set<string>();
  // 跨文件公式和宿主属性在任意文件变化时重新求值。
  const relational = /\b(?:this|now|today)\b|\bfile\s*\(|\b(?:backlinks|links|tags|hasLink|hasTag|properties)\b/i.test(JSON.stringify([document.data.filters, view.filters, document.data.formulas]));
  const invalidateAll = reusable && relational && (cache?.dirty?.size || 0) > 0;
  let evaluated = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (app.metadataCache.isUserIgnored?.(file.path)) continue;
    alive.add(file.path);
    let entry = entries.get(file.path);
    if (!entry || entry.file !== file || invalidateAll || cache?.dirty?.has(file.path)) {
      const context = createContext(app, file, document.data.formulas, sourceFile);
      entry = { file, context, included: false }; evaluated++;
      try { entry.included = tests.every(test => test(context)); }
      catch (error) { entry.warning = '筛选无法计算：' + (error instanceof Error ? error.message : String(error)); }
      entries.set(file.path, entry);
    }
    if (entry.warning) warnings.add(entry.warning);
    if (entry.included) rows.push(entry);
  }
  for (const path of entries.keys()) if (!alive.has(path)) entries.delete(path);
  if (cache) { Object.assign(cache, { document, view, sourceFile, entries, evaluated }); cache.dirty?.clear(); }
  // 未知筛选不能产生看似完整的结果。
  if (warnings.size) return { rows: [], columns: [], warnings: [...warnings] };
  const sorts = Array.isArray(view.sort) ? view.sort : [{ property: 'file.name', direction: 'ASC' }];
  rows.sort((a, b) => {
    for (const sort of sorts) {
      const property = sort.property || sort.column;
      if (!property) continue;
      let x, y;
      try { x = propertyValue(a.context, property); y = propertyValue(b.context, property); }
      catch (error) { warnings.add(error instanceof Error ? error.message : String(error)); continue; }
      const value = compareBaseValues(x, y);
      if (value) return sort.direction === 'DESC' ? -value : value;
    }
    return a.file.path.localeCompare(b.file.path, undefined, { numeric: true });
  });
  const columns = Array.isArray(view.order) ? view.order : ['file.name'];
  const limited = typeof view.limit === 'number' && view.limit > 0 ? rows.slice(0, Math.floor(view.limit)) : rows;
  return { rows: limited, columns, warnings: [...warnings], total: rows.length };
}

function assertBaseData(value: unknown): asserts value is BaseDocumentData {
  if (!object(value)) throw Error('数据库必须是 YAML 对象');
  if (value.views != null && !Array.isArray(value.views)) throw Error('views 必须是数组');
  for (const field of ['formulas', 'properties', 'summaries']) if (value[field] != null && !object(value[field])) throw Error(field + ' 必须是对象');
  for (const [key, formula] of Object.entries(value.formulas || {})) if (typeof formula !== 'string') throw Error('公式必须是字符串：' + key);
  compileFilter(value.filters);
  for (const view of Array.isArray(value.views) ? value.views : []) {
    if (!object(view) || typeof view.type !== 'string' || typeof view.name !== 'string' || !view.name) throw Error('视图需要 type 与 name');
    compileFilter(view.filters);
    if (view.order != null && (!Array.isArray(view.order) || view.order.some(item => typeof item !== 'string'))) throw Error('order 必须是属性名数组');
    if (view.sort != null && (!Array.isArray(view.sort) || view.sort.some(item => !object(item) || item.property != null && typeof item.property !== 'string' || item.column != null && typeof item.column !== 'string' || item.direction != null && typeof item.direction !== 'string'))) throw Error('sort 必须是排序配置数组');
  }
}
