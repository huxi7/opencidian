/**
 * [INPUT]: Events 提供事件；宿主提供 leaf 与视图根节点；view-pane-menu 提供文件面板菜单。
 * [OUTPUT]: 导出 View 生命周期基类与 ViewRegistry 注册表。
 * [POS]: 视图契约边界。插件登记扩展名，工作区按注册表分派文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* View base class + view registry. */
import type { WorkspaceLeaf } from './workspace-model.js';
import type { Menu } from './menu.js';
import type { Editor } from '../editor/editor.js';
import type { TFile } from './vault.js';
import type { Notice } from './notices.js';
import { Events } from './events.js';
import { fillFilePaneMenu } from './view-pane-menu.js';

export class View extends Events {
  file: TFile | null = null;
  leaf: WorkspaceLeaf;
  app: App;
  containerEl: HTMLElement | null = null;
  contentEl!: HTMLElement;
  scope: unknown = null;
  icon: string | null = null;
  navigation = false;
  _children: Array<() => unknown> = [];
  _loaded = false;
  ephemeralState: Record<string, unknown> = {};
  _rootEl: HTMLElement | null = null;
  _viewHeaderEl?: HTMLElement;
  _viewActionsEl?: HTMLElement;
  _viewTitleEl?: HTMLElement;
  editor?: Editor | null;
  readingEl?: HTMLElement;
  toggleMode?(): unknown;
  promptAddProperty?(): unknown;
  toggleSourceLive?(): unknown;
  revealFile?(file: TFile | import('./vault.js').TFolder): void;
  _showFolderMenu?(event: MouseEvent, folder: import('./vault.js').TFolder): void;
  _fillViewActions?(actions: HTMLElement): void;
  onTabMenu?(menu: Menu): void;
  onMoreOptionsMenu?(menu: Menu): void;
  mode?: string;
  _closed?: boolean;
  _fileDeleted?: boolean;
  _dirty?: boolean;
  _writing?: boolean;
  _loadedText?: string | null;
  _savedText?: string | null;
  _savedDataText?: string | null;
  _renderedText?: string | null;
  _suppressChange?: boolean;
  _saveError?: string | null;
  _saveConflict?: boolean;
  _saveNotice?: Notice | null;
  _saveTimer?: number | ReturnType<typeof setTimeout> | null;
  _saveRecoverySequence?: number;
  save?(): boolean | void | Promise<boolean | void>;
  getData?(): unknown;
  onFocus?(): void;
  onLayoutReady?(): void;
  focusInlineTitle?(): void;
  resolveSaveConflict?(): unknown;
  _renderProperties?(): unknown;
  _renderReading?(): unknown;
  _applyFileFromDisk?(path: string, options?: { text: string }): boolean | void | Promise<boolean | void>;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = null;
    this.scope = null;
    this.icon = null;
    this.navigation = false;
    this._children = [];
    this._loaded = false;
  }

  getViewType() { return 'empty'; }
  getDisplayText() { return this.getViewType(); }
  getIcon() { return this.icon || 'lucide-file'; }
  getState(): Record<string, unknown> { return {}; }
  setState(state?: Record<string, unknown>, result?: unknown): void | boolean | Promise<void | boolean> { return Promise.resolve(); }
  async onOpen() {}
  onClose(): void | boolean | Promise<void | boolean> { return Promise.resolve(); }
  onResize() {}
  onPaneMenu(menu: Menu, source: string) { if (this.file) fillFilePaneMenu(this, menu, source); }

  async load() {
    if (this._loaded) return;
    this._loaded = true;
    await this.onOpen();
  }

  getEphemeralState() { return {}; }
  setEphemeralState(state: Record<string, unknown>) { this.ephemeralState = state; }
}

export class ViewRegistry {
  views = new Map<string, ViewFactory>();
  viewByType = new Map<string, unknown>();

  registerView(type: string, factory: ViewFactory) { this.views.set(type, factory); }
  unregisterView(type: string) { this.views.delete(type); }
  getViewCreator(type: string) { return this.views.get(type); }
  getTypeByExtension(ext: string) {
    for (const [type, factory] of this.views) if (factory.extensions?.includes(ext)) return type;
    return null;
  }
}
export type ViewFactory = ((leaf: WorkspaceLeaf) => View) & { extensions?: string[] };
