/**
 * [INPUT]: 依赖 core 的设置控件、建议弹窗、路径与属性解析；依赖 daily-notes 的变量替换及 js-yaml 的属性序列化。
 *          宿主命令检查编辑器可用性；workspace 提供功能区入口。
 * [OUTPUT]: 导出模板命令、settingTab、parseNote、mergeProperties、joinNote。注册模板功能区入口。
 * [POS]: 模板使用当前编辑器插入正文并合并属性。配置保存后同步实例；属性语法错误阻止修改，日期插入使用宿主 setSelection 定位。
 *        属性函数供 note-composer 复用。功能区执行插入命令；启停对称释放入口、命令和设置监听。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: templates — insert template file contents at the cursor. */
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SuggestModal, fuzzyMatch, renderHighlightedText } from '../core/suggest.js';
import { SettingGroup } from '../core/setting.js';
import { normalizePath } from '../core/vault.js';
import { parseFrontmatterText } from '../core/metadata.js';
import { applyTemplate, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from './daily-notes.js';

const moment = require('moment');
const yaml = require('js-yaml');

export const nameKey = 'plugins.templates';

export const DEFAULT_OPTIONS = { folder: '', dateFormat: '', timeFormat: '' };

const DATA_FILE = 'templates.json';

/** 复用宿主 YAML 解析，但禁止将非法属性静默丢弃。 */
export function parseNote(text) {
  const note = parseFrontmatterText(text);
  if (note.error) throw note.error;
  if (Array.isArray(note.frontmatter) || note.frontmatter instanceof Date) {
    throw new Error('Note properties must be a mapping.');
  }
  return note;
}

/** 属性按键合并；列表去重，已有非空值不被 null 覆盖。 */
export function mergeProperties(target, source) {
  for (const key of Object.keys(source)) {
    const before = Object.hasOwn(target, key) ? target[key] : undefined;
    const after = source[key];
    let value = after;
    if (before && after === null) continue;
    if (Array.isArray(before) && Array.isArray(after)) value = [...new Set([...before, ...after])];
    else if (before && after && before.constructor === Object && after.constructor === Object) {
      value = mergeProperties({ ...before }, after);
    }
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return target;
}

export function joinNote(properties, body) {
  return Object.keys(properties).length
    ? '---\n' + yaml.dump(properties, { lineWidth: -1, noRefs: true }).trimEnd() + '\n---\n' + body
    : body;
}

/* --------------------------------------------------------------------------
 * 模板选择弹窗 — 对齐原版 bee 弹窗：列出模板文件夹内 md，按路径排序
 * ------------------------------------------------------------------------ */
class TemplateSuggestModal extends SuggestModal {
  getInstructions() { return this.instructions || super.getInstructions(); }
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
    this._ribbonEl = null;
  }

  onload() {
    if (this._ribbonEl) return;
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    this._settingsRef = this.app.settings.on('change', () => {
      Object.assign(this.options, this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS));
    });
    const add = (command) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'insert-template',
      name: t('plugins.templates.action-insert') || 'Insert template',
      icon: 'lucide-copy',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType('markdown');
        if (!view?.editor || view.mode === 'preview') return false;
        if (!checking) this.onInsertTemplate();
        return true;
      },
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
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'lucide-files',
      t('plugins.templates.action-insert') || 'Insert template',
      (ev) => this.app.commands.executeCommandById('insert-template', ev),
    );
    this._ribbonEl.setAttr('data-command-id', 'insert-template');
  }

  onunload() {
    this._ribbonEl?.detach();
    this._ribbonEl = null;
    this._settingsRef?.unregister();
    this._settingsRef = null;
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
    try {
      const raw = await this.app.vault.cachedRead(templateFile);
      const text = applyTemplate(raw, { title: sourceFile ? sourceFile.basename : '' }, {
        dateFormat: this.options.dateFormat || DEFAULT_DATE_FORMAT,
        timeFormat: this.options.timeFormat || DEFAULT_TIME_FORMAT,
      });
      const cursor = ed.getCursor('from');
      const atStart = cursor.line === 0 && cursor.ch === 0;
      if (atStart) ed.replaceSelection(text);
      else {
        const template = parseNote(text);
        if (!Object.keys(template.frontmatter).length) ed.replaceSelection(template.body);
        else {
          const current = ed.getValue();
          const note = parseNote(current);
          const headerLength = current.length - note.body.length;
          const from = Math.max(0, ed.posToOffset(cursor) - headerLength);
          const to = Math.max(from, ed.posToOffset(ed.getCursor('to')) - headerLength);
          const body = note.body.slice(0, from) + template.body + note.body.slice(to);
          const merged = joinNote(mergeProperties(note.frontmatter, template.frontmatter), body);
          ed.replaceRange(merged, { line: 0, ch: 0 }, ed.offsetToPos(current.length));
          ed.setSelection(ed.offsetToPos(merged.length - body.length + from + template.body.length));
        }
      }
      ed.focus();
      return text;
    } catch (error) {
      new Notice(String(error.message || error));
      return '';
    }
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
    editor.setSelection(editor.offsetToPos(offset + text.length));
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
