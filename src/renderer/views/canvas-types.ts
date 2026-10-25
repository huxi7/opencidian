/**
 * [INPUT]: 画布节点、连线与历史模型的类型。
 * [OUTPUT]: CanvasSharedState 描述三层画布继承链共用的状态。
 * [POS]: 画布状态契约；界面装配与交互算法共享同一份字段定义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CanvasNode } from './canvas-node.js';
import type { CanvasEdge } from './canvas-edge.js';
export interface CanvasSharedState {
  _dropInstalled: boolean;
  screenshotting: boolean;
  x: number;
  tx: number;
  y: number;
  ty: number;
  zoom: number;
  tZoom: number;
  zoomCenter: any;
  snapContainerEl: any;
  viewportChanged: boolean;
  selectionChanged: boolean;
  frame: number;
  pointerFrame: number;
  finishViewportAnimation: boolean;
  scale: number;
  wasAnimating: boolean;
  canvasRect: any;
  zoomToFitQueued: boolean;
  isHoldingSpace: boolean;
  pauseAnimation: number;
  staleSelection: Array<CanvasNode | CanvasEdge>;
  isDragging: boolean;
  interactionTarget: any;
  icon: any;
  navigation: boolean;
  view: any;
  file: import('../core/vault.js').TFile;
  readonly: boolean;
  data: any;
  config: any;
  options: ReturnType<typeof import("./canvas-options.js").loadCanvasOptions>;
  nodes: Map<string, CanvasNode>;
  edges: Map<string, CanvasEdge>;
  edgeFrom: any;
  edgeTo: any;
  selection: Set<CanvasNode | CanvasEdge>;
  menu: any;
  zIndexCounter: number;
  moved: Set<CanvasNode | CanvasEdge>;
  dirty: Set<CanvasNode | CanvasEdge>;
  frameStart: any;
  _saveTimer: any;
  _savedText: string;
  _closed: boolean;
  _writing: boolean;
  _modifyRef: any;
  history: import("./canvas-history.js").CanvasHistory;
  requestPushHistory: any;
  undoBtnEl: any;
  redoBtnEl: any;
  onGlobalKeydown: any;
  onGlobalKeyup: any;
  _resizeObserver: ResizeObserver | undefined;
  _renameRef: any;
  _deleteRef: any;
  wrapperEl: HTMLDivElement;
  backgroundPatternEl: any;
  moverEl: any;
  canvasEl: HTMLDivElement;
  edgeContainerEl: any;
  edgeEndContainerEl: any;
  canvasPlaceholderEl: any;
  _dirty: boolean | undefined;
  _loadSequence: any;
  _failedFilePath: any;
  _savedDataText: string;
  _saveError: any;
  _saveConflict: boolean | undefined;
  cardMenuEl: HTMLElement;
  canvasControlsEl: HTMLElement;
  quickSettingsButton: HTMLElement;
}
