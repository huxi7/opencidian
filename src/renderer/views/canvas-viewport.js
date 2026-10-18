/**
 * [INPUT]: 依赖 ../core/view.js 的 View（类链基类）；依赖 ./canvas-utils.js 的 clamp、unionBBox、expandBBox、rectOf
 * [OUTPUT]: 导出 CanvasViewport 类，供 canvas-interactions.js 继承。含视口状态机（x,y 为视口中心世界坐标，zoom=log2(scale)）、
 *           坐标换算（posFromDom/domFromPos 等）、requestFrame/renderFrame 动画帧、markViewportChanged/markMoved/markDirty 标记，
 *           以及物体对齐（getSnapping/renderSnapPoints/clearSnapPoints/endSnapPointRendering，参考线画在 svg.canvas-snaps）；
 *           并导出吸附点工具 uniqueSnapPoints（原版 A3）与 findSnapMatches（原版 L3），供多选包围盒缩放复用。
 * [POS]: views/ 画布类链的第二层：View → CanvasViewport → CanvasInteractions → CanvasView。所有画布子视图共享这一层视口语义；
 *        节点/边通过 markMoved 请求重绘；帧内先把移动节点的关联边一并加入重绘集合（边坐标由节点推导），再统一 render。
 *        帧尾调用 applySelectionDiff 应用选择差异，并在选择/视口/被选元素发生变化时重绘浮动工具条（原版 menu.render）。缩放夹在边界内并刷新正文挂载，停止后释放动画帧。
 *        吸附取「4 角 + 中心」共 5 点（原版 D3），逐轴找最近对齐值（原版 L3）；snapToObjects=false 时不吸附、不画参考线。
 *        候选节点取全部节点而非原版的视口内节点（本复刻不做视口虚拟化），分组只与分组对齐。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas viewport engine — original viewport math + animation frame (class chain layer 2). */
import { View } from '../core/view.js';
import { clamp, unionBBox, expandBBox, rectOf } from './canvas-utils.js';
import { CanvasNode } from './canvas-node.js';

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

  /* ------------------------------------------------------- 物体对齐与参考线 */

  /**
   * 原版 getSnapping：返回把 boxes 吸附到 others 与网格所需的位移，并按需画参考线。
   * useX/useY 为假表示该轴没有位移，只认同轴完全对齐（原版传 0 作为阈值）。
   */
  getSnapping(boxes, others, useX, useY) {
    if (!boxes.length) return { x: 0, y: 0 };
    let xMatch = null;
    let yMatch = null;
    let dx = 0;
    let dy = 0;
    if (this.options.snapToObjects) {
      const src = uniqueSnapPoints(boxes);
      const dest = uniqueSnapPoints(others);
      const dist = this.snapDistance;
      xMatch = findSnapMatches(src, dest, useX ? dist : 0, 'x');
      if (xMatch) dx += xMatch.delta;
      yMatch = findSnapMatches(src, dest, useY ? dist : 0, 'y');
      if (yMatch) dy += yMatch.delta;
    }
    if (this.options.snapToGrid && (!xMatch || !yMatch)) {
      const box = unionBBox(boxes);
      const g = this.gridSpacing;
      if (!xMatch && useX) dx += Math.round(box.minX / g) * g - box.minX;
      if (!yMatch && useY) dy += Math.round(box.minY / g) * g - box.minY;
    }
    if (xMatch || yMatch) this.renderSnapPoints(xMatch, yMatch, dx, dy);
    return { x: dx, y: dy };
  }

  /** 画参考线：每个匹配点画圆点，并按匹配范围画一条直线（原版 renderSnapPoints）。 */
  renderSnapPoints(xMatch, yMatch, dx, dy) {
    let el = this.snapContainerEl;
    if (!el) el = this.snapContainerEl = this.canvasEl.createSvg('svg', { cls: 'canvas-snaps' });
    el.style.zIndex = String(this.zIndexCounter + 2);
    const offset = (p) => ({ x: p.x + dx, y: p.y + dy });
    const matches = [];
    if (xMatch) matches.push(...xMatch.matches);
    if (yMatch) matches.push(...yMatch.matches);
    for (const match of matches) {
      const points = match.src.map(offset).concat(match.dest);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        el.createSvg('circle', { attr: { cx: p.x, cy: p.y, r: 4 } });
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      el.createSvg('line', { attr: { x1: minX, y1: minY, x2: maxX, y2: maxY } });
    }
  }

  /** 清空参考线元素，保留容器（拖动中每次 move 先清后画）。 */
  clearSnapPoints() {
    if (this.snapContainerEl) this.snapContainerEl.empty();
  }

  /** 摘除参考线容器（drag 结束或取消时调用）。 */
  endSnapPointRendering() {
    if (!this.snapContainerEl) return;
    this.snapContainerEl.detach();
    this.snapContainerEl = null;
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
  /** 原版 markDirty：被选中的元素变脏时标记选择变化，帧尾据此重绘浮动工具条（例如取色器实时改色）。 */
  markDirty(el) {
    this.dirty.add(el);
    if (this.selection.has(el)) this.selectionChanged = true;
    this.requestFrame();
  }

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
    const viewportWasChanged = this.viewportChanged;
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

    if (this.moved.size) {
      // 原版帧渲染：把移动节点的关联边一并加入重绘集合（边坐标由节点推导）
      for (const el of Array.from(this.moved)) {
        if (el instanceof CanvasNode) {
          for (const edge of this.getEdgesForNode(el)) this.moved.add(edge);
        }
      }
    }
    const movedEls = new Set(this.moved);
    for (const el of movedEls) {
      this.moved.delete(el);
      if (el.isAttached) el.render();
    }
    for (const el of Array.from(this.dirty)) {
      this.dirty.delete(el);
      if (el.isAttached) el.render();
    }
    // 原版帧尾：先应用选择差异（1↔多选的焦点/高亮切换），再让浮动工具条按需重绘。
    const selectionChanged = this.applySelectionDiff();
    if (this.menu && (selectionChanged || viewportWasChanged || Array.from(this.selection).some((el) => movedEls.has(el)))) {
      this.menu.render(selectionChanged);
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

/* --------------------------------------------------------------------------
 * 对齐点计算 — 原版 D3 / A3 / L3 的对应实现（纯函数，不依赖画布状态）
 * ------------------------------------------------------------------------ */

/** 原版 D3：矩形取 4 角 + 中心，共 5 个对齐点。 */
function boxSnapPoints(box) {
  const { minX, minY, maxX, maxY } = box;
  return [
    { x: minX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  ];
}

/** 原版 A3：合并全部点，按 x/y 排序后按坐标去重。 */
export function uniqueSnapPoints(boxes) {
  const all = [];
  for (const box of boxes) all.push(...boxSnapPoints(box));
  all.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const out = [];
  let last = null;
  for (const point of all) {
    if (last && last.x === point.x && last.y === point.y) continue;
    last = point;
    out.push(point);
  }
  return out;
}

/**
 * 原版 L3：在单轴上为 src 的每个坐标找 dest 中最近的坐标，取绝对差最小且在 dist 内的位移，
 * 返回该位移下的全部点对（src 是移动前的点，dest 是对齐目标点）。
 */
export function findSnapMatches(src, dest, dist, axis) {
  if (!src.length || !dest.length) return null;
  const valueOf = (p) => (axis === 'x' ? p.x : p.y);
  const sortedSrc = src.slice().sort((a, b) => valueOf(a) - valueOf(b));
  const sortedDest = dest.slice().sort((a, b) => valueOf(a) - valueOf(b));
  let delta = dist;
  let matches = [];
  let index = 0;
  while (index < sortedSrc.length) {
    const value = valueOf(sortedSrc[index]);
    const srcGroup = [];
    while (index < sortedSrc.length && valueOf(sortedSrc[index]) === value) srcGroup.push(sortedSrc[index++]);
    const { point: nearest, at } = nearestByAxis(sortedDest, value, valueOf);
    const candidate = valueOf(nearest) - value;
    if (candidate === delta) {
      matches.push({ src: srcGroup, dest: destGroupAt(sortedDest, at, valueOf) });
    } else if (Math.abs(candidate) < Math.abs(delta)) {
      delta = candidate;
      matches = [{ src: srcGroup, dest: destGroupAt(sortedDest, at, valueOf) }];
    }
  }
  return matches.length ? { matches, delta } : null;
}

/** 二分找 dest 中与 value 最接近的点（有序数组）。 */
function nearestByAxis(sorted, value, valueOf) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (valueOf(sorted[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  let at = lo;
  if (at > 0 && Math.abs(valueOf(sorted[at - 1]) - value) <= Math.abs(valueOf(sorted[at]) - value)) at -= 1;
  return { point: sorted[at], at };
}

/** 取 dest 中与 sorted[at] 同坐标的全部点（原版向前后扩展同值区间）。 */
function destGroupAt(sorted, at, valueOf) {
  const value = valueOf(sorted[at]);
  let start = at;
  let end = at;
  while (start > 0 && valueOf(sorted[start - 1]) === value) start -= 1;
  while (end < sorted.length - 1 && valueOf(sorted[end + 1]) === value) end += 1;
  return sorted.slice(start, end + 1);
}
