/**
 * [INPUT]: 查询源码、文件对象和元数据缓存。
 * [OUTPUT]: 导出搜索语法树、正文切片、命中与结果协议。
 * [POS]: 搜索解析、匹配和结果界面的共享边界，不依赖 DOM 实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFile } from '../core/vault.js';
import type { CachedMetadata } from '../core/metadata-types.js';
export interface SearchRegex { source: string; flags: string; }
export interface SearchValueNode { type: 'value'; field: string; value?: string; exact?: boolean; regex?: SearchRegex | null; }
export type SearchNode = SearchValueNode
  | { type: 'and' | 'or'; children: SearchNode[] }
  | { type: 'not'; child: SearchNode }
  | { type: 'case'; caseSensitive: boolean; child: SearchNode }
  | { type: 'scope'; scope: string; state: boolean | null; child: SearchNode | null }
  | { type: 'property'; key: SearchValueNode; value: SearchValueNode | null }
  | { type: 'true' };
export type SearchToken = { kind: '(' | ')' | 'or' | 'not' }
  | { kind: 'string' | 'word' | 'property'; text: string }
  | ({ kind: 'regex' } & SearchRegex);
export interface SearchInfo { label: string; value?: string; children?: SearchInfo[]; }
export interface SearchRange { start: number; end: number; }
export interface SearchDocRange extends SearchRange { startLine: number; endLine: number; }
export interface SearchDocument {
  file: TFile; text: string; cache: Partial<CachedMetadata>; lines: string[]; offsets: number[];
  sections: SearchDocRange[]; blocks: SearchDocRange[];
}
export interface SearchField { field: string; ranges?: SearchRange[]; value?: string; }
export interface SearchProperty { key: string; value: string; ranges: SearchRange[]; }
export interface SearchEval { ok: boolean; content: SearchRange[]; fields: SearchField[]; properties?: SearchProperty[]; }
export interface SearchMatch extends SearchRange { line: number; lineStart: number; lineEnd: number; }
export interface SearchEvaluation { content: SearchMatch[]; fields: SearchField[]; properties: SearchProperty[]; score: number; flair: number; }
export interface SearchResult { file: TFile; doc: SearchDocument; evaluation: SearchEvaluation; }

interface SearchRowBase { key: string; groupKey: string; result: SearchResult; height?: number; }
export interface SearchFileRow extends SearchRowBase { kind: 'file'; }
export interface SearchMatchRow extends SearchRowBase { kind: 'match'; plain: boolean; text: string; ranges: SearchRange[]; start: number; end: number; line: number | null; ch: number; }
export type SearchRow = SearchFileRow | SearchMatchRow;
export interface SearchGroup { key: string; result: SearchResult; rows: SearchRow[]; }
export type TrackSearchRow = (key: string, element: HTMLElement, kind: SearchRow['kind']) => void;
export interface SearchViewportRange { start: number; end: number; top: number; total: number; }
