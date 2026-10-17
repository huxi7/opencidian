/**
 * [INPUT]: 依赖 ../views/canvas-view.js 的 CanvasView；依赖 ../core/i18n.js 的 t
 * [OUTPUT]: 导出 nameKey 与 create(app)。注册 'canvas' 视图类型（扩展名 .canvas）与命令 canvas:new-file、canvas:jump-to-group。
 * [POS]: plugins-core/ 的画布插件入口。视图本体在 views/canvas-view.js（类链 CanvasViewport → CanvasInteractions → CanvasView）。
 *        命令命名对齐原版：canvas:new-file 在默认新文件位置建空画布并打开；canvas:jump-to-group 只在当前叶子是画布且有分组时可用。
 *        不做原版的 canvas:export-as-image 与 canvas:convert-to-file。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: canvas — view registration + commands. */
import { CanvasView } from '../views/canvas-view.js';
import { t } from '../core/i18n.js';

export const nameKey = 'plugins.canvas';

/** 空画布模板：与原版 hc 的 tab 缩进一致。 */
const EMPTY_CANVAS = '{\n\t"nodes": [],\n\t"edges": []\n}';

class CanvasPlugin {
  constructor(app) {
    this.app = app;
    this._commandIds = [];
  }

  onload() {
    this.app.viewRegistry.registerView('canvas', (leaf) => new CanvasView(leaf));
    const creator = this.app.viewRegistry.getViewCreator('canvas');
    if (creator) creator.extensions = ['canvas'];
    this.registerCommands();
  }

  onunload() {
    this.deregisterCommands();
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
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  getActiveCanvasView() {
    return this.app.workspace.getActiveViewOfType('canvas');
  }

  /** canvas:new-file：在默认新文件位置建空画布并打开。 */
  async createNewCanvas() {
    const activeFile = this.app.workspace.getActiveFile();
    const folder = this.app.fileManager.getNewFileParent(activeFile ? activeFile.path : null);
    const file = await this.app.fileManager.createNewFile(folder, 'Untitled.canvas', EMPTY_CANVAS);
    if (file) await this.app.workspace.openFile(file);
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
