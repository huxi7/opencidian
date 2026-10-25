/**
 * [INPUT]: 画布 DOM、导出几何、分配预算、文本几何隐私层；ipcInvoke 调用发送方窗口截图。
 * [OUTPUT]: renderCanvasTiles 返回整窗分块合成 PNG；planCanvasTiles 返回整数分块。
 * [POS]: 画布真实导出器。整张场景随同一世界原点移动，保留正文、背景、连线与网页的合成关系。
 * 每块重叠 2 DIP 后裁边，输出只占一次整数像素，避免接缝和独立卡片缩放误差。
 * 导出期间锁住画布交互；finally 恢复 DOM、视口、选择与正文挂载状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ipcInvoke } from '../core/ipc.js';
import { assertCanvasExportBudget } from './canvas-export-limits.js';
import { prepareCanvasPrivacy } from './canvas-export-privacy.js';

const GUTTER = 2;
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 输出坐标一律为整数，不累计世界坐标的小数误差。 */
export function planCanvasTiles(width, height, tileWidth, tileHeight) {
  if (![width, height, tileWidth, tileHeight].every(n => Number.isInteger(n) && n > 0)) {
    throw new Error('画布导出分块尺寸无效');
  }
  const tiles = [];
  for (let y = 0; y < height; y += tileHeight) {
    for (let x = 0; x < width; x += tileWidth) {
      tiles.push({ x, y, width: Math.min(tileWidth, width - x), height: Math.min(tileHeight, height - y) });
    }
  }
  return tiles;
}

const captureStyles = `
.canvas-wrapper.is-screenshotting .canvas-background,
.canvas-wrapper.is-screenshotting .canvas-menu-container,
.canvas-wrapper.is-screenshotting .canvas-selection,
.canvas-wrapper.is-screenshotting .canvas-node-resizer,
.canvas-wrapper.is-screenshotting .canvas-node-connection-point,
.canvas-wrapper.is-screenshotting .canvas-node-interaction-layer,
.canvas-wrapper.is-screenshotting .canvas-snaps,
.canvas-wrapper.is-screenshotting .cm-cursorLayer,
.canvas-wrapper.is-screenshotting .cm-selectionLayer { visibility:hidden!important; }
.canvas-wrapper.is-screenshotting .canvas-node-container { outline:none!important;box-shadow:none!important; }
.canvas-wrapper.is-text-garbled .canvas-node-content,
.canvas-wrapper.is-text-garbled .canvas-node-content *,
.canvas-wrapper.is-text-garbled .canvas-node-label,
.canvas-wrapper.is-text-garbled .canvas-group-label,
.canvas-wrapper.is-text-garbled .canvas-edge-label { -webkit-text-fill-color:transparent!important;text-shadow:none!important; }
`;

/** 不开辅助窗口。截图失败直接报错，拒绝退回简化重绘冒充成功。 */
export async function renderCanvasTiles(canvas: import('./canvas-view.js').CanvasView, metrics, options: Record<string, any> = {}, decorate) {
  if (canvas.screenshotting) throw new Error('画布正在导出');
  assertCanvasExportBudget(metrics, options);
  const wrapper = canvas.wrapperEl;
  const factor = require('electron').webFrame.getZoomFactor();
  const saved = {
    transform: canvas.canvasEl.style.transform,
    requestFrame: canvas.requestFrame,
    ownRequestFrame: Object.prototype.hasOwnProperty.call(canvas, 'requestFrame'),
    wrapperStyle: wrapper.getAttribute('style'),
    screenshotting: wrapper.classList.contains('is-screenshotting'),
    garbled: wrapper.classList.contains('is-text-garbled'),
    nodes: [...canvas.nodes.values()].map(node => [node, node.isContentMounted, node.nodeEl.style.zIndex]),
  };
  const stylesheet = document.createElement('style');
  stylesheet.textContent = captureStyles;
  const output = document.createElement('canvas');
  output.width = metrics.width;
  output.height = metrics.height;
  const ctx = output.getContext('2d');
  let privacy;
  canvas.screenshotting = true;
  // 不改 x/y/zoom 或选择集合。暂停交互，避免异步截图期间状态被指针覆盖。
  const block = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const blocked = ['pointerdown', 'wheel', 'keydown'];
  try {
    document.head.appendChild(stylesheet);
    wrapper.classList.add('is-screenshotting');
    // 先挂载正文，之后捕获原色和真实文本布局，再隐藏字形。
    blocked.forEach(type => document.addEventListener(type, block, true));
    canvas.cancelFrame();
    canvas.requestFrame = () => {};
    for (const [node] of saved.nodes) {
      node.updateBreakpoint(true);
      node.nodeEl.style.zIndex = String(node.zIndex);
    }
    wrapper.style.setProperty('--zoom-multiplier', String(Math.sqrt(factor / metrics.scale)));
    await document.fonts.ready;
    await nextPaint();
    if (options.privacyMode) {
      privacy = prepareCanvasPrivacy(wrapper);
      wrapper.classList.add('is-text-garbled');
    }
    canvas.cancelFrame();
    const rect = wrapper.getBoundingClientRect();
    const capture = {
      x: Math.ceil(rect.x * factor) + 1,
      y: Math.ceil(rect.y * factor) + 1,
      width: Math.floor(rect.width * factor) - 3,
      height: Math.floor(rect.height * factor) - 3,
    };
    const tiles = planCanvasTiles(metrics.width, metrics.height,
      capture.width - GUTTER * 2, capture.height - GUTTER * 2);
    for (const tile of tiles) {
      const worldX = metrics.box.minX + (tile.x - GUTTER) / metrics.scale;
      const worldY = metrics.box.minY + (tile.y - GUTTER) / metrics.scale;
      const offsetX = capture.x / factor - rect.x;
      const offsetY = capture.y / factor - rect.y;
      canvas.canvasEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${metrics.scale / factor}) translate(${-worldX}px, ${-worldY}px)`;
      await nextPaint();
      // guest webContents 需要一次合成周期，整窗 capturePage 才包含网页表面。
      await pause(100);
      if (!wrapper.isConnected || canvas.leaf.view !== canvas) throw new Error('画布导出视图已关闭');
      const dataURL = await ipcInvoke('canvas-capture-page', capture);
      const image = new Image();
      image.src = dataURL;
      await image.decode();
      const ratioX = image.naturalWidth / capture.width;
      const ratioY = image.naturalHeight / capture.height;
      ctx.drawImage(image, GUTTER * ratioX, GUTTER * ratioY,
        tile.width * ratioX, tile.height * ratioY,
        tile.x, tile.y, tile.width, tile.height);
    }
    if (decorate) decorate(ctx, output.width, output.height);
    return { dataURL: output.toDataURL('image/png'), width: output.width,
      height: output.height, scale: metrics.scale, tiles: tiles.length };
  } finally {
    privacy?.clear();
    output.width = 0; output.height = 0;
    blocked.forEach(type => document.removeEventListener(type, block, true));
    stylesheet.remove();
    wrapper.classList.toggle('is-screenshotting', saved.screenshotting);
    wrapper.classList.toggle('is-text-garbled', saved.garbled);
    if (saved.wrapperStyle === null) wrapper.removeAttribute('style');
    else wrapper.setAttribute('style', saved.wrapperStyle);
    canvas.canvasEl.style.transform = saved.transform;
    for (const [node, mounted, zIndex] of saved.nodes) {
      if (node.destroyed) continue;
      node.updateBreakpoint(mounted);
      node.nodeEl.style.zIndex = zIndex;
    }
    canvas.screenshotting = false;
    if (saved.ownRequestFrame) canvas.requestFrame = saved.requestFrame;
    else delete canvas.requestFrame;
    if (wrapper.isConnected) canvas.markViewportChanged();
    await nextPaint();
  }
}
