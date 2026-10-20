/**
 * [INPUT]: Electron app、BrowserWindow 与可配置前缀的 OBS_* 环境变量（主窗 OBS_、启动器 OBS_STARTER_）；Node fs。
 * [OUTPUT]: 导出 devScreenshotHook，执行隔离验收动作、DOM探针和浅/深截图。
 * [POS]: 主进程调试入口；无对应前缀配置时不安装钩子。第二窗口用 prefix/logTag/quit 隔离。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { app } = require('electron');
const fs = require('fs');

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
          let payload;
          try { payload = JSON.parse(act); } catch (e) { payload = { action: 'exec', command: act }; }
          if (payload.action === 'eval' && payload.js) {
            const result = await win.webContents.executeJavaScript(String(payload.js));
            console.log(`[${logTag}] eval:`, JSON.stringify(result));
          } else {
            await win.webContents.executeJavaScript(
              `(function(){ var o=${JSON.stringify(payload)}; if (typeof window.OBS_ACT === 'function') { window.OBS_ACT(o); } else { window.OBS_ACT = o; } })()`
            );
            console.log(`[${logTag}] act:`, JSON.stringify(payload));
          }
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) { console.error(`[${logTag}] act failed`, e); }
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
        try { await capture(out); } catch (e) { console.error(`[${logTag}] screenshot failed`, e); }
      }
      if (outLight) {
        try {
          await win.webContents.executeJavaScript(
            `document.body.removeClass('theme-dark');document.body.addClass('theme-light');'light'`
          );
          await new Promise((r) => setTimeout(r, 150));
          await capture(outLight);
        } catch (e) { console.error(`[${logTag}] light screenshot failed`, e); }
      }
      if (quit && env('SCREENSHOT_EXIT')) app.quit();
    }, delay);
  };
  win.webContents.on('render-process-gone', (event, details) => {
    console.error(`[${logTag}] renderer gone`, details);
  });
  win.webContents.once('did-finish-load', start);
  // loadURL() 已可能在钩子装配前完成（小页面/缓存命中）；此时立即启动。
  if (!win.webContents.isLoading()) start();
}

module.exports = { devScreenshotHook };
