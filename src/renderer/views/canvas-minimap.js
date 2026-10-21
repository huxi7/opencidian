/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 sidePoint、bezierFor、unionBBox、expandBBox、applyCanvasColor；依赖 core/dom.js 的 createSvg 元素助手。
 * [OUTPUT]: 导出 renderCanvasMinimap(containerEl, text)：把 .canvas 文件的 JSON 画成缩略图 SVG（.canvas-minimap）。
 * [POS]: views/ 画布里 .canvas 文件卡的正文渲染（原版 app.js 的 lte）。
 *        原版画布插件把 .canvas 注册进 embedRegistry（app.js 3428689 的 cte），文件卡因此走「画布嵌入」而不是 markdown 嵌入：
 *        容器挂 .canvas-embed，正文是 <svg class="canvas-minimap">——分组与卡片画成圆角矩形（rx/ry=20）、
 *        边画成贝塞尔路径（线宽按内容宽度开方），视图盒取内容并集外扩 5%。
 *        本复刻照此渲染，不再把 .canvas 的原始 JSON 当 markdown 渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas minimap — original lte: a .canvas file card shows its canvas as a minimap. */
import { sidePoint, bezierFor, unionBBox, expandBBox, applyCanvasColor } from './canvas-utils.js';

export function renderCanvasMinimap(containerEl, text) {
  let data = null;
  try { data = JSON.parse(text); } catch (e) { return null; }
  const nodes = (data && data.nodes) || [];
  const edges = (data && data.edges) || [];
  if (!nodes.length) return null;
  const svg = containerEl.createSvg('svg', { cls: 'canvas-minimap' });
  const boxes = new Map();
  for (const node of nodes) {
    boxes.set(node.id, { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height });
  }
  // 原版 p()：节点画成圆角矩形；着色节点按 z9 挂 is-themed 与画布色。
  const drawNode = (node) => {
    const rect = svg.createSvg('rect', {
      attr: { x: node.x, y: node.y, width: node.width, height: node.height, rx: '20', ry: '20' },
    });
    applyCanvasColor(rect, node.color);
  };
  for (const node of nodes) if (node.type === 'group') drawNode(node);
  const union = unionBBox(Array.from(boxes.values()));
  const strokeWidth = Math.sqrt((union.maxX - union.minX) / 10);
  for (const edge of edges) {
    const from = boxes.get(edge.fromNode);
    const to = boxes.get(edge.toNode);
    if (!from || !to) continue;
    const a = sidePoint(from, edge.fromSide);
    const b = sidePoint(to, edge.toSide);
    if (!a || !b) continue;
    const path = svg.createSvg('path', { attr: { d: bezierFor(a, edge.fromSide, b, edge.toSide).path } });
    path.style.strokeWidth = String(strokeWidth);
    applyCanvasColor(path, edge.color);
  }
  for (const node of nodes) if (node.type !== 'group') drawNode(node);
  const pad = Math.max(union.maxX - union.minX, union.maxY - union.minY) / 20;
  const box = expandBBox(union, pad);
  svg.setAttr('viewBox', `${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`);
  containerEl.appendChild(svg);
  return svg;
}
