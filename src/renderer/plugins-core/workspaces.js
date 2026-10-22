/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal；依赖 ../core/suggest.js 的 SuggestModal；依赖 ../core/icons.js 的 setIcon；moment
 * [OUTPUT]: 导出 nameKey、DATA_FILE、create(app)（命令 workspaces:load/save/save-and-load/open-modal + ribbon 管理工作区）
 * [POS]: plugins-core/ 的工作区插件。保存与加载共用串行队列。保存先等待叶子落盘，再独立复制命名布局。加载由 loadLayout 统一验证旧视图保存并关闭，再用 postLayoutLoad 重建；激活后同步文件事件与启动布局。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: workspaces — save and load workspace layouts. */
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { Modal } from '../core/modals.js';
import { SuggestModal } from '../core/suggest.js';
import { setIcon } from '../core/icons.js';

const moment = require('moment');

export const nameKey = 'plugins.workspaces';
export const DATA_FILE = 'workspaces.json';

/* --------------------------------------------------------------------------
 * Workspaces — 插件实例
 * ------------------------------------------------------------------------ */
class Workspaces {
  constructor(app) {
    this.app = app;
    this.workspaces = Object.create(null);
    this.activeWorkspace = '';
    this._ribbonEl = null;
    this._commandIds = [];
    this._loading = Promise.resolve();
  }

  /* ------------------------------------------------------------ 数据层 */
  saveData() {
    this.app.settings.savePluginData(DATA_FILE, {
      workspaces: this.workspaces,
      active: this.activeWorkspace,
    });
  }

  saveWorkspace(name) {
    return this.enqueue(async () => {
      const leaves = [];
      this.app.workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
      for (const leaf of leaves) {
        if (leaf.view && typeof leaf.view.save === 'function' && await leaf.view.save() === false) throw new Error('文档尚未保存，已取消工作区操作');
      }
      // 布局含 lastOpenFiles 等可变引用，命名快照必须与活动布局隔离。
      const layout = JSON.parse(JSON.stringify(this.app.workspace.getLayout()));
      layout.mtime = moment().format();
      this.workspaces[name] = layout;
      this.saveData();
    });
  }

  setActiveWorkspace(name) {
    this.activeWorkspace = name;
    this.saveData();
  }

  loadWorkspace(name) {
    return this.enqueue(() => this._loadWorkspace(name));
  }

  enqueue(action) {
    const operation = this._loading.then(action);
    this._loading = operation.catch(() => {});
    return operation;
  }

  async _loadWorkspace(name) {
    if (!Object.prototype.hasOwnProperty.call(this.workspaces, name)) return false;
    const layout = JSON.parse(JSON.stringify(this.workspaces[name]));
    if (!layout.main || !layout.left || !layout.right) throw new Error('Invalid workspace layout');
    const workspace = this.app.workspace;
    const active = await workspace.loadLayout(layout);
    if (active === false) throw new Error('Failed to load workspace layout');
    await workspace.postLayoutLoad(typeof active === 'string' ? active : null);
    this.activeWorkspace = name;
    workspace.trigger('file-open', workspace.getActiveFile());
    workspace.trigger('layout-change');
    this.saveData();
    await this.app.saveLayout();
    return true;
  }

  deleteWorkspace(name) {
    return this.enqueue(() => {
      delete this.workspaces[name];
      if (this.activeWorkspace === name) this.activeWorkspace = '';
      this.saveData();
    });
  }

  /* ------------------------------------------------------------ 入口 */
  async onSave() {
    const name = this.activeWorkspace;
    if (name && Object.prototype.hasOwnProperty.call(this.workspaces, name)) {
      try {
        await this.saveWorkspace(name);
        new Notice(tt('plugins.workspaces.msg-save-layout-success', 'Successfully saved layout "{{name}}"', { name }));
      } catch (error) { new Notice(error.message || String(error)); }
    } else {
      new ManageWorkspacesModal(this.app, this).open();
    }
  }

  onload() {
    const data = this.app.settings.loadPluginData(DATA_FILE, {});
    this.workspaces = Object.assign(Object.create(null),
      data.workspaces && !Array.isArray(data.workspaces) && typeof data.workspaces === 'object' ? data.workspaces : {});
    this.activeWorkspace = Object.prototype.hasOwnProperty.call(this.workspaces, data.active) ? data.active : '';
    const add = (command) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'workspaces:load',
      name: tt('plugins.workspaces.action-load-layout', 'Load workspace layout'),
      icon: 'lucide-layout',
      callback: () => new LoadWorkspaceModal(this.app, this, false).open(),
    });
    add({
      id: 'workspaces:save',
      name: tt('plugins.workspaces.action-save', 'Save layout'),
      icon: 'lucide-save',
      callback: () => this.onSave(),
    });
    add({
      id: 'workspaces:save-and-load',
      name: tt('plugins.workspaces.action-save-and-load-layout', 'Save and load another layout'),
      icon: 'lucide-layout',
      callback: () => new LoadWorkspaceModal(this.app, this, true).open(),
    });
    add({
      id: 'workspaces:open-modal',
      name: tt('plugins.workspaces.action-manage-layouts', 'Manage workspace layouts'),
      icon: 'lucide-layout',
      callback: () => new ManageWorkspacesModal(this.app, this).open(),
    });
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'lucide-layout',
      tt('plugins.workspaces.action-manage-layouts', 'Manage workspace layouts'),
      () => new ManageWorkspacesModal(this.app, this).open(),
    );
  }

  onunload() {
    if (this._ribbonEl) { this._ribbonEl.detach(); this._ribbonEl = null; }
    this.deregisterCommands();
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }
}

/* --------------------------------------------------------------------------
 * ManageWorkspacesModal — 原版 Lee：输入名称保存 + 列表（加载/删除）
 * ------------------------------------------------------------------------ */
class ManageWorkspacesModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.setTitle(tt('plugins.workspaces.action-manage-layouts', 'Manage workspace layouts'));
    const inputRow = this.contentEl.createDiv('list-item');
    inputRow.style.cssText = 'display:flex;gap:var(--size-4-2);align-items:center;';
    this.nameEl = inputRow.createEl('input', {
      cls: 'list-item-part mod-extended',
      type: 'text',
      attr: { placeholder: tt('plugins.workspaces.placeholder-save-current-layout-as', 'Save current workspace layout as...') },
    });
    this.nameEl.style.cssText = 'flex:1 1 auto;';
    this.nameEl.addEventListener('keydown', (ev) => {
      if (ev.isComposing || ev.key !== 'Enter') return;
      this.onFinish();
    });
    const saveBtn = inputRow.createEl('button', {
      cls: 'list-item-part',
      text: tt('plugins.workspaces.button-save', 'Save'),
    });
    saveBtn.onclick = () => this.onFinish();
    this.listContainerEl = this.contentEl.createDiv('list-container mod-manage-workspaces');
    this.listContainerEl.style.cssText = 'display:flex;flex-direction:column;gap:var(--size-2-2);';
    this.renderList();
  }

  onOpen() { setTimeout(() => this.nameEl.focus(), 10); }

  renderList() {
    const container = this.listContainerEl;
    container.empty();
    for (const name of Object.keys(this.plugin.workspaces)) {
      const layout = this.plugin.workspaces[name];
      const row = container.createDiv('list-item');
      row.style.cssText = 'display:flex;align-items:center;gap:var(--size-4-2);padding:var(--size-4-2) var(--size-4-3);border-radius:var(--radius-s);';
      const info = row.createDiv('list-item-part mod-extended');
      info.style.cssText = 'flex:1 1 auto;min-width:0;';
      const nameLine = info.createDiv();
      nameLine.createSpan({ text: name });
      if (name === this.plugin.activeWorkspace) {
        nameLine.createSpan({
          cls: 'flair mod-pop',
          text: tt('setting.appearance.label-currently-active', 'Active'),
        });
      }
      if (layout.mtime) {
        info.createDiv('list-item-desc').createDiv({
          cls: 'list-item-part',
          text: tt('plugins.workspaces.label-workspace-modified-time', 'Modified {{time}}', { time: moment(layout.mtime).fromNow() }),
        });
      }
      const actions = row.createDiv('list-item-actions');
      actions.style.cssText = 'display:flex;align-items:center;gap:var(--size-4-2);';
      const loadBtn = actions.createEl('button', {
        cls: 'list-item-part',
        text: tt('plugins.workspaces.button-load', 'Load'),
      });
      loadBtn.onclick = async () => {
        loadBtn.disabled = true;
        try { await this.plugin.loadWorkspace(name); this.close(); }
        catch (error) { new Notice(error.message || String(error)); }
        finally { loadBtn.disabled = false; }
      };
      const deleteBtn = actions.createDiv('list-item-part clickable-icon');
      setIcon(deleteBtn, 'lucide-x');
      deleteBtn.setAttr('aria-label', tt('plugins.workspaces.tooltip-delete-layout', 'Delete layout'));
      deleteBtn.onmousedown = (ev) => ev.preventDefault();
      deleteBtn.onclick = async () => { await this.plugin.deleteWorkspace(name); this.renderList(); };
    }
  }

  async onFinish() {
    const name = this.nameEl.value.trim();
    if (!name) {
      new Notice(tt('plugins.workspaces.msg-enter-name', 'Please enter a name for the new layout.'));
      return;
    }
    try { await this.plugin.saveWorkspace(name); }
    catch (error) { new Notice(error.message || String(error)); return; }
    this.plugin.setActiveWorkspace(name);
    new Notice(tt('plugins.workspaces.msg-save-layout-success', 'Successfully saved layout "{{name}}"', { name }));
    this.nameEl.value = '';
    this.renderList();
  }
}

/* --------------------------------------------------------------------------
 * LoadWorkspaceModal — 原版 Iee：SuggestModal 选择布局加载
 * ------------------------------------------------------------------------ */
class LoadWorkspaceModal extends SuggestModal {
  constructor(app, plugin, shouldSave) {
    super(app);
    this.plugin = plugin;
    this.shouldSave = shouldSave;
    this.emptyStateText = tt('plugins.workspaces.label-no-layout-found', 'No saved layout found.');
  }

  getPlaceholder() {
    return tt('plugins.workspaces.placeholder-type-to-search-layouts', 'Type layout name...');
  }

  getInstructions() {
    return [
      { command: '↑↓', purpose: tt('plugins.command-palette.instruction-navigate', 'to navigate') },
      { command: '↵', purpose: tt('plugins.command-palette.instruction-use', 'to use') },
      { command: 'esc', purpose: tt('plugins.command-palette.instruction-dismiss', 'to dismiss') },
    ];
  }

  getSuggestions(query) {
    const q = (query || '').toLowerCase();
    return Object.keys(this.plugin.workspaces).filter((name) => !q || name.toLowerCase().includes(q));
  }

  renderSuggestion(name, el) {
    el.setText(name);
    if (name === this.plugin.activeWorkspace) {
      el.createSpan({ cls: 'flair mod-pop', text: tt('setting.appearance.label-currently-active', 'Active') });
    }
  }

  async onChooseSuggestion(name) {
    if (this.shouldSave) {
      const active = this.plugin.activeWorkspace;
      if (active && Object.prototype.hasOwnProperty.call(this.plugin.workspaces, active)) {
        try { await this.plugin.saveWorkspace(active); }
        catch (error) { new Notice(error.message || String(error)); return; }
      }
    }
    try { await this.plugin.loadWorkspace(name); }
    catch (error) { new Notice(error.message || String(error)); }
  }
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app) {
  const plugin = new Workspaces(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // 公开 API
    saveWorkspace: (name) => plugin.saveWorkspace(name),
    loadWorkspace: (name) => plugin.loadWorkspace(name),
    deleteWorkspace: (name) => plugin.deleteWorkspace(name),
    getWorkspaces: () => plugin.workspaces,
  };
}
