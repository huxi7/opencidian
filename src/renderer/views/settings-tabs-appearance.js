/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/setting.js 的 SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal；依赖 ../core/ipc.js 的 Desktop；Node 内置 fs/path；Electron renderer 的 webFrame/ipcRenderer
 * [OUTPUT]: 导出 AppearanceTab（外观页签）、FontManagerModal（字体管理弹窗）
 * [POS]: views/ 的外观设置页签。逐字对齐原版 Jee 的 display()：基础（基础颜色/主题色/主题）、界面（页内标题/标签页标题栏/功能区）、字体（三种字体/字号/快速调整）、高级（缩放/原生菜单/窗口边框/在新窗口中打开设置/硬件加速）、CSS 代码片段。CSS 注入由 core/app.js 的 _applyCustomCss 执行，本页签只改配置与读取 snippets 目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Appearance settings tab — base theme, fonts, advanced desktop options, CSS snippets. */
import { tt } from '../core/i18n.js';
import { SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Modal } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';
import { setIcon } from '../core/icons.js';
import { AbstractInputSuggest } from '../core/suggest.js';

const fs = require('fs');
const nodePath = require('path');

function electronModule() {
  try { return require('electron'); } catch (e) { return null; }
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

  listSnippets() {
    try {
      if (!fs.existsSync(this.snippetsDir)) return [];
      return fs.readdirSync(this.snippetsDir)
        .filter((name) => name.toLowerCase().endsWith('.css'))
        .map((name) => name.replace(/\.css$/i, ''));
    } catch (e) {
      return [];
    }
  }

  listThemes() {
    try {
      const dir = nodePath.join(this.app.settings.dir, 'themes');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          // 原版：旧主题目录只有 obsidian.css（没有 theme.css）→ 下拉显示 "name (Legacy)"
          let legacy = false;
          try {
            const themeDir = nodePath.join(dir, entry.name);
            legacy = fs.existsSync(nodePath.join(themeDir, 'obsidian.css')) && !fs.existsSync(nodePath.join(themeDir, 'theme.css'));
          } catch (e) {}
          return { name: entry.name, legacy };
        });
    } catch (e) {
      return [];
    }
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
      s.addExtraButton((b) => {
        b.setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => {
            update({ accentColor: '' });
            this.display();
          });
        if (!appearance.accentColor) b.extraSettingsEl.setAttr('aria-disabled', 'true');
      });
      s.addColorPicker((cp) => cp
        .setValue(appearance.accentColor || computedAccentHex())
        .onChange((v) => {
          update({ accentColor: v });
          this.display();
        }));
    });

    const themes = this.listThemes();
    base.addSetting((s) => s
      .setName(tt('setting.appearance.option-themes', '主题'))
      .setDesc(tt('setting.appearance.option-manage-themes-description', '管理已安装的主题，或浏览社区主题。'))
      .addExtraButton((b) => b
        .setIcon('lucide-folder-open')
        .setTooltip(tt('setting.appearance.button-open-themes-folder', '打开主题文件夹'))
        .onClick(() => this.openFolder(nodePath.join(app.settings.dir, 'themes'))))
      .addDropdown((d) => {
        d.addOption('', tt('setting.appearance.label-default-theme', '默认'));
        for (const theme of themes) {
          d.addOption(theme.name, theme.legacy ? theme.name + ' (Legacy)' : theme.name);
        }
        d.setValue(appearance.cssTheme || '');
        d.onChange((v) => update({ cssTheme: v }));
      }));
    base.addSetting((s) => s
      .setName(tt('setting.appearance.label-current-themes', '已安装主题'))
      .setDesc(tt('setting.appearance.label-currently-installed', '你目前已经安装了 {{count}} 个主题', { count: themes.length })));

    /* ---------------------------------------------------------- 界面 */
    const iface = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-interface', '界面'));
    iface.addSetting((s) => s
      .setName(tt('setting.editor.option-show-inline-title', '页内标题'))
      .setDesc(tt('setting.editor.option-show-inline-title-description', '将文件名作为可编辑的标题在文件内容中显示。'))
      .addToggle((tog) => tog.setValue(app.settings.appSettings.showInlineTitle !== false).onChange((v) => app.settings.updateAppSettings({ showInlineTitle: v }))));
    iface.addSetting((s) => s
      .setName(tt('setting.appearance.option-show-view-header', '显示标签页标题栏'))
      .setDesc(tt('setting.appearance.option-show-view-header-desc', '在每个标签页上方显示标题栏。'))
      .addToggle((tog) => tog.setValue(app.settings.appearance.showViewHeader !== false).onChange((v) => app.settings.updateAppearance({ showViewHeader: v }))));
    iface.addSetting((s) => s
      .setName(tt('setting.appearance.option-show-ribbon', '显示功能区'))
      .setDesc(tt('setting.appearance.option-show-ribbon-desc', '显示窗口最左侧的功能区，以便快速执行命令。'))
      .addToggle((tog) => tog.setValue(app.settings.appearance.showRibbon !== false).onChange((v) => {
        app.settings.updateAppearance({ showRibbon: v });
        this.display(); // 配置行随开关显隐（原版行为）
      })));
    if (app.settings.appearance.showRibbon !== false) {
      iface.addSetting((s) => s
        .setName(tt('setting.appearance.option-configure-ribbon', '功能区'))
        .setDesc(tt('setting.appearance.option-configure-ribbon-desc', '设置哪些命令需要显示在功能区上。'))
        .addButton((b) => b
          .setButtonText(tt('setting.appearance.option-theme-button-manage', '管理'))
          .onClick(() => new RibbonConfigModal(app).open())));
    }

    /* ---------------------------------------------------------- 字体 */
    const fonts = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-font', '字体'));
    const addFontRow = (name, desc, key) => {
      fonts.addSetting((s) => {
        const current = String(appearance[key] || '').split(',').map((x) => x.trim()).filter(Boolean);
        s.setName(name);
        s.descEl.empty();
        s.descEl.appendText(desc);
        const warnIfMissing = (host, font) => {
          if (fontExists(font)) return;
          const warn = host.createSpan({ cls: 'mod-warning' });
          setIcon(warn.createSpan('font-missing-icon'), 'lucide-alert-circle');
          warn.setAttr('aria-label', tt('setting.appearance.msg-font-not-found', '未找到 {{font}} 字体', { font }));
          warn.setAttr('data-tooltip-classes', 'mod-error');
          warn.createSpan({ text: ' ' + font });
        };
        if (current.length === 1) {
          s.descEl.createSpan({ text: tt('setting.appearance.label-single-font-currently-in-effect', '当前使用的字体是：') });
          if (fontExists(current[0])) s.descEl.createSpan({ cls: 'u-pop', text: current[0] });
          else warnIfMissing(s.descEl, current[0]);
        } else if (current.length > 1) {
          s.descEl.createSpan({ text: tt('setting.appearance.label-multiple-fonts-currently-in-effect', '当前使用的字体是：') });
          const ul = s.descEl.createEl('ul');
          for (const font of current) {
            const li = ul.createEl('li');
            if (fontExists(font)) li.setText(font);
            else warnIfMissing(li, font);
          }
        }
        s.addButton((b) => b
          .setButtonText(tt('setting.appearance.option-theme-button-manage', '管理'))
          .onClick(() => new FontManagerModal(app, key, current, () => this.display()).open()));
      });
    };
    addFontRow(tt('setting.appearance.option-interface-font', '界面字体'), tt('setting.appearance.option-interface-font-description', '设置 OpenSidian 界面字体。'), 'interfaceFontFamily');
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
      let slider = null;
      const webFrame = electron && electron.webFrame;
      const current = webFrame ? webFrame.getZoomLevel() : (appearance.zoomLevel || 0);
      const applyZoom = (v) => {
        if (webFrame) webFrame.setZoomLevel(v);
        app.settings.updateAppearance({ zoomLevel: v });
      };
      s.setName(tt('setting.appearance.option-zoom-level', '缩放比例'))
        .setDesc(tt('setting.appearance.option-zoom-level-description', '控制应用程序的整体缩放比例'))
        .addExtraButton((b) => b
          .setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => { applyZoom(0); if (slider) slider.setValue(0); }))
        .addSlider((sl) => {
          slider = sl;
          sl.setLimits(-2.5, 3, 0.5).setDynamicTooltip().setValue(current).onChange((v) => applyZoom(v));
          sl.getValuePretty = () => Math.round(100 * Math.pow(1.2, sl.getValue())) + '%';
        });
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
      // 原版 1.14.4：高级组的「在新窗口中打开设置」开关（Qy.canPopoutWindow 恒真于桌面）。
      // 切换行为对齐原版：写配置后 setting.close(); setTimeout(() => { setting.open(); setting.openTab(tab) })
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
              // 本渲染器即设置窗口：交主进程关窗并在主窗口以模态重开（跨窗口 close→open）
              try { Desktop.settingsWindowToggle({ tabId }); } catch (e) {}
            } else {
              setting.close();
              setTimeout(() => { setting.open(); if (tabId) setting.openTabById(tabId); });
            }
          })));
      let gpuDisabled = false;
      try { gpuDisabled = !!electron.ipcRenderer.sendSync('disable-gpu'); } catch (e) {}
      adv.addSetting((s) => {
        let relaunchBtn = null;
        s.setName(tt('setting.about.option-hw-acceleration', '硬件加速'));
        s.descEl.empty();
        s.descEl.createDiv({ text: tt('setting.about.option-hw-acceleration-description', '开启硬件加速，即使用 GPU 让 OpenSidian 运行更流畅。') });
        s.descEl.createDiv({ cls: 'mod-warning', text: tt('setting.about.option-hw-acceleration-warning', '如果关闭此选项，OpenSidian 的性能将严重下降。') });
        s.addButton((b) => {
          relaunchBtn = b;
          b.setCta().setButtonText(tt('setting.about.button-relaunch', '重新启动应用'));
          b.buttonEl.hide();
          b.onClick(() => { try { electron.ipcRenderer.sendSync('relaunch'); } catch (e) { location.reload(); } });
        });
        s.addToggle((tog) => tog.setValue(!gpuDisabled).onChange((v) => {
          const disabled = !v;
          try { electron.ipcRenderer.sendSync('disable-gpu', disabled); } catch (e) {}
          relaunchBtn.buttonEl.toggle(disabled !== gpuDisabled);
        }));
      });
      adv.addSetting((s) => {
        let relaunchBtn = null;
        const renderDesc = () => {
          s.descEl.empty();
          const icon = (() => { try { return Desktop.getIcon(); } catch (e) { return null; } })();
          if (icon && icon.dataUrl) s.descEl.createEl('img', { attr: { width: '64', height: '64', src: icon.dataUrl } });
          else s.descEl.appendText(tt('setting.appearance.option-custom-icon-desc', '给应用设置一个自定义的图标'));
        };
        s.setName(tt('setting.appearance.option-custom-icon', '自定义应用图标'));
        renderDesc();
        s.addExtraButton((b) => b
          .setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => {
            try { Desktop.setIcon(null); } catch (e) {}
            renderDesc();
            if (relaunchBtn) relaunchBtn.buttonEl.show();
          }));
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
    }

    /* ---------------------------------------------------------- CSS 代码片段 */
    const snippets = this.listSnippets();
    const enabled = new Set(appearance.enabledCssSnippets || []);
    const cssGroup = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-css-snippets', 'CSS 代码片段'));
    cssGroup.addExtraButton((b) => b
      .setIcon('lucide-refresh-cw')
      .setTooltip(tt('setting.appearance.button-reload-snippets', '重新加载代码片段'))
      .onClick(() => {
        app._applyCustomCss();
        new Notice(tt('setting.appearance.msg-reloaded-snippets', '重新加载 CSS 代码片段'));
        this.display();
      }));
    cssGroup.addExtraButton((b) => b
      .setIcon('lucide-folder-open')
      .setTooltip(tt('setting.appearance.button-open-snippets-folder', '打开代码片段文件夹'))
      .onClick(() => this.openFolder(this.snippetsDir)));
    if (!snippets.length) {
      cssGroup.addSetting((s) => s
        .setName(tt('setting.appearance.label-no-css-snippets-found', '没有在代码片段文件夹中发现 CSS 代码片段。'))
        .setDesc(tt('setting.appearance.no-snippet-description', 'CSS 代码片段的存放路径为：“{{path}}”。', { path: 'vault/.obsidian/snippets' })));
    }
    for (const name of snippets) {
      cssGroup.addSetting((s) => s
        .setName(name)
        .setDesc(tt('setting.appearance.option-toggle-snippet-description', '应用当前代码片段。', { path: 'vault/.obsidian/snippets/' + name + '.css' }))
        .addToggle((tog) => tog.setValue(enabled.has(name)).onChange((v) => {
          const next = new Set(app.settings.appearance.enabledCssSnippets || []);
          if (v) next.add(name); else next.delete(name);
          app.settings.updateAppearance({ enabledCssSnippets: [...next] });
        })));
    }
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

/** 功能区配置弹窗（原版 Zee）：当前按钮可隐藏/拖拽排序，未显示按钮可恢复。 */
class RibbonConfigModal extends Modal {
  constructor(app) {
    super(app);
    this.modalEl.addClass('mod-lg');
    this.setTitle(tt('setting.appearance.label-modal-configuration', '功能区设置'));
  }
  onOpen() { this.render(); }
  render() {
    const container = this.contentEl;
    container.empty();
    const ws = this.app.workspace;
    const items = ws.getRibbonItems();
    container.createEl('p', { text: tt('setting.appearance.option-configure-ribbon-desc', '设置哪些命令需要显示在功能区上。') });
    const active = items.filter((item) => !ws.isRibbonItemHidden(item.key));
    const listEl = container.createDiv('ribbon-config-list');
    for (const item of active) {
      const row = listEl.createDiv('mobile-option-setting-item ribbon-config-item');
      row.setAttr('draggable', 'true');
      const remove = row.createSpan('mobile-option-setting-item-remove-icon clickable-icon');
      setIcon(remove, 'lucide-minus-circle');
      remove.onclick = () => { ws.setRibbonItemHidden(item.key, true); this.render(); };
      const iconEl = row.createSpan('mobile-option-setting-item-option-icon');
      setIcon(iconEl, item.icon);
      row.createSpan({ cls: 'mobile-option-setting-item-name', text: item.title });
      const handle = row.createDiv('clickable-icon mobile-option-setting-item-option-icon ribbon-config-drag');
      setIcon(handle, 'lucide-menu');
      row.ondragstart = (ev) => {
        this._dragKey = item.key;
        row.addClass('is-being-dragged');
        try { ev.dataTransfer.setData('text/plain', item.key); } catch (e) {}
      };
      row.ondragend = () => { row.removeClass('is-being-dragged'); };
      row.ondragover = (ev) => { if (this._dragKey) { ev.preventDefault(); row.addClass('is-drop-target'); } };
      row.ondragleave = () => row.removeClass('is-drop-target');
      row.ondrop = (ev) => {
        ev.preventDefault();
        row.removeClass('is-drop-target');
        const from = this._dragKey;
        this._dragKey = null;
        if (!from || from === item.key) return;
        const keys = active.map((i) => i.key);
        const fromIndex = keys.indexOf(from);
        if (fromIndex < 0) return;
        keys.splice(fromIndex, 1);
        const toIndex = keys.indexOf(item.key);
        keys.splice(toIndex < 0 ? keys.length : toIndex, 0, from);
        ws.setRibbonOrder(keys);
        this.render();
      };
    }
    const hidden = items.filter((item) => ws.isRibbonItemHidden(item.key));
    if (hidden.length) {
      const group = container.createDiv('ribbon-config-hidden');
      const heading = group.createDiv('setting-item-heading');
      heading.createDiv('setting-item-name').setText(tt('setting.appearance.label-additional-ribbon-items', '未显示的按钮'));
      for (const item of hidden) {
        const row = group.createDiv('mobile-option-setting-item ribbon-config-item');
        const add = row.createSpan('mobile-option-setting-item-add-icon clickable-icon');
        setIcon(add, 'lucide-plus-circle');
        add.onclick = () => { ws.setRibbonItemHidden(item.key, false); this.render(); };
        const iconEl = row.createSpan('mobile-option-setting-item-option-icon');
        setIcon(iconEl, item.icon);
        row.createSpan({ cls: 'mobile-option-setting-item-name', text: item.title });
      }
    }
    const buttons = container.createDiv('modal-button-container');
    buttons.createEl('button', { cls: 'mod-cta', text: tt('dialogue.button-done', '完成') })
      .addEventListener('click', () => this.close());
  }
}

/** 字体管理弹窗：列表（可删除）+ 输入添加 + 保存。对齐原版 Vee 的简化版。 */
class FontManagerModal extends Modal {
  constructor(app, key, current, onDone) {
    super(app);
    this.app = app;
    this.key = key;
    this.fonts = [...current];
    this.onDone = onDone;
    this.setTitle(tt('setting.appearance.label-font-name', '字体名称'));
  }

  onOpen() {
    this.display();
  }

  display() {
    const container = this.contentEl;
    container.empty();
    const listEl = container.createDiv('font-manager-list');
    this.fonts.forEach((font, index) => {
      const exists = fontExists(font);
      const row = listEl.createDiv('mobile-option-setting-item font-manager-item');
      row.setAttr('draggable', 'true');
      const handle = row.createDiv('clickable-icon font-manager-drag-handle');
      setIcon(handle, 'lucide-menu');
      row.createSpan({ cls: 'mobile-option-setting-item-name', text: font });
      const indicator = row.createDiv('font-manager-item-indicator ' + (exists ? 'mod-success' : 'mod-warning'));
      setIcon(indicator, exists ? 'lucide-check-circle-2' : 'lucide-alert-circle');
      if (!exists) {
        indicator.setAttr('aria-label', tt('setting.appearance.msg-font-not-found', '未找到 {{font}} 字体', { font }));
        indicator.setAttr('data-tooltip-classes', 'mod-error');
      }
      const btn = row.createDiv('clickable-icon mobile-option-setting-item-option-icon');
      setIcon(btn, 'lucide-x');
      btn.addEventListener('click', () => {
        this.fonts = this.fonts.filter((x) => x !== font);
        this.display();
      });
      // 原版：lucide-menu 手柄拖拽重排
      row.ondragstart = (ev) => {
        this._dragIndex = index;
        row.addClass('is-being-dragged');
        try { ev.dataTransfer.setData('text/plain', font); } catch (e) {}
      };
      row.ondragend = () => { row.removeClass('is-being-dragged'); };
      row.ondragover = (ev) => { if (this._dragIndex == null) return; ev.preventDefault(); row.addClass('is-drop-target'); };
      row.ondragleave = () => row.removeClass('is-drop-target');
      row.ondrop = (ev) => {
        ev.preventDefault();
        row.removeClass('is-drop-target');
        const from = this._dragIndex;
        this._dragIndex = null;
        if (from == null || from === index) return;
        const [moved] = this.fonts.splice(from, 1);
        this.fonts.splice(index, 0, moved);
        this.display();
      };
    });
    if (!this.fonts.length) {
      container.createEl('p', { text: tt('setting.appearance.label-no-custom-font-set', '当前未指定自定义字体。请在下方添加一个。') });
    }
    container.createEl('p', { text: tt('setting.appearance.label-font-applied', '列表中第一种字体将被应用。') });
    const addRow = container.createDiv('modal-button-container');
    const input = addRow.createEl('input', {
      type: 'text',
      attr: { placeholder: tt('setting.appearance.option-font-placeholder', '请输入字体名称…') },
    });
    input.style.flex = '1';
    new FontSuggest(this.app, input);
    const add = () => {
      const value = input.value.trim();
      if (!value) return;
      this.fonts.push(value);
      input.value = '';
      this.display();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); add(); }
    });
    addRow.createEl('button', { text: tt('interface.button-add', '添加') }).addEventListener('click', add);
    const buttons = container.createDiv('modal-button-container');
    buttons.createEl('button', { text: tt('dialogue.button-cancel', '取消') }).addEventListener('click', () => this.close());
    buttons.createEl('button', { cls: 'mod-cta', text: tt('dialogue.button-save', '保存') }).addEventListener('click', () => {
      this.app.settings.updateAppearance({ [this.key]: this.fonts.join(',') });
      this.close();
      this.onDone && this.onDone();
    });
  }
}

/* ------------------------------------------------------------------ helpers */

/**
 * 字体是否存在（原版字体检测的等价实现）。
 * Chromium 的 document.fonts.check 对未知族也返回 true，这里用“与回退字体测量宽度对比”判定：
 * 未知字体在所有回退族下的宽度都与回退一致；已安装/已加载字体至少一个回退下的宽度不同。
 */
const fontExistsCache = new Map();
function fontExists(font) {
  try {
    if (!font) return false;
    const family = String(font).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!family) return false;
    if (fontExistsCache.has(family)) return fontExistsCache.get(family);
    const probe = document.createElement('span');
    probe.textContent = 'mmmmmmmmmmlli';
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;font-size:72px;white-space:nowrap;visibility:hidden;';
    document.body.appendChild(probe);
    let exists = false;
    try {
      for (const fallback of ['monospace', 'sans-serif', 'serif']) {
        probe.style.fontFamily = fallback;
        const baseWidth = probe.offsetWidth;
        probe.style.fontFamily = '"' + family.replace(/"/g, '') + '",' + fallback;
        if (probe.offsetWidth !== baseWidth) { exists = true; break; }
      }
    } finally {
      probe.remove();
    }
    fontExistsCache.set(family, exists);
    return exists;
  } catch (e) {}
  return true;
}

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

/** 字体名建议：已加载字体 + 常见字体族。 */
class FontSuggest extends AbstractInputSuggest {
  getSuggestions(query) {
    const q = String(query || '').toLowerCase();
    const common = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia',
      'Menlo', 'Monaco', 'JetBrains Mono', 'Fira Code', 'Source Code Pro',
      'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'SimSun', 'Noto Sans', 'Roboto'];
    const loaded = [];
    try { if (document.fonts) for (const face of document.fonts) loaded.push(String(face.family).replace(/^"|"$/g, '')); } catch (e) {}
    const all = [...new Set([...loaded, ...common])];
    return all.filter((name) => !q || name.toLowerCase().includes(q)).slice(0, 30);
  }
  renderSuggestion(value, el) { el.setText(value); }
  selectSuggestion(value) {
    this.inputEl.value = value;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}
