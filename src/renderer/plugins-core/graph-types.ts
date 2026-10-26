/**
 * [INPUT]: 图谱节点、颜色组、面板偏好与力学消息。
 * [OUTPUT]: 导出图谱数据、选项、Worker 命令与位置帧协议。
 * [POS]: 图谱跨模块边界。主线程与 Worker 共用消息形状，动态节点以 ID 索引。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface GraphColor { a: number; rgb: number; }
export interface GraphColorQuery { query: string; color: GraphColor | null; }
export interface GraphNodeData { type: string; links: Record<string, boolean>; color?: GraphColor; }
export interface GraphData { nodes: Record<string, GraphNodeData>; weights?: Record<string, number>; numLinks?: number; }
export interface GraphOptions {
  showArrow: boolean; textFadeMultiplier: number; nodeSizeMultiplier: number; lineSizeMultiplier: number;
  centerStrength: number; repelStrength: number; linkStrength: number; linkDistance: number;
  showAttachments: boolean; hideUnresolved: boolean; showOrphans: boolean; showTags: boolean;
  localFile: string | null; localJumps: number; localInterlinks: boolean; localForelinks: boolean; localBacklinks: boolean;
  search?: string; colorGroups?: GraphColorQuery[]; scale?: number;
}

export type GraphForceOptions = Partial<Pick<GraphOptions, 'centerStrength' | 'repelStrength' | 'linkStrength' | 'linkDistance'>>;
export interface GraphWorkerCommand {
  nodes?: Record<string, [number, number] | false | null>; links?: [string, string][];
  forceNode?: { id: string; x: number | null; y: number | null };
  forces?: GraphForceOptions; alpha?: number; alphaTarget?: number; run?: boolean;
}
export interface GraphPositionFrame { id: string[]; buffer: ArrayBuffer | SharedArrayBuffer; v?: number; }
