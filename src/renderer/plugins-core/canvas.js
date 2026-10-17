/**
 * [INPUT]: CanvasView 提供画布视图；i18n 提供文案；keymap.IS_MAC 决定 Mod 键。
 *          宿主提供视图注册、文件创建、命令与功能区。
 * [OUTPUT]: 导出 nameKey 与 create(app)。注册 canvas 视图、三个画布命令与新建功能区入口。
 * [POS]: plugins-core/ 的画布插件入口。视图本体在 views/canvas-view.js（类链 CanvasViewport → CanvasInteractions → CanvasView）。
 *        命令命名对齐原版：canvas:new-file 在默认新文件位置建空画布并打开；canvas:jump-to-group 只在当前叶子是画布且有分组时可用；
 *        canvas:convert-to-file 只在单选文本卡片时可用（建 md 后关联边改指文件节点）。
 *        功能区复用新建逻辑；Mod 点击新标签并聚焦。重复加载不新增入口，卸载释放入口、命令与视图注册。
 *        不做原版的 canvas:export-as-image。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: canvas — view registration + commands. */
import { CanvasView } from '../views/canvas-view.js';
import { CanvasTextNode } from '../views/canvas-node.js';
import { t } from '../core/i18n.js';
import { IS_MAC } from '../core/keymap.js';

export const nameKey = 'plugins.canvas';

/** 空画布模板：与原版 hc 的 tab 缩进一致。 */
const EMPTY_CANVAS = '{\n\t"nodes": [],\n\t"edges": []\n}';

class CanvasPlugin {
  constructor(app) {
    this.app = app;
    this._commandIds = [];
    this._ribbonEl = null;
  }

  onload() {
    if (this._ribbonEl) return;
    this.app.viewRegistry.registerView('canvas', (leaf) => new CanvasView(leaf));
    const creator = this.app.viewRegistry.getViewCreator('canvas');
    if (creator) creator.extensions = ['canvas'];
    this.registerCommands();
    this._ribbonEl = this.app.workspace.addRibbonItem(
      'lucide-layout-dashboard',
      t('plugins.canvas.command-create-new-canvas') || 'Create new canvas',
      (ev) => this.createNewCanvas(!!(IS_MAC ? ev?.metaKey : ev?.ctrlKey)),
    );
    this._ribbonEl.setAttr('data-command-id', 'canvas:new-file');
  }

  onunload() {
    this._ribbonEl?.detach();
    this._ribbonEl = null;
    this.deregisterCommands();
    this.app.viewRegistry.unregisterView('canvas');
  }

  registerCommands() {
    const add = (command) => {
      this.app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'canvas:new-file',
      name: t('plugins.canvas.command-create-new-canvas') || 'Create new canvas',
      icon: 'lucide-layout-dashboard',
      callback: () => this.createNewCanvas(),
    });
    add({
      id: 'canvas:jump-to-group',
      name: t('plugins.canvas.action-jump-to-group') || 'Jump to group',
      icon: 'lucide-box-select',
      checkCallback: (checking) => {
        const view = this.getActiveCanvasView();
        if (!view || !view.getGroupNodes().length) return false;
        if (!checking) view.openJumpToGroup();
        return true;
      },
    });
    add({
      id: 'canvas:convert-to-file',
      name: t('plugins.canvas.command-convert-to-file') || 'Convert to file...',
      icon: 'lucide-file-input',
      checkCallback: (checking) => {
        const view = this.getActiveCanvasView();
        if (!view || view.selection.size !== 1) return false;
        const node = view.selection.values().next().value;
        if (!(node instanceof CanvasTextNode)) return false;
        if (!checking) node.convertToFile();
        return true;
      },
    });
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  getActiveCanvasView() {
    return this.app.workspace.getActiveViewOfType('canvas');
  }

  /** 新建命令与功能区共用；功能区可指定新标签并聚焦。 */
  async createNewCanvas(newLeaf = false) {
    const activeFile = this.app.workspace.getActiveFile();
    const folder = this.app.fileManager.getNewFileParent(activeFile ? activeFile.path : null);
    const file = await this.app.fileManager.createNewFile(folder, 'Untitled.canvas', EMPTY_CANVAS);
    if (!file) return;
    const leaf = await this.app.workspace.openFile(file, { newLeaf: newLeaf ? 'tab' : false });
    if (newLeaf && leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
}

export function create(app) {
  const plugin = new CanvasPlugin(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
  };
}
