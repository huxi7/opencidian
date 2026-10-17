/**
 * [INPUT]: 依赖 ./events.js 的 Events/debounce；依赖 ./i18n.js 的 t/tt；依赖 ./notices.js、./modals.js、./menu.js、./suggest.js、./icons.js、./vault.js、./ipc.js、./plugins-registry.js 与 Node fs/path。
 * [OUTPUT]: 导出 Plugin 基类、PluginManager(app.plugins)、buildObsidianApi() 的 obsidian shim。
 * [POS]: core/ 的插件宿主。内部插件由 plugins-registry.js 汇总；社区插件对齐原版 Q0：安全模式由 localStorage 键 enable-plugin-<appId> 决定(null=未表态)，未表态且库内已有插件时弹信任模态(X0)；setEnable(false) 只卸载不改 community-plugins.json，设置页手动关(disableCommunityPlugin)才从配置移除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Plugin system — hosts internal ("core") plugins and loads community plugins
 * from <vault>/.obsidian/plugins/* with an `obsidian` module shim so that
 * simple community plugins can run.
 */
import { Events } from './events.js';
import { t, tt } from './i18n.js';
import { Notice } from './notices.js';
import { Modal, PromptModal, confirmDialog } from './modals.js';
import { Menu } from './menu.js';
import { SuggestModal, GenericSuggester, AbstractInputSuggest, fuzzyMatch, renderHighlightedText } from './suggest.js';
import { setIcon, createIcon, resolveIcon, addIcon, removeIcon, getIconIds } from './icons.js';
import { debounce } from './events.js';
import { TFile, TFolder, normalizePath } from './vault.js';
import { Desktop } from './ipc.js';
import { Keymap } from './keymap.js';
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
    if (this._loaded) {
      try { this.onunload(); } catch (e) { console.error('Plugin onunload failed', e); }
    }
    for (const child of this._children) { try { child.unload && child.unload(); } catch (e) {} }
    this._children = [];
    // 原版 Component.unload：注销 addCommand/addRibbonIcon/addSettingTab 等登记的回调，
    // 否则禁用后命令/侧栏图标仍留在宿主里。
    for (const cb of this._registered.splice(0)) { try { cb(); } catch (e) { console.error(e); } }
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
  addCommand(command) {
    // 原版插件 API：命令 id 自动加 "<pluginId>:" 前缀；插件显式写了前缀则不重复
    const prefix = this.manifest && this.manifest.id ? this.manifest.id + ':' : '';
    const id = prefix && !String(command.id || '').startsWith(prefix) ? prefix + command.id : command.id;
    const registered = { ...command, id };
    this.app.commands.addCommand(registered);
    this._registered.push(() => this.app.commands.removeCommand(id));
  }
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
// 原版保存自动更新检查偏好的 localStorage 键（Q0.setAutomaticUpdateCheck）。
const AUTO_UPDATE_KEY = 'plugin-automatically-check-for-updates';

/** 库路径短哈希：每库稳定的 appId（原版 appId 由启动登记表生成）。 */
function shortHash(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export class PluginManager {
  constructor(app) {
    this.app = app;
    this.plugins = {};           // id -> Plugin instance（已加载的社区插件）
    this.manifests = {};         // id -> manifest（曾加载的社区插件清单）
    this.internalPlugins = {};   // id -> {manifest, instance, enabled}
    this.enabledCommunity = new Set();  // community-plugins.json 的启用列表
    this.appId = 'opensidian-' + shortHash(app && app.vaultPath);
    this.autoCheckForUpdates = false;
    try {
      const raw = localStorage.getItem(AUTO_UPDATE_KEY);
      if (raw !== null) { try { this.autoCheckForUpdates = JSON.parse(raw); } catch (e) { this.autoCheckForUpdates = !!raw; } }
    } catch (e) {}
  }

  async initialize() {
    await this.loadInternalPlugins();
    await this.loadCommunityPlugins();
  }

  // -------------------------------------------------------------------------
  // 安全模式状态（原版 Q0.isEnabled / setEnable）
  // -------------------------------------------------------------------------
  /** localStorage 键：enable-plugin-<appId>；null=从未表态，'true'/'false'=用户选择。 */
  enabledKey() { return 'enable-plugin-' + this.appId; }

  isEnabled() { return localStorage.getItem(this.enabledKey()) === 'true'; }

  /** 兼容访问器：restrictedMode === !isEnabled()；赋值等价于 setEnable(!value)。 */
  get restrictedMode() { return !this.isEnabled(); }
  set restrictedMode(value) { this.setEnable(!value).catch((e) => console.error(e)); }

  setAutomaticUpdateCheck(value) {
    this.autoCheckForUpdates = !!value;
    try {
      if (value) localStorage.setItem(AUTO_UPDATE_KEY, JSON.stringify(true));
      else localStorage.removeItem(AUTO_UPDATE_KEY);
    } catch (e) {}
  }

  /**
   * 原版 setEnable：先写 localStorage 再批量装卸。
   * false → 逐个卸载但保留 community-plugins.json；true → 加载配置列表中的全部插件。
   */
  async setEnable(enabled) {
    try { localStorage.setItem(this.enabledKey(), enabled ? 'true' : 'false'); } catch (e) {}
    if (!enabled) {
      for (const id of Object.keys(this.plugins)) await this.unloadCommunityPlugin(id);
      return;
    }
    const ids = this.app.settings.communityPlugins || [];
    this.enabledCommunity = new Set(ids);
    for (const id of ids) {
      if (this.plugins[id]) continue;
      await this.enableCommunityPlugin(id, false).catch((e) => console.error(e));
    }
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
    const enabled = this.app.settings.communityPlugins || [];
    this.enabledCommunity = new Set(enabled);
    const manifests = this.listInstalledManifests();
    if (!manifests.length) return; // 原版：库内没有插件目录直接结束
    if (!this.isEnabled()) {
      // 原版：只有从未表态（键不存在）才弹信任模态；选过"不信任"后不再打扰
      if (localStorage.getItem(this.enabledKey()) === null) this._openTrustModalWhenReady();
      return; // 安全模式开启时不加载任何第三方插件
    }
    for (const id of this.enabledCommunity) {
      await this.enableCommunityPlugin(id, false).catch((e) => console.error(e));
    }
  }

  /** 原版 X0：信任模态。工作区渲染完成后打开，不阻塞启动；无 layout 事件时 3s 兜底。 */
  _openTrustModalWhenReady() {
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      try { this.openTrustModal(); } catch (e) { console.error(e); }
    };
    if (typeof document === 'undefined' || !document.body) { setTimeout(open, 0); return; }
    const ws = this.app.workspace;
    const root = document.querySelector('.workspace-root');
    if (root && root.children.length) { open(); return; } // 工作区已渲染（如运行期再次 loadCommunityPlugins）
    if (ws && typeof ws.once === 'function') {
      const timer = setTimeout(open, 3000);
      ws.once('layout-change', () => { clearTimeout(timer); open(); });
      return;
    }
    setTimeout(open, 0);
  }

  openTrustModal() {
    const modal = new Modal(this.app);
    modal.modalEl.addClass('mod-lg', 'mod-trust-folder');
    modal.setTitle(tt('setting.third-party-plugin.label-trust-author', 'Do you trust the author of this vault?'));
    for (const suffix of ['1', '2', '3']) {
      modal.contentEl.createEl('p', {
        text: tt('setting.third-party-plugin.label-trust-author-description-' + suffix, 'This vault comes with plugins. Only continue if you trust its author.'),
      });
    }
    const decide = async (consent) => {
      modal.close();
      await this.setEnable(consent);
      if (this.app.setting) {
        this.app.setting.open();
        this.app.setting.openTabById('community-plugins');
      }
    };
    const trust = modal.buttonContainerEl.createEl('button', {
      text: tt('setting.third-party-plugin.button-enable-plugins', 'Trust author and enable plugins'),
    });
    trust.onclick = () => { decide(true).catch((e) => console.error(e)); };
    const restricted = modal.buttonContainerEl.createEl('button', {
      text: tt('setting.third-party-plugin.button-dont-trust-author', 'Browse vault in Restricted Mode'),
    });
    restricted.onclick = () => { decide(false).catch((e) => console.error(e)); };
    modal.open();
  }

  /**
   * 原版 enablePlugin(id, save)：
   * - 安全模式开启时返回 false（守卫，设置页的开关不会绕过安全模式）；
   * - save=true（默认，原版 enablePluginAndSave 语义）把 id 写入 community-plugins.json；
   *   setEnable(true) 与启动加载走 save=false，配置列表保持不变。
   */
  async enableCommunityPlugin(id, save = true) {
    if (!this.isEnabled()) return false;
    if (this.plugins[id]) return true;
    const manifest = this.listInstalledManifests().find((m) => m.id === id);
    if (!manifest) return false;
    const codePath = nodePath.join(manifest.dir, 'main.js');
    if (!fs.existsSync(codePath)) return false;
    const code = fs.readFileSync(codePath, 'utf8');
    const instance = loadPluginCode(this.app, manifest, code);
    this.plugins[id] = instance;
    this.manifests[id] = manifest;
    try {
      await instance.load();
    } catch (e) {
      console.error('Plugin failure: ' + id, e);
      await this.unloadCommunityPlugin(id);
      return false;
    }
    // plugin styles
    const cssPath = nodePath.join(manifest.dir, 'styles.css');
    if (fs.existsSync(cssPath)) {
      const style = createEl('style', { attr: { 'data-plugin': id } });
      style.textContent = fs.readFileSync(cssPath, 'utf8');
      document.head.appendChild(style);
      instance._styleEl = style;
    }
    this.enabledCommunity.add(id);
    if (save) {
      const list = new Set(this.app.settings.communityPlugins || []);
      list.add(id);
      this.app.settings.setCommunityPlugins([...list]);
    }
    return true;
  }

  /** 原版 disablePlugin：仅卸载实例，不改 community-plugins.json（setEnable(false) 走这里）。 */
  async unloadCommunityPlugin(id) {
    const instance = this.plugins[id];
    if (!instance) return false;
    try { await instance.unload(); } catch (e) { console.error('Plugin failure: ' + id, e); }
    if (instance._styleEl) instance._styleEl.detach();
    delete this.plugins[id];
    return true;
  }

  /** 原版 disablePluginAndSave：设置页手动关，卸载并从 community-plugins.json 移除。 */
  async disableCommunityPlugin(id) {
    const unloaded = await this.unloadCommunityPlugin(id);
    if (!unloaded) return false;
    this.enabledCommunity.delete(id);
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
