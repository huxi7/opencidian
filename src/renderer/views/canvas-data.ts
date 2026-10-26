/**
 * [INPUT]: 文件、剪贴板和缩略图传入的 JSON 文本。
 * [OUTPUT]: 导出 parseCanvasData，将外部数据收敛为 CanvasData。
 * [POS]: 画布读取边界。保留扩展字段，拒绝错类型与非有限几何。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CanvasData, CanvasNodeData, CanvasEdgeData } from './canvas-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalStrings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function isNode(value: unknown): value is CanvasNodeData {
  return isRecord(value)
    && optionalStrings(value, ['id', 'type', 'color', 'text', 'file', 'subpath', 'url', 'label', 'background', 'backgroundStyle'])
    && ['x', 'y', 'width', 'height'].every((key) => value[key] === undefined
      || (typeof value[key] === 'number' && Number.isFinite(value[key])));
}

function isEdge(value: unknown): value is CanvasEdgeData {
  return isRecord(value)
    && optionalStrings(value, ['id', 'fromNode', 'toNode', 'fromSide', 'toSide', 'fromEnd', 'toEnd', 'label', 'color']);
}

function isCanvasData(value: unknown): value is CanvasData {
  if (!isRecord(value)) return false;
  if (value.nodes !== undefined && (!Array.isArray(value.nodes) || !value.nodes.every(isNode))) return false;
  if (value.edges !== undefined && (!Array.isArray(value.edges) || !value.edges.every(isEdge))) return false;
  if (value.center !== undefined) {
    const center = value.center;
    if (!isRecord(center) || typeof center.x !== 'number' || typeof center.y !== 'number'
      || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return false;
  }
  return true;
}

export function parseCanvasData(text: string): CanvasData {
  const value: unknown = JSON.parse(text);
  if (!isCanvasData(value)) throw new Error('白板节点、连线或几何数据无效');
  return value;
}
