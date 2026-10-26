/**
 * [INPUT]: App、Markdown token 与取消信号。
 * [OUTPUT]: 阅读环境、渲染选项、嵌入任务和属性编辑契约。
 * [POS]: 阅读与属性模块共享的输入边界，不加载渲染实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { PropertyTypes } from './properties-types.js';
export interface ReadingEnvironment { app?: App; sourcePath?: string; depth?: number; }
export interface MarkdownRenderOptions { signal?: AbortSignal; depth?: number; }
export interface MarkdownInteractionOptions { signal?: AbortSignal; }
interface EmbedTask { id: string; path: string; }
export type PendingEmbed =
  | (EmbedTask & { kind: 'base'; viewName: string; sourcePath?: string })
  | (EmbedTask & { kind: 'canvas'; linktext: string; sourcePath?: string })
  | (EmbedTask & { kind: 'markdown'; subpath: string; depth: number });
export interface PropertyValue { key: string; value: unknown; }
export interface PropertyRow extends PropertyValue { type: string; typeInfo: ReturnType<PropertyTypes['getTypeInfo']>; }
export interface PropertyRenderOptions {
  editable?: boolean; showAddButton?: boolean; frontmatter?: Record<string, unknown> | null;
  fmError?: unknown; onShowSource?(): void;
}
export type PropertyWidget = ReturnType<PropertyTypes['getWidget']>;
