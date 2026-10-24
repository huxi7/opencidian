/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt/getLanguage/setLanguage；依赖 ../core/setting.js 的 SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop/ipcSync；依赖 ../core/update-check.js 的 checkForUpdates；依赖 ../core/icons.js 的 setIcon；依赖 ./settings-tabs-dialogs.js 的 VERSION/StartupTimeModal/VimTestModal/AddExcludedFilterModal/SpellcheckDictModal/trackSliderFill/isRegexFilterValue/FilePathSuggest/FolderPathSuggest
 * [OUTPUT]: 导出 AboutTab、EditorTab、FileTab 三个内置页签类
 * [POS]: views/ 的内置设置页签（选项组）。逐字对齐原版 O7/nte/lte 的 display()：关于（版本/检查更新/语言/高级+启动耗时弹窗/硬件加速）、编辑器（行为+拼写检查词典/语言+Vim 验证）、文件与链接（打开行为/新建位置/附件/链接/回收站/忽略文件子页面/重建缓存）。文案走 tt() 兜底，配置写 app.settings.updateAppSettings（app.json）与 updateAppearance（appearance.json）；拼写检查词典/语言经 Desktop IPC 读写主进程。硬件加速不落库：由主进程 disable-gpu 通道持有，改动后显示“重新启动应用”。默认编辑模式行按原版带 aliases（live-preview/source），供设置侧栏全局搜索匹配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Built-in settings tabs: About / Editor / File & Links. */
import { tt, getLanguage, setLanguage } from '../core/i18n.js';
import { SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Desktop, ipcSync } from '../core/ipc.js';
import { checkForUpdates, compareVersions } from '../core/update-check.js';
import { setIcon } from '../core/icons.js';
import {
  VERSION,
  StartupTimeModal,
  VimTestModal,
  AddExcludedFilterModal,
  SpellcheckDictModal,
  trackSliderFill,
  isRegexFilterValue,
  FilePathSuggest,
  FolderPathSuggest,
} from './settings-tabs-dialogs.js';

const IS_MAC = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

function electronModule() {
  try { return require('electron'); } catch (e) { return null; }
}

/* ------------------------------------------------------------------- About */

export class AboutTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.about.name', '关于');
    this.id = 'about';
    this.icon = 'circle-user';
  }

  display() {
    const app = this.app;
    this.containerEl.empty();
    const group = new SettingGroup(this.containerEl);

    // 原版：版本行 = 名称「版本 x」+ 描述「安装程序版本: x」+ 更新日志链接 + “检查更新”按钮。
    // 原版按钮点击后向主进程发 check-update 并轮询“是否检查中”；本复刻主进程无更新器，
    // 落回渲染层版本比较（core/update-check.js），结果写进描述与“可以更新”行。
    let updateRow = null;
    let updateUrl = '';
    group.addSetting((s) => {
      s.setName(tt('setting.about.label-version', '版本 {{version}}', { version: VERSION }));
      s.descEl.empty();
      s.descEl.appendText(tt('setting.about.label-install-version', '安装程序版本: {{version}}', { version: VERSION }));
      s.descEl.createEl('br');
      s.descEl.createEl('a', {
        text: tt('setting.about.label-read-changelog', '阅读更新日志'),
        attr: { href: 'https://obsidian.md/changelog', target: '_blank', rel: 'noopener' },
      });
      s.addButton((b) => {
        b.setButtonText(tt('setting.about.button-check-for-updates', '检查更新'));
        b.onClick(async () => {
          b.buttonEl.addClass('mod-loading');
          try {
            await this.pollMainProcessCheck();
            const result = await this.runUpdateCheck();
            if (result.hasUpdate) {
              updateUrl = result.url || '';
              if (updateRow) updateRow.settingEl.show();
            } else if (updateRow) {
              updateRow.settingEl.hide();
            }
          } finally {
            b.buttonEl.removeClass('mod-loading');
          }
        });
      });
    });

    // 原版「可以更新」行：仅在有可用更新时出现，带“下载”按钮打开下载页。
    group.addSetting((s) => {
      updateRow = s;
      s.setName(tt('interface.label-update-available', '可以更新'));
      s.descEl.empty();
      s.descEl.appendText(tt('setting.about.label-manual-update-required', 'OpenSidian 需要进行一次较大的更新来获取最新功能和安全补丁。为此，你需要手动下载安装包并重新安装 OpenSidian。'));
      s.descEl.createEl('br');
      s.descEl.createEl('a', {
        text: tt('interface.button-learn-more', '了解更多'),
        attr: { href: 'https://help.obsidian.md/updates', target: '_blank', rel: 'noopener' },
      });
      s.addButton((b) => b
        .setButtonText(tt('dialogue.button-download', '下载'))
        .onClick(() => { if (updateUrl) Desktop.openExternal(updateUrl); }));
      s.settingEl.hide();
    });

    group.addSetting((s) => s
      .setName(tt('setting.about.option-auto-update', '自动更新'))
      .setDesc(tt('setting.about.option-auto-update-description', '关闭后 OpenSidian 将不会自动更新。'))
      .addToggle((tog) => tog.setValue(localStorage.getItem('disable-update') !== '1').onChange((v) => {
        try {
          if (v) localStorage.removeItem('disable-update');
          else localStorage.setItem('disable-update', '1');
        } catch (e) {}
      })));

    group.addSetting((s) => {
      s.setName(tt('setting.about.option-language', '语言'));
      s.descEl.appendText(tt('setting.about.option-language-description', '更改界面语言。'));
      s.descEl.createEl('br');
      s.descEl.createEl('a', {
        text: tt('setting.about.label-add-own-language', '显示如何给 OpenSidian 添加你的母语'),
        attr: { href: 'https://help.obsidian.md/Translations', target: '_blank', rel: 'noopener' },
      });
      const current = getLanguage() === 'zh' ? 'zh' : 'en';
      let pending = null;
      let relaunchBtn = null;
      s.addButton((b) => {
        relaunchBtn = b;
        b.setCta().setButtonText(tt('setting.about.button-relaunch', '重新启动应用'));
        b.buttonEl.hide();
        b.onClick(() => {
          if (pending) setLanguage(pending);
          location.reload();
        });
      });
      s.addDropdown((d) => {
        d.addOption('en', 'English');
        d.addOption('zh', '简体中文');
        d.setValue(current);
        d.onChange((v) => {
          pending = v;
          relaunchBtn.buttonEl.toggle(v !== current);
        });
      });
    });

    group.addSetting((s) => s
      .setName(tt('setting.about.option-get-help', '获取帮助'))
      .setDesc(tt('setting.about.option-get-help-description', '获取关于使用 OpenSidian 的帮助。'))
      .addButton((b) => b.setButtonText(tt('setting.about.button-open', '打开')).onClick(() => {
        this.setting.close();
        Desktop.openExternal('https://help.obsidian.md/');
      })));

    const adv = new SettingGroup(this.containerEl).setHeading(tt('setting.about.option-advanced', '高级'));
    adv.addSetting((s) => s
      .setName(tt('setting.about.option-check-slow-startup', '应用启动缓慢时进行通知'))
      .setDesc(tt('setting.about.option-check-slow-startup-description', '通过查看导致应用加载缓慢的原因来诊断问题。'))
      .addExtraButton((b) => b
        .setIcon('lucide-timer')
        .setTooltip(tt('setting.about.button-check-startup', '立即检查'))
        .onClick(() => new StartupTimeModal(app).open()))
      .addToggle((tog) => tog.setValue(localStorage.getItem('slow-startup-check') === '1').onChange((v) => {
        try {
          if (v) localStorage.setItem('slow-startup-check', '1');
          else localStorage.removeItem('slow-startup-check');
        } catch (e) {}
      })));
    const electron = electronModule();
    if (electron && electron.ipcRenderer) {
      let gpuDisabled = false;
      try { gpuDisabled = !!electron.ipcRenderer.sendSync('disable-gpu'); } catch (e) {}
      adv.addSetting((s) => {
        let relaunchBtn = null;
        s.setName(tt('setting.about.option-hw-acceleration', '硬件加速'));
        s.descEl.empty();
        const desc = s.descEl.createDiv();
        desc.appendText(tt('setting.about.option-hw-acceleration-description', '开启硬件加速，即使用 GPU 让 OpenSidian 运行更流畅。') + ' ');
        desc.createSpan({ cls: 'mod-warning', text: tt('setting.about.option-hw-acceleration-warning', '如果关闭此选项，OpenSidian 的性能将严重下降。') });
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
  }

  /**
   * 原版 1.14.4 的 check-update 通道返回“主进程是否正在检查更新”，渲染层每秒轮询直到结束。
   * 本复刻主进程只提供通道不实现更新器，返回 false 时立即结束。
   */
  async pollMainProcessCheck() {
    let pending = false;
    try { pending = !!ipcSync('check-update'); } catch (e) { pending = false; }
    for (let i = 0; i < 20 && pending; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try { pending = !!ipcSync('check-update'); } catch (e) { pending = false; }
    }
    return pending;
  }

  /**
   * 渲染层版本比较：复用 core/update-check.js 的抓取与解析，版本基准取本应用 VERSION。
   * 结果：{ hasUpdate, version, url }；无更新源/检查失败时弹出提示并返回 hasUpdate=false。
   */
  async runUpdateCheck() {
    // 以 VERSION 为比较基准：用一个继承 app 的轻量代理覆盖 getVersion，
    // 复用 core/update-check.js 的抓取与解析，不重复实现更新源协议。
    const proxy = Object.create(this.app);
    proxy.getVersion = () => VERSION;
    const result = await checkForUpdates(proxy, { silent: true });
    if (result.status === 'no-feed') {
      new Notice(tt('interface.update.no-feed', '尚未配置更新源：在设置文件中填写 updateFeed（GitHub Releases API 或静态 JSON 地址）。'), 6000);
      return { hasUpdate: false, version: '', url: '' };
    }
    if (result.status === 'error') {
      new Notice(tt('interface.update.check-failed', '无法检查更新，请检查网络或更新源地址。'), 6000);
      return { hasUpdate: false, version: '', url: '' };
    }
    const latest = String(result.version || '');
    const hasUpdate = !!latest && compareVersions(latest, VERSION) > 0;
    if (hasUpdate) {
      const notice = new Notice(tt('interface.update.available', '发现新版本 {{version}}（当前 {{current}}）', {
        version: latest, current: VERSION,
      }), 12000);
      if (result.url && notice.addButton) {
        notice.addButton(tt('setting.appearance.button-update', '更新'), () => {
          try { Desktop.openExternal(result.url); } catch (e) { console.error(e); }
        });
      }
    } else {
      new Notice(tt('interface.update.latest', '已是最新版本（{{current}}）。', { current: VERSION }), 4000);
    }
    return { hasUpdate, version: latest, url: result.url || '' };
  }
}

/* ------------------------------------------------------------------ Editor */

export class EditorTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.editor.name', '编辑器');
    this.id = 'editor';
    this.icon = 'pen-line';
    this.passedVimTest = false;
  }

  display() {
    const app = this.app;
    const settings = app.settings.appSettings;
    const update = (patch) => app.settings.updateAppSettings(patch);
    this.containerEl.empty();

    const group = new SettingGroup(this.containerEl);
    group.addSetting((s) => s
      .setName(tt('setting.editor.option-default-new-tab-view', '新标签页的默认视图'))
      .setDesc(tt('setting.editor.option-default-new-tab-view-description', '设置新标签页的默认视图模式。'))
      .addDropdown((d) => {
        d.addOption('source', tt('setting.editor.option-default-new-tab-view-editing', '编辑视图'));
        d.addOption('preview', tt('setting.editor.option-default-new-tab-view-reading', '阅读视图'));
        d.setValue(settings.defaultViewMode === 'preview' ? 'preview' : 'source');
        d.onChange((v) => update({ defaultViewMode: v }));
      }));
    group.addSetting((s) => {
      s.setName(tt('setting.editor.option-default-editing-mode', '默认编辑模式'))
        .setDesc(tt('setting.editor.option-default-editing-mode-description', '在编辑视图下，新标签页默认采用的编辑模式。'));
      // 原版 aliases：live-preview / source
      this.setting.setSettingAliases(s, ['live-preview', 'source']);
      s.addDropdown((d) => {
        d.addOption('live-preview', tt('setting.editor.option-default-editing-mode-live-preview', '实时预览'));
        d.addOption('source', tt('setting.editor.option-default-editing-mode-source', '源码模式'));
        d.setValue(settings.livePreview === false ? 'source' : 'live-preview');
        d.onChange((v) => {
          update({ livePreview: v === 'live-preview' });
          // 原版语义：已打开的编辑态 markdown 叶子一并同步（阅读态叶子保持阅读态）
          const mode = v === 'live-preview' ? 'live' : 'source';
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const state = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
            if (!state || (state.mode !== 'source' && state.mode !== 'live') || state.mode === mode) continue;
            state.mode = mode;
            leaf.setViewState({ type: 'markdown', state });
          }
        });
      });
    });
    group.addSetting((s) => {
      const entry = app.plugins.getInternalPlugin('editor-status');
      s.setName(tt('plugins.editor-status.name', '视图状态'))
        .setDesc(tt('plugins.editor-status.desc', ''))
        .addToggle((tog) => tog.setValue(!!(entry && entry.enabled)).onChange(async (v) => {
          if (v) await app.plugins.enableInternalPlugin('editor-status');
          else await app.plugins.disableInternalPlugin('editor-status');
        }));
    });

    const display = new SettingGroup(this.containerEl).setHeading(tt('setting.editor.section-display', '显示'));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-show-inline-title', '页内标题'))
      .setDesc(tt('setting.editor.option-show-inline-title-description', '将文件名作为可编辑的标题在文件内容中显示。'))
      .addToggle((tog) => tog.setValue(settings.showInlineTitle !== false).onChange((v) => update({ showInlineTitle: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-readable-line-length', '限制行宽'))
      .setDesc(tt('setting.editor.option-readable-line-description', '开启后将限制每行显示的字数，使屏幕显示的内容减少，但使较长的段落更具可读性。'))
      .addToggle((tog) => tog.setValue(settings.readableLineLength !== false).onChange((v) => update({ readableLineLength: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-strict-line-break', '严格换行'))
      .setDesc(tt('setting.editor.option-strict-line-break-description', '开启后，根据 Markdown 标准，单个换行符在预览模式下不再生效（无法实际换行）。'))
      .addToggle((tog) => tog.setValue(settings.strictLineBreaks === true).onChange((v) => update({ strictLineBreaks: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-properties-in-document', '笔记属性'))
      .setDesc(tt('setting.editor.option-properties-in-document-description', '选择笔记属性在编辑器中的显示方式。选择 “源码” 时，将以 YAML 格式显示笔记属性。'))
      .addDropdown((d) => {
        d.addOption('visible', tt('setting.editor.option-properties-visible', '显示'));
        d.addOption('hidden', tt('setting.editor.option-properties-hidden', '隐藏'));
        d.addOption('source', tt('setting.editor.option-properties-source', '源码'));
        d.setValue(settings.propertiesInDocument || 'visible');
        d.onChange((v) => update({ propertiesInDocument: v }));
      }));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-fold-heading', '折叠标题'))
      .setDesc(tt('setting.editor.option-fold-heading-description', '开启后可以将正文内容折叠到标题行。'))
      .addToggle((tog) => tog.setValue(settings.foldHeading !== false).onChange((v) => update({ foldHeading: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-fold-indent', '折叠缩进'))
      .setDesc(tt('setting.editor.option-fold-indent-description', '开启后可以将缩进内容（如列表）折叠起来。'))
      .addToggle((tog) => tog.setValue(settings.foldIndent !== false).onChange((v) => update({ foldIndent: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-show-line-number', '行号'))
      .setDesc(tt('setting.editor.option-show-line-number-description', '在左侧显示行号。'))
      .addToggle((tog) => tog.setValue(settings.showLineNumber === true).onChange((v) => update({ showLineNumber: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-indentation-guide', '缩进参考线'))
      .setDesc(tt('setting.editor.option-indentation-guide-description', '在缩进的行之间显示参考线。'))
      .addToggle((tog) => tog.setValue(settings.showIndentGuide === true).onChange((v) => update({ showIndentGuide: v }))));
    display.addSetting((s) => s
      .setName(tt('setting.editor.option-rtl', '从右到左'))
      .setDesc(tt('setting.editor.option-rtl-description', '将文字的默认文本方向设置为从右到左。'))
      .addToggle((tog) => tog.setValue(settings.rightToLeft === true).onChange((v) => update({ rightToLeft: v }))));

    const behavior = new SettingGroup(this.containerEl).setHeading(tt('setting.editor.section-behavior', '行为'));
    behavior.addSetting((s) => s
      .setName(tt('setting.editor.option-spellcheck', '拼写检查'))
      .setDesc(tt('setting.editor.option-spellcheck-description', '打开拼写检查器。'))
      .addExtraButton((b) => b
        .setIcon('lucide-book-open')
        .setTooltip(tt('setting.editor.spellcheck-dict', '拼写检查词典'))
        .onClick(() => new SpellcheckDictModal(app).open()))
      .addToggle((tog) => tog.setValue(settings.spellcheck === true).onChange((v) => update({ spellcheck: v }))));
    behavior.addSetting((s) => {
      s.setName(tt('setting.editor.spellcheck-languages', '拼写检查语言'))
        .setDesc(IS_MAC
          ? tt('setting.editor.spellcheck-languages-mac-description', '本地的拼写检查器将自动检测你当前所使用的语言。')
          : tt('setting.editor.spellcheck-languages-description', '选择需要检查拼写的语言。'));
      const displayName = (lang) => {
        try { return new Intl.DisplayNames([getLanguage()], { type: 'language' }).of(lang) || lang; } catch (e) { return lang; }
      };
      const renderLanguages = () => {
        const info = (() => { try { return Desktop.spellcheckLanguages() || {}; } catch (e) { return {}; } })();
        const available = Array.isArray(info.available) ? info.available : [];
        const active = Array.isArray(info.active) ? info.active : [];
        const custom = Array.isArray(info.current) ? [...info.current] : null;
        const apply = (languages) => { try { Desktop.spellcheckLanguagesSet(languages); } catch (e) {} renderLanguages(); };
        s.controlEl.empty();
        const row = s.controlEl.createDiv('setting-command-hotkeys');
        if (custom) {
          const languages = custom.map((lang) => ({
            lang,
            display: displayName(lang) + (available.includes(lang) || !available.length ? '' : ' (Not available)'),
          })).sort((a, b) => a.display.localeCompare(b.display));
          for (const item of languages) {
            row.createSpan({ cls: 'setting-hotkey', text: item.display }).createSpan('setting-hotkey-icon', (remove) => {
              setIcon(remove, 'lucide-x');
              remove.addEventListener('click', () => apply(custom.filter((lang) => lang !== item.lang)));
            });
          }
          s.controlEl.createSpan('clickable-icon setting-restore-hotkey-button', (restore) => {
            setIcon(restore, 'lucide-rotate-ccw');
            restore.setAttr('aria-label', tt('setting.hotkeys.tooltip-restore-default', '恢复默认'));
            restore.addEventListener('click', () => apply(null));
          });
        } else {
          const current = active[0] || navigator.language || 'en';
          row.createSpan({ cls: 'setting-hotkey', text: displayName(current) });
        }
        const select = s.controlEl.createEl('select', { cls: 'dropdown' });
        select.style.width = '80px';
        select.createEl('option', { value: '', text: '+' });
        const options = available.map((lang) => ({ lang, display: displayName(lang) }))
          .sort((a, b) => a.display.localeCompare(b.display));
        for (const option of options) select.createEl('option', { value: option.lang, text: option.display });
        select.addEventListener('change', () => {
          if (!select.value) return;
          const next = custom ? [...custom] : [active[0] || navigator.language || 'en'];
          if (!next.includes(select.value)) next.push(select.value);
          apply(next);
        });
      };
      // 原版 macOS 走系统拼写检查器：只显示描述，不渲染语言胶囊与下拉。
      if (!IS_MAC) renderLanguages();
    });
    behavior.addSetting((s) => s
      .setName(tt('setting.editor.option-auto-pair-brackets', '自动补全英文标点符号'))
      .setDesc(tt('setting.editor.option-auto-pair-brackets-description', '自动补全英文括号和引号。'))
      .addToggle((tog) => tog.setValue(settings.autoPairBrackets !== false).onChange((v) => update({ autoPairBrackets: v }))));
    behavior.addSetting((s) => s
      .setName(tt('setting.editor.option-auto-pair-markdown', '自动补全 Markdown 语法'))
      .setDesc(tt('setting.editor.option-auto-pair-markdown-description', '自动补全表示粗体和斜体的标记。'))
      .addToggle((tog) => tog.setValue(settings.autoPairMarkdown !== false).onChange((v) => update({ autoPairMarkdown: v }))));
    behavior.addSetting((s) => s
      .setName(tt('setting.editor.option-smart-indent-lists', '智能列表'))
      .setDesc(tt('setting.editor.option-smart-indent-lists-description', '开启后 OpenSidian 将根据换行和缩进情况自动调整列表符号。'))
      .addToggle((tog) => tog.setValue(settings.smartIndentList !== false).onChange((v) => update({ smartIndentList: v }))));
    behavior.addSetting((s) => s
      .setName(tt('setting.editor.option-use-tabs', '使用制表符'))
      .setDesc(tt('setting.editor.option-use-tabs-description', '开启后，Tab 键将使用制表符来完成缩进。关闭后 Tab 键将使用空格完成缩进。'))
      .addToggle((tog) => tog.setValue(settings.useTab !== false).onChange((v) => update({ useTab: v }))));
    behavior.addSetting((s) => {
      let slider = null;
      const setSize = (v) => {
        if (slider) slider.setValue(v);
        update({ tabSize: v });
      };
      s.setName(tt('setting.editor.option-tab-size', '制表符宽度'))
        .setDesc(tt('setting.editor.option-tab-size-description', '设置制表符等同的空格数。'))
        .addExtraButton((b) => b
          .setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => setSize(4)))
        .addSlider((sl) => {
          slider = sl;
          sl.setLimits(2, 8, 1).setDynamicTooltip().setValue(settings.tabSize || 4).onChange((v) => update({ tabSize: v }));
          trackSliderFill(sl);
        });
    });

    const adv = new SettingGroup(this.containerEl).setHeading(tt('setting.about.option-advanced', '高级'));
    adv.addSetting((s) => s
      .setName(tt('setting.editor.option-auto-convert-html', '自动转换 HTML'))
      .setDesc(tt('setting.editor.option-auto-convert-html-description', '从网页粘贴或拖拽粘贴内容时自动将 HTML 格式转换为 Markdown 格式。如果不想转换，请使用 Ctrl/Cmd+Shift+V 进行粘贴。'))
      .addToggle((tog) => tog.setValue(settings.autoConvertHtml !== false).onChange((v) => update({ autoConvertHtml: v }))));
    adv.addSetting((s) => s
      .setName(tt('setting.editor.option-vim-key-bindings', 'Vim 模式'))
      .setDesc(tt('setting.editor.option-vim-key-bindings-description', '允许在编辑器中使用 Vim 模式。') + '（暂未实现，处于降级不可用状态）')
      .addToggle((tog) => tog.setValue(settings.vimMode === true).onChange((v) => {
        if (this.passedVimTest || !v) {
          update({ vimMode: v });
          if (v) new Notice(tt('setting.editor.msg-vim-mode-enabled', '命令正确。开启 Vim 模式。') + '（暂未接入按键实现）');
          return;
        }
        tog.setValue(false); // 原版：弹窗期间开关回弹为关闭，验证通过后再开启
        new VimTestModal(app, (ok) => {
          if (ok) {
            this.passedVimTest = true;
            tog.setValue(true); // 已通过验证，onChange 走持久化分支
            new Notice(tt('setting.editor.msg-vim-mode-enabled', '命令正确。开启 Vim 模式。') + '（暂未接入按键实现）');
          } else {
            new Notice(tt('setting.editor.msg-vim-mode-not-enabled', '命令错误。为保证你的使用体验，暂不开启 Vim 模式。'));
          }
        }).open();
      })));
  }
}

/* --------------------------------------------------------------- File & Links */

export class FileTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.file.name', '文件与链接');
    this.id = 'file';
    this.icon = 'folder-cog';
  }

  display() {
    const app = this.app;
    const settings = app.settings.appSettings;
    const update = (patch) => app.settings.updateAppSettings(patch);
    this.containerEl.empty();

    /* 默认打开文件 */
    const behavior = settings.openBehavior || '';
    const isFileBehavior = behavior.startsWith('file:');
    let currentOpenPath = isFileBehavior ? behavior.slice(5) : '';
    let openFileRow = null;
    const group = new SettingGroup(this.containerEl);
    group.addSetting((s) => s
      .setName(tt('setting.file.option-default-open-action', '默认打开文件'))
      .setDesc(tt('setting.file.option-default-open-action-description', '选择启动时打开的文件。'))
      .addDropdown((d) => {
        d.addOption('', tt('setting.file.option-choice-last-opened', '上次打开的文件'));
        d.addOption('new', tt('setting.file.option-choice-new-note', '新笔记'));
        d.addOption('file', tt('setting.file.option-choice-specific-file', '指定文件'));
        const daily = app.plugins.getInternalPlugin('daily-notes');
        if (daily && daily.enabled) d.addOption('daily', tt('setting.file.option-choice-daily-note', '日记'));
        d.setValue(isFileBehavior ? 'file' : (['', 'new', 'daily'].includes(behavior) ? behavior : ''));
        d.onChange((v) => {
          if (v === 'file') update({ openBehavior: 'file:' + currentOpenPath });
          else update({ openBehavior: v });
          if (openFileRow) openFileRow.settingEl.toggle(v === 'file');
        });
      }));
    group.addSetting((s) => {
      openFileRow = s;
      s.setName(tt('setting.file.option-default-open-file-path', '要打开的文件'))
        .setDesc(tt('setting.file.option-default-open-file-path-description', '选择默认打开的特定文件。'))
        .addText((txt) => {
          txt.setPlaceholder(tt('setting.file-path-example-placeholder', '例: 文件夹/笔记'))
            .setValue(currentOpenPath)
            .onChange((v) => {
              currentOpenPath = v;
              update({ openBehavior: 'file:' + v });
            });
          new FilePathSuggest(app, txt.inputEl);
        });
      s.settingEl.toggle(isFileBehavior);
    });
    group.addSetting((s) => s
      .setName(tt('setting.editor.option-open-tab-in-foreground', '始终聚焦新标签页'))
      .setDesc(tt('setting.editor.option-open-tab-in-foreground-description', '当你在新标签页打开链接，立即切换至新标签页。'))
      .addToggle((tog) => tog.setValue(settings.focusNewTab === true).onChange((v) => update({ focusNewTab: v }))));

    /* 新建笔记位置 */
    group.addSetting((s) => s
      .setName(tt('setting.file.option-new-note-location', '新建笔记的存放位置'))
      .setDesc(tt('setting.file.option-new-note-location-description', '指定新建笔记的存放路径。'))
      .addDropdown((d) => {
        d.addOption('root', tt('setting.file.option-choice-vault-root', '仓库的根目录'));
        d.addOption('current', tt('setting.file.option-choice-current-folder', '当前文件所在的文件夹'));
        d.addOption('folder', tt('setting.file.option-choice-specified-folder', '指定的附件文件夹'));
        d.setValue(settings.newFileLocation || 'root');
        d.onChange((v) => {
          update({ newFileLocation: v });
          if (newFolderRow) newFolderRow.settingEl.toggle(v === 'folder');
        });
      }));
    let newFolderRow = null;
    group.addSetting((s) => {
      newFolderRow = s;
      s.setName(tt('setting.file.option-new-file-folder-path', '存放新建笔记的文件夹'))
        .setDesc(tt('setting.file.option-new-file-folder-path-description', '指定存放新笔记的文件夹，插件可能会修改此设置。'))
        .addText((txt) => {
          txt.setPlaceholder(tt('setting.folder-path-example-placeholder', '例: 文件夹 1/文件夹 2'))
            .setValue(settings.newFileFolderPath || '')
            .onChange((v) => update({ newFileFolderPath: v }));
          new FolderPathSuggest(app, txt.inputEl);
        });
      s.settingEl.toggle(settings.newFileLocation === 'folder');
    });

    /* 附件位置 */
    const attach = settings.attachmentFolderPath || '/';
    let attachMode = 'root';
    let attachFolder = '';
    let attachSub = '';
    if (attach === './' || attach === '.') attachMode = 'current';
    else if (attach.startsWith('./')) { attachMode = 'subfolder'; attachSub = attach.slice(2); if (attachSub === 'attachments') attachSub = ''; }
    else if (attach !== '/' && attach !== '') { attachMode = 'folder'; attachFolder = attach === 'attachments' ? '' : attach; }
    const writeAttach = (mode, folder, sub) => {
      let value = '/';
      if (mode === 'current') value = './';
      else if (mode === 'subfolder') value = './' + (sub || 'attachments');
      else if (mode === 'folder') value = folder || 'attachments';
      update({ attachmentFolderPath: value });
    };
    let attachFolderRow = null;
    let attachSubRow = null;
    group.addSetting((s) => s
      .setName(tt('setting.file.option-new-attachment-location', '附件默认存放路径'))
      .setDesc(tt('setting.file.option-new-attachment-location-description', '设置新添加附件的存放位置。'))
      .addDropdown((d) => {
        d.addOption('root', tt('setting.file.option-choice-vault-root', '仓库的根目录'));
        d.addOption('current', tt('setting.file.option-choice-current-folder', '当前文件所在的文件夹'));
        d.addOption('subfolder', tt('setting.file.option-choice-subdirectory', '当前文件所在文件夹下指定的子文件夹'));
        d.addOption('folder', tt('setting.file.option-choice-specified-folder', '指定的附件文件夹'));
        d.setValue(attachMode);
        d.onChange((v) => {
          writeAttach(v, attachFolder, attachSub);
          if (attachFolderRow) attachFolderRow.settingEl.toggle(v === 'folder');
          if (attachSubRow) attachSubRow.settingEl.toggle(v === 'subfolder');
        });
      }));
    group.addSetting((s) => {
      attachFolderRow = s;
      s.setName(tt('setting.file.option-attachment-folder-path', '附件文件夹路径'))
        .setDesc(tt('setting.file.option-attachment-folder-path-description', '指定用于存放附件的文件夹。新建的附件会存放于此，如音频记录或通过拖放或粘贴创建的图像等。'))
        .addText((txt) => {
          txt.setPlaceholder(tt('setting.file.option-new-attachment-location-default', '附件'))
            .setValue(attachFolder)
            .onChange((v) => { attachFolder = v; writeAttach('folder', v, attachSub); });
          new FolderPathSuggest(app, txt.inputEl);
        });
      s.settingEl.toggle(attachMode === 'folder');
    });
    group.addSetting((s) => {
      attachSubRow = s;
      s.setName(tt('setting.file.option-attachment-subfolder-path', '子文件夹名称'))
        .setDesc(tt('setting.file.option-attachment-subfolder-path-description', '如果当前文件在 “vault/folder” 中，而设置子文件夹名称为 “attachments”，则附件将被保存至 “vault/folder/attachments” 路径下。'))
        .addText((txt) => txt
          .setPlaceholder(tt('setting.file.option-new-attachment-location-default', '附件'))
          .setValue(attachSub)
          .onChange((v) => { attachSub = v; writeAttach('subfolder', attachFolder, v); }));
      s.settingEl.toggle(attachMode === 'subfolder');
    });

    /* 链接 */
    const links = new SettingGroup(this.containerEl).setHeading(tt('setting.file.option-links', '链接'));
    links.addSetting((s) => s
      .setName(tt('setting.file.option-link-autocompleted-format', '内部链接类型'))
      .setDesc(tt('setting.file.option-link-autocompleted-format-description', '设置在笔记中链接其他文件时插入 “[[ ]]” 中的文件路径类型。'))
      .addDropdown((d) => {
        d.addOption('shortest', tt('setting.file.option-choice-shortest-linktext', '尽可能简短的形式'));
        d.addOption('relative', tt('setting.file.option-choice-relative-path', '基于当前笔记的相对路径'));
        d.addOption('absolute', tt('setting.file.option-choice-absolute-path', '基于仓库根目录的绝对路径'));
        d.setValue(settings.newLinkFormat || 'shortest');
        d.onChange((v) => update({ newLinkFormat: v }));
      }));
    links.addSetting((s) => s
      .setName(tt('setting.file.option-always-update-links', '始终更新内部链接'))
      .setDesc(tt('setting.file.option-always-update-links-description', '开启后重命名文件时 OpenSidian 会自动为你更新内部链接，关闭后则需要你手动确认是否更新。'))
      .addToggle((tog) => tog.setValue(settings.alwaysUpdateLinks !== false).onChange((v) => update({ alwaysUpdateLinks: v }))));
    links.addSetting((s) => s
      .setName(tt('setting.file.option-use-wiki-links', '使用 Wiki 链接'))
      .setDesc(tt('setting.file.option-use-wiki-links-description', '开启后，在笔记中链接其他笔记或图像时，使用如 [[文件名]] 和 ![[图片名]] 这样的Wiki链接。关闭此选项则默认使用标准的 Markdown 超链接语法，如 []()。'))
      .addToggle((tog) => tog.setValue(settings.useMarkdownLinks !== true).onChange((v) => update({ useMarkdownLinks: !v }))));
    links.addSetting((s) => s
      .setName(tt('setting.file.option-show-unsupported-files', '检测所有类型文件'))
      .setDesc(tt('setting.file.option-show-unsupported-files-description', '在文件列表和快速切换中显示所有类型的文件，即使是那些目前 OpenSidian 不支持的类型。开启此选项后可以对不支持的文件进行链接。'))
      .addToggle((tog) => tog.setValue(settings.showUnsupportedFiles === true).onChange((v) => update({ showUnsupportedFiles: v }))));

    /* 回收站 */
    const trash = new SettingGroup(this.containerEl).setHeading(tt('setting.file.option-trash', '回收站'));
    trash.addSetting((s) => s
      .setName(tt('setting.file.option-confirm-file-deletion', '删除文件前确认'))
      .setDesc(tt('setting.file.option-confirm-file-deletion-description', '避免意外删除文件。'))
      .addToggle((tog) => tog.setValue(settings.promptDelete !== false).onChange((v) => update({ promptDelete: v }))));
    trash.addSetting((s) => s
      .setName(tt('setting.file.option-delete-unlinked-attachments', '删除文件时删除附件'))
      .setDesc(tt('setting.file.option-delete-unlinked-attachments-description', '如果附件仅链接到被删除的文件且在其他地方未使用，则自动移除该附件。'))
      .addDropdown((d) => {
        d.addOption('ask', tt('setting.file.option-choice-ask-every-time', '每次都询问'));
        d.addOption('always', tt('setting.file.option-choice-always', '始终'));
        d.addOption('never', tt('setting.file.option-choice-never', '从不'));
        d.setValue(typeof settings.deleteUnlinkedAttachments === 'string' ? settings.deleteUnlinkedAttachments : 'ask');
        d.onChange((v) => update({ deleteUnlinkedAttachments: v }));
      }));
    trash.addSetting((s) => s
      .setName(tt('setting.file.option-delete-destination', '删除文件设置'))
      .setDesc(tt('setting.file.option-delete-destination-description', '要如何处理已删除的文件？'))
      .addDropdown((d) => {
        d.addOption('system', tt('setting.file.option-choice-system-trash', '移至系统回收站'));
        d.addOption('local', tt('setting.file.option-choice-vault-trash', '移至 OpenSidian 回收站（.trash 文件夹）'));
        d.addOption('none', tt('setting.file.option-choice-permanent-delete', '永久删除'));
        const value = settings.trashOption === 'permanent' ? 'none' : (settings.trashOption || 'system');
        d.setValue(value);
        d.onChange((v) => update({ trashOption: v }));
      }));

    /* 高级 */
    const adv = new SettingGroup(this.containerEl).setHeading(tt('setting.about.option-advanced', '高级'));
    // 原版 1.14.4：忽略文件是可导航子页面，行尾显示规则条数；页面内“+”打开新增表单弹窗。
    adv.addSetting((s) => {
      s.setClass('mod-navigable');
      s.setClass('tappable');
      s.setName(tt('setting.file.option-excluded-files', '忽略文件'));
      s.descEl.empty();
      s.descEl.appendText(tt('setting.file.option-excluded-files-desc', '符合以下条件的文件将被忽略。忽略是指文件将出现在快速切换、链接补全中队列的末尾，以及不在关系图谱和搜索结果中出现。'));
      const filters = app.settings.appSettings.userIgnoreFilters || [];
      s.controlEl.createDiv('setting-item-value')
        .setText(tt('setting.file.label-excluded-files-count', '{{count}} 条规则', { count: filters.length }));
      s.controlEl.createDiv('setting-item-chevron', (el) => setIcon(el, 'lucide-chevron-right'));
      s.settingEl.addEventListener('click', () => this.openExcludedFilesPage());
    });
    adv.addSetting((s) => {
      s.setName(tt('setting.editor.option-reindex-vault', '重建仓库缓存'));
      s.descEl.empty();
      s.descEl.createSpan({ cls: 'mod-warning', text: tt('setting.editor.option-reindex-vault-description', '重建缓存可能需要几秒钟到几分钟的时间，具体取决于您的仓库大小。') });
      s.descEl.createEl('br');
      s.descEl.createEl('a', {
        text: tt('interface.button-learn-more', '了解更多'),
        attr: { href: 'https://help.obsidian.md/data-storage', target: '_blank', rel: 'noopener' },
      });
      s.addButton((b) => b
        .setButtonText(tt('setting.editor.label-reindex', '重建'))
        .onClick(async () => {
          try { await app.metadataCache.rebuildIndices(); } catch (e) { console.error(e); }
          window.location.reload();
        }));
    });
  }

  /**
   * 忽略文件子页面（原版 openPage）：
   * .setting-page > .setting-page-content > .setting-group.mod-list.mod-no-icon，
   * 标题行带“+”新增按钮；列表每条是 .setting-item + 删除按钮，正则条件带 flair mod-flat。
   */
  openExcludedFilesPage() {
    const app = this.app;
    const filters = () => app.settings.appSettings.userIgnoreFilters || [];
    const rerender = () => {
      this.setting.closePage();
      this.openExcludedFilesPage();
    };
    this.setting.openPage({
      title: tt('setting.file.option-excluded-files', '忽略文件'),
      build: (contentEl) => {
        const group = new SettingGroup(contentEl);
        group.addClass('mod-list');
        group.addClass('mod-no-icon');
        // 原版：列表组带标题行（标题为空），行尾是“+”新增按钮
        group.groupEl.prepend(group.headerEl);
        group.addExtraButton((b) => b
          .setIcon('lucide-plus')
          .setTooltip(tt('setting.file.label-add-excluded-filter', '添加排除项...'))
          .onClick(() => {
            new AddExcludedFilterModal(app, (value) => {
              app.settings.updateAppSettings({ userIgnoreFilters: [...filters(), value] });
              rerender();
            }).open();
          }));
        const values = filters();
        if (!values.length) {
          const empty = group.listEl.createDiv('setting-item mod-empty-state');
          const info = empty.createDiv('setting-item-info');
          info.createDiv('setting-item-name').setText(tt('setting.file.label-no-excluded-filters', '未添加排除项。'));
          info.createDiv('setting-item-description');
          empty.createDiv('setting-item-control');
          return;
        }
        for (const value of values) {
          group.addSetting((s) => {
            s.setName(String(value));
            s.settingEl.createDiv('setting-item-icon');
            if (isRegexFilterValue(value)) s.nameEl.createSpan({ cls: 'flair mod-flat', text: 'Regex' });
            s.addExtraButton((b) => b
              .setIcon('lucide-x')
              .setTooltip(tt('interface.delete-action-short-name', '删除'))
              .onClick(() => {
                const next = filters().filter((x) => x !== value);
                app.settings.updateAppSettings({ userIgnoreFilters: next.length ? next : null });
                rerender();
              }));
          });
        }
      },
    });
  }
}
