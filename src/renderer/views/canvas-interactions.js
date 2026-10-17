/**
 * [INPUT]: 依赖 ./canvas-viewport.js 的 CanvasViewport（类链基类）；依赖 ./canvas-node.js 的 CanvasNode（instanceof 判定）；依赖 ./canvas-utils.js 的 clamp、containsBox、unionBBox、expandBBox；依赖 ../core/menu.js 的 Menu；依赖 ../core/i18n.js 的 t；依赖 ./canvas-menu.js 的 showCreationMenu、showQuickSettingsMenu
 * [OUTPUT]: 导出 CanvasInteractions 类（指针/键盘/拖拽/框选/滚轮/右键菜单）与 startDrag、suppressClick 两个拖拽原语。
 * [POS]: views/ 画布类链的第三层：View → CanvasViewport → CanvasInteractions → CanvasView。所有画布指针语义（阈值 5px 才成拖拽、拖到视口边缘 30px 自动平移、拖拽后吞掉一次 click）集中于此；
 *        CanvasView 只负责装配 DOM 与调度，节点/边自身不注册窗口级监听。startDrag 是原版 wg 的等价物：超过 threshold 后调用一次 factory，cleanup 先于 end/cancel。
 *        键盘含 Esc/Delete、Mod+A、Mod+Z/Mod+Shift+Z/Mod+Y、Shift+1/2，以及方向键微移选中节点（Shift 为 5 倍、对齐网格时吸附网格线）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas pointer + keyboard interactions (class chain layer 3). */
import { CanvasViewport } from './canvas-viewport.js';
import { CanvasNode } from './canvas-node.js';
import { clamp, containsBox, unionBBox, expandBBox } from './canvas-utils.js';
import { Menu } from '../core/menu.js';
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
    const zoomIntent = e.ctrlKey || e.metaKey;
    const discreteWheel = Math.abs(e.wheelDeltaY) === 240 && e.wheelDeltaX === 0;
    let zooming = zoomIntent || this.isHoldingSpace;
    if (discreteWheel) zooming = true;
    else if (!zoomIntent && !this.isHoldingSpace) zooming = false;

    e.preventDefault();
    let deltaX = e.deltaX;
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) { deltaX *= 40; deltaY *= 40; }
    else if (e.deltaMode === 2) { deltaX *= 800; deltaY *= 800; }

    if (zooming) {
      let amount = -deltaY / 300;
      const isMac = navigator.platform.startsWith('Mac');
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

  setDragging(isDragging) {
    if (this.isDragging === isDragging) return;
    this.isDragging = isDragging;
    this.wrapperEl.toggleClass('is-dragging', isDragging);
  }

  /* -------------------------------------------------------------- 背景 */

  onPointerdown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target !== this.wrapperEl) return;
    const shift = e.shiftKey;
    const prev = new Set(this.selection);
    if (!shift) this.deselectAll();
    this.handleDragToSelect(e, shift, prev);
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
        this.setDragging(false);
        if (handlers.cleanup) handlers.cleanup();
      },
    }), 0);
  }

  /** 拖动选中节点（分组会带上内部节点）。 */
  handleSelectionDrag(e, nodeEl, node) {
    if (this.readonly) return;
    const start = this.posFromEvt(e);
    if (node && !this.selection.has(node)) this.selectOnly(node);
    const items = new Set();
    for (const el of this.selection) {
      if (!(el instanceof CanvasNode)) continue;
      items.add(el);
      if (el.isGroup) for (const child of this.getContainingNodes(el.getBBox())) items.add(child);
    }
    const list = Array.from(items);
    const origin = new Map();
    for (const item of list) {
      origin.set(item, { x: item.x, y: item.y });
      item.nodeEl.addClass('is-dragging');
      item.updateZIndex();
    }
    this.handleDragWithPan(e, {
      move: (ev) => {
        const pos = this.posFromEvt(ev);
        let dx = pos.x - start.x;
        let dy = pos.y - start.y;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (this.options.snapToGrid && list.length) {
          const g = this.gridSpacing;
          const first = origin.get(list[0]);
          dx = Math.round((first.x + dx) / g) * g - first.x;
          dy = Math.round((first.y + dy) / g) * g - first.y;
        }
        for (const item of list) {
          const from = origin.get(item);
          item.moveTo({ x: from.x + dx, y: from.y + dy });
        }
      },
      end: () => {
        for (const item of list) item.nodeEl.removeClass('is-dragging');
        this.setDragging(false);
        this.requestSave();
      },
      cancel: () => {
        for (const item of list) { item.moveTo(origin.get(item)); item.nodeEl.removeClass('is-dragging'); }
      },
      cleanup: () => { if (nodeEl) suppressClick(nodeEl); },
    });
  }

  /** 背景框选。分组需被完整包含才算命中；shift 与已有选择异或。 */
  handleDragToSelect(e, shift, prev) {
    const start = this.posFromEvt(e);
    const selectionEl = this.selectionEl;
    this.handleDragWithPan(e, {
      move: (ev) => {
        const pos = this.posFromEvt(ev);
        const box = {
          minX: Math.min(start.x, pos.x),
          minY: Math.min(start.y, pos.y),
          maxX: Math.max(start.x, pos.x),
          maxY: Math.max(start.y, pos.y),
        };
        selectionEl.style.transform = `translate(${box.minX}px, ${box.minY}px)`;
        selectionEl.setCssStyles({ width: `${box.maxX - box.minX}px`, height: `${box.maxY - box.minY}px` });
        selectionEl.show();
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
      end: () => { selectionEl.hide(); suppressClick(this.wrapperEl); },
      cancel: () => { this.selectAll(prev); selectionEl.hide(); },
    });
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
