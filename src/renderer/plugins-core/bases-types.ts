/**
 * [INPUT]: 库文件、富值适配器和数据库表达式。
 * [OUTPUT]: 导出公式上下文、延迟表达式、视图配置和查询行协议。
 * [POS]: Bases 语言与数据边界。动态属性为 unknown，调用方先验证值类型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFile } from '../core/vault.js';
import type { BaseFile } from './bases-values-file.js';
import type { BaseLink, BaseTag } from './bases-values.js';
export interface FormulaContext {
  app?: App; file: BaseFile | null; note: Record<string, unknown>; formula: Record<string, unknown>;
  this: BaseFile | null; vars: Record<string, unknown>; tags: BaseTag[]; links: BaseLink[];
  now?: () => Date; random?: () => number; __baseBudget?: { remaining: number };
}
export type BaseExpression = (context: FormulaContext) => unknown;
export type BaseFilter = (context: FormulaContext) => boolean;
export interface BaseViewConfig extends Record<string, unknown> {
  cardSize?: number; columnWidth?: number; image?: string; imageProperty?: string; imageFit?: string; imageAspectRatio?: number;
  markers?: string; rowHeight?: string; indentProperties?: boolean; separator?: string;
  type: string; name: string; filters?: unknown; sort?: { property?: string; column?: string; direction?: string }[];
  order?: string[]; groupOrder?: unknown[] | null; columnSize?: Record<string, number>; summaries?: Record<string, string>; limit?: number; groupBy?: { property?: string; direction?: string };
}
export interface BaseDocumentData extends Record<string, unknown> {
  summaries?: Record<string, string>; views: BaseViewConfig[]; formulas?: Record<string, string>; newItemFolder?: string; newItemTemplate?: string; properties?: Record<string, { displayName?: string; [key: string]: unknown }>; filters?: unknown;
}
export interface BaseQueryRow { file: TFile; context: FormulaContext; included: boolean; warning?: string; }
export interface BaseQueryResult { rows: BaseQueryRow[]; columns: string[]; warnings: string[]; total?: number; }

export interface BaseQueryCache {
  document?: import('./bases-model.js').BaseDocument | null; view?: BaseViewConfig; sourceFile?: TFile | null;
  entries?: Map<string, BaseQueryRow>; dirty?: Set<string>; evaluated?: number;
}
export interface BaseRowGroup { id: string; key: unknown; rows: BaseQueryRow[]; grouped: boolean; }
