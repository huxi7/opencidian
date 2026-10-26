/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/modals.js 的 Modal；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/suggest.js 的 AbstractInputSuggest；依赖 ../core/vault.js 的 TFolder；依赖 ../core/icons.js 的 setIcon；Node 内置 fs/path
 * [OUTPUT]: 导出 VERSION、StartupTimeModal、VimTestModal、SpellcheckDictModal、ThemeManagerModal、openFontPage、listFontCandidates、AddExcludedFilterModal、trackSliderFill、addSliderValue、isRegexFilterValue、fontExists、readInstalledThemes、FilePathSuggest、FolderPathSuggest
 * [POS]: views/ 的设置页签配套件。弹窗与路径建议器从 settings-tabs.js 拆出，供关于/编辑器/文件/外观页复用；只依赖 core，不反向依赖页签类。ThemeManagerModal 对齐原版 1.14.4 的社区主题弹窗骨架（mod-community-modal.mod-sidebar-layout.mod-community-theme + community-item 列表），但只列本机 .obsidian/themes 已安装主题（原版依赖社区目录，本复刻无该目录）。openFontPage 是原版 Ire 字体子页面（说明段 + 当前字体列表 + 字体建议组）。AddExcludedFilterModal 对齐原版 mod-form-sheet 表单弹窗。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Settings-tab support: dialogs, path suggesters, shared helpers. */
import { tt } from '../core/i18n.js';
import { Modal } from '../core/modals.js';
import { Setting, SettingGroup, SliderComponent } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { AbstractInputSuggest } from '../core/suggest.js';
import { TFolder } from '../core/vault.js';
import { setIcon } from '../core/icons.js';
import { SettingsHost } from './settings-view.js';

const fs = require('fs');
const nodePath = require('path');

// 版本单一事实源：主进程 version 通道（1.14.4）。渲染层不再写死版本号。
export const VERSION = (() => {
  try {
    const value = Desktop.version();
    return typeof value === 'string' && value ? value : '1.14.4';
  } catch (e) {
    return '1.14.4';
  }
})();

/**
 * 原版 wne 的桌面分支：Device 行（桌面隐藏）、Operating system、OpenSidian + Installer，
 * 然后是 Total app startup 与启动计时树。OpenSidian 没有分段埋点，计时树只保留总计。
 * 类名 mod-plugin-debug 触发原版启动统计弹窗样式（settings-dialogs.css）。
 */
export class StartupTimeModal extends Modal {
  constructor(app: App) {
    super(app);
    this.setTitle('Startup time');
    this.modalEl.addClass('mod-lg', 'mod-scrollable-content', 'mod-plugin-debug');
    const totalMs = Math.max(0, performance.now() - (app.bootTime || performance.now()));
    const total = Math.round(totalMs) + 'ms';
    const statsEl = this.contentEl.createDiv('startup-stat-list');
    const addStat = (label: string, value: string|null, desc?: string|undefined) => {
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
  declare onConfirm: (ok: boolean) => void;

  constructor(app: App, onConfirm: (ok: boolean) => void) {
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

/**
 * 原版 1.14.4「忽略文件」子页面的新增表单弹窗：mod-lg.mod-form-sheet，
 * 单输入框 + form-field-help 说明 + 完成/取消按钮。
 */
export class AddExcludedFilterModal extends Modal {
  declare onAdd: (value: string) => void;
  declare inputEl: HTMLInputElement;

  constructor(app: App, onAdd: (value: string) => void) {
    super(app);
    this.onAdd = onAdd;
    this.setTitle(tt('setting.file.title-add-excluded-filter', '添加排除项'));
    this.modalEl.addClass('mod-lg', 'mod-form-sheet');
    const field = this.contentEl.createEl('p', { cls: 'form-field' });
    field.createEl('label');
    this.inputEl = field.createEl('input', { type: 'text', attr: { spellcheck: 'false' } });
    field.createDiv('form-field-help').setText(tt('setting.file.help-excluded-filter', '输入路径或正则表达式，例如 /daily-.*/'));
    const buttons = this.contentEl.createDiv('modal-button-container');
    buttons.createEl('button', { cls: 'mod-cta', text: tt('dialogue.button-done', '完成') })
      .addEventListener('click', () => {
        const value = this.inputEl.value.trim();
        if (!value) {
          new Notice(tt('setting.file.message-empty-filter', '条件不可为空'));
          return;
        }
        this.close();
        if (this.onAdd) this.onAdd(value);
      });
    buttons.createEl('button', { text: tt('dialogue.button-cancel', '取消') })
      .addEventListener('click', () => this.close());
  }
}

/** 拼写检查词典弹窗（原版 ite）：自加词列表 + 移除。 */
export class SpellcheckDictModal extends Modal {
  constructor(app: App) {
    super(app);
    this.setTitle(tt('setting.editor.spellcheck-dict', '拼写检查词典'));
  }
  onOpen() { this.render(); }
  render() {
    this.contentEl.empty();
    let words: string[] = [];
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

/**
 * 读取本机已安装主题（原版 customCss.readThemes）：
 * 现代主题 = themes/<name>/manifest.json 且 manifest.name 与目录同名；
 * 旧版主题 = themes/ 下的裸 .css 文件（显示带 “ (Legacy)” 后缀）。
 */
export function readInstalledThemes(settingsDir: string) {
  const dir = nodePath.join(settingsDir, 'themes');
  const themes: Array<{ name: string; dir: string; legacy: boolean }> = [];
  const legacy: Array<{ name: string; dir: null; legacy: boolean }> = [];
  try {
    if (!fs.existsSync(dir)) return { themes, legacy };
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const manifestPath = nodePath.join(dir, entry.name, 'manifest.json');
        try {
          if (!fs.existsSync(manifestPath)) continue;
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (!manifest || manifest.name !== entry.name) continue;
        } catch (e) { continue; }
        themes.push({ name: entry.name, dir: nodePath.join(dir, entry.name), legacy: false });
      } else if (entry.name.toLowerCase().endsWith('.css')) {
        legacy.push({ name: entry.name.replace(/\.css$/i, ''), dir: null, legacy: true });
      }
    }
  } catch (e) { /* 目录不可读时返回空列表 */ }
  return { themes, legacy };
}

/**
 * 主题管理弹窗：对齐原版 1.14.4「社区主题」弹窗的骨架
 * （.modal.mod-community-modal.mod-sidebar-layout.mod-community-theme，
 *   .community-modal-search 搜索 + .community-modal-search-summary 计数 +
 *   .community-modal-search-results 里的 .community-item 卡片）。
 * 原版数据来自社区主题目录；OpenSidian 无该目录，故只列 .obsidian/themes 下已安装主题，
 * 保留“默认”项、截图位与“使用中”徽标。
 */
export class ThemeManagerModal extends Modal {
  declare app: App;
  declare onChange: () => void;
  declare selected: string;

  constructor(app: App, onChange: () => void) {
    super(app);
    this.app = app;
    this.onChange = onChange;
    this.selected = '';
    this.modalEl.addClass('mod-community-modal', 'mod-sidebar-layout', 'mod-community-theme');
    this.setTitle(tt('setting.appearance.label-installed-themes', '已安装主题'));
  }

  onOpen() { this.render(); }

  /** 主题截图：读 theme/screenshot.png 转 data URL；缺失时用占位图标。 */
  screenshotUrl(dir: string | null | undefined) {
    if (!dir) return '';
    try {
      const file = nodePath.join(dir, 'screenshot.png');
      if (!fs.existsSync(file)) return '';
      const buf = fs.readFileSync(file);
      return 'data:image/png;base64,' + buf.toString('base64');
    } catch (e) { return ''; }
  }

  render() {
    const app = this.app;
    const current = String(app.settings.appearance.cssTheme || '');
    const { themes, legacy } = readInstalledThemes(app.settings.dir);
    const all: Array<{ name: string; label?: string; dir?: string | null; legacy: boolean }> = [{ name: '', label: tt('setting.appearance.label-default-theme', '默认'), legacy: false }, ...themes, ...legacy];
    if (!this.selected) this.selected = current;

    const content = this.contentEl;
    content.empty();
    const body = content.createDiv('community-modal-body');
    const sidebar = body.createDiv('modal-sidebar');
    const controls = sidebar.createDiv('community-modal-controls');
    const searchWrap = controls.createDiv('community-modal-search');
    const searchContainer = searchWrap.createDiv('search-input-container mod-raised');
    const input = searchContainer.createEl('input', { type: 'search', attr: { enterkeyhint: 'search', spellcheck: 'false' } });
    input.setAttribute('placeholder', tt('plugins.custom-css.prompt-filter', '搜索…'));
    const clearBtn = searchContainer.createDiv('search-input-clear-button');
    clearBtn.addEventListener('click', () => { input.value = ''; this.render(); });

    const wrapper = body.createDiv('community-modal-search-results-wrapper');
    const emptyState = wrapper.createDiv('community-modal-empty-state');
    emptyState.hide();
    const status = wrapper.createDiv('community-modal-search-results-status');
    status.hide();
    const results = wrapper.createDiv('community-modal-search-results');

    const query = String(input.value || '').trim().toLowerCase();
    const filtered = all.filter((item) => !query || item.name.toLowerCase().includes(query));
    // 原版：计数行 = labelSearchSummary(themeCount: nouns.themeWithCount(n))
    const themeCount = tt('nouns.theme-with-count', '{{count}} 个主题', { count: filtered.length });
    controls.createDiv('community-modal-search-summary u-muted')
      .setText(tt('plugins.custom-css.label-search-summary', '显示 {{themeCount}}:', { themeCount }));

    for (const item of filtered) {
      const label = item.name || item.label || '';
      const card = results.createDiv('community-item tappable');
      if (item.name === this.selected) card.addClass('mod-active');
      const nameEl = card.createDiv('community-item-name');
      nameEl.setText(label);
      if (item.name === current) nameEl.createSpan({ cls: 'flair mod-pop', text: tt('setting.appearance.label-currently-active', '使用中') });
      else if (item.legacy) nameEl.createSpan({ cls: 'flair', text: tt('plugins.custom-css.label-legacy', '旧版') });
      else if (item.name) nameEl.createSpan({ cls: 'flair', text: tt('plugins.custom-css.label-installed', '已下载') });
      const screenshot = this.screenshotUrl(item.dir);
      if (screenshot) {
        const img = card.createEl('img', { cls: 'community-item-screenshot', attr: { alt: label, loading: 'lazy' } });
        img.src = screenshot;
      } else {
        const holder = card.createDiv('community-item-screenshot mod-unavailable');
        setIcon(holder.createDiv('placeholder-icon'), 'lucide-camera-off');
      }
      card.addEventListener('click', () => {
        this.selected = item.name;
        this.render();
      });
    }
    if (!filtered.length) {
      emptyState.setText(tt('setting.no-search-results', '未找到设置。'));
      emptyState.show();
    }

    const footer = content.createDiv('community-modal-button-container');
    const active = String(app.settings.appearance.cssTheme || '');
    if (active) {
      footer.createEl('button', { text: tt('plugins.custom-css.label-stop-use', '禁用该主题') })
        .addEventListener('click', () => {
          app.settings.updateAppearance({ cssTheme: '' });
          this.selected = '';
          this.close();
          if (this.onChange) this.onChange();
        });
    }
    const useBtn = footer.createEl('button', { cls: 'mod-cta', text: tt('plugins.custom-css.label-use', '使用') });
    useBtn.disabled = this.selected === active;
    useBtn.addEventListener('click', () => {
      app.settings.updateAppearance({ cssTheme: this.selected });
      this.close();
      if (this.onChange) this.onChange();
    });
  }
}

/** 字体候选（对齐原版 Lre 系统字体清单的常用子集 + 浏览器已加载字体）。 */
export function listFontCandidates() {
  const common = ['Inter', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara',
    'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console',
    'Menlo', 'Microsoft YaHei', 'Monaco', 'Noto Sans', 'PingFang SC', 'Segoe UI', 'SimSun',
    'Songti SC', 'Times New Roman', 'Verdana', '微软雅黑', '苹方', '等线'];
  const loaded = [];
  try { if (document.fonts) for (const face of document.fonts) loaded.push(String(face.family).replace(/^"|"$/g, '')); } catch (e) {}
  return [...new Set([...loaded, ...common])];
}

/**
 * 字体子页面（原版 Ire）：
 * .setting-page-content > p.setting-page-desc + 两个 .setting-group.mod-list
 *  - 当前字体：每行 .setting-item（名称按自身字体预览 + 缺失提示 mod-warning + 删除钮 + 拖拽手柄）
 *  - 字体建议：搜索框 + .setting-items 里的 mod-action tappable 行（含手输字体行）
 * 变更立即落盘（原版 onChange → setConfig(key, fonts.join(','))）。
 */
export function openFontPage(setting: SettingsHost, app: App, options: { title?: string; key: string; }) {
  const { title, key } = options || {};
  const fonts = String((app.settings.appearance || {})[key] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const commit = (next: string[]) => app.settings.updateAppearance({ [key]: next.join(',') });
  setting.openPage({
    title: title || '',
    build: (contentEl: HTMLElement) => renderFontPage(contentEl, app, fonts, commit),
  });
}

/** 字体页渲染（原版 Ire.display）。 */
function renderFontPage(containerEl: HTMLElement, app: App, fonts: string[], commit: (next: string[]) => void) {
  containerEl.empty();
  const descEl = containerEl.createEl('p', { cls: 'setting-page-desc' });

  /* 当前字体列表 */
  let dragFont: string|null = null;
  const listGroup = new SettingGroup(containerEl);
  listGroup.addClass('mod-list');
  const renderList = () => {
    descEl.setText(fonts.length
      ? tt('setting.appearance.label-font-applied', '列表中第一种字体将被应用。若该字体不存在于当前设备上，则顺延至存在于当前设备上的字体。')
      : tt('setting.appearance.label-no-custom-font-set', '当前未指定自定义字体。请在下方添加一个。'));
    listGroup.listEl.empty();
    fonts.forEach((font: string) => {
      const setting = new Setting(listGroup.listEl);
      setting.setName(font);
      setting.nameEl.style.fontFamily = font;
      if (!fontExists(font)) {
        setting.setDesc(tt('setting.appearance.msg-font-not-found', '系统中不存在此字体。'));
        setting.descEl.addClass('mod-warning');
      }
      setting.addExtraButton((b) => b
        .setIcon('lucide-x')
        .setTooltip(tt('interface.delete-action-short-name', '删除'))
        .onClick(() => {
          fonts.splice(fonts.indexOf(font), 1);
          commit(fonts);
          renderList();
          renderSuggest();
        }));
      setting.addExtraButton((b) => {
        b.setIcon('lucide-menu');
        b.setTooltip(tt('interface.drag-to-rearrange', '拖动可调整布局'));
        b.extraSettingsEl.addClass('mod-drag-handle');
        b.extraSettingsEl.setAttr('tabindex', '-1');
      });
      // 原版：手柄拖拽重排
      const handle = setting.controlEl.querySelector<HTMLElement>('.mod-drag-handle');
      if (handle) {
        handle.setAttr('draggable', 'true');
        handle.addEventListener('dragstart', (ev) => {
          dragFont = font;
          setting.settingEl.addClass('is-being-dragged');
          try { ev.dataTransfer?.setData('text/plain', font); } catch (e) {}
        });
        handle.addEventListener('dragend', () => setting.settingEl.removeClass('is-being-dragged'));
      }
      setting.settingEl.addEventListener('dragover', (ev) => {
        if (!dragFont) return;
        ev.preventDefault();
        setting.settingEl.addClass('is-drop-target');
      });
      setting.settingEl.addEventListener('dragleave', () => setting.settingEl.removeClass('is-drop-target'));
      setting.settingEl.addEventListener('drop', (ev) => {
        ev.preventDefault();
        setting.settingEl.removeClass('is-drop-target');
        const from = dragFont;
        dragFont = null;
        if (!from || from === font) return;
        const fromIndex = fonts.indexOf(from);
        const toIndex = fonts.indexOf(font);
        if (fromIndex < 0 || toIndex < 0) return;
        fonts.splice(fromIndex, 1);
        fonts.splice(toIndex, 0, from);
        commit(fonts);
        renderList();
      });
    });
  };

  /* 字体建议 */
  const suggestGroup = new SettingGroup(containerEl);
  suggestGroup.addClass('mod-list');
  let searchInput: HTMLInputElement|null = null;
  suggestGroup.addSearch((search) => {
    searchInput = search.inputEl;
    search.setPlaceholder(tt('setting.appearance.option-font-placeholder', '请输入字体名称…'));
    search.onChange(() => renderSuggest());
  });
  const renderSuggest = () => {
    const query = (searchInput && searchInput.value ? searchInput.value : '').trim();
    const lower = query.toLowerCase();
    suggestGroup.listEl.empty();
    suggestGroup.listEl.addClass('is-loading');
    const candidates = listFontCandidates();
    const addSuggestion = (name: string, isManual: boolean) => {
      const row = new Setting(suggestGroup.listEl);
      row.setClass('mod-action');
      row.setClass('tappable');
      row.setName(name);
      row.nameEl.style.fontFamily = name;
      row.nameEl.style.color = 'var(--text-normal)';
      if (isManual && !fontExists(name)) {
        row.setDesc(tt('setting.appearance.msg-font-not-found', '系统中不存在此字体。'));
        row.descEl.addClass('mod-warning');
      }
      row.settingEl.addEventListener('click', () => {
        fonts.push(name);
        commit(fonts);
        renderList();
        renderSuggest();
      });
    };
    for (const name of candidates) {
      if (fonts.includes(name)) continue;
      if (query && !name.toLowerCase().includes(lower)) continue;
      addSuggestion(name, false);
    }
    if (query && !fonts.includes(query) && !candidates.some((n) => n.toLowerCase() === lower)) {
      addSuggestion(query, true);
    }
    suggestGroup.listEl.removeClass('is-loading');
  };

  renderList();
  renderSuggest();
}

/* -------------------------------------------------------- helpers & suggesters */

/** 原版 1.14.4 滑杆填充：--slider-fill-ratio 随值更新，setValue 也要同步。 */
export function trackSliderFill(slider: SliderComponent) {
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
export function isRegexFilterValue(value: string) {
  return /^\/.+\/$/.test(String(value || '').trim());
}

/**
 * 原版 SliderComponent 在输入框前放一个 .slider-value 文本（显示格式化后的当前值）。
 * core/setting.js 只读，这里在页签侧补齐，并随滑块输入同步。
 */
export function addSliderValue(setting: Setting, slider: SliderComponent, format: (value: number) => string) {
  const valueEl = setting.controlEl.createSpan('slider-value');
  setting.controlEl.insertBefore(valueEl, slider.sliderEl);
  const sync = () => valueEl.setText(format(slider.getValue()));
  slider.sliderEl.addEventListener('input', sync);
  slider.sliderEl.addEventListener('change', sync);
  sync();
  return valueEl;
}

/**
 * 字体是否存在（原版字体检测的等价实现）。
 * Chromium 的 document.fonts.check 对未知族也返回 true，这里用“与回退字体测量宽度对比”判定：
 * 未知字体在所有回退族下的宽度都与回退一致；已安装/已加载字体至少一个回退下的宽度不同。
 */
const fontExistsCache = new Map();
export function fontExists(font: string) {
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

/** 递归收集仓库内文件夹相对路径（建议列表用）。 */
function collectFolderPaths(app: App) {
  const out: string[] = [];
  const walk = (folder: TFolder) => {
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
export class FilePathSuggest extends AbstractInputSuggest<string> {
  getSuggestions(query: string) {
    const q = String(query || '').toLowerCase();
    return this.app.vault.getFiles()
      .map((f) => f.path)
      .filter((p) => !q || p.toLowerCase().includes(q))
      .slice(0, 30);
  }
  renderSuggestion(path: string, el: HTMLDivElement) { el.setText(path); }
  selectSuggestion(path: string) {
    this.inputEl.value = path;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}

/** 文件夹路径建议。 */
export class FolderPathSuggest extends FilePathSuggest {
  getSuggestions(query: string) {
    const q = String(query || '').toLowerCase();
    return collectFolderPaths(this.app)
      .filter((p) => !q || p.toLowerCase().includes(q))
      .slice(0, 30);
  }
}

/** 忽略文件条件的路径建议：选择即触发 onSelect（弹窗内自动添加）。 */
class ExcludedPathSuggest extends FilePathSuggest {
  declare onSelect: (item: unknown) => void;

  selectSuggestion(path: string) {
    super.selectSuggestion(path);
    if (typeof this.onSelect === 'function') this.onSelect(path);
  }
}
