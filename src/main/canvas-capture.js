/**
 * [INPUT]: Electron 的 ipcMain 与 BrowserWindow；渲染进程提交 DIP 截图矩形。
 * [OUTPUT]: registerCanvasCaptureIpc 注册 canvas-capture-page。
 * [POS]: 主进程画布导出的截图边界。只截发送方窗口，不创建或激活窗口。
 * 矩形必须为窗口内容范围内的有限整数；失败向调用方抛错。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function registerCanvasCaptureIpc({ ipcMain, BrowserWindow }) {
  ipcMain.handle('canvas-capture-page', async (event, rect) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error('画布导出窗口已关闭');
    const [width, height] = win.getContentSize();
    if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(rect[key]))
      || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1
      || rect.x + rect.width > width || rect.y + rect.height > height) {
      throw new Error('画布导出截图范围无效');
    }
    let timeout;
    let image;
    try {
      image = await Promise.race([
        event.sender.capturePage(rect, { stayHidden: true, stayAwake: true }),
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('画布导出截图超时')), 10000);
        }),
      ]);
    } finally { clearTimeout(timeout); }
    if (image.isEmpty()) throw new Error('画布导出截图为空');
    return image.toDataURL();
  });
}

module.exports = { registerCanvasCaptureIpc };
