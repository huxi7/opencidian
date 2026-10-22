/**
 * [INPUT]: Menu 实例、分节排序结果、Desktop IPC 与外观偏好。
 * [OUTPUT]: 提供 usesNativeMenu、showNativeMenu、closeNativeMenu。
 * [POS]: DOM 菜单和系统菜单共用动作树。E2E 默认保留 DOM，仅专属场景测试原生桥。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ipcInvoke, ipcSend } from './ipc.js';
import { Notice } from './notices.js';
let nextToken = 0;
export function usesNativeMenu(menu) {
  const pref = menu.app?.settings?.appearance?.nativeMenus;
  const configured = pref === true || pref == null && navigator.platform.startsWith('Mac');
  const e2e = process.env.E2E === '1' || process.env.OBS_E2E === '1' || !!process.env.OBS_ACT;
  return configured && (!e2e || window.__NATIVE_MENU_TEST__ === true);
}
export function closeNativeMenu(menu) {
  if (menu._nativeToken == null) return;
  ipcSend('native-menu-close', menu._nativeToken); menu._nativeToken = null;
}
export function showNativeMenu(menu, pos) {
  const routes = new Map();
  const serialize = (source, prefix = []) => {
    const grouped = source._sectioned || source.sections.length || Object.keys(source.submenuConfigs).length;
    const ordered = grouped ? source._sort() : source.items;
    return ordered.map((item, index) => {
      const route = [...prefix, index]; routes.set(route.join('.'), item);
      if (item.isSeparator) return { separator: true };
      return { label: item.title, enabled: !item.disabled && !item.isLabel,
        checkable: item._checkable === true, checked: item.checked, ...(item.submenu ? { submenu: serialize(item.submenu, route) } : {}) };
    });
  };
  const token = ++nextToken;
  menu._nativeToken = token; menu.parentEl?.addClass('has-active-menu'); menu.onShow?.();
  menu.nativeResult = ipcInvoke('native-menu-popup', { token, items: serialize(menu), x: pos.x, y: pos.y })
    .then(async result => {
      if (menu._nativeToken !== token) return;
      menu._nativeToken = null; menu.parentEl?.removeClass('has-active-menu'); menu.onHide?.();
      if (result.error) { new Notice(result.error); return; }
      const item = result.selected && routes.get(result.selected.join('.'));
      if (item && !item.disabled && !item.isLabel) await item.callback?.(new MouseEvent('click', {
        metaKey: !!result.modifiers?.metaKey, ctrlKey: !!result.modifiers?.ctrlKey,
        altKey: !!result.modifiers?.altKey, shiftKey: !!result.modifiers?.shiftKey,
      }));
    }).catch(error => { menu._nativeToken = null; menu.parentEl?.removeClass('has-active-menu'); new Notice(error.message); });
  return null;
}
