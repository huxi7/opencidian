/**
 * [INPUT]: Electron app、BrowserWindow 与可配置前缀的 OBS_* 环境变量（主窗 OBS_、启动器 OBS_STARTER_）；Node fs。
 * [OUTPUT]: 导出 devScreenshotHook，执行隔离验收动作、DOM探针和浅/深截图；主窗等待启动器完成再退出。
 * [POS]: 主进程调试入口；无对应前缀配置时不安装钩子。第二窗口用 prefix/logTag/quit 隔离，完成或失败通过主进程 Promise 结算。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { app } = require('electron');
const fs = require('fs');

// 两个窗口共享主进程状态。主窗退出不能早于伴随动作与截图完成。
const companion = process.env.OBS_STARTER_ACT ? (() => {
  let settle; const done = new Promise(resolve => { settle = resolve; });
  return { done, settle, settled: false };
})() : null;
function finishCompanion(result) {
  if (!companion || companion.settled) return;
  companion.settled = true; companion.settle(result);
}
async function waitForCompanion() {
  if (!companion) return;
  const configured = Number(process.env.OBS_STARTER_ACT_TIMEOUT || 60000);
  const timeout = Number.isFinite(configured) && configured > 0 ? configured : 60000;
  let timer;
  try {
    const result = await Promise.race([companion.done, new Promise(resolve => {
      timer = setTimeout(() => resolve({ ok: false, error: '等待启动器验收回执超时：' + timeout + 'ms' }), timeout);
    })]);
    if (!result?.ok) throw Error(result?.error || '启动器验收失败');
  } finally { clearTimeout(timer); }
}


/**
 * 通用窗口验收钩子。prefix 让第二窗口（starter）使用独立的 OBS_STARTER_* 变量，
 * 不抢占主窗口的 OBS_ACT/OBS_SCREENSHOT；logTag 只影响回执前缀。
 */
function devScreenshotHook(win, id, options) {
  const { prefix = 'OBS_', logTag = 'dev', quit = true } = options || {};
  const env = (name) => process.env[prefix + name];
  const out = env('SCREENSHOT');
  const outLight = env('SCREENSHOT_LIGHT');
  const dump = env('DUMP');
  const openFile = env('OPEN_FILE');
  const act = env('ACT');
  if (!out && !outLight && !dump && !openFile && !act) return;
  const delay = Number(env('SCREENSHOT_DELAY') || 3000);
  const log = (message) => console.log(`[${logTag}] ${message}`);
  const isCompanion = prefix === 'OBS_STARTER_';
  let actionError = null;
  if (isCompanion) win.webContents.on('console-message', (...args) => {
    const details = args[1]; const message = details && typeof details === 'object' ? details.message : args[2];
    if (String(message).startsWith('[starter-checkpoint]')) log(message);
  });
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    setTimeout(async () => {
      if (openFile) {
        try {
          const res = await win.webContents.executeJavaScript(
            `(async () => { try { const f = app.vault.getFileByPath(${JSON.stringify(openFile)}); if (!f) return 'not found: ' + ${JSON.stringify(openFile)}; await app.workspace.openFile(f); return 'opened ' + f.path; } catch (e) { return 'open failed: ' + e.message; } })()`
          );
          log('open file: ' + res);
        } catch (e) { console.error(`[${logTag}] open file failed`, e); }
        if (out || dump) {
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      if (act) {
        try {
          if (prefix === 'OBS_') await win.webContents.executeJavaScript(`(async () => {
            const deadline = Date.now() + 60000;
            while (!window.app?.workspace?._sidebarReady || !window.app?.commands?.findCommand('app:open-settings')) {
              if (Date.now() > deadline) throw Error('等待应用装配完成超时');
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          })()`);
          let payload;
          try { payload = JSON.parse(act); } catch (e) { payload = { action: 'exec', command: act }; }
          if (payload.action === 'eval' && payload.js) {
            if (isCompanion) log('act started');
            const result = await win.webContents.executeJavaScript(String(payload.js));
            console.log(`[${logTag}] eval:`, JSON.stringify(result));
            if (isCompanion && !(result?.pass === true && Array.isArray(result.checks) && Number.isInteger(result.count) && result.count > 0 && result.count === result.checks.length)) actionError = '启动器没有返回有效的通过回执';
          } else {
            await win.webContents.executeJavaScript(
              `(function(){ var o=${JSON.stringify(payload)}; if (typeof window.OBS_ACT === 'function') { window.OBS_ACT(o); } else { window.OBS_ACT = o; } })()`
            );
            console.log(`[${logTag}] act:`, JSON.stringify(payload));
          }
          if (out || outLight || dump) await new Promise((r) => setTimeout(r, 1500));
        } catch (e) { actionError = e.message || String(e); console.error(`[${logTag}] act failed`, e); }
      }
      if (dump) {
        try {
          const js = `(() => {
            const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
            const pick = (sel) => [...document.querySelectorAll(sel)].map((el) => ({ cls: String(el.className).slice(0, 80), rect: r(el), text: (el.innerText || '').replace(/\\n/g, ' ').slice(0, 40) }));
            const leaves = [];
            const walk = (node) => {
              if (node && node.view) {
                let icon = null, title = null, iconErr = '', titleErr = '';
                try { icon = node.view.getIcon && node.view.getIcon(); } catch (e) { iconErr = String(e); }
                try { title = node.view.getDisplayText && node.view.getDisplayText(); } catch (e) { titleErr = String(e); }
                leaves.push({
                  viewType: node.view.getViewType(),
                  ctor: node.view.constructor && node.view.constructor.name,
                  icon, title, iconErr, titleErr,
                  headerConnected: !!(node._tabHeaderEl && node._tabHeaderEl.isConnected),
                  leafConnected: !!(node._leafEl && node._leafEl.isConnected),
                  hasContentEl: !!node.contentEl,
                });
              }
              if (node && node.children) node.children.forEach(walk);
            };
            if (window.app && app.workspace) walk(app.workspace.rootSplit);
            return JSON.stringify({
              viewport: [innerWidth, innerHeight, devicePixelRatio],
              bodyClass: String(document.body.className),
              body: [...document.body.children].map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), rect: r(el) })),
              splits: pick('.workspace-split'),
              tabs: pick('.workspace-tabs'),
              headers: [...document.querySelectorAll('.workspace-tab-header')].map((el) => ({
                type: el.getAttribute('data-type'),
                cls: String(el.className).slice(0, 60),
                rect: r(el),
                title: (el.querySelector('.workspace-tab-header-inner-title') || {}).textContent || '',
                hasSvg: !!el.querySelector('.workspace-tab-header-inner-icon svg'),
                html: el.outerHTML.replace(/\\s+/g, ' ').slice(0, 260),
              })),
              leaves,
              leafDom: [...document.querySelectorAll('.workspace-leaf')].map((el) => ({
                cls: String(el.className).slice(0, 60),
                rect: r(el),
                display: getComputedStyle(el).display,
                type: (el.querySelector('.workspace-leaf-content') || {}).getAttribute ? el.querySelector('.workspace-leaf-content').getAttribute('data-type') : null,
                inSplit: el.closest('.workspace-split') ? String(el.closest('.workspace-split').className).slice(0, 50) : null,
                inTabs: el.parentElement ? String(el.parentElement.className).slice(0, 50) : null,
              })),
              statusBar: pick('.status-bar'),
            }, null, 1);
          })()`;
          const res = await win.webContents.executeJavaScript(js);
          console.log(`[${logTag}] dom dump:\n` + res);
        } catch (e) { console.error(`[${logTag}] dom dump failed`, e); }
      }
      if (env('DUMP_HTML')) {
        try {
          const sel = env('DUMP_HTML');
          const res = await win.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.outerHTML : 'NOT FOUND: ' + ${JSON.stringify(sel)}; })()`
          );
          console.log(`[${logTag}] html dump (${sel}):\n` + String(res).slice(0, 30000));
        } catch (e) { console.error(`[${logTag}] html dump failed`, e); }
      }
      const capture = async (file) => {
        const rectEnv = env('SCREENSHOT_RECT');
        let rect;
        if (rectEnv) {
          const [x, y, w, h] = rectEnv.split(',').map(Number);
          rect = { x, y, width: w, height: h };
        }
        const image = await win.webContents.capturePage(rect);
        fs.writeFileSync(file, image.toPNG());
        log('screenshot written: ' + file);
      };
      if (out) {
        try { await capture(out); } catch (e) { actionError = e.message || String(e); console.error(`[${logTag}] screenshot failed`, e); }
      }
      if (outLight) {
        try {
          await win.webContents.executeJavaScript(
            `document.body.removeClass('theme-dark');document.body.addClass('theme-light');'light'`
          );
          await new Promise((r) => setTimeout(r, 150));
          await capture(outLight);
        } catch (e) { actionError = e.message || String(e); console.error(`[${logTag}] light screenshot failed`, e); }
      }
      if (isCompanion) finishCompanion({ ok: !actionError, error: actionError });
      if (quit && env('SCREENSHOT_EXIT')) {
        try { await waitForCompanion(); } catch (error) { console.error(`[${logTag}] act failed`, error); }
        app.quit();
      }
    }, delay);
  };
  win.webContents.on('render-process-gone', (event, details) => {
    if (isCompanion) finishCompanion({ ok: false, error: '启动器验收渲染进程退出：' + details.reason });
    console.error(`[${logTag}] renderer gone`, details);
  });
  if (isCompanion) win.once('closed', () => finishCompanion({ ok: false, error: '启动器验收窗口在回执前关闭' }));
  win.webContents.once('did-finish-load', start);
  // loadURL() 已可能在钩子装配前完成（小页面/缓存命中）；此时立即启动。
  if (!win.webContents.isLoading()) start();
}

module.exports = { devScreenshotHook };
