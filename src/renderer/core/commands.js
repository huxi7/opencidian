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
      if (cmd.checkCallback) { cmd.checkCallback(false); return true; }
      if (cmd.editorCheckCallback) {
        const editor = this.app.workspace.activeLeaf && this.app.workspace.activeLeaf.view && this.app.workspace.activeLeaf.view.editor;
        if (editor) { cmd.editorCheckCallback(true, editor); return true; }
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
