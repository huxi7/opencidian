/**
 * [INPUT]: 依赖 ../core/modals.js 的 Modal；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/icons.js 的 setIcon；依赖 ../core/i18n.js 的 t；依赖 ./settings-tabs.js 的 AboutTab/EditorTab/FileTab；依赖 ./settings-tabs-appearance.js 的 AppearanceTab；依赖 ./settings-tabs-plugins.js 的 HotkeysTab/CorePluginsTab
 * [OUTPUT]: 导出 SettingTab（页签基类）、SettingsHost（设置模态宿主）、installSettingsHost(app)
 * [POS]: views/ 的设置模态宿主，逐字对齐原版 fte 类 DOM：modal.mod-settings.mod-sidebar-layout > .modal-content.vertical-tabs-container > .vertical-tab-header + .vertical-tab-content-container。app.setting 即本类实例；内置页签注册顺序为 关于 → 外观 → 编辑器 → 文件与链接 → 快捷键 → 核心插件，第三方插件页不注册。1.14.4 popout：shouldUsePopout 读 vault 配置 settingsPopoutWindow，开启时主进程开独立窗口，窗口内 modalEl 直接挂 body（is-popout-modal）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Settings host — modal shell + tab management, DOM 1:1 with the original. */
import { Modal } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';
import { syncTrafficLightPosition } from '../core/window-chrome.js';
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { SettingTab } from '../core/setting.js';
import { AboutTab, EditorTab, FileTab } from './settings-tabs.js';
import { AppearanceTab } from './settings-tabs-appearance.js';
import { HotkeysTab, CorePluginsTab } from './settings-tabs-plugins.js';

export { SettingTab };

export class SettingsHost extends Modal {
  constructor(app) {
    super(app);
    this.settingTabs = [];
    this.pluginTabs = [];       // 插件页签：{ id, name, icon, group: 'core', ... }
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
    });
    this.tabContentContainer = createDiv('vertical-tab-content-container');

    // 内置页签顺序对齐原版 1.14.4：关于 → 外观 →（界面已并入外观）→ 编辑器 → 文件与链接 → 快捷键 → 核心插件
    this.addSettingTab(new AboutTab(app, this));
    this.addSettingTab(new AppearanceTab(app, this));
    this.addSettingTab(new EditorTab(app, this));
    this.addSettingTab(new FileTab(app, this));
    this.addSettingTab(new HotkeysTab(app, this));
    this.addSettingTab(new CorePluginsTab(app, this));
  }

  updateModalTitle(tab) {
    this.titleEl.empty();
    if (tab) this.titleEl.setText(tab.name);
    else this.titleEl.setText(tt('interface.settings', 'Settings'));
  }

  // -------------------------------------------------------------------------
  // 独立窗口（1.14.4 popout）：shouldUsePopout/getPopoutOptions/getRootEl 与原版同名同行
  // -------------------------------------------------------------------------
  /** 原版：vault 配置 settingsPopoutWindow（默认 true）；设置窗口自身永不嵌套 popout。 */
  shouldUsePopout() {
    if (this.app.isSettingsWindow) return false;
    if (this.app.settings.appSettings.settingsPopoutWindow === false) return false;
    // E2E 验收默认走应用内模态（单窗口断言）；settings-window 场景以 __SETTINGS_POPOUT_FORCE__ 显式开窗
    if (!window.__SETTINGS_POPOUT_FORCE__) {
      try { if (process.env.E2E === '1') return false; } catch (e) {}
    }
    return true;
  }
  /** 原版 getPopoutOptions：900x700，min 600x400。 */
  getPopoutOptions() { return { width: 900, height: 700, minWidth: 600, minHeight: 400 }; }
  /** 原版：popout 文档里 modalEl 直接挂 body（body > .modal.mod-settings）；应用内仍是 modal-container。 */
  getRootEl() { return this.app.isSettingsWindow ? this.modalEl : this.containerEl; }

  /** 向主进程请求开窗/聚焦，并接力目标页签。 */
  _openPopoutWindow(tabId) {
    let background = '';
    try { background = getComputedStyle(document.body).backgroundColor; } catch (e) {}
    try {
      Desktop.settingsWindowOpen({
        vaultId: this.app.vaultId,
        tabId: tabId || '',
        ...this.getPopoutOptions(),
        background,
      });
    } catch (e) { /* 主进程不可用时保持静默（测试宿主） */ }
  }

  open() {
    if (this.shouldUsePopout()) { this._openPopoutWindow(this.lastTabId); return this; }
    return this.openInApp();
  }

  /** 主进程已裁决回退应用内模态：绕过本地配置缓存（设置窗口写的配置尚未同步到本渲染器）。 */
  openInApp() {
    if (this.app.isSettingsWindow) document.body.addClass('is-popout-modal');
    const result = super.open();
    // popout 的 --traffic-lights-offset 变为 32px；必须在类生效后重算，否则沿用主窗 (14,12)
    if (this.app.isSettingsWindow) syncTrafficLightPosition();
    return result;
  }

  close() {
    // 设置窗口自身：只关本模态并通知主进程销毁窗口（配置为 popout 时也走这里）
    if (this.app.isSettingsWindow) {
      const r = super.close();
      try { Desktop.settingsWindowClose(); } catch (e) {}
      return r;
    }
    // 应用内模态正在显示：先按模态关闭。否则开关写入 true 后再关，会因 shouldUsePopout() 成真而滞留。
    if (this.containerEl.isConnected) return super.close();
    if (this.shouldUsePopout()) { try { Desktop.settingsWindowClose(); } catch (e) {} return this; }
    return super.close();
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

  /** 核心插件在禁用时移除其设置页签（plugins.js 调用）。 */
  removePluginTabs(pluginId) {
    for (const tab of [...this.pluginTabs]) {
      if (tab.pluginId === pluginId) this.removeSettingTab(tab);
    }
  }

  isPluginSettingTab(tab) {
    return !!(tab.group === 'core' || tab.plugin);
  }

  updatePluginSection() {
    const core = this.pluginTabs.filter((tab) => tab.group === 'core');
    core.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    core.length ? this.corePluginTabHeaderGroup.show() : this.corePluginTabHeaderGroup.hide();
    this.corePluginTabContainer.empty();
    for (const tab of core) this.corePluginTabContainer.appendChild(tab.navEl);
  }

  openTab(tab) {
    if (!tab || !tab.containerEl) return;
    if (this.shouldUsePopout()) { this.lastTabId = tab.id; this._openPopoutWindow(tab.id); return; }
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
