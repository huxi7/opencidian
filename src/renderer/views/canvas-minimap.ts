/**
 * [INPUT]: canvas-data.js 校验 JSON；依赖 ./canvas-utils.js 的 sidePoint、bezierFor、unionBBox、expandBBox、applyCanvasColor；依赖 core/dom.js 的 createEl/createDiv/createSpan；依赖 core/icons.js 的 createIcon。
 * [OUTPUT]: 导出 CanvasEmbedOptions/CanvasEmbedMarker 与 renderCanvasMinimap(containerEl, text)、createCanvasEmbed(app, file, options)、mountCanvasEmbed(app, root, embed)。
 * [POS]: views/ 的画布缩略图与「画布嵌入」渲染层（原版 app.js 的 lte 与 cte）。
 *        renderCanvasMinimap 把 .canvas 文件的 JSON 画成缩略图 SVG（.canvas-minimap），画布里的 .canvas 文件卡用它。
 *        原版画布插件把 .canvas 注册进 embedRegistry（app.js 3428689 的 cte），笔记里的 ![[白板.canvas]] 因此走「画布嵌入」而不是通用附件嵌块：
 *        容器挂 .canvas-embed（再加 .inline-embed），标题行是 .embed-title > .file-embed-icon(lucide-layout-dashboard) + 文件名，
 *        正文是 <svg class="canvas-minimap">——分组与卡片画成 rx/ry=20 的圆角矩形（先分组后卡片），边画贝塞尔路径（线宽按内容宽度开方），视图盒取内容并集外扩 5%。
 *        createCanvasEmbed 造这个容器（阅读视图用 span，实时预览用 div，与原版两处一致），mountCanvasEmbed 负责阅读视图的异步填充。
 *        白板 JSON 解析失败或没有节点时只留标题，不画缩略图（原版 lte 直接 return）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas minimap + canvas embed — original lte / cte. */
import { parseCanvasData } from './canvas-data.js';
import type { CanvasBBox } from './canvas-utils.js';
import type { CanvasData } from './canvas-types.js';

import { sidePoint, bezierFor, unionBBox, expandBBox, applyCanvasColor } from './canvas-utils.js';
import { createDiv, createEl, createSpan } from '../core/dom.js';
import { createIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { TFile } from '../core/vault.js';

export interface CanvasEmbedOptions { tag?: 'span' | 'div'; linktext?: string; href?: string; sourcePath?: string; tabindex?: boolean; text?: string; }
export interface CanvasEmbedMarker { id: string | number; path: string; linktext?: string; sourcePath?: string; }

/** 原版 h2 的降级文案：目标不存在时的「未创建，点击以创建。」 */
export function missingCanvasNote(linktext: string) {
  return tt('plugins.page-preview.label-empty-note', '“{{linktext}}” 未创建，点击以创建。', { linktext });
}

export function renderCanvasMinimap(containerEl: HTMLElement, text: string) {
  let data: CanvasData;
  try { data = parseCanvasData(text); } catch (e) { return null; }
  const nodes = (data.nodes || []).map((node) => ({ ...node, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 100, height: node.height ?? 100 }));
  const edges = data.edges || [];
  if (!nodes.length) return null;
  const svg = containerEl.createSvg('svg', { cls: 'canvas-minimap' });
  const boxes = new Map<string | undefined, CanvasBBox>();
  for (const node of nodes) {
    boxes.set(node.id, { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height });
  }
  // 原版 p()：节点画成圆角矩形；着色节点按 z9 挂 is-themed 与画布色。
  const drawNode = (node: (typeof nodes)[number]) => {
    const rect = svg.createSvg('rect', {
      attr: { x: node.x, y: node.y, width: node.width, height: node.height, rx: '20', ry: '20' },
    });
    applyCanvasColor(rect, node.color || '');
  };
  for (const node of nodes) if (node.type === 'group') drawNode(node);
  const union = unionBBox(Array.from(boxes.values()));
  const strokeWidth = Math.sqrt((union.maxX - union.minX) / 10);
  for (const edge of edges) {
    const from = boxes.get(edge.fromNode);
    const to = boxes.get(edge.toNode);
    if (!from || !to) continue;
    const a = sidePoint(from, edge.fromSide || 'right');
    const b = sidePoint(to, edge.toSide || 'left');
    if (!a || !b) continue;
    const path = svg.createSvg('path', { attr: { d: bezierFor(a, edge.fromSide || 'right', b, edge.toSide || 'left').path } });
    path.style.strokeWidth = String(strokeWidth);
    applyCanvasColor(path, edge.color || '');
  }
  for (const node of nodes) if (node.type !== 'group') drawNode(node);
  const pad = Math.max(union.maxX - union.minX, union.maxY - union.minY) / 20;
  const box = expandBBox(union, pad);
  svg.setAttr('viewBox', `${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`);
  containerEl.appendChild(svg);
  return svg;
}

/**
 * 原版 cte 的容器：.internal-embed.canvas-embed.inline-embed.is-loaded。
 * 阅读视图的容器是 markdown-it 产出的 span（原版 iembed 规则），实时预览的容器是 CM6 widget 的 div（原版 r8）。
 * options: { tag, linktext, href, sourcePath, tabindex, text }
 * text 给了就画缩略图；不给（异步还没读到）就只留标题，原版空白板/坏 JSON 也是这个形态。
 */
export function createCanvasEmbed(app: App, file: TFile, options: CanvasEmbedOptions = {}) {
  const linktext = options.linktext || file.basename;
  const el = createEl(options.tag || 'span', { cls: 'internal-embed canvas-embed inline-embed is-loaded' });
  el.setAttr('src', linktext);
  el.setAttr('alt', linktext);
  if (options.href) el.setAttr('data-href', options.href);
  if (options.tabindex) el.setAttr('tabindex', '-1');
  const title = createDiv({ cls: 'embed-title' });
  const icon = createSpan({ cls: 'file-embed-icon' });
  icon.appendChild(createIcon('layout-dashboard'));
  title.appendChild(icon);
  title.appendText(' ' + file.basename);
  el.appendChild(title);
  if (options.text !== undefined) renderCanvasMinimap(el, options.text);
  // 原版 cte 的容器 click：getLeaf(isModEvent(e)) → openLinkText(linktext, sourcePath)
  el.addEventListener('click', (e) => {
    e.preventDefault();
    app.workspace.openLinkText(linktext, options.sourcePath || '', (e instanceof MouseEvent && (e.metaKey || e.ctrlKey)) ? 'tab' : false);
  });
  return el;
}

/** 阅读视图：把占位标记换成画布嵌入，并补上缩略图（读文件失败时只留标题）。 */
export async function mountCanvasEmbed(app: App, root: HTMLElement | null, embed: CanvasEmbedMarker) {
  const marker = root?.querySelector(`[data-canvas-embed="${embed.id}"]`);
  const file = app.vault.getFileByPath(embed.path);
  if (!marker || !file) return null;
  let text = '';
  try { text = await app.vault.cachedRead(file); } catch (e) { text = ''; }
  const el = createCanvasEmbed(app, file, {
    linktext: embed.linktext, href: embed.path, sourcePath: embed.sourcePath, text,
  });
  marker.replaceWith(el);
  return el;
}

/** 实时预览用的画布嵌入 widget：先出标题，读到白板 JSON 后再补缩略图。 */
export function createCanvasEmbedWidget(app: App, file: TFile, options: CanvasEmbedOptions = {}, onReady?: () => void) {
  const el = createCanvasEmbed(app, file, options);
  app.vault.read(file).then((text) => {
    renderCanvasMinimap(el, text);
    if (onReady) onReady();
  }).catch(() => {});
  return el;
}
