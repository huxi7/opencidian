/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu；依赖 ./canvas-menu.js 的 showQuickSettingsMenu。
 * [OUTPUT]: 导出 buildCardMenu(canvas) 与 buildControls(canvas)。
 * [POS]: canvas-view.buildDom 的控件层（从主视图拆出，保持单文件 ≤800 行）。DOM 与行为逐字对齐原版：
 *        buildCardMenu 建右下角「新建卡片/笔记/媒体」按钮（点击在视口中心建，拖拽拖出尺寸）；
 *        buildControls 建左下角四组控件：快速设置（只读时点击直接退出只读，否则弹 showQuickSettingsMenu）、缩放四键、撤销/重做、帮助（桌面端才有的第四组，打开 CanvasHelpModal）。
 *        缩放组的「总览全局」提示按原版拼上快捷键后缀（actionZoomToFit + "\n(" + Fb(Ib(["Shift"],"1")) + ")"）。
 *        状态仍归 canvas-view：cardMenuEl/canvasControlsEl/quickSettingsButton/undoBtnEl/redoBtnEl 由本层写入宿主，函数体只经宿主读状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas card menu + controls — split out of canvas-view to keep it under 800 lines. */
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { showQuickSettingsMenu } from './canvas-menu.js';
import { CanvasHelpModal, hotkeyLabel } from './canvas-help.js';

/** 右下角建卡菜单（原版 card menu）：三个按钮，点击建卡、拖拽拖出尺寸。 */
export function buildCardMenu(canvas) {
  const menu = canvas.cardMenuEl = canvas.wrapperEl.createDiv('canvas-card-menu');
  const addButton = (icon, title, onClick, onDragStart) => {
    const el = menu.createDiv({ cls: 'canvas-card-menu-button mod-draggable', attr: { 'aria-label': title } });
    setIcon(el, icon);
    el.addEventListener('click', onClick);
    if (onDragStart) el.addEventListener('pointerdown', onDragStart);
  };
  addButton('lucide-sticky-note', t('plugins.canvas.action-drag-to-add-card'),
    () => canvas.createTextNode({ pos: canvas.posCenter(), position: 'center' }),
    (e) => canvas.dragTempNode(e, canvas.config.defaultTextNodeDimensions, (pos, size) => { canvas.deselectAll(); canvas.createTextNode({ pos, size }); }));
  addButton('lucide-file-text', t('plugins.canvas.action-drag-to-add-note'),
    () => canvas.promptAddFileNode({ pos: canvas.posCenter(), position: 'center' }),
    (e) => canvas.dragTempNode(e, canvas.config.defaultFileNodeDimensions, (pos, size) => canvas.promptAddFileNode({ pos, size })));
  addButton('lucide-file-image', t('plugins.canvas.action-drag-to-add-media'),
    () => canvas.promptAddFileNode({ pos: canvas.posCenter(), position: 'center', media: true }),
    (e) => canvas.dragTempNode(e, canvas.config.defaultFileNodeDimensions, (pos, size) => canvas.promptAddFileNode({ pos, size, media: true })));
}

/** 左下角控件组（原版三组）：快速设置、缩放、撤销/重做。 */
export function buildControls(canvas) {
  const controls = canvas.canvasControlsEl = canvas.wrapperEl.createDiv('canvas-controls');
  // 快速设置组（原版第一组）：只读状态下直接点击退出只读，否则弹菜单
  const settingsGroup = controls.createDiv('canvas-control-group mod-raised');
  const quickSettingsButton = canvas.quickSettingsButton = settingsGroup.createDiv({ cls: 'canvas-control-item' });
  setIcon(quickSettingsButton, canvas.readonly ? 'lucide-lock' : 'lucide-settings');
  quickSettingsButton.setAttr('aria-label', t('plugins.canvas.label-canvas-settings'));
  quickSettingsButton.addEventListener('click', (ev) => {
    if (canvas.readonly) {
      canvas.setReadonly(false);
      canvas.saveLocalData();
      return;
    }
    if (quickSettingsButton.hasClass('has-active-menu')) return;
    const menu = new Menu(canvas.app);
    showQuickSettingsMenu(canvas, menu);
    menu.setParentElement(quickSettingsButton).showAtMouseEvent(ev);
  });
  const group = controls.createDiv('canvas-control-group mod-raised');
  const addButton = (icon, title, onClick) => {
    const el = group.createDiv({ cls: 'canvas-control-item', attr: { 'aria-label': title } });
    setIcon(el, icon);
    el.addEventListener('click', onClick);
  };
  addButton('lucide-plus', t('commands.zoom-in'), () => canvas.zoomBy(canvas.config.zoomMultiplier));
  addButton('lucide-rotate-cw', t('commands.reset-zoom'), () => canvas.zoomBy(-canvas.zoom));
  // 原版把快捷键拼在提示里：actionZoomToFit() + "\n(" + Fb(Ib(["Shift"],"1")) + ")"
  addButton('lucide-maximize', `${t('plugins.canvas.action-zoom-to-fit')}\n(${hotkeyLabel(['Shift', '1'])})`, () => canvas.zoomToFit());
  addButton('lucide-minus', t('commands.zoom-out'), () => canvas.zoomBy(-canvas.config.zoomMultiplier));
  // 撤销/重做组（原版第三组控件）
  const historyGroup = controls.createDiv('canvas-control-group mod-raised');
  const addHistoryButton = (icon, title, onClick) => {
    const el = historyGroup.createDiv({ cls: 'canvas-control-item', attr: { 'aria-label': title } });
    setIcon(el, icon);
    el.addEventListener('click', onClick);
    return el;
  };
  canvas.undoBtnEl = addHistoryButton('lucide-undo-2', t('setting.mobile-toolbar.option-undo'), () => canvas.undo());
  canvas.redoBtnEl = addHistoryButton('lucide-redo-2', t('setting.mobile-toolbar.option-redo'), () => canvas.redo());
  canvas.updateHistoryUI();
  // 帮助组（原版桌面端第四组控件）：打开画布快捷键说明弹窗
  const helpGroup = controls.createDiv('canvas-control-group mod-raised');
  const helpButton = helpGroup.createDiv({ cls: 'canvas-control-item', attr: { 'aria-label': t('plugins.canvas.label-canvas-help') } });
  setIcon(helpButton, 'lucide-help-circle');
  helpButton.addEventListener('click', () => new CanvasHelpModal(canvas.app, canvas.options).open());
  // 让 controls 与 card menu 一样浮在节点之上
  controls.style.zIndex = String(canvas.getZIndex() + 1);
}
