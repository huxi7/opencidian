/**
 * [INPUT]: 依赖 ./canvas-utils.js 的 unionBBox/expandBBox/sidePoint/offsetPoint/bezierFor/SIDE_ROTATION；
 *          依赖 ./canvas-node.js 的 CanvasGroupNode/CanvasLinkNode；依赖 ./canvas-file-node.js 的 CanvasFileNode；
 *          依赖 ../core/i18n.js 的 t；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/keymap.js 的 IS_MAC
 * [OUTPUT]: 导出 renderCanvasImage(canvas, opts) 与 exportCanvasImage(canvas)。
 * [POS]: views/ 画布类的图片导出层。renderCanvasImage 用离屏 2D canvas 画出与视图一致的画面（背景取 .canvas-wrapper 计算色，
 *        边取 .canvas-display-path 计算描边色，卡片取 .canvas-node-container 计算底色/边框/圆角），是纯函数、不弹对话框，供验收直接断言。
 *        exportCanvasImage 叠加原版行为：空画布提示 msg-export-failed-empty-canvas → Desktop.saveDialog → 写 PNG → 通知带「在访达中显示」。
 *        原版用分块截图 + 保存弹窗（视图范围/缩放/logo/隐私模式），本复刻按全画布一次性绘制，不画 logo、无隐私模式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas image export — offscreen 2D canvas renderer + save dialog (original generateHDImage). */
import {
  unionBBox, expandBBox, sidePoint, offsetPoint, bezierFor, SIDE_ROTATION,
} from './canvas-utils.js';
import { CanvasGroupNode, CanvasLinkNode } from './canvas-node.js';
import { CanvasFileNode } from './canvas-file-node.js';
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { IS_MAC } from '../core/keymap.js';

/** 导出尺寸上限（原版上限 16284；本复刻缩到 4096 以限制一次性绘制的内存）。 */
const MAX_SIZE = 4096;
/** 画布包围盒外扩（原版 v3(box, 100)）。 */
const PADDING = 100;
/** 原版箭头多边形顶点（.canvas-edges polygon.canvas-path-end）。 */
const ARROW_POINTS = [[0, 0], [6.5, 10.4], [-6.5, 10.4]];
/** 卡片内边距，对齐卡片编辑器 .cm-scroller 的 --size-4-4。 */
const CARD_PADDING = 16;

/**
 * 把当前画布画成 PNG：全部节点 + 全部边，背景取画布主题背景色。
 * @param {CanvasView} canvas
 * @param {{maxSize?:number, padding?:number}} [opts]
 * @returns {{dataURL:string, width:number, height:number, scale:number}|null} 空画布返回 null
 */
export function renderCanvasImage(canvas, opts = {}) {
  const nodes = Array.from(canvas.nodes.values());
  if (!nodes.length) return null;
  const maxSize = opts.maxSize || MAX_SIZE;
  const padding = opts.padding === undefined ? PADDING : opts.padding;
  const box = expandBBox(unionBBox(nodes.map((node) => node.getBBox())), padding);
  const worldWidth = Math.max(box.maxX - box.minX, 1);
  const worldHeight = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(1, maxSize / worldWidth, maxSize / worldHeight);
  const width = Math.max(1, Math.ceil(worldWidth * scale));
  const height = Math.max(1, Math.ceil(worldHeight * scale));

  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = canvasBackground(canvas);
  ctx.fillRect(0, 0, width, height);
  ctx.lineJoin = 'round';
  const toImage = (p) => ({ x: (p.x - box.minX) * scale, y: (p.y - box.minY) * scale });

  // 边在节点之下（原版 .canvas-edges 先于 .canvas-node 挂载）
  for (const edge of canvas.edges.values()) drawEdge(ctx, edge, toImage, scale);
  const ordered = nodes.slice().sort((a, b) => a.zIndex - b.zIndex);
  for (const node of ordered) drawNode(ctx, node, toImage, scale);
  return { dataURL: canvasEl.toDataURL('image/png'), width, height, scale };
}

/**
 * 命令 canvas:export-as-image 与画布面板菜单的入口：渲染 → 保存对话框 → 写 PNG。
 * @param {CanvasView} canvas
 * @returns {Promise<{filePath:string,width:number,height:number}|null>}
 */
export async function exportCanvasImage(canvas) {
  const image = renderCanvasImage(canvas);
  if (!image) {
    new Notice(t('plugins.canvas.msg-export-failed-empty-canvas'));
    return null;
  }
  const name = canvas.file ? canvas.file.basename : 'Canvas';
  const result = Desktop.saveDialog({
    defaultPath: name + '.png',
    filters: [{ name: 'PNG Files', extensions: ['png'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['showOverwriteConfirmation'],
  });
  const filePath = result && !result.canceled && result.filePath ? result.filePath : null;
  if (!filePath) return null;
  const base64 = image.dataURL.slice(image.dataURL.indexOf(',') + 1);
  require('fs').writeFileSync(filePath, Buffer.from(base64, 'base64'));
  const notice = new Notice(filePath, 10000);
  notice.addButton(IS_MAC
    ? t('plugins.open-with-default-app.action-show-in-folder-mac')
    : t('plugins.open-with-default-app.action-show-in-folder'), () => Desktop.showItemInFolder(filePath));
  return { filePath, width: image.width, height: image.height };
}

/* ------------------------------------------------------------------ 颜色 */

/** 画布背景：.canvas-wrapper 的 --canvas-background（= --background-primary）。 */
function canvasBackground(canvas) {
  if (canvas.wrapperEl) {
    const color = getComputedStyle(canvas.wrapperEl).backgroundColor;
    if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
  }
  const body = getComputedStyle(document.body).backgroundColor;
  return body && body !== 'rgba(0, 0, 0, 0)' ? body : '#ffffff';
}

/** 边颜色：优先取真实 path 的计算描边色（含 --canvas-color 的解析结果）。 */
function edgeColor(edge) {
  const path = edge.lineGroupEl && edge.lineGroupEl.querySelector('.canvas-display-path');
  if (path) {
    const stroke = getComputedStyle(path).stroke;
    if (stroke && stroke !== 'none') return stroke;
  }
  return 'rgb(192, 192, 192)';
}

/* ------------------------------------------------------------------ 绘制 */

function drawEdge(ctx, edge, toImage, scale) {
  const fromBox = edge.from.node.getBBox();
  const toBox = edge.to.node.getBBox();
  const a = sidePoint(fromBox, edge.from.side);
  const b = sidePoint(toBox, edge.to.side);
  if (!a || !b) return;
  const start = offsetPoint(a, edge.from.side, 7);
  const end = offsetPoint(b, edge.to.side, 7);
  const bezier = bezierFor(start, edge.from.side, end, edge.to.side);
  const color = edgeColor(edge);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, 2 * scale);
  const p0 = toImage(start);
  const p1 = toImage(bezier.cp1);
  const p2 = toImage(bezier.cp2);
  const p3 = toImage(end);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  if (edge.from.end !== 'arrow') {
    const point = toImage(a);
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(p0.x, p0.y);
  }
  if (edge.to.end !== 'arrow') {
    const point = toImage(b);
    ctx.moveTo(p3.x, p3.y);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  if (edge.from.end === 'arrow') drawArrow(ctx, toImage(a), edge.from.side, scale);
  if (edge.to.end === 'arrow') drawArrow(ctx, toImage(b), edge.to.side, scale);
}

function drawArrow(ctx, point, side, scale) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate((Number(SIDE_ROTATION[side]) || 0) * Math.PI / 180);
  ctx.beginPath();
  ARROW_POINTS.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * scale, y * scale);
    else ctx.lineTo(x * scale, y * scale);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawNode(ctx, node, toImage, scale) {
  const box = node.getBBox();
  const origin = toImage({ x: box.minX, y: box.minY });
  const width = Math.max(1, (box.maxX - box.minX) * scale);
  const height = Math.max(1, (box.maxY - box.minY) * scale);
  const containerEl = node.containerEl;
  const style = containerEl ? getComputedStyle(containerEl) : null;
  const background = nodeBackground(node, style);
  const radius = style ? parseFloat(style.borderTopLeftRadius) * scale : 0;
  roundRectPath(ctx, origin.x, origin.y, width, height, radius);
  if (background && background !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = background;
    ctx.fill();
  }
  ctx.strokeStyle = style ? style.borderTopColor : 'rgb(192, 192, 192)';
  ctx.lineWidth = style ? Math.max(1, parseFloat(style.borderTopWidth) * scale) : 1;
  ctx.stroke();

  if (node instanceof CanvasGroupNode) {
    // 分组标签画在框外（原版 .canvas-group-label 在框顶上方），不受卡片裁剪
    drawGroupLabel(ctx, node, origin, scale);
    return;
  }
  ctx.save();
  roundRectPath(ctx, origin.x, origin.y, width, height, radius);
  ctx.clip();
  if (node instanceof CanvasFileNode) drawFileCard(ctx, node, origin, width, height, scale);
  else if (node instanceof CanvasLinkNode) {
    drawText(ctx, node.url, origin, width, height, scale, { align: 'center', color: nodeTextColor(node), font: nodeFont(node, scale) });
  } else {
    drawText(ctx, node.text || node.placeholderText, origin, width, height, scale, { color: nodeTextColor(node), font: nodeFont(node, scale) });
  }
  ctx.restore();
}

/** 卡片底色：分组取内容层的色块（.canvas-node-content 的 rgba(var(--canvas-color), 0.07)）。 */
function nodeBackground(node, style) {
  if (node.isGroup && node.contentEl) {
    const tint = getComputedStyle(node.contentEl).backgroundColor;
    if (tint && tint !== 'rgba(0, 0, 0, 0)') return tint;
  }
  return style ? style.backgroundColor : 'rgb(255, 255, 255)';
}

function nodeFont(node, scale) {
  const style = getComputedStyle(styleSource(node));
  const size = parseFloat(style.fontSize) || 16;
  const family = style.fontFamily || 'sans-serif';
  return `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${size * scale}px ${family}`;
}

function nodeTextColor(node) {
  const color = getComputedStyle(styleSource(node)).color;
  return color || 'rgb(0, 0, 0)';
}

/** 取样式来源：优先已挂载的正文（字号/颜色随主题），否则退回始终挂载的 .canvas-node。 */
function styleSource(node) {
  for (const el of [node.previewEl, node.contentEl, node.nodeEl]) {
    if (el && el.isConnected) return el;
  }
  return node.nodeEl;
}

function drawGroupLabel(ctx, node, origin, scale) {
  const label = node.labelEl ? node.labelEl.getText().trim() : (node.label || '');
  if (!label) return;
  const style = getComputedStyle(node.labelEl || node.nodeEl);
  ctx.font = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${(parseFloat(style.fontSize) || 24) * scale}px ${style.fontFamily || 'sans-serif'}`;
  ctx.fillStyle = style.color || 'rgb(128, 128, 128)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, origin.x, origin.y - 4 * scale);
}

/** 文件卡片：左上角文件名 + 居中的图标占位矩形（原版占位 .canvas-icon-placeholder 宽 25%）。 */
function drawFileCard(ctx, node, origin, width, height, scale) {
  const label = node.file ? node.file.basename : (node.filePath || node.placeholderText || '');
  drawText(ctx, label, origin, width, height, scale, { color: nodeTextColor(node), font: nodeFont(node, scale) });
  const iconSize = Math.min(width, height) * 0.25;
  if (iconSize < 8) return;
  const x = origin.x + (width - iconSize) / 2;
  const y = origin.y + (height - iconSize) / 2 + height * 0.1;
  roundRectPath(ctx, x, y, iconSize, iconSize, Math.min(6 * scale, iconSize / 4));
  ctx.save();
  ctx.strokeStyle = nodeTextColor(node);
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.stroke();
  ctx.restore();
}

/** 折行绘制文本；超出卡片高度即被裁剪。 */
function drawText(ctx, text, origin, width, height, scale, opts) {
  const value = String(text === undefined || text === null ? '' : text).trim();
  if (!value) return;
  const padding = CARD_PADDING * scale;
  const maxWidth = Math.max(1, width - padding * 2);
  ctx.font = opts.font;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'top';
  const lineHeight = (parseFloat(ctx.font.match(/([\d.]+)px/)?.[1] || '16')) * 1.4;
  const lines = wrapText(ctx, value, maxWidth);
  if (opts.align === 'center') {
    ctx.textAlign = 'center';
    const total = lines.length * lineHeight;
    lines.forEach((line, index) => {
      ctx.fillText(line, origin.x + width / 2, origin.y + (height - total) / 2 + index * lineHeight);
    });
    return;
  }
  ctx.textAlign = 'left';
  const maxLines = Math.max(1, Math.floor((height - padding * 2) / lineHeight));
  lines.slice(0, maxLines).forEach((line, index) => {
    ctx.fillText(line, origin.x + padding, origin.y + padding + index * lineHeight);
  });
}

/** 按空白折行；单个词超宽时逐字符断开（中日文无空格也成立）。 */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      if (ctx.measureText(line + token).width <= maxWidth) { line += token; continue; }
      if (line) { lines.push(line.trimEnd()); line = ''; }
      let chunk = '';
      for (const char of token) {
        if (chunk && ctx.measureText(chunk + char).width > maxWidth) { lines.push(chunk); chunk = ''; }
        chunk += char;
      }
      line = chunk;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius || 0, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
