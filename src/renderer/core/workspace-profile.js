/**
 * [INPUT]: 依赖 Workspace 的 app；复用 Menu、图标、tt、Notice 与桌面 IPC。
 * 使用已安装的 DOM 助手；Node path 取库名，Electron clipboard 写路径。
 * [OUTPUT]: 导出 createVaultProfile、refreshVaultProfile，返回稳定的库信息 DOM。
 * [POS]: 左侧栏底部组件。渲染器负责挂载与 CSS，本模块负责菜单和操作。
 * 每次展开重读已注册库；关闭菜单时释放监听并清除按钮活动态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop, ipcSend } from './ipc.js';
import { setIcon } from './icons.js';
import { tt } from './i18n.js';
import { Menu } from './menu.js';
import { Notice } from './notices.js';

const nodePath = require('path');
const { clipboard } = require('electron');
const profiles = new WeakMap();
const MENU_GAP = 4;
const MENU_EDGE = 8;

// ---------------------------------------------------------------------------
// 稳定节点：重绘只迁移组件，不重复注册按钮事件。
// ---------------------------------------------------------------------------
export function createVaultProfile(workspace) {
  if (profiles.has(workspace)) return refreshVaultProfile(workspace);

  const containerEl = createDiv('workspace-sidedock-vault-profile');
  const switcherEl = containerEl.createDiv('workspace-drawer-vault-switcher');
  const iconEl = switcherEl.createDiv('workspace-drawer-vault-switcher-icon');
  setIcon(iconEl, 'chevrons-up-down');
  iconEl.setAttr('aria-hidden', 'true');
  const nameEl = switcherEl.createDiv('workspace-drawer-vault-name');
  const actionsEl = containerEl.createDiv('workspace-drawer-vault-actions');
  const helpEl = actionsEl.createSpan('clickable-icon');
  const settingsEl = actionsEl.createSpan('clickable-icon');
  setIcon(helpEl, 'circle-help');
  setIcon(settingsEl, 'settings');

  const state = { workspace, containerEl, switcherEl, nameEl, helpEl, settingsEl, menu: null };
  profiles.set(workspace, state);
  switcherEl.setAttr('aria-haspopup', 'menu');
  switcherEl.setAttr('aria-expanded', 'false');
  bindButton(switcherEl, () => openVaultMenu(state));
  bindButton(helpEl, () => { state.menu?.close(); ipcSend('help'); });
  bindButton(settingsEl, () => { state.menu?.close(); workspace.app.setting.open(); });
  switcherEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPathMenu(state);
  });
  switcherEl.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    openPathMenu(state);
  });
  return refreshVaultProfile(workspace);
}

export function refreshVaultProfile(workspace) {
  const state = profiles.get(workspace);
  if (!state) return createVaultProfile(workspace);
  const path = currentPath(workspace);
  const name = workspace.app.vault?.getName() || nodePath.basename(path) || '仓库';
  const manage = tt('interface.manage-vaults', '管理仓库…');
  state.nameEl.setText(name);
  state.nameEl.title = path || name;
  state.switcherEl.title = path ? `${manage}\n${path}` : manage;
  state.switcherEl.setAttr('aria-label', `${manage} ${name}`);
  labelButton(state.helpEl, tt('interface.help', '帮助'));
  labelButton(state.settingsEl, tt('interface.settings', '设置'));
  return state.containerEl;
}

function currentPath(workspace) {
  return Desktop.vault()?.path || workspace.app.vaultPath
    || workspace.app.vault?.adapter?.getBasePath() || '';
}

function labelButton(element, label) {
  element.title = label;
  element.setAttr('aria-label', label);
}

function bindButton(element, action) {
  element.setAttr('role', 'button');
  element.setAttr('tabindex', '0');
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
  element.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) action();
  });
}

// ---------------------------------------------------------------------------
// 菜单内容：注册表只在展开时读取，不提供移除库入口。
// ---------------------------------------------------------------------------
function openVaultMenu(state) {
  if (state.menu) return;
  const path = currentPath(state.workspace);
  const entries = Object.values(Desktop.vaultList() || {});
  const menu = new Menu(state.workspace.app);
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path) continue;
    const checked = !!path && nodePath.resolve(entry.path) === nodePath.resolve(path);
    const item = addAction(menu, nodePath.basename(entry.path) || entry.path, null, () => {
      if (checked) return;
      try {
        if (Desktop.vaultOpen(entry.path, false) === true) return;
      } catch { /* IPC 失败与主进程拒绝使用同一提示。 */ }
      new Notice(tt('interface.start-screen.msg-error-failed-to-open-vault', '无法打开仓库。'));
    }).setChecked(checked);
    item.isVault = true;
  }
  if (menu.items.length) menu.addSeparator();
  addAction(menu, tt('interface.manage-vaults', '管理仓库…'), 'open-vault',
    () => Desktop.openStarter());
  showMenu(state, menu);
}

function openPathMenu(state) {
  state.menu?.close();
  const path = currentPath(state.workspace);
  if (!path) return;
  const menu = new Menu(state.workspace.app);
  const isMac = navigator.platform.startsWith('Mac');
  const reveal = isMac
    ? tt('plugins.open-with-default-app.action-show-in-folder-mac', '在访达中显示')
    : tt('plugins.open-with-default-app.action-show-in-folder', '在系统资源管理器中显示');
  addAction(menu, reveal, 'arrow-up-right', () => Desktop.showItemInFolder(path));
  addAction(menu, tt('interface.menu.copy-path', '复制路径'), 'clipboard', () => {
    clipboard.writeText(path);
    new Notice(tt('interface.copied_generic', '已复制到剪贴板'));
  });
  showMenu(state, menu);
}

function addAction(menu, title, icon, action) {
  return menu.addItem((item) => {
    item.setTitle(title);
    if (icon) item.setIcon(icon);
    item.onClick(() => {
      // 先关闭，外部操作失败也不能留下活动态或全局监听。
      menu.close();
      action();
    });
  });
}

// ---------------------------------------------------------------------------
// 菜单生命周期：适配现有 Menu，不改变公共菜单基座。
// ---------------------------------------------------------------------------
function showMenu(state, menu) {
  const anchor = state.switcherEl;
  const rect = anchor.getBoundingClientRect();
  const dom = menu.showAtPosition({ x: rect.left, y: rect.top });
  const close = () => menu.close();
  const onMouseDown = menu._docMouseDown;
  const onKeyDown = menu._docKeyDown;
  menu._docMouseDown = (event) => {
    if (!anchor.contains(event.target)) onMouseDown(event);
  };
  menu._docKeyDown = (event) => {
    if (event.key === 'Tab') { close(); return; }
    if (['Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.stopPropagation();
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        return;
      }
    }
    onKeyDown(event);
  };
  const listeners = [
    ['mousedown', menu._docMouseDown],
    ['contextmenu', menu._docContext],
    ['keydown', menu._docKeyDown],
  ];
  const observer = new MutationObserver(() => {
    if (!anchor.isConnected || !anchor.getClientRects().length) close();
  });
  menu.onHide = () => {
    observer.disconnect();
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    if (state.menu === menu) {
      state.menu = null;
      anchor.removeClass('has-active-menu');
      anchor.setAttr('aria-expanded', 'false');
    }
    // Menu 在下一任务注册监听；同一任务内关闭后仍须撤销迟到的注册。
    setTimeout(() => {
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    }, 0);
  };
  state.menu = menu;
  anchor.addClass('has-active-menu');
  anchor.setAttr('aria-expanded', 'true');
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style'] });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);

  // 高菜单在按钮上方滚动，不能遮住底部的帮助与设置。
  dom.style.maxHeight = Math.max(0, rect.top - MENU_GAP - MENU_EDGE) + 'px';
  const size = dom.getBoundingClientRect();
  dom.style.top = Math.max(MENU_EDGE, rect.top - MENU_GAP - size.height) + 'px';
  dom.style.left = Math.max(MENU_EDGE,
    Math.min(rect.left, window.innerWidth - size.width - MENU_EDGE)) + 'px';
  dom.setAttr('role', 'menu');
  for (const item of menu.items) {
    if (!item.dom || item.isSeparator) continue;
    item.dom.setAttr('role', item.isVault ? 'menuitemradio' : 'menuitem');
    if (item.isVault) item.dom.setAttr('aria-checked', String(item.checked));
  }
}
