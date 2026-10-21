/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/modals.js 的 Modal；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/suggest.js 的 AbstractInputSuggest；依赖 ../core/vault.js 的 TFolder；依赖 ../core/icons.js 的 setIcon
 * [OUTPUT]: 导出 VERSION、StartupTimeModal、VimTestModal、ExcludedFilesModal、SpellcheckDictModal、trackSliderFill、isRegexFilterValue、FilePathSuggest、FolderPathSuggest
 * [POS]: views/ 的设置页签配套件。弹窗与路径建议器从 settings-tabs.js 拆出，供关于/编辑器/文件页复用；只依赖 core，不反向依赖页签类。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Settings-tab support: dialogs, path suggesters, shared helpers. */
import { tt } from '../core/i18n.js';
import { Modal } from '../core/modals.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { AbstractInputSuggest } from '../core/suggest.js';
import { TFolder } from '../core/vault.js';
import { setIcon } from '../core/icons.js';

export const VERSION = '1.0.0';

/**
 * 原版 wne 的桌面分支：Device 行（桌面隐藏）、Operating system、OpenSidian + Installer，
 * 然后是 Total app startup 与启动计时树。OpenSidian 没有分段埋点，计时树只保留总计。
 * 类名 mod-plugin-debug 触发原版启动统计弹窗样式（settings-dialogs.css）。
 */
export class StartupTimeModal extends Modal {
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
      if (value != null) row.createDiv({ cls: 'startup-value', text: value });
      return row;
    };
    let osInfo = null;
    try { osInfo = require('os'); } catch (e) {}
    addStat('Device', null, navigator.platform || 'Unknown').hide();
    addStat('Operating system', osInfo ? (osInfo.version() + ' ' + osInfo.release()) : (navigator.platform || 'Unknown'));
    const appRow = statsEl.createDiv('startup-stat');
    const appInfo = appRow.createDiv('startup-info');
    appInfo.createSpan({ cls: 'startup-label', text: 'OpenSidian' });
    appInfo.createSpan({ cls: 'startup-desc', text: VERSION });
    appInfo.createSpan({ cls: 'startup-label', text: 'Installer' });
    appInfo.createSpan({ cls: 'startup-desc', text: VERSION });
    const timingEl = this.contentEl.createDiv('startup-timing-list');
    const heading = timingEl.createDiv('startup-stat mod-heading');
    heading.createDiv('startup-info').createSpan({ cls: 'startup-label', text: 'Total app startup' });
    heading.createDiv({ cls: 'startup-value', text: total });
    this.buttonContainerEl.createEl('button', { cls: 'mod-secondary', text: tt('interface.label-copy', '复制到剪贴板') })
      .addEventListener('click', async () => {
        const osLine = osInfo ? (osInfo.version() + ' ' + osInfo.release()) : (navigator.platform || 'Unknown');
        const lines = [
          'OpenSidian start-up time breakdown', '',
          'OpenSidian version: ' + VERSION,
          'Installer version: ' + VERSION,
          'Operating system: ' + osLine, '',
          '- Total startup time: ' + total,
        ];
        try { await navigator.clipboard.writeText(lines.join('\n')); new Notice(tt('interface.copied_generic', '已复制到剪贴板')); } catch (e) {}
      });
    this.buttonContainerEl.createEl('button', { cls: 'mod-cancel', text: tt('dialogue.button-done', '完成') })
      .addEventListener('click', () => this.close());
  }
}

/** 原版 Vim 验证弹窗：输入 :q 才允许开启 Vim 模式。 */
export class VimTestModal extends Modal {
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
      const value = input.value.trim().toLowerCase();
      if (!value) { new Notice(tt('setting.editor.msg-vim-mode-please-enter-command', '请输入相应命令开启 Vim 模式。')); return; }
      if (!value.startsWith(':q')) { new Notice(tt('setting.editor.msg-vim-mode-not-enabled', '命令错误。为保证你的使用体验，暂不开启 Vim 模式。')); return; }
      this.close();
      this.onConfirm(true);
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

/** 忽略文件管理弹窗：列表 + 添加输入 + 保存/取消（对齐原版行为，简化 UI）。 */
export class ExcludedFilesModal extends Modal {
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
      this.app.settings.updateAppSettings({ userIgnoreFilters: this.values.length ? this.values : null });
      this.close();
      this.onDone && this.onDone();
    });
  }
}

/** 拼写检查词典弹窗（原版 ite）：自加词列表 + 移除。 */
export class SpellcheckDictModal extends Modal {
  constructor(app) {
    super(app);
    this.setTitle(tt('setting.editor.spellcheck-dict', '拼写检查词典'));
  }
  onOpen() { this.render(); }
  render() {
    this.contentEl.empty();
    let words = [];
    try { words = Desktop.spellcheckDict() || []; } catch (e) { words = []; }
    words = [...words].sort((a, b) => String(a).localeCompare(String(b)));
    if (!words.length) {
      this.contentEl.createEl('p', { text: tt('setting.editor.spellcheck-dict-empty', '拼写检查词典是空的。') });
      return;
    }
    const wrap = this.contentEl.createDiv('spellchecker-dictionary-container');
    for (const word of words) {
      wrap.createDiv('spellchecker-dictionary-item', (row) => {
        const remove = row.createDiv('spellchecker-dictionary-remove-button clickable-icon');
        setIcon(remove, 'lucide-x');
        remove.onclick = () => {
          try { Desktop.spellcheckDictRemove(word); } catch (e) {}
          this.render();
        };
        row.createDiv('spellchecker-dictionary-word', (w) => w.setText(word));
      });
    }
  }
}

/* -------------------------------------------------------- helpers & suggesters */

/** 原版 1.14.4 滑杆填充：--slider-fill-ratio 随值更新，setValue 也要同步。 */
export function trackSliderFill(slider) {
  const el = slider.sliderEl;
  const sync = () => {
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const value = Number(el.value) || 0;
    const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
    el.style.setProperty('--slider-fill-ratio', String(ratio));
  };
  el.addEventListener('input', sync);
  el.addEventListener('change', sync);
  const setValue = slider.setValue.bind(slider);
  slider.setValue = (value) => { const result = setValue(value); sync(); return result; };
  sync();
}

/** 原版正则条件检测：/pattern/ 形式。 */
export function isRegexFilterValue(value) {
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
export class FilePathSuggest extends AbstractInputSuggest {
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
export class FolderPathSuggest extends FilePathSuggest {
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
