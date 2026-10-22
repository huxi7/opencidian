/**
 * [INPUT]: 依赖 ./events.js 的 Events；Node 内置 fs/path
 * [OUTPUT]: 导出 Settings 类（load/save/get/set/on('change')/config 合并视图）、DEFAULT_APP_SETTINGS/DEFAULT_APPEARANCE_SETTINGS/DEFAULT_CORE_PLUGINS（逐字对齐原版桌面默认配置）
 * [POS]: core/ 的配置层，读写 vault 下 .obsidian/*.json，合并保留未知键；customCss 保存库根 CSS 开关。外观与反链配置监听支撑设置独立窗口同步。workspace.js 与各视图通过它读取用户偏好；config getter 合并 app.json+appearance.json（appearance 优先），对齐原版 vault.config。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Settings: vault .obsidian config files with merge-preserving writes. */
import { Events } from './events.js';

const fs = require('fs');
const nodePath = require('path');

export const DEFAULT_APP_SETTINGS = {
  // —— 原版桌面默认配置（app.js 中 DC 对象逐字对齐）——
  alwaysUpdateLinks: false,           // 重命名时始终自动更新内部链接
  spellcheck: true,
  spellcheckLanguages: null,
  readableLineLength: true,
  strictLineBreaks: false,
  propertiesInDocument: 'visible',    // 'visible' | 'hidden' | 'source'
  showInlineTitle: true,
  useMarkdownLinks: false,
  showUnsupportedFiles: false,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  smartIndentList: true,
  foldHeading: true,
  foldIndent: true,
  showLineNumber: false,
  showIndentGuide: true,
  useTab: true,
  tabSize: 4,
  rightToLeft: false,
  autoConvertHtml: true,
  vimMode: false,
  livePreview: true,
  attachmentFolderPath: '/',          // '/' 根目录 | './' 当前文件夹 | './name' 子文件夹 | 'name' 指定文件夹
  newFileLocation: 'root',            // 'root' | 'folder' | 'current'
  newFileFolderPath: '/',
  newLinkFormat: 'shortest',          // 'shortest' | 'relative' | 'absolute'
  userIgnoreFilters: null,
  focusNewTab: true,
  defaultViewMode: 'source',          // 'source'（编辑视图） | 'preview'（阅读视图）
  promptDelete: true,
  trashOption: 'system',              // 'system' | 'local' | 'none'
  deleteUnlinkedAttachments: 'ask',   // 'ask' | 'always' | 'never'
  openBehavior: '',                   // '' | 'new' | 'daily' | 'file:<path>'
  pdfExportSettings: { pageSize: 'Letter', landscape: false, margin: '0', downscalePercent: 100 },
  uriCallbacks: false,
  settingsPopoutWindow: true,         // 1.14：设置默认在独立窗口中打开（vault.getConfig("settingsPopoutWindow")）
  // 1.12 起外观键实际存 appearance.json（见 DEFAULT_APPEARANCE_SETTINGS），此处保留同名兜底
  showViewHeader: true,
  showRibbon: true,
  nativeMenus: null,
  // —— 本复刻的兼容扩展 ——
  showStatusBar: true,
  folderNoteLocation: '',
  showTabs: true,
  newFileLocationMobile: 'root',
};

export const DEFAULT_APPEARANCE_SETTINGS = {
  // 原版 appearance.json 同步键（app.js 的同步键列表）
  accentColor: '',
  theme: 'obsidian',                  // 'obsidian' | 'moonstone' | 'system'
  cssTheme: '',
  enabledCssSnippets: [],
  showViewHeader: true,
  showRibbon: true,
  nativeMenus: null,                  // null = 跟随平台（macOS 用原生菜单）
  translucency: false,
  customCss: true,                    // 兼容扩展：应用库根 obsidian.css
  textFontFamily: '',
  interfaceFontFamily: '',
  monospaceFontFamily: '',
  baseFontSize: 16,
  baseFontSizeAction: false,
  slidingSidebar: true,
  floatingNavigation: true,
  autoFullScreen: true,
  zoomLevel: 0,                       // 复刻扩展：界面缩放级别
  // —— 兼容旧键（读取时兜底）——
  translucentWindow: false,
  browserZoom: 1,
  textFontSize: 16,
  monospaceFontSize: 13,
  showStatusBar: true,
};

export const DEFAULT_CORE_PLUGINS = {
  'file-explorer': true,
  'global-search': true,
  'switcher': true,
  graph: true,
  backlink: true,
  canvas: true,
  'outgoing-link': true,
  'tag-pane': true,
  properties: true,
  'page-preview': true,
  'daily-notes': true,
  templates: true,
  'note-composer': true,
  'command-palette': true,
  'editor-status': true,
  bookmarks: true,
  outline: true,
  'word-count': true,
  'file-recovery': true,
  'random-note': false,
  'zk-prefixer': false,
  workspaces: false,
  slides: false,
  'audio-recorder': false,
  'markdown-importer': false,
  'format-converter': false,
  'web-viewer': false,
  publish: false,
  sync: false,
  bases: true,
  'unique-note-creator': false,
};

export class Settings extends Events {
  constructor(app) {
    super();
    this.app = app;
    this.dir = '';
    this.appSettings = { ...DEFAULT_APP_SETTINGS };
    this.appearance = { ...DEFAULT_APPEARANCE_SETTINGS };
    this.hotkeys = {};
    this.corePlugins = { ...DEFAULT_CORE_PLUGINS };
  }

  setDir(vaultPath) {
    this.dir = nodePath.join(vaultPath, '.obsidian');
  }

  /** 合并配置视图（对齐原版 vault.config）：app.json 与 appearance.json 合并，appearance 优先。 */
  get config() {
    return { ...this.appSettings, ...this.appearance };
  }

  readJson(name) {
    try {
      const raw = fs.readFileSync(nodePath.join(this.dir, name), 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') return data;
    } catch (e) {}
    return null;
  }

  writeJsonMerged(name, patch) {
    let current = this.readJson(name) || {};
    if (Array.isArray(current) || typeof current !== 'object') current = {};
    const merged = { ...current, ...patch };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const serialized = JSON.stringify(merged);
      fs.writeFileSync(nodePath.join(this.dir, name), serialized);
      if (this._desktopPreferenceContents?.has(name)) this._desktopPreferenceContents.set(name, serialized);
    } catch (e) {
      console.error('Failed to write settings', name, e);
    }
  }

  load() {
    const appFile = this.readJson('app.json');
    if (appFile) this.appSettings = { ...DEFAULT_APP_SETTINGS, ...appFile };
    const appearance = this.readJson('appearance.json');
    if (appearance) this.appearance = { ...DEFAULT_APPEARANCE_SETTINGS, ...appearance };
    const hotkeys = this.readJson('hotkeys.json');
    if (hotkeys && typeof hotkeys === 'object') this.hotkeys = hotkeys;
    const core = this.readJson('core-plugins.json');
    if (core) {
      if (Array.isArray(core)) {
        // legacy format: array of enabled plugin ids
        const map = {};
        for (const id of core) map[id] = true;
        this.corePlugins = { ...DEFAULT_CORE_PLUGINS, ...map };
      } else if (typeof core === 'object') {
        // object format may only contain enabled:true entries
        this.corePlugins = { ...DEFAULT_CORE_PLUGINS, ...core };
      }
    }
    this.trigger('change');
  }

  /** 设置独立窗口写盘后，主窗同步外观与反链默认值。 */
  watchDesktopPreferences() {
    if (this._desktopPreferenceStop) return this._desktopPreferenceStop;
    const watched = [];
    const contents = this._desktopPreferenceContents = new Map();
    const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } };
    for (const name of ['appearance.json', 'backlink.json']) {
      const file = nodePath.join(this.dir, name);
      contents.set(name, read(file));
      const update = () => {
        const current = read(file);
        if (contents.get(name) === current) return;
        let data = {};
        if (current !== null) {
          try { data = JSON.parse(current); } catch (_) { return; }
          if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        }
        contents.set(name, current);
        if (name === 'appearance.json') {
          this.appearance = { ...DEFAULT_APPEARANCE_SETTINGS, ...data };
        }
        this.trigger('change');
        this.app.workspace?.trigger('settings-changed');
      };
      fs.watchFile(file, { persistent: false, interval: 250 }, update);
      watched.push(() => fs.unwatchFile(file, update));
    }
    const stop = this._desktopPreferenceStop = () => {
      watched.forEach((fn) => fn());
      this._desktopPreferenceStop = null;
    };
    window.addEventListener('beforeunload', stop, { once: true });
    return stop;
  }

  updateAppSettings(patch) {
    Object.assign(this.appSettings, patch);
    this.writeJsonMerged('app.json', patch);
    this.trigger('change');
    this.app.workspace && this.app.workspace.trigger('settings-changed');
  }

  updateAppearance(patch) {
    Object.assign(this.appearance, patch);
    this.writeJsonMerged('appearance.json', patch);
    this.trigger('change');
    this.app.workspace && this.app.workspace.trigger('settings-changed');
  }

  setHotkey(commandId, hotkeys) {
    // 数组（含空数组）表示自定义覆盖；空数组用于压制默认快捷键。
    // null/undefined 表示删除覆盖，恢复默认。
    const value = Array.isArray(hotkeys) ? hotkeys : null;
    if (value) this.hotkeys[commandId] = value;
    else delete this.hotkeys[commandId];
    if (value) {
      this.writeJsonMerged('hotkeys.json', { [commandId]: value });
    } else {
      const cur = this.readJson('hotkeys.json') || {};
      delete cur[commandId];
      try { fs.writeFileSync(nodePath.join(this.dir, 'hotkeys.json'), JSON.stringify(cur)); } catch (e) {}
    }
    this.trigger('hotkeys-changed');
  }

  setCorePluginEnabled(id, enabled) {
    this.corePlugins[id] = enabled;
    this.writeJsonMerged('core-plugins.json', { [id]: enabled });
    this.trigger('change');
  }

  // per-plugin data files (data.json inside the plugin folder, or provided name)
  loadPluginData(name, defaults = {}) {
    const data = this.readJson(name);
    return data ? { ...defaults, ...data } : { ...defaults };
  }

  savePluginData(name, data) {
    this.writeJsonMerged(name, data);
    this.trigger('change');
  }
}
