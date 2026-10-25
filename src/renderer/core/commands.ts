/**
 * [INPUT]: 依赖 Events 发布命令变化；依赖 Notice 显示执行失败。
 * [OUTPUT]: 导出 Command 与 CommandManager，注册并分派命令。
 * [POS]: 快捷键、菜单和插件共用入口。执行时传 checking=false，编辑器回调传工作区的活动编辑器宿主（画布卡片优先）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Command manager — registry + execution, matching Obsidian's API. */
import { Events } from './events.js';
import { Notice } from './notices.js';

export class Command {
  declare manager: any;
  declare id: string;
  declare name: string;
  declare icon: any;
  declare callback: any;
  declare checkCallback: any;
  declare editorCallback: any;
  declare editorCheckCallback: any;
  declare hotkeys: any[];
  declare repeatable: boolean;
  declare allowNoFile: boolean;
  declare showOnMobileToolbar: boolean;

  constructor(manager) {
    this.manager = manager;
    this.id = '';
    this.name = '';
    this.icon = null;
    this.callback = null;
    this.checkCallback = null;
    this.editorCallback = null;
    this.editorCheckCallback = null;
    this.hotkeys = [];
    this.repeatable = false;
    this.allowNoFile = false;
    this.showOnMobileToolbar = false;
  }
  setIcon(icon) { this.icon = icon; return this; }
  setName(name) { this.name = name; return this; }
  setCallback(cb) { this.callback = cb; return this; }
  setCheckCallback(cb) { this.checkCallback = cb; return this; }
  setEditorCallback(cb) { this.editorCallback = cb; return this; }
  setEditorCheckCallback(cb) { this.editorCheckCallback = cb; return this; }
  setHotkeys(hotkeys) { this.hotkeys = hotkeys; return this; }
  setRepeatable(repeatable) { this.repeatable = repeatable; return this; }
  setAllowNoFile(allow) { this.allowNoFile = allow; return this; }
}

export class CommandManager extends Events {
  declare getDisplayName: (command: Command) => string;
  declare app: App;
  declare commands: Record<string, Command>;

  constructor(app: App) {
    super();
    this.app = app;
    this.commands = {};
  }
  addCommand(command) {
    const cmd = command instanceof Command ? command : Object.assign(new Command(this), command);
    if (!cmd.id) throw new Error('Command must have an id');
    this.commands[cmd.id] = cmd;
    this.trigger('changed');
  }
  removeCommand(id) {
    delete this.commands[id];
    this.trigger('changed');
  }
  findCommand(id) { return this.commands[id]; }
  listCommands() { return Object.values(this.commands); }

  /**
   * 原版 addCommand 的编辑器解析入口：workspace.activeEditor（画布卡片宿主优先，
   * 回落到活动叶子的编辑器视图），无编辑器时返回 null。回调第二参即该宿主对象。
   */
  activeEditorOf() {
    const workspace = this.app.workspace;
    const active = workspace && workspace.getActiveEditor ? workspace.getActiveEditor() : null;
    return active && active.editor ? active : null;
  }

  executeCommandById(id, ev?) {
    const cmd = this.commands[id];
    if (!cmd) return false;
    try {
      if (cmd.checkCallback) return cmd.checkCallback(false) !== false;
      if (cmd.editorCheckCallback) {
        const active = this.activeEditorOf();
        if (!active) return false;
        return cmd.editorCheckCallback(false, active.editor, active) !== false;
      }
      if (cmd.editorCallback) {
        const active = this.activeEditorOf();
        if (active) { cmd.editorCallback(active.editor, active); return true; }
        if (cmd.allowNoFile && cmd.callback) { cmd.callback(ev); return true; }
        return false;
      }
      if (cmd.callback) { cmd.callback(ev); return true; }
    } catch (e) {
      console.error('Command failed', id, e);
      new Notice('Command failed: ' + (e.message || e));
    }
    return false;
  }
  commandsForScope(scope) {
    return this.listCommands();
  }
}
