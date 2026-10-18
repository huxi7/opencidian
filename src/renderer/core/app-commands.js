/**
 * [INPUT]: 命令注册、Workspace、WorkspaceTabs、设置宿主与桌面 IPC。
 * [OUTPUT]: 注册导航、设置、窗口及文档标签命令（含 workspace:toggle-stacked-tabs）。
 * [POS]: 用户命令层。关闭与固定标签命令只作用于中心文档；堆叠命令作用于当前中心标签组。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * App-level commands: navigation history, tab/leaf lifecycle, settings,
 * window controls. Registered once from the renderer entry point.
 */
import { t } from './i18n.js';
import { ipcSend } from './ipc.js';
import { Notice } from './notices.js';
import { Modal } from './modals.js';
import { checkForUpdates } from './update-check.js';
import { WorkspaceTabs } from './workspace-model.js';

export function registerAppCommands(app) {
  const add = (spec) => app.commands.addCommand(spec);
  const ws = () => app.workspace;

  // ------------------------------------------------------------------
  // Navigation history (global, like the original's window history)
  // ------------------------------------------------------------------
  const history = { stack: [], index: -1, navigating: false };

  function pushHistory(path) {
    if (history.navigating) return;
    if (history.stack[history.index] === path) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(path);
    if (history.stack.length > 50) history.stack.shift();
    history.index = history.stack.length - 1;
  }

  app.workspace.on('file-open', (file) => { if (file) pushHistory(file.path); });

  async function navigate(delta) {
    const next = history.index + delta;
    if (next < 0 || next >= history.stack.length) return;
    history.index = next;
    const file = app.vault.getAbstractFileByPath(history.stack[next]);
    if (!file) return;
    history.navigating = true;
    try { await app.workspace.openFile(file); }
    finally { history.navigating = false; }
  }

  add({
    id: 'app:go-back',
    name: t('navigate.back') || 'Navigate back',
    icon: 'arrow-left',
    checkCallback: (checking) => {
      if (history.index <= 0) return false;
      if (!checking) navigate(-1);
      return true;
    },
  });
  add({
    id: 'app:go-forward',
    name: t('navigate.forward') || 'Navigate forward',
    icon: 'arrow-right',
    checkCallback: (checking) => {
      if (history.index >= history.stack.length - 1) return false;
      if (!checking) navigate(1);
      return true;
    },
  });

  // ------------------------------------------------------------------
  // Settings, help, reload
  // ------------------------------------------------------------------
  add({
    id: 'app:open-settings',
    name: t('interface.menu.settings') || 'Settings',
    icon: 'settings',
    callback: () => app.setting && app.setting.open(),
  });
  add({
    id: 'app:open-help',
    name: t('interface.menu.help') || 'Help',
    icon: 'help-circle',
    callback: () => ipcSend('help'),
  });
  add({
    id: 'app:reload',
    name: t('interface.menu.reload') || 'Reload app without saving',
    icon: 'rotate-cw',
    callback: () => { window.location.reload(); },
  });
  add({
    id: 'app:show-debug-info',
    name: 'Show debug info',
    callback: () => {
      const modal = new Modal(app);
      modal.setTitle('Debug info');
      modal.contentEl.createEl('pre', { text: JSON.stringify({
        vault: app.vaultPath,
        layout: app.workspace.getLayout ? 'available' : 'n/a',
        leaves: app.workspace._leafMap ? app.workspace._leafMap.size : 0,
      }, null, 2) });
      modal.open();
    },
  });

  // ------------------------------------------------------------------
  // Tabs / leaves
  // ------------------------------------------------------------------
  const closedStack = [];

  add({
    id: 'workspace:close',
    name: t('menu-items.close-tab') || 'Close current tab',
    icon: 'x',
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      if (!app.workspace.canCloseLeaf(leaf)) return false;
      if (!checking) {
        const state = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
        const type = leaf.view && leaf.view.getViewType ? leaf.view.getViewType() : null;
        closedStack.push({ type, state: state || {}, side: app.workspace._sideOf(leaf) });
        if (closedStack.length > 20) closedStack.shift();
        leaf.detach && leaf.detach();
        const next = app.workspace.activeLeaf || app.workspace._firstLeafInCenter();
        if (!next) {
          app.workspace.getLeaf('tab').setViewState({ type: 'empty' });
        } else {
          app.workspace.setActiveLeaf(next, { focus: true });
        }
      }
      return true;
    },
  });

  add({
    id: 'workspace:undo-close-pane',
    name: t('commands.undo-close-tab') || 'Undo close tab',
    icon: 'undo-2',
    checkCallback: (checking) => {
      if (!closedStack.length) return false;
      if (!checking) {
        const entry = closedStack.pop();
        const side = entry.side || 'center';
        let leaf;
        if (side === 'left' || side === 'right') {
          leaf = app.workspace.ensureSideLeaf(entry.type, side, { reveal: true });
          if (entry.state && leaf.view && leaf.view.setState) leaf.view.setState(entry.state);
        } else {
          leaf = app.workspace.getLeaf('tab');
          leaf.setViewState({ type: entry.type, state: entry.state });
        }
      }
      return true;
    },
  });

  add({
    id: 'workspace:new-tab',
    name: t('menu-items.new-tab') || 'New tab',
    icon: 'plus',
    callback: () => {
      const leaf = app.workspace.getLeaf('tab');
      leaf.setViewState({ type: 'empty' });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
  });

  add({
    id: 'workspace:close-window',
    name: t('menu-items.close-window') || 'Close window',
    callback: async () => {
      try { await app.saveLayout(); } catch (e) {}
      ipcSend('window-close');
    },
  });

  add({
    id: 'workspace:goto-last-tab',
    name: t('commands.go-to-last-tab') || 'Go to last tab',
    checkCallback: (checking) => {
      const prev = app.workspace._lastActiveLeaves && app.workspace._lastActiveLeaves[0];
      if (!prev) return false;
      if (!checking) app.workspace.setActiveLeaf(prev, { focus: true });
      return true;
    },
  });

  add({
    id: 'workspace:edit-file-title',
    name: t('commands.rename-file') || 'Rename file',
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType('markdown');
      if (!view || !view.focusInlineTitle) return false;
      if (!checking) view.focusInlineTitle();
      return true;
    },
  });

  add({
    id: 'workspace:split-vertical',
    name: t('menu-items.split-right') || 'Split right',
    icon: 'separator-vertical',
    callback: async () => {
      const leaf = app.workspace.activeLeaf || app.workspace._firstLeafInCenter();
      if (!leaf) return;
      const newLeaf = app.workspace.createLeafBySplit(leaf, 'vertical');
      const st = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
      await newLeaf.setViewState(st && st.file ? { type: leaf.view.getViewType(), state: { file: st.file, mode: st.mode } } : { type: 'empty' });
      app.workspace.setActiveLeaf(newLeaf, { focus: true });
    },
  });
  add({
    id: 'workspace:split-horizontal',
    name: t('menu-items.split-down') || 'Split down',
    icon: 'separator-horizontal',
    callback: async () => {
      const leaf = app.workspace.activeLeaf || app.workspace._firstLeafInCenter();
      if (!leaf) return;
      const newLeaf = app.workspace.createLeafBySplit(leaf, 'horizontal');
      const st = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
      await newLeaf.setViewState(st && st.file ? { type: leaf.view.getViewType(), state: { file: st.file, mode: st.mode } } : { type: 'empty' });
      app.workspace.setActiveLeaf(newLeaf, { focus: true });
    },
  });

  add({
    id: 'workspace:toggle-stacked-tabs',
    name: t('commands.toggle-stacked-tabs') || 'Toggle stacked tabs',
    icon: 'lucide-layers',
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      const tabs = leaf && leaf.parent;
      if (!(tabs instanceof WorkspaceTabs)) return false;
      // 原版：根分割为左/右栏时命令不可用（侧栏标签不堆叠）
      if (app.workspace._sideOf(tabs) !== 'center') return false;
      if (!checking) tabs.setStacked(!tabs.isStacked);
      return true;
    },
  });

  add({
    id: 'workspace:toggle-pin',
    name: t('interface.menu.pin') || 'Pin',
    icon: 'pin',
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      if (!app.workspace.canCloseLeaf(leaf)) return false;
      if (!checking) {
        leaf.pinned = !leaf.pinned;
        app.workspace._syncAllTabs();
      }
      return true;
    },
  });

  add({
    id: 'workspace:move-to-new-window',
    name: t('interface.menu.move-to-new-window') || 'Move to new window',
    callback: () => new Notice('Opening new windows is not supported in this replica.', 3000),
  });

  // 检查更新（只提示 + 打开下载页；配置 updateFeed 后才联网）
  add({
    id: 'app:check-updates',
    name: t('setting.appearance.button-check-for-updates') || 'Check for updates',
    icon: 'refresh-cw',
    callback: () => { checkForUpdates(app, { silent: false }); },
  });

  // Theme toggle (handy, matches community expectation)
  add({
    id: 'theme:toggle-dark-mode',
    name: 'Toggle dark mode',
    icon: 'moon',
    callback: () => {
      const appearance = app.settings.appearance;
      const isDark = document.body.hasClass('theme-dark');
      appearance.theme = isDark ? 'moonstone' : 'obsidian';
      app.settings.updateAppearance({ theme: appearance.theme });
      app._applyTheme();
    },
  });
}
