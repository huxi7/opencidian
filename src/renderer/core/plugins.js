/**
 * [INPUT]: 依赖 ./i18n.js 的 t；依赖 ./plugins-registry.js 的 corePluginModules。
 * [OUTPUT]: 导出 PluginManager(app.plugins)。
 * [POS]: core/ 的内部插件宿主。核心插件模块经 plugins-registry.js 汇总，PluginManager 启停它们并把开关写入 core-plugins.json；不扫描 .obsidian/plugins，也不加载任何第三方代码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Internal plugin host — loads the core plugin modules registered in plugins-registry.js. */
import { t } from './i18n.js';
import { corePluginModules } from './plugins-registry.js';

export class PluginManager {
  constructor(app) {
    this.app = app;
    this.internalPlugins = {};   // id -> {manifest, instance, enabled}
  }

  async initialize() {
    await this.loadInternalPlugins();
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
}

async function loadCoreModules(app) {
  return { ...corePluginModules };
}
