/**
 * [INPUT]: 依赖宿主 app.settings 的 loadPluginData/savePluginData（.obsidian/canvas.json）；依赖画布视图的 nodes/render/requestFrame。
 * [OUTPUT]: 导出 CANVAS_OPTIONS_FILE、DEFAULT_CANVAS_OPTIONS、loadCanvasOptions(app)、saveCanvasOptions(app, options)、
 *          applyCanvasOptions(app, options)、canvasNewFileParent(app, options, sourcePath)。
 * [POS]: views/ 画布选项的单一来源。设置页（plugins-core/canvas.js 的 settingTab）与画布视图（canvas-view.js）共用同一份
 *        .obsidian/canvas.json，避免两处各存一份导致设置页改了视图不生效。
 *        applyCanvasOptions 是原版 rerenderCanvases 的等价物：把新选项灌进所有打开的画布视图，并逐节点重绘，
 *        于是卡片标签可见性、缩放断点、Mod 行为、吸附开关立即生效。
 *        canvasNewFileParent 复刻原版 getNewFileParent：新白板位置为 folder 时取指定文件夹，为 current 时取当前文件所在文件夹，
 *        其余（root 或路径无效）回落到仓库根。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas options — one .obsidian/canvas.json shared by the settings tab and every canvas view. */
import { TFolder } from '../core/vault.js';

export const CANVAS_OPTIONS_FILE = 'canvas.json';

/** 原版画布插件的选项默认值（app.js 3417469 之后的 onEnable：{ snapToObjects: true, snapToGrid: true }）。 */
export const DEFAULT_CANVAS_OPTIONS = { snapToObjects: true, snapToGrid: true };

/** 读取 .obsidian/canvas.json；缺省键回落到原版默认值。 */
export function loadCanvasOptions(app) {
  try {
    const data = app.settings.loadPluginData(CANVAS_OPTIONS_FILE, DEFAULT_CANVAS_OPTIONS);
    return { ...DEFAULT_CANVAS_OPTIONS, ...(data || {}) };
  } catch (e) {
    return { ...DEFAULT_CANVAS_OPTIONS };
  }
}

/** 写回 .obsidian/canvas.json（合并写，不清掉别的键）。 */
export function saveCanvasOptions(app, options) {
  try {
    app.settings.savePluginData(CANVAS_OPTIONS_FILE, options);
  } catch (e) { /* 选项写盘失败不影响使用 */ }
}

/**
 * 原版 rerenderCanvases：把选项灌进所有画布视图并重绘节点。
 * 逐节点 render 会重算卡片标签可见性（updateNodeLabel）与缩放断点（updateBreakpoint）。
 */
export function applyCanvasOptions(app, options) {
  const leaves = app.workspace.getLeavesOfType('canvas');
  for (const leaf of leaves) {
    const view = leaf.view;
    if (!view || !view.nodes) continue;
    view.options = { ...view.options, ...options };
    for (const node of view.nodes.values()) {
      if (node && typeof node.render === 'function') node.render();
    }
    if (typeof view.requestFrame === 'function') view.requestFrame();
  }
}

/** 原版 getNewFileParent：folder → 指定文件夹；current → 当前文件所在文件夹；其余 → 仓库根。 */
export function canvasNewFileParent(app, options, sourcePath) {
  const vault = app.vault;
  const location = (options && options.newFileLocation) || 'root';
  if (location === 'folder') {
    const folder = vault.getAbstractFileByPath((options && options.newFileFolderPath) || '');
    if (folder instanceof TFolder) return folder;
    return vault.getRoot();
  }
  if (location === 'current' && sourcePath) {
    const parent = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
    const folder = vault.getAbstractFileByPath(parent);
    if (folder instanceof TFolder) return folder;
  }
  return vault.getRoot();
}
