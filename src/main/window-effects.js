/**
 * [INPUT]: Electron IPC 与发送方所属窗口。
 * [OUTPUT]: 导出 registerWindowEffectsIpc，设置 macOS 窗口材质。
 * [POS]: 原生窗口外观边界。偏好由库外观配置持久化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function registerWindowEffectsIpc({ ipcMain, BrowserWindow }) {
  ipcMain.on('window-translucency', (event, enabled) => {
    if (process.platform !== 'darwin') return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor('#00000000');
    win.setVibrancy(enabled ? 'sidebar' : null);
    win._opensidianVibrancy = enabled ? 'sidebar' : null;
  });
}

module.exports = { registerWindowEffectsIpc };
