/**
 * [INPUT]: Vault、Settings、MetadataCache、Workspace、命令、插件与桌面 IPC。
 * [OUTPUT]: 导出 App，装配启动、外观、事件与布局保存。
 * [POS]: 应用组合根。新建和修改进入元数据解析，启动修复固定侧栏入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * App — wires together vault, workspace, metadata cache, commands, plugins.
 * The public shape follows Obsidian's documented plugin API so community
 * plugins have a chance of running.
 */
import { Events } from './events.js';
import { Vault, FileSystemAdapter, TFile, TFolder, normalizePath } from './vault.js';
import { MetadataCache } from './metadata.js';
import { FileManager } from './fileManager.js';
import { Workspace, WorkspaceTabs } from './workspace.js';
import { ViewRegistry } from './view.js';
import { CommandManager } from './commands.js';
import { Keymap, HotkeyManager } from './keymap.js';
import { Settings } from './settings.js';
import { Desktop, ipcOn, ipcSync } from './ipc.js';
import { detectLanguage, setLanguage, t, getNouns } from './i18n.js';
import { Notice } from './notices.js';
import { PluginManager } from './plugins.js';

const nodePath = require('path');

export class App extends Events {
  constructor() {
    super();
    this.vault = null;
    this.workspace = null;
    this.metadataCache = null;
    this.fileManager = null;
    this.viewRegistry = new ViewRegistry();
    this.commands = new CommandManager(this);
    this.keymap = new Keymap(this);
    this.hotkeyManager = null;
    this.settings = null;
    this.plugins = null;
    this.vaultId = null;
    this.vaultPath = null;
  }

  async initialize() {
    this.bootTime = performance.now();
    // language
    setLanguage(detectLanguage());

    // 原版：非 macOS 平台给 body 加 styled-scrollbars（macOS 用系统 overlay 滚动条）
    const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
    if (!isMac) document.body.addClass('styled-scrollbars');

    // vault identity from main process
    const info = Desktop.vault();
    if (!info || !info.path) {
      document.body.setText('No vault selected.');
      Desktop.openStarter();
      return;
    }
    this.vaultId = info.id;
    this.vaultPath = info.path;
    globalThis.__fileToken = Desktop.fileUrl().replace(/^app:\/\//, '').replace(/\/$/, '');

    // settings first (needed by views)
    this.settings = new Settings(this);
    this.settings.setDir(this.vaultPath);
    this.settings.load();

    // vault
    this.vault = new Vault(new FileSystemAdapter(this.vaultPath));
    globalThis.__electronTrash = async (p) => Desktop.trash(p);
    await this.vault.initialize();
    this.vault.watch();

    this.metadataCache = new MetadataCache(this);
    this.fileManager = new FileManager(this);
    this.hotkeyManager = new HotkeyManager(this);
    this.plugins = new PluginManager(this);
    this.nouns = getNouns();

    // vault events -> metadata
    this.vault.on('modify', (file) => {
      this.metadataCache.onFileModify(file);
      this.trigger('modify', file);
    });
    this.vault.on('delete', (file) => {
      this.metadataCache.onFileDelete(file);
      this.trigger('delete', file);
    });
    this.vault.on('rename', (file, oldPath) => {
      this.metadataCache.onFileRename(file, oldPath);
      this.trigger('rename', file, oldPath);
    });
    this.vault.on('create', (file) => {
      this.metadataCache.onFileModify(file);
      this.trigger('create', file);
    });

    // workspace
    this.workspace = new Workspace(this);
    this.workspace.mount(document.body);

    // keyboard
    document.addEventListener('keydown', (ev) => this._onKeyDown(ev), false);

    // context menu delegation for spellcheck from main
    ipcOn('context-menu', (ev, params) => {
      this._lastContextMenuParams = params;
      const waiters = this._contextParamWaiters;
      if (waiters && waiters.length) waiters.splice(0).forEach((fn) => fn(params));
    });

    // OBS_ACT handling (obsidian:// actions)
    if (window.OBS_ACT) {
      this._handleObsAct(window.OBS_ACT);
      window.OBS_ACT = null;
    }
    window.OBS_ACT = (act) => this._handleObsAct(act);

    // background metadata scan
    this.metadataCache.initialize().catch((e) => console.error(e));

    // plugins
    await this.plugins.initialize();

    // load workspace layout
    await this._loadWorkspace();

    // theme
    this._applyTheme();
    this.settings.on('change', () => this._applyTheme());

    // Ctrl+滚轮快速调整字体大小（baseFontSizeAction）
    window.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      if (this.settings.config.baseFontSizeAction === false) return;
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? 1 : -1;
      const current = this.settings.config.baseFontSize || 16;
      const next = Math.min(30, Math.max(10, current + delta));
      if (next !== current) this.settings.updateAppearance({ baseFontSize: next });
    }, { passive: false });

    // 启动打开行为（openBehavior：上次文件/新笔记/日记/指定文件）
    await this._runOpeningBehavior();

    // notifications for vault ready
    this.vault.on('create', (file) => this.trigger('create-remote?', file));
  }

  _onKeyDown(ev) {
    // let the keymap handle hotkeys; editor already handles its own keys first
    if (ev.defaultPrevented) return;
    if (this.hotkeyManager) this.hotkeyManager.handleKeydown(ev);
  }

  _applyTheme() {
    const appearance = this.settings.appearance;
    const settings = this.settings.appSettings;
    const config = this.settings.config;
    let theme = appearance.theme;
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'obsidian' : 'moonstone';
    }
    const isDark = theme !== 'moonstone';
    document.body.toggleClass('theme-dark', isDark);
    document.body.toggleClass('theme-light', !isDark);
    // accent color：未自定义时移除内联覆盖，让主题默认的 --accent-* 生效（原版 getAccentColor 语义）
    if (appearance.accentColor) {
      const hsl = hexToHsl(appearance.accentColor);
      document.body.style.setProperty('--accent-h', hsl.h);
      document.body.style.setProperty('--accent-s', hsl.s + '%');
      document.body.style.setProperty('--accent-l', hsl.l + '%');
    } else {
      document.body.style.removeProperty('--accent-h');
      document.body.style.removeProperty('--accent-s');
      document.body.style.removeProperty('--accent-l');
    }
    // fonts
    if (appearance.interfaceFontFamily) document.body.style.setProperty('--font-interface-override', appearance.interfaceFontFamily);
    else document.body.style.removeProperty('--font-interface-override');
    if (appearance.textFontFamily) document.body.style.setProperty('--font-text-override', appearance.textFontFamily);
    else document.body.style.removeProperty('--font-text-override');
    if (appearance.monospaceFontFamily) document.body.style.setProperty('--font-monospace-override', appearance.monospaceFontFamily);
    else document.body.style.removeProperty('--font-monospace-override');
    document.body.style.setProperty('--font-text-size', (config.baseFontSize || 16) + 'px');
    document.documentElement.style.fontSize = (config.baseFontSize || 16) + 'px';
    document.body.style.setProperty('--font-interface-theme', appearance.interfaceFontFamily || '');
    document.body.style.setProperty('--indent-size', String(settings.tabSize || 4));
    // feature toggles
    document.body.toggleClass('show-ribbon', config.showRibbon !== false);
    document.body.toggleClass('show-status', config.showStatusBar !== false);
    document.body.toggleClass('show-view-header', config.showViewHeader !== false);
    const ribbon = this.workspace.ribbonEl;
    if (ribbon) ribbon.toggle(config.showRibbon !== false);
    const statusBar = this.workspace.statusBar;
    if (statusBar) statusBar.toggle(config.showStatusBar !== false);
    // 行宽（readableLineLength）由 MarkdownView 挂在视图元素上，见 views/markdown-view.js
    document.body.toggleClass('is-folding', settings.foldHeading !== false);
    // 自定义主题与 CSS 代码片段
    this._applyCustomCss();
  }

  /**
   * 注入 .obsidian/themes/<cssTheme>/theme.css 与 .obsidian/snippets 中启用的片段。
   * 主题/片段开关变化时由 settings 'change' 事件触发。
   */
  _applyCustomCss() {
    const fs = require('fs');
    const appearance = this.settings.appearance;
    // theme.css
    let themeEl = document.getElementById('obsidian-theme-css');
    const cssTheme = appearance.cssTheme || '';
    if (cssTheme) {
      try {
        const css = fs.readFileSync(nodePath.join(this.settings.dir, 'themes', cssTheme, 'theme.css'), 'utf8');
        if (!themeEl) {
          themeEl = document.createElement('style');
          themeEl.id = 'obsidian-theme-css';
          document.head.appendChild(themeEl);
        }
        themeEl.textContent = css;
      } catch (e) {
        if (themeEl) { themeEl.remove(); themeEl = null; }
      }
    } else if (themeEl) {
      themeEl.remove();
    }
    // snippets
    document.querySelectorAll('style[data-css-snippet]').forEach((el) => el.remove());
    for (const name of appearance.enabledCssSnippets || []) {
      try {
        const css = fs.readFileSync(nodePath.join(this.settings.dir, 'snippets', name + '.css'), 'utf8');
        const el = document.createElement('style');
        el.setAttribute('data-css-snippet', name);
        el.textContent = css;
        document.head.appendChild(el);
      } catch (e) {}
    }
  }

  /** 启动打开行为：对齐原版 runOpeningBehavior（openBehavior 存 app.json）。 */
  async _runOpeningBehavior() {
    const behavior = this.settings.appSettings.openBehavior || '';
    if (window.OBS_ACT && window.OBS_ACT.action) return;
    try {
      if (behavior === 'new') {
        await this.fileManager.createAndOpenMarkdownFile('');
      } else if (behavior === 'daily') {
        const daily = this.plugins.getInternalPlugin('daily-notes');
        const instance = daily && daily.enabled && daily.instance;
        if (instance && typeof instance.getDailyNote === 'function') {
          const file = await instance.getDailyNote();
          if (file) await this.workspace.openFile(file);
        }
      } else if (behavior.startsWith('file:')) {
        let path = behavior.slice(5);
        if (!/\.\w+$/.test(path)) path += '.md';
        const file = this.vault.getFileByPath(normalizePath(path));
        if (file) await this.workspace.openFile(file);
      }
    } catch (e) {
      console.error('runOpeningBehavior failed', e);
    }
  }

  async _loadWorkspace() {
    const fs = require('fs');
    const workspacePath = nodePath.join(this.vaultPath, '.obsidian', 'workspace.json');
    let data = null;
    try {
      if (fs.existsSync(workspacePath)) data = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
    } catch (e) { data = null; }
    let loaded = false;
    if (data) {
      const active = await this.workspace.loadLayout(data);
      if (active !== false) {
        await this.workspace.postLayoutLoad(typeof active === 'string' ? active : null);
        loaded = true;
      }
    }
    if (!loaded) {
      await this._defaultLayout();
      await this.workspace.reconcileSidebars();
    }
    this.workspace._sidebarReady = true;
    this.workspace.updateTitle();
    this.workspace.on('active-leaf-change', () => this.workspace.updateTitle());
    this.workspace.on('file-open', () => this.workspace.updateTitle());
  }

  async _defaultLayout() {
    const ws = this.workspace;
    // left sidebar: file explorer + search
    const leftTabs = new WorkspaceTabs(ws);
    ws.leftSplit.children.push(leftTabs);
    leftTabs.parent = ws.leftSplit;
    const explorerLeaf = ws.createLeafInTabGroup(leftTabs);
    await explorerLeaf.setViewState({ type: 'file-explorer' });
    const searchLeaf = ws.createLeafInTabGroup(leftTabs);
    await searchLeaf.setViewState({ type: 'search' });
    leftTabs.currentTab = 0;

    // right sidebar: backlinks + outline + tags
    const rightTabs = new WorkspaceTabs(ws);
    ws.rightSplit.children.push(rightTabs);
    rightTabs.parent = ws.rightSplit;
    const backleaf = ws.createLeafInTabGroup(rightTabs);
    await backleaf.setViewState({ type: 'backlink' });
    const outlineLeaf = ws.createLeafInTabGroup(rightTabs);
    await outlineLeaf.setViewState({ type: 'outline' });
    const tagLeaf = ws.createLeafInTabGroup(rightTabs);
    await tagLeaf.setViewState({ type: 'tag' });
    rightTabs.currentTab = 0;

    // center: empty view
    const centerTabs = new WorkspaceTabs(ws);
    ws.centerSplit.insertChild(0, centerTabs);
    const centerLeaf = ws.createLeafInTabGroup(centerTabs);
    await centerLeaf.setViewState({ type: 'empty' });
    ws.render();
    this.workspace.showSidebar('left');
    this.workspace.showSidebar('right');
    ws.setActiveLeaf(centerLeaf, { focus: false });
    // activate explorer leaf as sidebar active
    ws.setActiveLeaf(explorerLeaf, { focus: false });
    ws.setActiveLeaf(centerLeaf, { focus: false });
  }

  _handleObsAct(act) {
    if (!act) return;
    if (act.action === 'open') {
      if (act.file) {
        const file = this.vault.getFileByPath(normalizePath(this.vaultPath + '/' + act.file));
        const f2 = this.vault.getFileByPath(normalizePath(act.file));
        if (f2) this.workspace.openFile(f2);
      }
      return;
    }
    // 调试用：执行命令 / 打开设置页签（OBS_ACT 环境变量门控，见 main.js）
    if (act.action === 'exec' && act.command) {
      this.commands.executeCommandById(act.command);
      return;
    }
    if (act.action === 'open-settings') {
      if (this.setting) {
        this.setting.open();
        if (act.tab) setTimeout(() => this.setting.openTabById(act.tab), 50);
      }
      return;
    }
  }

  async saveLayout() {
    const fs = require('fs');
    const workspacePath = nodePath.join(this.vaultPath, '.obsidian', 'workspace.json');
    try {
      fs.mkdirSync(nodePath.dirname(workspacePath), { recursive: true });
      const layout = this.workspace.getLayout();
      fs.writeFileSync(workspacePath, JSON.stringify(layout));
    } catch (e) {
      console.error('Failed to save layout', e);
    }
  }
}

export function hexToHsl(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
