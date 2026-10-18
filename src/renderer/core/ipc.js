/**
 * [INPUT]: Electron 的 ipcRenderer；主进程 main.js 注册的同名通道
 * [OUTPUT]: ipcSync/ipcSend/ipcInvoke/ipcOn 与 Desktop 门面（含拼写检查词典/语言通道）
 * [POS]: core/ 的渲染进程 IPC 叶子层。只做通道转发，不持有业务状态；窗口标题、拼写检查等全部经此抵达主进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Synchronous IPC helpers (mirrors the original app's channel names). */
const { ipcRenderer } = require('electron');

export function ipcSync(channel, ...args) {
  return ipcRenderer.sendSync(channel, ...args);
}

export function ipcSend(channel, ...args) {
  return ipcRenderer.send(channel, ...args);
}

export function ipcInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

export function ipcOn(channel, handler) {
  const wrapped = (ev, ...args) => handler(ev, ...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

export const Desktop = {
  isDev: () => ipcSync('is-dev'),
  version: () => ipcSync('version'),
  fileUrl: () => ipcSync('file-url'),
  resources: () => ipcSync('resources'),
  vault: () => ipcSync('vault'),
  vaultList: () => ipcSync('vault-list'),
  vaultRemove: (path) => ipcSync('vault-remove', path),
  vaultMove: (from, to) => ipcSync('vault-move', from, to),
  vaultOpen: (path, create) => ipcSync('vault-open', path, create),
  vaultMessage: (path, payload) => ipcSync('vault-message', path, payload),
  documentsDir: () => ipcSync('documents-dir'),
  desktopDir: () => ipcSync('desktop-dir'),
  defaultVaultPath: () => ipcSync('get-default-vault-path'),
  trash: (path) => ipcSync('trash', path),
  openUrl: (url) => ipcSend('open-url', url),
  openExternal: (url) => ipcSend('open-external', url),
  showItemInFolder: (path) => ipcSend('show-item-in-folder', path),
  openPath: (path) => ipcSend('open-path', path),
  requestUrl: (opts) => new Promise((resolve) => {
    const channel = 'request-url-response-' + Math.random().toString(36).slice(2);
    ipcRenderer.once(channel, (ev, data) => resolve(data));
    ipcSend('request-url', channel, opts);
  }),
  printToPdf: (opts) => new Promise((resolve) => {
    ipcRenderer.once('print-to-pdf', () => resolve(true));
    ipcSend('print-to-pdf', opts);
  }),
  openStarter: () => ipcSync('starter'),
  openDialog: (opts) => ipcSync('dialog-open', opts),
  saveDialog: (opts) => ipcSync('dialog-save', opts),
  messageDialog: (opts) => ipcSync('dialog-message', opts),
  setTitle: (t) => ipcSend('window-title', t),
  getIcon: () => ipcSync('get-icon'),
  setIcon: (iconPath) => ipcSync('set-icon', iconPath),
  windowState: () => ipcSync('window-state'),
  minimizeWindow: () => ipcSend('window-minimize'),
  maximizeWindow: () => ipcSend('window-maximize'),
  closeWindow: () => ipcSend('window-close'),
  isWindowMaximized: () => ipcSync('window-is-maximized'),
  setTrafficLightPosition: (x, y) => ipcSend('set-traffic-light-position', x, y),
  setCustomContextMenu: () => ipcSend('context-menu'),
  selectFolder: () => ipcInvoke('plugin-select-folder'),
  spellcheckDict: () => ipcSync('spellcheck-dict-list'),
  spellcheckDictRemove: (word) => ipcSync('spellcheck-dict-remove', word),
  spellcheckAddWord: (word) => ipcSend('spellcheck-add-word', word),
  spellcheckLanguages: () => ipcSync('spellcheck-languages'),
  spellcheckLanguagesSet: (languages) => ipcSync('spellcheck-languages-set', languages),
};
