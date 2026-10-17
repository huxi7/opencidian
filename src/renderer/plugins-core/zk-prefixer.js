/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/notices.js 的 Notice；依赖 ../core/setting.js 的 SettingGroup；依赖 ../core/vault.js 的 normalizePath；依赖 ./daily-notes.js 的 applyTemplate（{{title}}/{{date}} 变量替换）；moment
 * [OUTPUT]: 导出 nameKey、DEFAULT_OPTIONS、DEFAULT_FORMAT、create(app)（命令 zk-prefixer + ribbon）、settingTab(app, containerEl)
 * [POS]: plugins-core/ 的时间戳笔记插件。插件 id 保持原版 "zk-prefixer"；文案沿用原版 locale 命名空间 plugins.unique-note-creator（1.12 界面名 Unique note creator）。数据 .obsidian/zk-prefixer.json（folder/template/format）。getUniquePath 复刻原版：命名冲突时按 分→时→日→周→月→年 递增直至唯一，无法生成则 Notice。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: zk-prefixer — unique timestamp-prefixed notes. */
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SettingGroup } from '../core/setting.js';
import { normalizePath } from '../core/vault.js';
import { applyTemplate } from './daily-notes.js';

const moment = require('moment');

export const nameKey = 'plugins.unique-note-creator';
export const DATA_FILE = 'zk-prefixer.json';
export const DEFAULT_FORMAT = 'YYYYMMDDHHmm';
export const DEFAULT_OPTIONS = { folder: '', template: '', format: '' };

/* --------------------------------------------------------------------------
 * ZkPrefixer — 插件实例
 * ------------------------------------------------------------------------ */
class ZkPrefixer {
  constructor(app) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS };
    this._ribbonEl = null;
    this._commandIds = [];
  }

  getFormat() {
    const format = this.options.format;
    return format && typeof format === 'string' ? format : DEFAULT_FORMAT;
  }

  /* 原版 getUniquePath：格式串生成的名称已存在时逐单位递增。 */
  getUniquePath(suffix = '') {
    const files = this.app.vault.getFiles();
    const exists = (name) => files.some((f) => f.name.startsWith(name));
    const now = moment();
    const format = this.getFormat();
    let name = now.format(format);
    if (suffix) name += ' ' + suffix;
    if (exists(name)) {
      let unit = '';
      for (const u of ['m', 'h', 'd', 'w', 'M', 'y']) {
        if (now.clone().add(1, u).format(format) !== name) { unit = u; break; }
      }
      if (!unit) {
        new Notice(tt('plugins.unique-note-creator.msg-failed-to-generate',
          'Failed to generate a unique note with the format "{{format}}"', { format }));
        return null;
      }
      let cursor = now.clone();
      for (;;) {
        const candidate = cursor.add(1, unit).format(format);
        if (!exists(candidate)) { name = candidate; break; }
      }
    }
    return name;
  }

  /** 原版 onCreateNote：解析目标文件夹/模板，创建并打开笔记。 */
  async onCreateNote() {
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
        const templateFile = this.app.metadataCache.getFirstLinkpathDest(this.options.template, '');
        if (!templateFile) {
          new Notice(tt('plugins.unique-note-creator.msg-template-file-not-found',
            'Failed to create unique note. Template file "{{template}}" not found.', { template: this.options.template }));
          return null;
        }
        const raw = await this.app.vault.cachedRead(templateFile);
        const content = applyTemplate(raw, { title: name }, {});
        file = await this.app.fileManager.createNewMarkdownFile(folder, name, content);
      } else {
        file = await this.app.fileManager.createNewMarkdownFile(folder, name);
      }
      await this.app.workspace.openFile(file);
      return file;
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
      return null;
    }
  }

  onload() {
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'sheets-in-box',
      tt('plugins.unique-note-creator.action-create-note', 'Create new unique note'),
      () => this.onCreateNote(),
    );
    this.app.commands.addCommand({
      id: 'zk-prefixer',
      name: tt('plugins.unique-note-creator.action-create-note', 'Create new unique note'),
      icon: 'box-glyph',
      callback: () => this.onCreateNote(),
    });
    this._commandIds.push('zk-prefixer');
  }

  onunload() {
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
export function settingTab(app, containerEl) {
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
        .onChange((value) => { options.format = value.trim(); save(); });
    });
  });
  return group;
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app) {
  const plugin = new ZkPrefixer(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // 公开 API
    onCreateNote: () => plugin.onCreateNote(),
    getUniquePath: (suffix) => plugin.getUniquePath(suffix),
    getFormat: () => plugin.getFormat(),
    getOptions: () => plugin.options,
  };
}
