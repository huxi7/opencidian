/**
 * [INPUT]: CanvasView 节点容器、默认尺寸与四种节点实现。
 * [OUTPUT]: 导出文本、文件、链接、分组节点的创建函数。
 * [POS]: 画布节点工厂。保持几何、保存与聚焦顺序。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CanvasNodeOptions } from './canvas-types.js';
import { CanvasTextNode } from './canvas-text-node.js';
import { CanvasFileNode } from './canvas-file-node.js';
import { CanvasLinkNode } from './canvas-link-node.js';
import { CanvasGroupNode } from './canvas-group-node.js';
import { rectFromPos } from './canvas-utils.js';
import { t } from '../core/i18n.js';

export function createTextNode(canvas: import('./canvas-view.js').CanvasView, opts: CanvasNodeOptions = {}) {
  const size = opts.size || canvas.config.defaultTextNodeDimensions;
  const node = new CanvasTextNode(canvas);
  node.moveAndResize(rectFromPos(opts.pos || canvas.posCenter(), size, opts.position));
  if (opts.text) node.setText(opts.text);
  canvas.addNode(node);
  if (opts.save !== false) canvas.requestSave();
  if (opts.focus !== false) { canvas.selectOnly(node); node.startEditing(); }
  return node;
}

export function createFileNode(canvas: import('./canvas-view.js').CanvasView, opts: CanvasNodeOptions = {}) {
  const size = opts.size || canvas.config.defaultFileNodeDimensions;
  const node = new CanvasFileNode(canvas);
  node.moveAndResize(rectFromPos(opts.pos || canvas.posCenter(), size, opts.position));
  if (opts.file) node.setFile(opts.file, opts.subpath);
  canvas.addNode(node);
  if (opts.save !== false) canvas.requestSave();
  if (opts.focus !== false) canvas.selectOnly(node);
  return node;
}

export function createLinkNode(canvas: import('./canvas-view.js').CanvasView, opts: CanvasNodeOptions = {}) {
  const size = opts.size || canvas.config.defaultFileNodeDimensions;
  const node = new CanvasLinkNode(canvas);
  node.moveAndResize(rectFromPos(opts.pos || canvas.posCenter(), size, opts.position));
  if (opts.url) node.setUrl(opts.url);
  canvas.addNode(node);
  if (opts.save !== false) canvas.requestSave();
  if (opts.focus !== false) canvas.selectOnly(node);
  return node;
}

export function createGroupNode(canvas: import('./canvas-view.js').CanvasView, opts: CanvasNodeOptions = {}) {
  const size = opts.size || canvas.config.defaultFileNodeDimensions;
  const node = new CanvasGroupNode(canvas);
  node.moveAndResize(rectFromPos(opts.pos || canvas.posCenter(), size, opts.position));
  node.setLabel(opts.label || t('plugins.canvas.label-untitled-group'));
  canvas.addNode(node);
  if (opts.save !== false) canvas.requestSave();
  if (opts.focus !== false) { canvas.selectOnly(node); node.focusLabel(); }
  return node;
}
