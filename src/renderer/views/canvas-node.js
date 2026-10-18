/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 genId/bboxOf/nearestSide/applyCanvasColor；依赖 ../core/i18n.js 的 t；依赖 ../core/menu.js 的 Menu；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 FileNameModal；依赖 ../editor/editor.js 的 Editor；依赖 @codemirror/view 的 placeholder
 * [OUTPUT]: 导出 CanvasNode（基类）、CanvasContentNode、CanvasTextNode、CanvasLinkNode、CanvasGroupNode、CanvasDummyNode；CanvasFileNode 见 canvas-file-node.js
 * [POS]: views/ 画布三件套的节点层。DOM 对齐原版：nodeEl(.canvas-node) > containerEl(.canvas-node-container) > contentEl(.canvas-node-content)
 *        + contentBlockerEl + placeholderEl；resizer（data-resize）与连接点（data-side）挂在 nodeEl 上（原版在 interaction layer，本复刻就近放置，靠 CSS 控制显隐）。
 *        可读缩放与编辑态挂载正文；输入逐次请求防抖保存。几何与事件写回由 canvas-view 统一调度。
 *        文本卡片正文是内嵌的 CM6 实时预览编辑器（原版 P5 + L5），DOM 为 contentEl.markdown-embed > .markdown-embed-content > .markdown-source-view；
 *        编辑器只活在挂载期间，卸载即 destroy；仅编辑态可写，未编辑时被 blocker 挡住指针（卡片照常拖拽/选中）。
 *        文本卡片菜单含编辑与转换为文件（FileNameModal → fileManager.createNewMarkdownFile → 文件节点继承几何）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas nodes — mirrors the original E5 / M5 / P5 / L5 / D5 / I5 / F5 classes. */
import { placeholder as cmPlaceholder } from '@codemirror/view';
import { genId, bboxOf, applyCanvasColor } from './canvas-utils.js';
import { t } from '../core/i18n.js';
import { Menu } from '../core/menu.js';
import { Desktop } from '../core/ipc.js';
import { Notice } from '../core/notices.js';
import { FileNameModal } from '../core/modals.js';
import { Editor } from '../editor/editor.js';

const RESIZE_SIDES = ['top', 'right', 'bottom', 'left', 'topright', 'bottomright', 'bottomleft', 'topleft'];
const CONNECT_SIDES = ['top', 'right', 'bottom', 'left'];

export class CanvasNode {
  constructor(canvas, id) {
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
    nodeEl.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    const containerEl = this.containerEl = nodeEl.createDiv('canvas-node-container');
    containerEl.addEventListener('pointerdown', (e) => this.onPointerdown(e));

    // 8 个缩放手柄（原版 4 边 + 4 角）
    for (const side of RESIZE_SIDES) {
      const el = nodeEl.createDiv({ cls: 'canvas-node-resizer', attr: { 'data-resize': side } });
      el.addEventListener('pointerdown', (e) => {
        if (e.target === el && e.pointerType === 'mouse') this.onResizePointerdown(e, side);
      });
    }
    // 4 个连接点
    for (const side of CONNECT_SIDES) {
      const el = nodeEl.createDiv({ cls: 'canvas-node-connection-point', attr: { 'data-side': side } });
      el.addEventListener('pointerdown', (e) => this.onConnectionPointerdown(e, side));
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

  updateBreakpoint(showContent) {
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

  get isFocused() { return this.nodeEl.hasClass('is-focused'); }
  focus() { this.nodeEl.addClass('is-focused'); this.renderZIndex(); }
  blur() { this.nodeEl.removeClass('is-focused'); this.setIsEditing(false); this.renderZIndex(); }
  select() { this.nodeEl.addClass('is-selected'); this.renderZIndex(); }
  deselect() { this.nodeEl.removeClass('is-selected'); this.renderZIndex(); }

  setIsEditing(isEditing) {
    if (this.isEditing === isEditing) return;
    this.isEditing = isEditing;
    this.nodeEl.toggleClass('is-editing', isEditing);
  }

  isEditable() { return false; }
  startEditing() {}

  /* ---------------------------------------------------------------- 几何 */

  getBBox() { return bboxOf(this); }

  moveTo(pos) {
    this.x = Math.round(pos.x);
    this.y = Math.round(pos.y);
    this.canvas.markMoved(this);
  }

  moveAndResize(rect) {
    this.x = Math.round(rect.x);
    this.y = Math.round(rect.y);
    this.width = Math.round(rect.width);
    this.height = Math.round(rect.height);
    this.canvas.markMoved(this);
  }

  /* ---------------------------------------------------------------- 事件 */

  onPointerdown(e) {
    if (!e.isPrimary || e.button !== 0 || this.isEditing || e.pointerType !== 'mouse' || this.canvas.readonly) return;
    if (e.target instanceof Element && e.target.closest('button, input, .canvas-group-label[contenteditable="true"]')) return;
    this.canvas.handleSelectionDrag(e, this.nodeEl, this);
  }

  onClick(e) {
    if (this.isEditing) return;
    const canvas = this.canvas;
    if (e.shiftKey) canvas.toggleSelect(this);
    else canvas.selectOnly(this);
  }

  onContextMenu(e) {
    if (this.isEditing || e.defaultPrevented) return;
    const canvas = this.canvas;
    if (canvas.selection.has(this) && canvas.selection.size > 1) { canvas.onSelectionContextMenu(e); return; }
    canvas.selectOnly(this);
    const menu = new Menu(this.app);
    this.showMenu(menu);
    e.preventDefault();
    menu.showAtMouseEvent(e);
  }

  showMenu(menu) {
    const canvas = this.canvas;
    if (!canvas.readonly) {
      menu.addItem((item) => item.setSection('danger').setTitle(t('plugins.canvas.action-remove')).setIcon('lucide-trash-2').setWarning(true)
        .onClick(() => { canvas.removeNode(this); canvas.requestSave(); }));
    }
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-zoom-to-selection')).setIcon('zoom-to-selection')
      .onClick(() => canvas.zoomToSelection()));
    this.app.workspace.trigger('canvas:node-menu', menu, this);
  }

  /** 8 向缩放：最小 50px，snapToGrid 打开时吸附网格。 */
  onResizePointerdown(e, side) {
    if (!e.isPrimary || e.button !== 0) return;
    const canvas = this.canvas;
    const start = canvas.posFromEvt(e);
    const orig = { x: this.x, y: this.y, width: this.width, height: this.height };
    const minDim = canvas.config.minContainerDimension;
    this.select();
    this.nodeEl.addClass('is-dragging');
    canvas.handleDragWithPan(e, {
      move: (ev) => {
        const pos = canvas.posFromEvt(ev);
        let dx = pos.x - start.x;
        let dy = pos.y - start.y;
        if (canvas.options.snapToGrid) {
          const g = canvas.gridSpacing;
          if (side.includes('left') || side.includes('right')) dx = Math.round(dx / g) * g;
          if (side.includes('top') || side.includes('bottom')) dy = Math.round(dy / g) * g;
        }
        const rect = {
          x: orig.x,
          y: orig.y,
          width: orig.width,
          height: orig.height,
        };
        if (side.includes('left')) {
          const newX = Math.min(orig.x + orig.width - minDim, orig.x + dx);
          rect.width = orig.x + orig.width - newX;
          rect.x = newX;
        }
        if (side.includes('right')) rect.width = Math.max(minDim, orig.width + dx);
        if (side.includes('top')) {
          const newY = Math.min(orig.y + orig.height - minDim, orig.y + dy);
          rect.height = orig.y + orig.height - newY;
          rect.y = newY;
        }
        if (side.includes('bottom')) rect.height = Math.max(minDim, orig.height + dy);
        if (this.aspectRatio) rect.height = rect.width / this.aspectRatio;
        this.moveAndResize(rect);
        this.canvas.markDirty(this);
      },
      end: () => canvas.requestSave(),
      cancel: () => { this.moveAndResize(orig); canvas.requestSave(); },
      cleanup: () => this.nodeEl.removeClass('is-dragging'),
    });
  }

  /** 连接点拖出：新建一条边，松手时吸附到目标节点，否则弹出建卡菜单。 */
  onConnectionPointerdown(e, side) {
    if (!e.isPrimary || e.button !== 0) return;
    const canvas = this.canvas;
    const opposite = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }[side] || 'top';
    e.preventDefault();
    const dummy = canvas.createDummyNode();
    const from = { side, node: this, end: 'none' };
    const to = { side: opposite, node: dummy, end: 'arrow' };
    const edge = canvas.createEdge(from, to, false);
    let snapped = null;
    canvas.canvasEl.addClass('is-connecting');
    canvas.deselectAll();
    canvas.handleDragWithPan(e, {
      move: (ev) => {
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
        if (snapped) canvas.requestSave();
        else this.onConnectionDrop(e, edge, from, to);
      },
      cancel: () => canvas.removeEdge(edge),
      cleanup: () => {
        canvas.canvasEl.removeClass('is-connecting');
        canvas.removeDummyNode(dummy);
      },
    });
  }

  /** 松手在空白处：菜单选「添加卡片」建文本节点并连上，否则删除这条临时边。 */
  onConnectionDrop(e, edge, from, to) {
    const canvas = this.canvas;
    const menu = new Menu(this.app);
    let handled = false;
    const cleanup = () => { window.setTimeout(() => { if (!handled) canvas.removeEdge(edge); handled = false; }, 50); };
    menu.onHide(cleanup);
    const attach = (node) => {
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
  }

  /* ---------------------------------------------------------------- 数据 */

  getData() {
    const data = { ...this.unknownData, id: this.id, x: this.x, y: this.y, width: this.width, height: this.height };
    if (this.color) data.color = this.color;
    return data;
  }

  setData(data) {
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

function expandBox(box, d) {
  return { minX: box.minX - d, minY: box.minY - d, maxX: box.maxX + d, maxY: box.maxY + d };
}

/* --------------------------------------------------------------------------
 * 内容节点基类：文本 / 文件 / 链接共用的 contentEl + placeholder 机制
 * ------------------------------------------------------------------------ */
export class CanvasContentNode extends CanvasNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.isContentMounted = false;
    this.placeholderText = '';
  }

  initialize() {
    super.initialize();
    this.contentEl = createDiv('canvas-node-content');
    this.contentBlockerEl = createDiv('canvas-node-content-blocker');
    this.placeholderEl = this.containerEl.createDiv('canvas-node-placeholder');
    this.renderPlaceholder();
  }

  renderPlaceholder() {
    if (!this.placeholderEl) return;
    const text = this.placeholderText || '';
    this.placeholderEl.setText(text.length > 100 ? text.slice(0, 100) + '…' : text);
  }

  /** 原版 n(e)：落点在这些交互控件上时不进入编辑（按钮、输入框、折叠指示器、属性面板）。 */
  isInteractiveTarget(e) {
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
 * 文本卡片 — 正文是内嵌的 CM6 实时预览编辑器（原版 P5 + L5：卡片正文就是一个 markdown 视图）
 * ------------------------------------------------------------------------ */
export class CanvasTextNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.text = '';
    this.editor = null;      // Editor：只活在挂载期间，卸载/销毁即释放
    this.editorEl = null;    // 原版 wZ.editorEl：.markdown-embed-content，编辑器宿主
    this.sourceEl = null;    // .markdown-source-view.cm-s-obsidian.mod-cm6，实时预览装饰的锚点
  }

  initialize() {
    super.initialize();
    this.contentEl.addClass('markdown-embed');
    this.initializeEditing();
  }

  isEditable() { return true; }

  /* -------------------------------------------------------------- 正文数据 */

  setText(text) {
    text = typeof text === 'string' ? text : '';
    if (this.text === text) return;
    this.text = text;
    this.placeholderText = text;
    this.renderPlaceholder();
    this.setEditorValue(text);
    this.canvas.markDirty(this);
  }

  getData() { return { ...super.getData(), type: 'text', text: this.text }; }

  setData(data) {
    super.setData(data);
    if (typeof data.text === 'string') {
      this.setText(data.text);
      this.canvas.markDirty(this);
    }
  }

  /** 编辑器正文变化：写入 this.text，落盘与撤销条目沿用画布的防抖链路。 */
  onEditorChange() {
    if (!this.editor) return;
    const text = this.editor.getValue();
    if (this.text === text) return;
    this.text = text;
    this.placeholderText = text;
    this.renderPlaceholder();
    this.canvas.markDirty(this);
    this.canvas.requestSave();
  }

  /** 程序化写正文（导入/撤销重做/外部重载）：this.text 已先行更新，编辑器回写不会重复入栈。 */
  setEditorValue(text) {
    if (!this.editor || this.editor.getValue() === text) return;
    this.editor.setValue(text);
  }

  /* -------------------------------------------------------- 编辑器生命周期 */

  mountContent() {
    super.mountContent();
    if (this.isContentMounted) this.mountEditor();
  }

  unmountContent() {
    super.unmountContent();
    this.unmountEditor();
  }

  destroy() {
    this.unmountEditor();
    super.destroy();
  }

  mountEditor() {
    if (this.editor) return;
    const editorEl = this.editorEl = this.contentEl.createDiv('markdown-embed-content');
    const sourceEl = this.sourceEl = editorEl.createDiv('markdown-source-view cm-s-obsidian mod-cm6');
    const hostEl = sourceEl.createDiv('cm-editor-host');
    // 未进入编辑态前不可写：原版未编辑的卡片是阅读视图，不接受输入
    const editor = this.editor = new Editor(hostEl, this.app, { doc: this.text, readOnly: true });
    editor.sourcePath = this.canvas.file ? this.canvas.file.path : '';
    editor.cm.dom.setAttr('data-editor-mode', 'source');
    editor.onChange(() => this.onEditorChange());
    editor.addExtensions(cmPlaceholder(t('plugins.canvas.prompt-add-text')));
    editorEl.addEventListener('keydown', (e) => this.onEditorKeydown(e), true);
    const live = this.app.settings.appSettings.livePreview !== false;
    sourceEl.toggleClass('is-live-preview', live);
    sourceEl.toggleClass('is-source-mode', !live);
    editor.setLivePreview(live);
    this.installEditorHandle(editorEl);
  }

  unmountEditor() {
    const editor = this.editor;
    if (!editor) return;
    this.editor = null;
    const editorEl = this.editorEl;
    this.editorEl = null;
    this.sourceEl = null;
    editor.destroy();
    if (editorEl) editorEl.detach();
  }

  /** 兼容旧编辑面板句柄：历史上 editorEl 是 textarea（.value 即正文），现有画布自动化仍按该约定读写正文。 */
  installEditorHandle(editorEl) {
    Object.defineProperty(editorEl, 'value', {
      configurable: true,
      get: () => (this.editor ? this.editor.getValue() : this.text),
      set: (v) => {
        if (this.editor) this.editor.setValue(typeof v === 'string' ? v : String(v == null ? '' : v));
        else this.setText(v);
      },
    });
  }

  /* ---------------------------------------------------------------- 编辑态 */

  /** 原版 T5：双击进编辑，单击已聚焦的卡片同样进编辑（原版 hg）。 */
  initializeEditing() {
    super.initializeEditing();
    this.contentEl.addEventListener('click', (e) => this.onContentClick(e));
  }

  onContentClick(e) {
    if (e.defaultPrevented || e.detail > 1 || e.shiftKey) return;
    if (this.isEditing || this.canvas.readonly || this.isInteractiveTarget(e)) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('button, input')) return;
    // 原版 hg：正文里已有文字选区时不进编辑（用户在选择文本）
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && this.contentEl.contains(selection.anchorNode)) return;
    const pos = { x: e.clientX, y: e.clientY };
    window.setTimeout(() => {
      if (this.destroyed || this.isEditing) return;
      this.startEditing(pos);
    }, 10);
  }

  startEditing(pos) {
    const canvas = this.canvas;
    if (canvas.readonly || this.isEditing) return;
    canvas.selectOnly(this);
    if (canvas.zoom < canvas.zoomBreakpoint + 0.1) canvas.zoomToBbox(this.getBBox());
    this.setIsEditing(true);
    this.updateBreakpoint(true);
    const editor = this.editor;
    if (!editor) return;      // 画布尚未测量尺寸时正文挂不上，编辑态照常保留
    editor.setReadOnly(false);
    editor.focus();
    if (pos) this.placeCursor(editor, pos);
  }

  /** 原版 showEditor(pos)：把光标落到点击位置。 */
  placeCursor(editor, pos) {
    window.setTimeout(() => {
      if (this.editor !== editor || !this.isEditing || this.destroyed) return;
      let offset = null;
      try { offset = editor.cm.posAtCoords({ x: pos.x, y: pos.y }); } catch (e) { offset = null; }
      if (offset == null) return;
      editor.setSelection(editor.offsetToPos(offset));
    }, 0);
  }

  /** 原版 T5.blur：回到未编辑态（阅读态）。事件本身由画布的指针/键盘逻辑触发。 */
  stopEditing() {
    if (!this.isEditing) return;
    this.setIsEditing(false);
    this.canvas.markMoved(this);
    if (this.editor) {
      this.editor.setReadOnly(true);
      this.editor.blur();
    }
    this.placeholderText = this.text;
    this.renderPlaceholder();
    this.canvas.requestSave();
  }

  /** 画布切到只读：正在编辑的卡片立即退回阅读态（无编辑器挂载时无需处理）。 */
  onReadonlyChange(readonly) {
    if (readonly && this.isEditing) this.stopEditing();
  }

  /** 编辑器内的退出键。Escape 不阻止冒泡也不阻止默认：画布收到后取消选中，blocker 随之恢复显示。 */
  onEditorKeydown(e) {
    if (e.isComposing) return;
    if (e.key === 'Escape') { this.stopEditing(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.stopEditing(); }
  }

  blur() {
    this.stopEditing();
    super.blur();
  }

  /** 文本卡片菜单追加编辑与转换为文件（原版 P5.showMenu）。 */
  showMenu(menu) {
    super.showMenu(menu);
    const canvas = this.canvas;
    if (canvas.readonly) return;
    menu.addItem((item) => item.setSection('canvas').setTitle(t('interface.menu.edit')).setIcon('lucide-edit')
      .onClick(() => this.startEditing()));
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-convert-to-file')).setIcon('lucide-file-input')
      .onClick(() => this.convertToFile()));
  }

  /** 转换为文件：命名弹窗 → 建 md（正文为卡片文本）→ 文件节点继承几何 → 关联边改指新节点 → 移除文本节点。 */
  convertToFile() {
    const canvas = this.canvas;
    const sourcePath = canvas.file ? canvas.file.path : '';
    const text = this.text;
    const modal = new FileNameModal(canvas.app, 'Untitled', async (name) => {
      const parent = canvas.app.fileManager.getNewFileParent(sourcePath, name);
      let file;
      try {
        file = await canvas.app.fileManager.createNewMarkdownFile(parent, name, text);
      } catch (e) {
        new Notice(String(e && e.message ? e.message : e));
        return;
      }
      const node = canvas.createFileNode({ pos: this, size: this, file, save: false, focus: false });
      for (const edge of canvas.getEdgesForNode(this)) {
        if (edge.from.node === this) edge.update({ ...edge.from, node }, edge.to);
        if (edge.to.node === this) edge.update(edge.from, { ...edge.to, node });
      }
      canvas.removeNode(this);
      canvas.selectOnly(node);
      canvas.requestSave();
    });
    modal.open();
  }
}

/* --------------------------------------------------------------------------
 * 链接卡片 — 显示 URL，点击交给系统浏览器
 * ------------------------------------------------------------------------ */
export class CanvasLinkNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.url = '';
  }

  initialize() {
    super.initialize();
    this.contentEl.addClass('canvas-link-content');
    if (this.url) this.contentEl.setText(this.url);
    this.contentEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.url) Desktop.openExternal(this.url);
    });
    this.initializeEditing();
  }

  setUrl(url) {
    if (this.url === url) return;
    this.url = url;
    this.placeholderText = url;
    // setData 早于 initialize（importData 顺序：setData → attach → render），contentEl 可能尚未创建
    if (this.contentEl) this.contentEl.setText(url);
    this.renderPlaceholder();
    this.canvas.markDirty(this);
  }

  startEditing() { if (this.url) Desktop.openExternal(this.url); }

  getData() { return { ...super.getData(), type: 'link', url: this.url }; }

  setData(data) {
    super.setData(data);
    if (data.url) this.setUrl(data.url);
  }
}

/* --------------------------------------------------------------------------
 * 分组 — 圆角矩形 + 顶部 label（contenteditable），永远铺在底层
 * ------------------------------------------------------------------------ */
export class CanvasGroupNode extends CanvasNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.isGroup = true;
    this.label = '';
    this.nodeEl.addClass('canvas-node-group');
  }

  initialize() {
    super.initialize();
    this.contentEl = this.containerEl.createDiv('canvas-node-content');
    const labelEl = this.labelEl = this.nodeEl.createDiv('canvas-group-label');
    labelEl.spellcheck = false;
    labelEl.addEventListener('pointerdown', (e) => this.onPointerdown(e));
    labelEl.addEventListener('dblclick', () => this.focusLabel());
    labelEl.addEventListener('keypress', (e) => {
      if (!e.isComposing && e.key === 'Enter') { e.preventDefault(); this.blurLabel(); }
    });
    labelEl.addEventListener('blur', () => this.blurLabel());
    this.isContentMounted = true;
  }

  setLabel(label) {
    if (this.label === label) return;
    this.label = label;
    this.canvas.markDirty(this);
  }

  focusLabel() {
    const labelEl = this.labelEl;
    if (!labelEl || this.canvas.readonly) return;
    labelEl.show();
    labelEl.setAttr('contenteditable', 'true');
    labelEl.focus();
  }

  blurLabel() {
    const labelEl = this.labelEl;
    if (!labelEl) return;
    labelEl.setAttr('contenteditable', 'false');
    labelEl.blur();
    const text = labelEl.getText();
    if (this.label !== text) {
      this.setLabel(text);
      this.canvas.requestSave();
    } else {
      labelEl.toggle(!!text);
      labelEl.setText(text);
    }
  }

  blur() {
    super.blur();
    this.blurLabel();
  }

  render() {
    super.render();
    if (!this.initialized) return;
    const labelEl = this.labelEl;
    if (document.activeElement !== labelEl) {
      labelEl.toggle(!!this.label);
      labelEl.setText(this.label);
    }
    // 主题色明暗：从 CSS 变量读回 rgb 值，浅色文字配深底
    let light = false;
    let dark = false;
    if (this.color) {
      const raw = getComputedStyle(this.nodeEl).getPropertyValue('--canvas-color').trim();
      const m = raw.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
      if (m) {
        const l = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
        if (l > 0.7) dark = true;
        else if (l < 0.4) light = true;
      }
    }
    labelEl.toggleClass('mod-foreground-light', light);
    labelEl.toggleClass('mod-foreground-dark', dark);
  }

  getData() {
    const data = { ...super.getData(), type: 'group' };
    if (this.label) data.label = this.label;
    return data;
  }

  setData(data) {
    super.setData(data);
    if (data.label && typeof data.label === 'string') this.setLabel(data.label);
  }
}

/* --------------------------------------------------------------------------
 * 拖拽用的临时节点（原版 S5 dummy node）
 * ------------------------------------------------------------------------ */
export class CanvasDummyNode extends CanvasNode {
  constructor(canvas) {
    super(canvas);
    this.nodeEl.addClass('is-dummy');
  }
  attach() {
    this.canvas.canvasEl.appendChild(this.nodeEl);
    this.updateBreakpoint(false);
  }
}

export { RESIZE_SIDES, CONNECT_SIDES };
