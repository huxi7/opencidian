/**
 * [INPUT]: 依赖 ./graph-quadtree.js 的 buildQuadtree 与 visitAfter（空间索引与聚合遍历）。
 * [OUTPUT]: 导出 ForceKernel、createNode 与 ALPHA_DECAY/VELOCITY_DECAY/REPEL_DISTANCE_MIN/COLLIDE_RADIUS/COLLIDE_STRENGTH/ALPHA_MIN/ALPHA_START 常量。
 * [POS]: 图谱力学内核（原版 sim.js 的物理部分）。graph-sim-worker.js 在 Worker 里跑它，graph-simulation.js 门面在本地回退与结果镜像时跑同一份数学。
 *        斥力为 Barnes-Hut 四叉树近似（theta²=0.81），碰撞按四叉树包围盒裁剪半径 120 的候选对，两者共用同一棵树（tick 内位置不变）。
 *        受力遍历内联为复用栈，避免逐点闭包分配。参数对齐原版 d3-force：manyBody strength=-1000/distanceMin=30、
 *        collide radius=60/strength=.5、速度衰减 .6、alpha 衰减 1-0.001^(1/300)。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { buildQuadtree, visitAfter } from './graph-quadtree.js';

export const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300); // 原版 B
export const VELOCITY_DECAY = 0.6;                       // 原版 complete(..., 0.6)
export const REPEL_DISTANCE_MIN = 30;                    // 原版 distanceMin(30)
export const COLLIDE_RADIUS = 60;                        // 原版 radius(60)
export const COLLIDE_STRENGTH = 0.5;                     // 原版 strength(.5)
export const ALPHA_MIN = 0.001;                          // 原版循环停止阈值 Q>.001
export const ALPHA_START = 0.3;                          // 原版 postMessage({alpha:.3})

const jiggle = () => 1e-6 * (Math.random() - 0.5);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/* 原版 worker 的新节点形态：{id,x,y,vx,vy,fx:null,fy:null}（index 由 setNodes 重排） */
export function createNode(id) {
  return { id, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, index: 0 };
}

/**
 * 力学状态 + 单帧积分。所有方法都是原版 worker onmessage 分支的逐条复刻；
 * 门面（本地回退）与 worker 用同一份实现，因此两条后端的行为一致。
 */
export class ForceKernel {
  constructor() {
    this.nodeById = new Map();
    this.nodes = [];              // 有序节点表（index 与数组下标一致）
    this.links = [];              // {source,target} 对象引用
    this.linkCounts = new Map();  // 节点度数缓存（弹簧强度用，拓扑变化时重建）
    this.alpha = 1;
    this.alphaTarget = 0;
    this.centerStrength = 0.1;
    this.repelStrength = -1000;
    this.linkStrength = 1;
    this.linkDistance = 250;
  }

  /* --------------------------------------------------------------------------
   * 原版 worker onmessage 语义
   * ------------------------------------------------------------------------ */

  /** nodes 消息：删除不在载荷里的节点（保留对象）；新 id 入表；[x,y] 覆盖坐标；重排 index。 */
  setNodes(payload) {
    const next = [];
    for (const id of Array.from(this.nodeById.keys())) {
      if (!hasOwn(payload, id)) this.nodeById.delete(id);
      else next.push(this.nodeById.get(id));
    }
    for (const id in payload) {
      if (!hasOwn(payload, id)) continue;
      let node = this.nodeById.get(id);
      if (!node) {
        node = createNode(id);
        this.nodeById.set(id, node);
        next.push(node);
      }
      const xy = payload[id];
      if (xy) { node.x = xy[0]; node.y = xy[1]; }
    }
    for (let i = 0; i < next.length; i += 1) next[i].index = i;
    this.nodes = next;
  }

  /** links 消息：按 id 表映射成对象引用；端点缺失的连线丢弃。 */
  setLinks(payload) {
    this.links = [];
    for (const pair of payload) {
      const source = this.nodeById.get(pair[0]);
      const target = this.nodeById.get(pair[1]);
      if (source && target) this.links.push({ source, target });
    }
    /* 弹簧强度取两端度数：拓扑变化时计数；逐帧对每条边重扫全图会产生 O(E²) 开销 */
    this.linkCounts = new Map();
    for (const { source, target } of this.links) {
      this.linkCounts.set(source, (this.linkCounts.get(source) || 0) + 1);
      if (target !== source) this.linkCounts.set(target, (this.linkCounts.get(target) || 0) + 1);
    }
  }

  /** forceNode 消息：钉住节点；x/y 传 null 即解除钉住。 */
  forceNode(id, x, y) {
    const node = this.nodeById.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
  }

  /** forces 消息：逐键更新；|repelStrength| < 1 时钳到 -1，避免零斥力。 */
  setForces(forces) {
    if (forces.centerStrength !== undefined) this.centerStrength = forces.centerStrength;
    if (forces.linkStrength !== undefined) this.linkStrength = forces.linkStrength;
    if (forces.linkDistance !== undefined) this.linkDistance = forces.linkDistance;
    if (forces.repelStrength !== undefined) {
      this.repelStrength = Math.abs(forces.repelStrength) < 1 ? -1 : -forces.repelStrength;
    }
  }

  /** alpha 消息：仅当传入值大于当前 alpha 才抬高（原版 Q < t.alpha 才赋值）。 */
  raiseAlpha(value) {
    if (this.alpha < value) this.alpha = value;
  }

  /** alphaTarget 消息：直接赋值。 */
  setAlphaTarget(value) {
    this.alphaTarget = value;
  }

  /** 沉降完成：alpha 已低且没有加速目标。 */
  get finished() {
    return this.alpha <= ALPHA_MIN && this.alphaTarget === 0;
  }

  /* --------------------------------------------------------------------------
   * 单帧积分
   * ------------------------------------------------------------------------ */

  /** 一帧：alpha 衰减 → 向心/弹簧/斥力/碰撞 → 积分（原版循环 Q += (y-Q)*B; K(); 的顺序）。 */
  tick() {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const alpha = this.alpha;
    const nodes = this.nodes;
    for (const node of nodes) {
      /* 向心力（原版 forceX/forceY，strength = centerStrength，目标原点） */
      node.vx += (0 - node.x) * this.centerStrength * alpha;
      node.vy += (0 - node.y) * this.centerStrength * alpha;
    }
    for (const link of this.links) {
      /* 弹簧（原版 q：strength 默认 1/min(出度,入度)，带 bias 与 jiggle） */
      const source = link.source;
      const target = link.target;
      const countSource = this.linkCount(source);
      const countTarget = this.linkCount(target);
      const strength = this.linkStrength / Math.min(countSource, countTarget);
      let dx = target.x + target.vx - source.x - source.vx;
      let dy = target.y + target.vy - source.y - source.vy;
      let distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) { dx = jiggle(); dy = jiggle(); distance = Math.sqrt(dx * dx + dy * dy); }
      const scale = ((distance - this.linkDistance) / distance) * alpha * strength;
      dx *= scale;
      dy *= scale;
      const bias = countSource / (countSource + countTarget);
      target.vx -= dx * bias;
      target.vy -= dy * bias;
      source.vx += dx * (1 - bias);
      source.vy += dy * (1 - bias);
    }
    /* 斥力与碰撞共用同一棵四叉树：tick 内节点位置未变 */
    const tree = buildQuadtree(nodes);
    if (tree) {
      this.accumulateRepulsion(tree);
      this.applyRepulsion(tree, nodes, alpha);
      this.applyCollision(tree, nodes);
    }
    for (const node of nodes) {
      /* 积分（原版 complete）：先速度衰减 0.6 再位移；fx/fy 钉住的节点直接落位 */
      if (node.fx === null) { node.vx *= VELOCITY_DECAY; node.x += node.vx; }
      else { node.x = node.fx; node.vx = 0; }
      if (node.fy === null) { node.vy *= VELOCITY_DECAY; node.y += node.vy; }
      else { node.y = node.fy; node.vy = 0; }
    }
    return this.alpha;
  }

  linkCount(node) {
    return this.linkCounts.get(node) || 1;
  }

  /* --------------------------------------------------------------------------
   * Barnes-Hut 斥力 / 四叉树碰撞（对齐原版 d3-force 的 accumulate / apply）
   * ------------------------------------------------------------------------ */

  /** 自底向上聚合强度与质心（d3 manyBody.accumulate）。 */
  accumulateRepulsion(tree) {
    const strength = this.repelStrength;
    visitAfter(tree, (quad) => {
      if (quad.children) {
        let value = 0;
        let weight = 0;
        let x = 0;
        let y = 0;
        for (const child of quad.children) {
          const c = Math.abs(child.value);
          if (!c) continue;
          value += child.value;
          weight += c;
          x += c * child.massX;
          y += c * child.massY;
        }
        quad.value = value;
        if (weight) { quad.massX = x / weight; quad.massY = y / weight; }
        return;
      }
      if (quad.data) {
        let value = 0;
        for (let q = quad; q; q = q.next) value += strength;
        quad.value = value;
        quad.massX = quad.dataX;
        quad.massY = quad.dataY;
      } else {
        quad.value = 0;
      }
    });
  }

  /** 逐点受力（d3 manyBody.apply；theta² = 0.81，距离过近按 distanceMin 钳制）。内联栈遍历，避免逐点闭包分配。 */
  applyRepulsion(tree, nodes, alpha) {
    const theta2 = 0.81;
    const minDist2 = REPEL_DISTANCE_MIN * REPEL_DISTANCE_MIN;
    const strength = this.repelStrength;
    const stack = this._repelStack || (this._repelStack = []);
    for (const node of nodes) {
      stack.length = 0;
      stack.push(tree);
      while (stack.length) {
        const quad = stack.pop();
        if (!quad.value) continue;
        const w = quad.x1 - quad.x0;
        let x = quad.massX - node.x;
        let y = quad.massY - node.y;
        let l = x * x + y * y;
        if (w * w / theta2 < l) {
          /* 足够远：整块按聚合质心施加 */
          if (x === 0) { x = jiggle(); l += x * x; }
          if (y === 0) { y = jiggle(); l += y * y; }
          if (l < minDist2) l = Math.sqrt(minDist2 * l);
          node.vx += x * quad.value * alpha / l;
          node.vy += y * quad.value * alpha / l;
          continue;
        }
        if (quad.children) {
          for (const child of quad.children) stack.push(child);
          continue;
        }
        /* 叶子：逐点施加（重合链共用同一坐标） */
        if (quad.data === node && !quad.next) continue;
        if (quad.data !== node || quad.next) {
          if (x === 0) { x = jiggle(); l += x * x; }
          if (y === 0) { y = jiggle(); l += y * y; }
          if (l < minDist2) l = Math.sqrt(minDist2 * l);
        }
        for (let q = quad; q; q = q.next) {
          if (q.data !== node) {
            const f = strength * alpha / l;
            node.vx += x * f;
            node.vy += y * f;
          }
        }
      }
    }
  }

  /** 半径碰撞（d3 collide：半径一致，配对权重 0.5，包围盒裁剪半径 120）。内联栈遍历。 */
  applyCollision(tree, nodes) {
    const radius = COLLIDE_RADIUS;
    const reach = radius * 2;
    const reach2 = reach * reach;
    const share = (radius * radius) / (radius * radius + radius * radius);
    const stack = this._collideStack || (this._collideStack = []);
    for (const node of nodes) {
      const xi = node.x + node.vx;
      const yi = node.y + node.vy;
      stack.length = 0;
      stack.push(tree);
      while (stack.length) {
        const quad = stack.pop();
        if (quad.data) {
          if (quad.data.index > node.index) {
            let x = xi - quad.data.x - quad.data.vx;
            let y = yi - quad.data.y - quad.data.vy;
            let l = x * x + y * y;
            if (l < reach2) {
              if (l === 0) { x = jiggle(); y = jiggle(); l = x * x + y * y; }
              const scale = (reach - Math.sqrt(l)) / Math.sqrt(l) * COLLIDE_STRENGTH;
              x *= scale;
              y *= scale;
              node.vx += x * share;
              node.vy += y * share;
              quad.data.vx -= x * (1 - share);
              quad.data.vy -= y * (1 - share);
            }
          }
          continue;
        }
        if (quad.x0 > xi + reach || quad.x1 < xi - reach || quad.y0 > yi + reach || quad.y1 < yi - reach) continue;
        if (!quad.children) continue;
        for (const child of quad.children) stack.push(child);
      }
    }
  }
}
