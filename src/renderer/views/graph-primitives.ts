/**
 * [INPUT]: 图谱渲染器的配色、节点尺寸与共享几何函数。
 * [OUTPUT]: 导出 GraphNode、GraphLink 和共用淡出系数。
 * [POS]: 图谱图元模型；渲染器拥有图元和模拟器，图元不安装监听。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { clamp, displayName } from '../plugins-core/graph-utils.js';
export const GRAPH_FADE = 0.2;
const FADE = GRAPH_FADE;
// 图元：节点（原版 MQ）与连线（原版 SQ）
export class GraphNode {
  declare renderer: any;
  declare id: any;
  declare type: any;
  declare x: any;
  declare y: any;
  declare fx: any;
  declare fy: any;
  declare forward: any;
  declare reverse: any;
  declare weight: number;
  declare color: any;
  declare rgb: number;
  declare fadeAlpha: number;
  declare moveText: number;
  declare textVisible: boolean;
  declare wrapCache: any;

  constructor(renderer, id, type) {
    this.renderer = renderer;
    this.id = id;
    this.type = type;
    this.x = null;
    this.y = null;
    this.fx = null;
    this.fy = null;
    this.forward = {};
    this.reverse = {};
    this.weight = 0;
    this.color = null;
    this.rgb = 0;
    this.fadeAlpha = 0;
    this.moveText = 0;
    this.textVisible = false;
    this.wrapCache = null;
  }
  /* 原版 getSize：随权重增长，钳在 8~30 */
  getSize() { return this.renderer.fNodeSizeMult * clamp(3 * Math.sqrt(this.weight + 1), 8, 30); }
  getDisplayText() { return displayName(this.id); }
  getRelated() { return Object.keys(this.forward).concat(Object.keys(this.reverse)); }
  /* 原版 getFillColor：高亮 > 颜色组 > 焦点 > 标签 > 未解析 > 附件 > 默认 */
  getFillColor() {
    const renderer = this.renderer;
    if (renderer.getHighlightNode() === this) return renderer.colors.fillHighlight;
    if (this.type === 'focused') { if (renderer.colors.fillFocused.a > 0) return renderer.colors.fillFocused; }
    else if (this.color) return this.color;
    else if (this.type === 'tag') return renderer.colors.fillTag;
    else if (this.type === 'unresolved') return renderer.colors.fillUnresolved;
    else if (this.type === 'attachment') return renderer.colors.fillAttachment;
    return renderer.colors.fill;
  }
}

export class GraphLink {
  declare renderer: any;
  declare source: any;
  declare target: any;
  declare alpha: any;
  declare arrowAlpha: any;
  declare rgb: any;

  constructor(renderer, source, target) {
    this.renderer = renderer;
    this.source = source;
    this.target = target;
    this.alpha = FADE * renderer.colors.line.a;
    this.arrowAlpha = FADE * renderer.colors.text.a;
    this.rgb = renderer.colors.line.rgb;
  }
}
