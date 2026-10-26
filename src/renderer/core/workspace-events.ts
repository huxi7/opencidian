/**
 * [INPUT]: 文件、视图、编辑器与菜单的类型契约；不加载运行时模块。
 * [OUTPUT]: WorkspaceEvents 与 HoverLinkInfo，按名称绑定事件载荷。
 * [POS]: 工作区发布者与订阅者共用协议；拒绝错名与错位参数。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFile, VaultEntry } from './vault.js';
import type { WorkspaceLeaf, WorkspaceTabs } from './workspace-model.js';
import type { Menu } from './menu.js';
import type { Editor } from '../editor/editor.js';
import type { MarkdownView } from '../views/markdown-view.js';
import type { CanvasView } from '../views/canvas-view.js';
import type { CanvasNode } from '../views/canvas-node.js';
import type { CanvasEdge } from '../views/canvas-edge.js';
import type { SearchView } from '../plugins-core/global-search.js';

export interface HoverPopover {
  onTarget: boolean;
  readonly onHover: boolean;
  readonly isShown: boolean;
  transition(): void;
  hide(): void;
}
export interface HoverLinkInfo {
  event: MouseEvent;
  source: string;
  linktext: string;
  sourcePath?: string;
  targetEl?: HTMLElement | null;
  hoverParent?: { hoverPopover?: HoverPopover | null; isHoveringLink?(linktext: string): boolean } | null;
  state?: { line: number } | null;
}
export interface WorkspaceEvents {
  'layout-change': [];
  'settings-changed': [];
  'file-open': [file: TFile | null];
  'file-rename': [file: VaultEntry, oldPath: string];
  'file-delete': [file: VaultEntry];
  'active-leaf-change': [leaf: WorkspaceLeaf | null];
  'file-menu': [menu: Menu, file: VaultEntry, source: string, context?: unknown];
  'files-menu': [menu: Menu, files: VaultEntry[], source?: string, context?: unknown];
  'url-menu': [menu: Menu, href: string];
  'leaf-menu': [menu: Menu, leaf: WorkspaceLeaf];
  'tab-group-menu': [menu: Menu, tabs: WorkspaceTabs];
  'editor-menu': [menu: Menu, editor: Editor, owner: { file?: TFile | null }];
  'editor-change': [text: string, view: MarkdownView];
  'editor-selection-change': [view: MarkdownView];
  'markdown-view-file-loaded': [file: TFile | null, view: MarkdownView];
  'markdown-view-mode-change': [view: MarkdownView];
  'properties-type-change': [key?: string];
  'hover-link': [info: HoverLinkInfo];
  'search:results-menu': [menu: Menu, view: SearchView];
  'canvas:file-loaded': [file: TFile | null, view: CanvasView];
  'canvas:selection-menu': [menu: Menu, view: CanvasView];
  'canvas:node-menu': [menu: Menu, node: CanvasNode];
  'canvas:edge-menu': [menu: Menu, edge: CanvasEdge];
  'canvas:node-connection-drop-menu': [menu: Menu, node: CanvasNode, edge: CanvasEdge];
}
