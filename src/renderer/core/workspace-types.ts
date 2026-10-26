/**
 * [INPUT]: 工作区叶子模型与标准 DOM 拖拽坐标。
 * [OUTPUT]: 导出落点方向、拖拽会话和功能区动作类型。
 * [POS]: 工作区交互协议。模型与 DOM 适配器共享会话形状。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WorkspaceLeaf } from './workspace-model.js';
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';
export interface TabDragState {
  leaf: WorkspaceLeaf; startX: number; startY: number; grabbing: boolean;
  dropTarget: HTMLElement | null; dropAfter: boolean; dropIndex: number | null;
}
export type RibbonAction = (event: MouseEvent | KeyboardEvent) => unknown;
