/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 bboxOf、expandBBox；依赖 ./canvas-node.js 的 CanvasNode（instanceof 判定）；依赖 ./canvas-viewport.js 的 uniqueSnapPoints、findSnapMatches
 * [OUTPUT]: 导出 CanvasSelectionBox（.canvas-selection 选择框 + 8 个 data-resize 手柄 + 多选等比缩放）与 resizeSourceFrom（原版 k3）
 * [POS]: views/ 画布选择框层（原版 V3）。同一类承担两种角色：空白拖动时作为框选矩形（无 mod 类，指针穿透），
 *        多选时作为画布菜单持有的包围盒（.mod-group-selection，可拖拽/可缩放）。
 *        update 把 bbox 外扩 10px 后定位；缩放手柄拖动时按各元素在包围盒内的相对位置整体等比缩放（受 minContainerDimension 约束），
 *        吸附与参考线复用视口层的 A3/L3，松手一次性写盘。只对 CanvasNode 生效：边不参与缩放（原版此处会取边缺失的 rect 字段）。
 *        独立成文件是为了让类链各层保持单文件 ≤800 行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas selection box — original V3: marquee + multi-select bounding box with resizers. */
import { bboxOf, expandBBox } from './canvas-utils.js';
import { CanvasNode } from './canvas-node.js';
import { uniqueSnapPoints, findSnapMatches } from './canvas-viewport.js';

const EDGE_SIDES = ['top', 'right', 'bottom', 'left'];
const CORNER_SIDES = ['topright', 'bottomright', 'bottomleft', 'topleft'];
const BOX_PADDING = 10;

/** 原版 k3：按手柄方位把「被拖动的边」折成缩放源矩形，并给出该手柄控制的轴。 */
export function resizeSourceFrom(side, pos, rect) {
  let source;
  let resizeX = false;
  let resizeY = false;
  switch (side) {
    case 'top':
    case 'bottom':
      source = { x: rect.x, y: pos.y, width: rect.width, height: 0 };
      resizeY = true;
      break;
    case 'left':
    case 'right':
      source = { x: pos.x, y: rect.y, width: 0, height: rect.height };
      resizeX = true;
      break;
    default:
      source = { x: rect.x, y: rect.y, width: 0, height: 0 };
      resizeX = true;
      resizeY = true;
  }
  return { source, resizeX, resizeY };
}

export class CanvasSelectionBox {
  declare canvas: import('./canvas-view.js').CanvasView;
  declare bbox: any;
  declare resizerEls: any[];
  declare selectionEl: any;

  constructor(canvas: import('./canvas-view.js').CanvasView, extraClass?) {
    this.canvas = canvas;
    this.bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.resizerEls = [];
    this.selectionEl = createDiv({ cls: 'canvas-selection' + (extraClass ? ' ' + extraClass : '') });
    for (const side of EDGE_SIDES) this.createResizer(side);
    for (const side of CORNER_SIDES) this.createResizer(side);
  }

  createResizer(side) {
    const el = createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': side } });
    el.addEventListener('pointerdown', (e) => {
      if (e.target === el && e.pointerType === 'mouse') this.onResizePointerdown(e, side);
    });
    this.resizerEls.push(el);
  }

  /** 定位到 bbox（外扩 10px），容器首次使用时挂到 .canvas。 */
  update(bbox) {
    this.bbox = bbox;
    const boxEl = this.selectionEl;
    if (!boxEl.parentNode) this.canvas.canvasEl.appendChild(boxEl);
    for (const el of this.resizerEls) boxEl.appendChild(el);
    const box = expandBBox(bbox, BOX_PADDING);
    boxEl.setCssStyles({
      transform: `translate(${box.minX}px, ${box.minY}px)`,
      width: `${box.maxX - box.minX}px`,
      height: `${box.maxY - box.minY}px`,
    });
  }

  hide() { this.selectionEl.remove(); }

  /** 手柄拖动：框内全部节点按相对位置等比缩放（原版 V3.onResizePointerdown）。 */
  onResizePointerdown(e, side) {
    if (!e.isPrimary || e.button !== 0 || e.pointerType !== 'mouse') return;
    const canvas = this.canvas;
    e.preventDefault();
    const bbox = this.bbox;
    const rect = { x: bbox.minX, y: bbox.minY, width: bbox.maxX - bbox.minX, height: bbox.maxY - bbox.minY };
    const targets = Array.from(canvas.selection).filter((el) => el instanceof CanvasNode);
    if (!targets.length) return;
    const origins = [];
    const ratios = [];
    for (const node of targets) {
      node.nodeEl.addClass('is-dragging');
      origins.push({ x: node.x, y: node.y, width: node.width, height: node.height });
      const box = node.getBBox();
      ratios.push({
        width: (box.maxX - box.minX) / rect.width,
        height: (box.maxY - box.minY) / rect.height,
        minX: (box.minX - bbox.minX) / rect.width,
        minY: (box.minY - bbox.minY) / rect.height,
        maxX: (box.maxX - bbox.maxX) / rect.width,
        maxY: (box.maxY - bbox.maxY) / rect.height,
      });
    }
    // 手柄能把包围盒缩到的最小尺寸（按框内最小元素折算）
    const minWidth = canvas.config.minContainerDimension / Math.min(...ratios.map((r) => r.width));
    const minHeight = canvas.config.minContainerDimension / Math.min(...ratios.map((r) => r.height));
    canvas.handleDragWithPan(e, {
      move: (ev) => {
        const pos = canvas.posFromEvt(ev);
        canvas.clearSnapPoints();
        let offsetX = 0;
        let offsetY = 0;
        const { source, resizeX, resizeY } = resizeSourceFrom(side, pos, rect);
        let xMatch = null;
        let yMatch = null;
        if (canvas.canSnap(ev)) {
          if (canvas.options.snapToObjects) {
            const src = uniqueSnapPoints([bboxOf(source)]);
            const dest = uniqueSnapPoints(viewportBoxes(canvas));
            const dist = canvas.snapDistance;
            if (resizeX) { xMatch = findSnapMatches(src, dest, dist, 'x'); if (xMatch) offsetX = xMatch.delta; }
            if (resizeY) { yMatch = findSnapMatches(src, dest, dist, 'y'); if (yMatch) offsetY = yMatch.delta; }
          }
          if (canvas.options.snapToGrid) {
            const g = canvas.gridSpacing;
            if (resizeX && !xMatch) offsetX = Math.round(pos.x / g) * g - pos.x;
            if (resizeY && !yMatch) offsetY = Math.round(pos.y / g) * g - pos.y;
          }
        }
        const px = pos.x + offsetX;
        const py = pos.y + offsetY;
        if (side.includes('top')) { bbox.minY = Math.min(bbox.maxY - minHeight, py); if (bbox.minY !== py) { yMatch = null; offsetY = bbox.minY - pos.y; } }
        if (side.includes('left')) { bbox.minX = Math.min(bbox.maxX - minWidth, px); if (bbox.minX !== px) { xMatch = null; offsetX = bbox.minX - pos.x; } }
        if (side.includes('bottom')) { bbox.maxY = Math.max(bbox.minY + minHeight, py); if (bbox.maxY !== py) { yMatch = null; offsetY = bbox.maxY - pos.y; } }
        if (side.includes('right')) { bbox.maxX = Math.max(bbox.minX + minWidth, px); if (bbox.maxX !== px) { xMatch = null; offsetX = bbox.maxX - pos.x; } }
        if (xMatch || yMatch) canvas.renderSnapPoints(xMatch, yMatch, offsetX, offsetY);
        const next = {
          minX: bbox.minX,
          minY: bbox.minY,
          maxX: bbox.maxX,
          maxY: bbox.maxY,
        };
        for (let i = 0; i < targets.length; i++) {
          const r = ratios[i];
          const box = {
            minX: next.minX + r.minX * (next.maxX - next.minX),
            minY: next.minY + r.minY * (next.maxY - next.minY),
            maxX: next.maxX + r.maxX * (next.maxX - next.minX),
            maxY: next.maxY + r.maxY * (next.maxY - next.minY),
          };
          targets[i].moveAndResize({
            x: box.minX,
            y: box.minY,
            width: box.maxX - box.minX,
            height: box.maxY - box.minY,
          });
        }
        this.update(next);
      },
      end: () => canvas.requestSave(),
      cancel: () => {
        for (let i = 0; i < targets.length; i++) targets[i].moveAndResize(origins[i]);
        canvas.requestSave();
      },
      cleanup: () => { for (const node of targets) node.nodeEl.removeClass('is-dragging'); },
    });
  }
}

/** 吸附候选：除选中项之外的全部节点（本复刻不做视口虚拟化，原版取视口内节点）。 */
function viewportBoxes(canvas: import('./canvas-view.js').CanvasView) {
  const out = [];
  for (const node of canvas.nodes.values()) {
    if (canvas.selection.has(node)) continue;
    out.push(bboxOf(node));
  }
  return out;
}
