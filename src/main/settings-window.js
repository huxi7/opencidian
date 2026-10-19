/**
 * [INPUT]: Electron 的 BrowserWindow/ipcMain/screen；main.js 注入的 frameWindowOptions/indexUrl/E2E/locale 查询
 * [OUTPUT]: setupSettingsWindows(ctx) → { vaultIdFor, closeFor, getSettingsWindow }
 * [POS]: 主进程的设置独立窗口管理器。每个 vault 至多一个窗口（原版：每个应用窗口各有自己的 popout），
 *        对齐 Obsidian 1.14.4 setWindowOpenHandler("about:blank"+"popup") 的 overrideBrowserWindowOptions：
 *        跟随「窗口边框」配置的 frame/titleBarStyle、900x700（min 600x400）、首次相对主窗口居中、
 *        单实例复用聚焦、窗口标题取页面 document.title（渲染层设 设置 - 库名 - 应用版本）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs');
const path = require('path');

function setupSettingsWindows(ctx) {
  const { BrowserWindow, ipcMain, screen, indexUrl, frameWindowOptions, isE2E, vaultPathForId, getVaultWindow, getVersion, isChinese } = ctx;
  /** vaultId → { id, win, pendingTabId } */
  const windows = new Map();

  const alive = (entry) => !!entry && !!entry.win && !entry.win.isDestroyed();
  const entryForVault = (id) => {
    const entry = id ? windows.get(id) : null;
    return alive(entry) ? entry : null;
  };
  const entryForSender = (sender) => {
    for (const entry of windows.values()) {
      if (!alive(entry) || entry.win.webContents.isDestroyed()) continue;
      if (entry.win.webContents.id === sender.id) return entry;
    }
    return null;
  };
  /** 设置窗口自身发起 → 自己的 entry；主窗口发起 → 同 vault 的 entry。 */
  const entryForEvent = (event) => {
    const own = entryForSender(event.sender);
    if (own) return own;
    const parent = BrowserWindow.fromWebContents(event.sender);
    return entryForVault(parent && parent.vaultId);
  };

  /** 原版 getAppTitle(windowTitle) = "设置 - {库名} - {应用名 版本}"；页面加载前先给出同形态初始标题。 */
  function defaultTitle(id) {
    const vaultPath = id ? vaultPathForId(id) : null;
    const name = vaultPath ? path.basename(vaultPath) : '';
    const version = getVersion ? getVersion() : '';
    return [isChinese() ? '设置' : 'Settings', name, 'OpenSidian' + (version ? ' ' + version : '')]
      .filter(Boolean).join(' - ');
  }

  function create(payload, parent, id) {
    const width = Math.max(Number(payload.width) || 900, 300);
    const height = Math.max(Number(payload.height) || 700, 200);
    let x; let y;
    // 原版：坐标必须落在某个显示器才使用，否则相对主窗口居中（screenX + (outerWidth - w)/2）
    if (typeof payload.x === 'number' && typeof payload.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return payload.x < a.x + a.width - 2 && payload.x + width > a.x + 2 &&
               payload.y < a.y + a.height - 2 && payload.y + height > a.y + 2;
      });
      if (visible) { x = Math.round(payload.x); y = Math.round(payload.y); }
    }
    if (x === undefined || y === undefined) {
      const base = parent && !parent.isDestroyed() ? parent.getBounds() : null;
      if (base) {
        x = Math.round(base.x + (base.width - width) / 2);
        y = Math.round(base.y + (base.height - height) / 2);
      }
    }
    const win = new BrowserWindow({
      width,
      height,
      minWidth: 600,                          // 原版 getPopoutOptions：minWidth 600 / minHeight 400
      minHeight: 400,
      ...(x !== undefined ? { x, y } : {}),
      // 原版 parented=1：仅当主窗口全屏时把弹窗挂为子窗口
      ...(parent && !parent.isDestroyed() && parent.isFullScreen() ? { parent, fullscreen: false } : {}),
      autoHideMenuBar: true,                  // 原版 overrideBrowserWindowOptions.autoHideMenuBar
      show: false,
      backgroundColor: typeof payload.background === 'string' && payload.background ? payload.background : '#00000000',
      ...frameWindowOptions(),                // 原版 frame/titleBarStyle 跟随应用「窗口边框」设置
      ...(isE2E ? { focusable: false, opacity: 0 } : {}),
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        nodeIntegrationInWorker: true,
        spellcheck: true,
        webviewTag: true,
        backgroundThrottling: false,
      },
    });
    const entry = { id, win, pendingTabId: payload.tabId || null };
    windows.set(id, entry);
    const show = () => {
      if (!alive(entry)) return;
      try { win.setTitle(defaultTitle(id)); } catch (e) { /* 页面标题会在加载后接管 */ }
      if (isE2E) win.showInactive(); else win.show();
    };
    win.loadURL(indexUrl + '#settings-window').then(show, show);
    win.on('closed', () => { if (windows.get(id) === entry) windows.delete(id); });
    return entry;
  }

  function open(payload, parent) {
    payload = payload || {};
    const id = payload.vaultId || (parent && parent.vaultId);
    if (!id) return { ok: false };
    const existing = entryForVault(id);
    if (existing) {
      // 原版单实例：同一个应用窗口再点设置 → restore + focus，不新开
      const win = existing.win;
      if (win.isMinimized()) win.restore();
      if (!isE2E) win.focus();
      if (payload.tabId) { try { win.webContents.send('settings-window-open-tab', { tabId: payload.tabId }); } catch (e) {} }
      return { ok: true, reused: true };
    }
    create(payload, parent, id);
    return { ok: true, reused: false };
  }

  ipcMain.on('settings-window-open', (e, payload) => {
    e.returnValue = open(payload || {}, BrowserWindow.fromWebContents(e.sender));
  });

  ipcMain.on('settings-window-close', (e) => {
    // 同步 IPC 内先回执再关窗：避免关窗重入阻塞调用方（渲染层 sendSync）
    const entry = entryForEvent(e);
    setImmediate(() => { if (alive(entry)) entry.win.close(); });
    e.returnValue = true;
  });

  /** 开关切回应用内模态：关闭本窗口并在主窗口重开（原版 setting.close(); setting.open() 的跨窗口等价物）。 */
  ipcMain.on('settings-window-toggle', (e, payload) => {
    const tabId = payload && payload.tabId;
    // 发起方通常是设置窗口自身；验收/命令路径也可能由主窗口发起，则回退到其 vaultId
    const senderEntry = entryForSender(e.sender);
    const parent = BrowserWindow.fromWebContents(e.sender);
    const id = (senderEntry && senderEntry.id) || (payload && payload.vaultId) || (parent && parent.vaultId) || null;
    const entry = senderEntry || entryForVault(id);
    const target = id ? getVaultWindow(id) : null;
    // 先给主窗口派发重开指令，再延后销毁设置窗口：sendSync 期间不销毁发起方 webContents
    if (target && !target.isDestroyed()) {
      try { target.webContents.send('settings-open-modal', { tabId: tabId || '', settingsPopoutWindow: false }); } catch (err) {}
      if (!isE2E && !target.isDestroyed()) { if (target.isMinimized()) target.restore(); target.focus(); }
    }
    setImmediate(() => { if (alive(entry)) entry.win.close(); });
    e.returnValue = true;
  });

  /** 渲染层内 `app.setting.open()` 且命中 popout 时，读取目标页签（设置窗口启动时消费一次）。 */
  ipcMain.on('settings-window-pending-tab', (e) => {
    const entry = entryForSender(e.sender);
    e.returnValue = entry ? (entry.pendingTabId || '') : '';
    if (entry) entry.pendingTabId = null;
  });

  ipcMain.on('settings-window-info', (e) => {
    const entry = entryForEvent(e);
    if (!alive(entry)) { e.returnValue = { open: false }; return; }
    const win = entry.win;
    let bounds = null; let minSize = null; let title = '';
    try { bounds = win.getBounds(); } catch (err) {}
    try { minSize = win.getMinimumSize(); } catch (err) {}
    try { title = win.getTitle(); } catch (err) {}
    e.returnValue = {
      open: true,
      vaultId: entry.id,
      bounds,
      minSize,
      title,
      focused: !isE2E && win.isFocused(),
      frame: ctx.getFrame ? ctx.getFrame() : null,
      isNativeFrame: ctx.getFrame ? ctx.getFrame() === 'native' : false,
    };
  });

  /** 返回设置窗口内的 DOM 事实（验收探针）；窗口未开时 open:false。
   *  可选 action={action:'toggle-off'}：在窗口内点击「在新窗口中打开设置」开关，验证真实发送方路径。 */
  ipcMain.handle('settings-window-probe', async (e, action) => {
    const entry = entryForEvent(e);
    if (!alive(entry) || entry.win.webContents.isDestroyed()) return { open: false };
    if (action && action.action === 'toggle-off') {
      return entry.win.webContents.executeJavaScript(`(async () => {
        const rows = [...document.querySelectorAll('.setting-item')];
        const row = rows.find((el) => { const n = el.querySelector('.setting-item-name'); return n && /在新窗口中打开设置|Open settings in new window/.test(n.textContent || ''); });
        if (!row) return 'no-row';
        row.scrollIntoView({ block: 'center' });
        const input = row.querySelector('.checkbox-container input[type=checkbox]');
        if (!input) return 'no-toggle';
        input.click();
        return 'clicked';
      })()`);
    }
    const script = `(() => ({
      title: document.title,
      isPopoutBody: document.body.hasClass ? document.body.hasClass('is-popout-modal') : document.body.classList.contains('is-popout-modal'),
      isSettingsWindow: document.body.classList.contains('is-settings-window'),
      navItems: document.querySelectorAll('.vertical-tab-nav-item').length,
      activeTab: (() => { const el = document.querySelector('.vertical-tab-nav-item.is-active .vertical-tab-nav-item-title'); return el ? el.textContent : null; })(),
      hasSettingsModal: !!document.querySelector('.modal.mod-settings'),
      closeButtonDisplay: (() => { const b = document.querySelector('.modal-close-button'); return b ? getComputedStyle(b).display : null; })(),
      modalShadow: (() => { const m = document.querySelector('.modal'); return m ? getComputedStyle(m).boxShadow : null; })(),
      theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      titlebarDisplay: (() => { const t = document.querySelector('.titlebar'); return t ? getComputedStyle(t).display : null; })(),
      titlebarAppRegion: (() => { const t = document.querySelector('.titlebar'); return t ? (getComputedStyle(t).webkitAppRegion || getComputedStyle(t).getPropertyValue('-webkit-app-region') || '') : null; })(),
      titlebarRect: (() => { const t = document.querySelector('.titlebar'); if (!t) return null; const r = t.getBoundingClientRect(); return { top: r.top, height: r.height, width: r.width }; })(),
      titlebarText: (() => { const t = document.querySelector('.titlebar-text'); return t ? t.textContent : null; })(),
      modalContainerTop: (() => { const c = document.querySelector('.modal-container'); return c ? c.getBoundingClientRect().top : null; })(),
      bodyPaddingTop: getComputedStyle(document.body).paddingTop,
      modalRect: (() => { const m = document.querySelector('.modal.mod-settings'); if (!m) return null; const r = m.getBoundingClientRect(); return { top: r.top, height: r.height }; })(),
      popoutToggle: (() => {
        const rows = [...document.querySelectorAll('.setting-item')];
        const row = rows.find((el) => { const n = el.querySelector('.setting-item-name'); return n && /在新窗口中打开设置|Open settings in new window/.test(n.textContent || ''); });
        if (!row) return false;
        try { row.scrollIntoView({ block: 'center' }); } catch (e) {}
        return true;
      })(),
    }))()`;
    try {
      // 竞速护栏：webContents 在销毁过程中 executeJavaScript 可能永不 settle
      const result = await Promise.race([
        entry.win.webContents.executeJavaScript(script),
        new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (!result) return { open: true, timeout: true };
      return { open: true, ...result };
    } catch (err) { return { open: true, error: String(err) }; }
  });

  /** 截取设置窗口页面并写入 PNG（验收截图；主窗口截图仍由 dev-hooks 负责）。 */
  ipcMain.handle('settings-window-capture', async (e, outPath) => {
    const entry = entryForEvent(e);
    if (!alive(entry) || entry.win.webContents.isDestroyed() || typeof outPath !== 'string' || !outPath) return { ok: false };
    try {
      // E2E 下窗口透明/不可见时合成器可能不产新帧：显式 invalidate 后取当前帧
      try { entry.win.webContents.invalidate(); } catch (err) {}
      await new Promise((resolve) => setTimeout(resolve, 250));
      const image = await entry.win.webContents.capturePage();
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, image.toPNG());
      const size = image.getSize();
      return { ok: true, path: outPath, width: size.width, height: size.height };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  return {
    vaultIdFor(webContents) {
      const entry = entryForSender(webContents);
      return entry ? entry.id : null;
    },
    closeFor(id) {
      const entry = entryForVault(id);
      if (entry) entry.win.close();
    },
    getSettingsWindow(id) {
      const entry = entryForVault(id);
      return entry ? entry.win : null;
    },
  };
}

module.exports = { setupSettingsWindows };
