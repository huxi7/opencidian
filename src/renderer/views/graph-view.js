/**
 * [INPUT]: 依赖 ../core/view.js 的 View；依赖 ../core/i18n.js 的 t；依赖 ../core/notices.js 的 Notice；依赖 ../core/events.js 的 debounce；依赖 ../plugins-core/graph.js 的 GraphEngine/ForceSim/选项读写与共享工具（has/clamp/displayName/parseColor/COLOR_CLASSES）
 * [OUTPUT]: 导出 GraphView（视图类型 graph）与 LocalGraphView（视图类型 localgraph）；模块内部含 GraphRenderer（canvas 2D 渲染与交互）
 * [POS]: views/ 的关系图谱视图层（原版 bJ/kJ + TQ 渲染器）。数据引擎、控制面板与力学在 plugins-core/graph.js；本文件负责视图生命周期与画布渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Graph views — canvas renderer for global/local graph. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { debounce } from '../core/events.js';
import {
  ForceSim, GraphEngine, readGraphOptions, writeGraphOptions,
  has, clamp, displayName, parseColor, COLOR_CLASSES,
} from '../plugins-core/graph.js';

// 渲染常量与几何工具（原版 pQ/dQ/fQ/mQ/vQ）
const FADE = 0.2; // 原版 pQ：非高亮元素的目标淡出系数
const WRAP_WIDTH = 300; // 原版 TextStyle.wordWrapWidth
const FONT_FAMILY = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif';
const lerp = (a, b, ratio = 0.9) => a * ratio + b * (1 - ratio); // 原版 dQ
const colorLerp = (a, b) => ((lerp(a >> 16 & 255, b >> 16 & 255) << 16) + (lerp(a >> 8 & 255, b >> 8 & 255) << 8) + (0 | lerp(a & 255, b & 255))); // 原版 fQ
const disjoint = (viewport, rect) => rect.right < viewport.left || rect.left > viewport.right || rect.bottom < viewport.top || rect.top > viewport.bottom; // 原版 mQ
const rectAt = (x, y, radius) => ({ left: x - radius, right: x + radius, top: y - radius, bottom: y + radius }); // 原版 vQ
const rgba = (rgb, alpha) => `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${alpha})`;
/* 原版 PIXI wordWrap：按空格折行，宽度超过 300 才折 */
function wrapText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}
/* 原版 TQ.copyToClipboard：把画布导出为 PNG 写入剪贴板 */
async function copyCanvasToClipboard(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to export the graph canvas');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

// 图元：节点（原版 MQ）与连线（原版 SQ）
class GraphNode {
  constructor(renderer, id, type) {
    this.renderer = renderer;
    this.id = id;
    this.type = type;
    this.x = null;
    this.y = null;
    this.fx = null;
    this.fy = null;
    this.forward = {};
    this.reverse = {};
    this.weight = 0;
    this.color = null;
    this.rgb = 0;
    this.fadeAlpha = 0;
    this.moveText = 0;
    this.textVisible = false;
    this.wrapCache = null;
  }
  /* 原版 getSize：随权重增长，钳在 8~30 */
  getSize() { return this.renderer.fNodeSizeMult * clamp(3 * Math.sqrt(this.weight + 1), 8, 30); }
  getDisplayText() { return displayName(this.id); }
  getRelated() { return Object.keys(this.forward).concat(Object.keys(this.reverse)); }
  /* 原版 getFillColor：高亮 > 颜色组 > 焦点 > 标签 > 未解析 > 附件 > 默认 */
  getFillColor() {
    const renderer = this.renderer;
    if (renderer.getHighlightNode() === this) return renderer.colors.fillHighlight;
    if (this.type === 'focused') { if (renderer.colors.fillFocused.a > 0) return renderer.colors.fillFocused; }
    else if (this.color) return this.color;
    else if (this.type === 'tag') return renderer.colors.fillTag;
    else if (this.type === 'unresolved') return renderer.colors.fillUnresolved;
    else if (this.type === 'attachment') return renderer.colors.fillAttachment;
    return renderer.colors.fill;
  }
}

class GraphLink {
  constructor(renderer, source, target) {
    this.renderer = renderer;
    this.source = source;
    this.target = target;
    this.alpha = FADE * renderer.colors.line.a;
    this.arrowAlpha = FADE * renderer.colors.text.a;
    this.rgb = renderer.colors.line.rgb;
  }
}

// 渲染器（原版 TQ）：canvas 2D 承担原版 PIXI 的场景与事件；pan 与缩放中心用设备像素
class GraphRenderer {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.canvasEl = null;
    this.ctx = null;
    this.nodeLookup = {};
    this.nodes = [];
    this.links = [];
    this.dragNode = null;
    this.highlightNode = null;
    this.scale = 1;
    this.nodeScale = 1;
    this.textAlpha = 1;
    this.targetScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.panvX = 0;
    this.panvY = 0;
    this.keyboardActions = {};
    this.panning = false;
    this.width = 0;
    this.height = 0;
    this.viewport = { left: 0, right: 0, top: 0, bottom: 0 };
    this.zoomCenterX = 0;
    this.zoomCenterY = 0;
    this.fNodeSizeMult = 1;
    this.fLineSizeMult = 1;
    this.fTextShowMult = 1;
    this.fShowArrow = false;
    this.mouseX = this.mouseY = null;
    this.colors = {};
    this.idleFrames = 0;
    this.renderTimer = null;
    this.frameTime = 0;
    this.sim = new ForceSim();
    this.onNodeClick = null;
    this.onNodeRightClick = null;
    this.onNodeHover = null;
    this.onNodeUnhover = null;
    this.testCSS();
    containerEl.style.padding = '0';
    containerEl.style.overflow = 'hidden';
    containerEl.style.position = 'relative';
    const canvas = this.canvasEl = containerEl.createEl('canvas');
    this.ctx = canvas.getContext('2d');
    canvas.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden';
    canvas.addEventListener('mousedown', (ev) => { ev.preventDefault(); this.onMouseDown(ev); });
    canvas.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });
    canvas.addEventListener('mousemove', (ev) => this.onMouseMove(ev), { passive: true });
    canvas.addEventListener('mouseout', () => this.onMouseOut());
    canvas.addEventListener('contextmenu', (ev) => this.onContextMenu(ev));
    window.addEventListener('mouseup', (ev) => this.onMouseUp(ev));
    this.renderCallback = () => this.renderFrame();
    this.onResize();
    this.resetPan();
    this.queueRender();
    /* 视图打开时容器可能尚未布局（onResize 拿到 0x0），容器拿到真实尺寸后必须重建画布 */
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(containerEl);
  }

  destroy() {
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.renderTimer) window.cancelAnimationFrame(this.renderTimer);
    this.renderTimer = null;
    this.renderCallback = null;
    this.sim = new ForceSim();
    this.nodes = []; this.links = []; this.nodeLookup = {};
    document.body.removeClass('is-grabbing');
  }

  /* 原版 testCSS：用探针元素读取 11 个颜色类别的计算颜色与透明度 */
  testCSS() {
    const probe = (cls) => {
      const el = document.body.createDiv({ cls: 'graph-view ' + cls });
      const style = getComputedStyle(el);
      const color = parseColor(style.color);
      const opacity = parseFloat(style.opacity);
      el.detach();
      const alpha = Number.isNaN(opacity) ? 1 : opacity;
      return color ? { a: alpha * color.a, rgb: color.r << 16 | color.g << 8 | color.b } : { a: alpha, rgb: 8947848 };
    };
    for (const key in COLOR_CLASSES) if (has(COLOR_CLASSES, key)) this.colors[key] = probe(COLOR_CLASSES[key]);
    this.changed();
  }
  getHighlightNode() { return this.dragNode || this.highlightNode; }

  /* 原版：鼠标坐标乘 devicePixelRatio 后换算到世界坐标，命中半径 = 屏幕半径 + 2 */
  nodeAt(ev) {
    const dpr = window.devicePixelRatio;
    const worldX = (ev.offsetX * dpr - this.panX) / this.scale;
    const worldY = (ev.offsetY * dpr - this.panY) / this.scale;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (node.x === null) continue;
      const radius = node.getSize() * this.nodeScale + 2;
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      if (dx * dx + dy * dy <= radius * radius) return node;
    }
    return null;
  }

  /* 原版 onWheel：1.5^(-deltaY/120)；缩小时以视口中心为锚点，放大时以光标为锚点 */
  onWheel(ev) {
    ev.preventDefault();
    let delta = ev.deltaY;
    if (ev.deltaMode === 1) delta *= 40;
    else if (ev.deltaMode === 2) delta *= 800;
    this.targetScale *= Math.pow(1.5, -delta / 120);
    if (this.targetScale < this.scale) { this.zoomCenterX = 0; this.zoomCenterY = 0; }
    else {
      const dpr = window.devicePixelRatio;
      this.zoomCenterX = ev.offsetX * dpr;
      this.zoomCenterY = ev.offsetY * dpr;
    }
    this.changed();
  }

  onMouseDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    const node = this.nodeAt(ev);
    if (node) {
      this.dragNode = node;
      this.dragStart = { x: ev.clientX, y: ev.clientY };
      this.dragMoved = false;
      return;
    }
    this.panning = true;
    this.panStart = { x: ev.clientX, y: ev.clientY };
    this.panOrigin = { x: this.panX, y: this.panY };
    this.lastPanTime = performance.now();
    document.body.addClass('is-grabbing');
  }

  onMouseMove(ev) {
    this.mouseX = ev.offsetX;
    this.mouseY = ev.offsetY;
    const dpr = window.devicePixelRatio;
    const node = this.dragNode;
    if (node) {
      /* 原版：拖出 5px 才算拖拽；节点被钉在光标世界坐标上，alpha 抬到 0.3 */
      const dx = (ev.clientX - this.dragStart.x) * dpr;
      const dy = (ev.clientY - this.dragStart.y) * dpr;
      if (dx * dx + dy * dy > 25) this.dragMoved = true;
      const worldX = (ev.offsetX * dpr - this.panX) / this.scale;
      const worldY = (ev.offsetY * dpr - this.panY) / this.scale;
      node.fx = worldX;
      node.fy = worldY;
      this.sim.setForceNode(node.id, worldX, worldY, 0.3, 0.3);
      this.changed();
      return;
    }
    if (this.panning) {
      /* 原版：平移跟随光标（设备像素），同时平滑出速度供惯性使用 */
      const now = performance.now();
      this.frameTime = lerp(this.frameTime, now - this.lastPanTime, 0.8);
      this.lastPanTime = now;
      const targetX = this.panOrigin.x + (ev.clientX - this.panStart.x) * dpr;
      const targetY = this.panOrigin.y + (ev.clientY - this.panStart.y) * dpr;
      this.panvX = lerp(this.panvX, targetX - this.panX, 0.8);
      this.panvY = lerp(this.panvY, targetY - this.panY, 0.8);
      this.setPan(targetX, targetY);
      this.changed();
      return;
    }
    const hovered = this.nodeAt(ev);
    if (hovered === this.highlightNode) return;
    if (this.highlightNode) {
      this.highlightNode = null;
      this.changed();
      if (this.onNodeUnhover) this.onNodeUnhover();
    }
    if (hovered) {
      this.highlightNode = hovered;
      this.changed();
      if (this.onNodeHover) this.onNodeHover(ev, hovered.id, hovered.type);
    }
  }

  onMouseOut() {
    this.mouseX = this.mouseY = null;
    if (!this.highlightNode) return;
    this.highlightNode = null;
    this.changed();
    if (this.onNodeUnhover) this.onNodeUnhover();
  }

  /* 原版：右键（macOS 的 ctrl+左键）命中节点时交给引擎弹菜单 */
  onContextMenu(ev) {
    ev.preventDefault();
    if (!(ev instanceof MouseEvent)) return;
    const node = this.nodeAt(ev);
    if (node && this.onNodeRightClick) this.onNodeRightClick(ev, node.id, node.type);
  }

  onMouseUp(ev) {
    const node = this.dragNode;
    if (node) {
      const isRightClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!this.dragMoved && (ev.button === 0 || ev.button === 1) && !isRightClick && this.onNodeClick) {
        this.onNodeClick(ev, node.id, node.type);
      }
      node.fx = null;
      node.fy = null;
      this.sim.setForceNode(node.id, null, null, undefined, 0);
      this.dragNode = null;
      this.changed();
    }
    if (!this.panning) return;
    this.panning = false;
    document.body.removeClass('is-grabbing');
    const elapsed = performance.now() - this.lastPanTime;
    this.frameTime = lerp(this.frameTime, elapsed, 0.8);
    if (elapsed > 100) { this.panvX = 0; this.panvY = 0; }
    else if (this.frameTime > 0) { this.panvX /= this.frameTime; this.panvY /= this.frameTime; }
  }

  /* 原版 setData：差量增删节点/连线，新节点按邻居质心或环形散布落位 */
  setData(data) {
    const nodeLookup = this.nodeLookup;
    const nodes = this.nodes;
    const links = this.links;
    const fresh = [];
    const deadNodes = [];
    const deadLinks = [];
    let changed = false;
    let changedProps = false;
    let maxRadiusSq = 0;
    for (const node of nodes) {
      if (has(data.nodes, node.id)) maxRadiusSq = Math.max(maxRadiusSq, node.x * node.x + node.y * node.y);
      else { deadNodes.push(node); changed = true; }
    }
    const maxRadius = Math.sqrt(maxRadiusSq);
    for (const id in data.nodes) {
      if (!has(data.nodes, id)) continue;
      const incoming = data.nodes[id];
      if (has(nodeLookup, id)) {
        const node = nodeLookup[id];
        const color = incoming.color || null;
        if (node.color !== color) { node.color = color; changedProps = true; }
        if (node.type !== incoming.type) { node.type = incoming.type; changedProps = true; }
      } else {
        const node = new GraphNode(this, id, incoming.type);
        node.color = incoming.color || null;
        nodes.push(node);
        nodeLookup[id] = node;
        fresh.push(node);
        changed = true;
      }
    }
    for (const id in data.nodes) {
      if (!has(data.nodes, id) || !has(nodeLookup, id)) continue;
      const node = nodeLookup[id];
      const outgoing = data.nodes[id].links;
      for (const targetId in node.forward) {
        if (has(node.forward, targetId) && !has(outgoing, targetId)) { deadLinks.push(node.forward[targetId]); changed = true; }
      }
      for (const targetId in outgoing) {
        if (!has(outgoing, targetId) || has(node.forward, targetId) || !has(nodeLookup, targetId)) continue;
        const target = nodeLookup[targetId];
        const link = new GraphLink(this, node, target);
        links.push(link);
        node.forward[target.id] = link;
        target.reverse[node.id] = link;
        changed = true;
      }
    }
    const removeLink = (link) => {
      const index = links.indexOf(link);
      if (index >= 0) links.splice(index, 1);
      delete link.source.forward[link.target.id];
      delete link.target.reverse[link.source.id];
    };
    for (const link of deadLinks) removeLink(link);
    for (const node of deadNodes) {
      for (const id in node.forward) if (has(node.forward, id)) removeLink(node.forward[id]);
      for (const id in node.reverse) if (has(node.reverse, id)) removeLink(node.reverse[id]);
      const index = nodes.indexOf(node);
      if (index >= 0) nodes.splice(index, 1);
      delete nodeLookup[node.id];
    }
    /* 原版 MQ 初始位置：邻居质心 ± spread；无邻居时落在半径 [m, m+ring] 的圆环内 */
    if (fresh.length) {
      const area = 3600 * fresh.length;
      const ring = Math.sqrt(area / Math.PI + maxRadius * maxRadius) - maxRadius;
      const spread = Math.sqrt(area);
      for (const node of fresh) {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (const relatedId of node.getRelated()) {
          const other = nodeLookup[relatedId];
          if (other && other.x !== null && other.y !== null) { sumX += other.x; sumY += other.y; count++; }
        }
        if (count > 0) {
          node.x = sumX / count + (Math.random() - 0.5) * spread;
          node.y = sumY / count + (Math.random() - 0.5) * spread;
        } else {
          const angle = 2 * Math.PI * Math.random();
          const radius = maxRadius + Math.sqrt(Math.random()) * ring;
          node.x = radius * Math.cos(angle);
          node.y = radius * Math.sin(angle);
        }
      }
    }
    const weights = data.weights;
    for (const id in nodeLookup) {
      if (!has(nodeLookup, id)) continue;
      const node = nodeLookup[id];
      const weight = weights ? (has(weights, id) ? weights[id] : 0) : node.getRelated().length;
      if (node.weight !== weight) { node.weight = weight; changed = true; }
    }
    if (changed) {
      this.sim.setData(nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
        links.map((link) => [link.source.id, link.target.id]));
      this.changed();
    } else if (changedProps) this.changed();
  }

  setRenderOptions(options) {
    if (Number.isFinite(options.nodeSizeMultiplier)) this.fNodeSizeMult = options.nodeSizeMultiplier;
    if (Number.isFinite(options.lineSizeMultiplier)) this.fLineSizeMult = options.lineSizeMultiplier;
    if (Number.isFinite(options.textFadeMultiplier)) this.fTextShowMult = options.textFadeMultiplier;
    if (typeof options.showArrow === 'boolean') this.fShowArrow = options.showArrow;
    this.changed();
  }
  setForces(forces) { this.sim.setForces(forces); }

  /* 原版 updateZoom：目标缩放按 0.85 逼近，围绕缩放中心保持世界坐标不动 */
  updateZoom() {
    let scale = this.scale;
    const targetScale = this.targetScale = Math.min(8, Math.max(1 / 128, this.targetScale));
    if ((scale > targetScale ? scale / targetScale : targetScale / scale) - 1 >= 0.01) {
      let centerX = this.zoomCenterX;
      let centerY = this.zoomCenterY;
      if (centerX === 0 && centerY === 0) {
        const dpr = window.devicePixelRatio;
        centerX = this.width / 2 * dpr;
        centerY = this.height / 2 * dpr;
      }
      const world = { x: (centerX - this.panX) / scale, y: (centerY - this.panY) / scale };
      scale = lerp(scale, targetScale, 0.85);
      this.panX -= world.x * scale + this.panX - centerX;
      this.panY -= world.y * scale + this.panY - centerY;
      this.changed();
    }
    this.setPan(this.panX, this.panY);
    this.setScale(scale);
  }
  setPan(x, y) { this.panX = x; this.panY = y; }

  /* 原版 setScale：节点缩放取 1/√scale，文本透明度 = log2(scale)+1-阈值 钳到 [0,1] */
  setScale(scale) {
    this.scale = scale;
    this.nodeScale = Math.sqrt(1 / scale);
    this.textAlpha = clamp(Math.log(scale) / Math.log(2) + 1 - this.fTextShowMult, 0, 1);
  }

  zoomTo(scale, center) {
    this.targetScale = scale;
    if (center) { this.zoomCenterX = center.x; this.zoomCenterY = center.y; } else { this.zoomCenterX = 0; this.zoomCenterY = 0; }
  }

  /* 原版 onResize：画布按设备像素重建，视口尺寸变化时保持中心不变 */
  onResize() {
    const canvas = this.canvasEl;
    const dpr = window.devicePixelRatio;
    const width = this.containerEl.clientWidth;
    const height = this.containerEl.clientHeight;
    const prevWidth = this.width * dpr;
    const prevHeight = this.height * dpr;
    this.width = width;
    this.height = height;
    const deviceWidth = Math.round(width * dpr);
    const deviceHeight = Math.round(height * dpr);
    canvas.width = deviceWidth;
    canvas.height = deviceHeight;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    if (prevWidth || prevHeight) {
      this.setPan(this.panX + (deviceWidth - prevWidth) / 2, this.panY + (deviceHeight - prevHeight) / 2);
    } else if (deviceWidth && deviceHeight) {
      /* 首次拿到真实尺寸（构造时容器未布局）：重新居中，否则 updateZoom 会围绕屏幕中心把 pan 算成负值 */
      this.resetPan();
    }
    this.changed();
  }

  resetPan() {
    const dpr = window.devicePixelRatio;
    this.setPan(this.width / 2 * dpr, this.height / 2 * dpr);
  }
  changed() { this.idleFrames = 0; this.queueRender(); }
  queueRender() {
    if (!this.renderTimer && this.renderCallback) this.renderTimer = window.requestAnimationFrame(this.renderCallback);
  }
  getTransparentScreenshot() { return this.canvasEl; }

  /* 原版 renderCallback：物理推进 → 平移惯性/键盘 → 缩放 → 视口 → 绘制，空闲 60 帧后停 */
  renderFrame() {
    this.renderTimer = null;
    if (!this.canvasEl || this.idleFrames > 60) return;
    if (!this.sim.finished) { this.sim.tick(); this.idleFrames = 0; }
    const simNodes = this.sim.nodeById;
    for (const node of this.nodes) {
      const simNode = simNodes.get(node.id);
      if (!simNode) continue;
      node.x = node.fx === null ? simNode.x : node.fx;
      node.y = node.fy === null ? simNode.y : node.fy;
    }
    const keys = this.keyboardActions;
    const shift = keys.shift;
    if (!this.panning) {
      this.panX += 1000 * this.panvX / 60;
      this.panY += 1000 * this.panvY / 60;
      let horizontal = 0;
      let vertical = 0;
      if (keys.up) vertical += 1;
      if (keys.down) vertical -= 1;
      if (keys.left) horizontal += 1;
      if (keys.right) horizontal -= 1;
      if (horizontal !== 0 || vertical !== 0) this.idleFrames = 0;
      const speed = shift ? 3 : 1;
      this.panvX = lerp(this.panvX, horizontal * speed, 0.9);
      this.panvY = lerp(this.panvY, vertical * speed, 0.9);
    }
    const zoomFactor = 1 + (shift ? 0.1 : 0.03);
    let zooming = false;
    if (keys.zoomin) { this.targetScale *= zoomFactor; zooming = true; }
    if (keys.zoomout) { this.targetScale /= zoomFactor; zooming = true; }
    if (zooming) {
      this.idleFrames = 0;
      const dpr = window.devicePixelRatio;
      this.zoomCenterX = this.width / 2 * dpr;
      this.zoomCenterY = this.height / 2 * dpr;
    }
    this.updateZoom();
    const dpr = window.devicePixelRatio;
    const scale = this.scale;
    const left = -this.panX / scale;
    const top = -this.panY / scale;
    this.viewport = { left, top, right: left + this.width / scale * dpr, bottom: top + this.height / scale * dpr };
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    ctx.setTransform(scale, 0, 0, scale, this.panX, this.panY);
    this.drawLinks(ctx);
    this.drawNodes(ctx);
    this.idleFrames++;
    this.queueRender();
    /* 原版：鼠标已移出悬停节点的半径时取消高亮 */
    const { mouseX, mouseY, highlightNode } = this;
    if (mouseX !== null && mouseY !== null && highlightNode) {
      const worldX = (mouseX * dpr - this.panX) / scale;
      const worldY = (mouseY * dpr - this.panY) / scale;
      const dx = highlightNode.x - worldX;
      const dy = highlightNode.y - worldY;
      const radius = highlightNode.getSize() * this.nodeScale + 2;
      if (dx * dx + dy * dy > radius * radius) {
        this.highlightNode = null;
        this.idleFrames = 0;
        if (this.onNodeUnhover) this.onNodeUnhover();
      }
    }
  }

  /* 原版 SQ.render：连线两端各缩进节点半径；双向链接只画一条；箭头随缩放淡入 */
  drawLinks(ctx) {
    const viewport = this.viewport;
    const highlight = this.getHighlightNode();
    for (const link of this.links) {
      const source = link.source;
      const target = link.target;
      const related = source === highlight || target === highlight;
      const intensity = !highlight || related ? 1 : FADE;
      const lineColor = related ? this.colors.lineHighlight : this.colors.line;
      const arrowColor = this.colors.arrow;
      const visible = !(has(source.reverse, target.id) && source.id.localeCompare(target.id) < 0);
      const thickness = this.fLineSizeMult / this.scale;
      const sourceBox = rectAt(source.x, source.y, thickness);
      const targetBox = rectAt(target.x, target.y, thickness);
      const inView = !disjoint(viewport, {
        left: Math.min(sourceBox.left, targetBox.left),
        right: Math.max(sourceBox.right, targetBox.right),
        top: Math.min(sourceBox.top, targetBox.top),
        bottom: Math.max(sourceBox.bottom, targetBox.bottom),
      });
      link.alpha = lerp(link.alpha, intensity * lineColor.a);
      link.arrowAlpha = lerp(link.arrowAlpha, intensity * clamp(2 * (this.scale - 0.3), 0, 1) * arrowColor.a);
      const drawLine = visible && inView;
      let showArrow = this.fShowArrow && inView && link.arrowAlpha > 0.001;
      if (!drawLine && !showArrow) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) continue;
      const sourceRadius = source.getSize() * this.nodeScale;
      let targetRadius = target.getSize() * this.nodeScale;
      if (showArrow && distance <= thickness) showArrow = false;
      if (drawLine) {
        link.rgb = colorLerp(link.rgb, lineColor.rgb);
        ctx.strokeStyle = rgba(link.rgb, link.alpha);
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(source.x + dx * sourceRadius / distance, source.y + dy * sourceRadius / distance);
        ctx.lineTo(target.x - dx * targetRadius / distance, target.y - dy * targetRadius / distance);
        ctx.stroke();
      }
      if (showArrow) {
        targetRadius += 1;
        const size = 2 * Math.sqrt(this.fLineSizeMult) / this.scale;
        ctx.save();
        ctx.translate(target.x - dx * targetRadius / distance, target.y - dy * targetRadius / distance);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = rgba(arrowColor.rgb, link.arrowAlpha);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-4 * size, -2 * size);
        ctx.lineTo(-3 * size, 0);
        ctx.lineTo(-4 * size, 2 * size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  /* 原版 MQ.render：圆点 + 高亮圆环 + 文本（fadeAlpha/moveText 逐帧插值） */
  drawNodes(ctx) {
    const viewport = this.viewport;
    const highlight = this.getHighlightNode();
    const nodeScale = this.nodeScale;
    for (const node of this.nodes) {
      if (node.x === null) continue;
      const size = node.getSize();
      const fill = node.getFillColor();
      const related = !highlight || highlight === node || has(node.forward, highlight.id) || has(node.reverse, highlight.id);
      node.fadeAlpha = lerp(node.fadeAlpha, related ? 1 : FADE);
      const highlighted = highlight === node;
      node.moveText = node.textVisible ? lerp(node.moveText, highlighted ? 15 : 0) : (highlighted ? 15 : 0);
      if (highlighted || !disjoint(viewport, rectAt(node.x, node.y, size * nodeScale + 1))) {
        node.rgb = colorLerp(node.rgb, fill.rgb);
        ctx.fillStyle = rgba(node.rgb, node.fadeAlpha * fill.a);
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * nodeScale, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (highlighted) {
        /* 原版高亮圆环：线宽 E = max(1, 1/(scale*nodeScale))，半径 size + E/2 */
        const lineWidth = Math.max(1, 1 / (this.scale * nodeScale));
        const circleColor = this.colors.circle;
        ctx.strokeStyle = rgba(circleColor.rgb, circleColor.a);
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.arc(node.x, node.y, (size + lineWidth / 2) * nodeScale, 0, 2 * Math.PI);
        ctx.stroke();
      }
      const textColor = this.colors.text;
      let textAlpha = highlighted ? this.textAlpha * textColor.a : this.textAlpha * node.fadeAlpha * textColor.a;
      let textVisible = textAlpha > 0.001;
      if (textVisible) {
        textVisible = highlighted
          || !disjoint(viewport, { left: node.x - WRAP_WIDTH, right: node.x + WRAP_WIDTH, top: node.y, bottom: node.y + 200 });
      }
      node.textVisible = textVisible;
      if (!textVisible) continue;
      /* 原版：高亮且 scale<1 时文本按 1/scale 放大，保持屏幕字号可读 */
      const textScale = highlighted && this.scale < 1 ? 1 / this.scale : nodeScale;
      const fontSize = (14 + size / 4) * textScale;
      ctx.font = `${fontSize}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = rgba(textColor.rgb, textAlpha);
      const label = node.getDisplayText();
      let lines = node.wrapCache && node.wrapCache.fontSize === fontSize ? node.wrapCache.lines : null;
      if (!lines) {
        lines = wrapText(ctx, label, WRAP_WIDTH * textScale);
        node.wrapCache = { fontSize, lines };
      }
      const top = node.y + (size + 5) * nodeScale + node.moveText / this.scale;
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], node.x, top + i * fontSize * 1.2);
    }
  }
}

// 视图：全局图谱（原版 bJ）与局部图谱（原版 kJ）
/* 本项目 View 没有 registerEvent/registerInterval，这里补齐并统一销毁 */
class GraphViewBase extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'git-fork';
    this.renderer = null;
    this._cleaned = false;
  }
  onResize() { if (this.renderer) this.renderer.onResize(); }
  registerEvent(ref) { if (ref && ref.unregister) this._children.push(() => ref.unregister()); }
  registerDomEvent(el, type, callback) {
    el.addEventListener(type, callback);
    this._children.push(() => el.removeEventListener(type, callback));
  }
  registerInterval(id) { this._children.push(() => clearInterval(id)); }
  onPaneMenu(menu) {
    menu.addItem((item) => item.setSection('action')
      .setTitle(t('plugins.graph-view.action-copy-screenshot')).setIcon('image')
      .onClick(async () => {
        try {
          await copyCanvasToClipboard(this.renderer.getTransparentScreenshot());
          new Notice(t('plugins.graph-view.msg-screenshot-copied'));
        } catch (error) {
          new Notice(String(error));
        }
      }));
  }
  cleanup() {
    if (this._cleaned) return;
    this._cleaned = true;
    for (const dispose of this._children) {
      try { dispose(); } catch (error) { console.error(error); }
    }
    this._children.length = 0;
  }
  async onClose() {
    this.cleanup();
    if (this.renderer) this.renderer.destroy();
  }
}

export class GraphView extends GraphViewBase {
  constructor(leaf) {
    super(leaf);
    this.navigation = true;
    this.dataEngine = null;
  }
  getViewType() { return 'graph'; }
  getDisplayText() { return t('plugins.graph-view.name'); }
  async onOpen() {
    this.contentEl.addClass('graph-view-container');
    this.renderer = new GraphRenderer(this.contentEl);
    this.dataEngine = new GraphEngine(this.app, this, this.renderer, false);
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.update()));
    this.dataEngine.load();
    this.dataEngine.setOptions(readGraphOptions(this.app));
    this.dataEngine.requestUpdateSearch();
    this.update();
  }
  update() { if (this.dataEngine) this.dataEngine.render(); }
  /* 原版 showSearch：展开控制面板与筛选区并选中搜索框 */
  showSearch() {
    this.dataEngine.controlsEl.removeClass('is-close');
    this.dataEngine.filterOptions.setCollapsed(false);
    this.dataEngine.filterOptions.search.autoSelect();
  }
  onOptionsChange() {
    if (this._loaded && this.dataEngine) writeGraphOptions(this.app, this.dataEngine.getOptions());
  }
}

export class LocalGraphView extends GraphViewBase {
  constructor(leaf) {
    super(leaf);
    this.file = null;
    this.renderedFile = null;
    this.engine = null;
  }
  getViewType() { return 'localgraph'; }
  getDisplayText() {
    if (!this.file) return t('plugins.graph-view.name');
    return t('plugins.graph-view.tab-title', { displayText: this.file.basename });
  }
  getState() {
    return {
      file: this.file ? this.file.path : null,
      options: this.engine ? this.engine.getOptions() : {},
    };
  }
  async setState(state) {
    if (state && state.options && this.engine) this.engine.setOptions(state.options);
    if (state && state.file !== undefined) this.loadFile(state.file ? this.app.vault.getFileByPath(state.file) : null);
    else this.loadFile(this.app.workspace.getActiveFile());
  }
  async onOpen() {
    this.contentEl.addClass('graph-view-container');
    this.renderer = new GraphRenderer(this.contentEl);
    this.engine = new GraphEngine(this.app, this, this.renderer, true);
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.update()));
    this.registerEvent(this.app.workspace.on('file-open', (file) => this.loadFile(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => { if (file === this.file) this.requestUpdate(); }));
    this.engine.load();
  }
  loadFile(file) {
    if (file === this.file) return;
    this.file = file;
    if (this.leaf.updateTabHeader) this.leaf.updateTabHeader();
    this.requestUpdate();
  }
  requestUpdate() {
    this._requestUpdate = this._requestUpdate || debounce(() => this.update(), 10);
    this._requestUpdate();
  }
  /* 原版 kJ.update：换文件时重置平移，局部图谱以当前文件为根 */
  update() {
    if (!this.renderer || !this.engine) return;
    if (this.renderedFile !== this.file) {
      this.renderer.resetPan();
      this.renderedFile = this.file;
    }
    this.renderer.highlightNode = null;
    this.engine.options.localFile = this.file ? this.file.path : null;
    this.engine.render();
  }
  /* 原版 requestSaveLayout：本项目布局由 layout-change 触发防抖保存 */
  onOptionsChange() { this.app.workspace.trigger('layout-change'); }
}
