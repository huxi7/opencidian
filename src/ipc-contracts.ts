/**
 * [INPUT]: Electron 的对话框、PDF 和矩形类型，以及共享库数据契约。
 * [OUTPUT]: 导出 IPC 通道名、参数元组和返回值协议。
 * [POS]: 进程间数据边界。主进程校验输入，渲染器按通道获得返回类型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue,
  MessageBoxOptions, MessageBoxReturnValue, PrintToPDFOptions, Rectangle, Point } from 'electron';
import type { VaultDescriptor, VaultWriteRequest, VaultWriteResult, ViewState, WindowBounds } from './contracts.js';

export interface DocumentWindowPayload {
  type: string; state: Record<string, unknown>; layout?: unknown;
  size?: Pick<WindowBounds, 'width' | 'height'>; bounds?: WindowBounds; zoom?: number;
}
export type DocumentWindowResult = { ok: true; windowId: number; reason?: never } | { ok: false; reason: string; windowId?: never };
export interface VaultInfo {
  id?: string; path?: string; documentWindow?: boolean; documentState?: ViewState; documentLayout?: unknown;
}
export interface SettingsWindowOptions {
  vaultId?: string; tabId?: string; width?: number; height?: number; x?: number; y?: number; background?: string;
}
export type SettingsWindowInfo = { open: false } | {
  open: true; vaultId: string; bounds: Rectangle | null; minSize: number[] | null; title: string;
  buttonPosition: Point | null; focused: boolean; frame: string | null; isNativeFrame: boolean;
};
export interface NativeMenuItem {
  separator?: boolean; label?: string; enabled?: boolean; checkable?: boolean; checked?: boolean; submenu?: NativeMenuItem[];
}
export interface NativeMenuRequest { token: number; items: NativeMenuItem[]; x?: number; y?: number; }
export interface NativeMenuResult {
  selected: number[] | null; modifiers?: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>>; error?: string;
}
export interface RequestUrlOptions { url: string; method?: string; contentType?: string; body?: string | ArrayBuffer; headers?: Record<string, string>; }
export interface RequestUrlResult { status?: number; headers?: Record<string, string | string[]>; body?: ArrayBuffer; error?: string; }
export type PdfOptions = PrintToPDFOptions & { filepath: string; open?: boolean };
export interface SpellcheckLanguages { current: string[] | null; active: string[]; available: string[]; locale: string; }

// --- 同步请求：参数与回执按通道绑定 ---
type Request<Args extends unknown[], Result> = { args: Args; result: Result };
export interface SyncChannels {
  'is-dev': Request<[], boolean>;
  version: Request<[], string>;
  'file-url': Request<[], string>;
  resources: Request<[], string>;
  vault: Request<[], VaultInfo>;
  'vault-list': Request<[], Record<string, VaultDescriptor>>;
  'vault-remove': Request<[path: string], boolean>;
  'vault-move': Request<[from: string, to: string], string | false>;
  'vault-open': Request<[path: string, create?: boolean], true | string>;
  'vault-message': Request<[path: string, payload: unknown], string>;
  'documents-dir': Request<[], string>;
  'desktop-dir': Request<[], string>;
  'get-default-vault-path': Request<[], string>;
  trash: Request<[path: string], boolean>;
  starter: Request<[], null>;
  'dialog-open': Request<[options: OpenDialogOptions], OpenDialogReturnValue>;
  'dialog-save': Request<[options: SaveDialogOptions], SaveDialogReturnValue>;
  'dialog-message': Request<[options: MessageBoxOptions], MessageBoxReturnValue>;
  'get-icon': Request<[], { path: string; ext: string; dataUrl: string | null } | null>;
  'set-icon': Request<[path: string | null], boolean>;
  'window-state': Request<[], { maximized: boolean; fullscreen: boolean; vibrancy: 'sidebar' | null }>;
  'window-is-maximized': Request<[], boolean>;
  'settings-window-open': Request<[options?: SettingsWindowOptions], { ok: boolean; reused?: boolean }>;
  'settings-window-close': Request<[], boolean>;
  'settings-window-toggle': Request<[options?: SettingsWindowOptions], boolean>;
  'settings-window-pending-tab': Request<[], string>;
  'settings-window-info': Request<[], SettingsWindowInfo>;
  'spellcheck-dict-list': Request<[], string[]>;
  'spellcheck-dict-remove': Request<[word: string], string[]>;
  'spellcheck-languages': Request<[], SpellcheckLanguages>;
  'spellcheck-languages-set': Request<[languages: string[] | null], string[]>;
  'check-update': Request<[], boolean>;
}
export interface InvokeChannels {
  'vault-write-cas': Request<[request: VaultWriteRequest], VaultWriteResult>;
  'document-window-open': Request<[request: DocumentWindowPayload], DocumentWindowResult>;
  'canvas-capture-page': Request<[rectangle: Rectangle], string>;
  'native-menu-popup': Request<[request: NativeMenuRequest], NativeMenuResult>;
  'settings-window-probe': Request<[], unknown>;
  'settings-window-capture': Request<[path: string], { ok: boolean; path?: string; width?: number; height?: number; error?: string }>;
  'plugin-select-folder': Request<[], OpenDialogReturnValue>;
}
export interface SendChannels {
  'document-window-ready': [];
  'document-window-state': [state: DocumentWindowPayload];
  'open-url': [url: string];
  'open-external': [url: string];
  'show-item-in-folder': [path: string];
  'open-path': [path: string];
  'request-url': [replyChannel: string, options: RequestUrlOptions];
  'print-to-pdf': [options: PdfOptions];
  'window-title': [title: string];
  'window-translucency': [enabled: boolean];
  'window-minimize': [];
  'window-maximize': [];
  'window-close': [];
  'set-traffic-light-position': [x: number, y: number];
  'context-menu': [];
  'spellcheck-add-word': [word: string];
  'native-menu-close': [token: number];
  help: [];
}
export interface RendererEvents {
  'settings-window-open-tab': [payload: { tabId: string }];
  'settings-open-modal': [payload: { tabId: string; settingsPopoutWindow: boolean }];
  'context-menu': [parameters: Electron.ContextMenuParams];
  'window-save-failed': [message: string];
  'window-state-changed': [];
}
