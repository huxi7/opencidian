/**
 * [INPUT]: SuggestModal 提供模糊建议；i18n 与 vault 提供文案和路径。
 *          宿主提供文件列表、文件打开、命令与功能区。
 * [OUTPUT]: 导出 nameKey、create(app)，注册快速切换命令与功能区入口。
 * [POS]: 快速切换器列出 Markdown、画布与最近打开文件。
 *        功能区复用打开命令；重复加载不新增入口，卸载删除入口与命令。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: switcher — quick switcher for files (Mod+O), with create-on-enter. */
import { SuggestModal, fuzzyMatch, renderHighlightedText } from '../core/suggest.js';
import { t } from '../core/i18n.js';
import { normalizePath, parentPathOf } from '../core/vault.js';

export const nameKey = 'plugins.quick-switcher';

class QuickSwitcherModal extends SuggestModal {
  constructor(app, options = {}) {
    super(app);
    this.modalEl.addClass('mod-quick-switcher');
    this.options = options;
    this.emptyStateText = 'No results found.';
    this.history = app.workspace.lastOpenFiles || [];
  }
  getPlaceholder() { return t('plugins.quick-switcher.action-open') || 'Open quick switcher'; }
  getInstructions() {
    return [
      { command: '↑↓', purpose: t('plugins.quick-switcher.instruction-navigate') || 'to navigate' },
      { command: '↵', purpose: t('plugins.quick-switcher.instruction-open') || 'to open' },
      { command: '⌘↵', purpose: t('plugins.quick-switcher.instruction-open-in-new-tab') || 'to open in new tab' },
      { command: 'esc', purpose: 'to dismiss' },
    ];
  }
  getSuggestions(query) {
    const files = this.app.vault.getMarkdownFiles().concat(this.app.vault.getFiles().filter((f) => f.extension === 'canvas'));
    const out = [];
    if (!query) {
      const recent = this.app.workspace.lastOpenFiles || [];
      for (const path of recent) {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f) out.push({ file: f, score: 1000 - out.length, isHistory: true, matches: [] });
      }
      const seen = new Set(out.map((o) => o.file.path));
      for (const f of files) {
        if (out.length >= 50) break;
        if (seen.has(f.path)) continue;
        out.push({ file: f, score: 1, matches: [] });
      }
      return out;
    }
    for (const file of files) {
      // allow "folder/file" matching
      const target = file.path.replace(/\.md$/, '');
      const m = fuzzyMatch(query, target) || fuzzyMatch(query, file.basename);
      if (m) out.push({ file, score: m.score + (target.toLowerCase().startsWith(query.toLowerCase()) ? 20 : 0), matches: m.matches });
      if (out.length > 500) break;
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 50);
  }
  renderSuggestion(item, el) {
    const titleEl = el.createDiv('suggestion-title');
    const file = item.file;
    if (this.inputEl.value) {
      const target = file.path.replace(/\.md$/, '');
      const m = fuzzyMatch(this.inputEl.value, target) || fuzzyMatch(this.inputEl.value, file.basename);
      if (m) renderHighlightedText(titleEl, file.basename, m.matches.filter((i) => i < file.basename.length));
      else titleEl.setText(file.basename);
    } else {
      titleEl.setText(file.basename);
    }
    if (item.isHistory) el.createDiv({ cls: 'suggestion-note', text: 'Recent' });
    el.createDiv({ cls: 'suggestion-note', text: parentPathOf(file.path) === '/' ? '/' : parentPathOf(file.path) });
  }
  onChooseSuggestion(item, ev) {
    const file = item.file;
    if (typeof file === 'string') {
      this._createAndOpen(file, ev);
      return;
    }
    this.app.workspace.openFile(file, { newLeaf: (ev && (ev.metaKey || ev.ctrlKey)) ? 'tab' : false });
  }
  async _createAndOpen(query, ev) {
    const leaf = this.app.workspace.getLeavesOfType('markdown')[0];
    const active = this.app.workspace.getActiveFile();
    const folder = this.app.fileManager.getNewFileParent(active ? active.path : '');
    const name = this.app.fileManager.getUniqueFilename(folder, query, '.md');
    const file = await this.app.fileManager.createNewMarkdownFile(folder, name + '.md', '');
    const opened = await this.app.workspace.openFile(file, { newLeaf: (ev && (ev.metaKey || ev.ctrlKey)) ? 'tab' : false });
    if (opened && opened.view && opened.view.focusInlineTitle) setTimeout(() => opened.view.focusInlineTitle(), 30);
  }
}

export function create(app) {
  let ribbonEl = null;
  return {
    onload() {
      if (ribbonEl) return;
      app.commands.addCommand({
        id: 'switcher:open',
        name: t('plugins.quick-switcher.action-open') || 'Open quick switcher',
        icon: 'file-search',
        callback: () => new QuickSwitcherModal(app).open(),
      });
      ribbonEl = app.workspace.addRibbonItem(
        'lucide-file-search',
        t('plugins.quick-switcher.action-open') || 'Open quick switcher',
        (ev) => app.commands.executeCommandById('switcher:open', ev),
      );
      ribbonEl.setAttr('data-command-id', 'switcher:open');
    },
    onunload() {
      ribbonEl?.detach();
      ribbonEl = null;
      this.deregisterCommands();
    },
    deregisterCommands() {
      app.commands.removeCommand('switcher:open');
    },
  };
}
