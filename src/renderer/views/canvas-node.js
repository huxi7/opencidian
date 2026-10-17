/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 genId/bboxOf/nearestSide/applyCanvasColor；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；依赖 ../markdown/reading.js 的 renderMarkdown
 * [OUTPUT]: 导出 CanvasNode（基类）、CanvasTextNode、CanvasFileNode、CanvasLinkNode、CanvasGroupNode
 * [POS]: views/ 画布三件套的节点层。DOM 对齐原版：nodeEl(.canvas-node) > containerEl(.canvas-node-container) > contentEl(.canvas-node-content)
 *        + contentBlockerEl + placeholderEl；resizer（data-resize）与连接点（data-side）挂在 nodeEl 上（原版在 interaction layer，本复刻就近放置，靠 CSS 控制显隐）。
 *        可读缩放与编辑态挂载正文；输入逐次请求防抖保存。几何与事件写回由 canvas-view 统一调度。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas nodes — mirrors the original E5 / M5 / P5 / D5 / I5 / F5 classes. */
import { genId, bboxOf, applyCanvasColor } from './canvas-utils.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { Desktop } from '../core/ipc.js';
import { renderMarkdown } from '../markdown/reading.js';

const RESIZE_SIDES = ['top', 'right', 'bottom', 'left', 'topright', 'bottomright', 'bottomleft', 'topleft'];
const CONNECT_SIDES = ['top', 'right', 'bottom', 'left'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

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
    if (e.target instanceof Element && e.target.closest('button, input, .canvas-node-editor, .canvas-group-label[contenteditable="true"]')) return;
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

  /** 双击内容区进入编辑（文本节点重写）。 */
  initializeEditing() {
    const guard = (e) => {
      if (e.target instanceof Element && e.target.closest('button, input, .collapse-indicator, .interactive-child, .canvas-node-editor')) return true;
      return false;
    };
    this.containerEl.addEventListener('dblclick', (e) => {
      if (e.defaultPrevented || guard(e)) return;
      this.startEditing();
    });
    this.contentEl.addEventListener('dblclick', (e) => {
      if (e.defaultPrevented || guard(e)) return;
      this.startEditing();
    });
  }
}

/* --------------------------------------------------------------------------
 * 文本卡片 — 展示用 markdown 渲染，编辑用 textarea（替代原版内嵌 CM6）
 * ------------------------------------------------------------------------ */
export class CanvasTextNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.text = '';
    this._renderToken = 0;
    this._renderedText = null;
    this._renderedSource = null;
  }

  initialize() {
    super.initialize();
    this.contentEl.addClass('markdown-embed');
    this.embedContent = this.contentEl.createDiv('markdown-embed-content');
    this.previewEl = this.embedContent.createDiv('markdown-preview-view markdown-rendered');
    this.previewSizerEl = this.previewEl.createDiv('markdown-preview-sizer');
    this.initializeEditing();
  }

  isEditable() { return true; }

  setText(text) {
    if (this.text === text) return;
    this.text = text;
    this.placeholderText = text;
    this.renderPlaceholder();
    this.renderText();
    this.canvas.markDirty(this);
  }

  /** 异步渲染；按 文本+来源 缓存，避免拖动时逐帧重排 markdown。token 防止旧渲染覆盖新文本。 */
  renderText() {
    const sourcePath = this.canvas.view.file ? this.canvas.view.file.path : '';
    if (!this.isContentMounted || this.isEditing) return;
    if (this._renderedText === this.text && this._renderedSource === sourcePath) return;
    const token = ++this._renderToken;
    this._renderedText = this.text;
    this._renderedSource = sourcePath;
    renderMarkdown(this.app, this.text || '', this.previewSizerEl, sourcePath)
      .then(() => { if (token !== this._renderToken) return; })
      .catch((e) => { this._renderedText = null; console.error('canvas text render failed', e); });
  }

  mountContent() {
    super.mountContent();
    this.renderText();
  }

  startEditing() {
    const canvas = this.canvas;
    if (canvas.readonly || this.isEditing) return;
    canvas.selectOnly(this);
    if (canvas.zoom < canvas.zoomBreakpoint + 0.1) canvas.zoomToBbox(this.getBBox());
    this.setIsEditing(true);
    this.updateBreakpoint(true);
    this.placeholderEl.detach();
    this.previewEl.hide();
    const editor = this.editorEl = this.embedContent.createEl('textarea', {
      cls: 'canvas-node-editor',
      attr: { placeholder: t('plugins.canvas.prompt-add-text'), spellcheck: 'false' },
    });
    editor.value = this.text;
    editor.focus();
    editor.addEventListener('blur', () => this.stopEditing());
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.stopEditing(true); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.stopEditing(); }
    });
    editor.addEventListener('input', () => {
      this.text = editor.value;
      this.placeholderText = this.text;
      this.canvas.markDirty(this);
      this.canvas.requestSave();
    });
  }

  stopEditing(cancelled) {
    if (!this.isEditing) return;
    const editor = this.editorEl;
    this.setIsEditing(false);
    this.canvas.markMoved(this);
    if (editor) {
      if (!cancelled) this.text = editor.value;
      editor.detach();
      this.editorEl = null;
    }
    this.previewEl.show();
    this.placeholderText = this.text;
    this.renderPlaceholder();
    this.renderText();
    this.canvas.requestSave();
  }

  blur() {
    this.stopEditing();
    super.blur();
  }

  render() {
    super.render();
    if (!this.initialized) return;
    this.renderPlaceholder();
    this.renderText();
  }

  getData() { return { ...super.getData(), type: 'text', text: this.text }; }

  setData(data) {
    super.setData(data);
    if (data.text !== undefined) {
      this.text = data.text || '';
      this.placeholderText = this.text;
      this.renderPlaceholder();
      this.canvas.markDirty(this);
    }
  }
}

/* --------------------------------------------------------------------------
 * 文件卡片 — md 渲染预览，图片显示图片，其余显示占位
 * ------------------------------------------------------------------------ */
export class CanvasFileNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.filePath = '';
    this.subpath = '';
    this.file = null;
    this._renderToken = 0;
  }

  initialize() {
    super.initialize();
    this.initializeEditing();
  }

  setFilePath(filePath, subpath) {
    const nextSub = subpath || '';
    if (this.filePath === filePath && this.subpath === nextSub) return;
    this.filePath = filePath;
    this.subpath = nextSub;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    this.file = file && file.extension !== undefined ? file : null;
    this.placeholderText = this.file ? this.file.basename : filePath;
    this.renderPlaceholder();
    this.renderFile();
    this.canvas.markDirty(this);
  }

  setFile(file, subpath) {
    if (file) this.setFilePath(file.path, subpath);
  }

  renderFile() {
    const token = ++this._renderToken;
    if (!this.contentEl) return;
    this.contentEl.empty();
    this.contentEl.className = 'canvas-node-content';
    const file = this.file;
    if (!file) {
      this.renderFilePlaceholder('lucide-file-question', this.filePath || t('plugins.canvas.label-no-section-found'));
      return;
    }
    const ext = file.extension ? file.extension.toLowerCase() : '';
    if (ext === 'md' || ext === 'canvas') {
      this.contentEl.addClass('markdown-embed');
      this.embedContent = this.contentEl.createDiv('markdown-embed-content');
      this.previewEl = this.embedContent.createDiv('markdown-preview-view markdown-rendered');
      this.previewSizerEl = this.previewEl.createDiv('markdown-preview-sizer');
      this.app.vault.cachedRead(file)
        .then((text) => renderMarkdown(this.app, text, this.previewSizerEl, file.path))
        .then(() => { if (token !== this._renderToken) return; })
        .catch((e) => console.error('canvas file render failed', e));
      return;
    }
    if (IMAGE_EXTENSIONS.includes(ext)) {
      this.contentEl.addClass('media-embed');
      const img = this.contentEl.createEl('img');
      img.src = this.app.vault.getResourcePath(file);
      img.addEventListener('error', () => {
        if (token !== this._renderToken) return;
        this.contentEl.empty();
        this.contentEl.className = 'canvas-node-content';
        this.renderFilePlaceholder('lucide-image', file.basename);
      });
      return;
    }
    this.renderFilePlaceholder('lucide-file', file.basename);
  }

  renderFilePlaceholder(icon, text) {
    this.contentEl.addClass('canvas-file-placeholder');
    const iconEl = this.contentEl.createDiv('canvas-icon-placeholder');
    setIcon(iconEl, icon);
    this.contentEl.createDiv({ cls: 'canvas-file-name', text });
  }

  /** 双击打开文件（对齐原版：md 打开链接，图片/其他交给系统）。 */
  startEditing() { this.openFile(); }

  openFile() {
    if (!this.filePath) return;
    this.app.workspace.openLinkText(this.filePath + (this.subpath ? '#' + this.subpath : ''), '', false);
  }

  mountContent() {
    super.mountContent();
    if (!this.contentEl.childElementCount) this.renderFile();
  }

  render() {
    super.render();
    if (!this.initialized) return;
    if (!this.contentEl.childElementCount) this.renderFile();
  }

  getData() {
    return { ...super.getData(), type: 'file', file: this.file ? this.file.path : this.filePath, subpath: this.subpath || undefined };
  }

  setData(data) {
    super.setData(data);
    if (data.file) this.setFilePath(data.file, data.subpath || '');
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

export { RESIZE_SIDES, CONNECT_SIDES, IMAGE_EXTENSIONS };
