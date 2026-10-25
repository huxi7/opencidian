/**
 * [INPUT]: Electron、共享视图状态与 IPC 契约。
 * [OUTPUT]: 导出窗口上下文与状态类型、错误文本和对象校验函数。
 * [POS]: 主进程共享契约与输入边界；不依赖渲染器实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type * as Electron from 'electron';
import type { ViewState } from '../contracts.js';
import type { NativeMenuItem, DocumentWindowResult } from '../ipc-contracts.js';
export type Timer = ReturnType<typeof setTimeout>;
export interface WindowIpcContext { ipcMain: Electron.IpcMain; BrowserWindow: typeof Electron.BrowserWindow; }
export interface CloseContext { isQuitting(): boolean; cancelQuit?(): void; canFlush?(): boolean; isE2E?: boolean; }
export interface SettingsContext extends WindowIpcContext {
  screen: Electron.Screen; indexUrl: string; frameWindowOptions(): Electron.BrowserWindowConstructorOptions;
  isE2E: boolean; vaultPathForId(id: string): string | null | undefined;
  getVaultWindow(id: string): Electron.BrowserWindow | null | undefined;
  getVersion?(): string; getFrame?(): string; isChinese(): boolean;
}
export interface SettingsEntry { id: string; win: Electron.BrowserWindow; pendingTabId: string | null; }
export interface DocumentContext extends WindowIpcContext, CloseContext {
  indexUrl: string; isE2E: boolean; vaultPathForId(id: string): string | undefined;
  defaultWindowOptions(id: string): Electron.BrowserWindowConstructorOptions;
  prepareWindow(win: Electron.BrowserWindow): void;
}
export interface DocumentEntry {
  win: Electron.BrowserWindow; vaultId: string; state: ViewState; layout: unknown; parentId: number; zoom: number;
  parentClosing?: boolean; ready?: boolean; resolve?: ((result: DocumentWindowResult) => void) | null; timer?: Timer;
}
export interface DocumentProbe { windowId: number; action?: string; text?: string; hold?: boolean; key?: string; value?: unknown; path?: string; }
export interface NativeMenuEntry { token: number; finish(selected: number[] | null): void; menu: Electron.Menu | null; items?: NativeMenuItem[]; }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
