/**
 * [INPUT]: Vault、Settings、MetadataCache、Workspace、命令、插件与桌面 IPC。
 * 关闭前等待视图保存，失败保留输入；设置窗口不写主布局。
 * [OUTPUT]: 导出 App，装配启动、外观、事件与布局保存。
 * 插件宿主在构造期可查询空注册表；initialize 才激活插件。
 * 文档独立窗口只加载来源视图，跳过主布局读写与启动打开行为。
 * [POS]: 应用组合根。新建和修改进入元数据解析，启动修复固定侧栏入口。isSettingsWindow（1.14.4 设置独立窗口）只跳过看门狗/后台索引/布局加载，其余状态照常装配。
 *        新库默认只展开左栏（右栏反链/大纲收起）；body 补 obsidian-app 与 show-inline-title，不再挂 body.is-folding。
 *        _applyCustomCss 注入库根 obsidian.css 并监听热更新；原生半透明经 Desktop 下发。当前主题：现代主题 themes/<name>/theme.css，旧版主题（themes/ 下的裸 .css）读 themes/<name>.css（对齐原版 customCss.getThemePath）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * App — wires together vault, workspace, metadata cache, commands, plugins.
 * The public shape follows Obsidian's documented API surface.
 */
import { Events } from './events.js';
import { Vault, FileSystemAdapter, TFile, TFolder, normalizePath } from './vault.js';
import type { VaultEvents } from './vault.js';
import { MetadataCache } from './metadata.js';
import { FileManager } from './fileManager.js';
import { Workspace, WorkspaceTabs } from './workspace.js';
import { ViewRegistry } from './view.js';
import { CommandManager } from './commands.js';
import { Keymap, HotkeyManager } from './keymap.js';
import { Settings } from './settings.js';
import { Desktop, ipcOn, ipcSync, ipcSend } from './ipc.js';
import { applyVaultCss, watchVaultCss } from './custom-css.js';
import { checkForUpdates } from './update-check.js';
import { detectLanguage, setLanguage, t, getNouns } from './i18n.js';
import { Notice } from './notices.js';
import { flushWindowViews } from './window-save.js';
import { PluginManager } from './plugins.js';

const nodePath: typeof import('node:path') = require('path');
function ready<T>(value: T | null, service: string): T {
  if (value === null) throw new Error(`应用服务尚未初始化：${service}`);
  return value;
}
export interface AppAction { action?: string; file?: string; command?: string; tab?: string; }

type AppEvents = Pick<VaultEvents, 'create' | 'modify' | 'delete' | 'rename'> & { 'create-remote?': VaultEvents['create'] };

export class App extends Events<AppEvents> {
  declare _recentCommands: string[];
  declare getVersion: () => string;
  declare _tableCellMenuHook: unknown;
  declare metadataTypeManager: import('../markdown/properties-types.js').PropertyTypes;
  declare fixWebmDuration: typeof import('fix-webm-duration').default;
  declare _basesRichDepth: number;
  declare requestUrl: typeof Desktop.requestUrl;
  declare _contextParamWaiters: Array<(params: unknown) => void>;
  declare setting: import('../views/settings-view.js').SettingsHost;

  private _vault: Vault | null = null;
  get vault(): Vault { return ready(this._vault, 'vault'); }
  set vault(value: Vault) { this._vault = value; }
  private _workspace: Workspace | null = null;
  get workspace(): Workspace { return ready(this._workspace, 'workspace'); }
  set workspace(value: Workspace) { this._workspace = value; }
  private _metadataCache: MetadataCache | null = null;
  get metadataCache(): MetadataCache { return ready(this._metadataCache, 'metadataCache'); }
  set metadataCache(value: MetadataCache) { this._metadataCache = value; }
  private _fileManager: FileManager | null = null;
  get fileManager(): FileManager { return ready(this._fileManager, 'fileManager'); }
  set fileManager(value: FileManager) { this._fileManager = value; }
  declare viewRegistry: ViewRegistry;
  declare commands: CommandManager;
  declare keymap: Keymap;
  private _hotkeyManager: HotkeyManager | null = null;
  get hotkeyManager(): HotkeyManager { return ready(this._hotkeyManager, 'hotkeyManager'); }
  set hotkeyManager(value: HotkeyManager) { this._hotkeyManager = value; }
  private _settings: Settings | null = null;
  get settings(): Settings { return ready(this._settings, 'settings'); }
  set settings(value: Settings) { this._settings = value; }
  plugins: PluginManager;
  vaultId: string | undefined;
  vaultPath = '';
  declare isSettingsWindow: boolean;
  declare bootTime: number | undefined;
  declare isDocumentWindow: boolean | undefined;
  documentState: import('../../contracts.js').ViewState | undefined;
  documentLayout: unknown;
  nouns: ReturnType<typeof getNouns> = getNouns();
  _lastContextMenuParams: Electron.ContextMenuParams | null = null;
  declare _stopVaultCssWatch: (() => void) | undefined;
  _stopPreferenceWatch: (() => void) | undefined;
  _lastTranslucency: boolean | undefined;

  constructor() {
    super();
    this.viewRegistry = new ViewRegistry();
    this.commands = new CommandManager(this);
    this.keymap = new Keymap(this);
    // 设置宿主先于 initialize 注册页签，只读取空注册表，不激活插件。
    this.plugins = new PluginManager(this);
    // 设置独立窗口（1.14.4 popout）：入口 main.js 依 location.hash 设置；为真时跳过看门狗/后台索引/布局加载
    this.isSettingsWindow = false;
  }

  async initialize(): Promise<boolean> {
    this.bootTime = performance.now();
    // language
    setLanguage(detectLanguage());

    // 原版：非 macOS 平台给 body 加 styled-scrollbars（macOS 用系统 overlay 滚动条）
    const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
    document.body.addClass('obsidian-app');
    if (!isMac) document.body.addClass('styled-scrollbars');

    // vault identity from main process
    const info = Desktop.vault();
    if (!info || !info.path) {
      document.body.setText('No vault selected.');
      Desktop.openStarter();
      return false;
    }
    this.vaultId = info.id;
    this.vaultPath = info.path;
    this.isDocumentWindow = info.documentWindow === true;
    this.documentState = info.documentState;
    this.documentLayout = info.documentLayout;
    globalThis.__fileToken = Desktop.fileUrl().replace(/^app:\/\//, '').replace(/\/$/, '');

    // settings first (needed by views)
    this.settings = new Settings(this);
    this.settings.setDir(this.vaultPath);
    this.settings.load();

    // vault
    this.vault = new Vault(new FileSystemAdapter(this.vaultPath));
    globalThis.__electronTrash = async (p: string) => Desktop.trash(p);
    await this.vault.initialize();
    if (!this.isSettingsWindow) await this.vault.watch();

    this.metadataCache = new MetadataCache(this);
    this.fileManager = new FileManager(this);
    this.hotkeyManager = new HotkeyManager(this);
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
    ipcOn('window-save-failed', (_event, message) => new Notice(message || '文档尚未保存，窗口保持打开'));

    // OBS_ACT handling (obsidian:// actions)
    if (window.OBS_ACT && typeof window.OBS_ACT !== 'function') {
      this._handleObsAct(window.OBS_ACT);
      window.OBS_ACT = null;
    }
    window.OBS_ACT = (act: AppAction) => this._handleObsAct(act);

    // background metadata scan
    if (!this.isSettingsWindow) this.metadataCache.initialize().catch((e) => console.error(e));

    // plugins
    await this.plugins.initialize();

    // load workspace layout（设置窗口不加载布局/视图，工作区 DOM 仅作 API 占位）
    if (this.isSettingsWindow) this.workspace._sidebarReady = true;
    else if (this.isDocumentWindow) {
      this.workspace._sidebarReady = true;
      document.body.addClass('is-document-window');
      let leaf;
      if (this.documentLayout) {
        const active = await this.workspace.loadLayout(this.documentLayout);
        await this.workspace.postLayoutLoad(typeof active === 'string' ? active : null);
        leaf = this.workspace.activeLeaf;
      } else {
        leaf = this.workspace.getLeaf(true);
        await leaf.setViewState(this.documentState || { type: 'empty' });
      }
      if (!leaf || leaf.view?.getViewType() !== this.documentState?.type) throw new Error('文档窗口无法加载此视图');
      this.workspace.setActiveLeaf(leaf, { focus: true });
      this.workspace.updateTitle();
      this.workspace.on('file-open', () => this.workspace.updateTitle());
      const update = () => this.saveLayout();
      this.workspace.on('file-open', update); this.workspace.on('layout-change', update);
    }
    else await this._loadWorkspace();

    // theme
    this._stopVaultCssWatch = watchVaultCss(this);
    this._applyTheme();
    this.settings.on('change', () => this._applyTheme());
    this._stopPreferenceWatch = this.settings.watchDesktopPreferences();

    // 触摸板捏合 / Ctrl+滚轮：仅"快速调整字体大小"开启时改字号（外观页开关，默认关）。
    // 任何情况下都吞掉默认行为：整页视觉缩放必须锁死（主进程 setVisualZoomLevelLimits(1,1) 兜底）。
    window.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      if (this.settings.config.baseFontSizeAction !== true) return;
      const delta = ev.deltaY < 0 ? 1 : -1;
      const current = this.settings.config.baseFontSize || 16;
      const next = Math.min(30, Math.max(10, current + delta));
      if (next !== current) this.settings.updateAppearance({ baseFontSize: next });
    }, { passive: false });

    // 后台检查更新：仅在配置了 updateFeed 且未显式关闭时联网；失败静默（打包分发用）
    if (this.settings.appSettings.updateFeed && this.settings.appSettings.checkUpdates !== false) {
      setTimeout(() => {
        try { checkForUpdates(this, { silent: true }).catch(() => {}); } catch (e) { /* ignore */ }
      }, 5000);
    }

    // 启动打开行为（openBehavior：上次文件/新笔记/日记/指定文件）
    await this._runOpeningBehavior();
    if (this.isDocumentWindow) Desktop.documentWindowReady();

    // notifications for vault ready
    this.vault.on('create', (file) => this.trigger('create-remote?', file));
    return true;
  }

  _onKeyDown(ev: KeyboardEvent) {
    // let the keymap handle hotkeys; editor already handles its own keys first
    if (ev.defaultPrevented) return;
    if (this._hotkeyManager) this._hotkeyManager.handleKeydown(ev);
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
      document.body.style.setProperty('--accent-h', String(hsl.h));
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
    document.body.toggleClass('show-inline-title', this.settings.appSettings.showInlineTitle !== false);
    const translucent = process.platform === 'darwin' && appearance.translucency === true;
    document.body.toggleClass('is-translucent', translucent);
    if (this._lastTranslucency !== translucent) {
      this._lastTranslucency = translucent;
      Desktop.setTranslucency(translucent);
    }
    // 自定义主题与 CSS 代码片段
    this._applyCustomCss();
  }

  /**
   * 注入当前主题 CSS 与 .obsidian/snippets 中启用的片段。
   * 主题/片段开关变化时由 settings 'change' 事件触发。
   * 主题路径对齐原版 customCss.getThemePath：现代主题 themes/<name>/theme.css；
   * 旧版主题（themes/ 下的裸 .css）读 themes/<name>.css。
   */
  _applyCustomCss() {
    const fs: typeof import('node:fs') = require('fs');
    const appearance = this.settings.appearance;
    // theme.css
    let themeEl = document.getElementById('obsidian-theme-css');
    const cssTheme = appearance.cssTheme || '';
    if (cssTheme) {
      const themesDir = nodePath.join(this.settings.dir, 'themes');
      const modernPath = nodePath.join(themesDir, cssTheme, 'theme.css');
      const legacyPath = nodePath.join(themesDir, cssTheme + '.css');
      let file = '';
      try {
        if (fs.existsSync(modernPath)) file = modernPath;
        else if (fs.existsSync(legacyPath)) file = legacyPath;
      } catch (e) { file = ''; }
      if (file) {
        try {
          const css = fs.readFileSync(file, 'utf8');
          if (!themeEl) {
            themeEl = document.createElement('style');
            themeEl.id = 'obsidian-theme-css';
            themeEl.setAttribute('data-css-theme', cssTheme);
            document.head.appendChild(themeEl);
          }
          themeEl.textContent = css;
        } catch (e) {
          if (themeEl) { themeEl.remove(); themeEl = null; }
        }
      } else if (themeEl) {
        themeEl.remove();
      }
    } else if (themeEl) {
      themeEl.remove();
    }
    applyVaultCss(this);
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
    if (this.isSettingsWindow || this.isDocumentWindow) return;
    const behavior = this.settings.appSettings.openBehavior || '';
    if (window.OBS_ACT && typeof window.OBS_ACT !== 'function' && window.OBS_ACT.action) return;
    try {
      if (behavior === 'new') {
        const file = await this.fileManager.createNewMarkdownFile(this.fileManager.getNewFileParent(''), 'Untitled');
        await this.workspace.openFile(file);
      } else if (behavior === 'daily') {
        const daily = this.plugins.getInternalPlugin('daily-notes');
        const instance = daily && daily.enabled && daily.instance;
        if (instance && typeof instance.getDailyNote === 'function') {
          const file = await instance.getDailyNote(undefined);
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
    const fs: typeof import('node:fs') = require('fs');
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
    ws.rightSplit.collapsed = true;   // 原版新库默认只开左栏，右栏（反链/大纲/标签）收起
    ws.render();
    this.workspace.showSidebar('left');
    ws.setActiveLeaf(centerLeaf, { focus: false });
    // activate explorer leaf as sidebar active
    ws.setActiveLeaf(explorerLeaf, { focus: false });
    ws.setActiveLeaf(centerLeaf, { focus: false });
  }

  _handleObsAct(act: AppAction | null | undefined) {
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
    if (this.isSettingsWindow) return;
    if (this.isDocumentWindow) {
      const view = this.workspace.activeLeaf?.view;
      if (view) ipcSend('document-window-state', { type: view.getViewType(), state: view.getState(), layout: this.workspace.getLayout() });
      return;
    }
    const fs: typeof import('node:fs') = require('fs');
    const workspacePath = nodePath.join(this.vaultPath, '.obsidian', 'workspace.json');
    try {
      fs.mkdirSync(nodePath.dirname(workspacePath), { recursive: true });
      const layout = this.workspace.getLayout();
      fs.writeFileSync(workspacePath, JSON.stringify(layout));
    } catch (e) {
      console.error('Failed to save layout', e);
    }
  }
  async flushForClose() {
    if (!this._workspace || this.isSettingsWindow) return { ok: true };
    const result = await flushWindowViews(this);
    if (result.ok) await this.saveLayout();
    return result;
  }
}

export function hexToHsl(hex: string) {
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
