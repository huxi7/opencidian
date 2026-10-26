/**
 * [INPUT]: 画布节点、连线与历史模型的类型。
 * [OUTPUT]: CanvasSharedState 描述三层画布继承链共用的状态。
 * [POS]: 画布状态契约；界面装配与交互算法共享同一份字段定义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CanvasNode } from './canvas-node.js';
import type { CanvasEdge } from './canvas-edge.js';
import type { CanvasView } from './canvas-view.js';
import type { CanvasPoint, CanvasSize, CanvasRect, CanvasBBox, MultiMap } from './canvas-utils.js';
import type { CanvasDragHandlers } from './canvas-drag.js';
import type { EventRef, Debounced } from '../core/events.js';

export interface CanvasNodeData {
  id?: string; type?: string; x?: number; y?: number; width?: number; height?: number; color?: string;
  text?: string; file?: string; subpath?: string; url?: string; label?: string;
  background?: string; backgroundStyle?: string; [extension: string]: unknown;
}
export interface CanvasEdgeData {
  id?: string; fromNode?: string; toNode?: string; fromSide?: string; toSide?: string;
  fromEnd?: string; toEnd?: string; label?: string; color?: string; [extension: string]: unknown;
}
export interface CanvasData { center?: CanvasPoint; nodes?: CanvasNodeData[]; edges?: CanvasEdgeData[]; [extension: string]: unknown; }
export interface CanvasConfig { zoomMultiplier: number; objectSnapDistance: number; minContainerDimension: number; defaultTextNodeDimensions: CanvasSize; defaultFileNodeDimensions: CanvasSize; }
export interface CanvasOptions extends Record<string, unknown> {
  snapToObjects: boolean; snapToGrid: boolean; zoomBreakpoint?: number; cardLabelVisibility?: string;
  defaultWheelBehavior?: string; defaultModDragBehavior?: string; newFileLocation?: string; newFileFolderPath?: string;
}
export interface CanvasPromptOptions<T extends CanvasNode> extends CanvasNodeOptions { media?: boolean; onChoose?(node: T): void; onCancel?(): void; }
export interface CanvasDragPanHandlers extends CanvasDragHandlers { start?(): void; }
export interface CanvasNodeOptions { pos?: CanvasPoint; size?: CanvasSize; position?: string; text?: string; file?: import('../core/vault.js').TFile; subpath?: string; url?: string; label?: string; save?: boolean; focus?: boolean; }

export interface CanvasSharedState {
  _dropInstalled: boolean;
  screenshotting: boolean;
  x: number;
  tx: number;
  y: number;
  ty: number;
  zoom: number;
  tZoom: number;
  zoomCenter: CanvasPoint | null;
  snapContainerEl: SVGSVGElement | null;
  viewportChanged: boolean;
  selectionChanged: boolean;
  frame: number;
  pointerFrame: number;
  finishViewportAnimation: boolean;
  scale: number;
  wasAnimating: boolean;
  canvasRect: ReturnType<typeof import('./canvas-utils.js').rectOf>;
  zoomToFitQueued: boolean;
  isHoldingSpace: boolean;
  pauseAnimation: number;
  staleSelection: Array<CanvasNode | CanvasEdge> | null;
  isDragging: boolean;
  interactionTarget: CanvasNode | null;
  view: CanvasView;
  readonly: boolean;
  data: CanvasData;
  config: CanvasConfig;
  options: CanvasOptions;
  nodes: Map<string, CanvasNode>;
  edges: Map<string, CanvasEdge>;
  edgeFrom: MultiMap<CanvasNode, CanvasEdge>;
  edgeTo: MultiMap<CanvasNode, CanvasEdge>;
  selection: Set<CanvasNode | CanvasEdge>;
  menu: ReturnType<typeof import('./canvas-arrange.js').buildCanvasMenu> | null;
  zIndexCounter: number;
  moved: Set<CanvasNode | CanvasEdge>;
  dirty: Set<CanvasNode | CanvasEdge>;
  frameStart: number;
  _modifyRef: EventRef | null | undefined;
  history: import("./canvas-history.js").CanvasHistory;
  requestPushHistory: Debounced<[CanvasData], unknown, void>;
  undoBtnEl: HTMLElement | null;
  redoBtnEl: HTMLElement | null;
  onGlobalKeydown: ((event: KeyboardEvent) => void) | undefined;
  onGlobalKeyup: ((event: KeyboardEvent) => void) | undefined;
  _resizeObserver: ResizeObserver | undefined;
  _renameRef: EventRef | null | undefined;
  _deleteRef: EventRef | null | undefined;
  wrapperEl: HTMLDivElement;
  backgroundPatternEl: SVGPatternElement;
  moverEl: HTMLDivElement;
  canvasEl: HTMLDivElement;
  edgeContainerEl: SVGSVGElement;
  edgeEndContainerEl: SVGSVGElement;
  canvasPlaceholderEl: HTMLDivElement | null;
  _loadSequence: number | undefined;
  _failedFilePath: string | undefined;
  cardMenuEl: HTMLElement;
  canvasControlsEl: HTMLElement;
  quickSettingsButton: HTMLElement;
}
