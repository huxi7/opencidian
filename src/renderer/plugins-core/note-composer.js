/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/notices.js 的 Notice；依赖 ../core/suggest.js 的 SuggestModal/fuzzyMatch/renderHighlightedText；依赖 ../core/modals.js 的 confirmDialog；依赖 ../core/setting.js 的 SettingGroup；依赖 ./daily-notes.js 的 applyTemplate
 * [OUTPUT]: 导出 nameKey、create(app)（命令 note-composer:merge-file / note-composer:split-file / note-composer:extract-heading）、settingTab(app,containerEl)
 * [POS]: plugins-core/ 的笔记重组插件。数据 .obsidian/note-composer.json（askBeforeMerging/replacementText/template）。合并=把当前笔记追加/前插到目标笔记后删除当前文件；提取=把选中内容写入目标笔记并在原处替换为链接/嵌入/无。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: note-composer — merge files and extract selections. */
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SuggestModal, fuzzyMatch, renderHighlightedText } from '../core/suggest.js';
import { confirmDialog } from '../core/modals.js';
import { SettingGroup } from '../core/setting.js';
import { applyTemplate } from './daily-notes.js';

export const nameKey = 'plugins.note-composer';

export const DEFAULT_OPTIONS = { askBeforeMerging: true, replacementText: 'link', template: '' };

const DATA_FILE = 'note-composer.json';

/* --------------------------------------------------------------------------
 * 文件选择弹窗基类 — 对齐原版合并/提取弹窗：
 *   ↵ 追加 / shift ↵ 前插 / mod ↵ 新建笔记后合并
 * ------------------------------------------------------------------------ */
class FileSuggestModal extends SuggestModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.currentFile = null;
    this.emptyStateText = t('plugins.note-composer.label-no-files') || 'No files found.';
    this.setPlaceholder(t('plugins.note-composer.prompt-select-file-to-merge') || 'Select file to merge into...');
    this.setInstructions([
      { command: '↑↓', purpose: t('plugins.note-composer.instruction-navigate') || 'to navigate' },
      { command: '↵', purpose: t('plugins.note-composer.instruction-merge') || 'to merge into the selected note' },
      { command: 'mod ↵', purpose: t('plugins.note-composer.instruction-create-new') || 'to create new note and merge' },
      { command: 'shift ↵', purpose: t('plugins.note-composer.instruction-merge-at-top') || 'to merge at the top' },
      { command: 'esc', purpose: t('plugins.note-composer.instruction-dismiss') || 'to dismiss' },
    ]);
  }
  setCurrentFile(file) { this.currentFile = file; }
  getFiles() {
    return this.app.vault.getMarkdownFiles()
      .filter((f) => !this.currentFile || f.path !== this.currentFile.path)
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  getSuggestions(query) {
    const files = this.getFiles();
    if (!query) return files.slice(0, this.limit);
    const out = [];
    for (const file of files) {
      const match = fuzzyMatch(query, file.path);
      if (match) out.push({ file, score: match.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, this.limit).map((o) => o.file);
  }
  renderSuggestion(file, el, query) {
    const match = query ? fuzzyMatch(query, file.path) : null;
    if (match) renderHighlightedText(el, file.path, match.matches);
    else el.setText(file.path);
  }
  onInputKeyDown(ev) {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      this.createNewAndChoose(ev.shiftKey);
      return;
    }
    super.onInputKeyDown(ev);
  }
  async createNewAndChoose(prepend) {
    const name = this.inputEl.value.trim();
    if (!name || !this.currentFile) return;
    this.close();
    try {
      const folder = this.app.fileManager.getNewFileParent(this.currentFile.path);
      const file = await this.app.fileManager.createNewMarkdownFile(folder, name);
      await this.onChooseTarget(file, { shiftKey: !!prepend });
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
    }
  }
  async onChooseTarget(file, ev) {}
  onChooseSuggestion(file, ev) {
    this.onChooseTarget(file, ev || {});
  }
}

/* --------------------------------------------------------------------------
 * NoteComposer — 插件实例
 * ------------------------------------------------------------------------ */
class NoteComposer {
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
      id: 'note-composer:merge-file',
      name: t('plugins.note-composer.command-merge-file') || 'Merge current file with another file',
      icon: 'lucide-git-merge',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.openMergeModal(file);
        return true;
      },
    });
    add({
      id: 'note-composer:split-file',
      name: t('plugins.note-composer.command-split-file') || 'Extract current selection to a new note',
      icon: 'lucide-scissors',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType('markdown');
        const editor = view && view.editor;
        if (!editor || !view.file || !editor.somethingSelected()) return false;
        if (!checking) this.openSplitModal(editor, view.file);
        return true;
      },
    });
    add({
      id: 'note-composer:extract-heading',
      name: t('plugins.note-composer.command-extract-heading') || 'Extract current heading',
      icon: 'lucide-scissors',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType('markdown');
        const editor = view && view.editor;
        if (!editor || !view.file) return false;
        if (checking) return this.getSelectionUnderHeading(view.file, editor) !== null;
        this.extractHeading(view.file, editor);
        return true;
      },
    });
  }

  onunload() {
    this.deregisterCommands();
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  /* ---------------------------------------------------------------- 弹窗 */
  openMergeModal(currentFile) {
    const modal = new FileSuggestModal(this.app, this);
    modal.setCurrentFile(currentFile);
    modal.onChooseTarget = (target, ev) => {
      const mode = ev && ev.shiftKey ? 'prepend' : 'append';
      this.mergeFile(target, currentFile, mode);
    };
    modal.open();
  }

  openSplitModal(editor, currentFile, defaultName) {
    const modal = new FileSuggestModal(this.app, this);
    modal.setCurrentFile(currentFile);
    if (defaultName) modal.inputEl.value = defaultName;
    modal.onChooseTarget = (target, ev) => {
      const mode = ev && ev.shiftKey ? 'prepend' : 'append';
      this.splitSelection(target, editor, currentFile, mode);
    };
    modal.open();
  }

  /* ---------------------------------------------------------------- 合并 */
  /** 把 current 的内容追加/前插到 target，然后删除 current。 */
  async mergeFile(target, current, mode = 'append', skipConfirm = false) {
    if (!target || !current || target.path === current.path) return;
    if (this.options.askBeforeMerging && !skipConfirm) {
      const ok = await confirmDialog(
        this.app,
        t('plugins.note-composer.label-merge-file') || 'Merge file',
        t('plugins.note-composer.label-confirm-file-merge', { file: current.basename, destination: target.basename })
          || `Are you sure you want to merge "${current.basename}" into "${target.basename}"? "${current.basename}" will be deleted after merging.`,
        { cta: t('plugins.note-composer.button-merge') || 'Merge', warning: true },
      );
      if (!ok) return;
    }
    try {
      const content = await this.app.vault.read(current);
      const text = await this.applyComposerTemplate(content, current.basename, target.basename);
      await this.insertIntoFile(target, text, mode);
      await this.deleteFile(current);
      await this.app.workspace.openFile(target);
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
    }
  }

  /* ---------------------------------------------------------------- 提取 */
  /** 把编辑器选中内容写入 target，原处替换为链接/嵌入/无。 */
  async splitSelection(target, editor, currentFile, mode = 'append') {
    if (!target || !editor || !currentFile) return;
    /* 本复刻 editor.getSelection() 返回 {anchor,head}；选中文本用 getRange 取。 */
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const selection = editor.getRange(from, to);
    if (!selection) return;
    try {
      const text = await this.applyComposerTemplate(selection, currentFile.basename, target.basename);
      await this.insertIntoFile(target, text, mode);
      const link = this.app.fileManager.generateMarkdownLink(target, currentFile.path);
      const replacementText = this.options.replacementText || 'link';
      const replacement = replacementText === 'embed' ? '!' + link : replacementText === 'none' ? '' : link;
      editor.replaceRange(replacement, from, to);
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
    }
  }

  extractHeading(file, editor) {
    const range = this.getSelectionUnderHeading(file, editor);
    if (!range) {
      new Notice(t('plugins.note-composer.msg-fail-to-find-heading') || 'Failed to find heading');
      return;
    }
    editor.setSelection(range.start, range.end);
    this.openSplitModal(editor, file, range.heading);
  }

  /** 光标所在小节的起止范围（原版 getSelectionUnderHeading）。 */
  getSelectionUnderHeading(file, editor) {
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache && cache.headings;
    if (!headings || !headings.length) return null;
    const line = editor.getCursor().line;
    let current = null;
    let currentLevel = 0;
    let next = null;
    for (const heading of headings) {
      if (current && heading.level <= currentLevel) { next = heading; break; }
      if (!current && heading.position.start.line === line) {
        current = heading;
        currentLevel = heading.level;
      }
    }
    if (!current) return null;
    let endLine = next ? next.position.start.line - 1 : editor.lineCount() - 1;
    while (endLine > line && editor.getLine(endLine).trim() === '') endLine--;
    return {
      heading: current.heading.trim(),
      start: { line, ch: 0 },
      end: { line: endLine, ch: editor.getLine(endLine).length },
    };
  }

  /* ---------------------------------------------------------------- 工具 */
  /** 模板套用（原版 applyTemplate）：{{content}}/{{fromTitle}}/{{newTitle}} + 日期时间。 */
  async applyComposerTemplate(content, fromTitle, newTitle) {
    if (!this.options.template) return content;
    /* getFirstLinkpathDest 返回路径字符串，须经 getFileByPath 转 TFile。 */
    const dest = this.app.metadataCache.getFirstLinkpathDest(this.options.template, '');
    const templateFile = dest ? this.app.vault.getFileByPath(dest) : null;
    if (!templateFile) {
      new Notice(t('plugins.note-composer.msg-fail-to-fetch-template', { template: this.options.template }) || `Failed to fetch template: template file "${this.options.template}" not found.`);
      return content;
    }
    let template = await this.app.vault.cachedRead(templateFile);
    if (!template.includes('{{content}}')) template += '\n\n{{content}}';
    return applyTemplate(template, { fromTitle, newTitle, content }, {});
  }

  /** 向文件追加/前插内容。前插跳过 YAML 属性区（原版 contentStart 语义）。 */
  async insertIntoFile(file, text, mode = 'append') {
    const current = await this.app.vault.read(file);
    let out;
    if (mode === 'prepend') {
      const lines = current.split('\n');
      let insertAt = 0;
      if (lines[0] !== undefined && lines[0].trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === '---' || lines[i].trim() === '...') { insertAt = i + 1; break; }
        }
      }
      const head = lines.slice(0, insertAt).join('\n');
      const rest = lines.slice(insertAt).join('\n');
      out = (head ? head + '\n\n' : '') + text + (rest ? '\n\n' + rest : '');
    } else {
      out = current.endsWith('\n') || !current ? current + '\n' + text : current + '\n\n' + text;
    }
    await this.app.vault.modify(file, out);
  }

  /** 合并后删除源文件（走回收站策略，不再二次确认）。 */
  async deleteFile(file) {
    const trashOption = this.app.settings.appSettings.trashOption;
    await this.app.vault.delete(file, trashOption === 'permanent');
  }
}

/* --------------------------------------------------------------------------
 * 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）
 * ------------------------------------------------------------------------ */
export function settingTab(app, containerEl) {
  const options = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
  const save = () => app.settings.savePluginData(DATA_FILE, options);
  const group = new SettingGroup(containerEl);
  group.setHeading(t('plugins.note-composer.name') || 'Note composer');
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.note-composer.option-confirm-file-merge') || 'Confirm file merge')
      .setDesc(t('plugins.note-composer.option-confirm-file-merge-description') || 'Ask for confirmation before merging two notes.')
      .addToggle((component) => {
        component.setValue(options.askBeforeMerging !== false)
          .onChange((value) => { options.askBeforeMerging = value; save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.note-composer.option-split-replacement-text') || 'Replacement text after extracting')
      .setDesc(t('plugins.note-composer.option-split-replacement-text-description') || 'What to replace the original content with after moving it.')
      .addDropdown((component) => {
        component
          .addOption('link', t('plugins.note-composer.option-choice-split-replacement-text-link') || 'Link to the note')
          .addOption('embed', t('plugins.note-composer.option-choice-split-replacement-text-embed') || 'Embed the note')
          .addOption('none', t('plugins.note-composer.option-choice-split-replacement-text-none') || 'Nothing')
          .setValue(options.replacementText || 'link')
          .onChange((value) => { options.replacementText = value; save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.note-composer.option-template-file') || 'Template file location')
      .setDesc(t('plugins.note-composer.option-template-file-description') || 'Template used when merging or extracting notes. Supports {{content}}, {{fromTitle}}, {{newTitle}}, {{date:FORMAT}}.')
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
  const plugin = new NoteComposer(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // public API
    mergeFile: (target, current, mode, skipConfirm) => plugin.mergeFile(target, current, mode, skipConfirm),
    splitSelection: (target, editor, currentFile, mode) => plugin.splitSelection(target, editor, currentFile, mode),
    insertIntoFile: (file, text, mode) => plugin.insertIntoFile(file, text, mode),
    getOptions: () => plugin.options,
  };
}
