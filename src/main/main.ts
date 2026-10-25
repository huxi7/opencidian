/**
 * [INPUT]: 依赖 electron 的 app/BrowserWindow/ipcMain/protocol/shell/dialog/session；Node 内置 fs/path；窗口材质、截图、文档窗口、原生菜单和原子写回由独立模块提供；共享 IPC 契约约束请求数据
 * [OUTPUT]: 主进程全部 IPC handler（vault 注册表、文件读写、窗口控制、回收站、拼写检查词典/语言）、app:// 协议、devScreenshotHook（OBS_* 环境变量门控的调试钩子）、设置与文档独立窗口、原生菜单、跨窗口 CAS 与协议的装配
 * [POS]: 应用主进程入口。vault 注册表存于 userData/opensidian.json（启动时从旧产品名 "Obsidian Copy" 的 userData 迁移一次）；拼写检查自加词存 userData/spellcheck-words.json，语言选择存 opensidian.json 的 spellcheckLanguages。渲染进程经 renderer/core/ipc.js 调用此处 handler。原生菜单保留设置入口。dev-hooks 只在指定测试库窗口执行。E2E 回收降级库内回收站。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * OpenSidian — Electron main process.
 * Replicates the observable behavior of Obsidian 1.14.4's main process:
 *  - frameless window with hidden titlebar & traffic-light position
 *  - app:// protocol serving the renderer bundle and arbitrary vault files
 *  - vault registry stored in userData (opensidian.json)
 *  - native menus wired back to renderer commands through app.commands.executeCommandById
 *  - window bounds persistence, custom context menus, spellcheck, trash, print-to-pdf
 */
import type { AppConfig, WindowBounds } from '../contracts.js';
import { errorMessage, isRecord, type Timer } from './main-types';
import type { RequestUrlOptions, PdfOptions } from '../ipc-contracts.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { devScreenshotHook } from './dev-hooks';
import { setupSettingsWindows } from './settings-window';
import { setupDocumentWindows } from './document-window';
import { registerNativeMenuIpc } from './native-menu';
import { registerVaultWriteIpc } from './vault-write';
import { guardWindowClose } from './window-close';
import { registerWindowEffectsIpc } from './window-effects';
import { registerCanvasCaptureIpc } from './canvas-capture';
import { installAppMenu } from './app-menu';
import { registerAppProtocol } from './app-protocol';
import { app, BrowserWindow, protocol, ipcMain, Menu, shell, dialog, session, nativeTheme, screen, net } from 'electron';

const APP_ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer');
const DIST_DIR = path.join(APP_ROOT, 'dist');
const ASSETS_DIR = path.join(APP_ROOT, 'assets');

const IS_MAC = process.platform === 'darwin';
const IS_DEV = !app.isPackaged;

// 验收/E2E 模式（run.mjs 设 E2E=1）：不抢系统焦点、不进 Dock、不激活应用、整窗不可见。
// 只要带 OBS_ACT（验收 eval 载荷）也自动进入 E2E——防止脚本/代理绕过 run.mjs 直连探针时弹窗。
// accessory 策略让 show()/窗口出现都不激活应用；只影响呈现层，正常模式行为不变。
const E2E = process.env.E2E === '1' || process.env.OBS_E2E === '1' || !!process.env.OBS_ACT;
if (E2E && IS_MAC) {
  try { app.setActivationPolicy('accessory'); } catch (e) { /* 非 macOS 忽略 */ }
}

// app:// scheme (same pattern as the original app)
const SCHEME = 'app';
const APP_HOST = 'opensidian.app';
const APP_ORIGIN = `${SCHEME}://${APP_HOST}/`;
const FILE_TOKEN = crypto.randomBytes(16).toString('hex');
const FILE_ORIGIN = `${SCHEME}://${FILE_TOKEN}/`;
const indexUrl = APP_ORIGIN + 'index.html';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// ---------------------------------------------------------------------------
// Config store (opensidian.json) — same shape as the original obsidian.json
// ---------------------------------------------------------------------------
const DATA_DIR = app.getPath('userData');

// One-time migration from the previous product name ("Obsidian Copy").
try {
  const legacyDir = path.join(app.getPath('appData'), 'Obsidian Copy');
  if (legacyDir !== DATA_DIR) {
    const legacyFile = path.join(legacyDir, 'obsidian.json');
    const nextFile = path.join(DATA_DIR, 'opensidian.json');
    if (!fs.existsSync(nextFile) && fs.existsSync(legacyFile)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.copyFileSync(legacyFile, nextFile);
    }
  }
} catch (e) { /* fresh install: nothing to migrate */ }

function configFile() {
  return path.join(DATA_DIR, 'opensidian.json');
}

let config: AppConfig = {};
function loadConfig() {
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    config = isRecord(saved) ? saved as AppConfig : {};
  } catch (e) {
    config = {};
  }
  if (!isRecord(config.vaults)) config.vaults = {};
  return config;
}
function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save config', e);
  }
}
loadConfig();

// 硬件加速开关（appearance 高级设置，重启生效）
if (config.disableGpu) app.disableHardwareAcceleration();

// 拼写检查自加词（编辑器设置“拼写检查词典”弹窗的数据源）。
// 主进程独占写入 userData/spellcheck-words.json；context menu 的 Add to Dictionary 登记于此。
const SPELLCHECK_DICT_FILE = path.join(DATA_DIR, 'spellcheck-words.json');

function readSpellcheckWords() {
  try {
    const data = JSON.parse(fs.readFileSync(SPELLCHECK_DICT_FILE, 'utf8'));
    if (Array.isArray(data)) return data.filter((w) => typeof w === 'string' && w.length > 0);
  } catch (e) { /* 尚无词典文件：视为空 */ }
  return [];
}

function writeSpellcheckWords(words: string[]) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SPELLCHECK_DICT_FILE, JSON.stringify(words, null, 2));
  } catch (e) {
    console.error('Failed to save spellcheck dictionary', e);
  }
}

function addSpellcheckWord(word: unknown) {
  if (typeof word !== 'string' || !word) return;
  const words = readSpellcheckWords();
  if (words.includes(word)) return;
  words.push(word);
  words.sort((a, b) => a.localeCompare(b));
  writeSpellcheckWords(words);
}

function removeSpellcheckWord(word: string) {
  writeSpellcheckWords(readSpellcheckWords().filter((w) => w !== word));
}

// 自定义应用图标（appearance 高级设置）：文件复制到 userData 并持久化
const CUSTOM_ICON_EXTS = ['png', 'ico', 'icns'];
function customIconPath() {
  const p = config.customIcon;
  return (typeof p === 'string' && fs.existsSync(p)) ? p : null;
}
function applyAppIcon() {
  const p = customIconPath();
  if (!p) return;
  try {
    if (IS_MAC && app.dock) app.dock.setIcon(p);
    else for (const w of Object.values(windows)) { try { w.setIcon(p); } catch (e) {} }
  } catch (e) { /* 平台不支持时忽略 */ }
}

const VAULTS = config.vaults || (config.vaults = {});

function randomId() {
  return crypto.randomBytes(8).toString('hex');
}

// Remove known partition/state for a vault id (mirrors original behavior loosely)
function removeVaultInternal(id: string) {
  const dir = path.join(DATA_DIR, 'Partitions', `vault-${id}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------
const windows: Record<string, Electron.BrowserWindow> = {};      // vaultId -> BrowserWindow
let starterWindow: Electron.BrowserWindow | null = null;
let quitting = false;
let settingsWindows: ReturnType<typeof setupSettingsWindows> | null = null;   // 设置独立窗口管理器（setupSettingsWindows）
let documentWindows: ReturnType<typeof setupDocumentWindows> | null = null;
const customContextWindows = new Set<number>();

function getVaultConfig(id: string): WindowBounds {
  let data = config[`vault-${id}`];
  if (!data || typeof data !== 'object') {
    data = {
      x: undefined, y: undefined, width: 1150, height: 774,
      isMaximized: false, devTools: false, zoom: 0,
    };
  }
  return data;
}
function saveVaultConfig(id: string, data: WindowBounds) {
  config[`vault-${id}`] = data;
  saveConfig();
}

/**
 * 窗口边框样式（appearance 高级设置，obsidian.json 的 frame 键）：
 * hidden=隐藏边框（默认）| custom=OpenSidian 风格（内嵌红绿灯）| native=原生边框
 */
function frameWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const frame = config.frame || 'hidden';
  if (frame === 'native') return { frame: true, titleBarStyle: 'default' };
  if (frame === 'custom') return { frame: false, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } };
  return { frame: false, titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 12 } };
}

function defaultWindowOptions(id: string): Electron.BrowserWindowConstructorOptions {
  const saved = getVaultConfig(id);
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: 1150,
    height: 774,
    minWidth: 200,
    minHeight: 150,
    backgroundColor: '#00000000',
    ...frameWindowOptions(),
    show: false,
    focusable: !E2E,        // E2E：窗口不可聚焦，事件/渲染照常，但不夺键盘焦点
    ...(E2E ? { opacity: 0 } : {}),   // E2E：整窗透明，测试全程不可见（渲染与截图不受影响）
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      spellcheck: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
  };
  if (typeof saved.width === 'number') opts.width = Math.max(saved.width, 400);
  if (typeof saved.height === 'number') opts.height = Math.max(saved.height, 300);
  const sx = saved.x, sy = saved.y, sw = opts.width || 1150, sh = opts.height || 774;
  if (typeof sx === 'number' && typeof sy === 'number') {
    // only restore when the position is on a visible display
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const w = d.workArea;
      return sx < w.x + w.width - 2 && sx + sw > w.x + 2 &&
             sy < w.y + w.height - 2 && sy + sh > w.y + 2;
    });
    if (visible) { opts.x = saved.x; opts.y = saved.y; }
  }
  return opts;
}

function secCtxWin(win: Electron.BrowserWindow) {
  // 触摸板缩放锁：整页视觉缩放（捏合）必须不存在——Obsidian 的界面只走外观设置里的离散缩放级别。
  // "快速调整字体大小"（Ctrl+滚轮/捏合改字号，外观页可关）由渲染层 wheel 监听处理。
  try { win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {}); } catch (e) { /* ignore */ }
  // window-wide context menu behavior (spellcheck / custom)
  const wc = win.webContents;
  wc.on('context-menu', (event, params) => {
    if (customContextWindows.has(wc.id)) {
      customContextWindows.delete(wc.id);
      try {
        const { editFlags, misspelledWord, dictionarySuggestions } = params;
        wc.send('context-menu', { editFlags, misspelledWord, dictionarySuggestions, webContentsId: wc.id });
        return;
      } catch (e) { /* fall through to native menu */ }
    }
    showNativeContextMenu(win, wc, params);
  });
}

function showNativeContextMenu(win: Electron.BrowserWindow, wc: Electron.WebContents, params: Electron.ContextMenuParams) {
  if (E2E) return;
  const { editFlags, misspelledWord, dictionarySuggestions } = params;
  const selection = params.selectionText.trim();
  const hasSelection = selection.length > 0;
  const template: Electron.MenuItemConstructorOptions[] = [];
  template.push({ label: 'Cut', role: 'cut', enabled: hasSelection },
                { label: 'Copy', role: 'copy', enabled: hasSelection },
                { label: 'Paste', role: 'paste', enabled: editFlags.canPaste });
  if (misspelledWord && misspelledWord.length > 0) {
    const suggestions: Electron.MenuItemConstructorOptions[] = [];
    const list = (dictionarySuggestions || []).slice(0, 5);
    if (list.length) {
      for (const s of list) suggestions.push({ label: s, click: () => wc.replaceMisspelling(s) });
    } else {
      suggestions.push({ label: 'No suggestion', enabled: false });
    }
    suggestions.push({ label: 'Add to Dictionary', click: () => {
      wc.session.addWordToSpellCheckerDictionary(misspelledWord);
      addSpellcheckWord(misspelledWord);
      wc.replaceMisspelling(misspelledWord);
    } });
    template.unshift(...suggestions, { type: 'separator' });
  }
  Menu.buildFromTemplate(template).popup({ window: win });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function openVaultWindow(id: string, focus = true) {
  if (windows[id]) {
    const w = windows[id];
    if (focus && !E2E) { if (w.isMinimized()) w.restore(); w.focus(); }
    return w;
  }
  const opts = defaultWindowOptions(id);
  const win = new BrowserWindow(opts);
  if (E2E) {
    try { win.setIgnoreMouseEvents(true, { forward: true }); } catch (e) { /* ignore */ }
    try { win.setOpacity(0); } catch (e) { /* ignore */ }
  }
  if (!IS_MAC) { const icon = customIconPath(); if (icon) { try { win.setIcon(icon); } catch (e) {} } }
  windows[id] = win;
  win.vaultId = id;

  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    const saved = getVaultConfig(id);
    if (saved.isMaximized) win.maximize();
    if (E2E) win.showInactive(); else win.show();
  };

  const saveBounds = () => {
    try {
      const saved = getVaultConfig(id);
      if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
        const b = win.getBounds();
        saved.x = b.x; saved.y = b.y; saved.width = b.width; saved.height = b.height;
      }
      saved.isMaximized = win.isMaximized();
      saveVaultConfig(id, saved);
    } catch (e) {}
  };
  let saveTimer: Timer | undefined;
  const debouncedSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveBounds, 150); };
  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('close', () => saveBounds());
  // 窗口状态推送给渲染进程（is-maximized / is-fullscreen / 红绿灯位置同步）
  const pushWindowState = () => { try { win.webContents.send('window-state-changed'); } catch (e) {} };
  for (const evt of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore'] as const) win.on(evt as 'maximize', pushWindowState);

  secCtxWin(win);
  guardWindowClose(win, { isQuitting: () => quitting, cancelQuit: () => { quitting = false; documentWindows?.resetQuitSnapshot(); }, isE2E: E2E, canFlush: () => win.loaded === true });
  win.webContents.on('did-finish-load', () => { win.loaded = true; });
  if (IS_DEV) {
    // Forward renderer console to stdout so dev runs can be diagnosed from the log.
    win.webContents.on('console-message', (...args: unknown[]) => {
      const d = args[1] as { message?: string; level?: number; sourceId?: string; lineNumber?: number };
      if (d && typeof d === 'object' && 'message' in d) {
        console.log(`[renderer:${d.level}] ${d.message} (${d.sourceId || ''}:${d.lineNumber || 0})`);
      } else {
        console.log(`[renderer:${args[1]}] ${args[2]} (${args[4] || ''}:${args[3] || 0})`);
      }
    });
    win.webContents.on('render-process-gone', (e, details) => {
      console.error('[renderer] process gone:', JSON.stringify(details));
    });
    win.webContents.on('unresponsive', () => { console.error('[renderer] unresponsive'); });
  }

  win.on('closed', () => {
    delete windows[id];
    documentWindows?.closeFor(id);
    if (settingsWindows) settingsWindows.closeFor(id);
    const entry = VAULTS[id];
    if (entry) { delete entry.open; }
    if (!quitting && Object.keys(windows).length === 0) {
      // keep alive on mac like the original; show starter only when user requests
    }
    saveConfig();
  });

  win.loadURL(indexUrl).then(() => { show(); documentWindows?.restoreFor(id, win); }, show);
  const entry = VAULTS[id];
  if (entry) { entry.open = true; entry.ts = Date.now(); saveConfig(); }
  if (!process.env.OBS_VAULT_PATH || path.resolve(VAULTS[id].path) === path.resolve(process.env.OBS_VAULT_PATH)) {
    devScreenshotHook(win, id);
  }
  return win;
}

// ---------------------------------------------------------------------------
// Dev hooks (env-gated): open a vault directly, capture a screenshot of the
// renderer for UI review. Never active in normal runs.
// ---------------------------------------------------------------------------

function openVaultStarter() {
  if (starterWindow) {
    if (starterWindow.isMinimized()) starterWindow.restore();
    if (!E2E) starterWindow.focus();
    return starterWindow;
  }
  const win = starterWindow = new BrowserWindow({
    width: 800, height: 650, resizable: false, maximizable: false, fullscreenable: false,
    ...frameWindowOptions(),
    show: false, backgroundColor: '#1e1e1e',
    focusable: !E2E,
    ...(E2E ? { opacity: 0 } : {}),
    webPreferences: { contextIsolation: false, nodeIntegration: true, backgroundThrottling: false },
  });
  win.on('closed', () => { starterWindow = null; });
  win.loadURL(APP_ORIGIN + 'starter.html').then(
    () => { if (E2E) win.showInactive(); else win.show(); },
    () => { if (E2E) win.showInactive(); else win.show(); },
  );
  // 验收第二窗口：仅读取 OBS_STARTER_*，不抢占主窗口的 OBS_ACT/OBS_SCREENSHOT。
  devScreenshotHook(win, 'starter', { prefix: 'OBS_STARTER_', logTag: 'dev-starter', quit: false });
  secCtxWin(win);
  return win;
}

// vault message (obsidian:// style actions) handed to renderer
function sendVaultMessage(id: string, payload: unknown) {
  const win = openVaultWindow(id, false);
  const js = `(function(){ var w=window, o=${JSON.stringify(payload)}; if (typeof w.OBS_ACT === 'function') { w.OBS_ACT(o); } else { w.OBS_ACT = o; } })()`;
  if (win.loaded) win.webContents.executeJavaScript(js);
  else win.webContents.once('did-finish-load', () => win.webContents.executeJavaScript(js));
}

function openVaultPath(rawPath: unknown, create = false) {
  if (typeof rawPath !== 'string' || !rawPath) return 'folder not found';
  const p = path.resolve(rawPath);
  if (create) {
    if (fs.existsSync(p)) return 'Vault already exists';
    try { fs.mkdirSync(p, { recursive: true }); } catch (e) { return String(e); }
  }
  if (!fs.existsSync(p)) return 'folder not found';
  for (const id in VAULTS) {
    if (path.resolve(VAULTS[id].path) === p) {
      VAULTS[id].ts = Date.now();
      openVaultWindow(id);
      app.addRecentDocument(p);
      return true;
    }
  }
  const id = randomId();
  VAULTS[id] = { path: p, ts: Date.now() };
  openVaultWindow(id);
  app.addRecentDocument(p);
  return true;
}

// ---------------------------------------------------------------------------
// IPC (mirrors the original channels)
// ---------------------------------------------------------------------------
const requestId = 0;

function setupIpc() {
  ipcMain.on('is-dev', (e) => { e.returnValue = IS_DEV; });
  ipcMain.on('locale', (e) => { e.returnValue = app.getLocale(); });
  ipcMain.on('is-quitting', (e) => { e.returnValue = quitting; });
  ipcMain.on('desktop-dir', (e) => { e.returnValue = app.getPath('desktop'); });
  ipcMain.on('documents-dir', (e) => { e.returnValue = app.getPath('documents'); });
  ipcMain.on('resources', (e) => { e.returnValue = path.join(APP_ROOT, 'assets'); });
  ipcMain.on('version', (e) => { e.returnValue = '1.14.4'; });
  ipcMain.on('file-url', (e) => { e.returnValue = FILE_ORIGIN; });
  ipcMain.on('relaunch', (e) => { e.returnValue = ''; quitting = true; app.relaunch(); app.quit(); });
  ipcMain.on('update', (e) => { e.returnValue = false; });
  ipcMain.on('check-update', (e) => { e.returnValue = false; if (e.args && e.args[0]) { /* manual check */ } });
  ipcMain.on('disable-update', (e) => { e.returnValue = false; });
  ipcMain.on('disable-gpu', (e, v) => {
    if (typeof v === 'boolean') { config.disableGpu = v; saveConfig(); }
    e.returnValue = !!config.disableGpu;
  });
  ipcMain.on('insider-build', (e) => { e.returnValue = !!config.insider; });
  ipcMain.on('cli', (e) => { e.returnValue = !!config.cli; });
  ipcMain.on('frame', (e, v: unknown) => { if (v === 'hidden' || v === 'custom' || v === 'native') { config.frame = v; } e.returnValue = config.frame; });

  ipcMain.on('vault', (e) => {
    const documentInfo = documentWindows?.infoFor(e.sender);
    if (documentInfo) { e.returnValue = documentInfo; return; }
    for (const id in windows) {
      if (windows[id].webContents === e.sender) { e.returnValue = { id, path: path.resolve(VAULTS[id].path) }; return; }
    }
    // 设置独立窗口：同一个 vault 的第二个 webContents（原版 popout 共享 app 的等价映射）
    const settingsId = settingsWindows && settingsWindows.vaultIdFor(e.sender);
    if (settingsId && VAULTS[settingsId]) { e.returnValue = { id: settingsId, path: path.resolve(VAULTS[settingsId].path) }; return; }
    e.returnValue = {};
  });
  ipcMain.on('vault-list', (e) => { e.returnValue = VAULTS; });
  ipcMain.on('vault-remove', (e, p) => {
    if (p && typeof p === 'string') {
      for (const id in VAULTS) {
        if (VAULTS[id].path === p) {
          if (windows[id]) { e.returnValue = false; return; }
          e.returnValue = true;
          delete VAULTS[id]; saveConfig();
          removeVaultInternal(id);
          return;
        }
      }
    }
    e.returnValue = false;
  });
  ipcMain.on('vault-move', (e, from, to) => {
    if (from && typeof from === 'string') {
      for (const id in VAULTS) {
        if (VAULTS[id].path === from) {
          if (windows[id]) { e.returnValue = 'EVAULTOPEN'; return; }
          try { fs.renameSync(from, to); } catch (err) { e.returnValue = String(err); return; }
          e.returnValue = '';
          VAULTS[id].path = to; saveConfig();
          return;
        }
      }
    }
    e.returnValue = false;
  });
  ipcMain.on('vault-open', (e, p, create) => { e.returnValue = openVaultPath(p, !!create); });
  ipcMain.on('vault-message', (e, p, payload) => {
    const resolved = path.resolve(p);
    for (const id in VAULTS) {
      if (path.resolve(VAULTS[id].path) === resolved) { sendVaultMessage(id, payload); break; }
    }
    e.returnValue = '';
  });
  ipcMain.on('starter', (e) => { e.returnValue = null; openVaultStarter(); });
  ipcMain.on('help', (e) => { e.returnValue = null; if (E2E) { console.log('[e2e] suppressed help'); return; } shell.openExternal('https://help.obsidian.md/'); });
  ipcMain.on('sandbox', (e) => { e.returnValue = null; });

  ipcMain.on('context-menu', (e) => { customContextWindows.add(e.sender.id); });

  // 拼写检查词典：列表/移除（Electron 33 的 session.removeWordFromSpellCheckerDictionary 可用，同步清理注册词）
  ipcMain.on('spellcheck-dict-list', (e) => { e.returnValue = readSpellcheckWords(); });
  ipcMain.on('spellcheck-add-word', (e, word) => {
    if (!word || typeof word !== 'string') return;
    addSpellcheckWord(word);
    try { e.sender.session.addWordToSpellCheckerDictionary(word); } catch (err) { /* ignore */ }
  });
  ipcMain.on('spellcheck-dict-remove', (e, word) => {
    removeSpellcheckWord(word);
    try {
      const ses = e.sender.session;
      if (typeof ses.removeWordFromSpellCheckerDictionary === 'function') ses.removeWordFromSpellCheckerDictionary(word);
    } catch (err) { /* 词典文件已移除即可 */ }
    e.returnValue = readSpellcheckWords();
  });

  // 拼写检查语言：读取 current(null=未自定义，用系统语言)/available/locale；写入并持久化到 opensidian.json
  ipcMain.on('spellcheck-languages', (e) => {
    try {
      const ses = e.sender.session;
      e.returnValue = {
        current: Array.isArray(config.spellcheckLanguages) ? config.spellcheckLanguages : null,
        active: ses.getSpellCheckerLanguages(),
        available: ses.availableSpellCheckerLanguages || [],
        locale: app.getLocale(),
      };
    } catch (err) {
      e.returnValue = { current: null, active: [], available: [], locale: app.getLocale() };
    }
  });
  ipcMain.on('spellcheck-languages-set', (e, languages: unknown) => {
    const custom = Array.isArray(languages) && languages.length
      ? [...new Set(languages.filter((l) => typeof l === 'string' && l))]
      : null;
    if (custom) config.spellcheckLanguages = custom;
    else delete config.spellcheckLanguages;
    saveConfig();
    const applied = custom || [app.getLocale()];
    try { e.sender.session.setSpellCheckerLanguages(applied); } catch (err) { /* 会话拒绝时保持原语言 */ }
    e.returnValue = applied;
  });

  ipcMain.on('trash', async (e, p) => {
    if (E2E) { e.returnValue = false; return; } // 隔离验收降级库内回收，不触碰系统回收站。
    try { await shell.trashItem(p); e.returnValue = true; }
    catch (err) { console.log(err); e.returnValue = false; }
  });
  ipcMain.on('get-documents-path', (e) => { e.returnValue = app.getPath('documents'); });
  ipcMain.on('get-sandbox-vault-path', (e) => { e.returnValue = path.join(DATA_DIR, 'Sanbox'); });
  ipcMain.on('get-default-vault-path', (e) => { e.returnValue = path.join(app.getPath('documents'), 'OpenSidian Vault'); });

  ipcMain.on('vault-open-default', (e, opts) => { /* create vault dialog path */ });

  ipcMain.on('open-url', (e, url) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (E2E) { console.log('[e2e] suppressed open-url', url); return; }
    if (win && typeof url === 'string') shell.openExternal(url);
  });

  ipcMain.on('request-url', async (e, replyChannel: string, opts: RequestUrlOptions) => {
    try {
      const { url, method, contentType, body, headers } = opts;
      const req = net.request({ url, method, redirect: 'follow' });
      if (contentType) req.setHeader('Content-Type', contentType);
      if (headers) for (const k in headers) { try { req.setHeader(k, headers[k]); } catch (err) {} }
      req.on('login', (authInfo, cb) => cb());
      req.on('error', (err) => { e.reply(replyChannel, { error: errorMessage(err) }); });
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          e.reply(replyChannel, {
            status: res.statusCode,
            headers: res.headers,
            body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          });
        });
      });
      if (typeof body === 'string') req.write(body);
      else if (body instanceof ArrayBuffer) req.write(Buffer.from(new Uint8Array(body)));
      req.end();
    } catch (err) {
      e.reply(replyChannel, { error: errorMessage(err) });
    }
  });

  ipcMain.on('print-to-pdf', async (e, options: PdfOptions) => {
    const wc = e.sender;
    try {
      const { filepath, open } = options;
      const data = await wc.printToPDF(options);
      await fs.promises.writeFile(filepath, data);
      if (open && !E2E) shell.openPath(filepath);
    } catch (err) { console.error(err); }
    finally { wc.send('print-to-pdf', {}); }
  });

  ipcMain.on('show-item-in-folder', (e, p) => { if (!E2E) shell.showItemInFolder(p); });
  ipcMain.on('open-path', (e, p) => { if (!E2E) shell.openPath(p); });
  // E2E（验收）模式：绝不真的拉起系统浏览器/访达，否则会打断用户正常使用电脑。
  ipcMain.on('open-external', (e, url) => {
    if (!/^https?:/.test(url)) return;
    if (E2E) { console.log('[e2e] suppressed open-external', url); return; }
    shell.openExternal(url);
  });

  ipcMain.on('set-menu', (e, arg) => { /* menu overrides from renderer: accepted but unused */ });
  ipcMain.on('update-menu-items', (e, items, refresh) => {});
  ipcMain.on('render-menu', (e) => {});

  ipcMain.on('dialog-open', async (e, opts: Electron.OpenDialogOptions) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    e.returnValue = result;
  });
  ipcMain.on('dialog-save', async (e, opts: Electron.SaveDialogOptions) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    e.returnValue = result;
  });
  ipcMain.on('dialog-message', async (e, opts: Electron.MessageBoxOptions) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    e.returnValue = result;
  });
  ipcMain.on('window-minimize', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); });
  ipcMain.on('window-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
  });
  ipcMain.on('window-close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
  ipcMain.on('window-is-maximized', (e) => { const w = BrowserWindow.fromWebContents(e.sender); e.returnValue = w ? w.isMaximized() : false; });
  ipcMain.on('window-title', (e, title) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setTitle(title); });
  ipcMain.on('get-icon', (e) => {
    const p = customIconPath();
    if (!p) { e.returnValue = null; return; }
    const ext = path.extname(p).slice(1).toLowerCase();
    let dataUrl = null;
    if (ext === 'png' || ext === 'ico') {
      try { dataUrl = 'data:image/' + (ext === 'ico' ? 'x-icon' : 'png') + ';base64,' + fs.readFileSync(p).toString('base64'); } catch (err) {}
    }
    e.returnValue = { path: p, ext, dataUrl };
  });
  ipcMain.on('set-icon', (e, iconPath) => {
    if (!iconPath) {
      delete config.customIcon;
      saveConfig();
      try { if (IS_MAC && app.dock) app.getFileIcon(path.resolve(process.execPath, '../../..')).then(icon => { if (!config.customIcon) app.dock?.setIcon(icon); }).catch(() => {}); } catch (err) {}
      e.returnValue = true;
      return;
    }
    try {
      const ext = path.extname(String(iconPath)).slice(1).toLowerCase();
      if (!CUSTOM_ICON_EXTS.includes(ext)) { e.returnValue = false; return; }
      const target = path.join(DATA_DIR, 'custom-icon.' + ext);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.copyFileSync(iconPath, target);
      config.customIcon = target;
      saveConfig();
      applyAppIcon();
      e.returnValue = true;
    } catch (err) { console.error('set-icon failed', err); e.returnValue = false; }
  });
  ipcMain.on('window-state', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    e.returnValue = w ? { maximized: w.isMaximized(), fullscreen: w.isFullScreen(), vibrancy: IS_MAC ? w._opensidianVibrancy || null : null } : { maximized: false, fullscreen: false, vibrancy: null };
  });
  // 原版 updateStatus：按缩放补偿 macOS 红绿灯位置
  ipcMain.on('set-traffic-light-position', (e, x, y) => {
    if (!IS_MAC) return;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    const pos = { x: Math.round(x), y: Math.round(y) };
    try {
      // Electron 33 起使用 setWindowButtonPosition；旧 API setTrafficLightPosition 已不在类型定义中
      if (typeof w.setWindowButtonPosition === 'function') w.setWindowButtonPosition(pos);
      else if (typeof w.setTrafficLightPosition === 'function') w.setTrafficLightPosition(pos);
    } catch (err) { /* 窗口样式不支持时忽略 */ }
  });
  ipcMain.handle('plugin-select-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = process.env.OBS_ALLOW_MULTI ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, cwd) => {
    if (!E2E) {
      // focus existing window
      for (const id in windows) { const w = windows[id]; if (w.isMinimized()) w.restore(); w.focus(); return; }
    }
    openVaultStarter();
  });

  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const anyOpen = Object.keys(VAULTS).some((id) => VAULTS[id].open);
      if (anyOpen) {
        for (const id in VAULTS) if (VAULTS[id].open) openVaultWindow(id);
      } else {
        openVaultStarter();
      }
    }
  });

  app.whenReady().then(() => {
    if (E2E && IS_MAC && app.dock) { try { app.dock.hide(); } catch (e) { /* ignore */ } }
    registerAppProtocol({ SCHEME, APP_ORIGIN, FILE_ORIGIN, RENDERER_DIR, APP_ROOT, ASSETS_DIR });
    settingsWindows = setupSettingsWindows({
      BrowserWindow,
      ipcMain,
      screen,
      indexUrl,
      frameWindowOptions,
      isE2E: E2E,
      vaultPathForId: (id) => (id && VAULTS[id] ? VAULTS[id].path : null),
      getVaultWindow: (id) => (id ? windows[id] : null),
      getVersion: () => '1.14.4',
      getFrame: () => config.frame || 'hidden',
      isChinese: () => String(app.getLocale()).toLowerCase().startsWith('zh'),
    });
    setupIpc();
    registerVaultWriteIpc({ ipcMain, vaultPathForSender: sender => VAULTS[BrowserWindow.fromWebContents(sender)?.vaultId || settingsWindows?.vaultIdFor(sender) || '']?.path });
    registerNativeMenuIpc({ ipcMain, isE2E: E2E });
    documentWindows = setupDocumentWindows({ BrowserWindow, ipcMain, defaultWindowOptions, prepareWindow: secCtxWin,
      indexUrl, vaultPathForId: id => VAULTS[id]?.path, isE2E: E2E, isQuitting: () => quitting, cancelQuit: () => { quitting = false; documentWindows?.resetQuitSnapshot(); } });
    registerWindowEffectsIpc({ ipcMain, BrowserWindow });
    registerCanvasCaptureIpc({ ipcMain, BrowserWindow });
    installAppMenu(openVaultStarter);
    applyAppIcon();

    const session0 = session.defaultSession;
    session0.setPermissionRequestHandler((wc, permission, callback) => {
      const url = wc.getURL();
      if (url.startsWith(APP_ORIGIN)) return callback(true);
      callback(false);
    });

    // 恢复持久化的拼写检查状态：自定义语言（opensidian.json）与自加词（spellcheck-words.json）
    try { session0.setSpellCheckerLanguages(config.spellcheckLanguages || [app.getLocale()]); } catch (e) {}
    for (const word of readSpellcheckWords()) {
      try { session0.addWordToSpellCheckerDictionary(word); } catch (e) {}
    }

    // open windows for vaults flagged as open（OBS_VAULT_PATH 直开模式下跳过，避免双窗口互踩）
    let anyOpen = false;
    const forcedVault = process.env.OBS_VAULT_PATH;
    if (!forcedVault) {
      for (const id in VAULTS) {
        const entry = VAULTS[id];
        if (!entry || typeof entry.path !== 'string' || !fs.existsSync(entry.path)) {
          delete VAULTS[id];
          continue;
        }
        if (entry.open) { anyOpen = true; openVaultWindow(id); }
      }
    }
    saveConfig();
    if (forcedVault) {
      openVaultPath(forcedVault, false);
      return;
    }
    if (!anyOpen) openVaultStarter();
  });
}
