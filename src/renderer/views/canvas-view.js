/**
 * [INPUT]: 依赖 ./canvas-interactions.js 的 CanvasInteractions（类链基类）；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/notices.js 的 Notice；
 *          依赖 ./canvas-utils.js 的 genId、boxesIntersect、expandBBox、nearestSide、rectFromPos、distanceToBox、rectOf、MultiMap；
 *          依赖 ./canvas-node.js 的 CanvasNode/CanvasTextNode/CanvasLinkNode/CanvasGroupNode/CanvasDummyNode；依赖 ./canvas-file-node.js 的 CanvasFileNode；依赖 ./canvas-edge.js 的 CanvasEdge；
 *          依赖 ./canvas-menu.js 的 FileSuggestModal/LinkSuggestModal/JumpToGroupModal/showQuickSettingsMenu/installCanvasViewActions；
 *          依赖 ./canvas-export.js 的 renderCanvasImage/exportCanvasImage
 * [OUTPUT]: 导出 CanvasView 类（含 renderCanvasImage 渲染入口与 generateHDImage 导出入口）
 * [POS]: views/ 画布类链的末端：View → CanvasViewport（视口）→ CanvasInteractions（交互）→ CanvasView（装配与调度）。持有 .canvas-wrapper DOM、节点/边集合、选择集合、JSON Canvas 读写。
 *        ResizeObserver 在挂载后更新视口。节点与边几何分层；数据防抖 500ms 写回，关闭时 flush。
 *        vault modify 的外部修改重载磁盘内容并保留视口；自身写入用 _writing 标记排除，避免覆盖在途编辑。
 *        撤销/重做历史（上限 100）与写盘共用一个 requestSave；控件组含快速设置（对齐网格/对齐物体/只读）与撤销/重做。
 *        只读标记按原版 localDataManager 存 localStorage('canvas-<路径>')，重命名迁移、删除清理；切换只读时逐节点通知正文（onReadonlyChange）。
 *        导出图片的绘制在 canvas-export.js；本类只提供 renderCanvasImage（可测试）与 generateHDImage（命令/面板菜单入口）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas view — DOM assembly + scheduling on top of the viewport and interaction layers. */
import { CanvasInteractions } from './canvas-interactions.js';
import { CanvasHistory } from './canvas-history.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Notice } from '../core/notices.js';
import { debounce } from '../core/events.js';
import { Menu } from '../core/menu.js';
import {
  genId, boxesIntersect, containsBox, expandBBox, nearestSide, rectFromPos, distanceToBox, rectOf, MultiMap,
} from './canvas-utils.js';
import {
  CanvasNode, CanvasTextNode, CanvasLinkNode, CanvasGroupNode, CanvasDummyNode,
} from './canvas-node.js';
import { CanvasFileNode } from './canvas-file-node.js';
import { loadCanvasLocalData, saveCanvasLocalData, migrateCanvasLocalData, dropCanvasLocalData } from './canvas-local-data.js';
import { CanvasEdge } from './canvas-edge.js';
import { FileSuggestModal, LinkSuggestModal, JumpToGroupModal, showQuickSettingsMenu, installCanvasViewActions } from './canvas-menu.js';
import { renderCanvasImage, exportCanvasImage } from './canvas-export.js';

const SAVE_DELAY = 500;

export class CanvasView extends CanvasInteractions {
  constructor(leaf) {
    super(leaf);
    this.icon = 'lucide-layout-dashboard';
    this.navigation = true;
    this.view = this; // 原版节点/边通过 canvas.view 拿文件上下文
    this.file = null;
    this.readonly = false;
    this.data = {};
    this.config = {
      zoomMultiplier: 0.5,
      objectSnapDistance: 15,
      minContainerDimension: 50,
      defaultTextNodeDimensions: { width: 250, height: 60 },
      defaultFileNodeDimensions: { width: 400, height: 400 },
    };
    this.options = { snapToGrid: true, snapToObjects: true };
    this.nodes = new Map();
    this.edges = new Map();
    this.edgeFrom = new MultiMap();
    this.edgeTo = new MultiMap();
    this.selection = new Set();
    this.zIndexCounter = 1;
    this.x = 0; this.y = 0; this.zoom = 0; this.scale = 1;
    this.tx = 0; this.ty = 0; this.tZoom = 0;
    this.zoomCenter = null;
    this.canvasRect = { left: 0, top: 0, width: 0, height: 0, cx: 0, cy: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.moved = new Set();
    this.dirty = new Set();
    this.frame = 0;
    this.frameStart = 0;
    this.viewportChanged = false;
    this.wasAnimating = false;
    this.finishViewportAnimation = false;
    this.zoomToFitQueued = false;
    this.isDragging = false;
    this.isHoldingSpace = false;
    this.pauseAnimation = 0;
    this._saveTimer = null;
    this._savedText = null;
    this._writing = false;
    this._modifyRef = null;
    this.history = new CanvasHistory(100);
    this.requestPushHistory = debounce((data) => this.pushHistory(data), 250, true);
    this.undoBtnEl = null;
    this.redoBtnEl = null;
    this.onGlobalKeydown = (e) => this._globalKeydown(e);
    this.onGlobalKeyup = (e) => this._globalKeyup(e);
  }

  /* ------------------------------------------------------------ 视图身份 */

  getViewType() { return 'canvas'; }
  getIcon() { return this.icon; }
  getDisplayText() { return this.file ? this.file.basename : (t('plugins.canvas.name') || 'Canvas'); }

  getState() {
    return {
      file: this.file ? this.file.path : undefined,
      viewState: { x: this.x, y: this.y, zoom: this.zoom },
    };
  }

  async setState(state) {
    state = state || {};
    if (state.file && (!this.file || this.file.path !== state.file)) {
      await this.loadFile(state.file);
    }
    if (state.viewState) {
      const vs = state.viewState;
      this.setViewport(vs.x || 0, vs.y || 0, vs.zoom || 0);
    }
  }

  getEphemeralState() { return {}; }
  setEphemeralState(state) {
    if (state && state.focus && this.wrapperEl) this.wrapperEl.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ 生命周期 */

  async onOpen() {
    this.buildDom();
    this._resizeObserver = new ResizeObserver(() => this.onResize());
    this._resizeObserver.observe(this.wrapperEl);
    this.options = { snapToGrid: true, snapToObjects: true, ...this.loadOptions() };
    window.addEventListener('keydown', this.onGlobalKeydown);
    window.addEventListener('keyup', this.onGlobalKeyup);
    // 原版文本文件视图基类行为：外部修改（同步、文件恢复）重载磁盘内容
    this._modifyRef = this.app.vault.on('modify', (file) => this.onExternalModify(file));
    // 只读标记随重命名/删除迁移（原版 localDataManager.handleRename/handleDelete）
    this._renameRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file && file.extension === 'canvas') migrateCanvasLocalData(oldPath, file.path);
    });
    this._deleteRef = this.app.vault.on('delete', (file) => {
      if (file && file.extension === 'canvas') dropCanvasLocalData(file.path);
    });
  }

  async onClose() {
    window.removeEventListener('keydown', this.onGlobalKeydown);
    window.removeEventListener('keyup', this.onGlobalKeyup);
    if (this._modifyRef) { this._modifyRef.unregister(); this._modifyRef = null; }
    if (this._renameRef) { this._renameRef.unregister(); this._renameRef = null; }
    if (this._deleteRef) { this._deleteRef.unregister(); this._deleteRef = null; }
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.data = this.getData();
    await this.save();
    this._resizeObserver?.disconnect();
    this.clear();
    this.cancelFrame();
  }

  clear() {
    for (const node of Array.from(this.nodes.values())) this.removeNode(node);
    for (const edge of Array.from(this.edges.values())) this.removeEdge(edge);
    this.nodes.clear();
    this.edges.clear();
    this.selection.clear();
    this.data = {};
    this.history.clear();
    this.requestPushHistory.cancel();
    this.setReadonly(false);
    this.setViewport(0, 0, 0);
  }

  /* ----------------------------------------------------------------- DOM */

  buildDom() {
    const contentEl = this.contentEl;
    const wrapperEl = this.wrapperEl = contentEl.createDiv({
      cls: 'canvas-wrapper',
      attr: { tabindex: '-1', 'data-ignore-swipe': 'true' },
    });
    this.canvasRect = rectOf(wrapperEl);

    // 点阵背景：pattern + rect，逐字对齐原版
    const backgroundEl = wrapperEl.createSvg('svg', { cls: 'canvas-background' });
    const patternId = genId();
    this.backgroundPatternEl = backgroundEl.createSvg('pattern', { attr: { id: patternId, patternUnits: 'userSpaceOnUse' } }, (pattern) => {
      pattern.createSvg('circle', { attr: { cx: '0.7', cy: '0.7', r: '0.7' } });
    });
    backgroundEl.createSvg('rect', { attr: { x: '0', y: '0', width: '100%', height: '100%', fill: `url(#${patternId})` } });

    // 空格平移层：只有按住空格时才挂进 wrapper（对齐原版）
    this.moverEl = createDiv('canvas-mover');
    this.moverEl.addEventListener('pointerdown', (e) => this.handleMoverPointerdown(e));

    this.buildCardMenu();
    this.buildControls();

    const canvasEl = this.canvasEl = wrapperEl.createDiv('canvas');
    this.edgeContainerEl = canvasEl.createSvg('svg', { cls: 'canvas-edges' });
    this.edgeEndContainerEl = canvasEl.createSvg('svg', { cls: 'canvas-edges' });
    this.selectionEl = canvasEl.createDiv('canvas-selection');
    this.selectionEl.hide();

    wrapperEl.addEventListener('keydown', (e) => this.onKeydown(e));
    wrapperEl.addEventListener('pointerdown', (e) => this.onPointerdown(e));
    wrapperEl.addEventListener('pointerdown', (e) => this.onPriorityPointerdown(e), { capture: true });
    wrapperEl.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    wrapperEl.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    wrapperEl.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  buildCardMenu() {
    const menu = this.cardMenuEl = this.wrapperEl.createDiv('canvas-card-menu');
    const addButton = (icon, title, onClick, onDragStart) => {
      const el = menu.createDiv({ cls: 'canvas-card-menu-button mod-draggable', attr: { 'aria-label': title } });
      setIcon(el, icon);
      el.addEventListener('click', onClick);
      if (onDragStart) el.addEventListener('pointerdown', onDragStart);
    };
    addButton('lucide-sticky-note', t('plugins.canvas.action-drag-to-add-card'),
      () => this.createTextNode({ pos: this.posCenter(), position: 'center' }),
      (e) => this.dragTempNode(e, this.config.defaultTextNodeDimensions, (pos, size) => { this.deselectAll(); this.createTextNode({ pos, size }); }));
    addButton('lucide-file-text', t('plugins.canvas.action-drag-to-add-note'),
      () => this.promptAddFileNode({ pos: this.posCenter(), position: 'center' }),
      (e) => this.dragTempNode(e, this.config.defaultFileNodeDimensions, (pos, size) => this.promptAddFileNode({ pos, size })));
    addButton('lucide-file-image', t('plugins.canvas.action-drag-to-add-media'),
      () => this.promptAddFileNode({ pos: this.posCenter(), position: 'center', media: true }),
      (e) => this.dragTempNode(e, this.config.defaultFileNodeDimensions, (pos, size) => this.promptAddFileNode({ pos, size, media: true })));
  }

  buildControls() {
    const controls = this.canvasControlsEl = this.wrapperEl.createDiv('canvas-controls');
    // 快速设置组（原版第一组）：只读状态下直接点击退出只读，否则弹菜单
    const settingsGroup = controls.createDiv('canvas-control-group mod-raised');
    this.quickSettingsButton = settingsGroup.createDiv({ cls: 'canvas-control-item' });
    setIcon(this.quickSettingsButton, this.readonly ? 'lucide-lock' : 'lucide-settings');
    this.quickSettingsButton.setAttr('aria-label', t('plugins.canvas.label-canvas-settings'));
    this.quickSettingsButton.addEventListener('click', (ev) => {
      if (this.readonly) {
        this.setReadonly(false);
        this.saveLocalData();
        return;
      }
      if (this.quickSettingsButton.hasClass('has-active-menu')) return;
      const menu = new Menu(this.app);
      showQuickSettingsMenu(this, menu);
      menu.setParentElement(this.quickSettingsButton).showAtMouseEvent(ev);
    });
    const group = controls.createDiv('canvas-control-group mod-raised');
    const addButton = (icon, title, onClick) => {
      const el = group.createDiv({ cls: 'canvas-control-item', attr: { 'aria-label': title } });
      setIcon(el, icon);
      el.addEventListener('click', onClick);
    };
    addButton('lucide-plus', t('commands.zoom-in'), () => this.zoomBy(this.config.zoomMultiplier));
    addButton('lucide-rotate-cw', t('commands.reset-zoom'), () => this.zoomBy(-this.zoom));
    addButton('lucide-maximize', t('plugins.canvas.action-zoom-to-fit'), () => this.zoomToFit());
    addButton('lucide-minus', t('commands.zoom-out'), () => this.zoomBy(-this.config.zoomMultiplier));
    // 撤销/重做组（原版第三组控件）
    const historyGroup = controls.createDiv('canvas-control-group mod-raised');
    const addHistoryButton = (icon, title, onClick) => {
      const el = historyGroup.createDiv({ cls: 'canvas-control-item', attr: { 'aria-label': title } });
      setIcon(el, icon);
      el.addEventListener('click', onClick);
      return el;
    };
    this.undoBtnEl = addHistoryButton('lucide-undo-2', t('setting.mobile-toolbar.option-undo'), () => this.undo());
    this.redoBtnEl = addHistoryButton('lucide-redo-2', t('setting.mobile-toolbar.option-redo'), () => this.redo());
    this.updateHistoryUI();
    // 让 controls 与 card menu 一样浮在节点之上
    this.canvasControlsEl.style.zIndex = String(this.getZIndex() + 1);
  }

  /* ---------------------------------------------------------------- 数据 */

  getData() {
    const nodes = [];
    const edges = [];
    for (const node of this.nodes.values()) nodes.push(node.getData());
    for (const edge of this.edges.values()) edges.push(edge.getData());
    return { ...this.data, nodes, edges };
  }

  getSelectionData() {
    const nodes = [];
    const edges = [];
    const selectedEdges = new Set();
    for (const el of this.selection) {
      if (!(el instanceof CanvasNode)) continue;
      nodes.push(el.getData());
      for (const edge of this.getEdgesForNode(el)) selectedEdges.add(edge);
    }
    for (const edge of selectedEdges) {
      if (this.selection.has(edge.from.node) && this.selection.has(edge.to.node)) edges.push(edge.getData());
    }
    return { nodes, edges };
  }

  getViewData() { return JSON.stringify(this.getData(), null, '\t'); }

  setData(data) {
    if (!data || Object.keys(data).length === 0) { this.createPlaceholder(); return; }
    this.importData(data, true);
    this.data = data;
    this.pushHistory(data);
  }

  /** 原版 importData：按 id 复用节点与边；prune=true 时移除数据中已不存在的项（不清历史/视口）。 */
  importData(data, prune) {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const keptNodes = new Set();
    for (const nodeData of nodes) {
      if (!nodeData || !nodeData.id) continue;
      let node = this.nodes.get(nodeData.id);
      if (!node) {
        const type = nodeData.type;
        if (type === 'file') node = new CanvasFileNode(this, nodeData.id);
        else if (type === 'link') node = new CanvasLinkNode(this, nodeData.id);
        else if (type === 'group') node = new CanvasGroupNode(this, nodeData.id);
        else if (type === 'text') node = new CanvasTextNode(this, nodeData.id);
        else continue;
        this.addNode(node, false);
      }
      node.setData(nodeData);
      node.attach();
      node.render();
      keptNodes.add(node);
    }
    if (prune) {
      for (const node of Array.from(this.nodes.values())) {
        if (!keptNodes.has(node)) this.removeNode(node);
      }
    }
    const keptEdges = new Set();
    for (const edgeData of edges) {
      if (!edgeData || !edgeData.id || !edgeData.fromNode || !edgeData.toNode) continue;
      const from = this.nodes.get(edgeData.fromNode);
      const to = this.nodes.get(edgeData.toNode);
      if (!from || !to) {
        const stale = this.edges.get(edgeData.id);
        if (stale) this.removeEdge(stale);
        continue;
      }
      let edge = this.edges.get(edgeData.id);
      if (!edge) {
        edge = new CanvasEdge(this, edgeData.id, {
          side: edgeData.fromSide || nearestSide(from.getBBox(), to.getBBox()),
          node: from,
          end: edgeData.fromEnd || 'none',
        }, {
          side: edgeData.toSide || nearestSide(to.getBBox(), from.getBBox()),
          node: to,
          end: edgeData.toEnd || 'arrow',
        });
        this.addEdge(edge, false);
      }
      edge.setData(edgeData);
      edge.attach();
      edge.render();
      keptEdges.add(edge);
    }
    if (prune) {
      for (const edge of Array.from(this.edges.values())) {
        if (!keptEdges.has(edge)) this.removeEdge(edge);
      }
    }
    if (!this.nodes.size) this.createPlaceholder();
  }

  createPlaceholder() {
    if (this.canvasPlaceholderEl) return;
    const lines = [
      t('plugins.canvas.label-drag-from-below'),
      t('plugins.canvas.label-space-drag-pan'),
      `Mod + ${t('plugins.canvas.label-scroll-to-zoom')}`,
    ];
    this.canvasPlaceholderEl = this.canvasEl.createDiv('canvas-placeholder-message');
    lines.forEach((line, i) => {
      if (i > 0) this.canvasPlaceholderEl.createEl('br');
      this.canvasPlaceholderEl.appendText(line);
    });
  }

  /* ---------------------------------------------------------- 节点与边 */

  getZIndex() {
    const z = this.zIndexCounter += 1;
    const cssZ = String(z + 1);
    if (this.cardMenuEl) this.cardMenuEl.style.zIndex = cssZ;
    if (this.canvasControlsEl) this.canvasControlsEl.style.zIndex = cssZ;
    return z;
  }

  addNode(node, attach = true) {
    this.nodes.set(node.id, node);
    if (this.canvasPlaceholderEl) { this.canvasPlaceholderEl.detach(); this.canvasPlaceholderEl = null; }
    if (attach) { node.attach(); node.render(); }
    this.markMoved(node);
  }

  removeNode(node) {
    for (const edge of this.getEdgesForNode(node)) this.removeEdge(edge);
    this.deselect(node);
    this.nodes.delete(node.id);
    this.moved.delete(node);
    this.dirty.delete(node);
    node.destroy();
    this.requestFrame();
  }

  addEdge(edge, attach = true) {
    this.edges.set(edge.id, edge);
    this.edgeFrom.add(edge.from.node, edge);
    this.edgeTo.add(edge.to.node, edge);
    if (attach) { edge.attach(); edge.render(); }
    this.markMoved(edge);
  }

  removeEdge(edge) {
    if (!this.edges.has(edge.id)) return;
    this.deselect(edge);
    this.edges.delete(edge.id);
    this.edgeFrom.delete(edge.from.node, edge);
    this.edgeTo.delete(edge.to.node, edge);
    this.moved.delete(edge);
    this.dirty.delete(edge);
    edge.destroy();
    this.requestFrame();
  }

  getEdgesForNode(node) {
    return this.edgeFrom.getArray(node).concat(this.edgeTo.getArray(node));
  }

  getIntersectingNodes(box) {
    const out = [];
    for (const node of this.nodes.values()) {
      if (boxesIntersect(node.getBBox(), box)) out.push(node);
    }
    return out;
  }

  getContainingNodes(box) {
    return this.getIntersectingNodes(box).filter((node) => containsBox(box, node.getBBox()));
  }

  /** 连线吸附：找指针附近最近的节点，返回它朝向指针的那一侧。 */
  findSnapTarget(pos, nodes, dist) {
    const point = { x: pos.x, y: pos.y };
    const probe = { minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y };
    let best = null;
    for (const node of nodes) {
      const box = node.getBBox();
      if (!boxesIntersect(expandBBox(box, dist), probe)) continue;
      const d = distanceToBox(point, box);
      if (!best || d < best.dist) best = { node, dist: d, side: nearestSide(box, probe) };
    }
    return best ? { node: best.node, side: best.side } : null;
  }

  createDummyNode() {
    const dummy = new CanvasDummyNode(this);
    dummy.attach();
    dummy.render();
    return dummy;
  }

  removeDummyNode(dummy) {
    dummy.destroy();
    this.moved.delete(dummy);
    this.dirty.delete(dummy);
  }

  /* ------------------------------------------------------------ 创建节点 */

  createTextNode(opts = {}) {
    const size = opts.size || this.config.defaultTextNodeDimensions;
    const node = new CanvasTextNode(this);
    node.moveAndResize(rectFromPos(opts.pos || this.posCenter(), size, opts.position));
    if (opts.text) node.setText(opts.text);
    this.addNode(node);
    if (opts.save !== false) this.requestSave();
    if (opts.focus !== false) { this.selectOnly(node); node.startEditing(); }
    return node;
  }

  createFileNode(opts = {}) {
    const size = opts.size || this.config.defaultFileNodeDimensions;
    const node = new CanvasFileNode(this);
    node.moveAndResize(rectFromPos(opts.pos || this.posCenter(), size, opts.position));
    if (opts.file) node.setFile(opts.file, opts.subpath);
    this.addNode(node);
    if (opts.save !== false) this.requestSave();
    if (opts.focus !== false) this.selectOnly(node);
    return node;
  }

  createLinkNode(opts = {}) {
    const size = opts.size || this.config.defaultFileNodeDimensions;
    const node = new CanvasLinkNode(this);
    node.moveAndResize(rectFromPos(opts.pos || this.posCenter(), size, opts.position));
    if (opts.url) node.setUrl(opts.url);
    this.addNode(node);
    if (opts.save !== false) this.requestSave();
    if (opts.focus !== false) this.selectOnly(node);
    return node;
  }

  createGroupNode(opts = {}) {
    const size = opts.size || this.config.defaultFileNodeDimensions;
    const node = new CanvasGroupNode(this);
    node.moveAndResize(rectFromPos(opts.pos || this.posCenter(), size, opts.position));
    node.setLabel(opts.label || t('plugins.canvas.label-untitled-group'));
    this.addNode(node);
    if (opts.save !== false) this.requestSave();
    if (opts.focus !== false) { this.selectOnly(node); node.focusLabel(); }
    return node;
  }

  createEdge(from, to, save = true) {
    const edge = new CanvasEdge(this, genId(), from, to);
    this.addEdge(edge);
    if (save) this.requestSave();
    return edge;
  }

  /** 「添加笔记 / 添加媒体」：文件选择弹窗。 */
  promptAddFileNode(opts = {}) {
    let chosen = false;
    const modal = new FileSuggestModal(this.app, (file) => {
      chosen = true;
      const node = this.createFileNode({ pos: opts.pos, size: opts.size, position: opts.position, file });
      if (opts.onChoose) opts.onChoose(node);
    }, { media: opts.media });
    modal.onClose = () => {
      Promise.resolve().then(() => { if (!chosen && opts.onCancel) opts.onCancel(); });
    };
    modal.open();
  }

  /** 「添加网页」：网址输入弹窗。 */
  promptAddLinkNode(opts = {}) {
    let chosen = false;
    const modal = new LinkSuggestModal(this.app, (url) => {
      chosen = true;
      const node = this.createLinkNode({ pos: opts.pos, size: opts.size, position: opts.position, url });
      if (opts.onChoose) opts.onChoose(node);
    });
    modal.onClose = () => {
      Promise.resolve().then(() => { if (!chosen && opts.onCancel) opts.onCancel(); });
    };
    modal.open();
  }

  /* -------------------------------------------------------------- 选择 */

  select(el) {
    if (this.selection.has(el)) return;
    const wasSingle = this.selection.size === 1;
    this.selection.add(el);
    if (wasSingle) el.focus(); else el.select();
    this.requestFrame();
  }

  deselect(el) {
    if (!this.selection.has(el)) return;
    const wasSingle = this.selection.size === 1;
    this.selection.delete(el);
    if (wasSingle) el.blur(); else el.deselect();
    this.requestFrame();
  }

  toggleSelect(el) {
    if (this.selection.has(el)) this.deselect(el);
    else this.select(el);
  }

  selectOnly(el) {
    if (this.selection.size === 1 && this.selection.has(el)) return;
    const old = Array.from(this.selection);
    this.selection.clear();
    this.selection.add(el);
    for (const other of old) {
      if (other === el) continue;
      if (old.length === 1) other.blur();
      else other.deselect();
    }
    el.focus();
    this.requestFrame();
  }

  selectAll(elements) {
    const next = elements ? new Set(elements) : new Set(this.nodes.values());
    for (const el of Array.from(this.selection)) if (!next.has(el)) this.deselect(el);
    for (const el of next) this.select(el);
    this.requestFrame();
  }

  deselectAll() {
    if (!this.selection.size) return;
    for (const el of Array.from(this.selection)) this.deselect(el);
    this.requestFrame();
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

  /** 只读模式（原版 setReadonly）：更新快速设置按钮的图标与提示，供快速设置菜单切换。 */
  setReadonly(readonly) {
    this.readonly = readonly;
    const btn = this.quickSettingsButton;
    if (btn) {
      setIcon(btn, readonly ? 'lucide-lock' : 'lucide-settings');
      btn.setAttr('aria-label', readonly
        ? t('plugins.canvas.label-disable-readonly')
        : t('plugins.canvas.label-canvas-settings'));
    }
    this.wrapperEl.toggleClass('mod-readonly', readonly);
    for (const node of this.nodes.values()) node.onReadonlyChange?.(readonly);
  }

  /* ------------------------------------------------------------ 本地数据 */

  /** 原版 localDataManager：按 'canvas-<路径>' 存 localStorage（实现见 canvas-local-data.js）。 */
  loadLocalData() { return loadCanvasLocalData(this.file ? this.file.path : ''); }

  saveLocalData() { saveCanvasLocalData(this.file ? this.file.path : '', this.readonly); }

  /* ---------------------------------------------------------------- 存取 */

  requestSave(saveHistory = true) {
    this.data = this.getData();
    if (saveHistory) this.requestPushHistory(this.data);
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => { this._saveTimer = null; this.save(); }, SAVE_DELAY);
  }

  /* ------------------------------------------------------------ 撤销/重做 */

  undo() {
    if (this.history.canUndo()) this.applyHistory(this.history.undo());
  }

  redo() {
    if (this.history.canRedo()) this.applyHistory(this.history.redo());
  }

  /** 应用历史快照：重建节点后写盘，不推进历史（原版 applyHistory）。 */
  applyHistory(entry) {
    this.importData(entry, true);
    this.data = entry;
    this.requestSave(false);
    this.updateHistoryUI();
  }

  pushHistory(entry) {
    this.history.push(entry);
    this.updateHistoryUI();
  }

  /** 替换当前历史条目为最新数据（原版 overrideHistory，供加载期几何修正使用）。 */
  overrideHistory() {
    this.requestPushHistory.run();
    this.data = this.getData();
    this.history.replace(this.data);
    this.updateHistoryUI();
    this.requestSave(false);
  }

  updateHistoryUI() {
    if (this.undoBtnEl) this.undoBtnEl.toggleClass('is-disabled', !this.history.canUndo());
    if (this.redoBtnEl) this.redoBtnEl.toggleClass('is-disabled', !this.history.canRedo());
  }

  async save() {
    if (!this.file) return;
    const text = JSON.stringify(this.data && this.data.nodes ? this.data : this.getData(), null, '\t');
    if (text === this._savedText) return;
    try {
      this._writing = true;
      await this.app.vault.modify(this.file, text);
      this._savedText = text;
    } catch (e) {
      console.error('canvas save failed', e);
      new Notice(t('plugins.canvas.name') || 'Canvas');
    } finally {
      this._writing = false;
    }
  }

  loadOptions() {
    try {
      return this.app.settings.loadPluginData('canvas.json', {}) || {};
    } catch (e) {
      return {};
    }
  }

  saveOptions() {
    try {
      this.app.settings.savePluginData('canvas.json', { snapToGrid: this.options.snapToGrid, snapToObjects: this.options.snapToObjects });
    } catch (e) { /* 选项写盘失败不影响使用 */ }
  }

  async loadFile(path) {
    if (this.file) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this.data = this.getData();
      await this.save();
    }
    await this._applyFileFromDisk(path);
  }

  /** 外部修改：磁盘内容与已保存内容一致时视为自身写入的 watcher 回声，跳过重载。 */
  onExternalModify(file) {
    if (!file || !this.file || this._writing || file.path !== this.file.path || file.extension !== 'canvas') return;
    const path = this.file.path;
    const fileRef = this.file;
    this.app.vault.cachedRead(fileRef).then((text) => {
      if (!this.file || this.file.path !== path) return;
      if (text === this._savedText) return;
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
      return this._applyFileFromDisk(path, { keepViewport: true });
    }).catch((e) => console.error('canvas external reload failed', e));
  }

  /** 读取磁盘内容并重建节点/边；keepViewport 为真表示外部重载：保留视口与撤销历史。 */
  async _applyFileFromDisk(path, opts) {
    const keepViewport = !!(opts && opts.keepViewport);
    const file = this.app.vault.getFileByPath(path) || this.app.vault.getAbstractFileByPath(path);
    if (!file || file.extension !== 'canvas') {
      this.file = null;
      this.renderMissingFile(path);
      return;
    }
    this.file = file;
    let text = '';
    try { text = await this.app.vault.cachedRead(file); } catch (e) { console.error(e); }
    let data = null;
    if (text && text.trim()) {
      try { data = JSON.parse(text); } catch (e) { new Notice(t('plugins.canvas.msg-export-failed-empty-canvas') || 'Invalid canvas file'); }
    }
    // 初次装载/切换文件：清空内容与历史（原版 setViewData 初次装载走 view.clear）；
    // 外部重载：按 id 差量更新，保留视口与撤销历史（原版 setData → importData(prune)）。
    if (!keepViewport) {
      this.clear();
      // 原版 setViewData 初次装载读取本地数据（只读标记）
      const local = this.loadLocalData();
      this.setReadonly(!!(local && local.readonly));
    }
    if (data) this.setData(data);
    else { this.createPlaceholder(); this.requestFrame(); }
    this._savedText = JSON.stringify(this.getData(), null, '\t');
    if (!keepViewport) this.zoomToFitQueued = true;
    this.onResize();
    if (this.wrapperEl) this.wrapperEl.focus({ preventScroll: true });
    this.app.workspace.trigger('canvas:file-loaded', this.file, this);
  }

  renderMissingFile(path) {
    this.contentEl.empty();
    const state = this.contentEl.createDiv('empty-state');
    state.createDiv('empty-state-title', (el) => el.setText(t('plugins.canvas.name') || 'Canvas'));
    if (path) state.createDiv('empty-state-description', (el) => el.setText(path));
  }

  /* ------------------------------------------------------------ 分组跳转 */

  getGroupNodes() {
    return Array.from(this.nodes.values()).filter((node) => node.isGroup);
  }

  /** 命令 canvas:jump-to-group 用。 */
  openJumpToGroup() {
    const groups = this.getGroupNodes();
    if (!groups.length) {
      new Notice(t('plugins.canvas.msg-no-groups-found'));
      return;
    }
    const modal = new JumpToGroupModal(this.app, groups, (group) => {
      this.selectOnly(group);
      this.zoomToBbox(expandBBox(group.getBBox(), 20));
    });
    modal.open();
  }

  /* ------------------------------------------------------------ 导出图片 */

  /** 视图头部「更多选项」按钮（原版 pane menu：导出图片）。 */
  _fillViewActions(actions) { installCanvasViewActions(this, actions); }

  /** 可测试的渲染入口：返回 { dataURL, width, height, scale }，空画布返回 null。 */
  renderCanvasImage(opts) { return renderCanvasImage(this, opts); }

  /** 命令 canvas:export-as-image 与面板菜单入口：渲染 → 保存对话框 → 写 PNG（原版 generateHDImage）。 */
  generateHDImage(opts) { return exportCanvasImage(this, opts); }
}
