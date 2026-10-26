/**
 * [INPUT]: 单元格坐标、表格 DOM 与换格请求。
 * [OUTPUT]: 导出选区、编辑会话和跨重绘状态契约。
 * [POS]: 表格模型、交互与原位编辑共享的状态，不持有文档内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface CellPosition { row: number; col: number; }
export interface CellBounds { minRow: number; maxRow: number; minCol: number; maxCol: number; }
export interface TableEditState extends CellPosition {
  textarea: HTMLTextAreaElement; wrapper: HTMLElement; composing: boolean; pendingCommit: boolean;
}
export interface TableViewState {
  insert?: number;
  selection?: { anchor: CellPosition | null; head: CellPosition | null };
  focus?: CellPosition & { selectAll?: boolean };
  blankEdges?: { leading?: boolean; trailing?: boolean };
}
export interface CarriedTableState extends TableViewState { from: number; text: string; }
export interface TableDragContext extends CellPosition {
  event: PointerEvent; handle: HTMLElement; container: HTMLElement; tableEl: HTMLTableElement; axis: 'row' | 'col';
}
