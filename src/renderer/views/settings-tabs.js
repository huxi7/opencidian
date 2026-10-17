/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt/getLanguage/setLanguage；依赖 ../core/setting.js 的 Setting/SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/suggest.js 的 AbstractInputSuggest；依赖 ../core/icons.js 的 setIcon
 * [OUTPUT]: 导出 AboutTab、EditorTab、FileTab 三个内置页签类
 * [POS]: views/ 的内置设置页签（选项组）。逐字对齐原版 O7/nte/lte 的 display()：关于（版本/语言/高级+启动耗时弹窗）、编辑器（行为+拼写检查词典/语言+Vim 验证）、文件与链接（打开行为/新建位置/附件/链接/回收站/忽略文件/重建缓存）。文案走 tt() 兜底，配置写 app.settings.updateAppSettings（app.json）；拼写检查词典/语言经 Desktop IPC 读写主进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Built-in settings tabs: About / Editor / File & Links. */
import { tt, getLanguage, setLanguage } from '../core/i18n.js';
import { Setting, SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Modal } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';
import { AbstractInputSuggest } from '../core/suggest.js';
import { TFile, TFolder } from '../core/vault.js';
import { setIcon } from '../core/icons.js';

const VERSION = '1.0.0';
const IS_MAC = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

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

    group.addSetting((s) => {
      s.setName(tt('setting.about.label-version', '版本 {{version}}', { version: VERSION }));
      s.descEl.empty();
      s.descEl.appendText(tt('opensidian.about.replica-note', 'OpenSidian — 基于 Obsidian 1.12.4 的独立开源复刻。'));
      s.descEl.createEl('br');
      s.descEl.createEl('a', {
        text: tt('setting.about.label-read-changelog', '阅读更新日志'),
        attr: { href: 'https://obsidian.md/changelog', target: '_blank', rel: 'noopener' },
      });
      s.addButton((b) => b.setCta().setButtonText(tt('setting.about.button-check-for-updates', '检查更新')).onClick(async () => {
        await new Promise((r) => setTimeout(r, 900));
        new Notice(tt('setting.about.label-new-version-ready', '已是最新版本') + ' (' + VERSION + ')');
      }));
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
      s.addButton((b) => {
        b.setCta().setButtonText(tt('setting.about.button-relaunch', '重新启动应用'));
        b.buttonEl.hide();
        b.onClick(() => {
          if (pending) setLanguage(pending);
          location.reload();
        });
        this._relaunchButton = b;
      });
      s.addDropdown((d) => {
        d.addOption('en', 'English');
        d.addOption('zh', '中文');
        d.setValue(current);
        d.onChange((v) => {
          pending = v;
          this._relaunchButton.buttonEl.toggle(v !== current);
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
  }
}

/**
 * 原版 P7 的简化版：标题与统计标签保留原版英文（原版未走 i18n）。
 * 桌面统计系统与版本；计时段只有总耗时——初始化/仓库等分段未埋点。
 * 类名 mod-plugin-debug 触发原版启动统计弹窗样式。
 */
class StartupTimeModal extends Modal {
  constructor(app) {
    super(app);
    this.setTitle('Startup time');
    this.modalEl.addClass('mod-lg', 'mod-scrollable-content', 'mod-plugin-debug');
    const totalMs = Math.max(0, performance.now() - (app.bootTime || performance.now()));
    const total = Math.round(totalMs) + 'ms';
    const statsEl = this.contentEl.createDiv('startup-stat-list');
    const addStat = (label, value, desc) => {
      const row = statsEl.createDiv('startup-stat');
      const info = row.createDiv('startup-info');
      info.createSpan({ cls: 'startup-label', text: label });
      if (desc) info.createSpan({ cls: 'startup-desc', text: desc });
      row.createDiv({ cls: 'startup-value', text: value });
    };
    addStat('Operating system', navigator.platform || 'Unknown');
    addStat('OpenSidian', VERSION);
    const timingEl = this.contentEl.createDiv('startup-timing-list');
    const heading = timingEl.createDiv('startup-stat mod-heading');
    heading.createDiv('startup-info').createSpan({ cls: 'startup-label', text: 'Total app startup' });
    heading.createDiv({ cls: 'startup-value', text: total });
    this.buttonContainerEl.createEl('button', { cls: 'mod-secondary', text: tt('interface.label-copy', '复制到剪贴板') })
      .addEventListener('click', async () => {
        const lines = [
          'OpenSidian start-up time breakdown', '',
          'OpenSidian version: ' + VERSION,
          'Operating system: ' + (navigator.platform || 'Unknown'), '',
          '- Total startup time: ' + total,
        ];
        try { await navigator.clipboard.writeText(lines.join('\n')); new Notice(tt('interface.copied_generic', '已复制到剪贴板')); } catch (e) {}
      });
    this.buttonContainerEl.createEl('button', { cls: 'mod-cancel', text: tt('dialogue.button-done', '完成') })
      .addEventListener('click', () => this.close());
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
      .setName(tt('setting.editor.option-open-tab-in-foreground', '始终聚焦新标签页'))
      .setDesc(tt('setting.editor.option-open-tab-in-foreground-description', '当你在新标签页打开链接，立即切换至新标签页。'))
      .addToggle((tog) => tog.setValue(settings.focusNewTab === true).onChange((v) => update({ focusNewTab: v }))));
    group.addSetting((s) => s
      .setName(tt('setting.editor.option-default-new-tab-view', '新标签页的默认视图'))
      .setDesc(tt('setting.editor.option-default-new-tab-view-description', '设置新标签页的默认视图模式。'))
      .addDropdown((d) => {
        d.addOption('source', tt('setting.editor.option-default-new-tab-view-editing', '编辑视图'));
        d.addOption('preview', tt('setting.editor.option-default-new-tab-view-reading', '阅读视图'));
        d.setValue(settings.defaultViewMode === 'preview' ? 'preview' : 'source');
        d.onChange((v) => update({ defaultViewMode: v }));
      }));
    group.addSetting((s) => s
      .setName(tt('setting.editor.option-default-editing-mode', '默认编辑模式'))
      .setDesc(tt('setting.editor.option-default-editing-mode-description', '在编辑视图下，新标签页默认采用的编辑模式。'))
      .addDropdown((d) => {
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
      }));
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
      const info = (() => { try { return Desktop.spellcheckLanguages() || {}; } catch (e) { return {}; } })();
      const available = Array.isArray(info.available) ? info.available : [];
      const active = Array.isArray(info.active) ? info.active : [];
      const custom = Array.isArray(info.current) ? [...info.current] : null;
      const apply = (languages) => { try { Desktop.spellcheckLanguagesSet(languages); } catch (e) {} this.display(); };
      const pillValues = custom || active;
      const pills = s.controlEl.createDiv('multi-select-container');
      for (const lang of pillValues) {
        pills.createDiv('multi-select-pill', (pill) => {
          pill.createDiv('multi-select-pill-content', (c) => c.setText(lang));
          const del = pill.createDiv('multi-select-pill-remove-button clickable-icon');
          setIcon(del, 'lucide-x');
          del.onclick = () => apply(pillValues.filter((x) => x !== lang));
        });
      }
      if (custom) {
        s.addExtraButton((b) => b
          .setIcon('lucide-rotate-ccw')
          .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
          .onClick(() => apply(null)));
      }
      if (available.length) {
        s.addDropdown((d) => {
          d.addOption('', '');
          for (const lang of available) if (!pillValues.includes(lang)) d.addOption(lang, lang);
          d.setValue('');
          d.onChange((v) => { if (v) apply([...pillValues, v]); });
        });
      }
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
        });
    });

    const adv = new SettingGroup(this.containerEl).setHeading(tt('setting.about.option-advanced', '高级'));
    adv.addSetting((s) => s
      .setName(tt('setting.editor.option-auto-convert-html', '自动转换 HTML'))
      .setDesc(tt('setting.editor.option-auto-convert-html-description', '从网页粘贴或拖拽粘贴内容时自动将 HTML 格式转换为 Markdown 格式。如果不想转换，请使用 Ctrl/Cmd+Shift+V 进行粘贴。'))
      .addToggle((tog) => tog.setValue(settings.autoConvertHtml !== false).onChange((v) => update({ autoConvertHtml: v }))));
    adv.addSetting((s) => s
      .setName(tt('setting.editor.option-vim-key-bindings', 'Vim 模式'))
      .setDesc(tt('setting.editor.option-vim-key-bindings-description', '允许在编辑器中使用 Vim 模式。'))
      .addToggle((tog) => tog.setValue(settings.vimMode === true).onChange((v) => {
        if (!v) { update({ vimMode: false }); return; }
        tog.setValue(false); // 原版：弹窗期间开关回弹为关闭，验证通过后再开启
        new VimTestModal(app, (ok) => {
          if (ok) {
            tog.setValue(true);
            update({ vimMode: true });
            new Notice(tt('setting.editor.msg-vim-mode-enabled', '命令正确。开启 Vim 模式。'));
          } else {
            new Notice(tt('setting.editor.msg-vim-mode-not-enabled', '命令错误。为保证你的使用体验，暂不开启 Vim 模式。'));
          }
        }).open();
      })));
  }
}

/** 原版 Vim 验证弹窗：输入 :q 才允许开启 Vim 模式。 */
class VimTestModal extends Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
    this.setTitle(tt('setting.editor.label-confirm-enable-vim', '确认进入 Vim 模式'));
    this.contentEl.createEl('p', { cls: 'mod-warning', text: tt('setting.editor.label-vim-warning', 'Vim 模式可以实现高效的文本编辑操作，但其使用方法十分复杂。如果你对 Vim 不了解，开启该模式可能会让 OpenSidian 难以使用。') });
    this.contentEl.createEl('p', { text: tt('setting.editor.label-vim-test', '为了确保你知道如何使用 Vim，请输入 Vim 中“退出而不保存”对应的命令：') });
    const field = this.contentEl.createEl('p', { cls: 'form-field' });
    field.createEl('label', { cls: 'input-label', text: tt('setting.editor.label-vim-your-answer', '你的答案') });
    const input = field.createEl('input', {
      type: 'text',
      attr: { placeholder: tt('setting.editor.placeholder-enter-command', '请输入命令…') },
    });
    input.style.width = '100%';
    const confirm = () => {
      const value = input.value.trim();
      if (!value) { new Notice(tt('setting.editor.msg-vim-mode-please-enter-command', '请输入相应命令开启 Vim 模式。')); return; }
      const ok = value === ':q' || value.startsWith(':q');
      this.close();
      this.onConfirm(ok);
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); confirm(); }
    });
    const row = this.contentEl.createDiv('modal-button-container');
    row.createEl('button', { text: tt('dialogue.button-cancel', '取消') })
      .addEventListener('click', () => { this.close(); this.onConfirm(false); });
    row.createEl('button', { cls: 'mod-cta', text: tt('setting.editor.button-confirm-enable-vim', '让我开启 Vim 模式') })
      .addEventListener('click', confirm);
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
        const daily = app.plugins.getInternalPlugin('daily-notes');
        if (daily && daily.enabled) d.addOption('daily', tt('setting.file.option-choice-daily-note', '日记'));
        d.addOption('file', tt('setting.file.option-choice-specific-file', '指定文件'));
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
    let attachFolder = 'attachments';
    let attachSub = 'attachments';
    if (attach === './' || attach === '.') attachMode = 'current';
    else if (attach.startsWith('./')) { attachMode = 'subfolder'; attachSub = attach.slice(2) || 'attachments'; }
    else if (attach !== '/' && attach !== '') { attachMode = 'folder'; attachFolder = attach; }
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
    adv.addSetting((s) => {
      s.setName(tt('setting.file.option-excluded-files', '忽略文件'));
      s.descEl.empty();
      s.descEl.appendText(tt('setting.file.option-excluded-files-desc', '符合以下条件的文件将被忽略。'));
      const filters = app.settings.appSettings.userIgnoreFilters || [];
      if (filters.length) {
        const list = s.descEl.createEl('ul');
        for (const value of filters) {
          const item = list.createEl('li');
          item.createSpan({ text: String(value) });
          if (isRegexFilterValue(value)) item.createSpan({ cls: 'flair mod-flat', text: tt('setting.file.label-regex', '正则') });
        }
      }
      s.addButton((b) => b.setButtonText(tt('setting.appearance.option-theme-button-manage', '管理')).onClick(() => {
        new ExcludedFilesModal(app, () => this.display()).open();
      }));
    });
    adv.addSetting((s) => {
      s.setName(tt('setting.editor.option-reindex-vault', '重建仓库缓存'));
      s.descEl.empty();
      s.descEl.appendText(tt('setting.editor.option-reindex-vault-description', '重建缓存可能需要几秒钟到几分钟的时间，具体取决于您的仓库大小。'));
      s.descEl.createDiv({ cls: 'mod-warning', text: tt('setting.editor.label-reindex-warning', '重建缓存后应用将重新加载。') });
      s.descEl.createEl('a', {
        text: tt('setting.editor.label-reindex-learn-more', '了解它是如何工作的'),
        attr: { href: 'https://help.obsidian.md/troubleshooting', target: '_blank', rel: 'noopener' },
      });
      s.addButton((b) => b
        .setClass('mod-destructive')
        .setButtonText(tt('setting.editor.label-reindex', '重建'))
        .onClick(async () => {
          try { await app.metadataCache.rebuildIndices(); } catch (e) { console.error(e); }
          window.location.reload();
        }));
    });
  }
}

/** 忽略文件管理弹窗：列表 + 添加输入 + 保存/取消（对齐原版行为，简化 UI）。 */
class ExcludedFilesModal extends Modal {
  constructor(app, onDone) {
    super(app);
    this.app = app;
    this.onDone = onDone;
    this.values = [...(app.settings.appSettings.userIgnoreFilters || [])];
    this.setTitle(tt('setting.file.option-excluded-files', '忽略文件'));
  }

  onOpen() {
    this.display();
  }

  display() {
    const container = this.contentEl;
    container.empty();
    const listEl = container.createDiv('excluded-files-list');
    for (const value of this.values) {
      listEl.createDiv('mobile-option-setting-item', (row) => {
        row.createSpan({ cls: 'mobile-option-setting-item-name', text: value });
        if (isRegexFilterValue(value)) row.createSpan({ cls: 'flair mod-flat', text: tt('setting.file.label-regex', '正则') });
        const btn = row.createDiv('clickable-icon mobile-option-setting-item-option-icon');
        setIcon(btn, 'lucide-x');
        btn.addEventListener('click', () => {
          this.values = this.values.filter((x) => x !== value);
          this.display();
        });
      });
    }
    if (!this.values.length) {
      container.createEl('p', { text: tt('setting.file.label-no-excluded-filters-applied', '目前没有需要忽略的文件。') });
    }
    container.createDiv('setting-item-name', (t2) => t2.setText(tt('setting.file.label-filter-conditions', '条件')));
    const addRow = container.createDiv('excluded-files-add-row');
    const input = addRow.createEl('input', {
      type: 'text',
      attr: { placeholder: tt('setting.file.placeholder-excluded-filter', '请输入文件路径或正则表达式') },
    });
    input.style.flex = '1';
    const errorEl = container.createDiv('mod-warning');
    errorEl.hide();
    const suggest = new ExcludedPathSuggest(this.app, input);
    const add = () => {
      const value = input.value.trim();
      if (!value) {
        errorEl.setText(tt('setting.file.message-empty-filter', '条件不能为空。'));
        errorEl.show();
        return;
      }
      errorEl.hide();
      this.values.push(value);
      input.value = '';
      this.display();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); add(); }
    });
    suggest.onSelect = () => add();
    addRow.createEl('button', { text: tt('interface.button-add', '添加') }).addEventListener('click', add);
    const buttons = container.createDiv('modal-button-container');
    buttons.createEl('button', { text: tt('dialogue.button-cancel', '取消') }).addEventListener('click', () => this.close());
    buttons.createEl('button', { cls: 'mod-cta', text: tt('dialogue.button-save', '保存') }).addEventListener('click', () => {
      this.app.settings.updateAppSettings({ userIgnoreFilters: this.values });
      this.close();
      this.onDone && this.onDone();
    });
  }
}

/* -------------------------------------------------------- helpers & modals */

/** 原版正则条件检测：/pattern/ 形式。 */
function isRegexFilterValue(value) {
  return /^\/.+\/$/.test(String(value || '').trim());
}

/** 递归收集仓库内文件夹相对路径（建议列表用）。 */
function collectFolderPaths(app) {
  const out = [];
  const walk = (folder) => {
    for (const child of folder.children || []) {
      if (child instanceof TFolder) {
        if (child.path) out.push(child.path);
        walk(child);
      }
    }
  };
  walk(app.vault.getRoot());
  return out;
}

/** 文件路径建议（设置页文本框用，只读复用 suggest 基类）。 */
class FilePathSuggest extends AbstractInputSuggest {
  getSuggestions(query) {
    const q = String(query || '').toLowerCase();
    return this.app.vault.getFiles()
      .map((f) => f.path)
      .filter((p) => !q || p.toLowerCase().includes(q))
      .slice(0, 30);
  }
  renderSuggestion(path, el) { el.setText(path); }
  selectSuggestion(path) {
    this.inputEl.value = path;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}

/** 文件夹路径建议。 */
class FolderPathSuggest extends FilePathSuggest {
  getSuggestions(query) {
    const q = String(query || '').toLowerCase();
    return collectFolderPaths(this.app)
      .filter((p) => !q || p.toLowerCase().includes(q))
      .slice(0, 30);
  }
}

/** 忽略文件条件的路径建议：选择即触发 onSelect（弹窗内自动添加）。 */
class ExcludedPathSuggest extends FilePathSuggest {
  selectSuggestion(path) {
    super.selectSuggestion(path);
    if (typeof this.onSelect === 'function') this.onSelect(path);
  }
}

/** 拼写检查词典弹窗（原版 ite）：自加词列表 + 移除。 */
class SpellcheckDictModal extends Modal {
  constructor(app) {
    super(app);
    this.setTitle(tt('setting.editor.spellcheck-dict', '拼写检查词典'));
  }
  onOpen() { this.render(); }
  render() {
    this.contentEl.empty();
    let words = [];
    try { words = Desktop.spellcheckDict() || []; } catch (e) { words = []; }
    if (!words.length) {
      this.contentEl.createEl('p', { text: tt('setting.editor.spellcheck-dict-empty', '拼写检查词典是空的。') });
      return;
    }
    const wrap = this.contentEl.createDiv('spellchecker-dictionary-container');
    for (const word of words) {
      wrap.createDiv('spellchecker-dictionary-item', (row) => {
        row.createDiv('spellchecker-dictionary-word', (w) => w.setText(word));
        const remove = row.createDiv('spellchecker-dictionary-remove-button clickable-icon');
        setIcon(remove, 'lucide-x');
        remove.onclick = () => {
          try { Desktop.spellcheckDictRemove(word); } catch (e) {}
          this.render();
        };
      });
    }
  }
}
