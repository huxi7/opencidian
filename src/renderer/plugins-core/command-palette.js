/**
 * [INPUT]: SuggestModal 提供模糊建议；i18n 与 keymap 提供文案和快捷键显示。
 *          宿主提供命令列表、命令分派与功能区。
 * [OUTPUT]: 导出 nameKey、create(app)，注册命令面板命令与功能区入口。
 * [POS]: 命令面板按可用性筛选并保留最近使用顺序。
 *        功能区复用打开命令；重复加载不新增入口，卸载删除入口与命令。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: command-palette — fuzzy command runner (Mod+P). */
import { SuggestModal, fuzzyMatch, renderHighlightedText } from '../core/suggest.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { hotkeyToString } from '../core/keymap.js';

export const nameKey = 'plugins.command-palette';

class CommandPaletteModal extends SuggestModal {
  constructor(app) {
    super(app);
    this.modalEl.addClass('mod-command-palette');
    this.limit = 50;
    this.emptyStateText = t('plugins.command-palette.label-no-commands') || 'No commands found.';
  }
  getPlaceholder() {
    return t('plugins.command-palette.placeholder') || t('plugins.command-palette.action-open', {}) || 'Type a command...';
  }
  getInstructions() {
    return [
      { command: '↑↓', purpose: t('plugins.command-palette.instruction-navigate') || 'to navigate' },
      { command: '↵', purpose: t('plugins.command-palette.instruction-use') || 'to use' },
      { command: 'esc', purpose: t('plugins.command-palette.instruction-dismiss') || 'to dismiss' },
    ];
  }
  getSuggestions(query) {
    const commands = this.app.commands.listCommands();
    // check availability
    const available = commands.filter((cmd) => {
      try {
        if (cmd.checkCallback) return !!cmd.checkCallback(true);
        if (cmd.editorCheckCallback) {
          const view = this.app.workspace.activeLeaf && this.app.workspace.activeLeaf.view;
          return !!(view && view.editor);
        }
        return true;
      } catch (e) { return false; }
    });
    if (!query) {
      // recently used first
      const recent = this.app._recentCommands || [];
      const recentSet = new Set(recent);
      const recents = recent.map((id) => available.find((c) => c.id === id)).filter(Boolean);
      const others = available.filter((c) => !recentSet.has(c.id));
      return [...recents, ...others];
    }
    const out = [];
    for (const cmd of available) {
      const name = this.app.commands.getDisplayName ? this.app.commands.getDisplayName(cmd) : cmd.name;
      const target = cmd.name + ' ' + (cmd.id.split(':')[0] || '');
      const m = fuzzyMatch(query, target);
      if (m) out.push({ cmd, score: m.score, matches: m.matches, name });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 200).map((o) => o.cmd);
  }
  renderSuggestion(cmd, el) {
    // 原版 app.css 9003-9045：命令项为 .suggestion-item.mod-complex——标题进 .suggestion-content 列，
    // 热键是 item 的直接子元素，同一行靠右显示
    el.toggleClass('mod-complex', true);
    const content = el.createDiv('suggestion-content');
    const nameEl = content.createDiv('suggestion-title');
    const name = cmd.name || cmd.id;
    const m = fuzzyMatch(this.inputEl.value, cmd.name + ' ' + (cmd.id.split(':')[0] || ''));
    if (m && this.inputEl.value) renderHighlightedText(nameEl, name, m.matches.slice(0, name.length));
    else nameEl.setText(name);
    const hks = this.app.hotkeyManager ? this.app.hotkeyManager.getHotkeys(cmd.id) : [];
    if (hks && hks.length) {
      el.createDiv({ cls: 'suggestion-hotkey' }, (h) => h.setText(hotkeyToString(hks[0])));
    }
  }
  onChooseSuggestion(cmd) {
    if (cmd.id) {
      this.app._recentCommands = [cmd.id, ...(this.app._recentCommands || []).filter((id) => id !== cmd.id)].slice(0, 20);
      this.app.commands.executeCommandById(cmd.id);
    }
  }
}

export function create(app) {
  let ribbonEl = null;
  return {
    onload() {
      if (ribbonEl) return;
      this.registerCommands(app);
      ribbonEl = app.workspace.addRibbonItem(
        'lucide-terminal',
        t('plugins.command-palette.action-open') || 'Open command palette',
        (ev) => app.commands.executeCommandById('command-palette:open', ev),
      );
      ribbonEl.setAttr('data-command-id', 'command-palette:open');
    },
    onunload() {
      ribbonEl?.detach();
      ribbonEl = null;
      this.deregisterCommands();
    },
    deregisterCommands() {
      app.commands.removeCommand('command-palette:open');
    },
    registerCommands(app) {
      app.commands.addCommand({
        id: 'command-palette:open',
        name: t('plugins.command-palette.action-open') || 'Open command palette',
        icon: 'terminal',
        callback: () => new CommandPaletteModal(app).open(),
      });
    },
  };
}
