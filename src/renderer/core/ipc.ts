/**
 * [INPUT]: Electron 的 ipcRenderer 与共享 ipc-contracts 通道协议。
 * 文档窗口使用异步就绪回执；属性写回使用跨窗口比较写入通道。
 * [OUTPUT]: ipcSync/ipcSend/ipcInvoke/ipcOn 与 Desktop 门面（含窗口原生半透明、拼写检查词典/语言通道、设置独立窗口的开关/信息/探针/截图通道）
 * [POS]: core/ 的渲染进程 IPC 叶子层。只做通道转发，不持有业务状态；窗口标题、拼写检查等全部经此抵达主进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { VaultWriteRequest, VaultWriteResult } from '../../contracts.js';
import type { SyncChannels, InvokeChannels, SendChannels, RendererEvents, DocumentWindowPayload,
  RequestUrlOptions, RequestUrlResult, PdfOptions, SettingsWindowOptions } from '../../ipc-contracts.js';
import type { IpcRendererEvent, OpenDialogOptions, SaveDialogOptions, MessageBoxOptions } from 'electron';
const { ipcRenderer } = require('electron') as typeof import('electron');

export function ipcSync<K extends keyof SyncChannels>(channel: K, ...args: SyncChannels[K]['args']): SyncChannels[K]['result'] {
  return ipcRenderer.sendSync(channel, ...args) as SyncChannels[K]['result'];
}

export function ipcSend<K extends keyof SendChannels>(channel: K, ...args: SendChannels[K]) {
  return ipcRenderer.send(channel, ...args);
}

export function ipcInvoke<K extends keyof InvokeChannels>(channel: K, ...args: InvokeChannels[K]['args']): Promise<InvokeChannels[K]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeChannels[K]['result']>;
}

export function ipcOn<K extends keyof RendererEvents>(channel: K, handler: (event: IpcRendererEvent, ...args: RendererEvents[K]) => void) {
  const wrapped = (ev: IpcRendererEvent, ...args: RendererEvents[K]) => handler(ev, ...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

export const Desktop = {
  compareAndSwapFile: (request: VaultWriteRequest): Promise<VaultWriteResult> => ipcInvoke('vault-write-cas', request),
  openDocumentWindow: (state: DocumentWindowPayload) => ipcInvoke('document-window-open', state),
  documentWindowReady: () => ipcSend('document-window-ready'),
  isDev: () => ipcSync('is-dev'),
  version: () => ipcSync('version'),
  fileUrl: () => ipcSync('file-url'),
  resources: () => ipcSync('resources'),
  vault: () => ipcSync('vault'),
  vaultList: (): Record<string, import('../../contracts.js').VaultDescriptor> => ipcSync('vault-list'),
  vaultRemove: (path: string) => ipcSync('vault-remove', path),
  vaultMove: (from: string, to: string) => ipcSync('vault-move', from, to),
  vaultOpen: (path: string, create?: boolean) => ipcSync('vault-open', path, create),
  vaultMessage: (path: string, payload: unknown) => ipcSync('vault-message', path, payload),
  documentsDir: () => ipcSync('documents-dir'),
  desktopDir: () => ipcSync('desktop-dir'),
  defaultVaultPath: () => ipcSync('get-default-vault-path'),
  trash: (path: string) => ipcSync('trash', path),
  openUrl: (url: string) => ipcSend('open-url', url),
  openExternal: (url: string) => ipcSend('open-external', url),
  showItemInFolder: (path: string) => ipcSend('show-item-in-folder', path),
  openPath: (path: string) => ipcSend('open-path', path),
  requestUrl: (opts: RequestUrlOptions) => new Promise<RequestUrlResult>((resolve) => {
    const channel = 'request-url-response-' + Math.random().toString(36).slice(2);
    ipcRenderer.once(channel, (_ev: IpcRendererEvent, data: RequestUrlResult) => resolve(data));
    ipcSend('request-url', channel, opts);
  }),
  printToPdf: (opts: PdfOptions) => new Promise<boolean>((resolve) => {
    ipcRenderer.once('print-to-pdf', () => resolve(true));
    ipcSend('print-to-pdf', opts);
  }),
  openStarter: () => ipcSync('starter'),
  openDialog: (opts: OpenDialogOptions) => ipcSync('dialog-open', opts),
  saveDialog: (opts: SaveDialogOptions) => ipcSync('dialog-save', opts),
  messageDialog: (opts: MessageBoxOptions) => ipcSync('dialog-message', opts),
  setTitle: (t: string) => ipcSend('window-title', t),
  getIcon: () => ipcSync('get-icon'),
  setIcon: (iconPath: string | null) => ipcSync('set-icon', iconPath),
  windowState: () => ipcSync('window-state'),
  setTranslucency: (enabled: boolean) => ipcSend('window-translucency', !!enabled),
  minimizeWindow: () => ipcSend('window-minimize'),
  maximizeWindow: () => ipcSend('window-maximize'),
  closeWindow: () => ipcSend('window-close'),
  isWindowMaximized: () => ipcSync('window-is-maximized'),
  setTrafficLightPosition: (x: number, y: number) => ipcSend('set-traffic-light-position', x, y),
  setCustomContextMenu: () => ipcSend('context-menu'),
  // 设置独立窗口（1.14.4 popout）：开/关/信息/页签接力/探针/截图
  settingsWindowOpen: (opts?: SettingsWindowOptions) => ipcSync('settings-window-open', opts),
  settingsWindowClose: () => ipcSync('settings-window-close'),
  settingsWindowToggle: (opts?: SettingsWindowOptions) => ipcSync('settings-window-toggle', opts),
  settingsWindowPendingTab: () => ipcSync('settings-window-pending-tab'),
  settingsWindowInfo: () => ipcSync('settings-window-info'),
  settingsWindowProbe: () => ipcInvoke('settings-window-probe'),
  settingsWindowCapture: (outPath: string) => ipcInvoke('settings-window-capture', outPath),
  selectFolder: () => ipcInvoke('plugin-select-folder'),
  spellcheckDict: () => ipcSync('spellcheck-dict-list'),
  spellcheckDictRemove: (word: string) => ipcSync('spellcheck-dict-remove', word),
  spellcheckAddWord: (word: string) => ipcSend('spellcheck-add-word', word),
  spellcheckLanguages: () => ipcSync('spellcheck-languages'),
  spellcheckLanguagesSet: (languages: string[] | null) => ipcSync('spellcheck-languages-set', languages),
};
