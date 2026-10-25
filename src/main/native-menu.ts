/**
 * [INPUT]: Electron Menu/IPC 与声明式菜单树；主入口注入 E2E 标志。
 * [OUTPUT]: registerNativeMenuIpc 注册弹出、关闭和隔离验收接口。
 * [POS]: 原生上下文菜单边界。只返回选项路径；退出与弹出失败均释放监听。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Menu, BrowserWindow } from 'electron';
import { errorMessage, type NativeMenuEntry } from './main-types';
import type { NativeMenuItem, NativeMenuRequest as NativeMenuPayload, NativeMenuResult } from '../ipc-contracts.js';
function registerNativeMenuIpc({ ipcMain, isE2E }: { ipcMain: Electron.IpcMain; isE2E: boolean }) {
  const active = new Map<number, NativeMenuEntry>();
  ipcMain.handle('native-menu-popup', (event, payload: NativeMenuPayload) => new Promise<NativeMenuResult>(resolve => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !Array.isArray(payload?.items) || !Number.isSafeInteger(payload.token)) return resolve({ selected: null });
    active.get(event.sender.id)?.finish(null);
    const entry: NativeMenuEntry = { token: payload.token, finish: () => {}, menu: null };
    const destroyed = () => finish(null);
    const finish = (selected: number[] | null, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => {
      if (active.get(event.sender.id) !== entry) return;
      active.delete(event.sender.id);
      event.sender.removeListener('destroyed', destroyed);
      entry.menu?.closePopup(win);
      resolve({ selected, modifiers: Object.fromEntries((['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const).map(key => [key, !!modifiers?.[key]])) });
    };
    entry.finish = finish;
    const convert = (items: NativeMenuItem[], prefix: number[] = [], depth = 0): Electron.MenuItemConstructorOptions[] => {
      if (depth > 8 || items.length > 500) throw Error('菜单层级或条目超限');
      return items.map((item, index) => {
        const route = [...prefix, index];
        if (item.separator) return { type: 'separator' };
        const result: Electron.MenuItemConstructorOptions = { id: route.join('.'), label: String(item.label || '').slice(0, 1000).replace(/\B&\B/, '&&'),
          enabled: item.enabled !== false, type: item.checkable ? 'checkbox' : 'normal', checked: !!item.checked };
        if (Array.isArray(item.submenu)) result.submenu = convert(item.submenu, route, depth + 1);
        else result.click = (_item, _win, modifiers) => finish(route, modifiers);
        return result;
      });
    };
    try {
      entry.menu = Menu.buildFromTemplate(convert(payload.items));
      entry.items = payload.items;
      active.set(event.sender.id, entry);
      event.sender.once('destroyed', destroyed);
      const zoom = win.webContents.getZoomFactor();
      if (!isE2E) entry.menu.popup({ window: win, x: Math.round((Number(payload.x) || 0) * zoom), y: Math.round((Number(payload.y) || 0) * zoom), callback: () => finish(null) });
    } catch (error) {
      if (active.get(event.sender.id) === entry) {
        active.delete(event.sender.id); event.sender.removeListener('destroyed', destroyed);
        entry.menu?.closePopup(win);
      }
      resolve({ selected: null, error: errorMessage(error) });
    }
  }));
  ipcMain.on('native-menu-close', (event, token: number) => {
    const entry = active.get(event.sender.id);
    if (entry?.token === token) entry.finish(null);
  });
  ipcMain.handle('native-menu-test', (event, payload: { select?: number[] } = {}) => {
    if (!isE2E) return null;
    const entry = active.get(event.sender.id);
    if (!entry) return null;
    if (payload.select) {
      const item = entry.menu?.getMenuItemById(payload.select.join('.'));
      if (!item || !item.enabled || item.submenu || item.type === 'separator') return { selected: false };
      item.click(item, BrowserWindow.fromWebContents(event.sender) || undefined, {}); return { selected: true };
    }
    return { token: entry.token, items: entry.items, nativeItems: entry.menu?.items.map(item => ({ label: item.label, type: item.type, checked: item.checked, enabled: item.enabled })), native: entry.menu instanceof Menu, popupSuppressed: true };
  });
}
export { registerNativeMenuIpc };
