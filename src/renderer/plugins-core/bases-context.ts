/**
 * [INPUT]: Vault 文件、MetadataCache、公式定义与数据库或嵌入宿主文件。
 * [OUTPUT]: 导出 createContext(app,file,formulas,sourceFile?) 与 propertyValue。
 * [POS]: Bases 行上下文。file 指当前行；this 指数据库或 Markdown 嵌入宿主；共用公式 AST，按行缓存结果并检测循环。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFile } from '../core/vault.js';
import type { FormulaContext, BaseExpression } from './bases-types.js';
import { compileExpression } from './bases-expression.js';
import { BaseFile } from './bases-values-file.js';
import { baseAccess, ownKey } from './bases-values.js';
class BaseThisFile extends BaseFile {
  declare entry: FormulaContext;

  constructor(app: App, file: TFile, entry: FormulaContext) { super(app, file); this.entry = entry; }
  access(key: unknown): unknown {
    const name = String(key).toLowerCase();
    if (name === 'file' || name === 'note' || name === 'formula') return this.entry[name];
    if (name === 'this') return this;
    const actual = ownKey(this.entry.note, key); return actual === undefined ? null : this.entry.note[actual];
  }
}
const compiledDocuments = new WeakMap<Record<string, string>, Map<string, { source: string; evaluate: BaseExpression }>>();
export function createContext(app: App, file: TFile, formulas: Record<string, string> = {}, sourceFile: TFile | null = null): FormulaContext {
  const value = new BaseFile(app, file), note = value.properties();
  const localFile = sourceFile ? new BaseThisFile(app, sourceFile, createContext(app, sourceFile, formulas)) : null;
  if (localFile) localFile.entry.this = localFile;
  const context: FormulaContext = { app, file: value, note, tags: value.tags(), links: value.refs(), formula: Object.create(null), this: localFile, vars: Object.create(null) };
  const evaluating = new Set<string>(), cached = new Map<string, unknown>();
  let compiled = compiledDocuments.get(formulas);
  if (!compiled) { compiled = new Map(); compiledDocuments.set(formulas, compiled); }
  for (const [name, source] of Object.entries(formulas)) Object.defineProperty(context.formula, name, { enumerable: true, get() {
    if (cached.has(name)) return cached.get(name);
    if (evaluating.has(name)) throw new Error('公式循环引用：' + name);
    evaluating.add(name);
    try {
      if (compiled!.get(name)?.source !== source) compiled!.set(name, { source, evaluate: compileExpression(source) });
      const result = compiled!.get(name)!.evaluate(context); cached.set(name, result); return result;
    } finally { evaluating.delete(name); }
  } });
  return context;
}
export function propertyValue(context: FormulaContext, property: string) {
  if (property === 'file' || property === 'file.file') return context.file;
  if (property.startsWith('file.')) return baseAccess(context.file, property.slice(5), context);
  const object = property.startsWith('formula.') ? context.formula : context.note;
  const name = property.startsWith('formula.') ? property.slice(8) : property.startsWith('note.') ? property.slice(5) : property;
  const key = ownKey(object, name); return key === undefined ? null : object[key];
}
