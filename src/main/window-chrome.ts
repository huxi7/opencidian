/**
 * [INPUT]: Electron 窗口类型、边框偏好与实际运行平台。
 * [OUTPUT]: 导出 frameWindowOptions 与 installWindowStateNotifications。
 * [POS]: 四类窗口共用的原生边框边界。macOS 保留红绿灯；Windows/Linux 的无边框按钮由渲染器绘制。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type * as Electron from 'electron';

export function frameWindowOptions(frame: string, platform: NodeJS.Platform, icon?: string): Electron.BrowserWindowConstructorOptions {
  const base = { icon, ...(platform === 'darwin' ? {} : { autoHideMenuBar: true }) };
  if (frame === 'native') return { ...base, frame: true, titleBarStyle: 'default' };
  if (platform !== 'darwin') return { ...base, frame: false };
  if (frame === 'custom') return { ...base, frame: false, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } };
  return { ...base, frame: false, titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 12 } };
}

export function installWindowStateNotifications(win: Electron.BrowserWindow) {
  const push = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('window-state-changed');
  };
  win.on('maximize', push);
  win.on('unmaximize', push);
  win.on('enter-full-screen', push);
  win.on('leave-full-screen', push);
  win.on('restore', push);
  win.webContents.on('did-finish-load', push);
}
