/**
 * [INPUT]: canvas-data.js 校验剪贴板 JSON；依赖 ./canvas-node.js 的 CanvasNode；依赖 ./canvas-edge.js 的 CanvasEdge；
 *          依赖 ./canvas-utils.js 的 bboxOf/unionBBox/genId；调用 canvas.importData/createLinkNode/createTextNode/deleteSelection。
 * [OUTPUT]: 导出 CANVAS_MIME、getSelectionData(canvas)、cloneData(data, offset)、handleCanvasCopy/Cut/Paste(canvas, event)。
 * [POS]: views/ 画布剪贴板层（原版 CanvasView.handleCopy/handleCut/handlePaste）。
 *        copy 写入 MIME obsidian/canvas，payload 为 {nodes,edges,center}；center 是选中并集包围盒中心。
 *        cut 先 copy 再删选中节点/边；paste 按指针中心与 payload center 的差偏移，克隆新 id 后 importData(prune=false) 并选中。
 *        纯文本 URL 建链接卡，其余非空文本建文本卡；外部剪贴板文件写入附件目录后按 10 列建文件卡。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas clipboard — original obsidian/canvas copy/cut/paste semantics. */
import { parseCanvasData } from './canvas-data.js';
import type { CanvasData } from './canvas-types.js';
import { CanvasNode } from './canvas-node.js';
import { CanvasEdge } from './canvas-edge.js';
import { createFileNodes } from './canvas-drop.js';
import { bboxOf, unionBBox, genId } from './canvas-utils.js';
import { saveAttachment } from '../editor/attachments.js';

export const CANVAS_MIME = 'obsidian/canvas';

/** 原版 getSelectionData：节点按 z 排序，边只收两端都选中的，center 为并集中心。 */
export function getSelectionData(canvas: import('./canvas-view.js').CanvasView, selection = canvas.selection) {
  const items = Array.from(selection);
  const nodes = items
    .filter((el) => el instanceof CanvasNode)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((node: CanvasNode) => node.getData());
  const edgeSet = new Set<import('./canvas-edge.js').CanvasEdge>();
  for (const el of items) {
    if (!(el instanceof CanvasNode)) continue;
    for (const edge of canvas.getEdgesForNode(el)) {
      if (selection.has(edge.from.node) && selection.has(edge.to.node)) edgeSet.add(edge);
    }
  }
  const edges = Array.from(edgeSet).map((edge: CanvasEdge) => edge.getData());
  let center = { x: 0, y: 0 };
  if (items.some((el) => el instanceof CanvasNode)) {
    const box = unionBBox(items.filter((el) => el instanceof CanvasNode).map((node: CanvasNode) => bboxOf(node)));
    center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }
  return { nodes, edges, center };
}

/**
 * 原版 cloneData：深拷贝 payload，节点与边换新 id，边端点指向克隆节点，可选整体偏移。
 * 不修改入参，避免连续粘贴复用同一份对象。
 */
export function cloneData(data: CanvasData, offset: { x: number; y: number; }|null) {
  const clone = parseCanvasData(JSON.stringify(data));
  const idMap = new Map();
  for (const node of clone.nodes || []) {
    const oldId = node.id;
    const newId = genId();
    node.id = newId;
    idMap.set(oldId, newId);
    if (offset) { node.x = (node.x || 0) + offset.x; node.y = (node.y || 0) + offset.y; }
  }
  for (const edge of clone.edges || []) {
    edge.fromNode = idMap.get(edge.fromNode) || '';
    edge.toNode = idMap.get(edge.toNode) || '';
    edge.id = genId();
  }
  return clone;
}

/** 原版 handleCopy：焦点在画布 wrapper 且有选中内容时写 obsidian/canvas。 */
export function handleCanvasCopy(canvas: import('./canvas-view.js').CanvasView, event: ClipboardEvent) {
  if (document.activeElement !== canvas.wrapperEl) return;
  if (!canvas.selection.size || !event.clipboardData) return;
  event.preventDefault();
  event.clipboardData.setData(CANVAS_MIME, JSON.stringify(getSelectionData(canvas)));
}

/** 原版 handleCut：先 copy，再删除选中节点/边。 */
export function handleCanvasCut(canvas: import('./canvas-view.js').CanvasView, event: ClipboardEvent) {
  if (canvas.readonly || document.activeElement !== canvas.wrapperEl) return;
  if (!canvas.selection.size || !event.clipboardData) return;
  handleCanvasCopy(canvas, event);
  canvas.deleteSelection();
}

/** 原版 handlePaste：外部文件 → 自定义画布数据 → URL 链接卡 → 文本卡。 */
export function handleCanvasPaste(canvas: import('./canvas-view.js').CanvasView, event: ClipboardEvent) {
  if (event.defaultPrevented || canvas.readonly || document.activeElement !== canvas.wrapperEl) return;
  event.preventDefault();
  const data = event.clipboardData;
  if (!data) return;
  const pos = canvas.posCenter();
  const files = data.files ? Array.from(data.files) : [];
  if (files.length) {
    importClipboardFiles(canvas, files, pos);
    return;
  }
  const raw = data.getData(CANVAS_MIME);
  if (raw) {
    let payload: CanvasData;
    try { payload = parseCanvasData(raw); } catch (e) { return; }
    if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) return;
    if (!payload.nodes.length) return;
    const center = payload.center;
    const offset = center ? { x: pos.x - center.x, y: pos.y - center.y } : null;
    const imported = canvas.importData(cloneData(payload, offset), false);
    canvas.deselectAll();
    imported.forEach((node: CanvasNode) => canvas.select(node));
    canvas.requestSave();
    return;
  }
  const text = (data.getData('text/plain') || '').trim();
  if (!text) return;
  if (/^https?:\/\/\S+$/i.test(text)) {
    canvas.createLinkNode({ pos, position: 'center', url: text });
  } else {
    canvas.createTextNode({ pos, position: 'center', text });
  }
  canvas.requestSave();
}

/** 外部剪贴板文件：写入附件目录后按 10 列排布建文件卡（原版 handlePaste 的 importAttachments 分支）。 */
async function importClipboardFiles(canvas: import('./canvas-view.js').CanvasView, blobs: File[], pos: { x: number; y: number; }) {
  const imported = [];
  for (const blob of blobs) {
    const dot = blob.name.lastIndexOf('.');
    const name = dot > 0 ? blob.name.slice(0, dot) : blob.name;
    const ext = dot > 0 ? blob.name.slice(dot + 1) : '';
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const file = await saveAttachment(canvas.app, name, ext, bytes, canvas.file ? canvas.file.path : '');
      if (file) imported.push(file);
    } catch (e) { /* 单个文件失败不阻断其余 */ }
  }
  if (imported.length) createFileNodes(canvas, imported, pos);
}
