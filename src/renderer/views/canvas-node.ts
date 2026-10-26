/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 genId/bboxOf/nearestSide/applyCanvasColor/parseCanvasColor；依赖 ../core/i18n.js 的 t；依赖 ../core/menu.js 的 Menu；依赖 ../core/keymap.js 的 IS_MAC
 * [OUTPUT]: 导出 CanvasNode（基类）、CanvasContentNode、CanvasDummyNode、parkEditorSelection、hasCanvasEditor；CanvasTextNode 见 canvas-text-node.js，CanvasFileNode 见 canvas-file-node.js，CanvasGroupNode 见 canvas-group-node.js，CanvasLinkNode 见 canvas-link-node.js
 * [POS]: views/ 画布三件套的节点层。DOM 对齐原版：nodeEl(.canvas-node) > containerEl(.canvas-node-container) > contentEl(.canvas-node-content)
 *        + contentBlockerEl + placeholderEl；8 个 resizer（data-resize）挂在 nodeEl 上，连接点（data-side）嵌在对应边的 resizer 内（原版结构）。
 *        手柄显隐由 canvas-interactions 的悬停命中加 .mod-handles 门控：只有指针下的卡片手柄可命中，未命中卡片的手柄一律让位给框选与拖动。
 *        resize() 与原版 onResizePointerdown 同算法：minContainerDimension 下限、物体吸附 + 参考线、可选网格吸附、aspectRatio 分支与 selectNow。
 *        文件与链接卡片带卡片外上方标签（原版 D5/I5.updateNodeLabel）：always 常显、hover 透明待悬停、never 不建；点标签可 Mod 新页、双击打开。
 *        setColor 把自定义色归一化为 "r,g,b" 后交给帧渲染或立即重绘，供选择浮动工具条的取色器调用。
 *        可读缩放与编辑态挂载正文；输入逐次请求防抖保存。几何与事件写回由 canvas-view 统一调度。
 *        文本卡片（含内嵌 CM6 编辑器）在 canvas-text-node.js；本文件只保留基类、正文容器与拖拽替身。
 *        onConnectionPointerdown 的虚影与临时边建在拖拽真正开始时（handlers.start）：原版 oM 把它们放在工厂里，
 *        纯点击连接点不建、不留 .is-dummy 蓝框，也不留悬空边。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas nodes — mirrors the original E5 / M5 base and content classes. */
import { genId, bboxOf, applyCanvasColor, parseCanvasColor } from './canvas-utils.js';
import { resizeSourceFrom } from './canvas-selection.js';
import { uniqueSnapPoints, findSnapMatches } from './canvas-viewport.js';
import { t } from '../core/i18n.js';
import { Menu } from '../core/menu.js';
import { IS_MAC } from '../core/keymap.js';
import { Editor } from '../editor/editor.js';
import { CanvasEdge, type CanvasEndpoint } from './canvas-edge.js';
import { CanvasTextNode } from './canvas-text-node.js';
import type { ActiveEditorHost } from '../core/commands.js';
import type { CanvasPoint, CanvasRect, CanvasBBox } from './canvas-utils.js';
import { CanvasNodeData } from './canvas-types.js';

const RESIZE_SIDES = ['top', 'right', 'bottom', 'left', 'topright', 'bottomright', 'bottomleft', 'topleft'];
const CONNECT_SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * 原版未编辑的卡片是阅读视图，不显示 markdown 记号。本复刻的正文是常驻 CM6 编辑器，
 * 光标所在行会把语法记号还原成源码；把只读光标停在没有记号的行上，视觉上等价于阅读视图。
 */
export function parkEditorSelection(editor: Editor) {
  if (!editor) return;
  const doc = editor.getDoc();
  let line = 0;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!/[\\`*_~$#[\]!>=-]/.test(text)) { line = n - 1; break; }
    if (n === doc.lines) line = doc.lines - 1;
  }
  editor.setCursor(line, 0);
}

export function hasCanvasEditor<T extends { editor: Editor | null }>(host: T): host is T & { editor: Editor } {
  return host.editor !== null;
}

export class CanvasNode {
  onReadonlyChange(readonly: boolean): void {}
  declare contentEl: HTMLElement;
  declare contentBlockerEl: HTMLElement;
  declare placeholderEl: HTMLElement;
  declare canvas: import('./canvas-view.js').CanvasView;
  declare app: App;
  declare id: string;
  declare x: number;
  declare y: number;
  declare width: number;
  declare height: number;
  declare color: string;
  declare unknownData: Record<string, unknown>;
  declare initialized: boolean;
  declare zIndex: number;
  declare renderedZIndex: number;
  declare aspectRatio: number;
  declare isEditing: boolean;
  declare destroyed: boolean;
  declare isSmall: boolean | null;
  declare isContentMounted: boolean;
  declare isGroup: boolean;
  declare nodeEl: HTMLDivElement;
  declare containerEl: HTMLDivElement;

  constructor(canvas: import('./canvas-view.js').CanvasView, id?: string) {
    this.canvas = canvas;
    this.app = canvas.app;
    this.id = id || genId();
    this.x = 0;
    this.y = 0;
    this.width = 100;
    this.height = 100;
    this.color = '';
    this.unknownData = {};
    this.initialized = false;
    this.zIndex = -1;
    this.renderedZIndex = -1;
    this.aspectRatio = 0;
    this.isEditing = false;
    this.destroyed = false;
    this.isSmall = null;
    this.isContentMounted = false;
    this.isGroup = false;
    this.nodeEl = createDiv('canvas-node');
  }

  /* ------------------------------------------------------------ 生命周期 */

  get isAttached() { return !!this.nodeEl.parentNode; }

  attach() {
    if (!this.isAttached) this.canvas.canvasEl.appendChild(this.nodeEl);
    this.updateBreakpoint(this.canvas.zoom > this.canvas.zoomBreakpoint || this.isEditing);
  }

  detach() {
    if (this.isAttached) this.nodeEl.detach();
  }

  destroy() {
    this.detach();
    this.destroyed = true;
  }

  initialize() {
    const nodeEl = this.nodeEl;
    nodeEl.addEventListener('click', (e) => this.onClick(e));
    nodeEl.addEventListener('contextmenu', (e: MouseEvent) => this.onContextMenu(e));
    const containerEl = this.containerEl = nodeEl.createDiv('canvas-node-container');
    containerEl.addEventListener('pointerdown', (e: PointerEvent) => this.onPointerdown(e));

    // 8 个缩放手柄（原版 4 边 + 4 角）；连接点嵌在对应边的 resizer 里（原版结构），
    // 这样「悬停某侧手柄 ⇒ 该侧圆点显形」可以用原版那条 :hover 规则表达。
    for (const side of RESIZE_SIDES) {
      const el = nodeEl.createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': side } });
      el.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.target === el && e.pointerType === 'mouse') this.onResizePointerdown(e, side);
      });
      if (CONNECT_SIDES.includes(side)) {
        const point = el.createDiv({ cls: 'canvas-node-connection-point', attr: { 'data-side': side } });
        point.addEventListener('pointerdown', (e: PointerEvent) => this.onConnectionPointerdown(e, side));
      }
    }
  }

  /* ---------------------------------------------------------------- 渲染 */

  render() {
    if (!this.initialized) {
      this.initialized = true;
      this.initialize();
      if (this.zIndex < 0) this.updateZIndex();
    }
    const nodeEl = this.nodeEl;
    nodeEl.setCssStyles({
      transform: `translate(${this.x}px, ${this.y}px)`,
      width: `${this.width}px`,
      height: `${this.height}px`,
    });
    nodeEl.setCssProps({
      '--canvas-node-width': `${this.width}px`,
      '--canvas-node-height': `${this.height}px`,
    });
    applyCanvasColor(nodeEl, this.color);
    nodeEl.toggleClass('is-themed', !!this.color);
    this.renderZIndex();
    this.updateBreakpoint(this.canvas.zoom > this.canvas.zoomBreakpoint || this.isEditing);
  }

  updateBreakpoint(showContent: boolean) {
    this.isSmall = !showContent;
    if (showContent) this.mountContent();
    else this.unmountContent();
  }

  mountContent() {
    if (!this.initialized || this.isContentMounted || !this.contentEl) return;
    const containerEl = this.containerEl;
    containerEl.appendChild(this.contentEl);
    if (this.contentBlockerEl) containerEl.appendChild(this.contentBlockerEl);
    if (this.placeholderEl) this.placeholderEl.detach();
    this.isContentMounted = true;
  }

  unmountContent() {
    if (!this.initialized || !this.isContentMounted || !this.contentEl) return;
    this.contentEl.detach();
    if (this.contentBlockerEl) this.contentBlockerEl.detach();
    if (this.placeholderEl) this.containerEl.appendChild(this.placeholderEl);
    this.isContentMounted = false;
  }

  updateZIndex() {
    if (this.zIndex !== this.canvas.zIndexCounter) this.zIndex = this.canvas.getZIndex();
    this.renderZIndex();
  }

  renderZIndex() {
    const canvas = this.canvas;
    let z = this.zIndex;
    if (canvas.selection.size === 1 && canvas.selection.has(this)) z = canvas.zIndexCounter + 1;
    if (z !== this.renderedZIndex) {
      this.nodeEl.style.zIndex = String(z);
      this.renderedZIndex = z;
    }
  }

  /** 原版 setColor：自定义色按 R3 归一化为 "r,g,b"；immediate 为真立刻重绘，否则交给帧渲染（拖动取色器时用）。 */
  setColor(color: string, immediate?: boolean) {
    const raw = String(color || '').trim();
    const rgb = /^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(raw) ? null : parseCanvasColor(raw);
    const next = rgb ? `${rgb.r},${rgb.g},${rgb.b}` : raw;
    if (this.color === next) return;
    this.color = next;
    if (immediate) this.render();
    else this.canvas.markDirty(this);
  }

  get isFocused() { return this.nodeEl.hasClass('is-focused'); }
  focus() { this.nodeEl.addClass('is-focused'); this.renderZIndex(); this.registerActiveEditor(); }
  blur() {
    this.nodeEl.removeClass('is-focused');
    this.setIsEditing(false);
    this.renderZIndex();
    this.clearActiveEditor();
  }
  select() { this.nodeEl.addClass('is-selected'); this.renderZIndex(); }
  deselect() { this.nodeEl.removeClass('is-selected'); this.renderZIndex(); }

  /* ---------------------------------------------------- 活动编辑器登记 */

  /**
   * 命令层要作用的编辑器宿主（原版 workspace.activeEditor 的形状：{ editor, file, containerEl }）。
   * 基类没有内嵌编辑器，返回 null；文本卡片重写为自身（见 CanvasTextNode.getActiveEditorHost）。
   */
  getActiveEditorHost(): ActiveEditorHost | null { return null; }

  registerActiveEditor() { this.app.workspace.setActiveEditor(this.getActiveEditorHost()); }

  clearActiveEditor() { this.app.workspace.unsetActiveEditor(this.getActiveEditorHost()); }

  setIsEditing(isEditing: boolean) {
    if (this.isEditing === isEditing) return;
    this.isEditing = isEditing;
    this.nodeEl.toggleClass('is-editing', isEditing);
  }

  isEditable() { return false; }
  startEditing(position?: unknown) {}

  /* ---------------------------------------------------------------- 几何 */

  getBBox() { return bboxOf(this); }

  moveTo(pos: CanvasPoint) {
    this.x = Math.round(pos.x);
    this.y = Math.round(pos.y);
    this.canvas.markMoved(this);
  }

  moveAndResize(rect: CanvasRect) {
    this.x = Math.round(rect.x);
    this.y = Math.round(rect.y);
    this.width = Math.round(rect.width);
    this.height = Math.round(rect.height);
    this.canvas.markMoved(this);
  }

  /** 原版 E5.resize：只改尺寸，位置保持（媒体宽高比回写用）。 */
  resize(rect: { width: number; height: number }) {
    this.moveAndResize({ x: this.x, y: this.y, width: rect.width, height: rect.height });
  }

  /* ---------------------------------------------------------------- 事件 */

  onPointerdown(e: PointerEvent) {
    if (!e.isPrimary || e.button !== 0 || this.isEditing || e.pointerType !== 'mouse' || this.canvas.readonly) return;
    if (e.target instanceof Element && e.target.closest('button, input, .canvas-group-label[contenteditable="true"]')) return;
    this.canvas.handleSelectionDrag(e, this.nodeEl, this);
  }

  onClick(e: MouseEvent) {
    if (this.isEditing) return;
    const canvas = this.canvas;
    if (e.shiftKey) canvas.toggleSelect(this);
    else canvas.selectOnly(this);
  }

  onContextMenu(e: MouseEvent) {
    if (this.isEditing || e.defaultPrevented) return;
    const canvas = this.canvas;
    if (canvas.selection.has(this) && canvas.selection.size > 1) { canvas.onSelectionContextMenu(e); return; }
    canvas.selectOnly(this);
    const menu = new Menu(this.app);
    this.showMenu(menu);
    e.preventDefault();
    menu.showAtMouseEvent(e);
  }

  showMenu(menu: Menu) {
    const canvas = this.canvas;
    if (!canvas.readonly) {
      menu.addItem((item) => item.setSection('danger').setTitle(t('plugins.canvas.action-remove')).setIcon('lucide-trash-2').setWarning(true)
        .onClick(() => { canvas.removeNode(this); canvas.requestSave(); }));
    }
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-zoom-to-selection')).setIcon('zoom-to-selection')
      .onClick(() => canvas.zoomToSelection()));
    this.app.workspace.trigger('canvas:node-menu', menu, this);
  }

  /**
   * 8 向缩放（原版 E5.onResizePointerdown）：被拖动的边受 minContainerDimension 约束，
   * 吸附顺序与拖动一致（先物体后网格，参考线由 getSnapping 那条链路之外的 renderSnapPoints 画），
   * 有 aspectRatio（媒体卡片）时先按比例定尺寸再按方位回推另一条边。
   */
  onResizePointerdown(e: PointerEvent, side: string) {
    if (!e.isPrimary || e.button !== 0) return;
    if (e.pointerType !== 'mouse' && !this.canvas.selection.has(this)) return;
    e.preventDefault();
    const canvas = this.canvas;
    const orig = { x: this.x, y: this.y, width: this.width, height: this.height };
    const minDim = canvas.config.minContainerDimension;
    canvas.selectOnly(this);
    this.nodeEl.addClass('is-dragging');
    canvas.handleDragWithPan(e, {
      move: (ev: PointerEvent) => {
        const pos = canvas.posFromEvt(ev);
        canvas.clearSnapPoints();
        let dx = 0;
        let dy = 0;
        const { source, resizeX, resizeY } = resizeSourceFrom(side, pos, orig);
        let xMatch = null;
        let yMatch = null;
        if (canvas.canSnap(ev)) {
          if (canvas.options.snapToObjects) {
            const src = uniqueSnapPoints([bboxOf(source)]);
            const dest = uniqueSnapPoints(candidateBoxes(canvas, this));
            const dist = canvas.snapDistance;
            if (resizeX) { xMatch = findSnapMatches(src, dest, dist, 'x'); if (xMatch) dx = xMatch.delta; }
            if (resizeY) { yMatch = findSnapMatches(src, dest, dist, 'y'); if (yMatch) dy = yMatch.delta; }
          }
          if (canvas.options.snapToGrid) {
            const g = canvas.gridSpacing;
            if (resizeX && !xMatch) dx = Math.round(pos.x / g) * g - pos.x;
            if (resizeY && !yMatch) dy = Math.round(pos.y / g) * g - pos.y;
          }
        }
        const px = pos.x + dx;
        const py = pos.y + dy;
        const box = {
          minX: orig.x,
          minY: orig.y,
          maxX: orig.x + orig.width,
          maxY: orig.y + orig.height,
        };
        if (side.includes('top')) { box.minY = Math.min(box.maxY - minDim, py); if (box.minY !== py) { yMatch = null; dy = box.minY - pos.y; } }
        if (side.includes('left')) { box.minX = Math.min(box.maxX - minDim, px); if (box.minX !== px) { xMatch = null; dx = box.minX - pos.x; } }
        if (side.includes('bottom')) { box.maxY = Math.max(box.minY + minDim, py); if (box.maxY !== py) { yMatch = null; dy = box.maxY - pos.y; } }
        if (side.includes('right')) { box.maxX = Math.max(box.minX + minDim, px); if (box.maxX !== px) { xMatch = null; dx = box.maxX - pos.x; } }
        if (xMatch || yMatch) canvas.renderSnapPoints(xMatch, yMatch, dx, dy);
        const rect = { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
        const ratio = this.aspectRatio;
        if (ratio !== 0) {
          let width = rect.width;
          let height = rect.height;
          if (resizeX && resizeY) {
            const max = Math.max(width, height * ratio);
            height = Math.max(height, width / ratio);
            width = max;
            if (width !== rect.width) xMatch = null;
            else if (height !== rect.height) yMatch = null;
          } else if (resizeX) height = width / ratio;
          else if (resizeY) width = height * ratio;
          if (side.includes('left')) {
            const nextX = orig.x + orig.width - width;
            dx += nextX - rect.x;
            rect.x = nextX;
          }
          if (side.includes('top')) {
            const nextY = orig.y + orig.height - height;
            dy += nextY - rect.y;
            rect.y = nextY;
          }
          if (side.includes('right')) dx += width - rect.width;
          if (side.includes('bottom')) dy += height - rect.height;
          rect.width = width;
          rect.height = height;
        }
        this.moveAndResize(rect);
        canvas.markDirty(this);
      },
      end: () => canvas.requestSave(),
      cancel: () => { this.moveAndResize(orig); canvas.requestSave(); },
      cleanup: () => this.nodeEl.removeClass('is-dragging'),
    });
  }

  /**
   * 连接点拖出：新建一条边，松手时吸附到目标节点，否则弹出建卡菜单。
   * 原版 onConnectionPointerdown（app.js 3371857）把虚影与临时边都建在 oM 的工厂里：
   * 只有拖拽真正开始才建，纯点击不留 .is-dummy 蓝框，也不留悬空边。
   */
  onConnectionPointerdown(e: PointerEvent, side: string) {
    if (!e.isPrimary || e.button !== 0) return;
    const canvas = this.canvas;
    const opposite = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }[side] || 'top';
    e.preventDefault();
    let dummy: CanvasDummyNode | null = null;
    let edge: CanvasEdge | null = null;
    let from: CanvasEndpoint | null = null;
    let to: { side: string; node: CanvasNode; end: string; }|null = null;
    let snapped: { node: CanvasNode; side: string } | null = null;
    canvas.handleDragWithPan(e, {
      start: () => {
        // 原版：连线手柄拖动只建不挂载的几何占位，不能出现可见虚影。
        dummy = canvas.createDummyNode({ attach: false });
        from = { side, node: this, end: 'none' };
        to = { side: opposite, node: dummy, end: 'arrow' };
        edge = canvas.createEdge(from, to, false);
        canvas.canvasEl.addClass('is-connecting');
        canvas.deselectAll();
      },
      move: (ev: PointerEvent) => {
        if (!dummy || !edge || !from || !to) return;
        const pos = canvas.posFromEvt(ev);
        dummy.x = pos.x;
        dummy.y = pos.y;
        dummy.width = 0;
        dummy.height = 0;
        const candidates = canvas.getIntersectingNodes(expandBox(dummy.getBBox(), canvas.config.objectSnapDistance))
          .filter((n) => n !== this && !n.isGroup);
        snapped = canvas.findSnapTarget(pos, candidates, canvas.config.objectSnapDistance);
        if (snapped) edge.update(from, { side: snapped.side, node: snapped.node, end: 'arrow' });
        else edge.update(from, to);
      },
      end: () => {
        if (!edge || !from || !to) return;
        if (snapped) canvas.requestSave();
        else this.onConnectionDrop(e, edge, from, to);
      },
      cancel: () => { if (edge) canvas.removeEdge(edge); },
      cleanup: () => {
        canvas.canvasEl.removeClass('is-connecting');
        if (dummy) canvas.removeDummyNode(dummy);
      },
    });
  }

  /** 松手在空白处：菜单选「添加卡片」建文本节点并连上，否则删除这条临时边。 */
  onConnectionDrop(e: MouseEvent, edge: CanvasEdge, from: CanvasEndpoint, to: CanvasEndpoint) {
    const canvas = this.canvas;
    const menu = new Menu(this.app);
    let handled = false;
    const cleanup = () => { window.setTimeout(() => { if (!handled) canvas.removeEdge(edge); handled = false; }, 50); };
    const attach = (node: CanvasNode) => {
      handled = true;
      edge.update(from, { side: to.side, node, end: 'arrow' });
      canvas.requestSave();
    };
    menu.addItem((item) => item.setSection('action').setTitle(t('plugins.canvas.action-add-card')).setIcon('lucide-sticky-note')
      .onClick(() => {
        const pos = canvas.posFromEvt(e);
        const node = canvas.createTextNode({ pos, position: to.side, save: false, focus: false });
        attach(node);
      }));
    menu.addItem((item) => item.setSection('action').setTitle(t('plugins.canvas.action-add-note')).setIcon('lucide-file-text')
      .onClick(() => {
        handled = true;
        canvas.promptAddFileNode({ pos: canvas.posFromEvt(e), position: to.side, onChoose: attach, onCancel: () => canvas.removeEdge(edge) });
      }));
    this.app.workspace.trigger('canvas:node-connection-drop-menu', menu, this, edge);
    menu.showAtMouseEvent(e);
    // 本复刻的 Menu.showAtPosition 会先 close() 且不清 onHide，关闭回调须在显示之后再挂
    menu.onHide = cleanup;
  }

  /* ---------------------------------------------------------------- 数据 */

  getData(): CanvasNodeData {
    const data: CanvasNodeData = { ...this.unknownData, id: this.id, x: this.x, y: this.y, width: this.width, height: this.height };
    if (this.color) data.color = this.color;
    return data;
  }

  setData(data: CanvasNodeData) {
    const { x, y, width, height, color, id, ...rest } = data;
    let moved = false;
    let dirty = false;
    if (x !== undefined && x !== this.x) { this.x = x; moved = true; }
    if (y !== undefined && y !== this.y) { this.y = y; moved = true; }
    if (width !== undefined && width !== this.width) { this.width = width; moved = true; }
    if (height !== undefined && height !== this.height) { this.height = height; moved = true; }
    if (color !== undefined && (color || '') !== this.color) { this.color = color || ''; dirty = true; }
    this.unknownData = rest;
    if (moved) this.canvas.markMoved(this);
    if (dirty) this.canvas.markDirty(this);
  }
}

function expandBox(box: CanvasBBox, d: number) {
  return { minX: box.minX - d, minY: box.minY - d, maxX: box.maxX + d, maxY: box.maxY + d };
}

/** 缩放吸附候选：选中集合之外的全部节点（本复刻不做视口虚拟化，原版取视口内节点）。 */
function candidateBoxes(canvas: import('./canvas-view.js').CanvasView, self: CanvasNode) {
  const out = [];
  for (const node of canvas.nodes.values()) {
    if (node === self || canvas.selection.has(node)) continue;
    out.push(bboxOf(node));
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 内容节点基类：文本 / 文件 / 链接共用的 contentEl + placeholder 机制
 * ------------------------------------------------------------------------ */
export class CanvasContentNode extends CanvasNode {
  declare isContentMounted: boolean;
  declare placeholderText: string;
  declare labelEl: HTMLDivElement | null;
  declare contentEl: HTMLElement;
  declare contentBlockerEl: HTMLElement;
  declare placeholderEl: HTMLElement;

  constructor(canvas: import('./canvas-view.js').CanvasView, id: string|undefined) {
    super(canvas, id);
    this.isContentMounted = false;
    this.placeholderText = '';
    this.labelEl = null;
  }

  initialize() {
    super.initialize();
    this.contentEl = createDiv('canvas-node-content');
    this.contentBlockerEl = createDiv('canvas-node-content-blocker');
    this.placeholderEl = this.containerEl.createDiv('canvas-node-placeholder');
    this.renderPlaceholder();
  }

  /* ------------------------------------------------------------ 卡片标签 */

  /**
   * 卡片外上方的小标签（原版 D5/I5.updateNodeLabel）：受插件选项 cardLabelVisibility 控制，
   * always 常显、hover 由 .mod-hover-label 交给 CSS 悬停显隐、never 直接摘除。
   */
  updateNodeLabel(text: string) {
    const visibility = this.canvas.options.cardLabelVisibility || 'always';
    if (visibility === 'never') {
      if (this.labelEl) { this.labelEl.detach(); this.labelEl = null; }
      return;
    }
    let labelEl = this.labelEl;
    if (!labelEl) {
      labelEl = this.labelEl = this.nodeEl.createDiv('canvas-node-label');
      labelEl.addEventListener('click', (e) => this.onLabelClick(e));
      labelEl.addEventListener('dblclick', (e: MouseEvent) => this.onLabelDblClick(e));
      labelEl.addEventListener('pointerdown', (e: PointerEvent) => this.onPointerdown(e));
    }
    labelEl.toggleClass('mod-hover-label', visibility === 'hover');
    labelEl.setText(text);
  }

  /** 原版 Ng.isModEvent：中键或 Mod 单击开新标签，Mod+Alt 开分栏。 */
  static modLeafType(e: MouseEvent) {
    if (e.button === 1) return 'tab';
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (!mod) return false;
    if (!e.altKey) return 'tab';
    return e.shiftKey ? 'window' : 'split';
  }

  onLabelClick(e: MouseEvent) {
    const leafType = CanvasContentNode.modLeafType(e);
    if (!leafType) return;
    this.openFromLabel(leafType);
  }

  onLabelDblClick(event?: MouseEvent) { this.openFromLabel(false); }

  /** 子类覆写：标签单击（Mod）/ 双击时打开的落点。 */
  openFromLabel(leafType?: unknown) {}

  renderPlaceholder() {
    if (!this.placeholderEl) return;
    const text = this.placeholderText || '';
    this.placeholderEl.setText(text.length > 100 ? text.slice(0, 100) + '…' : text);
  }

  /** 原版 n(e)：落点在这些交互控件上时不进入编辑（按钮、输入框、折叠指示器、属性面板）。 */
  isInteractiveTarget(e: MouseEvent) {
    const target = e.target;
    if (!(target instanceof Element)) return false;
    return !!target.closest('button, input, .collapse-indicator, .interactive-child, .metadata-container');
  }

  /** 双击内容区进入编辑（文本节点重写为内嵌编辑器）。 */
  initializeEditing() {
    this.containerEl.addEventListener('dblclick', (e) => {
      if (e.defaultPrevented || this.isInteractiveTarget(e)) return;
      this.startEditing();
    });
    this.contentEl.addEventListener('dblclick', (e) => {
      if (e.defaultPrevented || this.isInteractiveTarget(e)) return;
      this.startEditing();
    });
  }
}

/* --------------------------------------------------------------------------
 * 拖拽用的临时节点（原版 S5 dummy node）
 * ------------------------------------------------------------------------ */
export class CanvasDummyNode extends CanvasNode {
  constructor(canvas: import('./canvas-view.js').CanvasView) {
    super(canvas);
    this.nodeEl.addClass('is-dummy');
  }
  attach() {
    this.canvas.canvasEl.appendChild(this.nodeEl);
    this.updateBreakpoint(false);
  }
}

export { RESIZE_SIDES, CONNECT_SIDES };
