/**
 * [INPUT]: CanvasView 提供画布视图；views/canvas-options.js 提供选项读写与重绘；i18n 提供文案；keymap.IS_MAC 决定 Mod 键；
 *          core/setting.js 的 SettingGroup 提供设置条目；宿主提供视图注册、文件创建、命令与功能区。
 * [OUTPUT]: 导出 nameKey、create(app) 与 settingTab(app, containerEl)。注册 canvas 视图、四个画布命令与新建功能区入口；
 *          settingTab 是「白板设定」页（新白板位置/文件夹、滚轮行为、Mod 行为、卡片标签、对齐网格/物体、缩放阈值）。
 * [POS]: plugins-core/ 的画布插件入口。视图本体在 views/canvas-view.js（类链 CanvasViewport → CanvasInteractions → CanvasView）；
 *        图片导出实现在 views/canvas-export.js，选项弹窗在 views/canvas-export-dialog.js，选项读写在 views/canvas-options.js。
 *        命令命名对齐原版：canvas:new-file 在白板设定的新白板位置建空画布并打开（root/current/folder，原版 getNewFileParent）；
 *        canvas:export-as-image 只在当前叶子是画布时可用，
 *        执行时先弹设置弹窗（范围/缩放/水印/隐私），确认后写 PNG，取消不落盘；canvas:jump-to-group 只在当前叶子是画布且有分组时可用；
 *        canvas:convert-to-file 只在单选文本卡片时可用（建 md 后关联边改指文件节点）。
 *        功能区复用新建逻辑；Mod 点击新标签并聚焦。重复加载不新增入口，卸载释放入口、命令与视图注册。
 *        settingTab 的条目与顺序对齐原版画布插件设置页（app.js 3431431 附近的 getSettingDefinitions）：
 *        新白板位置 → 新白板文件夹（仅 folder 可见）→ 滚轮行为 → Mod 行为 → 卡片标签 → 对齐网格 → 对齐物体 → 缩放阈值。
 *        每项改动都写回 .obsidian/canvas.json 并经 applyCanvasOptions 灌进打开的画布视图（卡片标签/缩放阈值立即可见）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: canvas — view registration + commands. */
import { CanvasView } from '../views/canvas-view.js';
import { CanvasTextNode } from '../views/canvas-text-node.js';
import {
  applyCanvasOptions, canvasNewFileParent, loadCanvasOptions, saveCanvasOptions,
} from '../views/canvas-options.js';
import { SettingGroup } from '../core/setting.js';
import { t } from '../core/i18n.js';
import { IS_MAC } from '../core/keymap.js';

export const nameKey = 'plugins.canvas';

/** 空画布模板：与原版 hc 的 tab 缩进一致。 */
const EMPTY_CANVAS = '{\n\t"nodes": [],\n\t"edges": []\n}';

class CanvasPlugin {
  declare app: App;
  declare _commandIds: any[];
  declare _ribbonEl: any;

  constructor(app: App) {
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
      id: 'canvas:export-as-image',
      name: t('plugins.canvas.action-export-png') || 'Export as image',
      icon: 'lucide-image',
      checkCallback: (checking) => {
        const view = this.getActiveCanvasView();
        if (!view) return false;
        if (!checking) view.generateHDImage();
        return true;
      },
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
    // 原版 getNewFileParent：新白板位置取自白板设定（root/current/folder），不是全局的新笔记位置。
    const options = loadCanvasOptions(this.app);
    const folder = canvasNewFileParent(this.app, options, activeFile ? activeFile.path : null);
    const file = await this.app.fileManager.createNewFile(folder, 'Untitled.canvas', EMPTY_CANVAS);
    if (!file) return;
    const leaf = await this.app.workspace.openFile(file, { newLeaf: newLeaf ? 'tab' : false });
    if (newLeaf && leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
}

/* --------------------------------------------------------------------------
 * 白板设定页（设置宿主经 module.settingTab(app, containerEl) 调用）
 * 条目与顺序对齐原版画布插件设置页（app.js 3431431 附近的 getSettingDefinitions）：
 * 新白板位置 → 新白板文件夹（仅 folder 时可见）→ 滚轮行为 → Mod 行为 → 卡片标签 → 对齐网格 → 对齐物体 → 缩放阈值。
 * -------------------------------------------------------------------------- */
export function settingTab(app: App, containerEl) {
  const options = loadCanvasOptions(app);
  const save = () => {
    saveCanvasOptions(app, options);
    applyCanvasOptions(app, options);
  };
  const group = new SettingGroup(containerEl);
  group.setHeading(t('plugins.canvas.label-canvas-settings') || 'Canvas settings');

  // 新白板文件夹行仅在位置为 folder 时显示（原版 visible 判定）
  let folderRow = null;
  const syncFolderRow = () => {
    if (folderRow) folderRow.settingEl.toggle((options.newFileLocation || 'root') === 'folder');
  };

  // 1. 新白板文件的默认位置（原版该行只有 name 与控件，无说明文字）
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-new-canvas-location') || 'New canvas location')
      .addDropdown((component) => {
        component
          .addOption('root', t('setting.file.option-choice-vault-root') || 'Vault root')
          .addOption('current', t('setting.file.option-choice-current-folder') || 'Current folder')
          .addOption('folder', t('setting.file.option-choice-specified-folder') || 'Specified folder')
          .setValue(options.newFileLocation || 'root')
          .onChange((value) => {
            options.newFileLocation = value;
            save();
            syncFolderRow();
          });
      });
  });

  // 2. 新白板文件夹
  group.addSetting((setting) => {
    folderRow = setting;
    setting
      .setName(t('plugins.canvas.option-new-canvas-folder-path') || 'Folder for new canvas files')
      .setDesc(t('plugins.canvas.option-new-canvas-folder-path-description') || 'New canvas files will appear in this folder.')
      .addText((component) => {
        component
          .setPlaceholder(t('setting.folder-path-example-placeholder') || 'Example: folder 1/folder 2')
          .setValue(options.newFileFolderPath || '')
          .onChange((value) => { options.newFileFolderPath = String(value || '').trim(); save(); });
      });
  });
  syncFolderRow();

  // 3. 默认鼠标滚轮行为
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-wheel-behavior') || 'Default mouse wheel behavior')
      .addDropdown((component) => {
        component
          .addOption('pan', t('plugins.canvas.label-pan') || 'Pan canvas')
          .addOption('zoom', t('plugins.canvas.label-zoom') || 'Zoom')
          .setValue(options.defaultWheelBehavior || 'pan')
          .onChange((value) => { options.defaultWheelBehavior = value; save(); });
      });
  });

  // 4. 默认 Mod 行为（原版 optionModDragBehavior 带 {{key}}：Mod+Drag）
  const modKey = IS_MAC ? '⌘' : 'Ctrl';
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-mod-drag-behavior', { key: `${modKey}+Drag` }) || 'Default Mod behavior')
      .addDropdown((component) => {
        component
          .addOption('menu', t('plugins.canvas.option-show-menu') || 'Show menu')
          .addOption('card', t('plugins.canvas.action-add-card') || 'Add card')
          .addOption('note', t('plugins.canvas.action-add-note') || 'Add note')
          .addOption('media', t('plugins.canvas.action-add-media') || 'Add media')
          .addOption('webpage', t('plugins.canvas.action-add-website') || 'Add webpage')
          .addOption('group', t('plugins.canvas.action-create-group') || 'Create group')
          .setValue(options.defaultModDragBehavior || 'menu')
          .onChange((value) => { options.defaultModDragBehavior = value; save(); });
      });
  });

  // 5. 显示卡片标签（always/hover/never）
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-node-label') || 'Show card labels')
      .addDropdown((component) => {
        component
          .addOption('always', t('plugins.canvas.label-always') || 'Always')
          .addOption('hover', t('plugins.canvas.label-hover') || 'Hover')
          .addOption('never', t('plugins.canvas.label-never') || 'Never')
          .setValue(options.cardLabelVisibility || 'always')
          .onChange((value) => { options.cardLabelVisibility = value; save(); });
      });
  });

  // 6. 对齐网格
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-snap-to-grid') || 'Snap to grid')
      .setDesc(t('plugins.canvas.option-snap-to-grid-desc') || 'Align to background grid when moving and resizing cards.')
      .addToggle((component) => {
        component
          .setValue(options.snapToGrid !== false)
          .onChange((value) => { options.snapToGrid = value; save(); });
      });
  });

  // 7. 对齐物体
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-snap-to-objects') || 'Snap to objects')
      .setDesc(t('plugins.canvas.option-snap-to-objects-desc') || 'Align to nearby objects when moving and resizing cards.')
      .addToggle((component) => {
        component
          .setValue(options.snapToObjects !== false)
          .onChange((value) => { options.snapToObjects = value; save(); });
      });
  });

  // 8. 隐藏卡片内容的缩放阈值（原版显示格式：round(100 * 1.2^z)%）
  group.addSetting((setting) => {
    setting
      .setName(t('plugins.canvas.option-zoom-breakpoint') || 'Zoom threshold to hide card content')
      .setDesc(t('plugins.canvas.option-zoom-breakpoint-desc') || 'Lower values improve performance but hide card content sooner.')
      .addSlider((component) => {
        // 原版 displayFormat：Math.round(100 * 1.2^z)%，滑杆提示按此显示。
        const percent = (value) => Math.round(100 * Math.pow(1.2, value)) + '%';
        component.getValuePretty = () => percent(component.getValue());
        component
          .setLimits(-0.7, 2.4, 0.01)
          .setValue(options.zoomBreakpoint || 0)
          .setDynamicTooltip()
          .onChange((value) => { options.zoomBreakpoint = value; save(); });
      });
  });

  return group;
}

export function create(app: App) {
  const plugin = new CanvasPlugin(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
  };
}
