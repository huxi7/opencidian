/**
 * [INPUT]: 依赖 core/dom 的元素助手、core/i18n 的语言与文案、core/ipc 的 Desktop 门面、core/menu 的菜单、
 *          core/setting 的 Setting 控件、core/tooltip 的悬浮提示、core/notices 的 Notice，以及原版 starter.html 的 SVG 品牌标记。
 * [OUTPUT]: 渲染 1.14.4 starter 窗口：最近仓库列表、快速开始、打开本地仓库、新建仓库、语言/帮助；导出无，调试时挂 window.__starterTest。
 * [POS]: 独立“仓库选择”窗口的唯一渲染入口。点击行打开库；行菜单负责重命名/移动/复制 ID/访达/移除。
 *        左侧 280px 列表与右侧 splash 的层级、文案、图标和几何按原版 app.css 19225-19500 与 starter.js 对齐。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Vault switcher ("starter") window logic — 1.14.4 parity. */
import type { VaultDescriptor } from '../contracts.js';
import './core/dom.js';
import { setLanguage, detectLanguage, getLanguage, tt } from './core/i18n.js';
import { setIcon } from './core/icons.js';
import { Desktop, ipcSend } from './core/ipc.js';
import { Menu } from './core/menu.js';
import { Setting } from './core/setting.js';
import { Notice } from './core/notices.js';
import { setTooltip } from './core/tooltip.js';

const nodePath = require('path');
const fs = require('fs');
const { clipboard } = require('electron');

setLanguage(detectLanguage());

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// 锁定词条：键与原版 interface.start-screen.* 一一对应
// ---------------------------------------------------------------------------
const LABEL_VERSION = () => tt('interface.start-screen.label-version', '版本');
const LABEL_CREATE_LOCAL = () => tt('interface.start-screen.label-create-local-vault', '创建本地仓库');
const OPT_CREATE = () => tt('interface.start-screen.option-create-vault', '新建仓库');
const OPT_CREATE_DESC = () => tt('interface.start-screen.option-create-vault-description', '在指定文件夹下创建一个新的仓库。');
const OPT_OPEN = () => tt('interface.start-screen.option-open-folder-as-vault', '打开本地仓库');
const OPT_OPEN_DESC = () => tt('interface.start-screen.option-open-folder-as-vault-description', '将一个本地文件夹作为仓库在 OpenSidian 中打开。');
const BUTTON_QUICK_START = () => tt('interface.start-screen.button-quick-start', '快速开始');
const BUTTON_OPEN = () => tt('interface.start-screen.button-open', '打开');
const BUTTON_BROWSE = () => tt('interface.start-screen.button-browse', '浏览');
const BUTTON_CREATE = () => tt('interface.start-screen.button-create-vault', '创建');
const BUTTON_BACK = () => tt('interface.start-screen.button-back', '返回');
const OPT_NEW_NAME = () => tt('interface.start-screen.option-new-vault-name', '仓库名称');
const OPT_NEW_NAME_DESC = () => tt('interface.start-screen.option-new-vault-name-description', '给新仓库起一个名字');
const OPT_NEW_LOCATION = () => tt('interface.start-screen.option-new-vault-location', '仓库位置');
const OPT_NEW_LOCATION_DESC = () => tt('interface.start-screen.option-new-vault-location-description', '指定新仓库的存放位置。');
const LABEL_LOCATION_PREVIEW = () => tt('interface.start-screen.label-new-vault-location-preview', '新仓库将存放于：');
const OPT_RENAME = () => tt('interface.start-screen.option-rename-vault', '重命名仓库…');
const OPT_MOVE = () => tt('interface.start-screen.option-move-vault', '移动仓库…');
const OPT_COPY_ID = () => tt('interface.start-screen.option-copy-vault-i-d', '复制仓库 ID');
const OPT_REVEAL = () => IS_MAC
  ? tt('interface.start-screen.option-reveal-vault-in-explorer-mac', '在访达中显示仓库文件夹')
  : tt('interface.start-screen.option-reveal-vault-in-explorer', '在系统资源管理器中显示仓库文件夹');
const OPT_REMOVE = () => tt('interface.start-screen.option-remove', '从仓库列表中移除');
const OPT_HELP = () => tt('interface.start-screen.option-get-help', '获取帮助');
const MORE_OPTIONS = () => tt('interface.menu.more-options', '更多选项');
const COPIED = () => tt('interface.copied_generic', '已复制到剪贴板');
const ERROR_OPEN = () => tt('interface.start-screen.msg-error-failed-to-open-vault', '无法打开。');
const ERROR_REMOVE_OPEN = () => tt('interface.start-screen.msg-error-remove-current-open-vault', '无法删除当前打开的仓库。');
const ERROR_RENAME_EXISTS = () => tt('interface.start-screen.msg-error-rename-exists', '该名称已被使用。');
const ERROR_MOVE_EXISTS = () => tt('interface.start-screen.msg-error-move-exists', '当前路径中已存在一个仓库。');
const ERROR_NESTED = () => tt('interface.start-screen.msg-error-nested', '不能将仓库移动到其子文件夹下。');
const ERROR_RENAME_OPEN = () => tt('interface.start-screen.msg-error-rename-open', '不能重命名正在打开的仓库。');
const ERROR_MOVE_OPEN = () => tt('interface.start-screen.msg-error-move-open', '不能移动正在打开的仓库。');
const ERROR_RENAME_FAILED = () => tt('interface.start-screen.msg-rename-failed', '重命名仓库失败。');
const ERROR_MOVE_FAILED = () => tt('interface.start-screen.msg-move-failed', '移动仓库失败。');
const MSG_RENAME_OK = () => tt('interface.start-screen.msg-rename-success', '成功重命名仓库。');
const MSG_MOVE_OK = () => tt('interface.start-screen.msg-move-success', '移动仓库成功。');
const MSG_MOVE_DEST = () => tt('interface.start-screen.msg-move-select-dest', '选择要移动到的文件夹');
const MSG_EMPTY_NAME = () => tt('interface.start-screen.msg-empty-vault-name', '仓库名称不能为空。');
const MSG_TRAILING_DOT = () => tt('interface.start-screen.msg-trailing-dot-vault-name', '仓库名称不能以英文句号.结尾。');
const MSG_INVALID_FOLDER = () => tt('interface.start-screen.msg-invalid-folder', '请选择一个有效的文件夹。');
const MSG_CREATE_FAILED = () => tt('interface.start-screen.msg-failed-to-create-vault', '无法创建仓库文件夹。');
const MSG_CREATE_FAILED_AT = () => tt('interface.start-screen.msg-failed-to-create-vault-at-location', '无法在指定位置创建仓库文件夹。请仔细检查位置和权限。');

// ---------------------------------------------------------------------------
// 原版 splash 品牌标记（starter.js 内联 SVG；OpenSidian 保留同一晶体标记）
// ---------------------------------------------------------------------------
const LOGO_SVG = '<svg viewBox="0 0 512 512" width="90" height="90"><radialGradient id="logo-bottom-left" cx="0" cy="0" gradientTransform="matrix(-59 -225 150 -39 161.4 470)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".4"></stop><stop offset="1" stop-opacity=".1"></stop></radialGradient><radialGradient id="logo-top-right" cx="0" cy="0" gradientTransform="matrix(50 -379 280 37 360 374.2)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"></stop><stop offset="1" stop-color="#fff" stop-opacity=".1"></stop></radialGradient><radialGradient id="logo-top-left" cx="0" cy="0" gradientTransform="matrix(69 -319 218 47 175.4 307)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".8"></stop><stop offset="1" stop-color="#fff" stop-opacity=".4"></stop></radialGradient><radialGradient id="logo-bottom-right" cx="0" cy="0" gradientTransform="matrix(-96 -163 187 -111 335.3 512.2)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"></stop><stop offset="1" stop-color="#fff" stop-opacity=".3"></stop></radialGradient><radialGradient id="logo-top-edge" cx="0" cy="0" gradientTransform="matrix(-36 166 -112 -24 310 128.2)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity="0"></stop><stop offset="1" stop-color="#fff" stop-opacity=".2"></stop></radialGradient><radialGradient id="logo-left-edge" cx="0" cy="0" gradientTransform="matrix(88 89 -190 187 111 220.2)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"></stop><stop offset="1" stop-color="#fff" stop-opacity=".4"></stop></radialGradient><radialGradient id="logo-bottom-edge" cx="0" cy="0" gradientTransform="matrix(9 130 -276 20 215 284)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"></stop><stop offset="1" stop-color="#fff" stop-opacity=".3"></stop></radialGradient><radialGradient id="logo-middle-edge" cx="0" cy="0" gradientTransform="matrix(-198 -104 327 -623 400 399.2)" gradientUnits="userSpaceOnUse" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"></stop><stop offset=".5" stop-color="#fff" stop-opacity=".2"></stop><stop offset="1" stop-color="#fff" stop-opacity=".3"></stop></radialGradient><clipPath id="clip"><path d="M.2.2h512v512H.2z"></path></clipPath><g clip-path="url(#clip)"><path d="M382.3 475.6c-3.1 23.4-26 41.6-48.7 35.3-32.4-8.9-69.9-22.8-103.6-25.4l-51.7-4a34 34 0 0 1-22-10.2l-89-91.7a34 34 0 0 1-6.7-37.7s55-121 57.1-127.3c2-6.3 9.6-61.2 14-90.6 1.2-7.9 5-15 11-20.3L248 8.9a34.1 34.1 0 0 1 49.6 4.3L386 125.6a37 37 0 0 1 7.6 22.4c0 21.3 1.8 65 13.6 93.2 11.5 27.3 32.5 57 43.5 71.5a17.3 17.3 0 0 1 1.3 19.2 1494 1494 0 0 1-44.8 70.6c-15 22.3-21.9 49.9-25 73.1z" fill="#6c31e3"></path><path d="M165.9 478.3c41.4-84 40.2-144.2 22.6-187-16.2-39.6-46.3-64.5-70-80-.6 2.3-1.3 4.4-2.2 6.5L60.6 342a34 34 0 0 0 6.6 37.7l89.1 91.7a34 34 0 0 0 9.6 7z" fill="url(#logo-bottom-left)"></path><path d="M278.4 307.8c11.2 1.2 22.2 3.6 32.8 7.6 34 12.7 65 41.2 90.5 96.3 1.8-3.1 3.6-6.2 5.6-9.2a1536 1536 0 0 0 44.8-70.6 17 17 0 0 0-1.3-19.2c-11-14.6-32-44.2-43.5-71.5-11.8-28.2-13.5-72-13.6-93.2 0-8.1-2.6-16-7.6-22.4L297.6 13.2a34 34 0 0 0-1.5-1.7 96 96 0 0 1 2 54 198.3 198.3 0 0 1-17.6 41.3l-7.2 14.2a171 171 0 0 0-19.4 71c-1.2 29.4 4.8 66.4 24.5 115.8z" fill="url(#logo-top-right)"></path><path d="M278.4 307.8c-19.7-49.4-25.8-86.4-24.5-115.9a171 171 0 0 1 19.4-71c2.3-4.8 4.8-9.5 7.2-14.1 7.1-13.9 14-27 17.6-41.4a96 96 0 0 0-2-54A34.1 34.1 0 0 0 248 9l-105.4 94.8a34.1 34.1 0 0 0-10.9 20.3l-12.8 85-.5 2.3c23.8 15.5 54 40.4 70.1 80a147 147 0 0 1 7.8 24.8c28-6.8 55.7-11 82.1-8.3z" fill="url(#logo-top-left)"></path><path d="M333.6 511c22.7 6.2 45.6-12 48.7-35.4a187 187 0 0 1 19.4-63.9c-25.6-55-56.5-83.6-90.4-96.3-36-13.4-75.2-9-115 .7 8.9 40.4 3.6 93.3-30.4 162.2 4 1.8 8.1 3 12.5 3.3 0 0 24.4 2 53.6 4.1 29 2 72.4 17.1 101.6 25.2z" fill="url(#logo-bottom-right)"></path><g clip-rule="evenodd" fill-rule="evenodd"><path d="M254.1 190c-1.3 29.2 2.4 62.8 22.1 112.1l-6.2-.5c-17.7-51.5-21.5-78-20.2-107.6a174.7 174.7 0 0 1 20.4-72c2.4-4.9 8-14.1 10.5-18.8 7.1-13.7 11.9-21 16-33.6 5.7-17.5 4.5-25.9 3.8-34.1 4.6 29.9-12.7 56-25.7 82.4a177.1 177.1 0 0 0-20.7 72z" fill="url(#logo-top-edge)"></path><path d="M194.3 293.4c2.4 5.4 4.6 9.8 6 16.5L195 311c-2.1-7.8-3.8-13.4-6.8-20-17.8-42-46.3-63.6-69.7-79.5 28.2 15.2 57.2 39 75.7 81.9z" fill="url(#logo-left-edge)"></path><path d="M200.6 315.1c9.8 46-1.2 104.2-33.6 160.9 27.1-56.2 40.2-110.1 29.3-160z" fill="url(#logo-bottom-edge)"></path><path d="M312.5 311c53.1 19.9 73.6 63.6 88.9 100-19-38.1-45.2-80.3-90.8-96-34.8-11.8-64.1-10.4-114.3 1l-1.1-5c53.2-12.1 81-13.5 117.3 0z" fill="url(#logo-middle-edge)"></path></g></g></svg>';

// ---------------------------------------------------------------------------
// 窗口骨架：titlebar 覆盖在内容上（原版 .starter 把 body padding-top 归零）
// ---------------------------------------------------------------------------
const body = document.body;
body.addClass('is-focused');
if (IS_MAC) body.addClass('mod-macos');
else if (IS_WIN) body.addClass('mod-windows');
else body.addClass('mod-linux');

const titlebar = body.createDiv('titlebar');
const titlebarInner = titlebar.createDiv('titlebar-inner');
titlebarInner.createDiv('titlebar-text').setText('OpenSidian');

const screenEl = body.createDiv('starter-screen');
const screenInner = screenEl.createDiv('starter-screen-inner');
const recentEl = screenInner.createDiv('recent-vaults');
const recentListEl = recentEl.createDiv('recent-vaults-list');
const splashEl = screenInner.createDiv('splash');
const brandEl = splashEl.createDiv('splash-brand');
const logoEl = brandEl.createDiv('splash-brand-logo');
logoEl.innerHTML = LOGO_SVG;
const wordmarkEl = brandEl.createDiv('splash-brand-logo-text');
wordmarkEl.setText('OpenSidian');
brandEl.createDiv('splash-brand-version')
  .setText(`${LABEL_VERSION()} ${Desktop.version()}`);
const optionsContainer = splashEl.createDiv('open-vault-options-container');

// ---------------------------------------------------------------------------
// 打开最近仓库
// ---------------------------------------------------------------------------
function closeStarter() {
  ipcSend('window-close');
}

function openVault(path: string, create = false) {
  const res = Desktop.vaultOpen(path, create);
  if (res === true) { closeStarter(); return true; }
  const detail = typeof res === 'string' && res ? ` ${res}.` : '';
  new Notice(`${ERROR_OPEN()}${detail}`);
  return false;
}

// ---------------------------------------------------------------------------
// 行菜单：节序与原版 addSections(["open","info","action","system","","danger"]) 一致
// ---------------------------------------------------------------------------
function rowMenu(entry: VaultDescriptor & { id: string }, row: HTMLElement, nameEl: HTMLDivElement, event: Pick<MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>) {
  event.preventDefault();
  event.stopPropagation();
  const rect = row.getBoundingClientRect();
  const x = event.clientX || rect.left + 8;
  const y = event.clientY || rect.top + 8;
  const menu = new Menu(null);
  menu.setParentElement(row);
  menu.addSections(['open', 'info', 'action', 'system', '', 'danger']);
  menu.addItem(item => item
    .setIcon('copy').setSection('info').setTitle(OPT_COPY_ID())
    .onClick(() => {
      clipboard.writeText(entry.id);
      new Notice(COPIED());
    }));
  menu.addItem(item => item
    .setIcon('edit-3').setSection('action').setTitle(OPT_RENAME())
    .onClick(() => beginRename(entry, row, nameEl)));
  menu.addItem(item => item
    .setIcon('folder-tree').setSection('action').setTitle(OPT_MOVE())
    .onClick(() => chooseMove(entry)));
  menu.addItem(item => item
    .setIcon('folder-open').setSection('system').setTitle(OPT_REVEAL())
    .onClick(() => Desktop.showItemInFolder(entry.path)));
  menu.addItem(item => item
    .setIcon('x').setSection('danger').setWarning(true).setTitle(OPT_REMOVE())
    .onClick(() => removeVault(entry)));
  menu.showAtPosition({ x, y });
}

function removeVault(entry: { path: string; }) {
  // 原版没有二次确认框：危险色菜单项即确认步骤；主进程拒绝移除正在打开的库。
  if (Desktop.vaultRemove(entry.path)) renderVaults();
  else new Notice(ERROR_REMOVE_OPEN());
}

// 原版 starter 的重命名是行内 contenteditable；Enter/失焦提交，Esc 取消。
function beginRename(entry: VaultDescriptor, row: HTMLElement, nameEl: HTMLElement) {
  const baseName = nodePath.basename(entry.path) || entry.path;
  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    nameEl.removeAttribute('contenteditable');
    nameEl.removeAttribute('tabindex');
    nameEl.removeEventListener('keydown', onKeyDown);
    const value = (nameEl.innerText || '').trim();
    if (commit && value && value !== baseName) {
      moveVault(entry, nodePath.join(nodePath.dirname(entry.path), value), 'rename');
    } else {
      renderVaults();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      nameEl.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      nameEl.setText(baseName);
      finish(false);
    }
  };
  nameEl.setAttr('contenteditable', 'true');
  nameEl.setAttr('tabindex', '-1');
  nameEl.addEventListener('click', (event: { preventDefault: () => void; }) => {
    if (nameEl.isContentEditable) event.preventDefault();
  });
  nameEl.addEventListener('keydown', onKeyDown);
  nameEl.addEventListener('blur', () => finish(true), { once: true });
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function chooseMove(entry: VaultDescriptor) {
  const res = Desktop.openDialog({
    title: MSG_MOVE_DEST(),
    defaultPath: nodePath.dirname(entry.path),
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
  });
  const dest = res && !res.canceled && res.filePaths && res.filePaths[0];
  if (!dest) return;
  moveVault(entry, nodePath.join(dest, nodePath.basename(entry.path)), 'move');
}

function moveVault(entry: { path: string; }, target: string, kind: string) {
  const rename = kind === 'rename';
  if (target === entry.path) { renderVaults(); return false; }
  if (fs.existsSync(target)) {
    new Notice(rename ? ERROR_RENAME_EXISTS() : ERROR_MOVE_EXISTS());
    renderVaults();
    return false;
  }
  const relative = nodePath.relative(entry.path, target);
  if (relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative)) {
    new Notice(ERROR_NESTED());
    renderVaults();
    return false;
  }
  const res = Desktop.vaultMove(entry.path, target);
  if (res === 'EVAULTOPEN') {
    new Notice(rename ? ERROR_RENAME_OPEN() : ERROR_MOVE_OPEN());
    renderVaults();
    return false;
  }
  if (res) {
    new Notice(`${rename ? ERROR_RENAME_FAILED() : ERROR_MOVE_FAILED()} ${res}`);
    renderVaults();
    return false;
  }
  new Notice(rename ? MSG_RENAME_OK() : MSG_MOVE_OK());
  renderVaults();
  return true;
}

// ---------------------------------------------------------------------------
// 最近仓库列表
// ---------------------------------------------------------------------------
function renderVaults() {
  const registry = Desktop.vaultList() || {};
  const entries = Object.entries(registry)
    .map(([id, entry]) => ({ id, path: entry && entry.path, ts: (entry && entry.ts) || 0 }))
    .filter(entry => typeof entry.path === 'string' && entry.path)
    .sort((a, b) => b.ts - a.ts);
  recentListEl.empty();
  const hasVaults = entries.length > 0;
  recentEl.toggle(hasVaults);
  quickStartEl.toggle(!hasVaults);
  for (const entry of entries) renderRow(entry);
}

function renderRow(entry: VaultDescriptor & { id: string }) {
  const name = nodePath.basename(entry.path) || entry.path;
  const row = recentListEl.createDiv('recent-vaults-list-item');
  row.setAttr('data-tooltip-position', 'right');
  row.setAttr('tabindex', '0');
  row.setAttr('role', 'button');
  row.setAttr('aria-label', entry.path);
  setTooltip(row, entry.path, { placement: 'right' });
  const nameEl = row.createDiv('recent-vaults-list-item-name');
  nameEl.setText(name);
  row.createDiv('recent-vaults-list-item-path').setText(nodePath.dirname(entry.path));
  const moreEl = row.createDiv('recent-vaults-list-item-option-button');
  setIcon(moreEl, 'more-vertical');
  moreEl.setAttr('aria-label', MORE_OPTIONS());
  moreEl.setAttr('role', 'button');
  moreEl.setAttr('tabindex', '0');

  row.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    openVault(entry.path);
  });
  row.addEventListener('contextmenu', event => rowMenu(entry, row, nameEl, event));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    openVault(entry.path);
  });
  moreEl.addEventListener('click', event => rowMenu(entry, row, nameEl, event));
  moreEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    const rect = moreEl.getBoundingClientRect();
    rowMenu(entry, row, nameEl, { clientX: rect.left, clientY: rect.bottom, preventDefault() {}, stopPropagation() {} });
  });
}

// ---------------------------------------------------------------------------
// 打开页：快速开始 + 新建/打开 + 语言/帮助
// ---------------------------------------------------------------------------
const openScreen = optionsContainer.createDiv('open-vault-options mod-open-vault');
const quickStartEl = openScreen.createDiv('quick-start-container u-center-text');
const quickStartButton = quickStartEl.createEl('button', { cls: 'mod-cta', text: BUTTON_QUICK_START() });
quickStartButton.addEventListener('click', quickStart);

const openGroup = openScreen.createDiv('setting-group');
openGroup.createDiv('setting-group-search').setAttr('tabindex', '-1');
const openItems = openGroup.createDiv('setting-items');

const createSetting = new Setting(openItems);
createSetting.settingEl.setAttr('tabindex', '-1');
createSetting.setName(OPT_CREATE()).setDesc(OPT_CREATE_DESC())
  .addButton(button => button.setButtonText(BUTTON_CREATE()).setCta()
    .onClick(() => showScreen('create')));

const openSetting = new Setting(openItems);
openSetting.settingEl.setAttr('tabindex', '-1');
openSetting.setName(OPT_OPEN()).setDesc(OPT_OPEN_DESC())
  .addButton(button => button.setButtonText(BUTTON_OPEN()).onClick(chooseFolder));

const languageSetting = new Setting(openItems);
languageSetting.settingEl.setAttr('tabindex', '-1');
languageSetting.setClass('mod-change-language');
setIcon(languageSetting.nameEl, 'circle-help');
languageSetting.nameEl.setAttr('aria-label', OPT_HELP());
languageSetting.nameEl.setAttr('role', 'button');
languageSetting.nameEl.setAttr('tabindex', '0');
languageSetting.nameEl.addEventListener('click', () => ipcSend('help'));
languageSetting.nameEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  ipcSend('help');
});
languageSetting.addDropdown((dropdown) => {
  dropdown.addOption('en', 'English');
  dropdown.addOption('zh', '简体中文');
  dropdown.setValue(getLanguage() === 'zh' ? 'zh' : 'en');
  dropdown.onChange((value) => {
    setLanguage(value);
    window.location.reload();
  });
});

function quickStart() {
  const target = Desktop.defaultVaultPath();
  let res = Desktop.vaultOpen(target, true);
  if (res === true) {
    Desktop.vaultMessage(target, { action: 'vault-setup' });
    closeStarter();
    return;
  }
  res = Desktop.vaultOpen(target, false);
  if (res === true) { closeStarter(); return; }
  new Notice(`${ERROR_OPEN()} ${typeof res === 'string' ? res : ''}.`.trim());
}

function chooseFolder() {
  const res = Desktop.openDialog({
    title: OPT_OPEN(),
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
  });
  if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) return;
  openVault(res.filePaths[0]);
}

// ---------------------------------------------------------------------------
// 新建页：名称 + 位置 + 返回
// ---------------------------------------------------------------------------
const createScreen = optionsContainer.createDiv('open-vault-options mod-create-vault');
createScreen.style.transform = 'translateX(100%)';
const backEl = createScreen.createDiv('back-button');
setIcon(backEl, 'arrow-left');
backEl.appendText(BUTTON_BACK());
backEl.setAttr('role', 'button');
backEl.setAttr('tabindex', '0');
backEl.addEventListener('click', () => showScreen('open'));
backEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  showScreen('open');
});

const createGroup = createScreen.createDiv('setting-group');
const createHeading = createGroup.createDiv('setting-item setting-item-heading');
createHeading.createDiv('setting-item-name').setText(LABEL_CREATE_LOCAL());
createHeading.createDiv('setting-item-control');
createGroup.createDiv('setting-group-search').setAttr('tabindex', '-1');
const createItems = createGroup.createDiv('setting-items');

let nameInput: HTMLInputElement|null = null;
const nameSetting = new Setting(createItems);
nameSetting.settingEl.setAttr('tabindex', '-1');
nameSetting.setName(OPT_NEW_NAME()).setDesc(OPT_NEW_NAME_DESC())
  .addText((text) => {
    text.setPlaceholder(OPT_NEW_NAME());
    nameInput = text.inputEl;
  });

let location = '';
const locationSetting = new Setting(createItems);
locationSetting.settingEl.setAttr('tabindex', '-1');
locationSetting.setName(OPT_NEW_LOCATION()).setDesc(OPT_NEW_LOCATION_DESC())
  .addButton(button => button.setButtonText(BUTTON_BROWSE()).onClick(() => {
    const res = Desktop.openDialog({
      title: OPT_NEW_LOCATION(),
      defaultPath: Desktop.documentsDir(),
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    const dest = res && !res.canceled && res.filePaths && res.filePaths[0];
    if (!dest) return;
    location = dest;
    locationSetting.descEl.empty();
    locationSetting.descEl.appendText(LABEL_LOCATION_PREVIEW());
    locationSetting.descEl.createSpan({ cls: 'u-pop', text: location });
  }));

const createButtonContainer = createScreen.createDiv('button-container');
const createButton = createButtonContainer.createEl('button', { cls: 'mod-cta', text: BUTTON_CREATE() });
createButton.addEventListener('click', createVault);

function createVault() {
  const name = (nameInput && nameInput.value || '').trim();
  if (!name) { new Notice(MSG_EMPTY_NAME()); return; }
  if (IS_WIN && name.endsWith('.')) { new Notice(MSG_TRAILING_DOT()); return; }
  if (!location) { new Notice(MSG_INVALID_FOLDER()); return; }
  const target = nodePath.join(location, name);
  try {
    const res = Desktop.vaultOpen(target, true);
    if (res === true) { closeStarter(); return; }
    new Notice(`${MSG_CREATE_FAILED()} ${typeof res === 'string' ? res : ''}.`.trim());
  } catch (error) {
    console.error(error);
    new Notice(MSG_CREATE_FAILED_AT());
  }
}

function showScreen(target: string) {
  const create = target === 'create';
  openScreen.style.transform = create ? 'translateX(-100%)' : 'translateX(0%)';
  createScreen.style.transform = create ? 'translateX(0%)' : 'translateX(100%)';
  if (create) setTimeout(() => nameInput && nameInput.focus(), 0);
  else backEl.blur();
}

createScreen.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  showScreen('open');
});

// ---------------------------------------------------------------------------
// 拖拽文件夹入窗（原版 starter 不处理 drop；保留以兼容既有交互）
// ---------------------------------------------------------------------------
function pathForFile(file: File) {
  try {
    const { webUtils } = require('electron');
    if (webUtils && webUtils.getPathForFile) return webUtils.getPathForFile(file);
  } catch (error) { /* 旧版 Electron 回退 file.path */ }
  return file.path || null;
}

body.addEventListener('dragover', (event) => {
  event.preventDefault();
  body.addClass('is-drop-target');
});
body.addEventListener('dragleave', () => body.removeClass('is-drop-target'));
body.addEventListener('drop', (event) => {
  event.preventDefault();
  body.removeClass('is-drop-target');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  const path = pathForFile(file);
  if (path) openVault(path);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
renderVaults();

// 验收钩子：仅 E2E 下暴露渲染函数，便于验证空态分支。
if (process.env.E2E === '1') {
  window.__starterTest = {
    renderVaults,
    showScreen,
    getLocation: () => location,
    setLocation: (value: string) => { location = value; },
  };
}
