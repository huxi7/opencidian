/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 unionBBox、expandBBox、clamp；依赖 ./canvas-node.js 的 CanvasNode；依赖 ./canvas-file-node.js 的 CanvasFileNode；
 *          依赖 ./canvas-edge.js 的 CanvasEdge；依赖 ./canvas-selection.js 的 CanvasSelectionBox；依赖 ./canvas-help.js 的 hotkeyLabel（工具条提示里的平台快捷键文案）；依赖 ../core/menu.js 的 Menu；依赖 ../core/icons.js 的 setIcon；依赖 ../core/i18n.js 的 t
 * [OUTPUT]: 导出 buildCanvasMenu（浮动工具条 + 多选包围盒）与 alignTargets、alignNodes、distributeNodes、justifyNodes、arrangeNodes 五个纯排布运算
 * [POS]: views/ 画布选择浮动层（原版 q3）。selection 为多选包围盒（.canvas-selection.mod-group-selection），工具条挂在 .canvas-menu-container > .canvas-menu。
 *        排布运算逐字对齐原版：align 6 向取包围盒边界；distribute 按元素总宽/高平分剩余空隙（首尾不动）；justify 把每个元素拉伸到包围盒整幅；
 *        arrange 先按 y 重叠切行再行内按 x 排序，横/纵/网格三种落位。单选分组时排布对象是该组内部节点、包围盒取组框内缩 20。
 *        工具条按选中内容给按钮：删除、设置颜色、聚焦当前卡片（提示带平台快捷键后缀）恒显；2+ 节点给创建分组与排布菜单；单选边给方向/标签按钮；单选可编辑卡片给编辑按钮。
 *        按钮点击后的排布结果统一走 canvas.requestSave()，由画布的防抖链路落盘并入撤销栈。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas selection toolbar + arrange operations — original q3 and its align/distribute/justify/arrange closures. */
import { unionBBox, expandBBox, clamp, parseCanvasColor } from './canvas-utils.js';
import { CanvasNode } from './canvas-node.js';
import { CanvasFileNode } from './canvas-file-node.js';
import { CanvasEdge } from './canvas-edge.js';
import { CanvasSelectionBox } from './canvas-selection.js';
import { hotkeyLabel } from './canvas-help.js';
import { Menu } from '../core/menu.js';
import { setIcon } from '../core/icons.js';
import { t } from '../core/i18n.js';

/* ---------------------------------------------------------------- 排布运算 */

/** 原版 C()：排布对象与参照包围盒。单选分组时对象是其内部节点，包围盒取组框内缩 20。 */
export function alignTargets(canvas, selected, single, last) {
  if (single && last && last.isGroup) {
    const box = last.getBBox();
    return { nodes: canvas.getContainingNodes(box).filter((node) => node !== last), box: expandBBox(box, -20) };
  }
  const nodes = selected.filter((el) => el instanceof CanvasNode);
  return { nodes, box: unionBBox(nodes.map((node) => node.getBBox())) };
}

/** align：6 向对齐到包围盒对应边（左/右/上/下/水平居中/垂直居中）。 */
export function alignNodes(mode, nodes, box) {
  for (const node of nodes) {
    if (mode === 'left') node.moveTo({ x: box.minX, y: node.y });
    else if (mode === 'right') node.moveTo({ x: box.maxX - node.width, y: node.y });
    else if (mode === 'top') node.moveTo({ x: node.x, y: box.minY });
    else if (mode === 'bottom') node.moveTo({ x: node.x, y: box.maxY - node.height });
    else if (mode === 'center') node.moveTo({ x: (box.minX + box.maxX - node.width) / 2, y: node.y });
    else if (mode === 'middle') node.moveTo({ x: node.x, y: (box.minY + box.maxY - node.height) / 2 });
  }
}

/** distribute：首尾不动，按元素尺寸平分剩余空隙（原版按轴取宽或高）。 */
export function distributeNodes(axis, nodes, box) {
  if (nodes.length <= 1) return;
  if (axis === 'horizontal') {
    let total = 0;
    for (const node of nodes) total += node.width;
    nodes.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
    const gap = (box.maxX - box.minX - total) / (nodes.length - 1);
    for (let i = 1; i < nodes.length - 1; i++) {
      const prev = nodes[i - 1];
      nodes[i].moveTo({ x: prev.x + prev.width + gap, y: nodes[i].y });
    }
  } else if (axis === 'vertical') {
    let total = 0;
    for (const node of nodes) total += node.height;
    nodes.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
    const gap = (box.maxY - box.minY - total) / (nodes.length - 1);
    for (let i = 1; i < nodes.length - 1; i++) {
      const prev = nodes[i - 1];
      nodes[i].moveTo({ x: nodes[i].x, y: prev.y + prev.height + gap });
    }
  }
}

/** justify：把每个元素沿轴拉伸到包围盒整幅（宽度或高度与包围盒对齐）。 */
export function justifyNodes(axis, nodes, box) {
  if (nodes.length <= 1) return;
  for (const node of nodes) {
    if (axis === 'horizontal') node.moveAndResize({ x: box.minX, y: node.y, width: box.maxX - box.minX, height: node.height });
    else if (axis === 'vertical') node.moveAndResize({ x: node.x, y: box.minY, width: node.width, height: box.maxY - box.minY });
  }
}

/** arrange：先按 y 重叠切行（行内按 x 排序），再按行/列/网格以 gridSpacing 落位。 */
export function arrangeNodes(mode, nodes, box, spacing) {
  if (nodes.length <= 1) return;
  nodes.sort((a, b) => a.y - b.y);
  const rows = [];
  let rowBottom = -Infinity;
  for (const node of nodes) {
    if (node.y < rowBottom) {
      rows[rows.length - 1].push(node);
      const bottom = node.y + node.height;
      if (bottom < rowBottom) rowBottom = bottom;
    } else {
      rows.push([node]);
      rowBottom = node.y + node.height;
    }
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  const flat = rows.reduce((acc, row) => acc.concat(row), []);
  let prev = flat[0];
  if (mode === 'horizontal') {
    for (let i = 1; i < flat.length; i++) {
      flat[i].moveTo({ x: prev.x + prev.width + spacing, y: prev.y });
      prev = flat[i];
    }
  } else if (mode === 'vertical') {
    for (let i = 1; i < flat.length; i++) {
      flat[i].moveTo({ x: prev.x, y: prev.y + prev.height + spacing });
      prev = flat[i];
    }
  } else if (mode === 'grid') {
    let y = box.minY;
    for (const row of rows) {
      row[0].moveTo({ x: box.minX, y });
      let rowHeight = row[0].height;
      for (let i = 1; i < row.length; i++) {
        const before = row[i - 1];
        row[i].moveTo({ x: before.x + before.width + spacing, y });
        rowHeight = Math.max(rowHeight, row[i].height);
      }
      y += rowHeight + spacing;
    }
  }
}

/* ------------------------------------------------------------ 浮动工具条 */

/** 建浮动工具条与多选包围盒（原版 q3）。返回 { containerEl, menuEl, selection, updateZIndex, render, detach }。 */
export function buildCanvasMenu(canvas) {
  const containerEl = createDiv('canvas-menu-container');
  const menuEl = containerEl.createDiv('canvas-menu');
  const selection = new CanvasSelectionBox(canvas, 'mod-group-selection');
  const state = { submenuEl: null, submenuKind: '', submenuButton: null };
  const boxEl = selection.selectionEl;
  boxEl.addEventListener('contextmenu', (e) => { canvas.onSelectionContextMenu(e); e.preventDefault(); });
  boxEl.addEventListener('pointerdown', (e) => {
    if (e.isPrimary && e.button === 0 && !e.defaultPrevented) canvas.handleSelectionDrag(e, boxEl);
  });
  return {
    containerEl,
    menuEl,
    selection,
    updateZIndex(z) { containerEl.style.zIndex = String(z); },
    render(redraw) { renderMenu(canvas, { containerEl, menuEl, selection, state }, redraw); },
    detach() {
      containerEl.detach();
      menuEl.empty();
      selection.hide();
    },
  };
}

function renderMenu(canvas, menu, redraw) {
  const { containerEl, menuEl, selection, state } = menu;
  const selected = Array.from(canvas.selection);
  if (!selected.length) {
    containerEl.detach();
    menuEl.empty();
    selection.hide();
    state.submenuEl = null;
    state.submenuButton = null;
    return;
  }
  selected.sort((a, b) => a.zIndex - b.zIndex);
  const single = selected.length === 1;
  const last = selected[selected.length - 1];
  const box = unionBBox(selected.map((el) => el.getBBox()));
  if (single) selection.hide();
  else selection.update(box);
  if (canvas.isDragging) {
    containerEl.detach();
    menuEl.empty();
    return;
  }
  canvas.wrapperEl.appendChild(containerEl);
  if (redraw) {
    menuEl.empty();
    state.submenuEl = null;
    state.submenuKind = '';
    state.submenuButton = null;
    buildButtons(canvas, menu, selected, single, last);
  }
  positionMenu(canvas, containerEl, menuEl, box, selected, last);
}

/** 按钮：只读画布隐藏非 always 项（原版 b()）。 */
function addButton(canvas, menuEl, title, icon, onClick, always) {
  if (canvas.readonly && !always) return null;
  const el = menuEl.createEl('button', 'clickable-icon');
  el.setAttr('aria-label', title);
  setIcon(el, icon);
  el.addEventListener('click', onClick);
  return el;
}

/** 子菜单锚定在按钮下方（原版 showAtPosition({x, y: bottom, width, overlap})）。 */
function openSubmenu(canvas, buttonEl, build) {
  if (!buttonEl || buttonEl.hasClass('has-active-menu')) return;
  const rect = buttonEl.getBoundingClientRect();
  const submenu = new Menu(canvas.app);
  build(submenu);
  submenu.setParentElement(buttonEl).showAtPosition({ x: rect.x, y: rect.bottom });
}

function buildButtons(canvas, menu, selected, single, last) {
  const { menuEl, state } = menu;
  addButton(canvas, menuEl, t('plugins.canvas.action-remove'), 'lucide-trash-2', () => canvas.deleteSelection());
  addButton(canvas, menuEl, t('plugins.canvas.action-set-color'), 'lucide-palette', (ev) => openColorSubmenu(canvas, menu, ev.currentTarget, selected));
  addButton(canvas, menuEl, `${t('plugins.canvas.action-zoom-to-selection')}\n(${hotkeyLabel(['Shift', '2'])})`, 'zoom-to-selection', () => canvas.zoomToSelection(), true);
  if (!single && last instanceof CanvasNode) {
    addButton(canvas, menuEl, t('plugins.canvas.action-create-group'), 'create-group', () => {
      const box = expandBBox(unionBBox(selected.filter((el) => el instanceof CanvasNode).map((el) => el.getBBox())), 20);
      canvas.createGroupNode({ pos: { x: box.minX, y: box.minY }, size: { width: box.maxX - box.minX, height: box.maxY - box.minY } });
    });
  }
  const arrangeVisible = (!single && last instanceof CanvasNode) || (single && last && last.isGroup);
  if (arrangeVisible) {
    addButton(canvas, menuEl, t('plugins.canvas.action-align'), 'lucide-align-start-vertical', (ev) => {
      openSubmenu(canvas, ev.currentTarget, (submenu) => buildArrangeSubmenu(canvas, submenu, selected, single, last));
    });
  }
  if (single && last instanceof CanvasEdge) buildEdgeButtons(canvas, menuEl, last);
  if (single && last instanceof CanvasNode && !last.isGroup && last.isEditable()) {
    addButton(canvas, menuEl, t('interface.menu.edit'), 'lucide-edit', () => last.startEditing());
  }
  if (single && last && last.isGroup) {
    addButton(canvas, menuEl, t('plugins.canvas.action-edit-label'), 'lucide-edit', () => last.focusLabel());
  }
}

function buildEdgeButtons(canvas, menuEl, edge) {
  const edges = Array.from(canvas.selection).filter((el) => el instanceof CanvasEdge);
  const directionIcon = edge.from.end === 'arrow'
    ? 'lucide-move-horizontal'
    : (edge.to.end === 'none' ? 'line-horizontal' : 'lucide-arrow-right');
  addButton(canvas, menuEl, t('plugins.canvas.label-line-direction'), directionIcon, (ev) => {
    openSubmenu(canvas, ev.currentTarget, (submenu) => {
      const setEnds = (fromEnd, toEnd) => {
        for (const item of edges) { item.from.end = fromEnd; item.to.end = toEnd; canvas.markDirty(item); }
        canvas.requestSave();
      };
      submenu.addItem((item) => item.setTitle(t('plugins.canvas.label-nondirectional')).setIcon('line-horizontal')
        .setChecked(directionIcon === 'line-horizontal').onClick(() => setEnds('none', 'none')));
      submenu.addItem((item) => item.setTitle(t('plugins.canvas.label-unidirectional')).setIcon('lucide-arrow-right')
        .setChecked(directionIcon === 'lucide-arrow-right').onClick(() => setEnds('none', 'arrow')));
      submenu.addItem((item) => item.setTitle(t('plugins.canvas.label-bidirectional')).setIcon('lucide-move-horizontal')
        .setChecked(directionIcon === 'lucide-move-horizontal').onClick(() => setEnds('arrow', 'arrow')));
    });
  });
  if (edge.labelElement) {
    addButton(canvas, menuEl, t('plugins.canvas.action-remove-label'), 'lucide-x-square', () => {
      edge.setLabel('');
      edge.labelElement.destroy();
      canvas.requestSave();
      canvas.menu.render(true);
    });
  }
  addButton(canvas, menuEl, t('plugins.canvas.action-edit-label'), 'lucide-edit', () => edge.editLabel());
}

/** 排布子菜单：6 向对齐 + 3 种排列 + 2 向分布 + 2 向拉伸（原版 align 子菜单逐项对应）。 */
function buildArrangeSubmenu(canvas, submenu, selected, single, last) {
  const runAlign = (mode) => () => {
    const { nodes, box } = alignTargets(canvas, selected, single, last);
    alignNodes(mode, nodes, box);
    canvas.requestSave();
  };
  const runDistribute = (axis) => () => {
    const { nodes, box } = alignTargets(canvas, selected, single, last);
    distributeNodes(axis, nodes, box);
    canvas.requestSave();
  };
  const runJustify = (axis) => () => {
    const { nodes, box } = alignTargets(canvas, selected, single, last);
    justifyNodes(axis, nodes, box);
    canvas.requestSave();
  };
  const runArrange = (mode) => () => {
    const { nodes, box } = alignTargets(canvas, selected, single, last);
    arrangeNodes(mode, nodes, box, canvas.gridSpacing);
    canvas.requestSave();
  };
  const item = (title, icon, onClick) => submenu.addItem((it) => it.setTitle(title).setIcon(icon).onClick(onClick));
  item(t('plugins.canvas.action-align-left'), 'lucide-align-start-vertical', runAlign('left'));
  item(t('plugins.canvas.action-align-center'), 'lucide-align-center-vertical', runAlign('center'));
  item(t('plugins.canvas.action-align-right'), 'lucide-align-end-vertical', runAlign('right'));
  item(t('plugins.canvas.action-align-top'), 'lucide-align-start-horizontal', runAlign('top'));
  item(t('plugins.canvas.action-align-middle'), 'lucide-align-center-horizontal', runAlign('middle'));
  item(t('plugins.canvas.action-align-bottom'), 'lucide-align-end-horizontal', runAlign('bottom'));
  item(t('plugins.canvas.action-arrange-horizontally'), 'stack-horizontal', runArrange('horizontal'));
  item(t('plugins.canvas.action-arrange-vertically'), 'stack-vertical', runArrange('vertical'));
  item(t('plugins.canvas.action-arrange-grid'), 'lucide-layout-grid', runArrange('grid'));
  item(t('plugins.canvas.action-distribute-horizontal-spacing'), 'distribute-space-horizontal', runDistribute('horizontal'));
  item(t('plugins.canvas.action-distribute-vertical-spacing'), 'distribute-space-vertical', runDistribute('vertical'));
  item(t('plugins.canvas.action-justify-horizontally'), 'stretch-horizontal', runJustify('horizontal'));
  item(t('plugins.canvas.action-justify-vertically'), 'stretch-vertical', runJustify('vertical'));
}

/** 颜色子菜单（原版 canvas-submenu）：无色 + 1..6 主题色 + 自定义取色器。 */
function openColorSubmenu(canvas, menu, buttonEl, selected) {
  const { menuEl, state } = menu;
  if (state.submenuEl && state.submenuKind === 'color' && state.submenuButton === buttonEl) {
    state.submenuButton.removeClass('is-active');
    state.submenuEl.remove();
    state.submenuEl = null;
    state.submenuButton = null;
    return;
  }
  if (state.submenuEl) {
    state.submenuButton.removeClass('is-active');
    state.submenuEl.remove();
    state.submenuEl = null;
  }
  state.submenuButton = buttonEl;
  buttonEl.addClass('is-active');
  state.submenuKind = 'color';
  const submenuEl = state.submenuEl = menuEl.createDiv('canvas-submenu');
  let current = selected[selected.length - 1].color || '';
  const apply = (color, close) => {
    for (const el of selected) el.setColor(color, !close);
    current = color;
    if (close) { submenuEl.remove(); state.submenuEl = null; state.submenuButton.removeClass('is-active'); state.submenuButton = null; }
    canvas.requestSave();
  };
  let matched = false;
  const addSwatch = (color) => {
    const swatch = submenuEl.createDiv('canvas-color-picker-item');
    if (current === color) { swatch.addClass('is-active'); matched = true; }
    if (color) swatch.addClass('mod-canvas-color-' + color);
    swatch.addEventListener('click', () => apply(color, true));
  };
  addSwatch('');
  for (let i = 1; i <= 6; i++) addSwatch(String(i));
  const customEl = submenuEl.createDiv('canvas-color-picker-item canvas-color-picker-custom');
  const input = customEl.createEl('input', { type: 'color' });
  customEl.style.setProperty('--canvas-color', '0,0,0');
  if (!matched) {
    const rgb = parseCanvasColor(current);
    if (rgb) {
      input.value = toHex(rgb);
      customEl.style.setProperty('--canvas-color', `${rgb.r},${rgb.g},${rgb.b}`);
      customEl.addClass('is-active');
    }
  }
  input.addEventListener('change', () => apply(input.value, true));
  input.addEventListener('input', () => apply(input.value, false));
}

function toHex(rgb) {
  const part = (v) => v.toString(16).padStart(2, '0');
  return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
}

/** 工具条落位：多选取包围盒中心，高度按分组/文件卡片抬高（原版 render 尾部）。 */
function positionMenu(canvas, containerEl, menuEl, box, selected, last) {
  const scale = canvas.scale;
  const rect = canvas.canvasRect;
  let left = (box.minX + box.maxX) / 2;
  let top = box.minY - 10 / scale;
  if (selected.some((el) => el.isGroup)) top = box.minY - 35 / Math.sqrt(scale);
  else if (last instanceof CanvasFileNode) top = box.minY - 30 / Math.sqrt(scale);
  const domRect = menuEl.getBoundingClientRect();
  left = (left - canvas.x) * scale - domRect.width / 2 + rect.width / 2;
  top = (top - canvas.y) * scale - domRect.height + rect.height / 2;
  containerEl.setCssStyles({
    left: `${clamp(left, 10, rect.width - domRect.width - 10)}px`,
    top: `${clamp(top, 10, rect.height - domRect.height - 10)}px`,
  });
}
