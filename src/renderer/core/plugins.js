/**
 * [INPUT]: 核心插件注册表、设置与工作区；兼容插件宿主接口。
 * [OUTPUT]: 插件启停与命令、视图注册。
 * [POS]: 插件启停后同步固定侧栏入口。首次启动由布局恢复统一装配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Plugin system — hosts internal ("core") plugins and loads community plugins
 * from <vault>/.obsidian/plugins/* with an `obsidian` module shim so that
 * simple community plugins can run.
 */
import { Events } from './events.js';
import { t } from './i18n.js';
import { Notice } from './notices.js';
import { Modal, PromptModal, confirmDialog } from './modals.js';
import { Menu } from './menu.js';
import { SuggestModal, GenericSuggester, AbstractInputSuggest, fuzzyMatch, renderHighlightedText } from './suggest.js';
import { setIcon, createIcon, resolveIcon, addIcon, removeIcon, getIconIds } from './icons.js';
import { debounce } from './events.js';
import { TFile, TFolder, normalizePath } from './vault.js';
import { Desktop } from './ipc.js';
import { corePluginModules } from './plugins-registry.js';

const fs = require('fs');
const nodePath = require('path');

export class Plugin extends Events {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
    this._loaded = false;
    this._children = [];
    this._registered = [];
  }
  onload() {}
  onunload() {}
  async load() {
    if (this._loaded) return;
    this._loaded = true;
    await this.onload();
  }
  async unload() {
    this.onunload();
    for (const child of this._children) { try { child.unload && child.unload(); } catch (e) {} }
    this._children = [];
    this._loaded = false;
  }
  addChild(child) { this._children.push(child); return child; }
  removeChild(child) {
    const i = this._children.indexOf(child);
    if (i >= 0) this._children.splice(i, 1);
    return child;
  }
  registerDomEvent(el, type, cb, options) {
    el.addEventListener(type, cb, options);
    this._registered.push(() => el.removeEventListener(type, cb, options));
    return cb;
  }
  registerEvent(evtRef) {
    this._registered.push(() => { if (evtRef && evtRef.unregister) evtRef.unregister(); else if (evtRef && evtRef.off) evtRef.off(); });
    return evtRef;
  }
  registerInterval(id) { this._registered.push(() => clearInterval(id)); return id; }
  addCommand(command) { this.app.commands.addCommand(command); this._registered.push(() => this.app.commands.removeCommand(command.id)); }
  removeCommand(id) { this.app.commands.removeCommand(id); }
  addRibbonIcon(icon, title, callback) {
    const el = this.app.workspace.addRibbonItem(icon, title, callback);
    this._registered.push(() => el.detach());
    return el;
  }
  addStatusBarItem() {
    const el = createDiv('status-bar-item');
    this.app.workspace.statusBar.appendChild(el);
    this._registered.push(() => el.detach());
    return el;
  }
  addSettingTab(tab) {
    this.app.setting && this.app.setting.addSettingTab(tab);
    this._registered.push(() => this.app.setting && this.app.setting.removeSettingTab(tab));
  }
  registerView(type, factory) {
    this.app.viewRegistry.registerView(type, factory);
    this._registered.push(() => this.app.viewRegistry.unregisterView(type));
  }
  registerHoverLinkSource(id, info) {}
  registerMarkdownPostProcessor() {}
  registerMarkdownCodeBlockProcessor(language, handler) {
    this.app.embeddedCodeBlocks = this.app.embeddedCodeBlocks || {};
    this.app.embeddedCodeBlocks[language] = handler;
  }
  registerEditorExtension(ext) { this._registered.push(() => {}); }
  registerExtensions(extensions, viewType) {}
  registerObsidianProtocolHandler(action, handler) {
    this.app.obsidianProtocolHandlers = this.app.obsidianProtocolHandlers || {};
    this.app.obsidianProtocolHandlers[action] = handler;
  }
  registerEditorSuggest(suggest) { this._registered.push(() => {}); }
  addSettingTabStub() {}
  async loadData() {
    return this.app.settings.loadPluginData(nodePath.join('plugins', this.manifest.id, 'data.json'), this.manifest.settingsDefaults || {});
  }
  async saveData(data) {
    const dir = nodePath.join(this.app.settings.dir, 'plugins', this.manifest.id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(nodePath.join(dir, 'data.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.error(e); }
  }
  register(cb) { this._registered.push(cb); }
}

// ---------------------------------------------------------------------------
export class PluginManager {
  constructor(app) {
    this.app = app;
    this.plugins = {};           // id -> Plugin instance
    this.manifests = {};         // id -> manifest
    this.internalPlugins = {};   // id -> {manifest, instance, enabled}
    this.enabledCommunity = new Set();
    this.restrictedMode = true;
  }

  async initialize() {
    await this.loadInternalPlugins();
    await this.loadCommunityPlugins();
  }

  // -------------------------------------------------------------------------
  // Internal (core) plugins
  // -------------------------------------------------------------------------
  async loadInternalPlugins() {
    const modules = await loadCoreModules(this.app);
    for (const [id, mod] of Object.entries(modules)) {
      const nameKey = mod.nameKey || ('plugins.' + id);
      const manifest = {
        id,
        name: t(nameKey + '.name') || mod.name || id,
        description: t(nameKey + '.desc') || mod.description || '',
        module: mod,
      };
      const enabled = !!this.app.settings.corePlugins[id];
      this.internalPlugins[id] = { manifest, instance: null, enabled: false };
      if (enabled) await this.enableInternalPlugin(id);
    }
  }

  async enableInternalPlugin(id) {
    const entry = this.internalPlugins[id];
    if (!entry || entry.enabled) return true;
    try {
      const instance = entry.manifest.module.create(this.app);
      entry.instance = instance;
      // Plugins register their commands from onload (they close over `app`).
      if (instance.onload) await instance.onload();
      entry.enabled = true;
      this.app.settings.setCorePluginEnabled(id, true);
      if (this.app.workspace._sidebarReady) await this.app.workspace.reconcileSidebars();
      this.app.workspace.trigger('layout-change');
      return true;
    } catch (e) {
      console.error(`Failed to enable core plugin ${id}`, e);
      return false;
    }
  }

  async disableInternalPlugin(id) {
    const entry = this.internalPlugins[id];
    if (!entry || !entry.enabled) return true;
    try {
      const instance = entry.instance;
      if (this.app.setting) this.app.setting.removePluginTabs(id);
      if (instance) {
        if (instance.deregisterCommands) instance.deregisterCommands();
        if (instance.onunload) await instance.onunload();
      }
      if (entry.manifest.module.deregister) entry.manifest.module.deregister(this.app);
      entry.instance = null;
      entry.enabled = false;
      this.app.settings.setCorePluginEnabled(id, false);
      if (this.app.workspace._sidebarReady) await this.app.workspace.reconcileSidebars();
      this.app.workspace.trigger('layout-change');
      return true;
    } catch (e) {
      console.error(`Failed to disable core plugin ${id}`, e);
      return false;
    }
  }

  getInternalPlugin(id) { return this.internalPlugins[id]; }

  // -------------------------------------------------------------------------
  // Community plugins
  // -------------------------------------------------------------------------
  pluginDir() { return nodePath.join(this.app.settings.dir, 'plugins'); }

  listInstalledManifests() {
    const dir = this.pluginDir();
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = nodePath.join(dir, entry.name, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.dir = nodePath.join(dir, entry.name);
        manifest.id = manifest.id || entry.name;
        out.push(manifest);
      } catch (e) { /* skip */ }
    }
    return out;
  }

  async loadCommunityPlugins() {
    if (this.restrictedMode) return; // 安全模式开启时不加载第三方插件
    const enabled = this.app.settings.communityPlugins || [];
    this.enabledCommunity = new Set(enabled);
    for (const manifest of this.listInstalledManifests()) {
      if (this.enabledCommunity.has(manifest.id)) {
        await this.enableCommunityPlugin(manifest.id).catch((e) => console.error(e));
      }
    }
  }

  async enableCommunityPlugin(id) {
    if (this.plugins[id]) return true;
    const manifest = this.listInstalledManifests().find((m) => m.id === id);
    if (!manifest) return false;
    const codePath = nodePath.join(manifest.dir, 'main.js');
    if (!fs.existsSync(codePath)) return false;
    const code = fs.readFileSync(codePath, 'utf8');
    const instance = loadPluginCode(this.app, manifest, code);
    this.plugins[id] = instance;
    this.manifests[id] = manifest;
    await instance.load();
    // plugin styles
    const cssPath = nodePath.join(manifest.dir, 'styles.css');
    if (fs.existsSync(cssPath)) {
      const style = createEl('style', { attr: { 'data-plugin': id } });
      style.textContent = fs.readFileSync(cssPath, 'utf8');
      document.head.appendChild(style);
      instance._styleEl = style;
    }
    const list = new Set(this.app.settings.communityPlugins || []);
    list.add(id);
    this.app.settings.setCommunityPlugins([...list]);
    return true;
  }

  async disableCommunityPlugin(id) {
    const instance = this.plugins[id];
    if (!instance) return false;
    await instance.unload();
    if (instance._styleEl) instance._styleEl.detach();
    delete this.plugins[id];
    const list = new Set(this.app.settings.communityPlugins || []);
    list.delete(id);
    this.app.settings.setCommunityPlugins([...list]);
    return true;
  }

  uninstallPlugin(id) {
    const manifest = this.manifests[id];
    if (manifest && manifest.dir) {
      try { fs.rmSync(manifest.dir, { recursive: true, force: true }); } catch (e) {}
    }
    delete this.plugins[id];
    delete this.manifests[id];
  }

  getPlugin(id) { return this.plugins[id]; }
}

// ---------------------------------------------------------------------------
// obsidian module shim for community plugins
// ---------------------------------------------------------------------------
function loadPluginCode(app, manifest, code) {
  const moduleObj = { exports: {} };
  const obsidianApi = buildObsidianApi(app);
  const customRequire = (name) => {
    if (name === 'obsidian') return obsidianApi;
    if (name === 'electron') return require('electron');
    try { return require(name); }
    catch (e) { throw e; }
  };
  try {
    const fn = new Function('module', 'exports', 'require', code);
    fn(moduleObj, moduleObj.exports, customRequire);
  } catch (e) {
    console.error(`Failed to evaluate plugin ${manifest.id}`, e);
    throw e;
  }
  const PluginClass = moduleObj.exports.default || moduleObj.exports;
  const instance = new PluginClass(app, manifest);
  if (!(instance instanceof Plugin)) {
    // duck-type: ensure essential methods exist
    for (const m of ['onload', 'onunload', 'addCommand', 'addRibbonIcon', 'addSettingTab', 'registerView', 'loadData', 'saveData']) {
      if (typeof instance[m] !== 'function') instance[m] = Plugin.prototype[m].bind(instance);
    }
    if (typeof instance._loaded === 'undefined') instance._loaded = false;
    if (!instance.manifest) instance.manifest = manifest;
    if (!instance.app) instance.app = app;
  }
  return instance;
}

function buildObsidianApi(app) {
  class Setting {
    constructor(containerEl) {
      this.containerEl = containerEl;
      this.settingEl = containerEl.createDiv('setting-item');
      this.infoEl = this.settingEl.createDiv('setting-item-info');
      this.nameEl = this.infoEl.createDiv('setting-item-name');
      this.descEl = this.infoEl.createDiv('setting-item-description');
      this.controlEl = this.settingEl.createDiv('setting-item-control');
    }
    setName(name) { this.nameEl.setText(name); return this; }
    setDesc(desc) { this.descEl.setText(desc); return this; }
    setClass(cls) { this.settingEl.addClass(cls); return this; }
    setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
    setTooltip(tooltip) { this.settingEl.setAttr('aria-label', tooltip); return this; }
    addText(cb) {
      const text = new TextComponent(this.controlEl);
      cb(text);
      return this;
    }
    addTextArea(cb) { const c = new TextAreaComponent(this.controlEl); cb(c); return this; }
    addToggle(cb) { const c = new ToggleComponent(this.controlEl); cb(c); return this; }
    addDropdown(cb) { const c = new DropdownComponent(this.controlEl); cb(c); return this; }
    addSlider(cb) { const c = new SliderComponent(this.controlEl); cb(c); return this; }
    addButton(cb) { const c = new ButtonComponent(this.controlEl); cb(c); return this; }
    addExtraButton(cb) { const c = new ExtraButtonComponent(this.controlEl); cb(c); return this; }
    addSearch(cb) { const c = new SearchComponent(this.controlEl); cb(c); return this; }
    addColorPicker(cb) { const c = new ColorComponent(this.controlEl); cb(c); return this; }
    addMomentFormat(cb) { const c = new TextComponent(this.controlEl); cb(c); return this; }
  }

  class TextComponent {
    constructor(containerEl) {
      this.inputEl = containerEl.createEl('input', { type: 'text', cls: 'text-input' });
      this.inputEl.addEventListener('input', () => this.onChange && this.onChange(this.inputEl.value));
      this.inputEl.addEventListener('change', () => this.onChanged && this.onChanged(this.inputEl.value));
    }
    setValue(v) { this.inputEl.value = v; return this; }
    getValue() { return this.inputEl.value; }
    setPlaceholder(p) { this.inputEl.placeholder = p; return this; }
    setDisabled(d) { this.inputEl.disabled = d; return this; }
    onChange(cb) { this.onChange = cb; return this; }
    onChanged(cb) { this.onChanged = cb; return this; }
  }
  class TextAreaComponent extends TextComponent {
    constructor(containerEl) {
      super(containerEl);
      this.inputEl.detach();
      this.inputEl = containerEl.createEl('textarea', { cls: 'text-input' });
      this.inputEl.addEventListener('input', () => this.onChange && this.onChange(this.inputEl.value));
    }
  }
  class ToggleComponent {
    constructor(containerEl) {
      this.toggleEl = containerEl.createDiv('checkbox-container');
      this.toggleEl.onclick = () => { this.toggleEl.toggleClass('is-enabled'); this.onChange && this.onChange(this.toggleEl.hasClass('is-enabled')); };
    }
    setValue(v) { this.toggleEl.toggleClass('is-enabled', !!v); return this; }
    getValue() { return this.toggleEl.hasClass('is-enabled'); }
    onChange(cb) { this.onChange = cb; return this; }
    setDisabled(d) { if (d) this.toggleEl.addClass('is-disabled'); return this; }
  }
  class DropdownComponent {
    constructor(containerEl) {
      this.selectEl = containerEl.createEl('select', { cls: 'dropdown' });
      this.selectEl.addEventListener('change', () => this.onChange && this.onChange(this.selectEl.value));
    }
    addOption(value, display) { this.selectEl.createEl('option', { value, text: display }); return this; }
    addOptions(obj) { for (const k in obj) this.addOption(k, obj[k]); return this; }
    setValue(v) { this.selectEl.value = v; return this; }
    getValue() { return this.selectEl.value; }
    onChange(cb) { this.onChange = cb; return this; }
  }
  class SliderComponent {
    constructor(containerEl) {
      this.sliderEl = containerEl.createEl('input', { type: 'range', cls: 'slider' });
      this.sliderEl.addEventListener('input', () => { this.valueEl && this.valueEl.setText(this.sliderEl.value); this.onChange && this.onChange(Number(this.sliderEl.value)); });
    }
    setLimits(min, max, step) { this.sliderEl.min = min; this.sliderEl.max = max; this.sliderEl.step = step; return this; }
    setValue(v) { this.sliderEl.value = v; return this; }
    getValue() { return Number(this.sliderEl.value); }
    setDynamicTooltip() { return this; }
    showTooltip() { return this; }
    onChange(cb) { this.onChange = cb; return this; }
  }
  class ButtonComponent {
    constructor(containerEl) {
      this.buttonEl = containerEl.createEl('button', { cls: 'mod-cta' });
      this.buttonEl.onclick = () => this.clickCb && this.clickCb();
    }
    setButtonText(text) { this.buttonEl.setText(text); return this; }
    setCta() { this.buttonEl.addClass('mod-cta'); return this; }
    removeCta() { this.buttonEl.removeClass('mod-cta'); return this; }
    setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
    setDisabled(d) { this.buttonEl.disabled = d; return this; }
    setTooltip(t) { this.buttonEl.setAttr('aria-label', t); return this; }
    setIcon(icon) { setIcon(this.buttonEl, icon); return this; }
    onClick(cb) { this.clickCb = cb; return this; }
  }
  class ExtraButtonComponent extends ButtonComponent {
    constructor(containerEl) {
      super(containerEl);
      this.buttonEl = containerEl.createDiv('extra-setting-button clickable-icon');
      this.buttonEl.onclick = () => this.clickCb && this.clickCb();
    }
  }
  class SearchComponent extends TextComponent {}
  class ColorComponent {
    constructor(containerEl) {
      this.inputEl = containerEl.createEl('input', { type: 'color', cls: 'color-input' });
      this.inputEl.addEventListener('input', () => this.onChange && this.onChange(this.inputEl.value));
    }
    setValue(v) { this.inputEl.value = v; return this; }
    getValue() { return this.inputEl.value; }
    onChange(cb) { this.onChange = cb; return this; }
  }

  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = null;
      this.id = plugin && plugin.manifest ? plugin.manifest.id : 'plugin';
      this.name = plugin && plugin.manifest ? plugin.manifest.name : 'Plugin';
    }
    display() {}
    hide() {}
  }

  class MarkdownView {}
  class ItemView {}
  class FileView {}
  class Vault {}
  class AbstractInputSuggestShim extends AbstractInputSuggest {}

  const api = {
    App: class {},
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    Modal,
    PromptModal,
    SuggestModal,
    FuzzySuggestModal: SuggestModal,
    AbstractInputSuggest: AbstractInputSuggestShim,
    Menu,
    TFile,
    TFolder,
    Vault,
    MarkdownView,
    ItemView,
    FileView,
    Events,
    Keymap,
    moment: require('moment'),
    debounce,
    normalizePath,
    setIcon,
    requestUrl: (opts) => Desktop.requestUrl(opts),
    request: (opts) => Desktop.requestUrl(opts),
    Platform: {
      isDesktopApp: true,
      isMobileApp: false,
      isDesktop: true,
      isMobile: false,
      isMacOS: navigator.platform.startsWith('Mac'),
      isWin: navigator.platform.startsWith('Win'),
      isLinux: false,
      isIosApp: false,
      isAndroidApp: false,
      isPhone: false,
      isTablet: false,
    },
    Scope: class Scope { constructor() { this.handlers = []; } register(modifiers, key, func) { this.handlers.push({ modifiers, key, func }); } unregister() {} },
    prepareFuzzySearch: (query) => (text) => fuzzyMatch(query, text),
    prepareSimpleSearch: (query) => (text) => text.toLowerCase().includes(query.toLowerCase()) ? { score: 1 } : null,
    renderResults: (el, text, matches) => renderHighlightedText(el, text, matches),
    htmlToMarkdown: (html) => html,
    sanitizeHTMLToDom: (html) => { const div = createDiv(); div.innerHTML = html; return div; },
    getAllTags: (cache) => cache && cache.tags ? cache.tags.map((x) => x.tag) : [],
    parseLinktext: (linktext) => {
      const hashIdx = linktext.indexOf('#');
      return hashIdx >= 0 ? { path: linktext.slice(0, hashIdx), subpath: linktext.slice(hashIdx + 1) } : { path: linktext, subpath: '' };
    },
    getLinkpath: (link) => link.link,
    editorInfoField: null,
    editorLivePreviewField: null,
    MarkdownRenderChild: class { constructor(containerEl) { this.containerEl = containerEl; } },
    MarkdownRenderer: {
      render: async (app2, markdown, el, sourcePath, component) => {
        el.setText(markdown);
      },
    },
    Component: class Component extends Events {
      constructor() { super(); this._children = []; }
      load() {}
      unload() {}
      addChild(c) { this._children.push(c); return c; }
      removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; }
    },
    TAbstractFile: class {},
    SearchResult: class {},
    arrowFunction: () => {},
    getIcon: (name) => (resolveIcon(name) ? createIcon(name) : null),
    createIcon,
    addIcon,
    removeIcon,
    getIconIds,
  };
  api.Editor = class Editor {};
  api.TAbstractFile = Object.getPrototypeOf(TFile);
  return api;
}

async function loadCoreModules(app) {
  return { ...corePluginModules };
}
