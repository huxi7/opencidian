/**
 * [INPUT]: 依赖 ../core/vault.js 的 TFolder；依赖 ../editor/attachments.js 的 saveAttachment；
 *          调用 canvas.posFromEvt/createFileNode/createLinkNode/createTextNode/requestSave。
 * [OUTPUT]: 导出 installCanvasDrop(canvas)、handleCanvasDragOver/CanvasDrop，以及 createFileNodes(canvas, files, pos)。
 * [POS]: views/ 画布拖入层（原版 CanvasView 构造里的 app.dragManager.handleDrop）。
 *        内部文件树拖拽载荷是 text/plain JSON（{path,type} 或 {type:'files',items}），支持 file/folder/files；
 *        外部 Files 经 saveAttachment 写入附件目录后建文件卡；text/uri-list 与纯文本 URL 建链接卡；其余文本建文本卡。
 *        多文件按原版 createFileNodes 排 10 列，列间 45px。只读画布不接收任何 drop。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas drop target — file/folder/url/text drops from explorer or OS. */
import type { CanvasNode } from './canvas-node.js';
import type { CanvasPoint } from './canvas-utils.js';
import { TFile, TFolder } from '../core/vault.js';
import { saveAttachment } from '../editor/attachments.js';
import { CanvasFileNode } from './canvas-file-node.js';

const GRID_COLUMNS = 10;
const GRID_GAP = 45;

/** 原版 createFileNodes：10 列排布，列间 45px；建完取消旧选择并选中新卡。 */
export function createFileNodes(canvas: import('./canvas-view.js').CanvasView, files: TFile[], pos: CanvasPoint) {
  if (!files.length) return [];
  const size = canvas.config.defaultFileNodeDimensions;
  const created: CanvasFileNode[] = [];
  files.forEach((file, index: number) => {
    const x = pos.x + (index % GRID_COLUMNS) * (size.width + GRID_GAP);
    const y = pos.y + Math.floor(index / GRID_COLUMNS) * (size.height + GRID_GAP);
    created.push(canvas.createFileNode({
      pos: { x, y }, size, position: 'top-left', file, save: false, focus: false,
    }));
  });
  canvas.deselectAll();
  created.forEach((node: CanvasNode) => canvas.select(node));
  canvas.requestSave();
  return created;
}

/** 收集内部载荷里的文件；文件夹递归取全部文件。 */
function collectFiles(canvas: import('./canvas-view.js').CanvasView, item: { path: string }, out: TFile[]) {
  if (!item || !item.path) return;
  const target = canvas.app.vault.getAbstractFileByPath(item.path);
  if (target instanceof TFolder) {
    for (const child of target.children || []) collectFiles(canvas, { path: child.path }, out);
  } else if (target) {
    out.push(target);
  }
}

function filesFromPayload(canvas: import('./canvas-view.js').CanvasView, payload: { type: string; path: string; items?: Array<{ path: string }> }) {
  const out: TFile[] = [];
  const seen = new Set();
  const push = (item: { path: string }) => {
    const before = out.length;
    collectFiles(canvas, item, out);
    for (let i = before; i < out.length; i++) {
      if (seen.has(out[i].path)) out.splice(i--, 1);
      else seen.add(out[i].path);
    }
  };
  if (payload.type === 'files' && Array.isArray(payload.items)) payload.items.forEach(push);
  else if (payload.type === 'folder' || payload.type === 'file') push(payload);
  out.sort((a, b) => a.basename.localeCompare(b.basename));
  return out;
}

function internalPayload(data: DataTransfer) {
  const raw = data && data.getData ? data.getData('text/plain') : '';
  if (!raw || raw[0] !== '{') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('path' in value) || typeof value.path !== 'string' || !('type' in value)) return null;
    if (value.type !== 'file' && value.type !== 'folder' && value.type !== 'files') return null;
    const items = 'items' in value && Array.isArray(value.items)
      ? value.items.filter((item): item is { path: string } => typeof item === 'object' && item !== null && 'path' in item && typeof item.path === 'string') : undefined;
    return { type: value.type, path: value.path, items };
  } catch (e) { /* 普通文本，不当作内部载荷 */ }
  return null;
}

function firstUrl(data: DataTransfer) {
  const uri = data && data.getData ? data.getData('text/uri-list') : '';
  if (uri) {
    const line = uri.split(/\r?\n/).find((s: string) => s && s[0] !== '#');
    if (line) return line.trim();
  }
  const text = (data && data.getData ? data.getData('text/plain') : '').trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : '';
}

export function handleCanvasDragOver(canvas: import('./canvas-view.js').CanvasView, event: DragEvent) {
  if (canvas.readonly) return;
  const types = event.dataTransfer ? Array.from(event.dataTransfer.types || []) : [];
  if (!types.includes('Files') && !types.includes('text/plain') && !types.includes('text/uri-list')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

/** drop：外部文件优先，其次内部文件树载荷，再次 URL，最后纯文本。 */
export async function handleCanvasDrop(canvas: import('./canvas-view.js').CanvasView, event: DragEvent) {
  if (canvas.readonly) return;
  const data = event.dataTransfer;
  if (!data) return;
  const pos = canvas.posFromEvt(event);
  const external = data.files ? Array.from<File>(data.files) : [];
  if (external.length) {
    event.preventDefault();
    const files = [];
    for (const blob of external) {
      const dot = blob.name.lastIndexOf('.');
      const name = dot > 0 ? blob.name.slice(0, dot) : blob.name;
      const ext = dot > 0 ? blob.name.slice(dot + 1) : '';
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const file = await saveAttachment(canvas.app, name, ext, bytes, canvas.file ? canvas.file.path : '');
        if (file) files.push(file);
      } catch (e) { /* 单个文件失败不阻断其余 */ }
    }
    if (files.length) createFileNodes(canvas, files, pos);
    return;
  }
  const payload = internalPayload(data);
  if (payload) {
    event.preventDefault();
    const files = filesFromPayload(canvas, payload);
    createFileNodes(canvas, files, pos);
    return;
  }
  const url = firstUrl(data);
  if (url) {
    event.preventDefault();
    canvas.createLinkNode({ pos, position: 'center', url });
    canvas.requestSave();
    return;
  }
  const text = (data.getData('text/plain') || '').trim();
  if (text) {
    event.preventDefault();
    canvas.createTextNode({ pos, position: 'center', text });
    canvas.requestSave();
  }
}

/** 安装 dragover/drop 监听；只安装一次。 */
export function installCanvasDrop(canvas: import('./canvas-view.js').CanvasView) {
  if (canvas._dropInstalled || !canvas.wrapperEl) return;
  canvas._dropInstalled = true;
  canvas.wrapperEl.addEventListener('dragover', (event) => handleCanvasDragOver(canvas, event));
  canvas.wrapperEl.addEventListener('drop', (event) => handleCanvasDrop(canvas, event));
}
