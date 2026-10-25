/**
 * [INPUT]: 本地库文件、窗口状态与跨进程请求的数据。
 * [OUTPUT]: 导出文件统计、库身份、视图状态与原子写入契约。
 * [POS]: 主进程和渲染器共用的数据边界；不依赖界面或 Electron 实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface FileStat { ctime: number; mtime: number; size: number; }
export interface VaultDescriptor { id?: string; path: string; ts?: number; open?: boolean; }
export interface ViewState { type?: string; state?: Record<string, unknown>; active?: boolean; }
export interface VaultWriteRequest { path: string; expected: string; text: string; }
export type VaultWriteResult = { ok: true; conflict?: never; error?: never } | { ok: false; conflict?: boolean; error?: string };
export interface WindowBounds { x?: number; y?: number; width?: number; height?: number; isMaximized?: boolean; devTools?: boolean; zoom?: number; }
export interface AppConfig {
  vaults?: Record<string, VaultDescriptor>;
  disableGpu?: boolean;
  customIcon?: string;
  frame?: 'hidden' | 'custom' | 'native';
  insider?: boolean;
  cli?: boolean;
  spellcheckLanguages?: string[];
  [windowKey: `vault-${string}`]: WindowBounds;
}
export interface CompletionReceipt { ok: boolean; error?: string; reason?: string; }
