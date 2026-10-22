/**
 * [INPUT]: 画布几何与节点；导出弹层、分块截图、内存边界、自绘隐私字形与桌面保存入口。
 * [OUTPUT]: MAX_SIZE、canvasExportMetrics、renderCanvasImage、exportCanvasImage、saveCanvasImage。
 * [POS]: 画布图片导出编排。真实导出走整窗分块截图，保留浏览器渲染的完整场景。
 * renderCanvasImage 保留同步简化预览，供几何与像素单元验收使用，不参与真实落盘。
 * 全画布外扩 100，长边上限 16284；分配前检查内存预算，隐私字形保留文本几何。
 * 保存路径取消时不截图；截图失败不写盘。水印只使用 OpenSidian。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  unionBBox, expandBBox, sidePoint, offsetPoint, bezierFor, SIDE_ROTATION,
} from './canvas-utils.js';
import { CanvasGroupNode } from './canvas-group-node.js';
import { CanvasLinkNode } from './canvas-link-node.js';
import { CanvasFileNode } from './canvas-file-node.js';
import { CanvasExportModal } from './canvas-export-dialog.js';
import { renderCanvasTiles } from './canvas-export-tiles.js';
import { MAX_SIZE, assertCanvasExportBudget, canvasPixelRatio } from './canvas-export-limits.js';
import { drawPrivacyText } from './canvas-export-privacy.js';
export { MAX_SIZE } from './canvas-export-limits.js';
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { IS_MAC } from '../core/keymap.js';

/** 全画布范围的外扩（原版 v3(box, 100)）。 */
const PADDING = 100;
/** 缩放滑杆上限（原版 h 里的 2：最高 2 倍输出）。 */
const MAX_ZOOM = 2;
/** 原版箭头多边形顶点（.canvas-edges polygon.canvas-path-end）。 */
const ARROW_POINTS = [[0, 0], [6.5, 10.4], [-6.5, 10.4]];
/** 卡片内边距，对齐卡片编辑器 .cm-scroller 的 --size-4-4。 */
const CARD_PADDING = 16;

/**
 * 导出几何：范围框、输出倍率与像素尺寸。renderCanvasImage 与导出弹窗共用（弹窗用它算「预计图像尺寸」）。
 * @param {CanvasView} canvas
 * @param {{frame?:'full'|'viewport', box?:object, scale?:number, padding?:number, maxSize?:number}} [opts]
 */
export function canvasExportMetrics(canvas, opts = {}) {
  const maxSize = Math.min(opts.maxSize || MAX_SIZE, MAX_SIZE);
  if (!Number.isFinite(maxSize) || maxSize <= 0) throw Error('画布导出长边尺寸无效');
  const box = exportBBox(canvas, opts);
  const worldWidth = Math.max(box.maxX - box.minX, 1);
  const worldHeight = Math.max(box.maxY - box.minY, 1);
  const density = opts.pixelRatio ?? canvasPixelRatio(canvas.wrapperEl?.ownerDocument.defaultView.devicePixelRatio || 1, require('electron').webFrame.getZoomFactor());
  if (!Number.isFinite(density) || density <= 0) throw Error('画布导出像素密度无效');
  // 视口范围是「所见即所得」：倍率跟随画布缩放；全画布按世界坐标 1:1 起步
  const multiplier = opts.frame === 'viewport' ? canvas.scale : (opts.scale ?? 1);
  if (![box.minX, box.minY, box.maxX, box.maxY, multiplier].every(Number.isFinite) || multiplier <= 0) throw Error('画布导出范围或缩放无效');
  const scale = Math.min(multiplier * density, maxSize / worldWidth, maxSize / worldHeight);
  return {
    box,
    worldWidth,
    worldHeight,
    maxSize,
    pixelRatio: density,
    maxZoom: Math.min(MAX_ZOOM, maxSize / density / worldWidth, maxSize / density / worldHeight),
    scale,
    width: Math.max(1, Math.min(maxSize, Math.ceil(worldWidth * scale))),
    height: Math.max(1, Math.min(maxSize, Math.ceil(worldHeight * scale))),
  };
}

/** 导出范围：显式 box 优先；viewport 取当前视口世界坐标；full 取全部节点包围盒外扩 padding。 */
function exportBBox(canvas, opts) {
  if (opts.box) return opts.box;
  if (opts.frame === 'viewport') return canvas.getViewportBBox();
  const padding = opts.padding === undefined ? PADDING : opts.padding;
  const nodes = Array.from(canvas.nodes.values());
  return expandBBox(unionBBox(nodes.map((node) => node.getBBox())), padding);
}

/**
 * 把画布画成 PNG，范围与选项见 opts：边 + 全部节点 + 可选水印。
 * @param {CanvasView} canvas
 * @param {{frame?:string, scale?:number, maxSize?:number, padding?:number, box?:object, showLogo?:boolean, privacyMode?:boolean, images?:Map, linkImages?:Map}} [opts]
 * @returns {{dataURL:string, width:number, height:number, scale:number}|null} 空画布返回 null
 */
export function renderCanvasImage(canvas, opts = {}) {
  if (!canvas.nodes.size) return null;
  const metrics = canvasExportMetrics(canvas, opts);
  assertCanvasExportBudget(metrics, opts);
  const { box, scale, width, height } = metrics;
  const privacyMode = !!opts.privacyMode;
  const showLogo = !!opts.showLogo && opts.frame !== 'viewport';

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
  const ordered = Array.from(canvas.nodes.values()).sort((a, b) => a.zIndex - b.zIndex);
  for (const node of ordered) drawNode(ctx, node, toImage, scale, { privacyMode, images: opts.images, linkImages: opts.linkImages });
  if (showLogo) drawLogo(ctx, width, height);
  return { dataURL: canvasEl.toDataURL('image/png'), width, height, scale };
}

/**
 * 命令 canvas:export-as-image 与画布面板菜单的入口（原版 generateHDImage）。
 * options 传入时跳过设置弹窗直接落盘（命令与菜单都不传）。
 * @param {CanvasView} canvas
 * @returns {Promise<{filePath:string,width:number,height:number}|null>} 取消或空画布返回 null
 */
export async function exportCanvasImage(canvas, options) {
  if (!canvas.nodes.size) {
    new Notice(t('plugins.canvas.msg-export-failed-empty-canvas'));
    return null;
  }
  const opts = options || await promptCanvasExportOptions(canvas);
  if (!opts) return null;
  return saveCanvasImage(canvas, opts);
}

/** 设置弹窗（原版 generateHDImage 第一步）：范围/缩放/显示水印/隐私模式；取消（关闭）返回 null。 */
function promptCanvasExportOptions(canvas) {
  return new Promise((resolve) => {
    const metrics = canvasExportMetrics(canvas);
    const modal = new CanvasExportModal(canvas, {
      worldWidth: metrics.worldWidth,
      worldHeight: metrics.worldHeight,
      maxSize: metrics.maxSize,
      maxZoom: metrics.maxZoom,
      dimensionsFor: (multiplier) => canvasExportMetrics(canvas, { scale: multiplier }),
      onSave: (options) => resolve(options),
    });
    modal.onClose = () => resolve(null);
    modal.open();
  });
}

/** 确认后的落盘链路：保存对话框 → 整窗分块截图 → 写 PNG → 通知。 */
export async function saveCanvasImage(canvas, options) {
  if (!canvas.nodes.size) {
    new Notice(t('plugins.canvas.msg-export-failed-empty-canvas'));
    return null;
  }
  const name = canvas.file ? canvas.file.basename : 'Canvas';
  const result = canvas.promptImageSavePath(name + '.png');
  const filePath = result && !result.canceled && result.filePath ? result.filePath : null;
  if (!filePath) return null;
  const opts = options || {};
  const decorate = opts.showLogo && opts.frame !== 'viewport' ? drawLogo : undefined;
  let image;
  try {
    image = await renderCanvasTiles(canvas, canvasExportMetrics(canvas, opts), opts, decorate);
  } catch (error) {
    new Notice('图片导出失败：' + error.message);
    throw error;
  }
  const base64 = image.dataURL.slice(image.dataURL.indexOf(',') + 1);
  require('fs').writeFileSync(filePath, Buffer.from(base64, 'base64'));
  const notice = new Notice(filePath, 10000);
  notice.addButton(IS_MAC
    ? t('plugins.open-with-default-app.action-show-in-folder-mac')
    : t('plugins.open-with-default-app.action-show-in-folder'), () => Desktop.showItemInFolder(filePath));
  return { filePath, width: image.width, height: image.height, tiles: image.tiles };
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

function drawNode(ctx, node, toImage, scale, opts) {
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
  if (node instanceof CanvasGroupNode && opts.images && node.bgPath) {
    const image = opts.images.get(node);
    if (image) drawGroupBackground(ctx, node, image, origin, width, height, scale, radius);
  }
  // 链接卡网页画面：截图来源是 webview 自身，按卡片矩形铺满；边框仍画在它上面。
  const linkImage = !opts.privacyMode && node instanceof CanvasLinkNode && opts.linkImages ? opts.linkImages.get(node) : null;
  if (linkImage) {
    ctx.save();
    roundRectPath(ctx, origin.x, origin.y, width, height, radius);
    ctx.clip();
    ctx.drawImage(linkImage, origin.x, origin.y, width, height);
    ctx.restore();
  }
  ctx.strokeStyle = style ? style.borderTopColor : 'rgb(192, 192, 192)';
  ctx.lineWidth = style ? Math.max(1, parseFloat(style.borderTopWidth) * scale) : 1;
  ctx.stroke();

  if (node instanceof CanvasGroupNode) {
    // 分组标签画在框外（原版 .canvas-group-label 在框顶上方），不受卡片裁剪
    if (opts.privacyMode) drawPrivacyLabelBar(ctx, node, origin, width, scale);
    else drawGroupLabel(ctx, node, origin, scale);
    return;
  }
  ctx.save();
  roundRectPath(ctx, origin.x, origin.y, width, height, radius);
  ctx.clip();
  if (opts.privacyMode) {
    // 隐私模式：正文位置画灰条占位（原版用 is-text-garbled 让文字不可读）
    drawPrivacyBars(ctx, node, origin, width, height, scale);
  } else if (node instanceof CanvasFileNode) {
    drawFileCard(ctx, node, origin, width, height, scale);
  } else if (node instanceof CanvasLinkNode) {
    if (!linkImage) drawText(ctx, node.url, origin, width, height, scale, { align: 'center', color: nodeTextColor(node), font: nodeFont(node, scale) });
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

/**
 * 分组背景图：cover 居中裁切，repeat 以图片固有像素平铺（随导出倍率放大）。
 * 绘制范围限制在圆角框内，边框与标签仍在图片之上。
 */
function drawGroupBackground(ctx, node, image, origin, width, height, scale, radius) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  ctx.save();
  roundRectPath(ctx, origin.x, origin.y, width, height, radius);
  ctx.clip();
  if (node.bgStyle === 'repeat') {
    const pattern = ctx.createPattern(image, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.translate(origin.x, origin.y);
      ctx.scale(scale, scale);
      ctx.fillRect(0, 0, width / scale, height / scale);
    }
  } else {
    const boxRatio = width / height;
    const imageRatio = iw / ih;
    let sx = 0; let sy = 0; let sw = iw; let sh = ih;
    if (imageRatio > boxRatio) {
      sw = ih * boxRatio;
      sx = (iw - sw) / 2;
    } else {
      sh = iw / boxRatio;
      sy = (ih - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, origin.x, origin.y, width, height);
  }
  ctx.restore();
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

/** 同步预览用实际文字的前进量生成圆角字形；真实导出直接量取 DOM Range。 */
function drawPrivacyBars(ctx, node, origin, width, height, scale) {
  const text = node.text || node.url || node.file?.basename || node.filePath || node.placeholderText || '';
  ctx.font = nodeFont(node, scale);
  ctx.fillStyle = nodeTextColor(node);
  const size = parseFloat(ctx.font.match(/([\d.]+)px/)?.[1] || '16');
  drawPrivacyText(ctx, text, origin.x + CARD_PADDING * scale, origin.y + CARD_PADDING * scale,
    width - CARD_PADDING * scale * 2, size * 1.4);
}
function drawPrivacyLabelBar(ctx, node, origin, width, scale) {
  const label = node.labelEl?.textContent || node.label || '';
  const style = getComputedStyle(node.labelEl || node.nodeEl);
  const size = (parseFloat(style.fontSize) || 24) * scale;
  ctx.font = `${style.fontWeight || '400'} ${size}px ${style.fontFamily || 'sans-serif'}`;
  ctx.fillStyle = style.color;
  drawPrivacyText(ctx, label, origin.x, origin.y - size * 1.4 - 4 * scale, width, size * 1.4);
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

/**
 * 左下角水印（原版 canvas-watermark 的 Obsidian logo）：本复刻画应用菱形标记 + 「OpenSidian」文字，
 * 尺寸随输出等比（原版按画布坐标固定 80px 内缩；一次性离屏绘制用输出比例代替分块缩放）。
 */
function drawLogo(ctx, width, height) {
  const unit = Math.min(width, height);
  const size = Math.max(10, Math.round(unit * 0.022));
  const inset = Math.max(10, Math.round(unit * 0.028));
  const diamond = size * 0.85;
  const x = inset;
  const y = height - inset;
  ctx.save();
  ctx.fillStyle = logoColor();
  ctx.beginPath();
  ctx.moveTo(x + diamond / 2, y - diamond);
  ctx.lineTo(x + diamond, y - diamond / 2);
  ctx.lineTo(x + diamond / 2, y);
  ctx.lineTo(x, y - diamond / 2);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${size}px ${logoFontFamily()}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('OpenSidian', x + diamond + size * 0.45, y);
  ctx.restore();
}

/** 水印色：次级文字色（--text-faint），取不到则半透明灰。 */
function logoColor() {
  const tokens = getComputedStyle(document.body);
  const faint = tokens.getPropertyValue('--text-faint').trim();
  if (faint) return faint;
  const muted = tokens.getPropertyValue('--text-muted').trim();
  return muted || 'rgba(128, 128, 128, 0.7)';
}

function logoFontFamily() {
  return getComputedStyle(document.body).fontFamily || 'sans-serif';
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
  ctx.arcTo(x, y + r, x + r, y, r);
  ctx.closePath();
}
