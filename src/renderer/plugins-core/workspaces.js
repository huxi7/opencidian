/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal；依赖 ../core/suggest.js 的 SuggestModal；依赖 ../core/icons.js 的 setIcon；moment
 * [OUTPUT]: 导出 nameKey、DATA_FILE、create(app)（命令 workspaces:load/save/save-and-load/open-modal + ribbon 管理工作区）
 * [POS]: plugins-core/ 的工作区插件。数据 .obsidian/workspaces.json（{workspaces:{名称:布局}, active:名称}，布局含 mtime 字符串），逐字对齐原版保存格式。原版用 workspace.changeLayout 就地换布局；本实现用 loadLayout + postLayoutLoad 组合（与 app.js 启动恢复同一路径），换布局后整体重渲染。
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
    this.workspaces = {};
    this.activeWorkspace = '';
    this._ribbonEl = null;
    this._commandIds = [];
  }

  /* ------------------------------------------------------------ 数据层 */
  saveData() {
    this.app.settings.savePluginData(DATA_FILE, {
      workspaces: this.workspaces,
      active: this.activeWorkspace,
    });
  }

  saveWorkspace(name) {
    const layout = this.app.workspace.getLayout();
    layout.mtime = moment().format();
    this.workspaces[name] = layout;
    this.saveData();
  }

  setActiveWorkspace(name) {
    this.activeWorkspace = name;
    this.saveData();
  }

  async loadWorkspace(name) {
    if (!Object.prototype.hasOwnProperty.call(this.workspaces, name)) return;
    this.activeWorkspace = name;
    const layout = this.workspaces[name];
    const active = await this.app.workspace.loadLayout(layout);
    await this.app.workspace.postLayoutLoad(typeof active === 'string' ? active : null);
    this.app.workspace.trigger('layout-change');
    this.saveData();
  }

  async deleteWorkspace(name) {
    delete this.workspaces[name];
    this.saveData();
  }

  /* ------------------------------------------------------------ 入口 */
  onSave() {
    const name = this.activeWorkspace;
    if (name && Object.prototype.hasOwnProperty.call(this.workspaces, name)) {
      this.saveWorkspace(name);
      new Notice(tt('plugins.workspaces.msg-save-layout-success', 'Successfully saved layout "{{name}}"', { name }));
    } else {
      new ManageWorkspacesModal(this.app, this).open();
    }
  }

  onload() {
    const data = this.app.settings.loadPluginData(DATA_FILE, {});
    this.workspaces = data.workspaces && typeof data.workspaces === 'object' ? data.workspaces : {};
    this.activeWorkspace = typeof data.active === 'string' ? data.active : '';
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
      loadBtn.onclick = () => { this.plugin.loadWorkspace(name); this.close(); };
      const deleteBtn = actions.createDiv('list-item-part clickable-icon');
      setIcon(deleteBtn, 'lucide-x');
      deleteBtn.setAttr('aria-label', tt('plugins.workspaces.tooltip-delete-layout', 'Delete layout'));
      deleteBtn.onmousedown = (ev) => ev.preventDefault();
      deleteBtn.onclick = async () => { await this.plugin.deleteWorkspace(name); this.renderList(); };
    }
  }

  onFinish() {
    const name = this.nameEl.value.trim();
    if (!name) {
      new Notice(tt('plugins.workspaces.msg-enter-name', 'Please enter a name for the new layout.'));
      return;
    }
    this.plugin.saveWorkspace(name);
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

  onChooseSuggestion(name) {
    if (this.shouldSave) {
      const active = this.plugin.activeWorkspace;
      if (active && Object.prototype.hasOwnProperty.call(this.plugin.workspaces, active)) {
        this.plugin.saveWorkspace(active);
      }
    }
    this.plugin.loadWorkspace(name);
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
