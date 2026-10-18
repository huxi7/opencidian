/**
 * [INPUT]: 依赖 electron 的 app/BrowserWindow/ipcMain/protocol/shell/dialog/session；Node 内置 fs/path
 * [OUTPUT]: 主进程全部 IPC handler（vault 注册表、文件读写、窗口控制、回收站、拼写检查词典/语言）、app:// 协议、devScreenshotHook（OBS_* 环境变量门控的调试钩子）
 * [POS]: 应用主进程入口。vault 注册表存于 userData/opensidian.json（启动时从旧产品名 "Obsidian Copy" 的 userData 迁移一次）；拼写检查自加词存 userData/spellcheck-words.json，语言选择存 opensidian.json 的 spellcheckLanguages。渲染进程经 preload/ipc.js 调用此处 handler。原生菜单保留设置入口。dev-hooks 只在指定测试库窗口执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * OpenSidian — Electron main process.
 * Replicates the observable behavior of Obsidian 1.12.4's main process:
 *  - frameless window with hidden titlebar & traffic-light position
 *  - app:// protocol serving the renderer bundle and arbitrary vault files
 *  - vault registry stored in userData (opensidian.json)
 *  - native menus wired back to renderer commands through app.commands.executeCommandById
 *  - window bounds persistence, custom context menus, spellcheck, trash, print-to-pdf
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { devScreenshotHook } = require('./dev-hooks');
const { app, BrowserWindow, protocol, ipcMain, Menu, shell, dialog, session, nativeTheme } = require('electron');

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

let config = {};
function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (!config || typeof config !== 'object') config = {};
  } catch (e) {
    config = {};
  }
  config.vaults = config.vaults || {};
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

function writeSpellcheckWords(words) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SPELLCHECK_DICT_FILE, JSON.stringify(words, null, 2));
  } catch (e) {
    console.error('Failed to save spellcheck dictionary', e);
  }
}

function addSpellcheckWord(word) {
  if (typeof word !== 'string' || !word) return;
  const words = readSpellcheckWords();
  if (words.includes(word)) return;
  words.push(word);
  words.sort((a, b) => a.localeCompare(b));
  writeSpellcheckWords(words);
}

function removeSpellcheckWord(word) {
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

const VAULTS = config.vaults;

function randomId() {
  return crypto.randomBytes(8).toString('hex');
}

// Remove known partition/state for a vault id (mirrors original behavior loosely)
function removeVaultInternal(id) {
  const dir = path.join(DATA_DIR, 'Partitions', `vault-${id}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------
const windows = {};      // vaultId -> BrowserWindow
let starterWindow = null;
let quitting = false;
const customContextWindows = new Set();

function getVaultConfig(id) {
  let data = config['vault-' + id];
  if (!data || typeof data !== 'object') {
    data = {
      x: undefined, y: undefined, width: 1150, height: 774,
      isMaximized: false, devTools: false, zoom: 0,
    };
  }
  return data;
}
function saveVaultConfig(id, data) {
  config['vault-' + id] = data;
  saveConfig();
}

/**
 * 窗口边框样式（appearance 高级设置，obsidian.json 的 frame 键）：
 * hidden=隐藏边框（默认）| custom=OpenSidian 风格（内嵌红绿灯）| native=原生边框
 */
function frameWindowOptions() {
  const frame = config.frame || 'hidden';
  if (frame === 'native') return { frame: true, titleBarStyle: 'default' };
  if (frame === 'custom') return { frame: false, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } };
  return { frame: false, titleBarStyle: 'hidden', trafficLightPosition: { x: 19, y: 12 } };
}

function defaultWindowOptions(id) {
  const saved = getVaultConfig(id);
  const opts = {
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
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    // only restore when the position is on a visible display
    const displays = require('electron').screen.getAllDisplays();
    const visible = displays.some((d) => {
      const w = d.workArea;
      return saved.x < w.x + w.width - 2 && saved.x + opts.width > w.x + 2 &&
             saved.y < w.y + w.height - 2 && saved.y + opts.height > w.y + 2;
    });
    if (visible) { opts.x = saved.x; opts.y = saved.y; }
  }
  return opts;
}

function secCtxWin(win) {
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

function showNativeContextMenu(win, wc, params) {
  const { editFlags, misspelledWord, dictionarySuggestions } = params;
  const selection = params.selectionText.trim();
  const hasSelection = selection.length > 0;
  const template = [];
  template.push({ label: 'Cut', role: 'cut', enabled: hasSelection },
                { label: 'Copy', role: 'copy', enabled: hasSelection },
                { label: 'Paste', role: 'paste', enabled: editFlags.canPaste });
  if (misspelledWord && misspelledWord.length > 0) {
    const suggestions = [];
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
// Menus
// ---------------------------------------------------------------------------
function executeCommandJS(id) {
  return `(function(){ try { if (window.app && app.commands) return app.commands.executeCommandById(${JSON.stringify(id)}); } catch(e) { console.error(e); } })()`;
}

const rootMenuTemplate = [];

function buildAppMenu(FocusedWindowGetter) {
  const isAppWindow = (w) => w instanceof BrowserWindow;
  function cmd(id) {
    return {
      click: (menuItem, win) => {
        const target = isAppWindow(win) ? win : BrowserWindow.getFocusedWindow();
        if (!target) return;
        if (menuItem.triggeredByAccelerator === false) return;
        target.webContents.executeJavaScript(executeCommandJS(id));
      },
    };
  }
  const template = [
    ...(IS_MAC ? [{
      label: 'OpenSidian',
      submenu: [
        {
          label: 'About OpenSidian',
          click: async (mi, win) => {
            const detail = `Version ${app.getVersion()} — independent open-source replication of Obsidian 1.12.4\nElectron ${process.versions.electron} · Node ${process.versions.node}`;
            await dialog.showMessageBox(win instanceof BrowserWindow ? win : undefined, {
              message: 'OpenSidian', detail,
            });
          },
        },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: (item, win) => {
          const target = win instanceof BrowserWindow ? win : BrowserWindow.getFocusedWindow();
          if (target) target.webContents.executeJavaScript(executeCommandJS('app:open-settings'));
        } },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { label: 'Hide OpenSidian', click: () => app.hide(), accelerator: 'Cmd+H' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit OpenSidian', click: () => app.quit(), accelerator: 'Cmd+Q' },
      ],
    }] : []),
    {
      label: '&File',
      submenu: [
        { type: 'separator' },
        { label: 'Open Vault...', click: () => openVaultStarter() },
        { type: 'separator' },
        ...(IS_MAC ? [] : [{ id: 'quit', role: 'quit' }]),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Paste as text', accelerator: IS_MAC ? 'Cmd+Shift+V' : 'Shift+CommandOrControl+V', click: (mi, win) => { if (win) win.webContents.pasteAndMatchStyle(); } },
        { role: 'delete' }, { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        ...(IS_DEV ? [{ role: 'reload' }] : []),
        { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: (mi, win) => { if (win) win.webContents.setZoomLevel(0); } },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: (mi, win) => { if (win) win.webContents.setZoomLevel(Math.min(5, win.webContents.getZoomLevel() + 0.5)); } },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: (mi, win) => { if (win) win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5)); } },
        { type: 'separator' },
        ...(IS_DEV ? [{ role: 'forceReload', accelerator: '' }] : []),
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Window', role: 'window',
      submenu: [
        { role: 'minimize', accelerator: IS_MAC ? 'CommandOrControl+M' : '' },
        ...(IS_MAC ? [{ role: 'zoom' }] : []),
        { type: 'separator' },
        { id: 'window-always-on-top', checked: false, enabled: true, type: 'checkbox', label: 'Always on Top', click: (mi, win) => {
          if (!win) return;
          win.setAlwaysOnTop(!win.isAlwaysOnTop());
        } },
        { role: 'front' },
      ],
    },
    {
      label: '&Help', role: 'help',
      submenu: [
        { label: 'Homepage', click: () => shell.openExternal('https://obsidian.md') },
      ],
    },
  ];
  rootMenuTemplate.splice(0, rootMenuTemplate.length, ...template);
  return Menu.buildFromTemplate(template);
}

let appMenu = null;
function installMenu() {
  appMenu = buildAppMenu();
  Menu.setApplicationMenu(appMenu);
}

// ---------------------------------------------------------------------------
// app:// protocol
// ---------------------------------------------------------------------------
function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let url = request.url;
    // strip query/hash
    try {
      const u = new URL(url);
      url = `${u.protocol}//${u.host}${u.pathname}`;
    } catch (e) { /* ignore */ }

    let filePath = null;
    let noframe = false;
    if (url.startsWith(APP_ORIGIN)) {
      let sub = decodeURIComponent(url.slice(APP_ORIGIN.length));
      // serve from renderer dir; dist/ for built files, assets/ for assets
      let resolved = path.resolve(RENDERER_DIR, sub);
      if (sub.startsWith('dist/') || sub.startsWith('assets/')) {
        resolved = path.resolve(APP_ROOT, sub);
      }
      if (!resolved.startsWith(RENDERER_DIR) && !resolved.startsWith(path.join(APP_ROOT, 'dist')) && !resolved.startsWith(ASSETS_DIR)) {
        return new Response('Not Found', { status: 400 });
      }
      filePath = resolved;
      noframe = true;
    } else if (url.startsWith(FILE_ORIGIN)) {
      let sub = url.slice(FILE_ORIGIN.length);
      if (IS_MAC || process.platform === 'linux') sub = '/' + sub;
      filePath = path.resolve(decodeURIComponent(sub));
    } else {
      return new Response('Not Found', { status: 400 });
    }

    try {
      const stat = await fs.promises.stat(filePath);
      const headers = new Headers();
      let status = 200;
      let stream;
      const range = request.headers.get('Range');
      if (range) {
        const m = range.match(/^bytes=(\d*)-(\d*)/);
        if (!m) return new Response('Range Not Satisfiable', { status: 416 });
        const start = Number(m[1] || 0);
        const end = Number(m[2] || stat.size - 1);
        if (isNaN(start) || isNaN(end) || start < 0 || end > stat.size - 1 || start > end) {
          return new Response('Range Not Satisfiable', { status: 416 });
        }
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Length', String(end - start + 1));
        headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        status = 206;
        stream = fs.createReadStream(filePath, { start, end });
      } else {
        headers.set('Content-Length', String(stat.size));
        stream = fs.createReadStream(filePath);
      }
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Last-Modified', stat.mtime.toUTCString());
      if (noframe) headers.set('X-Frame-Options', 'DENY');
      return new Response(streamToWeb(stream), { status, headers });
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  });
}

function streamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); },
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function openVaultWindow(id, focus = true) {
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
  let saveTimer;
  const debouncedSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveBounds, 150); };
  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('close', () => saveBounds());
  // 窗口状态推送给渲染进程（is-maximized / is-fullscreen / 红绿灯位置同步）
  const pushWindowState = () => { try { win.webContents.send('window-state-changed'); } catch (e) {} };
  for (const evt of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(evt, pushWindowState);

  secCtxWin(win);
  win.webContents.on('did-finish-load', () => { win.loaded = true; });
  if (IS_DEV) {
    // Forward renderer console to stdout so dev runs can be diagnosed from the log.
    win.webContents.on('console-message', (...args) => {
      const d = args[1];
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

  win.on('close', () => {
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 3000);
  });
  win.on('closed', () => {
    delete windows[id];
    const entry = VAULTS[id];
    if (entry) { delete entry.open; }
    if (!quitting && Object.keys(windows).length === 0) {
      // keep alive on mac like the original; show starter only when user requests
    }
    saveConfig();
  });

  win.loadURL(indexUrl).then(show, show);
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
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });
  win.on('closed', () => { starterWindow = null; });
  win.loadURL(APP_ORIGIN + 'starter.html').then(
    () => { if (E2E) win.showInactive(); else win.show(); },
    () => { if (E2E) win.showInactive(); else win.show(); },
  );
  secCtxWin(win);
  return win;
}

// vault message (obsidian:// style actions) handed to renderer
function sendVaultMessage(id, payload) {
  const win = openVaultWindow(id, false);
  const js = `(function(){ var w=window, o=${JSON.stringify(payload)}; if (typeof w.OBS_ACT === 'function') { w.OBS_ACT(o); } else { w.OBS_ACT = o; } })()`;
  if (win.loaded) win.webContents.executeJavaScript(js);
  else win.webContents.once('did-finish-load', () => win.webContents.executeJavaScript(js));
}

function openVaultPath(rawPath, create = false) {
  if (typeof rawPath !== 'string' || !rawPath) return 'folder not found';
  const p = path.resolve(rawPath);
  if (create) {
    if (fs.existsSync(p)) return 'Vault already exists';
    try { fs.mkdirSync(p, { recursive: true }); } catch (e) { return e.toString(); }
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
  ipcMain.on('version', (e) => { e.returnValue = '1.12.4'; });
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
  ipcMain.on('frame', (e, v) => { if (typeof v === 'string') { config.frame = v; } e.returnValue = config.frame; });

  ipcMain.on('vault', (e) => {
    for (const id in windows) {
      if (windows[id].webContents === e.sender) { e.returnValue = { id, path: path.resolve(VAULTS[id].path) }; return; }
    }
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
          try { fs.renameSync(from, to); } catch (err) { e.returnValue = err.toString(); return; }
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
  ipcMain.on('help', (e) => { e.returnValue = null; shell.openExternal('https://help.obsidian.md/'); });
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
  ipcMain.on('spellcheck-languages-set', (e, languages) => {
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
    try { await shell.trashItem(p); e.returnValue = true; }
    catch (err) { console.log(err); e.returnValue = false; }
  });
  ipcMain.on('get-documents-path', (e) => { e.returnValue = app.getPath('documents'); });
  ipcMain.on('get-sandbox-vault-path', (e) => { e.returnValue = path.join(DATA_DIR, 'Sanbox'); });
  ipcMain.on('get-default-vault-path', (e) => { e.returnValue = path.join(app.getPath('documents'), 'OpenSidian Vault'); });

  ipcMain.on('vault-open-default', (e, opts) => { /* create vault dialog path */ });

  ipcMain.on('open-url', (e, url) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && typeof url === 'string') shell.openExternal(url);
  });

  ipcMain.on('request-url', async (e, replyChannel, opts) => {
    try {
      const { url, method, contentType, body, headers } = opts;
      const net = require('electron').net;
      const req = net.request({ url, method, redirect: 'follow' });
      if (contentType) req.setHeader('Content-Type', contentType);
      if (headers) for (const k in headers) { try { req.setHeader(k, headers[k]); } catch (err) {} }
      req.on('login', (authInfo, cb) => cb());
      req.on('error', (err) => { e.reply(replyChannel, { error: err.message || String(err) }); });
      req.on('response', (res) => {
        const chunks = [];
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
      e.reply(replyChannel, { error: err.message || String(err) });
    }
  });

  ipcMain.on('print-to-pdf', async (e, options) => {
    const wc = e.sender;
    try {
      const { filepath, open } = options;
      const data = await wc.printToPDF(options);
      await fs.promises.writeFile(filepath, data);
      if (open) shell.openPath(filepath);
    } catch (err) { console.error(err); }
    finally { wc.send('print-to-pdf', {}); }
  });

  ipcMain.on('show-item-in-folder', (e, p) => { shell.showItemInFolder(p); });
  ipcMain.on('open-path', (e, p) => { shell.openPath(p); });
  ipcMain.on('open-external', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });

  ipcMain.on('set-menu', (e, arg) => { /* menu overrides from renderer: accepted but unused */ });
  ipcMain.on('update-menu-items', (e, items, refresh) => {});
  ipcMain.on('render-menu', (e) => {});

  ipcMain.on('dialog-open', async (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, opts);
    e.returnValue = result;
  });
  ipcMain.on('dialog-save', async (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showSaveDialog(win, opts);
    e.returnValue = result;
  });
  ipcMain.on('dialog-message', async (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showMessageBox(win, opts);
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
      try { if (IS_MAC && app.dock) app.dock.setIcon(null); } catch (err) {}
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
    e.returnValue = w ? { maximized: w.isMaximized(), fullscreen: w.isFullScreen() } : { maximized: false, fullscreen: false };
  });
  // 原版 updateStatus：按缩放补偿 macOS 红绿灯位置
  ipcMain.on('set-traffic-light-position', (e, x, y) => {
    if (!IS_MAC) return;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && typeof w.setTrafficLightPosition === 'function') {
      try { w.setTrafficLightPosition({ x: Math.round(x), y: Math.round(y) }); } catch (err) { /* 窗口样式不支持时忽略 */ }
    }
  });
  ipcMain.handle('plugin-select-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
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
    registerAppProtocol();
    setupIpc();
    installMenu();
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
