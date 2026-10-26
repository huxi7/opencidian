/**
 * [INPUT]: 依赖 GraphRenderer 的 canvasEl、onMouseDown/onMouseMove/onMouseUp、setPan/changed 及拖拽/平移状态字段。
 * [OUTPUT]: 导出 GraphTouchController；承接 pointerType 非 mouse 的单指拖节点/平移与双指捏合。
 * [POS]: graph-renderer 的触摸子控制器，对应原版 initGraphics 的 TouchEvent 分支 k()。
 *        鼠标仍走 GraphRenderer 的 MouseEvent 处理器；两者共用同一套 dragNode/panning 状态机，
 *        因此坐标换算、钉住/解钉与点击阈值只有一份实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { GraphRenderer } from './graph-renderer.js';
interface TouchPoint { x: number; y: number; }
export class GraphTouchController {
  declare renderer: GraphRenderer | null;
  declare pointers: Map<number, TouchPoint>;
  declare pinch: { ids: [number, number]; lastA: TouchPoint; lastB: TouchPoint } | null;
  declare dragPointerId: number | null;
  declare lastTouchAt: number;
  declare listening: boolean;
  declare windowMove: (event: PointerEvent) => void;
  declare windowUp: (event: PointerEvent) => void;
  declare windowCancel: (event: PointerEvent) => void;

  constructor(renderer: GraphRenderer) {
    this.renderer = renderer;
    this.pointers = new Map();   // pointerId → 最新触碰点（原版 k() 的 touches 列表）
    this.pinch = null;
    this.dragPointerId = null;   // 正在拖动节点的触点；其余手指的移动不参与拖拽
    this.lastTouchAt = 0;        // 触摸后浏览器可能补发兼容 mouse 事件，用于去重
    this.listening = false;
    this.windowMove = (ev) => this.onPointerMove(ev);
    this.windowUp = (ev) => this.onPointerUp(ev);
    this.windowCancel = (ev) => this.onPointerCancel(ev);
  }

  attach() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('pointermove', this.windowMove, { passive: false });
    window.addEventListener('pointerup', this.windowUp);
    window.addEventListener('pointercancel', this.windowCancel);
  }

  detach() {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('pointermove', this.windowMove);
    window.removeEventListener('pointerup', this.windowUp);
    window.removeEventListener('pointercancel', this.windowCancel);
  }

  cancel() {
    this.detach();
    this.pointers.clear();
    this.pinch = null;
    this.dragPointerId = null;
  }

  destroy() {
    this.cancel();
    this.renderer = null;
  }

  /* 原版：第一根手指按下命中节点即拖拽，否则平移；第二根手指落下进入捏合。 */
  onPointerDown(ev: PointerEvent) {
    const renderer = this.renderer;
    if (!renderer || !ev || ev.pointerType === 'mouse') return;
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    this.lastTouchAt = performance.now();
    this.attach();
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size === 1 && !this.pinch) {
      renderer.onMouseDown(ev);
      this.dragPointerId = renderer.dragNode ? ev.pointerId : null;
      return;
    }
    /* 拖动节点时的第二根手指不打断拖拽（原版同样以 dragNode 优先） */
    if (this.pointers.size === 2 && !renderer.dragNode) this.beginPinch();
  }

  onPointerMove(ev: PointerEvent) {
    const renderer = this.renderer;
    if (!renderer || !this.pointers.has(ev.pointerId)) return;
    if (ev.cancelable) ev.preventDefault();
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinch) { this.updatePinch(); return; }
    if (renderer.dragNode) {
      if (this.dragPointerId === null || this.dragPointerId === ev.pointerId) renderer.onMouseMove(ev);
      return;
    }
    if (renderer.panning) renderer.onMouseMove(ev);
  }

  onPointerUp(ev: PointerEvent) {
    const renderer = this.renderer;
    if (!renderer || !this.pointers.has(ev.pointerId)) return;
    this.lastTouchAt = performance.now();
    this.pointers.delete(ev.pointerId);
    if (this.dragPointerId === ev.pointerId) {
      /* 拖动节点的触点抬起：无论是否还有其它手指，都要结束拖拽 */
      this.dragPointerId = null;
      renderer.onMouseUp(ev);
      if (this.pointers.size === 1) {
        const point = this.pointers.values().next().value;
        if (!point) return;
        renderer.panning = true;
        renderer.panStart = { x: point.x, y: point.y };
        renderer.panOrigin = { x: renderer.panX, y: renderer.panY };
        renderer.panvX = renderer.panvY = 0;
        renderer.lastPanTime = performance.now();
      } else if (!this.pointers.size) {
        this.detach();
      }
      return;
    }
    if (this.pinch) {
      if (!this.pinch.ids.includes(ev.pointerId)) return; // 第三根手指抬起
      this.pinch = null;
      if (this.pointers.size === 1 && !renderer.dragNode) {
        /* 捏合结束后剩下一根手指：接着以它为锚点单指平移（原版同样保留 m 指针） */
        const point = this.pointers.values().next().value;
        if (!point) return;
        renderer.panning = true;
        renderer.panStart = { x: point.x, y: point.y };
        renderer.panOrigin = { x: renderer.panX, y: renderer.panY };
        renderer.panvX = renderer.panvY = 0;
        renderer.lastPanTime = performance.now();
      } else {
        renderer.panning = false;
        if (!this.pointers.size) this.detach();
      }
      renderer.changed();
      return;
    }
    if (this.pointers.size > 0) return;
    this.detach();
    if (renderer.dragNode || renderer.panning) renderer.onMouseUp(ev);
  }

  onPointerCancel(ev: PointerEvent) {
    if (!this.renderer || !this.pointers.has(ev.pointerId)) return;
    const wasPinch = !!this.pinch;
    this.pinch = null;
    if (this.dragPointerId === ev.pointerId) this.renderer.dragMoved = true; // 取消不是点击
    this.onPointerUp(ev);
    /* 捏合中取消一根手指：把剩下的一根恢复成单指平移 */
    if (wasPinch && this.pointers.size === 1 && !this.renderer.dragNode) {
      const point = this.pointers.values().next().value;
        if (!point) return;
      this.renderer.panning = true;
      this.renderer.panStart = { x: point.x, y: point.y };
      this.renderer.panOrigin = { x: this.renderer.panX, y: this.renderer.panY };
      this.renderer.panvX = this.renderer.panvY = 0;
      this.renderer.lastPanTime = performance.now();
    }
  }

  beginPinch() {
    const ids = [...this.pointers.keys()];
    if (ids.length < 2 || !this.renderer) return;
    const a = this.pointers.get(ids[0]);
    const b = this.pointers.get(ids[1]);
    if (!a || !b) return;
    this.renderer.panning = false;
    this.renderer.panvX = this.renderer.panvY = 0;
    this.pinch = {
      ids: [ids[0], ids[1]],
      lastA: { x: a.x, y: a.y },
      lastB: { x: b.x, y: b.y },
    };
  }

  /* 原版捏合：新旧两指中点位移平移，新/旧距离比缩放；缩放中心为新中点（设备像素）。 */
  updatePinch() {
    const renderer = this.renderer;
    const pinch = this.pinch;
    if (!pinch || !renderer) return;
    const a = this.pointers.get(pinch.ids[0]);
    const b = this.pointers.get(pinch.ids[1]);
    if (!a || !b) return;
    const lastA = pinch.lastA;
    const lastB = pinch.lastB;
    pinch.lastA = { x: a.x, y: a.y };
    pinch.lastB = { x: b.x, y: b.y };
    const rect = renderer.canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const oldMidX = ((lastA.x + lastB.x) / 2 - rect.left) * dpr;
    const oldMidY = ((lastA.y + lastB.y) / 2 - rect.top) * dpr;
    const newMidX = ((a.x + b.x) / 2 - rect.left) * dpr;
    const newMidY = ((a.y + b.y) / 2 - rect.top) * dpr;
    const oldDx = lastA.x - lastB.x;
    const oldDy = lastA.y - lastB.y;
    const newDx = a.x - b.x;
    const newDy = a.y - b.y;
    const oldDistanceSq = oldDx * oldDx + oldDy * oldDy;
    const newDistanceSq = newDx * newDx + newDy * newDy;
    if (!oldDistanceSq || !newDistanceSq) return;
    renderer.targetScale *= Math.sqrt(newDistanceSq / oldDistanceSq);
    renderer.zoomCenterX = newMidX;
    renderer.zoomCenterY = newMidY;
    renderer.setPan(renderer.panX + (newMidX - oldMidX), renderer.panY + (newMidY - oldMidY));
    renderer.changed();
  }
}
