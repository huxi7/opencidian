/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/setting.js 的 SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal；依赖 ../core/ipc.js 的 Desktop；Node 内置 fs/path；Electron renderer 的 webFrame/ipcRenderer
 * [OUTPUT]: 导出 AppearanceTab（外观页签）、FontManagerModal（字体管理弹窗）
 * [POS]: views/ 的外观设置页签。逐字对齐原版 Jee 的 display()：基础（基础颜色/主题色/主题）、界面（页内标题/标签页标题栏/功能区）、字体（三种字体/字号/快速调整）、高级（缩放/原生菜单/窗口边框/硬件加速）、CSS 代码片段。CSS 注入由 core/app.js 的 _applyCustomCss 执行，本页签只改配置与读取 snippets 目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Appearance settings tab — base theme, fonts, advanced desktop options, CSS snippets. */
import { tt } from '../core/i18n.js';
import { SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Modal } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';

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
        .map((entry) => entry.name);
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
      .setDesc(tt('setting.appearance.option-base-theme-description', '设置 Obsidian 的基础颜色。'))
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
        .setDesc(tt('setting.appearance.option-accent-color-description', '为 Obsidian 选择一个主题色。主题色将影响选中、链接等元素的颜色。'));
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
        .setValue(appearance.accentColor || '#7f6df2')
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
        for (const theme of themes) d.addOption(theme, theme);
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
      .addToggle((tog) => tog.setValue(app.settings.appearance.showRibbon !== false).onChange((v) => app.settings.updateAppearance({ showRibbon: v }))));

    /* ---------------------------------------------------------- 字体 */
    const fonts = new SettingGroup(this.containerEl).setHeading(tt('setting.appearance.option-font', '字体'));
    const addFontRow = (name, desc, key) => {
      fonts.addSetting((s) => {
        const current = String(appearance[key] || '').split(',').map((x) => x.trim()).filter(Boolean);
        s.setName(name);
        s.descEl.empty();
        s.descEl.appendText(desc);
        if (current.length === 1) {
          s.descEl.createSpan({ text: tt('setting.appearance.label-single-font-currently-in-effect', '当前使用的字体是：') });
          s.descEl.createSpan({ cls: 'u-pop', text: current[0] });
        } else if (current.length > 1) {
          s.descEl.createSpan({ text: tt('setting.appearance.label-multiple-fonts-currently-in-effect', '当前使用的字体是：') });
          const ul = s.descEl.createEl('ul');
          for (const font of current) ul.createEl('li', { text: font });
        }
        s.addButton((b) => b
          .setButtonText(tt('setting.appearance.option-theme-button-manage', '管理'))
          .onClick(() => new FontManagerModal(app, key, current, () => this.display()).open()));
      });
    };
    addFontRow(tt('setting.appearance.option-interface-font', '界面字体'), tt('setting.appearance.option-interface-font-description', '设置 Obsidian 界面字体。'), 'interfaceFontFamily');
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
      .addToggle((tog) => tog.setValue(app.settings.appearance.baseFontSizeAction !== false).onChange((v) => app.settings.updateAppearance({ baseFontSizeAction: v }))));

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
      .setDesc(tt('setting.appearance.option-native-menus-desc', 'Obsidian 中所有的菜单都会匹配操作系统，不会跟随主题样式'))
      .addToggle((tog) => tog.setValue(appearance.nativeMenus === true).onChange((v) => update({ nativeMenus: v }))));
    if (electron && electron.ipcRenderer) {
      let currentFrame = 'hidden';
      try { currentFrame = electron.ipcRenderer.sendSync('frame') || 'hidden'; } catch (e) {}
      adv.addSetting((s) => {
        let relaunchBtn = null;
        s.setName(tt('setting.appearance.option-frame-style', '窗口边框样式'))
          .setDesc(tt('setting.appearance.option-frame-description', '更改 Obsidian 窗口边框的样式。该设置重启应用后生效。'))
          .addButton((b) => {
            relaunchBtn = b;
            b.setCta().setButtonText(tt('setting.about.button-relaunch', '重新启动应用'));
            b.buttonEl.hide();
            b.onClick(() => { try { electron.ipcRenderer.sendSync('relaunch'); } catch (e) { location.reload(); } });
          })
          .addDropdown((d) => {
            d.addOption('hidden', tt('setting.appearance.option-frame-hidden', '隐藏（默认）'));
            d.addOption('custom', tt('setting.appearance.option-frame-obsidian', 'Obsidian 风格'));
            d.addOption('native', tt('setting.appearance.option-frame-native', '原生边框'));
            d.setValue(currentFrame);
            d.onChange((v) => {
              try { electron.ipcRenderer.sendSync('frame', v); } catch (e) {}
              relaunchBtn.buttonEl.show();
            });
          });
      });
      let gpuDisabled = false;
      try { gpuDisabled = !!electron.ipcRenderer.sendSync('disable-gpu'); } catch (e) {}
      adv.addSetting((s) => {
        let relaunchBtn = null;
        s.setName(tt('setting.about.option-hw-acceleration', '硬件加速'));
        s.descEl.empty();
        s.descEl.createDiv({ text: tt('setting.about.option-hw-acceleration-description', '开启硬件加速，即使用 GPU 让 Obsidian 运行更流畅。') });
        s.descEl.createDiv({ cls: 'mod-warning', text: tt('setting.about.option-hw-acceleration-warning', '如果关闭此选项，Obsidian 的性能将严重下降。') });
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
    for (const font of this.fonts) {
      listEl.createDiv('mobile-option-setting-item', (row) => {
        row.createSpan({ cls: 'mobile-option-setting-item-name', text: font });
        row.createDiv('clickable-icon mobile-option-setting-item-option-icon', (btn) => {
          btn.addEventListener('click', () => {
            this.fonts = this.fonts.filter((x) => x !== font);
            this.display();
          });
        });
      });
    }
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
