/**
 * [INPUT]: BrowserWindow、渲染器 flushForClose 与退出状态回调。
 * [OUTPUT]: guardWindowClose 等待真实保存后关闭，失败保留窗口。
 * [POS]: 主窗与文档窗口共用关闭守卫。异步保存完成后继续退出，不强制销毁脏文档。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { app } = require('electron');
function guardWindowClose(win, ctx) {
  let allowed = false, flushing = false;
  win.on('close', event => {
    if (allowed || win.webContents.isDestroyed() || ctx.canFlush?.() === false) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    win.webContents.executeJavaScript(`window.app?.flushForClose ? app.flushForClose() : true`)
      .then(result => {
        if (result === false || result?.ok === false) throw Error(result?.error || result?.failures?.map(item => item.path + '：' + item.message).join('\n') || '文档尚未保存');
        allowed = true;
        if (!win.isDestroyed()) win.close();
        if (ctx.isQuitting()) app.quit();
      }).catch(error => {
        flushing = false; ctx.cancelQuit?.();
        if (!win.isDestroyed()) {
          win.webContents.send('window-save-failed', error.message || '文档尚未保存，窗口保持打开');
          if (!ctx.isE2E) win.show();
        }
      });
  });
}
module.exports = { guardWindowClose };
