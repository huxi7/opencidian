/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/notices.js 的 Notice；依赖 ../core/setting.js 的 SettingGroup；依赖 ../core/vault.js 的 normalizePath；依赖 moment
 * [OUTPUT]: 导出 nameKey、create(app)（命令 daily-notes / daily-notes:goto-prev / daily-notes:goto-next + ribbon）、applyTemplate(text,vars,options)（模板变量替换，templates/note-composer 复用）、settingTab(app,containerEl)
 * [POS]: plugins-core/ 的日记插件。数据 .obsidian/daily-notes.json（folder/format/template），实例暴露 getDailyNote/getCurrentFileDateTimestamp 等 API 供其他插件调用。applyTemplate 逐字对齐原版 KD()：先替换 {{title}} 类变量，再替换 {{date[:FORMAT]}}/{{time[:FORMAT]}}。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: daily-notes — open or create today's daily note. */
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SettingGroup } from '../core/setting.js';
import { normalizePath } from '../core/vault.js';

const moment = require('moment');

export const nameKey = 'plugins.daily-notes';

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_TIME_FORMAT = 'HH:mm';
export const DEFAULT_OPTIONS = { folder: '', format: '', template: '' };

const DATA_FILE = 'daily-notes.json';

/* --------------------------------------------------------------------------
 * 模板变量替换 — 原版 KD() 的等价实现
 * 1. {{key}} 逐键替换（大小写不敏感），用于 {{title}} 等
 * 2. {{date[:FORMAT]}} / {{time[:FORMAT]}}：有内联格式用内联，否则用 options
 * ------------------------------------------------------------------------ */
export function applyTemplate(text, vars, options = {}) {
  if (text === undefined || text === null) return '';
  let out = String(text);
  if (vars) {
    for (const key of Object.keys(vars)) {
      const value = vars[key];
      if (value === undefined || value === null) continue;
      const re = new RegExp('{{' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '}}', 'gi');
      out = out.replace(re, () => String(value));
    }
  }
  let now = null;
  out = out.replace(/{{(date|time)(?::(.*?))?}}/gi, (match, kind, fmt) => {
    if (!now) now = moment();
    if (fmt) return now.format(fmt);
    if (kind.toLowerCase() === 'date') return now.format(options.dateFormat || DEFAULT_DATE_FORMAT);
    return now.format(options.timeFormat || DEFAULT_TIME_FORMAT);
  });
  return out;
}

/* --------------------------------------------------------------------------
 * DailyNotes — 插件实例
 * ------------------------------------------------------------------------ */
class DailyNotes {
  constructor(app) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS };
    this._ribbonEl = null;
    this._commandIds = [];
  }

  onload() {
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'calendar',
      t('plugins.daily-notes.action-open') || "Open today's daily note",
      () => this.onOpenDailyNote(),
    );
    this._registerCommands();
  }

  onunload() {
    this.deregisterCommands();
    if (this._ribbonEl) { this._ribbonEl.detach(); this._ribbonEl = null; }
  }

  saveOptions() {
    this.app.settings.savePluginData(DATA_FILE, this.options);
  }

  _registerCommands() {
    const add = (command) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'daily-notes',
      name: t('plugins.daily-notes.action-open') || "Open today's daily note",
      icon: 'lucide-calendar-days',
      callback: () => this.onOpenDailyNote(),
    });
    add({
      id: 'daily-notes:goto-prev',
      name: t('plugins.daily-notes.action-open-previous') || 'Open previous daily note',
      icon: 'lucide-calendar-minus',
      checkCallback: (checking) => {
        const ts = this.getCurrentFileDateTimestamp();
        if (ts === null) return false;
        if (!checking) this.gotoPreviousExisting(ts);
        return true;
      },
    });
    add({
      id: 'daily-notes:goto-next',
      name: t('plugins.daily-notes.action-open-next') || 'Open next daily note',
      icon: 'lucide-calendar-plus',
      checkCallback: (checking) => {
        const ts = this.getCurrentFileDateTimestamp();
        if (ts === null) return false;
        if (!checking) this.gotoNextExisting(ts);
        return true;
      },
    });
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  /* ---------------------------------------------------------------- helpers */
  getFormat() {
    const format = this.options.format;
    return format && typeof format === 'string' ? format : DEFAULT_DATE_FORMAT;
  }

  getFolder() {
    const folderOption = this.options.folder;
    if (folderOption && typeof folderOption === 'string') {
      return this.app.vault.getFolderByPath(normalizePath(folderOption)) || null;
    }
    return this.app.vault.getRoot();
  }

  /** 日记文件路径（不创建）。失败返回 null 并弹 Notice。 */
  getDailyNotePath(date) {
    const m = date || moment();
    let name;
    try {
      name = m.format(this.getFormat());
    } catch (e) {
      new Notice(t('plugins.daily-notes.msg-fail-format', { format: this.getFormat() }) || `Failed to create daily note. "${this.getFormat()}" is not a valid format.`);
      return null;
    }
    if (name) name = name.trim();
    const folder = this.getFolder();
    if (!folder) {
      new Notice(t('plugins.daily-notes.msg-fail-folder', { folderOption: this.options.folder }) || `Failed to create daily note. Folder "${this.options.folder}" not found.`);
      return null;
    }
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    return normalizePath(prefix + name + '.md');
  }

  /** 打开（不存在则创建）指定日期的日记。其他插件/命令可调用。 */
  async getDailyNote(date) {
    const m = date || moment();
    let name;
    try {
      name = m.format(this.getFormat());
    } catch (e) {
      new Notice(t('plugins.daily-notes.msg-fail-format', { format: this.getFormat() }) || `Failed to create daily note. "${this.getFormat()}" is not a valid format.`);
      return null;
    }
    if (name) name = name.trim();
    const folder = this.getFolder();
    if (!folder) {
      new Notice(t('plugins.daily-notes.msg-fail-folder', { folderOption: this.options.folder }) || `Failed to create daily note. Folder "${this.options.folder}" not found.`);
      return null;
    }
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    const path = normalizePath(prefix + name + '.md');
    const existing = this.app.vault.getFileByPath(path);
    if (existing) return existing;
    if (this.app.vault.getAbstractFileByPath(path)) return null;
    try {
      if (this.options.template) {
        /* getFirstLinkpathDest 返回路径字符串，须经 getFileByPath 转 TFile。 */
        const dest = this.app.metadataCache.getFirstLinkpathDest(this.options.template, '');
        const templateFile = dest ? this.app.vault.getFileByPath(dest) : null;
        if (!templateFile) {
          new Notice(t('plugins.daily-notes.msg-fail-template-file', { template: this.options.template }) || `Failed to create daily note. Template file "${this.options.template}" not found.`);
          return null;
        }
        const raw = await this.app.vault.cachedRead(templateFile);
        const content = applyTemplate(raw, { title: name }, {});
        return await this.app.fileManager.createNewMarkdownFile(folder, name, content);
      }
      return await this.app.fileManager.createNewMarkdownFile(folder, name);
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
      return null;
    }
  }

  async onOpenDailyNote() {
    const file = await this.getDailyNote();
    if (file) await this.app.workspace.openFile(file, { eState: { mode: 'source' } });
  }

  /* ------------------------------------------------------ prev/next 导航 */
  iterateDailyNotes(callback) {
    const format = this.getFormat();
    const folder = this.getFolder();
    if (!folder) {
      new Notice(t('plugins.daily-notes.msg-missing-folder') || 'Daily notes folder not found.');
      return;
    }
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.children) { walk(child); continue; }
        if (child.extension !== 'md') continue;
        const rel = child.path.startsWith(prefix) ? child.path.slice(prefix.length) : null;
        if (!rel) continue;
        const m = moment(rel.replace(/\.md$/i, ''), format, true);
        if (m.isValid()) callback(child, m.valueOf());
      }
    };
    walk(folder);
  }

  /** 当前文件若是日记，返回其日期时间戳；否则 null。 */
  getCurrentFileDateTimestamp() {
    const folder = this.getFolder();
    if (!folder) return null;
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') return null;
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    if (!active.path.startsWith(prefix)) return null;
    const rel = active.path.slice(prefix.length);
    const m = moment(rel.replace(/\.md$/i, ''), this.getFormat(), true);
    return m.isValid() ? m.valueOf() : null;
  }

  gotoPreviousExisting(timestamp) {
    let best = null;
    let bestTs = Number.NEGATIVE_INFINITY;
    this.iterateDailyNotes((file, ts) => {
      if (ts < timestamp && ts > bestTs) { best = file; bestTs = ts; }
    });
    if (best) this.app.workspace.openFile(best, { eState: { mode: 'source' } });
    else new Notice(t('plugins.daily-notes.msg-no-previous') || 'No older daily notes found.');
  }

  gotoNextExisting(timestamp) {
    let best = null;
    let bestTs = Number.POSITIVE_INFINITY;
    this.iterateDailyNotes((file, ts) => {
      if (ts > timestamp && ts < bestTs) { best = file; bestTs = ts; }
    });
    if (best) this.app.workspace.openFile(best, { eState: { mode: 'source' } });
    else new Notice(t('plugins.daily-notes.msg-no-next') || 'No newer daily notes found.');
  }
}

/* --------------------------------------------------------------------------
 * 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）
 * ------------------------------------------------------------------------ */
export function settingTab(app, containerEl) {
  const options = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
  const save = () => app.settings.savePluginData(DATA_FILE, options);
  const group = new SettingGroup(containerEl);
  group.setHeading(t('plugins.daily-notes.name') || 'Daily notes');
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.daily-notes.option-date-format') || 'Date format')
      .setDesc(t('plugins.daily-notes.option-date-format-desc') || 'Choose how daily notes are named.')
      .addMomentFormat((component) => {
        component
          .setPlaceholder(DEFAULT_DATE_FORMAT)
          .setDefaultFormat(DEFAULT_DATE_FORMAT)
          .setValue(options.format)
          .onChange((value) => { options.format = value.trim(); save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.daily-notes.option-new-file-location') || 'New file location')
      .setDesc(t('plugins.daily-notes.option-new-file-location-description') || 'Folder where new daily notes will be placed.')
      .addText((component) => {
        component
          .setPlaceholder(t('setting.folder-path-example-placeholder') || 'Example: folder 1/folder 2')
          .setValue(options.folder)
          .onChange((value) => { options.folder = value.trim(); save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.daily-notes.option-template') || 'Template file location')
      .setDesc(t('plugins.daily-notes.option-template-description') || 'Path to the template file for daily notes.')
      .addText((component) => {
        component
          .setPlaceholder(t('setting.file-path-example-placeholder') || 'Example: folder 1/folder 2')
          .setValue(options.template)
          .onChange((value) => { options.template = value.trim(); save(); });
      });
  });
  return group;
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app) {
  const plugin = new DailyNotes(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // public API — other plugins and commands call these on the instance
    getDailyNote: (date) => plugin.getDailyNote(date),
    getDailyNotePath: (date) => plugin.getDailyNotePath(date),
    getCurrentFileDateTimestamp: () => plugin.getCurrentFileDateTimestamp(),
    gotoPreviousExisting: (ts) => plugin.gotoPreviousExisting(ts),
    gotoNextExisting: (ts) => plugin.gotoNextExisting(ts),
    getFormat: () => plugin.getFormat(),
    getFolder: () => plugin.getFolder(),
    getOptions: () => plugin.options,
  };
}
