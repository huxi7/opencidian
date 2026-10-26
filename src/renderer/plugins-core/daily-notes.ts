/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/notices.js 的 Notice；依赖 ../core/setting.js 的 SettingGroup；依赖 ../core/vault.js 的 normalizePath；依赖 moment
 * [OUTPUT]: 导出日记命令、settingTab、applyTemplate 与 createMarkdownNote。后两者供模板、重组及唯一笔记复用。
 * [POS]: 日记按日期路径复用文件，并串行创建以阻止重复日记。配置保存后同步运行实例；嵌套日期路径进入 vault 文件树。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: daily-notes — open or create today's daily note. */
import { Command,CommandDefinition } from '../core/commands.js';
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SettingGroup } from '../core/setting.js';
import { normalizePath, TFile, TFolder, VaultEntry } from '../core/vault.js';

import moment, { type Moment } from 'moment';
import type { EventRef } from '../core/events.js';

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
export function applyTemplate(text: string|null|undefined, vars: Record<string, unknown> | null | undefined, options: { dateFormat?: string; timeFormat?: string } = {}) {
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
  let now: Moment | null = null;
  out = out.replace(/{{(date|time)(?::(.*?))?}}/gi, (match, kind, fmt) => {
    if (!now) now = moment();
    if (fmt) return now.format(fmt);
    if (kind.toLowerCase() === 'date') return now.format(options.dateFormat || DEFAULT_DATE_FORMAT);
    return now.format(options.timeFormat || DEFAULT_TIME_FORMAT);
  });
  return out;
}

/** 补齐 Markdown 后缀和父文件夹。创建仍交给 fileManager 的唯一命名入口。 */
export async function createMarkdownNote(app: App, folder: TFolder, name: string, content = '') {
  if (!name || /[\\:*?"<>|\r\n]/.test(name) || name.startsWith('/') ||
      name.split('/').some((part) => !part.trim() || part.startsWith('.'))) {
    throw new Error('Invalid note name: ' + name);
  }
  const parts = name.split('/');
  let parent = folder;
  for (const part of parts.slice(0, -1)) {
    const path = normalizePath((parent.path === '/' ? '' : parent.path + '/') + part);
    parent = app.vault.getFolderByPath(path) || await app.vault.createFolder(path);
  }
  const filename = parts[parts.length - 1];
  return app.fileManager.createNewMarkdownFile(parent, /\.md$/i.test(filename) ? filename : filename + '.md', content);
}

/* --------------------------------------------------------------------------
 * DailyNotes — 插件实例
 * ------------------------------------------------------------------------ */
class DailyNotes {
  declare app: App;
  declare options: typeof DEFAULT_OPTIONS;
  declare _ribbonEl: HTMLDivElement | null;
  declare _commandIds: string[];
  declare _creation: Promise<TFile | null | void>;
  declare _settingsRef: EventRef | null;

  constructor(app: App) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS };
    this._ribbonEl = null;
    this._commandIds = [];
    this._creation = Promise.resolve();
  }

  onload() {
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    this._settingsRef = this.app.settings.on('change', () => {
      Object.assign(this.options, this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS));
    });
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'calendar',
      t('plugins.daily-notes.action-open') || "Open today's daily note",
      (ev) => this.onOpenDailyNote(ev),
    );
    this._registerCommands();
  }

  onunload() {
    this._settingsRef?.unregister();
    this._settingsRef = null;
    this.deregisterCommands();
    if (this._ribbonEl) { this._ribbonEl.detach(); this._ribbonEl = null; }
  }

  saveOptions() {
    this.app.settings.savePluginData(DATA_FILE, this.options);
  }

  _registerCommands() {
    const add = (command: Command|CommandDefinition) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'daily-notes',
      name: t('plugins.daily-notes.action-open') || "Open today's daily note",
      icon: 'lucide-calendar-days',
      callback: (ev) => this.onOpenDailyNote(ev),
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
  getDailyNotePath(date?: Moment) {
    const m = date || moment();
    let name;
    try {
      name = m.format(this.getFormat());
    } catch (e) {
      new Notice(t('plugins.daily-notes.msg-fail-format', { format: this.getFormat() }) || `Failed to create daily note. "${this.getFormat()}" is not a valid format.`);
      return null;
    }
    if (name) name = name.trim();
    const folder = this.options.folder ? this.getFolder() : this.app.fileManager.getNewFileParent('');
    if (!folder) {
      new Notice(t('plugins.daily-notes.msg-fail-folder', { folderOption: this.options.folder }) || `Failed to create daily note. Folder "${this.options.folder}" not found.`);
      return null;
    }
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    return normalizePath(prefix + name + '.md');
  }

  /** 打开（不存在则创建）指定日期的日记。其他插件/命令可调用。 */
  async getDailyNote(date?: Moment) {
    const result = this._creation.then(() => this.createDailyNote(date));
    this._creation = result.catch(() => null);
    return result;
  }

  async createDailyNote(date?: Moment) {
    const m = date || moment();
    let name;
    try {
      name = m.format(this.getFormat());
    } catch (e) {
      new Notice(t('plugins.daily-notes.msg-fail-format', { format: this.getFormat() }) || `Failed to create daily note. "${this.getFormat()}" is not a valid format.`);
      return null;
    }
    if (name) name = name.trim();
    const folder = this.options.folder ? this.getFolder() : this.app.fileManager.getNewFileParent('');
    if (!folder) {
      new Notice(t('plugins.daily-notes.msg-fail-folder', { folderOption: this.options.folder }) || `Failed to create daily note. Folder "${this.options.folder}" not found.`);
      return null;
    }
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    const path = normalizePath(prefix + name + '.md');
    const existing = this.app.vault.getFiles().find((file) => file.path.toLowerCase() === path.toLowerCase());
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
        return await createMarkdownNote(this.app, folder, name, content);
      }
      return await createMarkdownNote(this.app, folder, name);
    } catch (e) {
      new Notice(String(e instanceof Error ? e.message : e));
      return null;
    }
  }

  async onOpenDailyNote(ev: Event | Pick<MouseEvent, 'metaKey' | 'ctrlKey'> | undefined) {
    const file = await this.getDailyNote();
    if (file) await this.app.workspace.openFile(file, { newLeaf: !!(ev && (('metaKey' in ev && ev.metaKey) || ('ctrlKey' in ev && ev.ctrlKey))), eState: { mode: 'source' } });
  }

  /* ------------------------------------------------------ prev/next 导航 */
  iterateDailyNotes(callback: (file: TFile, timestamp: number) => void) {
    const format = this.getFormat();
    const folder = this.getFolder();
    if (!folder) {
      new Notice(t('plugins.daily-notes.msg-missing-folder') || 'Daily notes folder not found.');
      return;
    }
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    const walk = (node: TFolder) => {
      for (const child of node.children || []) {
        if (child instanceof TFolder) { walk(child); continue; }
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

  gotoPreviousExisting(timestamp: number) {
    let best: TFile | null = null;
    let bestTs = Number.NEGATIVE_INFINITY;
    this.iterateDailyNotes((file, ts: number) => {
      if (ts < timestamp && ts > bestTs) { best = file; bestTs = ts; }
    });
    if (best) return this.app.workspace.openFile(best, { eState: { mode: 'source' } });
    else new Notice(t('plugins.daily-notes.msg-no-previous') || 'No older daily notes found.');
  }

  gotoNextExisting(timestamp: number) {
    let best: TFile | null = null;
    let bestTs = Number.POSITIVE_INFINITY;
    this.iterateDailyNotes((file, ts: number) => {
      if (ts > timestamp && ts < bestTs) { best = file; bestTs = ts; }
    });
    if (best) return this.app.workspace.openFile(best, { eState: { mode: 'source' } });
    else new Notice(t('plugins.daily-notes.msg-no-next') || 'No newer daily notes found.');
  }
}

/* --------------------------------------------------------------------------
 * 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）
 * ------------------------------------------------------------------------ */
export function settingTab(app: App, containerEl: HTMLElement) {
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
export function create(app: App) {
  const plugin = new DailyNotes(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // public API — other plugins and commands call these on the instance
    getDailyNote: (date?: Moment) => plugin.getDailyNote(date),
    getDailyNotePath: (date?: Moment) => plugin.getDailyNotePath(date),
    getCurrentFileDateTimestamp: () => plugin.getCurrentFileDateTimestamp(),
    gotoPreviousExisting: (ts: number) => plugin.gotoPreviousExisting(ts),
    gotoNextExisting: (ts: number) => plugin.gotoNextExisting(ts),
    getFormat: () => plugin.getFormat(),
    getFolder: () => plugin.getFolder(),
    getOptions: () => plugin.options,
  };
}
