/**
 * [INPUT]: 依赖 ./canvas-viewport.js 的 CanvasViewport（类链基类）；依赖 ./canvas-node.js 的 CanvasNode（instanceof 判定）；依赖 ./canvas-utils.js 的 clamp、containsBox、unionBBox、expandBBox、bboxOf、rectFromBBox；依赖 ./canvas-selection.js 的 CanvasSelectionBox；依赖 ../core/menu.js 的 Menu；依赖 ../core/keymap.js 的 IS_MAC；依赖 ../core/i18n.js 的 t；依赖 ./canvas-menu.js 的 showCreationMenu、showQuickSettingsMenu
 * [OUTPUT]: 导出 CanvasInteractions 类（选择集合语义：select/deselect/toggleSelect/selectOnly/selectAll/deselectAll、updateSelection/applySelectionDiff、deleteSelection；指针/键盘/拖拽/框选/滚轮/右键菜单；悬停命中 hitTestNode/interactionHitTest/setInteractionTarget/onPointermove/onPointerleave）与 startDrag、suppressClick 两个拖拽原语。
 * [POS]: views/ 画布类链的第三层：View → CanvasViewport → CanvasInteractions → CanvasView。所有画布指针语义（阈值 5px 才成拖拽、拖到视口边缘 30px 自动平移、拖拽后吞掉一次 click）集中于此；
 *        选择集合也归本层：改动一律走 updateSelection（先拍旧集合、置 selectionChanged），帧尾由 applySelectionDiff 统一处理焦点/高亮进出。
 *        CanvasView 只负责装配 DOM 与调度，节点/边自身不注册窗口级监听。startDrag 是原版 wg 的等价物：超过 threshold 后调用一次 factory，cleanup 先于 end/cancel。
 *        拖动选中集合时逐帧调用 viewport 的 getSnapping：吸附位移与参考线都由该层产出，drag 结束由 handleDragWithPan 的 cleanup 摘除参考线。
 *        按 mac Alt / 其他平台 Ctrl 拖动改为克隆：原件归位、替身跟着指针走，松手时 cloneData + importData 生成新节点并选中；拖动途中按下/松开该键即时切换（keydown/keyup 经 startDrag 转给 drag）。
 *        canSnap 为假（mac Ctrl / 其他 Alt）时不吸附也不画参考线。框选用 CanvasSelectionBox 画矩形，分组需被完整包含；按住 Mod 松手时按 defaultModDragBehavior 建卡或弹建卡菜单。
 *        键盘含 Esc/Delete、Mod+A、Mod+Z/Mod+Shift+Z/Mod+Y、Shift+1/2，以及方向键微移选中节点（Shift 为 5 倍、对齐网格时吸附网格线）。
 *        悬停命中（hitTestNode 取 8px/scale 容差 + interactionHitTest）：只给指针下的卡片加 .mod-handles 让手柄可命中；
 *        命中的卡片属于多选集合时收起手柄（原版 selection.size > 1 分支，帧尾也复核一次，避免指针静止时留下手柄）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas pointer + keyboard interactions (class chain layer 3). */
import { CanvasViewport } from './canvas-viewport.js';
import { CanvasNode } from './canvas-node.js';
import { CanvasSelectionBox } from './canvas-selection.js';
import { clamp, containsBox, unionBBox, expandBBox, bboxOf, boxesIntersect, rectFromBBox } from './canvas-utils.js';
import { Menu } from '../core/menu.js';
import { IS_MAC } from '../core/keymap.js';
import { t } from '../core/i18n.js';
import { showCreationMenu, showQuickSettingsMenu } from './canvas-menu.js';

const PAN_SPEED_FACTOR = 0.93;

/** 原版 kg：吞掉拖拽之后紧跟的那一次 click。 */
export function suppressClick(el) {
  const handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  window.setTimeout(() => el.removeEventListener('click', handler, { capture: true }), 0);
  el.addEventListener('click', handler, { capture: true });
}

/** 原版 wg：指针拖拽助手。factory 在超过 threshold 后调用一次；cleanup 先于 end/cancel 执行。 */
export function startDrag(e, factory, threshold = 5) {
  const win = window;
  const start = { x: e.clientX, y: e.clientY };
  let drag = null;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    win.removeEventListener('pointermove', onMove, true);
    win.removeEventListener('pointerup', onUp, true);
    win.removeEventListener('pointercancel', onCancel, true);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('keyup', onKeyUp, true);
    if (drag && drag.cleanup) drag.cleanup();
  };
  function onMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    if (!drag) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < threshold) return;
      drag = factory();
      if (!drag) { cleanup(); return; }
    }
    if (drag.move) drag.move(ev);
  }
  function onUp(ev) {
    if (ev.pointerId !== e.pointerId) return;
    const current = drag;
    cleanup();
    if (current && current.end) current.end(ev);
  }
  function onCancel(ev) {
    if (ev.pointerId !== e.pointerId) return;
    const current = drag;
    cleanup();
    if (current && current.cancel) current.cancel(ev);
  }
  function onKeyDown(ev) { if (drag && drag.keydown) drag.keydown(ev); }
  function onKeyUp(ev) { if (drag && drag.keyup) drag.keyup(ev); }
  win.addEventListener('pointermove', onMove, true);
  win.addEventListener('pointerup', onUp, true);
  win.addEventListener('pointercancel', onCancel, true);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('keyup', onKeyUp, true);
}

export class CanvasInteractions extends CanvasViewport {
  /* -------------------------------------------------------------- 键盘 */

  onKeydown(e) {
    if (e.repeat || e.defaultPrevented) return;
    if (e.key === 'Escape') { this.deselectAll(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.isDragging || document.activeElement !== this.wrapperEl) return;
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    // 焦点在输入控件内时不抢按键（原版 scope 的 isEditable 判定）
    const target = e.target;
    if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.selectAll();
      return;
    }
    // Shift+1 总览全局 / Shift+2 聚焦当前卡片（原版 scope 用物理键位）
    if (e.shiftKey && !mod && !e.altKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
      e.preventDefault();
      if (e.code === 'Digit1') this.zoomToFit(); else this.zoomToSelection();
      return;
    }
    // 方向键微移选中节点（原版 scope 的 nudgeSelection；Shift 为 5 倍步长）
    if (!mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (!this.selection.size) return;
      e.preventDefault();
      this.nudgeSelection(e, e.key.slice(5).toLowerCase());
    }
  }

  /** 方向键微移选中节点（原版 nudgeSelection：步长 = 网格间距，Shift 为 5 倍；对齐网格时吸附网格线）。 */
  nudgeSelection(ev, direction) {
    const nodes = Array.from(this.selection).filter((el) => el instanceof CanvasNode);
    if (!nodes.length) return;
    const step = ev.shiftKey ? 5 * this.gridSpacing : this.gridSpacing;
    const delta = { x: 0, y: 0 };
    if (direction === 'down') delta.y = step;
    else if (direction === 'up') delta.y = -step;
    else if (direction === 'left') delta.x = -step;
    else delta.x = step;
    if (this.options.snapToGrid) {
      const g = this.gridSpacing;
      const bbox = unionBBox(nodes.map((n) => n.getBBox()));
      const offsetX = Math.round(bbox.minX % g);
      const offsetY = Math.round(bbox.minY % g);
      if ((direction === 'left' || direction === 'right') && offsetX > 0) {
        delta.x = -offsetX;
        if (direction === 'right') delta.x += g;
      } else if ((direction === 'up' || direction === 'down') && offsetY > 0) {
        delta.y = -offsetY;
        // 原版此行把增量误加到 x（笔误）；按方向修正为 y。
        if (direction === 'down') delta.y += g;
      }
    }
    for (const node of nodes) node.moveTo({ x: node.x + delta.x, y: node.y + delta.y });
    this.requestSave();
  }

  /** 空格：进入平移模式（挂上 .canvas-mover 遮罩层）。焦点在输入控件时不生效。 */
  _globalKeydown(e) {
    if (e.key !== ' ' || this.isHoldingSpace) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('input, textarea, [contenteditable="true"]')) return;
    if (this.selection.size === 1) {
      const el = Array.from(this.selection)[0];
      if (el instanceof CanvasNode && el.isEditing) return;
    }
    this.wrapperEl.appendChild(this.moverEl);
    this.moverEl.style.zIndex = String(this.zIndexCounter + 4);
    this.isHoldingSpace = true;
  }

  _globalKeyup(e) {
    if (e.key !== ' ') return;
    this.moverEl.detach();
    this.isHoldingSpace = false;
  }

  /* -------------------------------------------------------------- 滚轮 */

  onWheel(e) {
    if (this.isDragging || e.defaultPrevented) return;
    const behavior = this.options.defaultWheelBehavior;
    const zoomIntent = e.ctrlKey || e.metaKey;
    let zooming = zoomIntent || this.isHoldingSpace;
    const discreteWheel = Math.abs(e.wheelDeltaY) === 240 && e.wheelDeltaX === 0;
    // 原版：defaultWheelBehavior=zoom 时滚轮缩放（离散鼠标滚轮仍平移）；默认 pan 时滚轮平移。
    if (behavior === 'zoom') zooming = discreteWheel ? false : !zooming;
    // macOS 触控板捏合表现为 ctrl+wheel 且两轴增量为 0：按当前选择/指针下卡片智能缩放。
    const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
    if (isMac && e.ctrlKey && e.deltaX === 0 && e.deltaY === 0) {
      e.preventDefault();
      this.smartZoom(e);
      return;
    }
    e.preventDefault();
    let deltaX = e.deltaX;
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) { deltaX *= 40; deltaY *= 40; }
    else if (e.deltaMode === 2) { deltaX *= 800; deltaY *= 800; }

    if (zooming) {
      let amount = -deltaY / 300;
      if (isMac && !Number.isInteger(deltaY)) amount *= 2;
      this.zoomBy(amount, deltaY < 0 ? this.domPosFromEvt(e) : undefined);
      this.pauseAnimation = Date.now() + 200;
    } else if (e.shiftKey && deltaX === 0) {
      this.tx += deltaY / this.scale * PAN_SPEED_FACTOR;
      this.markViewportChanged();
    } else {
      this.tx += deltaX / this.scale * PAN_SPEED_FACTOR;
      this.ty += deltaY / this.scale * PAN_SPEED_FACTOR;
      this.markViewportChanged();
    }
    this.finishViewportAnimation = true;
  }

  /** 原版 smartZoom：先看指针是否落在多选包围盒内，否则取指针下面积最小的卡片，再否则总览全局。 */
  smartZoom(e) {
    const pos = this.posFromEvt(e);
    const pointBox = { minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y };
    if (this.menu && this.selection.size > 0 && this.menu.selection.bbox
      && boxesIntersect(this.menu.selection.bbox, pointBox)) {
      this.zoomToSelection();
      return;
    }
    const hits = this.getIntersectingNodes(pointBox);
    if (hits.length) {
      hits.sort((a, b) => a.width * a.height - b.width * b.height);
      this.zoomToBbox(hits[0].getBBox());
      return;
    }
    this.zoomToFit();
  }

  /* ------------------------------------------------------------ 背景平移 */

  handleMoverPointerdown(e) {
    if (!e.isPrimary || e.button !== 0) return;
    const start = this.posFromEvt(e);
    startDrag(e, () => ({
      move: (ev) => {
        const pos = this.posFromEvt(ev);
        this.panBy(start.x - pos.x, start.y - pos.y);
      },
    }), 0);
  }

  /** 中键平移（原版 onPriorityPointerdown 的鼠标部分）。 */
  onPriorityPointerdown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 1) return;
    e.preventDefault();
    const start = this.posFromEvt(e);
    this.setDragging(true);
    startDrag(e, () => ({
      move: (ev) => {
        const pos = this.posFromEvt(ev);
        this.panBy(start.x - pos.x, start.y - pos.y);
      },
      cleanup: () => this.setDragging(false),
    }), 0);
  }

  /* -------------------------------------------------------------- 选择 */

  /**
   * 原版 updateSelection：改动前先拍下旧集合，焦点/高亮差异留到帧尾统一应用（applySelectionDiff），
   * 这样 1↔多选切换不会出现「已聚焦又被选中」的中间态。
   */
  updateSelection(mutate) {
    if (!this.staleSelection) this.staleSelection = Array.from(this.selection);
    mutate(this.selection);
    this.selectionChanged = true;
    this.requestFrame();
  }

  select(el) { if (!this.selection.has(el)) this.updateSelection((set) => set.add(el)); }

  deselect(el) { if (this.selection.has(el)) this.updateSelection((set) => set.delete(el)); }

  toggleSelect(el) {
    this.updateSelection((set) => { if (set.has(el)) set.delete(el); else set.add(el); });
  }

  selectOnly(el) {
    if (this.selection.size === 1 && this.selection.has(el)) return;
    this.updateSelection((set) => { set.clear(); set.add(el); });
  }

  selectAll(elements) {
    this.updateSelection((set) => {
      if (elements) { set.clear(); for (const el of elements) set.add(el); }
      else for (const node of this.nodes.values()) set.add(node);
    });
  }

  deselectAll() { if (this.selection.size) this.updateSelection((set) => set.clear()); }

  /** 帧尾应用选择差异（原版 renderFrame 对 staleSelection 的处理）：返回是否发生可见变化。 */
  applySelectionDiff() {
    const stale = this.staleSelection;
    if (!stale) return this.selectionChanged;
    const selection = this.selection;
    const oldSet = new Set(stale);
    let changed = this.selectionChanged;
    for (const el of stale) {
      if (selection.has(el)) continue;
      if (stale.length === 1) el.blur();
      else el.deselect();
      changed = true;
    }
    for (const el of Array.from(selection)) {
      if (oldSet.has(el)) {
        if (stale.length === 1 && selection.size > 1) { el.blur(); el.select(); changed = true; }
        else if (stale.length > 1 && selection.size === 1) { el.deselect(); el.focus(); changed = true; }
      } else {
        if (selection.size === 1) el.focus();
        else el.select();
        changed = true;
      }
    }
    this.staleSelection = null;
    this.selectionChanged = false;
    return changed;
  }

  deleteSelection() {
    if (this.readonly) return;
    for (const el of Array.from(this.selection)) {
      if (el instanceof CanvasNode) this.removeNode(el);
      else if (el instanceof CanvasEdge) this.removeEdge(el);
    }
    this.deselectAll();
    this.requestSave();
  }

  setDragging(isDragging) {
    if (this.isDragging === isDragging) return;
    this.isDragging = isDragging;
    this.wrapperEl.toggleClass('is-dragging', isDragging);
    // 拖动起止都要重绘浮动工具条（拖动中隐藏，松手恢复）
    this.selectionChanged = true;
    this.requestFrame();
  }

  /* ------------------------------------------------------- 悬停手柄命中 */

  /**
   * 原版 hitTestNode：矩形命中测试取 z 最高的节点（含分组——分组内部空白处悬停同样出边手柄）。
   * tolerance 是屏幕像素，按缩放折算到画布坐标。
   */
  hitTestNode(pos, tolerance = 0) {
    let best = null;
    for (const node of this.nodes.values()) {
      const box = expandBBox(bboxOf(node), tolerance);
      if (pos.x < box.minX || pos.x > box.maxX || pos.y < box.minY || pos.y > box.maxY) continue;
      if (!best || node.zIndex > best.zIndex) best = node;
    }
    return best;
  }

  /**
   * 原版 interactionHitTest：指针移动时算出该出手柄的节点。原版把这套手柄放进
   * 单独的 canvas-node-interaction-layer（C5）；本复刻手柄就近挂在节点上，
   * 改用 mod-handles 类承接同一显隐语义，故这里只需维护「当前命中节点」。
   * 拖动中不更新；命中节点属于多选集合时收起（原版 selection.size>1 && has(r) → setTarget(null)）。
   */
  interactionHitTest(e) {
    const pos = this.posFromEvt(e);
    if (this.pointerFrame) return;
    this.pointerFrame = window.requestAnimationFrame(() => {
      this.pointerFrame = 0;
      if (this.isDragging) return;
      const node = this.hitTestNode(pos, 8 / this.scale);
      if (this.selection.size > 1 && this.selection.has(node)) this.setInteractionTarget(null);
      else if (this.interactionTarget !== node) this.setInteractionTarget(node);
    });
  }

  setInteractionTarget(node) {
    if (this.interactionTarget === node) return;
    if (this.interactionTarget && !this.interactionTarget.destroyed) {
      this.interactionTarget.nodeEl.removeClass('mod-handles');
    }
    this.interactionTarget = node || null;
    if (this.interactionTarget) this.interactionTarget.nodeEl.addClass('mod-handles');
  }

  /* -------------------------------------------------------------- 背景 */

  onPointerdown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target !== this.wrapperEl) return;
    this.wrapperEl.focus({ preventScroll: true });
    const shift = e.shiftKey;
    const prev = new Set(this.selection);
    if (!shift) this.deselectAll();
    this.handleDragToSelect(e, shift, prev);
  }

  /** 指针移动：维护悬停手柄（原版 onPointermove → interactionHitTest，桌面端才有该监听）。 */
  onPointermove(e) {
    if (e.pointerType !== 'mouse') return;
    this.interactionHitTest(e);
  }

  /** 指针离开画布：收起悬停手柄，避免手柄留在没有指针的节点上。 */
  onPointerleave() {
    if (this.isDragging) return;
    this.setInteractionTarget(null);
  }

  onDoubleClick(e) {
    if (e.defaultPrevented || e.target !== this.wrapperEl || this.isDragging || this.readonly) return;
    const pos = this.posFromEvt(e);
    this.createTextNode({ pos, position: 'center' });
  }

  onContextMenu(e) {
    if (e.defaultPrevented || e.target !== this.wrapperEl || this.readonly) return;
    e.preventDefault();
    this.deselectAll();
    const pos = this.posFromEvt(e);
    const menu = new Menu(this.app);
    showCreationMenu(this, menu, pos);
    menu.addSeparator();
    if (this.history.canUndo()) {
      menu.addItem((item) => item.setSection('history').setTitle(t('setting.mobile-toolbar.option-undo')).setIcon('lucide-undo-2')
        .onClick(() => this.undo()));
    }
    if (this.history.canRedo()) {
      menu.addItem((item) => item.setSection('history').setTitle(t('setting.mobile-toolbar.option-redo')).setIcon('lucide-redo-2')
        .onClick(() => this.redo()));
    }
    showQuickSettingsMenu(this, menu);
    menu.showAtMouseEvent(e);
  }

  onSelectionContextMenu(e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const menu = new Menu(this.app);
    if (!this.readonly) {
      menu.addItem((item) => item.setTitle(t('plugins.canvas.action-remove')).setSection('danger').setIcon('lucide-trash-2')
        .onClick(() => this.deleteSelection()));
    }
    menu.addItem((item) => item.setTitle(t('plugins.canvas.action-zoom-to-selection')).setSection('selection').setIcon('zoom-to-selection')
      .onClick(() => this.zoomToSelection()));
    if (!this.readonly) {
      menu.addItem((item) => item.setTitle(t('plugins.canvas.action-create-group')).setSection('selection').setIcon('create-group')
        .onClick(() => {
          const boxes = [];
          for (const el of this.selection) if (el instanceof CanvasNode) boxes.push(el.getBBox());
          if (!boxes.length) return;
          const box = expandBBox(unionBBox(boxes), 20);
          this.createGroupNode({ pos: { x: box.minX, y: box.minY }, size: { width: box.maxX - box.minX, height: box.maxY - box.minY } });
        }));
    }
    this.app.workspace.trigger('canvas:selection-menu', menu, this);
    menu.showAtMouseEvent(e);
  }

  /* ------------------------------------------------------------ 拖拽助手 */

  /** 拖拽通用：靠近视口边缘时自动平移（原版 handleDragWithPan）。 */
  handleDragWithPan(e, handlers) {
    const rect = this.wrapperEl.getBoundingClientRect();
    const inner = { minX: rect.x + 30, minY: rect.y + 30, maxX: rect.right - 30, maxY: rect.bottom - 30 };
    this.setDragging(true);
    let panX = 0;
    let panY = 0;
    let timer = 0;
    startDrag(e, () => ({
      ...handlers,
      move: (ev) => {
        panX = 0; panY = 0;
        if (ev.clientX < inner.minX) panX = ev.clientX - inner.minX;
        else if (ev.clientX > inner.maxX) panX = ev.clientX - inner.maxX;
        if (ev.clientY < inner.minY) panY = ev.clientY - inner.minY;
        else if (ev.clientY > inner.maxY) panY = ev.clientY - inner.maxY;
        if (panX !== 0 || panY !== 0) {
          panX = clamp(panX, -40, 40);
          panY = clamp(panY, -40, 40);
          if (!timer) {
            timer = window.setInterval(() => {
              const speed = 0.5 / Math.sqrt(this.scale);
              this.panBy(panX * speed, panY * speed);
            }, 1000 / 60);
          }
        } else if (timer) {
          window.clearInterval(timer);
          timer = 0;
        }
        if (handlers.move) handlers.move(ev);
      },
      cleanup: () => {
        if (timer) { window.clearInterval(timer); timer = 0; }
        this.endSnapPointRendering();
        this.setDragging(false);
        if (handlers.cleanup) handlers.cleanup();
      },
    }), 0);
  }

  /** 拖动选中节点（分组会带上内部节点；mac 按住 Alt / 其他平台按住 Ctrl 改为克隆整组）。 */
  handleSelectionDrag(e, nodeEl, node) {
    if (this.readonly) return;
    if (document.activeElement !== this.wrapperEl) this.wrapperEl.focus({ preventScroll: true });
    const start = this.posFromEvt(e);
    if (node && !this.selection.has(node)) this.selectOnly(node);
    const items = new Set();
    for (const el of this.selection) {
      if (!(el instanceof CanvasNode)) continue;
      items.add(el);
      if (el.isGroup) for (const child of this.getContainingNodes(el.getBBox())) items.add(child);
    }
    const originals = Array.from(items);
    const origin = new Map();
    for (const item of originals) {
      origin.set(item, { x: item.x, y: item.y });
      item.nodeEl.addClass('is-dragging');
      item.updateZIndex();
    }
    // 拖动中按住克隆键：原件归位，替身跟着指针走；松开则原件回到替身位置（原版 d()）
    let dragged = originals;
    let clones = null;
    const setCloneMode = (ev) => {
      const cloneKey = IS_MAC ? ev.altKey : ev.ctrlKey;
      if (cloneKey && !clones) {
        clones = [];
        dragged = clones;
        for (const item of originals) {
          const from = origin.get(item);
          const dummy = this.createDummyNode();
          clones.push(dummy);
          origin.set(dummy, from);
          dummy.x = item.x;
          dummy.y = item.y;
          dummy.width = item.width;
          dummy.height = item.height;
          dummy.render();
          dummy.nodeEl.addClass('is-dragging');
          item.moveTo(from);
        }
      } else if (!cloneKey && clones) {
        for (let i = 0; i < originals.length; i++) {
          originals[i].moveTo({ x: clones[i].x, y: clones[i].y });
          clones[i].detach();
        }
        clones = null;
        dragged = originals;
      }
    };
    const boxAt = (item, dx, dy) => {
      const from = origin.get(item);
      return bboxOf({ x: from.x + dx, y: from.y + dy, width: item.width, height: item.height });
    };
    /** 拖动位移 + 吸附（原版 m()）：Shift 锁轴、canSnap 为假时只认同轴完全对齐。 */
    const deltaFor = (ev) => {
      const pos = this.posFromEvt(ev);
      const delta = { x: pos.x - start.x, y: pos.y - start.y };
      if (ev.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0; }
      if (!this.canSnap(ev)) return delta;
      const draggedGroups = dragged.filter((item) => item.isGroup);
      let source = dragged;
      if (draggedGroups.length === 1) source = draggedGroups;
      else if (draggedGroups.length > 1) {
        // 被其他被拖分组完整包含的分组不参与吸附（原版 c()）
        source = draggedGroups.filter((group) => {
          const box = group.getBBox();
          return !draggedGroups.some((other) => {
            if (other === group) return false;
            const otherBox = other.getBBox();
            const same = otherBox.minX === box.minX && otherBox.minY === box.minY
              && otherBox.maxX === box.maxX && otherBox.maxY === box.maxY;
            return !same && containsBox(otherBox, box);
          });
        });
      }
      const draggedSet = new Set(dragged);
      const boxes = source.map((item) => boxAt(item, delta.x, delta.y));
      const candidates = [];
      for (const other of this.nodes.values()) {
        if (draggedSet.has(other) || (draggedGroups.length > 0) !== !!other.isGroup) continue;
        candidates.push(other.getBBox());
      }
      const snap = this.getSnapping(boxes, candidates, delta.x !== 0, delta.y !== 0);
      return { x: delta.x + snap.x, y: delta.y + snap.y };
    };
    this.handleDragWithPan(e, {
      move: (ev) => {
        this.clearSnapPoints();
        setCloneMode(ev);
        const delta = deltaFor(ev);
        for (const item of dragged) {
          const from = origin.get(item);
          item.moveTo({ x: from.x + delta.x, y: from.y + delta.y });
        }
      },
      end: (ev) => {
        for (const item of originals) item.nodeEl.removeClass('is-dragging');
        if (clones) {
          const delta = deltaFor(ev);
          const copy = this.cloneData(this.getSelectionData(items), delta);
          const created = this.importData(copy, false);
          this.clearSnapPoints();
          this.selectAll(created);
        }
        this.setDragging(false);
        this.requestSave();
      },
      cancel: () => {
        for (const item of originals) { item.moveTo(origin.get(item)); item.nodeEl.removeClass('is-dragging'); }
      },
      cleanup: () => {
        if (clones) for (const clone of clones) clone.detach();
        if (nodeEl) suppressClick(nodeEl);
      },
      keydown: (ev) => setCloneMode(ev),
      keyup: (ev) => setCloneMode(ev),
    });
  }

  /**
   * 背景框选（原版 handleDragToSelect）：拖动时挂 .canvas-selection 矩形，分组需被完整包含才算命中，
   * Shift 与已有选择异或；收尾按住 Mod 时按 defaultModDragBehavior 建卡或弹建卡菜单。
   */
  handleDragToSelect(e, shift, prev) {
    const start = this.posFromEvt(e);
    const marquee = new CanvasSelectionBox(this);
    this.handleDragWithPan(e, {
      move: (ev) => {
        const pos = this.posFromEvt(ev);
        const box = {
          minX: Math.min(start.x, pos.x),
          minY: Math.min(start.y, pos.y),
          maxX: Math.max(start.x, pos.x),
          maxY: Math.max(start.y, pos.y),
        };
        marquee.update(box);
        const hits = this.getIntersectingNodes(box).filter((node) => !node.isGroup || containsBox(box, node.getBBox()));
        let next = new Set(hits);
        if (shift) {
          next = new Set(prev);
          for (const node of hits) {
            if (next.has(node)) next.delete(node);
            else next.add(node);
          }
        }
        this.selectAll(next);
      },
      end: (ev) => {
        this.finishDragToSelect(marquee, ev);
        suppressClick(this.wrapperEl);
      },
      cancel: () => { this.selectAll(prev); marquee.hide(); },
    });
  }

  /** 框选收尾（原版 end）：未按 Mod 收起框；按 Mod 时按 defaultModDragBehavior 用框的尺寸建卡或弹建卡菜单。 */
  finishDragToSelect(marquee, ev) {
    const isMod = IS_MAC ? ev.metaKey : ev.ctrlKey;
    if (!isMod) { marquee.hide(); return; }
    const rect = rectFromBBox(marquee.bbox);
    const closeOnDone = { onChoose: () => marquee.hide(), onCancel: () => marquee.hide() };
    switch (this.options.defaultModDragBehavior) {
      case 'card':
        this.createTextNode({ pos: rect, size: rect });
        marquee.hide();
        break;
      case 'note':
        this.promptAddFileNode({ pos: rect, size: rect, ...closeOnDone });
        break;
      case 'media':
        this.promptAddFileNode({ pos: rect, size: rect, media: true, ...closeOnDone });
        break;
      case 'webpage':
        this.promptAddLinkNode({ pos: rect, size: rect, ...closeOnDone });
        break;
      case 'group':
        this.createGroupNode({ pos: rect, size: rect });
        marquee.hide();
        break;
      default: {
        const menu = new Menu(this.app);
        showCreationMenu(this, menu, rect, rect);
        menu.showAtMouseEvent(ev);
        // 本复刻的 Menu.showAtPosition 会先 close() 且不清 onHide，故在显示之后再挂关闭回调
        menu.onHide = () => marquee.hide();
      }
    }
  }

  /** 卡片菜单拖动建卡：先拖一个虚影，落点再创建。 */
  dragTempNode(e, size, cb) {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    const dummy = this.createDummyNode();
    dummy.moveAndResize({ x: this.posFromEvt(e).x - size.width / 2, y: this.posFromEvt(e).y - size.height / 2, width: size.width, height: size.height });
    dummy.nodeEl.addClass('is-dragging');
    this.handleDragWithPan(e, {
      move: (ev) => {
        const pos = this.posFromEvt(ev);
        dummy.moveAndResize({ x: pos.x - size.width / 2, y: pos.y - size.height / 2, width: size.width, height: size.height });
      },
      end: (ev) => {
        if (this.posInViewport(this.domPosFromEvt(ev))) cb({ x: dummy.x, y: dummy.y }, size);
      },
      cleanup: () => this.removeDummyNode(dummy),
    });
  }
}
