/**
 * [INPUT]: 依赖 core 的翻译、通知、设置与路径 API；复用 daily-notes 的变量替换和 Markdown 创建；依赖 moment。
 * [OUTPUT]: 导出唯一笔记与 insert-unique-link 命令、settingTab 及命名 API。
 * [POS]: 唯一前缀逐时间单位递增并串行创建。循环格式有终止边界；冲突保留标题后缀，配置保存后立即生效。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: zk-prefixer — unique timestamp-prefixed notes. */
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SettingGroup } from '../core/setting.js';
import { normalizePath } from '../core/vault.js';
import { applyTemplate, createMarkdownNote } from './daily-notes.js';

const moment = require('moment');

export const nameKey = 'plugins.unique-note-creator';
export const DATA_FILE = 'zk-prefixer.json';
export const DEFAULT_FORMAT = 'YYYYMMDDHHmm';
export const DEFAULT_OPTIONS = { folder: '', template: '', format: '' };

/* --------------------------------------------------------------------------
 * ZkPrefixer — 插件实例
 * ------------------------------------------------------------------------ */
class ZkPrefixer {
  declare app: App;
  declare options: any;
  declare _ribbonEl: any;
  declare _commandIds: any[];
  declare _creation: any;
  declare _settingsRef: any;

  constructor(app: App) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS };
    this._ribbonEl = null;
    this._commandIds = [];
    this._creation = Promise.resolve();
  }

  getFormat() {
    const format = this.options.format;
    return format && typeof format === 'string' ? format : DEFAULT_FORMAT;
  }

  /* 原版 getUniquePath：格式串生成的名称已存在时逐单位递增。 */
  getUniquePath(suffix = '') {
    const files = this.app.vault.getFiles();
    const exists = (name) => files.some((f) => f.name.toLowerCase().startsWith(name.toLowerCase()));
    const now = moment();
    const format = this.getFormat();
    const base = now.format(format);
    const withSuffix = (prefix) => prefix + (suffix ? ' ' + suffix : '');
    let name = withSuffix(base);
    if (exists(name)) {
      let unit = '';
      for (const u of ['m', 'h', 'd', 'w', 'M', 'y']) {
        if (now.clone().add(1, u).format(format) !== base) { unit = u; break; }
      }
      if (!unit) {
        new Notice(tt('plugins.unique-note-creator.msg-failed-to-generate',
          'Failed to generate a unique note with the format "{{format}}"', { format }));
        return null;
      }
      const cursor = now.clone();
      const seen = new Set([name]);
      while (seen.size <= files.length + 1) {
        const candidate = withSuffix(cursor.add(1, unit).format(format));
        if (seen.has(candidate)) break;
        if (!exists(candidate)) return candidate;
        seen.add(candidate);
      }
      new Notice(tt('plugins.unique-note-creator.msg-failed-to-generate',
        'Failed to generate a unique note with the format "{{format}}"', { format }));
      return null;
    }
    return name;
  }

  /** 原版 onCreateNote：解析目标文件夹/模板，创建并打开笔记。 */
  async onCreateNote(ev) {
    const result = this._creation.then(() => this.createNote(ev));
    this._creation = result.catch(() => null);
    return result;
  }

  async createNote(ev) {
    const name = this.getUniquePath();
    if (!name) return null;
    let folder = null;
    const folderOption = this.options.folder;
    if (folderOption && typeof folderOption === 'string') {
      folder = this.app.vault.getFolderByPath(normalizePath(folderOption));
      if (!folder) {
        new Notice(tt('plugins.unique-note-creator.msg-folder-not-found',
          'Failed to create unique note. Folder "{{folderOption}}" not found.', { folderOption }));
        return null;
      }
    } else {
      folder = this.app.fileManager.getNewFileParent('');
    }
    try {
      let file;
      if (this.options.template) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(this.options.template, '');
        const templateFile = dest ? this.app.vault.getFileByPath(dest) : null;
        if (!templateFile) {
          new Notice(tt('plugins.unique-note-creator.msg-template-file-not-found',
            'Failed to create unique note. Template file "{{template}}" not found.', { template: this.options.template }));
          return null;
        }
        const raw = await this.app.vault.cachedRead(templateFile);
        const content = applyTemplate(raw, { title: name }, {});
        file = await createMarkdownNote(this.app, folder, name, content);
      } else {
        file = await createMarkdownNote(this.app, folder, name);
      }
      await this.app.workspace.openFile(file, { newLeaf: !!(ev?.metaKey || ev?.ctrlKey), eState: { mode: 'source' } });
      return file;
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
      return null;
    }
  }

  onload() {
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    this._settingsRef = this.app.settings.on('change', () => {
      Object.assign(this.options, this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS));
    });
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'sheets-in-box',
      tt('plugins.unique-note-creator.action-create-note', 'Create new unique note'),
      (ev) => this.onCreateNote(ev),
    );
    this.app.commands.addCommand({
      id: 'zk-prefixer',
      name: tt('plugins.unique-note-creator.action-create-note', 'Create new unique note'),
      icon: 'box-glyph',
      callback: (ev) => this.onCreateNote(ev),
    });
    this._commandIds.push('zk-prefixer');
    this.app.commands.addCommand({
      id: 'insert-unique-link',
      name: tt('plugins.unique-note-creator.action-add-link', 'Insert unique note link'),
      icon: 'lucide-link',
      editorCallback: (editor) => {
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        const name = this.getUniquePath(editor.getRange(from, to));
        if (!name) return;
        const start = editor.posToOffset(from) + 2;
        const selected = editor.somethingSelected();
        editor.replaceSelection('[[' + name + ']]');
        editor.setSelection(editor.offsetToPos(selected ? start : start + name.length), editor.offsetToPos(start + name.length));
      },
    });
    this._commandIds.push('insert-unique-link');
  }

  onunload() {
    this._settingsRef?.unregister();
    this._settingsRef = null;
    if (this._ribbonEl) { this._ribbonEl.detach(); this._ribbonEl = null; }
    this.deregisterCommands();
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }
}

/* --------------------------------------------------------------------------
 * 设置页（原版 Mee：文件夹 → 模板 → 时间戳格式）
 * ------------------------------------------------------------------------ */
export function settingTab(app: App, containerEl) {
  const options = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
  const save = () => app.settings.savePluginData(DATA_FILE, options);
  const group = new SettingGroup(containerEl);
  group.setHeading(tt('plugins.unique-note-creator.name', 'Unique note creator'));
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.unique-note-creator.option-new-file-location', 'New file location'))
      .setDesc(tt('plugins.unique-note-creator.option-new-file-location-description', 'The folder path to create the new unique note in.'))
      .addText((component) => {
        component
          .setPlaceholder(tt('setting.folder-path-example-placeholder', 'Example: folder 1/folder 2'))
          .setValue(options.folder)
          .onChange((value) => { options.folder = value.trim(); save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.unique-note-creator.option-template-file', 'Template file location'))
      .setDesc(tt('plugins.unique-note-creator.option-template-file-description', 'The file path to use as template.'))
      .addText((component) => {
        component
          .setPlaceholder(tt('plugins.unique-note-creator.option-template-file-placeholder', 'Example: folder1/note'))
          .setValue(options.template)
          .onChange((value) => { options.template = value.trim(); save(); });
      });
  });
  group.addSetting((setting) => {
    setting.setName(tt('plugins.unique-note-creator.option-id-format', 'Unique prefix format'));
    // 描述是片段：语法说明 + moment 文档链接 + 换行 + 实时样例（原版 Mee）
    const desc = setting.descEl;
    desc.empty();
    desc.appendChild(document.createTextNode(tt('plugins.daily-notes.label-refer-to-syntax', 'For more syntax, refer to ')));
    desc.createEl('a', {
      text: tt('plugins.daily-notes.label-syntax-link', 'format reference'),
      attr: { href: 'https://momentjs.com/docs/#/displaying/format/', target: '_blank' },
    });
    desc.createEl('br');
    desc.appendChild(document.createTextNode(tt('plugins.daily-notes.label-syntax-live-preview', 'Your current syntax looks like this: ')));
    const sampleEl = desc.createEl('b', 'u-pop');
    setting.addMomentFormat((component) => {
      component
        .setSampleEl(sampleEl)
        .setDefaultFormat(DEFAULT_FORMAT)
        .setValue(options.format)
        .onChange((value) => { options.format = value.trim(); component.updateSample(); save(); });
      component.updateSample();
    });
  });
  return group;
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app: App) {
  const plugin = new ZkPrefixer(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // 公开 API
    onCreateNote: (ev) => plugin.onCreateNote(ev),
    getUniquePath: (suffix) => plugin.getUniquePath(suffix),
    getFormat: () => plugin.getFormat(),
    getOptions: () => plugin.options,
  };
}
