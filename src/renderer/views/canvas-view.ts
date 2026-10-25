/**
 * [INPUT]: 依赖 ./canvas-interactions.js 的 CanvasInteractions（类链基类）；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/keymap.js 的 IS_MAC；
 *          依赖 ./canvas-utils.js 的 genId、boxesIntersect、expandBBox、nearestSide、distanceToBox、rectOf、MultiMap；
 *          依赖 ./canvas-node.js 的 CanvasNode/CanvasDummyNode；依赖 ./canvas-text-node.js 的 CanvasTextNode；依赖 ./canvas-link-node.js 的 CanvasLinkNode；依赖 ./canvas-group-node.js 的 CanvasGroupNode；依赖 ./canvas-file-node.js 的 CanvasFileNode；依赖 ./canvas-edge.js 的 CanvasEdge；
 *          依赖 ./canvas-menu.js 的 FileSuggestModal/LinkSuggestModal/JumpToGroupModal/installCanvasViewActions/showCanvasPaneMenu；
 *          依赖 ./canvas-controls.js 的 buildCardMenu/buildControls（建卡菜单与控件组的 DOM 构建）；依赖 ./canvas-arrange.js 的 buildCanvasMenu（选择浮动工具条与多选包围盒）；依赖 ./canvas-export.js 的 renderCanvasImage/exportCanvasImage；
 *          依赖 ./canvas-clipboard.js 的 handleCanvasCopy/handleCanvasCut/handleCanvasPaste；依赖 ./canvas-drop.js 的 installCanvasDrop；
 *          依赖 ./canvas-options.js 的 loadCanvasOptions/saveCanvasOptions（.obsidian/canvas.json，与白板设定页共用同一份选项）
 *          节点创建委托 canvas-node-factory.js；保存委托 core/window-save.js。
 * [OUTPUT]: 导出 CanvasView 类（含 renderCanvasImage 渲染入口、generateHDImage 导出入口与 promptImageSavePath 保存对话框入口）
 * [POS]: views/ 画布类链的末端：View → CanvasViewport（视口）→ CanvasInteractions（交互）→ CanvasView（装配与调度）。持有 .canvas-wrapper DOM、节点/边集合、选择集合、JSON Canvas 读写。
 *        ResizeObserver 在挂载后更新视口。节点与边几何分层；数据防抖 500ms 写回，关闭时 flush。
 *        读取或JSON解析失败保留卡片与保存基线；冷开失败路径独立序列化，不授予保存权限。外部重载保留视口，CAS冲突拒绝覆盖。
 *        撤销/重做历史（上限 100）与写盘共用一个 requestSave；控件组含快速设置（对齐网格/对齐物体/只读）、缩放、撤销/重做与帮助弹窗。
 *        指针移动/离开经 onPointermove/onPointerleave 交给交互层命中测试（决定哪张卡片显手柄）；空画布占位第三行的修饰键按平台显示（macOS 为 ⌘）。
 *        promptLinkUrl 是链接卡片「更换网址」入口：复用 LinkSuggestModal 并预填当前 URL。
 *        选择：selection 的改动统一走 updateSelection（先拍旧集合、置 selectionChanged），帧尾 applySelectionDiff 处理焦点/高亮进出，
 *        1↔多选切换不会留下「既聚焦又选中」的中间态；浮动工具条 this.menu 由帧尾按变化重绘，拖动期间隐藏。
 *        getData 按 z 升序写出节点（原版 g5），importData 读到较低 z 时重新置顶，两者共同决定文件顺序即堆叠顺序；cloneData 为克隆拖动换新 id。
 *        只读标记按原版 localDataManager 存 localStorage('canvas-<路径>')，重命名迁移、删除清理；切换只读时逐节点通知正文（onReadonlyChange）。
 *        分组背景跟随 vault rename/delete：vault 的 renameTree 只对根目录/文件发一次事件，故按路径前缀处理整棵移动；
 *        重命名后写回新路径并立刻重绘，删除后清空 background/backgroundStyle 并请求写盘，磁盘 JSON 不留死路径。
 *        剪贴板与拖入：copy/cut/paste 监听挂在 wrapper（canvas-clipboard.js），文件树/系统文件/URL/文本 drop 由 canvas-drop.js 处理。
 *        导出图片：绘制在 canvas-export.js，选项弹窗在 canvas-export-dialog.js；本类只提供 renderCanvasImage（可测试）、generateHDImage（命令/面板菜单入口）
 *        与 promptImageSavePath（保存对话框，验收场景替换它即可跳过原生对话框）。
 *        选项（吸附/滚轮/卡片标签/缩放阈值/新白板位置）统一走 canvas-options.js：视图读同一份 .obsidian/canvas.json，
 *        白板设定页改动后由 applyCanvasOptions 灌回打开的视图，故改完立即生效。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas view — DOM assembly + scheduling on top of the viewport and interaction layers. */
import { CanvasInteractions } from './canvas-interactions.js';
import { CanvasHistory } from './canvas-history.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { IS_MAC } from '../core/keymap.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { saveWindowView, hasUnsavedWindowView, reportWindowSaveError } from '../core/window-save.js';
import { debounce } from '../core/events.js';
import {
  genId, boxesIntersect, containsBox, expandBBox, nearestSide, distanceToBox, rectOf, MultiMap,
} from './canvas-utils.js';
import {
  CanvasNode, CanvasDummyNode,
} from './canvas-node.js';
import { CanvasTextNode } from './canvas-text-node.js';
import { CanvasLinkNode } from './canvas-link-node.js';
import { handleCanvasCopy, handleCanvasCut, handleCanvasPaste } from './canvas-clipboard.js';
import { installCanvasDrop } from './canvas-drop.js';
import { CanvasGroupNode } from './canvas-group-node.js';
import { CanvasFileNode } from './canvas-file-node.js';
import { loadCanvasOptions, saveCanvasOptions } from './canvas-options.js';
import { loadCanvasLocalData, saveCanvasLocalData, migrateCanvasLocalData, dropCanvasLocalData } from './canvas-local-data.js';
import { CanvasEdge } from './canvas-edge.js';
import { FileSuggestModal, LinkSuggestModal, JumpToGroupModal, installCanvasViewActions, showCanvasPaneMenu } from './canvas-menu.js';
import { buildCardMenu, buildControls } from './canvas-controls.js';
import { buildCanvasMenu } from './canvas-arrange.js';
import { renderCanvasImage, exportCanvasImage } from './canvas-export.js';

import { createTextNode, createFileNode, createLinkNode, createGroupNode } from './canvas-node-factory.js';

const SAVE_DELAY = 500;

import type { CanvasSharedState } from './canvas-types.js';
export interface CanvasView extends CanvasSharedState {}
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
    this.staleSelection = null;
    this.selectionChanged = false;
    this.menu = null;
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
    this.pointerFrame = 0;
    this.interactionTarget = null;
    this._saveTimer = null;
    this._savedText = null; this._closed = false;
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
  getDisplayText() { return this.file ? this.file.basename : (this._failedFilePath || t('plugins.canvas.name') || 'Canvas'); }

  getState() {
    return {
      file: this.file ? this.file.path : this._failedFilePath,
      viewState: { x: this.x, y: this.y, zoom: this.zoom },
    };
  }

  async setState(state) {
    state = state || {};
    if (state.file && (!this.file || this.file.path !== state.file)) {
      if (await this.loadFile(state.file) === false) return false;
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
    this.options = { ...this.loadOptions() };
    window.addEventListener('keydown', this.onGlobalKeydown);
    window.addEventListener('keyup', this.onGlobalKeyup);
    // 原版文本文件视图基类行为：外部修改（同步、文件恢复）重载磁盘内容
    this._modifyRef = this.app.vault.on('modify', (file) => this.onExternalModify(file));
    // 只读标记随重命名/删除迁移（原版 localDataManager.handleRename/handleDelete）
    this._renameRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file && file.extension === 'canvas') migrateCanvasLocalData(oldPath, file.path);
      this.updateGroupBackgrounds(file, oldPath, false);
    });
    this._deleteRef = this.app.vault.on('delete', (file) => {
      if (file && file.extension === 'canvas') dropCanvasLocalData(file.path);
      this.updateGroupBackgrounds(file, file ? file.path : '', true);
    });
  }

  async onClose() {
    if (this._closed) return true;
    if (await this.save() === false) return false;
    if (this._closed) return true; this._closed = true;
    window.removeEventListener('keydown', this.onGlobalKeydown);
    window.removeEventListener('keyup', this.onGlobalKeyup);
    if (this._modifyRef) { this._modifyRef.unregister(); this._modifyRef = null; }
    if (this._renameRef) { this._renameRef.unregister(); this._renameRef = null; }
    if (this._deleteRef) { this._deleteRef.unregister(); this._deleteRef = null; }
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.data = this.getData();
    this._resizeObserver?.disconnect();
    this.setInteractionTarget(null);
    this.clear();
    this.cancelFrame();
  }

  clear() {
    for (const node of Array.from(this.nodes.values())) this.removeNode(node);
    for (const edge of Array.from(this.edges.values())) this.removeEdge(edge);
    this.nodes.clear();
    this.edges.clear();
    this.selection.clear();
    this.staleSelection = null;
    this.selectionChanged = false;
    if (this.menu) this.menu.detach();
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

    buildCardMenu(this);
    buildControls(this);
    this.menu = buildCanvasMenu(this);

    const canvasEl = this.canvasEl = wrapperEl.createDiv('canvas');
    this.edgeContainerEl = canvasEl.createSvg('svg', { cls: 'canvas-edges' });
    this.edgeEndContainerEl = canvasEl.createSvg('svg', { cls: 'canvas-edges' });

    wrapperEl.addEventListener('keydown', (e) => this.onKeydown(e));
    wrapperEl.addEventListener('pointerdown', (e) => this.onPointerdown(e));
    wrapperEl.addEventListener('pointerdown', (e) => this.onPriorityPointerdown(e), { capture: true });
    wrapperEl.addEventListener('pointermove', (e) => this.onPointermove(e));
    wrapperEl.addEventListener('pointerleave', () => this.onPointerleave());
    wrapperEl.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    wrapperEl.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    wrapperEl.addEventListener('copy', (e) => handleCanvasCopy(this, e));
    wrapperEl.addEventListener('cut', (e) => handleCanvasCut(this, e));
    wrapperEl.addEventListener('paste', (e) => handleCanvasPaste(this, e));
    wrapperEl.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    installCanvasDrop(this);
  }

  /* ---------------------------------------------------------------- 数据 */

  getData() {
    const nodes = [];
    const edges = [];
    // 原版 g5：节点按 z 升序写出，文件里的顺序即堆叠顺序
    for (const node of Array.from(this.nodes.values()).sort((a, b) => a.zIndex - b.zIndex)) nodes.push(node.getData());
    for (const edge of this.edges.values()) edges.push(edge.getData());
    return { ...this.data, nodes, edges };
  }

  getSelectionData(elements) {
    const selected = new Set<CanvasNode | CanvasEdge>(elements || this.selection);
    const nodes = [];
    const edges = [];
    const selectedEdges = new Set<CanvasEdge>();
    for (const el of Array.from(selected).filter((node): node is CanvasNode => node instanceof CanvasNode).sort((a, b) => a.zIndex - b.zIndex)) {
      if (!(el instanceof CanvasNode)) continue;
      nodes.push(el.getData());
      for (const edge of this.getEdgesForNode(el)) selectedEdges.add(edge);
    }
    for (const edge of selectedEdges) {
      if (selected.has(edge.from.node) && selected.has(edge.to.node)) edges.push(edge.getData());
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

  /**
   * 原版 importData：按 id 复用节点与边；prune=true 时移除数据中已不存在的项（不清历史/视口）。
   * 返回本次数据覆盖的节点集合（原版返回该集合，供粘贴/克隆后就地选中）。
   */
  importData(data, prune) {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const keptNodes = new Set();
    let maxZ = 0;
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
      // 原版：z 低于前一个的节点重新置顶，保证文件顺序与堆叠顺序一致
      if (node.zIndex < maxZ) node.updateZIndex();
      maxZ = node.zIndex;
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
    return keptNodes;
  }

  createPlaceholder() {
    if (this.canvasPlaceholderEl) return;
    // 原版桌面端占位三行；第三行的修饰键取平台显示名（macOS 为 ⌘，原文 Lg.Mod）
    const lines = [
      t('plugins.canvas.label-drag-from-below'),
      t('plugins.canvas.label-space-drag-pan'),
      `${IS_MAC ? '⌘' : 'Ctrl'} + ${t('plugins.canvas.label-scroll-to-zoom')}`,
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
    if (this.menu) this.menu.updateZIndex(z + 3);
    return z;
  }

  /** 原版 canSnap：macOS 按住 Ctrl、其他平台按住 Alt 时临时关闭吸附与参考线。 */
  canSnap(e) { return IS_MAC ? !e.ctrlKey : !e.altKey; }

  /** 原版 cloneData：深拷贝选中数据并为节点/边换新 id，可整体平移。 */
  cloneData(data, offset) {
    const map = {};
    for (const node of data.nodes) {
      const oldId = node.id;
      node.id = genId();
      map[oldId] = node.id;
      if (offset) { node.x += offset.x; node.y += offset.y; }
    }
    for (const edge of data.edges) {
      edge.fromNode = map[edge.fromNode] || '';
      edge.toNode = map[edge.toNode] || '';
      edge.id = genId();
    }
    return data;
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

  /**
   * 临时节点（原版 Pee）。attach/render 只在需要可见替身时开启：
   * 拖线端点与连线手柄只把它当几何占位（原版从不 attach/render），
   * 一旦挂进 DOM 就会露出 100×100 的 accent 方框。
   */
  createDummyNode(options: Record<string, any> = {}) {
    const dummy = new CanvasDummyNode(this);
    if (!options || options.attach !== false) {
      dummy.attach();
      dummy.render();
    }
    return dummy;
  }

  removeDummyNode(dummy) {
    dummy.destroy();
    this.moved.delete(dummy);
    this.dirty.delete(dummy);
  }

  /* ------------------------------------------------------------ 创建节点 */

  createTextNode(opts: Record<string, any> = {}) { return createTextNode(this, opts); }

  createFileNode(opts: Record<string, any> = {}) { return createFileNode(this, opts); }

  createLinkNode(opts: Record<string, any> = {}) { return createLinkNode(this, opts); }

  createGroupNode(opts: Record<string, any> = {}) { return createGroupNode(this, opts); }

  createEdge(from, to, save = true) {
    const edge = new CanvasEdge(this, genId(), from, to);
    this.addEdge(edge);
    if (save) this.requestSave();
    return edge;
  }

  /** 「添加笔记 / 添加媒体」：文件选择弹窗。 */
  promptAddFileNode(opts: Record<string, any> = {}) {
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
  promptAddLinkNode(opts: Record<string, any> = {}) {
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

  /** 「更换网址」：预填当前 URL 的输入弹窗（原版 I5.showMenu 的 change url）。 */
  promptLinkUrl(node) {
    const modal = new LinkSuggestModal(this.app, (url) => {
      node.setUrl(url);
      this.requestSave();
    }, { value: node.url, title: t('plugins.canvas.action-change-url') });
    modal.open();
  }

  /* ------------------------------------------------------------ 只读模式 */

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
    if (this.menu) this.menu.render(true);
    for (const node of this.nodes.values()) node.onReadonlyChange?.(readonly);
  }

  /* ------------------------------------------------------------ 本地数据 */

  /** 原版 localDataManager：按 'canvas-<路径>' 存 localStorage（实现见 canvas-local-data.js）。 */
  loadLocalData() { return loadCanvasLocalData(this.file ? this.file.path : ''); }

  saveLocalData() { saveCanvasLocalData(this.file ? this.file.path : '', this.readonly); }

  /**
   * 分组背景的 vault 生命周期（原版插件 processRenames 只处理重命名；删除在本复刻补上，避免死路径）。
   * delete=true 时 file 已从 vault 索引移除；否则 file 是重命名后的根文件/文件夹，
   * oldPath 可能是背景文件本身，也可能是包含背景文件的文件夹。
   */
  updateGroupBackgrounds(file, oldPath, deleted) {
    if (!oldPath) return;
    const prefix = oldPath + '/';
    let changed = false;
    for (const node of this.nodes.values()) {
      if (!(node instanceof CanvasGroupNode) || !node.bgPath) continue;
      const path = node.bgPath;
      if (path !== oldPath && !path.startsWith(prefix)) continue;
      if (deleted) {
        node.setBackgroundFile(null);
      } else {
        const nextPath = file.path + path.slice(oldPath.length);
        const nextFile = this.app.vault.getAbstractFileByPath(nextPath);
        node.setBackgroundPath(nextPath, nextFile);
      }
      node.renderBackground();
      changed = true;
    }
    if (changed) this.requestSave();
  }

  /* ---------------------------------------------------------------- 存取 */

  requestSave(saveHistory = true) {
    this.data = this.getData(); this._dirty = hasUnsavedWindowView(this);
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

  save() { return saveWindowView(this); }

  loadOptions() {
    return loadCanvasOptions(this.app);
  }

  saveOptions() {
    saveCanvasOptions(this.app, {
      snapToGrid: this.options.snapToGrid,
      snapToObjects: this.options.snapToObjects,
      defaultWheelBehavior: this.options.defaultWheelBehavior,
      cardLabelVisibility: this.options.cardLabelVisibility,
      defaultModDragBehavior: this.options.defaultModDragBehavior,
      zoomBreakpoint: this.options.zoomBreakpoint,
      newFileLocation: this.options.newFileLocation,
      newFileFolderPath: this.options.newFileFolderPath,
    });
  }

  async loadFile(path) {
    const sequence = this._loadSequence = (this._loadSequence || 0) + 1;
    if (this.file) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this.data = this.getData();
      if (await this.save() === false) return false;
    }
    if (sequence !== this._loadSequence || this._closed) return false;
    return this._applyFileFromDisk(path);
  }

  /** 外部修改：磁盘内容与已保存内容一致时视为自身写入的 watcher 回声，跳过重载。 */
  onExternalModify(file) {
    if (!file || !this.file || this._closed || this._writing || file.path !== this.file.path || file.extension !== 'canvas') return;
    const path = this.file.path;
    const fileRef = this.file;
    this.app.vault.cachedRead(fileRef).then((text) => {
      if (!this.file || this.file.path !== path || this._closed) return;
      if (text === this._savedText) return;
      if (hasUnsavedWindowView(this)) { reportWindowSaveError(this, '文件已被另一个窗口修改，未保存的编辑已保留。', true); return; }
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
      return this._applyFileFromDisk(path, { keepViewport: true, text });
    }).catch((e) => console.error('canvas external reload failed', e));
  }

  /** 读取磁盘内容并重建节点/边；keepViewport 为真表示外部重载：保留视口与撤销历史。 */
  async _applyFileFromDisk(path, opts?) {
    const sequence = this._loadSequence;
    const keepViewport = !!(opts && opts.keepViewport);
    const file = this.app.vault.getFileByPath(path) || this.app.vault.getAbstractFileByPath(path);
    if (!file || file.extension !== 'canvas') {
      this.file = null;
      this.renderMissingFile(path);
      return;
    }
    let text = '';
    let data = null;
    try {
      text = opts?.text ?? await this.app.vault.cachedRead(file);
      if (text.trim()) {
        data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || (data.nodes !== undefined && !Array.isArray(data.nodes))
          || (data.edges !== undefined && !Array.isArray(data.edges))) throw new Error('白板必须包含节点和连线数组');
      }
    } catch (error) {
      if (sequence !== this._loadSequence || this._closed) return false;
      if (!this.file) this.renderMissingFile(path, '无法读取白板');
      new Notice('无法读取白板：' + path + '\n' + error.message);
      return false;
    }
    if (sequence !== this._loadSequence || this._closed) return false;
    if (keepViewport && hasUnsavedWindowView(this)) return reportWindowSaveError(this, '文件已被另一个窗口修改，未保存的编辑已保留。', true);
    if (!keepViewport && this.file && hasUnsavedWindowView(this) && await this.save() === false) return false;
    if (sequence !== this._loadSequence || this._closed) return false;
    this.file = file;
    this._failedFilePath = undefined;
    if (!this.contentEl.contains(this.wrapperEl)) {
      this.contentEl.empty();
      this.contentEl.append(this.wrapperEl);
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
    this._savedText = text; this._savedDataText = JSON.stringify(this.getData(), null, '\t');
    this._dirty = false; this._saveError = null; this._saveConflict = false;
    if (!keepViewport) this.zoomToFitQueued = true;
    this.onResize();
    if (this.wrapperEl) this.wrapperEl.focus({ preventScroll: true });
    this.app.workspace.trigger('canvas:file-loaded', this.file, this);
  }

  renderMissingFile(path, title?) {
    if (path) this._failedFilePath = path;
    this.contentEl.empty();
    const state = this.contentEl.createDiv('empty-state');
    state.createDiv('empty-state-title', (el) => el.setText(title || t('plugins.canvas.name') || 'Canvas'));
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
  onPaneMenu(menu, source) { super.onPaneMenu(menu, source); showCanvasPaneMenu(this, menu); }

  /** 可测试的渲染入口：返回 { dataURL, width, height, scale }，空画布返回 null。 */
  renderCanvasImage(opts) { return renderCanvasImage(this, opts); }

  /** 命令 canvas:export-as-image 与面板菜单入口：设置弹窗 → 渲染 → 保存对话框 → 写 PNG（原版 generateHDImage）。 */
  generateHDImage(opts?) { return exportCanvasImage(this, opts); }

  /**
   * 保存对话框（原版 electron dialog.showSaveDialog）。验收场景替换本方法即可跳过原生对话框，
   * 其余导出链路（渲染、写盘、通知）保持真实执行。
   */
  promptImageSavePath(defaultPath) {
    return Desktop.saveDialog({
      defaultPath,
      filters: [{ name: 'PNG Files', extensions: ['png'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['showOverwriteConfirmation'],
    });
  }
}
