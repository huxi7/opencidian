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
  setCustomContextMenu: () => ipcSend('context-menu'),
  selectFolder: () => ipcInvoke('plugin-select-folder'),
};
