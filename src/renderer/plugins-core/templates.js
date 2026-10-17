/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/notices.js 的 Notice；依赖 ../core/suggest.js 的 SuggestModal/fuzzyMatch/renderHighlightedText；依赖 ../core/setting.js 的 SettingGroup；依赖 ./daily-notes.js 的 applyTemplate/DEFAULT_DATE_FORMAT/DEFAULT_TIME_FORMAT
 * [OUTPUT]: 导出 nameKey、create(app)（命令 insert-template / insert-current-date / insert-current-time）、settingTab(app,containerEl)
 * [POS]: plugins-core/ 的模板插件。数据 .obsidian/templates.json（folder/dateFormat/timeFormat）。模板选择弹窗列出模板文件夹内全部 md；插入时经 applyTemplate 替换 {{date}}/{{time}}/{{title}}，光标在文档开头时写入含属性区的完整模板，否则只插入正文部分（原版经属性编辑器合并属性，此处简化）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: templates — insert template file contents at the cursor. */
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SuggestModal, fuzzyMatch, renderHighlightedText } from '../core/suggest.js';
import { SettingGroup } from '../core/setting.js';
import { normalizePath } from '../core/vault.js';
import { applyTemplate, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from './daily-notes.js';

const moment = require('moment');

export const nameKey = 'plugins.templates';

export const DEFAULT_OPTIONS = { folder: '', dateFormat: '', timeFormat: '' };

const DATA_FILE = 'templates.json';

/* 模板文件去掉 YAML 属性区后的正文（原版 gI() 的简化版）。 */
function stripFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] === undefined || lines[0].trim() !== '---') return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') {
      return lines.slice(i + 1).join('\n').replace(/^\n+/, '');
    }
  }
  return text;
}

/* --------------------------------------------------------------------------
 * 模板选择弹窗 — 对齐原版 bee 弹窗：列出模板文件夹内 md，按路径排序
 * ------------------------------------------------------------------------ */
class TemplateSuggestModal extends SuggestModal {
  constructor(app, plugin, folderPath) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
    this.templateFiles = plugin.collectTemplates();
    this.emptyStateText = t('plugins.templates.msg-no-templates-found') || 'No templates found.';
    this.setPlaceholder(t('plugins.templates.prompt-type-template') || 'Type name of template...');
    this.setInstructions([
      { command: '↑↓', purpose: t('plugins.templates.instruction-navigate') || 'to navigate' },
      { command: '↵', purpose: t('plugins.templates.instruction-insert') || 'to insert template' },
      { command: 'esc', purpose: t('plugins.templates.instruction-dismiss') || 'to dismiss' },
    ]);
  }
  getItemText(file) {
    const prefix = this.folderPath === '/' ? '' : this.folderPath + '/';
    const rel = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    return rel.replace(/\.md$/i, '');
  }
  getSuggestions(query) {
    if (!query) return this.templateFiles.slice();
    const out = [];
    for (const file of this.templateFiles) {
      const match = fuzzyMatch(query, this.getItemText(file));
      if (match) out.push({ file, score: match.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map((o) => o.file);
  }
  renderSuggestion(file, el, query) {
    const text = this.getItemText(file);
    const match = query ? fuzzyMatch(query, text) : null;
    if (match) renderHighlightedText(el, text, match.matches);
    else el.setText(text);
  }
  onChooseSuggestion(file) {
    this.plugin.insertTemplate(file);
  }
}

/* --------------------------------------------------------------------------
 * Templates — 插件实例
 * ------------------------------------------------------------------------ */
class Templates {
  constructor(app) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS };
    this._commandIds = [];
  }

  onload() {
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    const add = (command) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'insert-template',
      name: t('plugins.templates.action-insert') || 'Insert template',
      icon: 'lucide-copy',
      callback: () => this.onInsertTemplate(),
    });
    add({
      id: 'insert-current-date',
      name: t('plugins.templates.action-insert-current-date') || 'Insert current date',
      icon: 'lucide-calendar-days',
      editorCallback: (editor) => this.insertCurrentDate(editor),
    });
    add({
      id: 'insert-current-time',
      name: t('plugins.templates.action-insert-current-time') || 'Insert current time',
      icon: 'lucide-clock',
      editorCallback: (editor) => this.insertCurrentTime(editor),
    });
  }

  onunload() {
    this.deregisterCommands();
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  /* ---------------------------------------------------------------- helpers */
  /** 模板文件夹；未配置/无效时弹 Notice 并返回 null。 */
  getTemplateFolder() {
    const folderOption = this.options.folder;
    if (!folderOption || typeof folderOption !== 'string') {
      new Notice(t('plugins.templates.msg-no-folder-set') || 'Failed to list templates. No template folder configured.');
      return null;
    }
    const folder = this.app.vault.getFolderByPath(normalizePath(folderOption));
    if (!folder) {
      new Notice(t('plugins.templates.msg-fail-folder-not-found', { folderOption }) || `Failed to insert template. Folder "${folderOption}" not found.`);
      return null;
    }
    if (folder.path === '/') {
      new Notice(t('plugins.templates.msg-fail-invalid-folder') || 'Failed to insert template. Invalid template folder.');
      return null;
    }
    return folder;
  }

  /** 模板文件夹内全部 md 文件，按路径排序。 */
  collectTemplates() {
    const folder = this.options.folder && typeof this.options.folder === 'string'
      ? this.app.vault.getFolderByPath(normalizePath(this.options.folder))
      : null;
    if (!folder) return [];
    const files = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.children) { walk(child); continue; }
        if (child.extension === 'md') files.push(child);
      }
    };
    walk(folder);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  }

  /* ---------------------------------------------------------------- 插入 */
  async onInsertTemplate() {
    const folder = this.getTemplateFolder();
    if (!folder) return;
    const files = this.collectTemplates();
    if (!files.length) {
      new Notice(t('plugins.templates.msg-no-templates-found') || 'No templates found.');
      return;
    }
    new TemplateSuggestModal(this.app, this, folder.path).open();
  }

  /**
   * 把模板文件内容插入当前编辑器光标处。
   * editor/file 省略时取活动 markdown 视图。返回替换后的完整文本。
   */
  async insertTemplate(templateFile, editor, file) {
    const view = this.app.workspace.getActiveViewOfType('markdown');
    const ed = editor || (view && view.editor);
    const sourceFile = file || (view && view.file);
    if (!ed) return '';
    const raw = await this.app.vault.cachedRead(templateFile);
    const text = applyTemplate(raw, { title: sourceFile ? sourceFile.basename : '' }, {
      dateFormat: this.options.dateFormat || DEFAULT_DATE_FORMAT,
      timeFormat: this.options.timeFormat || DEFAULT_TIME_FORMAT,
    });
    const cursor = ed.getCursor('from');
    const atStart = cursor.line === 0 && cursor.ch === 0;
    if (atStart) ed.replaceSelection(text);
    else ed.replaceSelection(stripFrontmatter(text));
    ed.focus();
    return text;
  }

  insertCurrentDate(editor) {
    const ed = editor || (this.app.workspace.getActiveViewOfType('markdown') || {}).editor;
    if (!ed) return;
    this.insertText(ed, moment().format(this.options.dateFormat || DEFAULT_DATE_FORMAT));
  }

  insertCurrentTime(editor) {
    const ed = editor || (this.app.workspace.getActiveViewOfType('markdown') || {}).editor;
    if (!ed) return;
    this.insertText(ed, moment().format(this.options.timeFormat || DEFAULT_TIME_FORMAT));
  }

  insertText(editor, text) {
    const head = editor.getCursor('head');
    const offset = editor.posToOffset(head);
    editor.replaceRange(text, head);
    editor.setCursor(editor.offsetToPos(offset + text.length));
  }
}

/* --------------------------------------------------------------------------
 * 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）
 * ------------------------------------------------------------------------ */
export function settingTab(app, containerEl) {
  const options = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
  const save = () => app.settings.savePluginData(DATA_FILE, options);
  const group = new SettingGroup(containerEl);
  group.setHeading(t('plugins.templates.name') || 'Templates');
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.templates.option-template-folder-location') || 'Template folder location')
      .setDesc(t('plugins.templates.option-template-folder-location-description') || 'Files in this folder will be available as templates.')
      .addText((component) => {
        component
          .setPlaceholder(t('setting.folder-path-example-placeholder') || 'Example: folder 1/folder 2')
          .setValue(options.folder)
          .onChange((value) => { options.folder = value.trim(); save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.templates.option-template-date-format') || 'Date format')
      .setDesc(t('plugins.templates.option-template-date-format-description') || '{{date}} in the template file will be replaced with a date using this format.')
      .addMomentFormat((component) => {
        component
          .setPlaceholder(DEFAULT_DATE_FORMAT)
          .setDefaultFormat(DEFAULT_DATE_FORMAT)
          .setValue(options.dateFormat)
          .onChange((value) => { options.dateFormat = value.trim(); save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.templates.option-template-time-format') || 'Time format')
      .setDesc(t('plugins.templates.option-template-time-format-description') || '{{time}} in the template file will be replaced with a time using this format.')
      .addMomentFormat((component) => {
        component
          .setPlaceholder(DEFAULT_TIME_FORMAT)
          .setDefaultFormat(DEFAULT_TIME_FORMAT)
          .setValue(options.timeFormat)
          .onChange((value) => { options.timeFormat = value.trim(); save(); });
      });
  });
  return group;
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app) {
  const plugin = new Templates(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // public API
    insertTemplate: (file, editor, sourceFile) => plugin.insertTemplate(file, editor, sourceFile),
    collectTemplates: () => plugin.collectTemplates(),
    getOptions: () => plugin.options,
  };
}
