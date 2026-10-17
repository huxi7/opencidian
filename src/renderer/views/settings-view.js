/**
 * [INPUT]: 依赖 ../core/modals.js 的 Modal；依赖 ../core/icons.js 的 setIcon；依赖 ../core/i18n.js 的 t；依赖 ./settings-tabs.js 的 AboutTab/EditorTab/FileTab/AppearanceTab；依赖 ./settings-tabs-plugins.js 的 HotkeysTab/CorePluginsTab/CommunityPluginsTab
 * [OUTPUT]: 导出 SettingTab（页签基类）、SettingsHost（设置模态宿主）、installSettingsHost(app)
 * [POS]: views/ 的设置模态宿主，逐字对齐原版 fte 类 DOM：modal.mod-settings.mod-sidebar-layout > .modal-content.vertical-tabs-container > .vertical-tab-header + .vertical-tab-content-container。app.setting 即本类实例；插件通过 addSettingTab 注册页签。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Settings host — modal shell + tab management, DOM 1:1 with the original. */
import { Modal } from '../core/modals.js';
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { SettingTab } from '../core/setting.js';
import { AboutTab, EditorTab, FileTab } from './settings-tabs.js';
import { AppearanceTab } from './settings-tabs-appearance.js';
import { HotkeysTab, CorePluginsTab, CommunityPluginsTab } from './settings-tabs-plugins.js';

export { SettingTab };

export class SettingsHost extends Modal {
  constructor(app) {
    super(app);
    this.settingTabs = [];
    this.pluginTabs = [];       // 插件页签：{ id, name, icon, group: 'core' | 'community', ... }
    this.activeTab = null;
    this.lastTabId = '';
    this.modalEl.addClass('mod-settings', 'mod-sidebar-layout');
    this.updateModalTitle();
    this.contentEl.addClass('vertical-tabs-container');

    this.tabHeadersEl = this.contentEl.createDiv('vertical-tab-header', (header) => {
      header.createDiv('vertical-tab-header-group', (group) => {
        group.createDiv({ cls: 'vertical-tab-header-group-title', text: tt('setting.options', 'Options') });
        this.tabContainer = group.createDiv('vertical-tab-header-group-items');
        this.tabContainer.setAttr('data-section', 'options');
      });
      header.createDiv('vertical-tab-header-group', (group) => {
        this.corePluginTabHeaderGroup = group.createDiv({ cls: 'vertical-tab-header-group-title', text: tt('setting.builtin-plugins', 'Core plugins') });
        this.corePluginTabHeaderGroup.hide();
        this.corePluginTabContainer = group.createDiv('vertical-tab-header-group-items');
        this.corePluginTabContainer.setAttr('data-section', 'core-plugins');
      });
      header.createDiv('vertical-tab-header-group', (group) => {
        this.communityPluginTabHeaderGroup = group.createDiv({ cls: 'vertical-tab-header-group-title', text: tt('setting.third-party-plugin.name', 'Community plugins') });
        this.communityPluginTabHeaderGroup.hide();
        this.communityPluginTabContainer = group.createDiv('vertical-tab-header-group-items');
        this.communityPluginTabContainer.setAttr('data-section', 'community-plugins');
      });
    });
    this.tabContentContainer = createDiv('vertical-tab-content-container');

    // 内置页签顺序对齐原版：关于 → 编辑器 → 文件与链接 → 外观 → 快捷键 → 核心插件 → 第三方插件
    this.addSettingTab(new AboutTab(app, this));
    this.addSettingTab(new EditorTab(app, this));
    this.addSettingTab(new FileTab(app, this));
    this.addSettingTab(new AppearanceTab(app, this));
    this.addSettingTab(new HotkeysTab(app, this));
    this.addSettingTab(new CorePluginsTab(app, this));
    this.addSettingTab(new CommunityPluginsTab(app, this));
  }

  updateModalTitle(tab) {
    this.titleEl.empty();
    if (tab) this.titleEl.setText(tab.name);
    else this.titleEl.setText(tt('interface.settings', 'Settings'));
  }

  addSettingTab(tab) {
    if (!tab || !tab.id) return;
    if (!tab.containerEl) tab.containerEl = createDiv('vertical-tab-content');
    if (!tab.navEl) {
      tab.navEl = createDiv('vertical-tab-nav-item tappable', (nav) => {
        nav.setAttr('data-setting-id', tab.id);
        if (tab.icon) nav.createDiv('vertical-tab-nav-item-icon', (iconEl) => setIcon(iconEl, tab.icon));
        nav.createDiv({ cls: 'vertical-tab-nav-item-title', text: tab.name });
        nav.createDiv('vertical-tab-nav-item-chevron', (chev) => setIcon(chev, 'lucide-chevron-right'));
        nav.addEventListener('click', () => this.openTab(tab));
      });
    }
    if (this.isPluginSettingTab(tab)) {
      this.pluginTabs.push(tab);
    } else {
      this.settingTabs.push(tab);
      this.tabContainer.appendChild(tab.navEl);
    }
    this.updatePluginSection();
  }

  removeSettingTab(tab) {
    const id = typeof tab === 'string' ? tab : tab && tab.id;
    this.pluginTabs = this.pluginTabs.filter((x) => x.id !== id);
    this.settingTabs = this.settingTabs.filter((x) => x.id !== id);
    if (this.activeTab && this.activeTab.id === id) this.closeActiveTab();
    this.updatePluginSection();
  }

  /** 核心/社区插件在禁用时移除其设置页签（plugins.js 调用）。 */
  removePluginTabs(pluginId) {
    for (const tab of [...this.pluginTabs]) {
      const owner = tab.pluginId || (tab.plugin && tab.plugin.manifest && tab.plugin.manifest.id);
      if (owner === pluginId) this.removeSettingTab(tab);
    }
  }

  isPluginSettingTab(tab) {
    return !!(tab.group === 'core' || tab.group === 'community' || tab.plugin);
  }

  updatePluginSection() {
    const core = this.pluginTabs.filter((tab) => tab.group === 'core');
    core.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    core.length ? this.corePluginTabHeaderGroup.show() : this.corePluginTabHeaderGroup.hide();
    this.corePluginTabContainer.empty();
    for (const tab of core) this.corePluginTabContainer.appendChild(tab.navEl);

    const community = this.pluginTabs.filter((tab) => tab.group !== 'core');
    community.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    community.length ? this.communityPluginTabHeaderGroup.show() : this.communityPluginTabHeaderGroup.hide();
    this.communityPluginTabContainer.empty();
    for (const tab of community) this.communityPluginTabContainer.appendChild(tab.navEl);
  }

  openTab(tab) {
    if (!tab || !tab.containerEl) return;
    this.tabContentContainer.empty();
    this.updateModalTitle(tab);
    if (this.activeTab) {
      this.activeTab.navEl.removeClass('is-active');
      this.activeTab.hide();
    }
    this.activeTab = tab;
    this.lastTabId = tab.id;
    tab.navEl.addClass('is-active');
    this.tabContentContainer.appendChild(tab.containerEl);
    const backButton = createDiv('clickable-icon modal-setting-back-button mod-raised', (el) => {
      el.addEventListener('click', () => this.closeActiveTab());
      setIcon(el, 'lucide-arrow-left');
    });
    this.titleEl.prepend(backButton);
    this.contentEl.appendChild(this.tabContentContainer);
    try {
      tab.display();
    } catch (e) {
      console.error('Settings tab failed', tab.id, e);
    }
  }

  closeActiveTab() {
    const tab = this.activeTab;
    if (tab) {
      this.tabContentContainer.empty();
      tab.navEl.removeClass('is-active');
      tab.hide();
      this.updateModalTitle();
      this.activeTab = null;
    }
  }

  openTabById(id) {
    for (const tab of this.settingTabs) {
      if (tab.id === id) { this.openTab(tab); return tab; }
    }
    for (const tab of this.pluginTabs) {
      if (tab.id === id) { this.openTab(tab); return tab; }
    }
    return null;
  }

  /**
   * 核心插件的齿轮入口：为导出 settingTab(app, containerEl) 的插件生成设置页签，
   * 归入侧栏“核心插件”分组（对齐原版 G0 页签行为）。
   */
  openPluginOptions(pluginId) {
    const entry = this.app.plugins && this.app.plugins.getInternalPlugin(pluginId);
    if (!entry || !entry.manifest.module.settingTab) return;
    let tab = this.pluginTabs.find((x) => x.pluginId === pluginId);
    if (!tab) {
      const module = entry.manifest.module;
      tab = new SettingTab(this.app, this);
      tab.id = pluginId;
      tab.name = entry.manifest.name;
      tab.icon = 'settings';
      tab.group = 'core';
      tab.pluginId = pluginId;
      tab.display = () => {
        tab.containerEl.empty();
        module.settingTab(this.app, tab.containerEl);
      };
      this.addSettingTab(tab);
    }
    this.openTab(tab);
  }

  onOpen() {
    if (!this.openTabById(this.lastTabId)) this.openTab(this.settingTabs[0]);
  }

  onClose() {
    this.closeActiveTab();
  }
}

/** Installs the settings host on the app (idempotent). */
export function installSettingsHost(app) {
  if (app.setting) return app.setting;
  app.setting = new SettingsHost(app);
  return app.setting;
}
