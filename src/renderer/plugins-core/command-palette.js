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
    const nameEl = el.createDiv('suggestion-title');
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
  return {
    onload() {
      this.registerCommands(app);
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
