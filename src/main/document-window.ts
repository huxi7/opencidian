/**
 * [INPUT]: 共享文档请求与回执；主入口注入窗口工厂、库路径与 Electron IPC。
 * [OUTPUT]: setupDocumentWindows 返回发送方库身份与同库窗口关闭接口。
 * [POS]: 文档独立窗口边界。子窗口就绪后才确认转移，不复用或覆盖主窗口布局。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import path from 'path';
import { app, screen } from 'electron';
import { guardWindowClose } from './window-close';
import { errorMessage, type DocumentContext, type DocumentEntry, type DocumentProbe, type Timer } from './main-types';
import type { DocumentWindowPayload as DocumentPayload, DocumentWindowResult as DocumentResult } from '../ipc-contracts.js';

function setupDocumentWindows(ctx: DocumentContext) {
  const { BrowserWindow, ipcMain, defaultWindowOptions, prepareWindow, indexUrl, vaultPathForId, isE2E } = ctx;
  const entries = new Map<number, DocumentEntry>();
  const persistTimers = new Map<string, Timer>();
  let quitSnapshotTaken = false;
  const layoutFile = (id: string) => { const root = vaultPathForId(id); if (!root) throw Error('库不存在'); return path.join(root, '.obsidian', 'workspace-popouts.json'); };
  function persist(id: string) {
    if (!vaultPathForId(id)) return;
    const windows = [...entries.values()].filter(entry => entry.vaultId === id && !entry.win.isDestroyed())
      .map(entry => ({ state: entry.state, layout: entry.layout, bounds: entry.win.getBounds(), zoom: entry.win.webContents.getZoomLevel() }));
    const filename = layoutFile(id), temporary = filename + '.tmp';
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ windows })); fs.renameSync(temporary, filename);
  }
  function schedulePersist(id: string) {
    clearTimeout(persistTimers.get(id));
    persistTimers.set(id, setTimeout(() => { persistTimers.delete(id); if (!ctx.isQuitting()) persist(id); }, 150));
  }
  const entryFor = (sender: Electron.WebContents) => [...entries.values()].find(entry => entry.win.webContents === sender);
  const infoFor = (sender: Electron.WebContents) => {
    const entry = entryFor(sender);
    return entry ? { id: entry.vaultId, path: vaultPathForId(entry.vaultId), documentWindow: true, documentState: entry.state, documentLayout: entry.layout } : null;
  };
  const fail = (entry: DocumentEntry, reason: string) => { entry.resolve?.({ ok: false, reason }); entry.resolve = null; clearTimeout(entry.timer); };
  const closeFor = (vaultId: string) => {
    if (!ctx.isQuitting()) persist(vaultId);
    for (const entry of entries.values()) if (entry.vaultId === vaultId && !entry.win.isDestroyed()) { entry.parentClosing = true; entry.win.close(); }
  };
  async function open(parent: Electron.BrowserWindow | null, payload: DocumentPayload): Promise<DocumentResult> {
    if (!parent || parent.isDestroyed()) return { ok: false, reason: '来源窗口已关闭' };
    const vaultId = parent.vaultId;
    if (!vaultId) return { ok: false, reason: '来源窗口未关联库' };
    const root = vaultPathForId(vaultId);
    if (!root || !payload || typeof payload.type !== 'string' || !payload.state || typeof payload.state !== 'object') return { ok: false, reason: '无效文档窗口请求' };
    const file = payload.state.file;
    if (file != null) {
      if (typeof file !== 'string') return { ok: false, reason: '文件路径无效' };
      const absolute = path.resolve(root, file), relative = path.relative(path.resolve(root), absolute);
      if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.existsSync(absolute)) return { ok: false, reason: '文件不在当前库中' };
    }
    const state = { type: payload.type, state: JSON.parse(JSON.stringify(payload.state)) as Record<string, unknown> };
    const bounds = parent.getBounds();
    const size = payload.size || payload.bounds || {};
    const width = Math.max(400, Math.min(10000, Number(size.width) || 900)), height = Math.max(300, Math.min(10000, Number(size.height) || 700));
    const position = payload.bounds;
    const px = position?.x, py = position?.y;
    const onScreen = typeof px === 'number' && typeof py === 'number' && Number.isFinite(px) && Number.isFinite(py) && screen.getAllDisplays().some(display => {
      const area = display.workArea; return px < area.x + area.width - 2 && px + width > area.x + 2 && py < area.y + area.height - 2 && py + height > area.y + 2;
    });
    const win = new BrowserWindow({ ...defaultWindowOptions(vaultId), width, height,
      x: onScreen ? px : bounds.x + 35,
      y: onScreen ? py : bounds.y + 35, minWidth: 400, minHeight: 300 });
    win.vaultId = vaultId;
    const entry: DocumentEntry = { win, vaultId, state, layout: payload.layout, parentId: parent.id, zoom: typeof payload.zoom === 'number' && Number.isFinite(payload.zoom) ? payload.zoom : parent.webContents.getZoomLevel() };
    entries.set(win.id, entry);
    prepareWindow(win);
    win.webContents.on('console-message', (...args: unknown[]) => {
      const details = args[1] as { level?: string | number; message?: string } | undefined;
      if (details && typeof details === 'object' && (details.level === 'error' || typeof details.level === 'number' && details.level >= 3)) console.error('[document-window]', details.message);
    });
    if (isE2E) { win.setIgnoreMouseEvents(true, { forward: true }); win.setOpacity(0); }
    win.on('closed', () => { fail(entry, '文档窗口已关闭'); entries.delete(win.id); if (!entry.parentClosing && !ctx.isQuitting()) schedulePersist(vaultId); });
    win.on('resize', () => schedulePersist(vaultId)); win.on('move', () => schedulePersist(vaultId));
    guardWindowClose(win, { ...ctx, canFlush: () => entry.ready === true });
    win.webContents.on('render-process-gone', () => fail(entry, '文档窗口加载失败'));
    const ready = new Promise<DocumentResult>(resolve => {
      entry.resolve = resolve;
      entry.timer = setTimeout(() => { fail(entry, '文档窗口启动超时'); if (!win.isDestroyed()) win.close(); }, 30000);
    });
    win.loadURL(indexUrl + '#document-window').catch(error => { fail(entry, errorMessage(error)); if (!win.isDestroyed()) win.close(); });
    return ready;
  }
  ipcMain.handle('document-window-open', (event, payload) => open(BrowserWindow.fromWebContents(event.sender), payload));
  async function restoreFor(id: string, parent: Electron.BrowserWindow) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(layoutFile(id), 'utf8')).windows; } catch { return; }
    if (!Array.isArray(saved) || [...entries.values()].some(entry => entry.vaultId === id)) return;
    for (const item of saved.slice(0, 20)) await open(parent, { ...item.state, layout: item.layout, bounds: item.bounds, zoom: item.zoom });
  }
  app.on('before-quit', () => {
    if (quitSnapshotTaken) return;
    quitSnapshotTaken = true;
    for (const timer of persistTimers.values()) clearTimeout(timer); persistTimers.clear();
    for (const id of new Set([...entries.values()].map(entry => entry.vaultId))) persist(id);
  });
  ipcMain.on('document-window-state', (event, state: DocumentPayload) => {
    const entry = entryFor(event.sender);
    if (entry && typeof state?.type === 'string' && state.state && typeof state.state === 'object') {
      entry.state = { type: state.type, state: state.state }; entry.layout = state.layout; schedulePersist(entry.vaultId);
    }
  });
  ipcMain.on('document-window-ready', event => {
    const entry = entryFor(event.sender);
    if (!entry || entry.win.isDestroyed()) return;
    clearTimeout(entry.timer);
    entry.ready = true;
    entry.win.webContents.setZoomLevel(entry.zoom);
    if (isE2E) entry.win.showInactive(); else entry.win.show();
    entry.resolve?.({ ok: true, windowId: entry.win.id }); entry.resolve = null;
    schedulePersist(entry.vaultId);
  });
  ipcMain.handle('document-window-close', (event, windowId: number) => {
    const sender = BrowserWindow.fromWebContents(event.sender), entry = entries.get(windowId);
    if (!entry || sender?.vaultId !== entry.vaultId) return false;
    entry.win.close(); return true;
  });
  ipcMain.handle('document-window-list', event => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return [...entries.values()].filter(entry => entry.ready && entry.vaultId === parent?.vaultId && !entry.win.isDestroyed())
      .map(entry => ({ windowId: entry.win.id, state: entry.state, visible: entry.win.isVisible(), focused: entry.win.isFocused(), bounds: entry.win.getBounds(), zoom: entry.win.webContents.getZoomLevel() }));
  });
  // 只在隔离验收中提供固定动作；正常应用没有执行任意代码的探针。
  ipcMain.handle('document-window-probe', async (event, payload: Partial<DocumentProbe> = {}) => {
    if (!isE2E) return null;
    const parent = BrowserWindow.fromWebContents(event.sender), entry = entries.get(payload.windowId ?? -1);
    if (!entry || !entry.ready || entry.vaultId !== parent?.vaultId || entry.win.isDestroyed()) return null;
    let saveResult;
    if (['edit', 'edit-pending'].includes(payload.action || '') && typeof payload.text === 'string') {
      await entry.win.webContents.executeJavaScript(`(async () => { const view = app.workspace.activeLeaf.view; view.editor.setValue(${JSON.stringify(payload.text)}); ${payload.hold ? 'clearTimeout(view._saveTimer); view._saveTimer=null;' : ''} ${payload.action === 'edit' ? 'await view.save();' : ''} return true; })()`);
    }
    if (payload.action === 'canvas-edit-pending' && typeof payload.text === 'string') {
      await entry.win.webContents.executeJavaScript(`(() => { const view=app.workspace.activeLeaf.view; const node=[...view.nodes.values()].find(node=>typeof node.setText==='function'); node.setText(${JSON.stringify(payload.text)}); ${payload.hold ? 'clearTimeout(view._saveTimer); view._saveTimer=null;' : ''} })()`);
    }
    if (payload.action === 'save') saveResult = await entry.win.webContents.executeJavaScript('app.workspace.activeLeaf.view.save()');
    if (payload.action === 'discard-local') {
      await entry.win.webContents.executeJavaScript(`(async () => {
        const view=app.workspace.activeLeaf.view; clearTimeout(view._saveTimer); view._saveTimer=null;
        if (view.editor) { const text=await app.vault.read(view.file); view._suppressChange=true; view.editor.setValue(text); view._suppressChange=false; view._loadedText=text; }
        else {
          const baseline = view._savedDataText;
          view._savedDataText = JSON.stringify(view.getData(), null, '\\t');
          if (await view._applyFileFromDisk(view.file.path) === false) {
            view._savedDataText = baseline;
            throw Error('无法载入磁盘画布，草稿仍保留');
          }
        }
        view._dirty=false; view._saveError=null; view._saveConflict=false;
      })()`);
    }
    if (payload.action === 'property' && typeof payload.key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(payload.key)) {
      await entry.win.webContents.executeJavaScript(`app.fileManager.processFrontMatter(app.workspace.getActiveFile(), async fm => {
        await new Promise(resolve => setTimeout(resolve, 60)); fm[${JSON.stringify(payload.key)}] = ${JSON.stringify(payload.value)};
      })`);
    }
    if (payload.action === 'open-another' && typeof payload.path === 'string') {
      await entry.win.webContents.executeJavaScript(`(async () => {
        let file;
        for (let i=0; i<100 && !file; i++) { file = app.vault.getFileByPath(${JSON.stringify(payload.path)}); if (!file) await new Promise(resolve => setTimeout(resolve,50)); }
        if (!file) throw Error('等待同库文件同步超时');
        await app.workspace.openFile(file, {newLeaf:'tab'}); await app.saveLayout();
      })()`);
    }
    return entry.win.webContents.executeJavaScript(`(() => ({
      file: app.workspace.getActiveFile()?.path, type: app.workspace.activeLeaf?.view.getViewType(),
      state: app.workspace.activeLeaf?.view.getState(), canvasNodes: app.workspace.activeLeaf?.view.nodes?.size,
      dirty: !!app.workspace.activeLeaf?.view._dirty, saveError: app.workspace.activeLeaf?.view._saveError,
      saveConflict: !!app.workspace.activeLeaf?.view._saveConflict, saveResult: ${JSON.stringify(saveResult)},
      loadedText: app.workspace.activeLeaf?.view._loadedText, savedText: app.workspace.activeLeaf?.view._savedText,
      canvasData: app.workspace.activeLeaf?.view.getViewType()==='canvas' ? app.workspace.activeLeaf.view.getData() : null,
      text: app.workspace.activeLeaf?.view.editor?.getValue(), vault: app.vaultPath,
      isolatedLayout: app.isDocumentWindow === true,
      title: document.title, leafCount: app.workspace.getLeavesOfType('markdown').length,
      markdownFiles: app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view.file?.path),
      opacity: require('electron').ipcRenderer.sendSync('document-window-opacity')
    }))()`);
  });
  ipcMain.on('document-window-opacity', event => { event.returnValue = BrowserWindow.fromWebContents(event.sender)?.getOpacity(); });
  return { infoFor, closeFor, restoreFor, resetQuitSnapshot: () => { quitSnapshotTaken = false; } };
}
export { setupDocumentWindows };
