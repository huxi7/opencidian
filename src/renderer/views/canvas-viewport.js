/**
 * [INPUT]: 依赖 ../core/view.js 的 View（类链基类）；依赖 ./canvas-utils.js 的 clamp、unionBBox、expandBBox、rectOf
 * [OUTPUT]: 导出 CanvasViewport 类，供 canvas-interactions.js 继承。含视口状态机（x,y 为视口中心世界坐标，zoom=log2(scale)）、
 *           坐标换算（posFromDom/domFromPos 等）、requestFrame/renderFrame 动画帧、markViewportChanged/markMoved/markDirty 标记。
 * [POS]: views/ 画布类链的第二层：View → CanvasViewport → CanvasInteractions → CanvasView。所有画布子视图共享这一层视口语义；
 *        节点/边通过 markMoved 请求重绘。缩放夹在边界内并刷新正文挂载，停止后释放动画帧。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas viewport engine — original viewport math + animation frame (class chain layer 2). */
import { View } from '../core/view.js';
import { clamp, unionBBox, expandBBox, rectOf } from './canvas-utils.js';

const ZOOM_MIN = -4;
const ZOOM_MAX = 1;
const ZOOMED_OUT_AT = -1.7;
const SMOOTHING = 0.984;

export class CanvasViewport extends View {
  /* ---------------------------------------------------------------- 视口 */

  get zoomBreakpoint() { return ZOOMED_OUT_AT - (this.options.zoomBreakpoint || 0); }
  get gridSpacing() {
    const z = this.zoom;
    if (z < -3.3) return 160;
    if (z < -2.16) return 80;
    if (z < -0.91) return 40;
    return 20;
  }
  get snapDistance() { return Math.ceil(this.config.objectSnapDistance / this.scale); }

  setViewport(x, y, zoom) {
    if (x === this.x && y === this.y && zoom === this.zoom) return;
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.zoom = this.tZoom = zoom;
    this.markViewportChanged();
  }

  zoomBy(delta, zoomCenter) {
    this.tZoom = clamp(this.tZoom + delta, ZOOM_MIN, ZOOM_MAX);
    this.zoomCenter = zoomCenter || { x: 0, y: 0 };
    this.markViewportChanged();
  }

  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.tx = this.x;
    this.ty = this.y;
    this.markViewportChanged();
  }

  zoomToSelection() {
    if (!this.selection.size) return;
    const boxes = [];
    for (const el of this.selection) boxes.push(el.getBBox());
    this.zoomToBbox(unionBBox(boxes));
  }

  zoomToFit() {
    if (!this.nodes.size) return;
    const boxes = [];
    for (const node of this.nodes.values()) boxes.push(node.getBBox());
    this.zoomToBbox(unionBBox(boxes));
  }

  zoomToBbox(box) {
    const { width, height } = this.canvasRect;
    if (!width || !height) return;
    const w = Math.max(box.maxX - box.minX, 1);
    const h = Math.max(box.maxY - box.minY, 1);
    const scale = Math.min(width / (1.1 * w), height / (1.1 * h));
    this.tx = (box.minX + box.maxX) / 2;
    this.ty = (box.minY + box.maxY) / 2;
    this.zoomCenter = null;
    this.tZoom = clamp(Math.log2(scale), ZOOM_MIN, ZOOM_MAX);
    this.markViewportChanged();
  }

  /** 把 box 挪进视口；box 比视口大时改为缩放到 box。 */
  panIntoView(box, margin = 20) {
    const padded = expandBBox(box, margin);
    const view = this.getViewportBBox();
    if (padded.maxX - padded.minX > view.maxX - view.minX || padded.maxY - padded.minY > view.maxY - view.minY) {
      this.zoomToBbox(padded);
      return;
    }
    if (padded.minX < view.minX) this.tx = this.x + padded.minX - view.minX;
    if (padded.minY < view.minY) this.ty = this.y + padded.minY - view.minY;
    if (padded.maxX > view.maxX) this.tx = this.x + padded.maxX - view.maxX;
    if (padded.maxY > view.maxY) this.ty = this.y + padded.maxY - view.maxY;
    this.markViewportChanged();
  }

  getViewportBBox() {
    const rect = this.canvasRect;
    const a = this.posFromDom({ x: rect.minX, y: rect.minY });
    const b = this.posFromDom({ x: rect.maxX, y: rect.maxY });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  /* ------------------------------------------------------------ 坐标换算 */

  domPosFromEvt(e) {
    const rect = this.canvasRect;
    return { x: e.clientX - rect.cx, y: e.clientY - rect.cy };
  }

  posFromEvt(e) { return this.posFromDom(this.domPosFromEvt(e)); }
  posFromClient(p) { return this.posFromDom({ x: p.x - this.canvasRect.cx, y: p.y - this.canvasRect.cy }); }
  posFromDom(p) { return { x: this.x + p.x / this.scale, y: this.y + p.y / this.scale }; }
  domFromPos(p) { return { x: (p.x - this.x) * this.scale, y: (p.y - this.y) * this.scale }; }
  posCenter() { return this.posFromDom({ x: 0, y: 0 }); }
  posInViewport(p) {
    const rect = this.canvasRect;
    return p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
  }

  /* ------------------------------------------------------------ 帧与渲染 */

  markViewportChanged() { this.viewportChanged = true; this.requestFrame(); }
  markMoved(el) { this.moved.add(el); this.requestFrame(); }
  markDirty(el) { this.dirty.add(el); this.requestFrame(); }

  requestFrame(frameStart) {
    if (this.frame) return;
    if (!frameStart) frameStart = performance.now();
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      const now = performance.now();
      this.renderFrame(now - frameStart, now);
    });
  }

  cancelFrame() {
    if (this.frame) { window.cancelAnimationFrame(this.frame); this.frame = 0; }
  }

  /** 原版动画帧：指数平滑趋近 tx/ty/tZoom，随后刷新视口 DOM 并重绘标记过的节点与边。 */
  renderFrame(dt, now) {
    let ease = 1 - Math.pow(SMOOTHING, dt);
    if (this.finishViewportAnimation) { ease = 1; this.finishViewportAnimation = false; }
    if (this.viewportChanged) {
      let x = this.x; let y = this.y; let zoom = this.zoom; let scale = this.scale;
      let tx = this.tx; let ty = this.ty;
      let tZoom = this.tZoom = clamp(this.tZoom, ZOOM_MIN, ZOOM_MAX);
      const dZoom = tZoom - zoom;
      if (Math.abs(dZoom) < 0.01) ease = 1;
      if (!Number.isFinite(dZoom)) { zoom = tZoom = 0; scale = 1; }
      else if (dZoom === 0) { zoom = tZoom; scale = Math.pow(2, zoom); }
      else if (this.zoomCenter) {
        // 以指针为中心缩放：保持指针下的世界坐标不动
        const gx = this.zoomCenter.x;
        const gy = this.zoomCenter.y;
        const oldScale = scale;
        zoom += dZoom * ease;
        scale = Math.pow(2, zoom);
        x -= gx / scale - gx / oldScale;
        y -= gy / scale - gy / oldScale;
        tx = x; ty = y;
      } else {
        zoom += dZoom * ease;
        scale = Math.pow(2, zoom);
      }
      const dx = tx - x; x += dx * ease; if (dx !== 0 && Math.abs(dx) < 0.01) x = tx;
      const dy = ty - y; y += dy * ease; if (dy !== 0 && Math.abs(dy) < 0.01) y = ty;
      this.x = x; this.y = y; this.zoom = zoom; this.scale = scale;

      const rect = this.canvasRect;
      this.canvasEl.style.transform = `translate(${rect.width / 2}px, ${rect.height / 2}px) scale(${scale}) translate(${-x}px, ${-y}px)`;
      const spacing = this.gridSpacing;
      const cell = spacing * scale;
      this.backgroundPatternEl.setAttrs({
        x: String(rect.width / 2 - (x % cell)),
        y: String(rect.height / 2 - (y % cell)),
        width: String(cell),
        height: String(cell),
      });
      // 原版仅在动画结束设置 --zoom-multiplier；这里每帧设置，让字号随缩放连续变化
      this.wrapperEl.setCssProps({ '--zoom-multiplier': String(Math.sqrt(1 / scale)) });
      this.wrapperEl.toggleClass('mod-zoomed-out', zoom <= ZOOMED_OUT_AT);
      for (const node of this.nodes.values()) node.updateBreakpoint(zoom > this.zoomBreakpoint || node.isEditing);

      if (this.x !== this.tx || this.y !== this.ty || this.zoom !== this.tZoom || Date.now() < this.pauseAnimation) {
        this.requestFrame(now);
        this.wasAnimating = true;
      } else {
        this.wrapperEl.removeClass('mod-animating');
        this.wasAnimating = false;
        this.viewportChanged = false;
      }
    }

    for (const el of Array.from(this.moved)) {
      this.moved.delete(el);
      if (el.isAttached) el.render();
    }
    for (const el of Array.from(this.dirty)) {
      this.dirty.delete(el);
      if (el.isAttached) el.render();
    }
  }

  /** 视口尺寸变化（由 workspace 调用）。 */
  onResize() {
    this.canvasRect = rectOf(this.wrapperEl);
    this.viewportChanged = true;
    this.requestFrame();
    if (this.canvasRect.width > 0 && this.zoomToFitQueued) {
      this.zoomToFitQueued = false;
      this.finishViewportAnimation = true;
      this.zoomToFit();
    }
  }
}
