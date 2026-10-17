/**
 * [INPUT]: 依赖 Events 发布命令变化；依赖 Notice 显示执行失败。
 * [OUTPUT]: 导出 Command 与 CommandManager，注册并分派命令。
 * [POS]: 快捷键、菜单和插件共用入口。执行时传 checking=false 与活动视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Command manager — registry + execution, matching Obsidian's API. */
import { Events } from './events.js';
import { Notice } from './notices.js';

export class Command {
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
  constructor(app) {
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
  executeCommandById(id, ev) {
    const cmd = this.commands[id];
    if (!cmd) return false;
    try {
      if (cmd.checkCallback) return cmd.checkCallback(false) !== false;
      if (cmd.editorCheckCallback) {
        const view = this.app.workspace.activeLeaf && this.app.workspace.activeLeaf.view;
        const editor = view && view.editor;
        if (editor) return cmd.editorCheckCallback(false, editor, view) !== false;
        return false;
      }
      if (cmd.editorCallback) {
        const view = this.app.workspace.activeLeaf && this.app.workspace.activeLeaf.view;
        const editor = view && view.editor;
        if (editor) { cmd.editorCallback(editor, view); return true; }
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
