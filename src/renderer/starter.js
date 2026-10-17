/* Vault switcher ("starter") window logic. */
import './core/dom.js';
import { setLanguage, detectLanguage, t } from './core/i18n.js';
import { setIcon } from './core/icons.js';
import { Desktop, ipcSend } from './core/ipc.js';

setLanguage(detectLanguage());

function closeStarter() {
  ipcSend('window-close');
}

function openVault(path, create = false) {
  const res = Desktop.vaultOpen(path, create);
  if (res === true) closeStarter();
  else alert(typeof res === 'string' ? res : 'Failed to open vault.');
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const body = document.body;

const header = body.createDiv('starter-header');
const titleEl = header.createDiv('starter-title');
titleEl.createDiv('starter-app-name').setText('Obsidian');
titleEl.createDiv('starter-app-subtitle').setText(t('interface.start-screen.label-create-local-vault') || 'Create local vault');

// draggable region for the frameless window
header.style.webkitAppRegion = 'drag';

const main = body.createDiv('starter-screen').createDiv('starter-screen-inner');
const vaultListEl = main.createDiv('starter-vault-list');
const actionsEl = main.createDiv('starter-actions');

const footer = body.createDiv('starter-footer');
const versionLabel = footer.createDiv('starter-version');
versionLabel.setText(`${t('interface.start-screen.label-version') || 'Version'} ${Desktop.version()}`);

// ---------------------------------------------------------------------------
// Vault list
// ---------------------------------------------------------------------------
async function renderVaults() {
  const list = Desktop.vaultList() || {};
  vaultListEl.empty();
  const entries = Object.entries(list)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if (!entries.length) {
    const empty = vaultListEl.createDiv('starter-empty');
    setIcon(empty.createDiv('starter-empty-icon'), 'vault');
    empty.createDiv('starter-empty-text').setText(t('interface.start-screen.option-open-folder-as-vault-description') || 'Choose an existing folder of Markdown files.');
    return;
  }

  for (const entry of entries) {
    const item = vaultListEl.createDiv('starter-vault-item');
    const iconEl = item.createDiv('vault-list-item-icon');
    setIcon(iconEl, 'vault');
    const info = item.createDiv('starter-vault-info');
    const name = entry.path.split(/[\\/]/).filter(Boolean).pop() || entry.path;
    info.createDiv('vault-list-item-title').setText(name);
    info.createDiv('vault-list-item-desc').setText(entry.path);

    const actions = item.createDiv('starter-vault-buttons');
    const openBtn = actions.createDiv('starter-vault-button clickable-icon');
    setIcon(openBtn, 'folder-open');
    openBtn.setAttr('aria-label', t('interface.start-screen.button-open') || 'Open');
    openBtn.onclick = (ev) => { ev.stopPropagation(); openVault(entry.path); };

    const revealBtn = actions.createDiv('starter-vault-button clickable-icon');
    setIcon(revealBtn, 'external-link');
    revealBtn.setAttr('aria-label', t('interface.start-screen.option-reveal-vault-in-explorer') || 'Reveal vault in system explorer');
    revealBtn.onclick = (ev) => { ev.stopPropagation(); Desktop.showItemInFolder(entry.path); };

    const removeBtn = actions.createDiv('starter-vault-button clickable-icon');
    setIcon(removeBtn, 'x');
    removeBtn.setAttr('aria-label', t('interface.start-screen.option-remove') || 'Remove from list');
    removeBtn.onclick = (ev) => {
      ev.stopPropagation();
      const ok = Desktop.vaultRemove(entry.path);
      if (ok === false) alert(t('interface.start-screen.msg-error-remove-current-open-vault') || "Can't remove a currently open vault.");
      renderVaults();
    };

    item.onclick = () => openVault(entry.path);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function actionButton(icon, label, cb) {
  const btn = actionsEl.createDiv('starter-action');
  const iconEl = btn.createDiv('starter-action-icon');
  setIcon(iconEl, icon);
  btn.createDiv('starter-action-label').setText(label);
  btn.onclick = cb;
  return btn;
}

actionButton('folder-open', t('interface.start-screen.option-open-folder-as-vault') || 'Open folder as vault', () => {
  const res = Desktop.openDialog({
    title: t('interface.start-screen.option-open-folder-as-vault') || 'Open folder as vault',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res && !res.canceled && res.filePaths && res.filePaths[0]) openVault(res.filePaths[0]);
});

actionButton('plus', t('interface.start-screen.option-create-vault') || 'Create new vault', () => {
  const res = Desktop.openDialog({
    title: t('interface.start-screen.option-new-vault-location') || 'Location',
    defaultPath: Desktop.documentsDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res || res.canceled || !res.filePaths || !res.filePaths[0]) return;
  const parent = res.filePaths[0];
  const name = prompt(t('interface.start-screen.option-new-vault-name') || 'Vault name', 'My Vault');
  if (name === null) return;
  const trimmed = (name || '').trim();
  if (!trimmed) { alert(t('interface.start-screen.msg-empty-vault-name') || 'Vault name cannot be empty.'); return; }
  if (trimmed.endsWith('.')) { alert(t('interface.start-screen.msg-trailing-dot-vault-name') || 'Vault name cannot end with a dot.'); return; }
  const sep = parent.includes('\\') ? '\\' : '/';
  openVault(parent + sep + trimmed, true);
});

actionButton('help-circle', t('interface.start-screen.option-get-help') || 'Get Help', () => {
  ipcSend('help');
});

// ---------------------------------------------------------------------------
// Drag & drop folders onto the window
// ---------------------------------------------------------------------------
function pathForFile(file) {
  try {
    const { webUtils } = require('electron');
    if (webUtils && webUtils.getPathForFile) return webUtils.getPathForFile(file);
  } catch (e) {}
  return file.path || null;
}

body.addEventListener('dragover', (ev) => { ev.preventDefault(); body.addClass('is-drop-target'); });
body.addEventListener('dragleave', () => body.removeClass('is-drop-target'));
body.addEventListener('drop', (ev) => {
  ev.preventDefault();
  body.removeClass('is-drop-target');
  const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (!file) return;
  const p = pathForFile(file);
  if (p) openVault(p);
});

renderVaults();
