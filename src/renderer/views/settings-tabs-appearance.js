/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/setting.js 的 SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/icons.js 的 setIcon；依赖 ../core/window-chrome.js 的 syncTrafficLightPosition；依赖 ./settings-tabs-dialogs.js 的 ThemeManagerModal/openFontPage/trackSliderFill/addSliderValue/readInstalledThemes；Node 内置 fs/path；Electron renderer 的 webFrame/ipcRenderer
 * [OUTPUT]: 导出 AppearanceTab（外观页签）、InterfaceTab（界面页签）
 * [POS]: views/ 的外观与界面设置页签。AppearanceTab 对齐原版 Jee：基础组（基础颜色/主题色/主题/已安装主题/CSS 样式代码片段）、字体组（三行字体为可导航子页面 + 字号/快速调整）、高级组（自定义应用图标/半透明效果）。InterfaceTab 对齐原版 1.14.4 独立的“界面”页签：显示标签页标题栏/显示功能区/功能区 + 高级组（缩放比例/原生菜单/窗口边框样式/在新窗口中打开设置）。功能区、CSS 片段与字体是原版的可导航子页面，走 SettingsHost.openPage。半透明效果写 appearance.json 的 translucency；硬件加速属于关于页高级组。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Appearance + Interface settings tabs — DOM 1:1 with the original. */
import { tt } from '../core/i18n.js';
import { SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { setIcon } from '../core/icons.js';
import { syncTrafficLightPosition } from '../core/window-chrome.js';
import { ThemeManagerModal, openFontPage, trackSliderFill, addSliderValue, readInstalledThemes } from './settings-tabs-dialogs.js';

const fs = require('fs');
const nodePath = require('path');

function electronModule() {
  try { return require('electron'); } catch (e) { return null; }
}

/** 原版样式键：可导航行的行尾值（CSS 片段已启用数）与箭头。 */
function addNavigableTail(setting, valueText) {
  if (valueText !== undefined && valueText !== null) {
    setting.controlEl.createDiv('setting-item-value').setText(valueText);
  }
  setting.controlEl.createDiv('setting-item-chevron', (el) => setIcon(el, 'lucide-chevron-right'));
}

export class AppearanceTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.appearance.name', '外观');
    this.id = 'appearance';
    this.icon = 'palette';
  }

  get snippetsDir() {
    return nodePath.join(this.app.settings.dir, 'snippets');
  }

  get themesDir() {
    return nodePath.join(this.app.settings.dir, 'themes');
  }

  listSnippets() {
    try {
      if (!fs.existsSync(this.snippetsDir)) return [];
      return fs.readdirSync(this.snippetsDir)
        .filter((name) => name.toLowerCase().endsWith('.css'))
        .map((name) => name.replace(/\.css$/i, ''))
        .sort();
    } catch (e) {
      return [];
    }
  }

  /**
   * 原版 customCss.readThemes：现代主题 = themes/<name>/manifest.json（name 与目录同名）；
   * 旧版主题 = themes/ 下的裸 .css 文件。
   */
  listThemes() {
    return readInstalledThemes(this.app.settings.dir);
  }

  display() {
    const app = this.app;
    const appearance = app.settings.appearance;
    const update = (patch) => app.settings.updateAppearance(patch);
    this.containerEl.empty();

    /* ---------------------------------------------------------- 基础 */
    const base = new SettingGroup(this.containerEl);
    base.addSetting((s) => s
      .setName(tt('setting.appearance.option-base-theme', '基础颜色'))
      .setDesc(tt('setting.appearance.option-base-theme-description', '设置 OpenSidian 的基础颜色。'))
      .addDropdown((d) => {
        d.addOption('obsidian', tt('setting.appearance.dark-theme', '深色'));
        d.addOption('moonstone', tt('setting.appearance.light-theme', '浅色'));
        d.addOption('system', tt('setting.appearance.system-theme', '跟随系统'));
        d.setValue(appearance.theme || 'obsidian');
        d.onChange((v) => update({ theme: v }));
      }));

    base.addSetting((s) => {
      s.setClass('mod-toggle');
      s.setName(tt('setting.appearance.option-accent-color', '主题色'))
        .setDesc(tt('setting.appearance.option-accent-color-description', '为 OpenSidian 选择一个主题色。主题色将影响选中、链接等元素的颜色。'));
      let picker = null;
      let resetBtn = null;
      const syncResetState = () => {
        if (resetBtn) resetBtn.extraSettingsEl.setAttr('aria-disabled', String(!appearance.accentColor));
      };
      s.addExtraButton((b) => {
        resetBtn = b;
        b.setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => {
            update({ accentColor: '' });
            if (picker) picker.colorPickerEl.value = computedAccentHex();
            syncResetState();
          });
      });
      s.addColorPicker((cp) => {
        picker = cp;
        cp.setValue(appearance.accentColor || computedAccentHex())
          .onChange((v) => {
            update({ accentColor: v });
            syncResetState();
          });
      });
      syncResetState();
    });

    const { themes, legacy } = this.listThemes();
    base.addSetting((s) => s
      .setName(tt('setting.appearance.option-themes', '主题'))
      .setDesc(tt('setting.appearance.option-manage-themes-description', '管理已安装的主题，或浏览社区主题。'))
      .addExtraButton((b) => b
        .setIcon('lucide-folder-open')
        .setTooltip(tt('setting.appearance.button-open-themes-folder', '打开主题文件夹'))
        .onClick(() => this.openFolder(this.themesDir)))
      .addDropdown((d) => {
        d.addOption('', tt('setting.appearance.label-default-theme', '默认'));
        for (const theme of themes) d.addOption(theme.name, theme.name);
        for (const theme of legacy) d.addOption(theme.name, theme.name + ' (Legacy)');
        // 原版：只有已安装的主题才作为当前值
        const installed = themes.some((t) => t.name === appearance.cssTheme)
          || legacy.some((t) => t.name === appearance.cssTheme);
        d.setValue(installed ? appearance.cssTheme : '');
        d.onChange((v) => update({ cssTheme: v }));
      })
      .addButton((b) => b
        .setButtonText(tt('setting.appearance.option-theme-button-manage', '管理'))
        .onClick(() => new ThemeManagerModal(app, () => this.display()).open())));
    base.addSetting((s) => s
      .setName(tt('setting.appearance.label-current-themes', '已安装主题'))
      .setDesc(tt('setting.appearance.label-currently-installed', '你目前已经安装了 {{count}} 个主题', { count: themes.length + legacy.length })));

    // CSS 样式代码片段：原版是可导航子页面，行尾显示已启用数量
    const snippets = this.listSnippets();
    const enabled = new Set(appearance.enabledCssSnippets || []);
    base.addSetting((s) => {
      s.setClass('mod-navigable');
      s.setClass('tappable');
      s.setName(tt('setting.appearance.option-css-snippets', 'CSS 样式代码片段'))
        .setDesc(tt('setting.appearance.option-css-snippets-description', '管理用于调整应用外观的 CSS 文件集合。'));
      addNavigableTail(s, tt('setting.appearance.label-enabled-snippets-count', '已启用 {{count}} 个', { count: enabled.size }));
      s.settingEl.addEventListener('click', () => this.openSnippetsPage());
    });

    /* ---------------------------------------------------------- 字体 */
    const fonts = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-font', '字体'));
    // 原版：三种字体都是可导航子页面（type:"page"），行尾显示已设字体数量
    const addFontRow = (name, desc, key) => {
      fonts.addSetting((s) => {
        const current = String(appearance[key] || '').split(',').map((x) => x.trim()).filter(Boolean);
        s.setClass('mod-navigable');
        s.setClass('tappable');
        s.setName(name);
        s.descEl.empty();
        s.descEl.appendText(desc);
        if (current.length) {
          s.controlEl.createDiv('setting-item-value')
            .setText(tt('setting.appearance.label-font-count', '{{count}} 种字体', { count: current.length }));
        }
        s.controlEl.createDiv('setting-item-chevron', (el) => setIcon(el, 'lucide-chevron-right'));
        s.settingEl.addEventListener('click', () => openFontPage(this.setting, this.app, { title: name, key }));
      });
    };
    addFontRow(tt('setting.appearance.option-interface-font', '界面字体'), tt('setting.appearance.option-interface-font-description', '设置 OpenSidian 界面字体。在不指定其他字体的情况下，该字体将成为 OpenSidian 的基础字体。'), 'interfaceFontFamily');
    addFontRow(tt('setting.appearance.option-text-font', '正文字体'), tt('setting.appearance.option-text-font-description', '设置编辑视图和阅读视图中笔记正文的字体。'), 'textFontFamily');
    addFontRow(tt('setting.appearance.option-monospace-font', '代码字体'), tt('setting.appearance.option-monospace-font-description', '设置代码块、元数据源码等文本的字体。'), 'monospaceFontFamily');

    fonts.addSetting((s) => {
      let slider = null;
      const setSize = (v) => {
        if (slider) slider.setValue(v);
        app.settings.updateAppearance({ baseFontSize: v });
      };
      s.setName(tt('setting.appearance.option-font-size', '字体大小'))
        .setDesc(tt('setting.appearance.option-font-size-description', '调整编辑视图及预览视图中的字体大小（单位为像素）。'))
        .addExtraButton((b) => b
          .setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => setSize(16)))
        .addSlider((sl) => {
          slider = sl;
          sl.setLimits(10, 30, 1).setDynamicTooltip()
            .setValue(app.settings.appearance.baseFontSize || 16)
            .onChange((v) => app.settings.updateAppearance({ baseFontSize: v }));
          trackSliderFill(sl);
          addSliderValue(s, sl, (v) => String(v));
        });
    });
    fonts.addSetting((s) => s
      .setName(tt('setting.appearance.option-font-size-action', '快速调整字体大小'))
      .setDesc(tt('setting.appearance.option-font-size-action-description', '开启后可通过 Ctrl 与鼠标滚轮（或使用触摸板手势）快速调整字体大小。'))
      .addToggle((tog) => tog.setValue(app.settings.appearance.baseFontSizeAction === true).onChange((v) => app.settings.updateAppearance({ baseFontSizeAction: v }))));

    /* ---------------------------------------------------------- 高级（桌面） */
    const electron = electronModule();
    const adv = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-advanced', '高级'));
    adv.addSetting((s) => {
      let relaunchBtn = null;
      let resetBtn = null;
      const renderDesc = () => {
        s.descEl.empty();
        const icon = (() => { try { return Desktop.getIcon(); } catch (e) { return null; } })();
        if (icon && icon.dataUrl) s.descEl.createEl('img', { attr: { width: '64', height: '64', src: icon.dataUrl } });
        else s.descEl.appendText(tt('setting.appearance.option-custom-icon-desc', '给应用设置一个自定义的图标'));
        if (resetBtn) resetBtn.extraSettingsEl.toggle(!!icon);
      };
      s.setName(tt('setting.appearance.option-custom-icon', '自定义应用图标'));
      s.addExtraButton((b) => {
        resetBtn = b;
        b.setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => {
            try { Desktop.setIcon(null); } catch (e) {}
            renderDesc();
            if (relaunchBtn) relaunchBtn.buttonEl.show();
          });
      });
      renderDesc();
      s.addButton((b) => b
        .setButtonText(tt('dialogue.button-choose', '选择'))
        .onClick(() => {
          const res = Desktop.openDialog({
            title: tt('setting.appearance.option-custom-icon', '自定义应用图标'),
            properties: ['openFile', 'dontAddToRecent'],
            filters: [{ name: 'PNG/ICO/ICNS', extensions: ['png', 'ico', 'icns'] }],
          });
          const filePath = res && !res.canceled && res.filePaths && res.filePaths[0];
          if (!filePath) return;
          const ext = String(filePath).split('.').pop().toLowerCase();
          if (!['png', 'ico', 'icns'].includes(ext)) { new Notice('Supported file types are: png, ico, icns'); return; }
          const ok = (() => { try { return Desktop.setIcon(filePath); } catch (e) { return false; } })();
          if (!ok) { new Notice(tt('setting.appearance.msg-set-icon-failed', '设置图标失败')); return; }
          renderDesc();
          if (relaunchBtn) relaunchBtn.buttonEl.show();
        }));
      s.addButton((b) => {
        relaunchBtn = b;
        b.setCta().setButtonText(tt('setting.about.button-relaunch', '重新启动应用'));
        b.buttonEl.hide();
        b.onClick(() => location.reload());
      });
    });
    // 原版：半透明效果写 appearance.json 的 translucency（macOS vibrancy）。
    // 本复刻无原生 vibrancy 通道，改用原版 token --workspace-background-translucent 近似。
    const applyTranslucency = (on) => {
      try { document.body.toggleClass('mod-translucent', !!on); } catch (e) {}
    };
    applyTranslucency(app.settings.appearance.translucency === true);
    adv.addSetting((s) => s
      .setName(tt('setting.appearance.option-translucency', '半透明效果'))
      .setDesc(tt('setting.appearance.option-translucency-desc', '开启半透明效果以增强沉浸感（深色模式下开启效果更佳）。Linux 不支持此效果。'))
      .addToggle((tog) => tog.setValue(app.settings.appearance.translucency === true).onChange((v) => {
        app.settings.updateAppearance({ translucency: v });
        applyTranslucency(v);
      })));
  }

  /** CSS 样式代码片段子页面（原版 openPage：.setting-page > .setting-page-content）。 */
  openSnippetsPage() {
    const app = this.app;
    this.setting.openPage({
      title: tt('setting.appearance.option-css-snippets', 'CSS 样式代码片段'),
      build: (contentEl) => {
        const group = new SettingGroup(contentEl);
        group.addClass('mod-list');
        group.addClass('mod-no-icon');
        // 原版：列表组带标题行（标题为空），行尾是重新加载与打开文件夹两个按钮
        group.groupEl.prepend(group.headerEl);
        group.addExtraButton((b) => b
          .setIcon('lucide-refresh-cw')
          .setTooltip(tt('setting.appearance.button-reload-snippets', '重新加载样式代码片段'))
          .onClick(() => {
            app._applyCustomCss();
            new Notice(tt('setting.appearance.msg-reloaded-snippets', '重新加载 CSS 样式代码片段'));
            this.setting.closePage();
            this.openSnippetsPage();
          }));
        group.addExtraButton((b) => b
          .setIcon('lucide-folder-open')
          .setTooltip(tt('setting.appearance.button-open-snippets-folder', '打开样式代码片段文件夹'))
          .onClick(() => this.openFolder(this.snippetsDir)));
        const snippets = this.listSnippets();
        const enabled = new Set(app.settings.appearance.enabledCssSnippets || []);
        if (!snippets.length) {
          const empty = group.listEl.createDiv('setting-item mod-empty-state');
          const info = empty.createDiv('setting-item-info');
          const name = info.createDiv('setting-item-name');
          name.appendText(tt('setting.appearance.no-snippet-description', 'CSS 片段可用于自定义 Obsidian 的外观。将 CSS 文件放入“{{path}}”中，它们就会显示在这里。', { path: 'vault/.obsidian/snippets' }));
          name.createEl('a', {
            text: tt('interface.button-learn-more', '了解更多'),
            attr: { href: 'https://help.obsidian.md/snippets', target: '_blank', rel: 'noopener' },
          });
          info.createDiv('setting-item-description');
          empty.createDiv('setting-item-control');
          return;
        }
        for (const name of snippets) {
          group.addSetting((s) => {
            s.setClass('mod-toggle');
            s.setName(name);
            s.addToggle((tog) => tog.setValue(enabled.has(name)).onChange((v) => {
              const next = new Set(app.settings.appearance.enabledCssSnippets || []);
              if (v) next.add(name); else next.delete(name);
              app.settings.updateAppearance({ enabledCssSnippets: [...next] });
            }));
          });
        }
      },
    });
  }

  openFolder(dir) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      Desktop.openPath(dir);
    } catch (e) {
      console.error('Failed to open folder', dir, e);
    }
  }
}

/* ------------------------------------------------------------------ 界面页 */

/**
 * 原版 1.14.4 独立的“界面”页签（图标 lucide-monitor）。
 * 高级组四项目标键：缩放比例/原生菜单写 appearance.json；窗口边框样式由主进程持有；
 * 在新窗口中打开设置写 app.json 的 settingsPopoutWindow。
 */
export class InterfaceTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.interface.name', '界面');
    this.id = 'interface';
    this.icon = 'monitor';
  }

  display() {
    const app = this.app;
    const appearance = app.settings.appearance;
    const update = (patch) => app.settings.updateAppearance(patch);
    this.containerEl.empty();

    const group = new SettingGroup(this.containerEl);
    group.addSetting((s) => s
      .setName(tt('setting.appearance.option-show-view-header', '显示标签页标题栏'))
      .setDesc(tt('setting.appearance.option-show-view-header-desc', '在每个标签页上方显示标题栏。'))
      .addToggle((tog) => tog.setValue(appearance.showViewHeader !== false).onChange((v) => update({ showViewHeader: v }))));
    group.addSetting((s) => s
      .setName(tt('setting.appearance.option-show-ribbon', '显示功能区'))
      .setDesc(tt('setting.appearance.option-show-ribbon-desc', '显示窗口最左侧的功能区，以便快速执行命令。'))
      .addToggle((tog) => tog.setValue(appearance.showRibbon !== false).onChange((v) => update({ showRibbon: v }))));
    group.addSetting((s) => {
      s.setClass('mod-navigable');
      s.setClass('tappable');
      s.setName(tt('setting.appearance.option-configure-ribbon', '功能区'))
        .setDesc(tt('setting.appearance.option-configure-ribbon-desc', '设置哪些命令需要显示在功能区上。'));
      addNavigableTail(s);
      s.settingEl.addEventListener('click', () => this.openRibbonPage());
    });

    /* ---------------------------------------------------------- 高级 */
    const electron = electronModule();
    const adv = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-advanced', '高级'));
    adv.addSetting((s) => {
      let slider = null;
      let resetBtn = null;
      const webFrame = electron && electron.webFrame;
      const current = webFrame ? webFrame.getZoomLevel() : (appearance.zoomLevel || 0);
      const syncResetState = (value) => {
        if (resetBtn) resetBtn.extraSettingsEl.setAttr('aria-disabled', String(value === 0));
      };
      const applyZoom = (v) => {
        if (webFrame) { webFrame.setZoomLevel(v); syncTrafficLightPosition(); }
        app.settings.updateAppearance({ zoomLevel: v });
      };
      s.setName(tt('setting.appearance.option-zoom-level', '缩放比例'))
        .setDesc(tt('setting.appearance.option-zoom-level-description', '控制应用程序的整体缩放比例'))
        .addExtraButton((b) => {
          resetBtn = b;
          b.setIcon('lucide-rotate-ccw')
            .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
            .onClick(() => { applyZoom(0); if (slider) slider.setValue(0); syncResetState(0); });
        })
        .addSlider((sl) => {
          slider = sl;
          sl.setLimits(-2.5, 3, 0.5).setDynamicTooltip().setValue(current).onChange((v) => {
            applyZoom(v);
            syncResetState(v);
          });
          sl.getValuePretty = () => Math.round(100 * Math.pow(1.2, sl.getValue())) + '%';
          trackSliderFill(sl);
          addSliderValue(s, sl, (v) => Math.round(100 * Math.pow(1.2, v)) + '%');
        });
      syncResetState(current);
    });
    adv.addSetting((s) => s
      .setName(tt('setting.appearance.option-native-menus', '原生菜单'))
      .setDesc(tt('setting.appearance.option-native-menus-desc', 'OpenSidian 中所有的菜单都会匹配操作系统，不会跟随主题样式'))
      .addToggle((tog) => tog.setValue(appearance.nativeMenus === true).onChange((v) => update({ nativeMenus: v }))));
    if (electron && electron.ipcRenderer) {
      let currentFrame = 'hidden';
      try { currentFrame = electron.ipcRenderer.sendSync('frame') || 'hidden'; } catch (e) {}
      adv.addSetting((s) => {
        let relaunchBtn = null;
        s.setName(tt('setting.appearance.option-frame-style', '窗口边框样式'))
          .setDesc(tt('setting.appearance.option-frame-description', '更改 OpenSidian 窗口边框的样式。该设置重启应用后生效。'))
          .addButton((b) => {
            relaunchBtn = b;
            b.setCta().setButtonText(tt('setting.about.button-relaunch', '重新启动应用'));
            b.buttonEl.hide();
            b.onClick(() => { try { electron.ipcRenderer.sendSync('relaunch'); } catch (e) { location.reload(); } });
          })
          .addDropdown((d) => {
            d.addOption('hidden', tt('setting.appearance.option-frame-hidden', '隐藏（默认）'));
            d.addOption('custom', tt('setting.appearance.option-frame-obsidian', 'OpenSidian 风格'));
            d.addOption('native', tt('setting.appearance.option-frame-native', '原生边框'));
            d.setValue(currentFrame);
            d.onChange((v) => {
              try { electron.ipcRenderer.sendSync('frame', v); } catch (e) {}
              relaunchBtn.buttonEl.show();
            });
          });
      });
    }
    // 原版：在新窗口中打开设置写 app.json 的 settingsPopoutWindow
    adv.addSetting((s) => s
      .setName(tt('setting.appearance.option-open-settings-in-window', '在新窗口中打开设置'))
      .setDesc(tt('setting.appearance.option-open-settings-in-window-description', '在独立窗口中打开设置，而不是嵌入在应用中。'))
      .addToggle((tog) => tog
        .setValue(app.settings.appSettings.settingsPopoutWindow !== false)
        .onChange((v) => {
          app.settings.updateAppSettings({ settingsPopoutWindow: v });
          const setting = app.setting;
          if (!setting) return;
          const tabId = (setting.activeTab && setting.activeTab.id) || setting.lastTabId || '';
          if (app.isSettingsWindow) {
            try { Desktop.settingsWindowToggle({ tabId }); } catch (e) {}
          } else {
            setting.close();
            setTimeout(() => { setting.open(); if (tabId) setting.openTabById(tabId); });
          }
        })));
  }

  /** 功能区子页面（原版 buildRibbonPage）：可见项可删除与拖拽，隐藏项在“未显示的按钮”分组恢复。 */
  openRibbonPage() {
    const app = this.app;
    const ws = app.workspace;
    this.setting.openPage({
      title: tt('setting.appearance.option-configure-ribbon', '功能区'),
      build: (contentEl) => {
        const registered = ws.getRibbonItems();
        const items = registered.slice().sort((a, b) => {
          if (a.el === b.el) return 0;
          return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
        const visible = items.filter((item) => !ws.isRibbonItemHidden(item.key));
        const group = new SettingGroup(contentEl);
        group.addClass('mod-list');
        visible.forEach((item, index) => {
          group.addSetting((s) => {
            s.setName(item.title);
            const iconEl = s.settingEl.createDiv('setting-item-icon');
            s.settingEl.prepend(iconEl);
            setIcon(iconEl, item.icon);
            const handle = s.controlEl.createDiv('clickable-icon extra-setting-button mod-drag-handle');
            handle.setAttr('aria-label', tt('interface.drag-to-rearrange', '拖动可调整布局'));
            setIcon(handle, 'lucide-menu');
            handle.setAttr('tabindex', '-1');
            const del = s.controlEl.createDiv('clickable-icon extra-setting-button');
            del.setAttr('aria-label', tt('interface.delete-action-short-name', '删除'));
            setIcon(del, 'lucide-x');
            del.addEventListener('click', () => {
              ws.setRibbonItemHidden(item.key, true);
              this.setting.closePage();
              this.openRibbonPage();
            });
            s.settingEl.setAttr('draggable', 'true');
            s.settingEl.addEventListener('dragstart', (ev) => {
              this._dragKey = item.key;
              s.settingEl.addClass('is-being-dragged');
              try { ev.dataTransfer.setData('text/plain', item.key); } catch (e) {}
            });
            s.settingEl.addEventListener('dragend', () => s.settingEl.removeClass('is-being-dragged'));
            s.settingEl.addEventListener('dragover', (ev) => {
              if (!this._dragKey) return;
              ev.preventDefault();
              s.settingEl.addClass('is-drop-target');
            });
            s.settingEl.addEventListener('dragleave', () => s.settingEl.removeClass('is-drop-target'));
            s.settingEl.addEventListener('drop', (ev) => {
              ev.preventDefault();
              s.settingEl.removeClass('is-drop-target');
              const from = this._dragKey;
              this._dragKey = null;
              if (!from || from === item.key) return;
              const keys = visible.map((i) => i.key);
              const fromIndex = keys.indexOf(from);
              const toIndex = keys.indexOf(item.key);
              if (fromIndex < 0 || toIndex < 0) return;
              keys.splice(fromIndex, 1);
              keys.splice(toIndex, 0, from);
              ws.setRibbonOrder(keys);
              this.setting.closePage();
              this.openRibbonPage();
            });
            void index;
          });
        });
        const hidden = items.filter((item) => ws.isRibbonItemHidden(item.key));
        if (!hidden.length) return;
        const hiddenGroup = new SettingGroup(contentEl);
        hiddenGroup.addClass('mod-list');
        hiddenGroup.setHeading(tt('setting.appearance.label-additional-ribbon-items', '未显示的按钮'));
        for (const item of hidden) {
          hiddenGroup.addSetting((s) => {
            s.setClass('mod-action');
            s.setClass('tappable');
            s.setName(item.title);
            const iconEl = s.settingEl.createDiv('setting-item-icon');
            s.settingEl.prepend(iconEl);
            setIcon(iconEl, item.icon);
            s.settingEl.addEventListener('click', () => {
              ws.setRibbonItemHidden(item.key, false);
              this.setting.closePage();
              this.openRibbonPage();
            });
          });
        }
      },
    });
  }
}

/* ------------------------------------------------------------------ helpers */

/** 原版 getAccentColor 的等价：读取未被自定义值覆盖的 --accent-h/s/l 并转 hex。 */
function computedAccentHex() {
  try {
    const styles = getComputedStyle(document.body);
    const h = parseFloat(styles.getPropertyValue('--accent-h'));
    const s = parseFloat(styles.getPropertyValue('--accent-s'));
    const l = parseFloat(styles.getPropertyValue('--accent-l'));
    if ([h, s, l].every((v) => Number.isFinite(v))) return hslToHex(h, s, l);
  } catch (e) {}
  return '#7f6df2';
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}
