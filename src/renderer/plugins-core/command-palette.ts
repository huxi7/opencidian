/**
 * [INPUT]: SuggestModal 提供模糊建议；i18n 与 keymap 提供文案和快捷键显示。
 *          宿主提供命令列表、命令分派与功能区。
 * [OUTPUT]: 导出 nameKey、create(app) 与 settingTab(app, containerEl)，注册命令面板命令、功能区入口与“置顶命令”设置页。
 * [POS]: 命令面板按可用性筛选并按「置顶 → 最近使用 → 其余」排序；置顶列表持久化在 .obsidian/command-palette.json。
 *        功能区复用打开命令；重复加载不新增入口，卸载删除入口与命令。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: command-palette — fuzzy command runner (Mod+P). */
import { SuggestModal, fuzzyMatch, renderHighlightedText } from '../core/suggest.js';
import { Setting, SettingGroup } from '../core/setting.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { hotkeyToString } from '../core/keymap.js';

export const nameKey = 'plugins.command-palette';

/** 置顶命令持久化：.obsidian/command-palette.json（与原版核心插件数据文件同一位置）。 */
const DATA_FILE = 'command-palette.json';
const DEFAULT_OPTIONS = { pinned: [] };

function loadOptions(app: App) {
  const data = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
  return { pinned: Array.isArray(data.pinned) ? data.pinned.filter((id) => typeof id === 'string') : [] };
}
function saveOptions(app: App, options) {
  app.settings.savePluginData(DATA_FILE, options);
}

/** 可用命令（与原版一致：checkCallback(true) 通过的才列）。 */
function availableCommands(app: App) {
  return app.commands.listCommands().filter((cmd) => {
    try {
      if (cmd.checkCallback) return !!cmd.checkCallback(true);
      if (cmd.editorCheckCallback) {
        const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
        return !!(view && view.editor);
      }
      return true;
    } catch (e) { return false; }
  });
}

class CommandPaletteModal extends SuggestModal {
  declare limit: number;
  declare emptyStateText: any;

  constructor(app: App) {
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
    const available = availableCommands(this.app);
    if (!query) {
      // 原版顺序：置顶命令 → 最近使用 → 其余
      const pinnedIds = loadOptions(this.app).pinned;
      const pinned = pinnedIds.map((id) => available.find((c) => c.id === id)).filter(Boolean);
      const pinnedSet = new Set(pinned.map((c) => c.id));
      const recent = (this.app._recentCommands || []).filter((id) => !pinnedSet.has(id));
      const recentSet = new Set(recent);
      const recents = recent.map((id) => available.find((c) => c.id === id)).filter(Boolean);
      const others = available.filter((c) => !recentSet.has(c.id) && !pinnedSet.has(c.id));
      return [...pinned, ...recents, ...others];
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

/** 添加置顶命令的选择器（设置页 + 号入口）。 */
class PinCommandModal extends SuggestModal {
  declare onChoose: any;
  declare limit: number;
  declare emptyStateText: any;

  constructor(app: App, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.limit = 50;
    this.emptyStateText = t('plugins.command-palette.label-no-commands') || 'No commands found.';
  }
  getPlaceholder() {
    return t('plugins.command-palette.prompt-add-command') || 'Select a command...';
  }
  getSuggestions(query) {
    const commands = availableCommands(this.app);
    if (!query) return commands.slice(0, 200);
    const out = [];
    for (const cmd of commands) {
      const m = fuzzyMatch(query, cmd.name + ' ' + (cmd.id.split(':')[0] || ''));
      if (m) out.push({ cmd, score: m.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 200).map((o) => o.cmd);
  }
  renderSuggestion(cmd, el) {
    el.setText(cmd.name || cmd.id);
  }
  onChooseSuggestion(cmd) {
    if (cmd && this.onChoose) this.onChoose(cmd.id);
  }
}

/**
 * 原版核心插件设置页：置顶命令。
 * 结构：SettingGroup 标题「置顶命令」+ 标题行右侧加号 + 命令行（行尾移除钮）/ 空态行。
 */
export function settingTab(app: App, containerEl) {
  const options = loadOptions(app);
  const group = new SettingGroup(containerEl);
  group.setHeading(t('plugins.command-palette.label-pinned-commands') || 'Pinned commands');
  const nameOf = (id) => {
    const cmd = app.commands.commands[id];
    return cmd ? cmd.name : id;
  };
  group.addExtraButton((button) => {
    button
      .setIcon('lucide-plus')
      .setTooltip(t('plugins.command-palette.action-add-command') || 'Add a command...')
      .onClick(() => {
        new PinCommandModal(app, (id) => {
          if (!options.pinned.includes(id)) {
            options.pinned.push(id);
            saveOptions(app, options);
            renderRows();
          }
        }).open();
      });
  });
  const renderRows = () => {
    group.listEl.empty();
    if (!options.pinned.length) {
      const empty = new Setting(group.listEl);
      empty.setName(t('plugins.command-palette.label-no-commands') || 'No commands found.');
      empty.setClass('mod-empty-state');
      return;
    }
    for (const id of options.pinned) {
      const setting = new Setting(group.listEl);
      setting.setName(nameOf(id));
      setting.addExtraButton((button) => {
        button
          .setIcon('lucide-x')
          .setTooltip(t('interface.menu.remove') || 'Remove')
          .onClick(() => {
            options.pinned = options.pinned.filter((x) => x !== id);
            saveOptions(app, options);
            renderRows();
          });
      });
    }
  };
  renderRows();
  return group;
}

export function create(app: App) {
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
    registerCommands(app: App) {
      app.commands.addCommand({
        id: 'command-palette:open',
        name: t('plugins.command-palette.action-open') || 'Open command palette',
        icon: 'terminal',
        callback: () => new CommandPaletteModal(app).open(),
      });
    },
  };
}
