/**
 * [INPUT]: Electron app、BrowserWindow 与 OBS_* 环境变量；Node fs。
 * [OUTPUT]: 导出 devScreenshotHook，执行隔离验收动作、DOM探针和截图。
 * [POS]: 主进程调试入口；无 OBS_* 配置时不安装钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { app } = require('electron');
const fs = require('fs');

function devScreenshotHook(win, id) {
  const out = process.env.OBS_SCREENSHOT;
  const dump = process.env.OBS_DUMP;
  const openFile = process.env.OBS_OPEN_FILE;
  const act = process.env.OBS_ACT;
  if (!out && !dump && !openFile && !act) return;
  const delay = Number(process.env.OBS_SCREENSHOT_DELAY || 3000);
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      if (openFile) {
        try {
          const res = await win.webContents.executeJavaScript(
            `(async () => { try { const f = app.vault.getFileByPath(${JSON.stringify(openFile)}); if (!f) return 'not found: ' + ${JSON.stringify(openFile)}; await app.workspace.openFile(f); return 'opened ' + f.path; } catch (e) { return 'open failed: ' + e.message; } })()`
          );
          console.log('[dev] open file:', res);
        } catch (e) { console.error('[dev] open file failed', e); }
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
            console.log('[dev] eval:', JSON.stringify(result));
          } else {
            await win.webContents.executeJavaScript(
              `(function(){ var o=${JSON.stringify(payload)}; if (typeof window.OBS_ACT === 'function') { window.OBS_ACT(o); } else { window.OBS_ACT = o; } })()`
            );
            console.log('[dev] act:', JSON.stringify(payload));
          }
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) { console.error('[dev] act failed', e); }
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
          console.log('[dev] dom dump:\n' + res);
        } catch (e) { console.error('[dev] dom dump failed', e); }
      }
      if (process.env.OBS_DUMP_HTML) {
        try {
          const sel = process.env.OBS_DUMP_HTML;
          const res = await win.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.outerHTML : 'NOT FOUND: ' + ${JSON.stringify(sel)}; })()`
          );
          console.log('[dev] html dump (' + sel + '):\n' + String(res).slice(0, 30000));
        } catch (e) { console.error('[dev] html dump failed', e); }
      }
      if (out) {
        try {
          const rectEnv = process.env.OBS_SCREENSHOT_RECT;
          let rect;
          if (rectEnv) {
            const [x, y, w, h] = rectEnv.split(',').map(Number);
            rect = { x, y, width: w, height: h };
          }
          const image = await win.webContents.capturePage(rect);
          fs.writeFileSync(out, image.toPNG());
          console.log('[dev] screenshot written:', out);
        } catch (e) {
          console.error('[dev] screenshot failed', e);
        }
      }
      if (process.env.OBS_SCREENSHOT_EXIT) app.quit();
    }, delay);
  });
}

module.exports = { devScreenshotHook };
