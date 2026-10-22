/**
 * [INPUT]: queryBase 的有序行、视图分组配置与 propertyValue 属性读取器。
 * [OUTPUT]: 导出分组、汇总、适用汇总名称与共用值格式化函数。
 * [POS]: Bases 展示计算层。分组与汇总只消费查询结果，不改笔记或 YAML。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { propertyValue } from './bases-model.js';

export const SUMMARY_NAMES = ['Empty', 'Filled', 'Unique', 'Average', 'Min', 'Max', 'Sum', 'Range', 'Median', 'Stddev', 'Earliest', 'Latest', 'Checked', 'Unchecked'];
export { formatBaseValue } from './bases-values.js';
import { baseEquals, baseValueType, compareBaseValues, formatBaseValue } from './bases-values.js';
import { compileExpression } from './bases-expression.js';
const identity = value => value == null ? 'null' : (value.kind || typeof value) + ':' + formatBaseValue(value);

export function groupRows(rows, view) {
  if (!view.groupBy) return [{ id: 'all', key: null, rows, grouped: false }];
  const { property, direction } = view.groupBy;
  if (typeof property !== 'string' || !['ASC', 'DESC'].includes(direction)) throw new Error('groupBy 需要 property 与 ASC/DESC direction');
  const groups = new Map();
  for (const row of rows) {
    const key = propertyValue(row.context, property);
    let group = [...groups.values()].find(item => baseEquals(item.key, key));
    if (!group) { const id = identity(key) + ':' + groups.size; group = { id, key, rows: [], grouped: true }; groups.set(id, group); }
    group.rows.push(row);
  }
  if (Array.isArray(view.groupOrder)) {
    return view.groupOrder.map(key => [...groups.values()].find(group => baseEquals(group.key, key)) || { id: identity(key), key, rows: [], grouped: true });
  }
  return [...groups.values()].sort((a, b) => compareBaseValues(a.key, b.key) * (direction === 'DESC' ? -1 : 1));
}

const SUMMARY_FORMULAS = {
  Average: 'values.mean().round(2)', Min: 'values.min()', Max: 'values.max()', Sum: 'values.sum().round(2)',
  Range: 'values.max() - values.min()', Median: 'values.median()', Stddev: 'values.stddev().round(2)',
  Earliest: 'values.earliest()', Latest: 'values.latest()', Checked: 'values.filter(value == true).length',
  Unchecked: 'values.filter(value == false).length', Empty: 'values.filter(value.isType("null")).length',
  Filled: 'values.filter(!value.isType("null")).length', Unique: 'values.unique().length',
};
export function summaryNamesFor(rows, property) {
  const types = new Set();
  for (const row of rows) {
    try { const value = propertyValue(row.context, property); if (value != null) types.add(baseValueType(value)); } catch {}
  }
  const names = ['Empty', 'Filled', 'Unique'];
  if (types.size === 1 && types.has('number')) names.push('Average', 'Min', 'Max', 'Sum', 'Range', 'Median', 'Stddev');
  if (types.size === 1 && types.has('date')) names.push('Earliest', 'Latest', 'Range');
  if (types.size === 1 && types.has('boolean')) names.push('Checked', 'Unchecked');
  return names;
}
export function summarizeRows(rows, property, name, document) {
  const values = rows.map(row => propertyValue(row.context, property));
  const custom = document.data.summaries || {};
  let source = Object.hasOwn(custom, name) ? custom[name] : SUMMARY_FORMULAS[name];
  if (!source) throw new Error('尚不支持的汇总：' + name);
  if (name === 'Range' && !Object.hasOwn(custom, name) && values.some(value => baseValueType(value) === 'date')) source = 'values.latest() - values.earliest()';
  const context = rows[0]?.context || { note: {}, file: null, formula: {}, tags: [], links: [] };
  return compileExpression(source)({ ...context, vars: { ...context.vars, values } });
}
