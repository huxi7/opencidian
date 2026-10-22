/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 sidePoint/offsetPoint/bezierFor/bezierPoint/nearestSide/SIDE_ROTATION/applyCanvasColor/genId；依赖 ../core/i18n.js 的 t；依赖 ../core/menu.js 的 Menu
 * [OUTPUT]: 导出 CanvasEdge 类
 * [POS]: views/ 画布三件套的边层。一个 CanvasEdge 持有两个 SVG g：lineGroupEl 挂在 .canvas-edges，lineEndGroupEl 挂在箭头层 svg；
 *        g 内 path.canvas-display-path 负责可见线，path.canvas-interaction-path 负责命中与 hover；箭头是 polygon.canvas-path-end。
 *        坐标完全由 CanvasNode.getBBox() 推导（边中点 → 外移 7px → 三次贝塞尔），本文件不持有节点状态。
 *        标签是 .canvas-path-label-wrapper > .canvas-path-label（contenteditable），与原版一致的编辑方式。
 *        端点拖拽的虚影建在拖拽真正开始时（handlers.start）：原版把临时节点放在 oM 的工厂里，
 *        纯点击边端点不留 .is-dummy 蓝框，也不留半途改接的悬空边。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas edge — mirrors the original W5 edge class and _5 label class. */
import {
  sidePoint, offsetPoint, bezierFor, bezierPoint, nearestSide, SIDE_ROTATION, applyCanvasColor, genId,
} from './canvas-utils.js';
import { t } from '../core/i18n.js';

export const END_NONE = 'none';
export const END_ARROW = 'arrow';

/** 原版箭头多边形顶点，逐字对齐。 */
const ARROW_POINTS = '0,0 6.5,10.4 -6.5,10.4';

export class CanvasEdge {
  /**
   * @param {CanvasView} canvas
   * @param {string} id
   * @param {{side:string,node:any,end:string}} from
   * @param {{side:string,node:any,end:string}} to
   */
  constructor(canvas, id, from, to) {
    this.canvas = canvas;
    this.id = id || genId();
    this.from = from;
    this.to = to;
    this.color = '';
    this.label = '';
    this.unknownData = {};
    this.initialized = false;
    this.labelElement = null;
    this.bezier = null;
    this.path = null;
    this.fromLineEnd = null;
    this.toLineEnd = null;
    this.lineGroupEl = createSvg('g');
    this.lineEndGroupEl = createSvg('g');
  }

  get isAttached() { return !!this.lineGroupEl.parentNode; }

  attach() {
    if (this.isAttached) return;
    this.canvas.edgeContainerEl.appendChild(this.lineGroupEl);
    this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl);
  }

  detach() {
    if (!this.isAttached) return;
    this.lineGroupEl.detach();
    this.lineEndGroupEl.detach();
  }

  destroy() {
    if (this.labelElement) this.labelElement.destroy(true);
    this.lineGroupEl.remove();
    this.lineEndGroupEl.remove();
  }

  /* ------------------------------------------------------------------ data */

  getData() {
    const data = { ...this.unknownData, id: this.id, fromNode: this.from.node.id, fromSide: this.from.side, toNode: this.to.node.id, toSide: this.to.side };
    if (this.from.end !== END_NONE) data.fromEnd = this.from.end;
    if (this.to.end !== END_ARROW) data.toEnd = this.to.end;
    if (this.color) data.color = this.color;
    if (this.label) data.label = this.label;
    return data;
  }

  setData(data) {
    const { fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label, ...rest } = data;
    const canvas = this.canvas;
    let dirty = false;
    const nextColor = color || '';
    if (this.color !== nextColor) { this.color = nextColor; dirty = true; }
    if (this.label !== label) { this.label = label || ''; dirty = true; }
    if (fromNode && fromNode !== this.from.node.id && canvas.nodes.has(fromNode)) {
      this.from.node = canvas.nodes.get(fromNode);
      canvas.markMoved(this);
    }
    if (toNode && toNode !== this.to.node.id && canvas.nodes.has(toNode)) {
      this.to.node = canvas.nodes.get(toNode);
      canvas.markMoved(this);
    }
    if (fromNode) {
      const side = fromSide !== undefined ? fromSide : nearestSide(this.from.node.getBBox(), this.to.node.getBBox());
      if (side !== this.from.side) { this.from.side = side; dirty = true; }
    }
    if (toNode) {
      const side = toSide !== undefined ? toSide : nearestSide(this.to.node.getBBox(), this.from.node.getBBox());
      if (side !== this.to.side) { this.to.side = side; dirty = true; }
    }
    if (fromEnd !== undefined && fromEnd !== this.from.end) { this.from.end = fromEnd; dirty = true; }
    if (toEnd !== undefined && toEnd !== this.to.end) { this.to.end = toEnd; dirty = true; }
    this.unknownData = rest;
    if (dirty) canvas.markDirty(this);
  }

  setColor(color, render) {
    const value = color || '';
    if (this.color === value) return;
    this.color = value;
    if (render) this.render();
    else this.canvas.markDirty(this);
  }

  setLabel(label) {
    if (this.label !== label) this.label = label;
  }

  /** 重接一条边的一端（连线拖拽时复用）。 */
  update(from, to) {
    const canvas = this.canvas;
    if (this.from.node !== from.node) { canvas.edgeFrom.delete(this.from.node, this); canvas.edgeFrom.add(from.node, this); }
    if (this.to.node !== to.node) { canvas.edgeTo.delete(this.to.node, this); canvas.edgeTo.add(to.node, this); }
    this.from = from;
    this.to = to;
    canvas.markMoved(this);
  }

  /* -------------------------------------------------------------- geometry */

  getBBox() {
    const a = sidePoint(this.from.node.getBBox(), this.from.side);
    const b = sidePoint(this.to.node.getBBox(), this.to.side);
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  }

  /** 贝塞尔 t=0.5 的点，标签定位用。 */
  getCenter() {
    return bezierPoint(0.5, this.bezier);
  }

  /* ------------------------------------------------------------ selection */

  select() { this.lineGroupEl.addClass('is-focused'); this.lineEndGroupEl.addClass('is-focused'); }
  deselect() { this.lineGroupEl.removeClass('is-focused'); this.lineEndGroupEl.removeClass('is-focused'); }
  focus() { this.select(); }

  blur() {
    this.deselect();
    if (this.labelElement) this.labelElement.blur();
  }

  editLabel() {
    if (!this.labelElement) this.labelElement = new CanvasEdgeLabel(this);
    this.labelElement.focus();
  }

  /* ------------------------------------------------------------------- DOM */

  initialize() {
    const line = this.lineGroupEl;
    line.addEventListener('click', (e) => this.onClick(e));
    line.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    line.addEventListener('pointerdown', (e) => this.onConnectionPointerdown(e));
    this.path = {
      interaction: line.createSvg('path', { cls: 'canvas-interaction-path' }),
      display: line.createSvg('path', { cls: 'canvas-display-path' }),
    };
  }

  render() {
    if (!this.initialized) { this.initialized = true; this.initialize(); }
    this.updatePath();
    if (this.labelElement && !this.label) this.labelElement.destroy(true);
    if (this.labelElement) this.labelElement.render();
    if (this.label) {
      if (!this.labelElement) this.labelElement = new CanvasEdgeLabel(this);
      this.labelElement.setText(this.label);
    }
    applyCanvasColor(this.lineGroupEl, this.color);
    applyCanvasColor(this.lineEndGroupEl, this.color);
  }

  updatePath() {
    const { from, to } = this;
    const a = sidePoint(from.node.getBBox(), from.side);
    const s = offsetPoint(a, from.side, 7);
    const l = sidePoint(to.node.getBBox(), to.side);
    const c = offsetPoint(l, to.side, 7);
    const bezier = this.bezier = bezierFor(s, from.side, c, to.side);

    // 箭头：端类型变化时重建
    if (from.end !== (this.fromLineEnd && this.fromLineEnd.type)) {
      if (this.fromLineEnd) this.fromLineEnd.el.detach();
      this.fromLineEnd = this.createEdgeEnd(from.end);
    }
    if (to.end !== (this.toLineEnd && this.toLineEnd.type)) {
      if (this.toLineEnd) this.toLineEnd.el.detach();
      this.toLineEnd = this.createEdgeEnd(to.end);
    }

    let d = bezier.path;
    if (this.fromLineEnd) {
      this.fromLineEnd.el.style.transform = `translate(${a.x}px, ${a.y}px) rotate(${SIDE_ROTATION[from.side]}deg)`;
    } else {
      d = `M${a.x} ${a.y} L${s.x} ${s.y} ${d}`;
    }
    if (this.toLineEnd) {
      this.toLineEnd.el.style.transform = `translate(${l.x}px, ${l.y}px) rotate(${SIDE_ROTATION[to.side]}deg)`;
    } else {
      d = `${d} M${c.x} ${c.y} L${l.x} ${l.y}`;
    }
    this.path.interaction.setAttr('d', d);
    this.path.display.setAttr('d', d);
  }

  createEdgeEnd(type) {
    if (type !== END_ARROW) return null;
    const el = this.lineEndGroupEl.createSvg('g', {}, (g) => {
      g.createSvg('polygon', { cls: 'canvas-path-end', attr: { points: ARROW_POINTS } });
    });
    return { el, type };
  }

  /* --------------------------------------------------------------- events */

  onClick(e) {
    const canvas = this.canvas;
    if (e.button !== 0 || canvas.readonly) return;
    canvas.wrapperEl.focus({ preventScroll: true });
    if (e.shiftKey) canvas.toggleSelect(this);
    else if (canvas.selection.size === 1 && canvas.selection.has(this)) this.editLabel();
    else canvas.selectOnly(this);
  }

  onContextMenu(e) {
    if (e.defaultPrevented) return;
    const canvas = this.canvas;
    if (canvas.selection.has(this) && canvas.selection.size > 1) { canvas.onSelectionContextMenu(e); return; }
    if (!canvas.readonly) canvas.selectOnly(this);
    const menu = new Menu(this.canvas.app);
    this.showMenu(menu);
    e.preventDefault();
    menu.showAtMouseEvent(e);
  }

  showMenu(menu) {
    const canvas = this.canvas;
    if (!canvas.readonly) {
      menu.addItem((item) => item.setSection('danger').setTitle(t('plugins.canvas.action-remove')).setIcon('lucide-trash-2').setWarning(true)
        .onClick(() => { canvas.removeEdge(this); canvas.requestSave(); }));
      menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-edit-label')).setIcon('lucide-edit')
        .onClick(() => this.editLabel()));
    }
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-follow-connection')).setIcon('lucide-corner-down-right')
      .onClick(() => {
        // 视口中心离哪一端近，就跳到那一端所属节点
        const center = canvas.posCenter();
        const a = sidePoint(this.from.node.getBBox(), this.from.side);
        const b = sidePoint(this.to.node.getBBox(), this.to.side);
        const target = Math.hypot(center.x - a.x, center.y - a.y) > Math.hypot(center.x - b.x, center.y - b.y)
          ? this.to.node : this.from.node;
        canvas.zoomToBbox(target.getBBox());
      }));
    this.canvas.app.workspace.trigger('canvas:edge-menu', menu, this);
  }

  /**
   * 从边中点拖出，重新接一端（原版 onConnectionPointerdown 的简化版）。
   * 虚影建在拖拽真正开始时（handlers.start）：原版把临时节点放在 oM 的工厂里，
   * 纯点击不留 .is-dummy 蓝框；边本身在拖拽期间临时改接虚影，收尾复原或删除。
   */
  onConnectionPointerdown(e) {
    const canvas = this.canvas;
    if (!e.isPrimary || e.button !== 0 || canvas.readonly) return;
    e.preventDefault();
    const from = this.from;
    const to = this.to;
    const start = canvas.posFromClient({ x: e.clientX, y: e.clientY });
    const fromPt = sidePoint(from.node.getBBox(), from.side);
    const toPt = sidePoint(to.node.getBBox(), to.side);
    const movingEnd = dist(start, fromPt) > dist(start, toPt) ? 'to' : 'from';
    const fixedEnd = movingEnd === 'from' ? to : from;
    let dummy = null;
    let snapped = null;

    canvas.handleDragWithPan(e, {
      start: () => {
        // 原版：拖线端点只建不挂载的几何占位，不能出现可见虚影。
        dummy = canvas.createDummyNode({ attach: false });
        canvas.canvasEl.addClass('is-connecting');
        canvas.deselectAll();
      },
      move: (ev) => {
        if (!dummy) return;
        const pos = canvas.posFromEvt(ev);
        dummy.x = pos.x;
        dummy.y = pos.y;
        dummy.width = 0;
        dummy.height = 0;
        const candidates = canvas.getIntersectingNodes(expand(dummy.getBBox(), canvas.config.objectSnapDistance))
          .filter((n) => n !== fixedEnd.node && !n.isGroup);
        snapped = canvas.findSnapTarget(pos, candidates, canvas.config.objectSnapDistance);
        if (movingEnd === 'from') {
          this.update(snapped ? { side: snapped.side, node: snapped.node, end: from.end } : { side: from.side, node: dummy, end: from.end }, to);
        } else {
          this.update(from, snapped ? { side: snapped.side, node: snapped.node, end: to.end } : { side: to.side, node: dummy, end: to.end });
        }
      },
      end: () => {
        if (snapped) canvas.requestSave();
        else canvas.removeEdge(this);
      },
      cancel: () => this.update(from, to),
      cleanup: () => {
        canvas.canvasEl.removeClass('is-connecting');
        if (dummy) canvas.removeDummyNode(dummy);
      },
    });
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function expand(box, d) {
  return { minX: box.minX - d, minY: box.minY - d, maxX: box.maxX + d, maxY: box.maxY + d };
}

/* --------------------------------------------------------------------------
 * 边标签 — 原版 _5 类：contenteditable div，输入即写回 edge.label
 * ------------------------------------------------------------------------ */
class CanvasEdgeLabel {
  constructor(edge) {
    this.edge = edge;
    this.isEditing = false;
    this.initialTextState = '';
    const canvas = edge.canvas;
    const wrapperEl = this.wrapperEl = canvas.canvasEl.createDiv('canvas-path-label-wrapper');
    wrapperEl.addEventListener('click', (e) => {
      if (canvas.readonly) return;
      if (e.shiftKey) { this.blur(); canvas.toggleSelect(edge); return; }
      if (canvas.selection.size === 1 && canvas.selection.has(edge)) { if (!this.isEditing) this.focus(); }
      else canvas.selectOnly(edge);
    });
    this.textareaEl = wrapperEl.createDiv({
      cls: 'canvas-path-label',
      text: edge.label,
      attr: { contenteditable: 'false', 'data-placeholder': t('plugins.canvas.prompt-add-text') },
    });
    this.textareaEl.addEventListener('input', () => {
      edge.label = this.textareaEl.innerText;
      edge.canvas.requestSave(false);
    });
    this.render();
  }

  setText(text) {
    if (!this.isEditing) this.textareaEl.setText(text);
  }

  focus() {
    const el = this.textareaEl;
    this.isEditing = true;
    el.setAttr('contenteditable', 'true');
    el.addClass('is-editing');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this.initialTextState = this.edge.label || '';
  }

  blur() {
    const el = this.textareaEl;
    this.isEditing = false;
    el.blur();
    el.setAttr('contenteditable', 'false');
    el.removeClass('is-editing');
    if (this.edge.label) {
      if (this.initialTextState !== this.edge.label) this.edge.canvas.requestSave();
    } else {
      this.destroy();
    }
    this.initialTextState = '';
  }

  render() {
    const center = this.edge.getCenter();
    this.wrapperEl.style.transform = `translate(${center.x}px, ${center.y}px)`;
    applyCanvasColor(this.wrapperEl, this.edge.color);
    this.wrapperEl.toggleClass('is-themed', !!this.edge.color);
  }

  destroy(silent) {
    const edge = this.edge;
    if (edge.label) delete edge.label;
    if (this.initialTextState && !silent) edge.canvas.requestSave();
    this.wrapperEl.remove();
    edge.labelElement = null;
  }
}
