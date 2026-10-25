/**
 * [INPUT]: Electron 菜单与窗口 API；主入口提供打开仓库函数。
 * [OUTPUT]: 导出 installAppMenu，安装原生菜单。
 * [POS]: 主进程菜单边界。命令交给活动渲染器执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
const IS_MAC = process.platform === 'darwin';
const IS_DEV = !app.isPackaged;

function installAppMenu(openVaultStarter) {
function executeCommandJS(id) {
  return `(function(){ try { if (window.app && app.commands) return app.commands.executeCommandById(${JSON.stringify(id)}); } catch(e) { console.error(e); } })()`;
}

function buildAppMenu() {
  const isAppWindow = (w) => w instanceof BrowserWindow;
  function cmd(id) {
    return {
      click: (menuItem, win: Electron.BrowserWindow) => {
        const target = isAppWindow(win) ? win : BrowserWindow.getFocusedWindow();
        if (!target) return;
        if (menuItem.triggeredByAccelerator === false) return;
        target.webContents.executeJavaScript(executeCommandJS(id));
      },
    };
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(IS_MAC ? [{
      label: 'OpenSidian',
      submenu: [
        {
          label: 'About OpenSidian',
          click: async (mi, win: Electron.BrowserWindow) => {
            const detail = `Version ${app.getVersion()} — independent open-source replication of Obsidian 1.14.4\nElectron ${process.versions.electron} · Node ${process.versions.node}`;
            await dialog.showMessageBox(win instanceof BrowserWindow ? win : undefined, {
              message: 'OpenSidian', detail,
            });
          },
        },
        { type: 'separator' as const },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: (item, win: Electron.BrowserWindow) => {
          const target = win instanceof BrowserWindow ? win : BrowserWindow.getFocusedWindow();
          if (target) target.webContents.executeJavaScript(executeCommandJS('app:open-settings'));
        } },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { label: 'Hide OpenSidian', click: () => app.hide(), accelerator: 'Cmd+H' },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { label: 'Quit OpenSidian', click: () => app.quit(), accelerator: 'Cmd+Q' },
      ],
    }] : []),
    {
      label: '&File',
      submenu: [
        { type: 'separator' as const },
        { label: 'Open Vault...', click: () => openVaultStarter() },
        { type: 'separator' as const },
        ...(IS_MAC ? [] : [{ id: 'quit', role: 'quit' as const }]),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' as const }, { role: 'redo' as const }, { type: 'separator' as const },
        { role: 'cut' as const }, { role: 'copy' as const }, { role: 'paste' as const },
        { label: 'Paste as text', accelerator: IS_MAC ? 'Cmd+Shift+V' : 'Shift+CommandOrControl+V', click: (mi, win: Electron.BrowserWindow) => { if (win) win.webContents.pasteAndMatchStyle(); } },
        { role: 'delete' as const }, { role: 'selectAll' as const },
      ],
    },
    {
      label: '&View',
      submenu: [
        ...(IS_DEV ? [{ role: 'reload' as const }] : []),
        { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: (mi, win: Electron.BrowserWindow) => { if (win) win.webContents.setZoomLevel(0); } },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: (mi, win: Electron.BrowserWindow) => { if (win) win.webContents.setZoomLevel(Math.min(5, win.webContents.getZoomLevel() + 0.5)); } },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: (mi, win: Electron.BrowserWindow) => { if (win) win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5)); } },
        { type: 'separator' as const },
        ...(IS_DEV ? [{ role: 'forceReload' as const, accelerator: '' }] : []),
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: '&Window', role: 'window' as const,
      submenu: [
        { role: 'minimize' as const, accelerator: IS_MAC ? 'CommandOrControl+M' : '' },
        ...(IS_MAC ? [{ role: 'zoom' as const }] : []),
        { type: 'separator' as const },
        { id: 'window-always-on-top', checked: false, enabled: true, type: 'checkbox' as const, label: 'Always on Top', click: (mi, win: Electron.BrowserWindow) => {
          if (!win) return;
          win.setAlwaysOnTop(!win.isAlwaysOnTop());
        } },
        { role: 'front' as const },
      ],
    },
    {
      label: '&Help', role: 'help' as const,
      submenu: [
        { label: 'Homepage', click: () => shell.openExternal('https://obsidian.md') },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

  Menu.setApplicationMenu(buildAppMenu());
}

export { installAppMenu };
