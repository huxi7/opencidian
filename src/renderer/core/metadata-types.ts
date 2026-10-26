/**
 * [INPUT]: Markdown 文件、正文位置与 YAML 对象。
 * [OUTPUT]: 导出正文索引、链接、标签和属性缓存协议。
 * [POS]: 元数据生产者与查询消费者共享的结构，不依赖界面实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFile } from './vault.js';
export type FrontMatter = Record<string, unknown>;
export interface SourcePoint { line: number; col: number; offset?: number; }
export interface SourcePosition { start: SourcePoint; end: SourcePoint; }
export interface CacheHeading { heading: string; level: number; position: SourcePosition; }
export interface CacheLink {
  link: string; displayText?: string; original: string; subpath?: string;
  isExternal?: boolean; position: SourcePosition;
}
export interface CacheTag { tag: string; position: SourcePosition; frontmatter?: boolean; }
export interface CacheBlock { id: string; position: SourcePosition; }
export interface CacheSection { type: string; position: SourcePosition | null; }
export interface CachedMetadata {
  file: TFile; _rawText: string; frontmatter: FrontMatter; aliases: string[];
  tags: CacheTag[]; headings: CacheHeading[]; links: CacheLink[]; embeds: CacheLink[];
  sections: CacheSection[]; blocks: Record<string, CacheBlock>; position: SourcePosition | null;
  frontmatterLinks?: CacheLink[]; frontmatterPosition?: SourcePosition; frontmatterError?: string;
}
export interface FrontmatterParseResult {
  frontmatter: FrontMatter; body: string; startLine: number; endLine: number;
  rawFrontmatter?: string; error?: unknown;
}
export type LinkCounts = Record<string, number>;
export type LinkResolution = Record<string, LinkCounts>;
