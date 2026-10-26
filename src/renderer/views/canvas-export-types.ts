/**
 * [INPUT]: 画布世界坐标、像素预算和可选预载图像。
 * [OUTPUT]: 导出图片选项、输出几何与弹窗回执协议。
 * [POS]: 导出编排、弹窗和分块截图共享的纯数据边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CanvasBBox } from './canvas-utils.js';
import type { CanvasNode } from './canvas-node.js';
export interface CanvasExportOptions {
  frame?: 'full' | 'viewport'; box?: CanvasBBox; scale?: number; padding?: number;
  maxSize?: number; pixelRatio?: number; showLogo?: boolean; privacyMode?: boolean;
  tileWidth?: number; tileHeight?: number; memoryBudgetBytes?: number;
  images?: Map<CanvasNode, HTMLImageElement>; linkImages?: Map<CanvasNode, CanvasImageSource>;
}
export interface CanvasExportMetrics {
  box: CanvasBBox; worldWidth: number; worldHeight: number; maxSize: number;
  pixelRatio: number; maxZoom: number; scale: number; width: number; height: number;
}
export interface CanvasExportDialogMetrics {
  worldWidth: number; worldHeight: number; maxSize: number; maxZoom: number;
  dimensionsFor(multiplier: number): CanvasExportMetrics;
  onSave(options: CanvasExportOptions): void;
}
