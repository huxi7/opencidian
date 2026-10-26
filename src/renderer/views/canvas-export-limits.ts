/**
 * [INPUT]: 设备像素比、页面缩放、输出尺寸、截图分块与内存预算。
 * [OUTPUT]: MAX_SIZE、MAX_EXPORT_MEMORY、canvasPixelRatio、estimateCanvasExportBytes、assertCanvasExportBudget。
 * [POS]: 画布导出分配前的纯数值边界。长边遵循原版 16284；内存按输出、编码和分块保守估计。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const MAX_SIZE = 16284;
export const MAX_EXPORT_MEMORY = 512 * 1024 * 1024;
export function canvasPixelRatio(devicePixelRatio: number, pageZoom: number) {
  if (![devicePixelRatio, pageZoom].every(value => Number.isFinite(value) && value > 0)) throw Error('画布导出像素密度无效');
  return Math.round(devicePixelRatio / pageZoom * 1e5) / 1e5;
}
export function estimateCanvasExportBytes(width: number, height: number, tileWidth = 2048, tileHeight = 2048) {
  if (![width, height, tileWidth, tileHeight].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('画布导出像素尺寸无效');
  return width * height * 20 + Math.min(tileWidth, width) * Math.min(tileHeight, height) * 8;
}
export function assertCanvasExportBudget(metrics: { width: number; height: number }, options: { tileWidth?: number; tileHeight?: number; memoryBudgetBytes?: number } = {}) {
  const { width, height } = metrics;
  if (width > MAX_SIZE || height > MAX_SIZE) throw Error('画布导出长边不能超过 ' + MAX_SIZE + ' 像素');
  const bytes = estimateCanvasExportBytes(width, height, options.tileWidth, options.tileHeight);
  const limit = options.memoryBudgetBytes ?? MAX_EXPORT_MEMORY;
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('画布导出内存预算无效');
  if (bytes > limit) throw Error('预计导出需要 ' + Math.ceil(bytes / 1048576) + ' MiB，超过 ' + Math.floor(limit / 1048576) + ' MiB 内存预算；请降低缩放或缩小导出范围。');
  return bytes;
}
