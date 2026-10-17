/**
 * [INPUT]: 依赖 ./graph-quadtree.js 的 buildQuadtree 与 visitAfter（空间索引与聚合遍历）。
 * [OUTPUT]: 导出 ForceSim；支持差量换图、节点固定、释放与逐帧积分。
 * [POS]: 图谱力学计算；渲染器拥有实例。斥力为 Barnes-Hut 四叉树近似（theta²=0.81），碰撞按四叉树包围盒裁剪半径 120 的候选对，
 *        两者共用同一棵树（tick 内位置不变）。受力遍历内联为复用栈，避免逐点闭包分配。
 *        参数对齐原版 d3-force：manyBody strength=-1000/distanceMin=30、collide radius=60/strength=.5。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { buildQuadtree, visitAfter } from './graph-quadtree.js';

const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300); // 原版 B
const VELOCITY_DECAY = 0.6;                       // 原版 complete(..., 0.6)
const REPEL_DISTANCE_MIN = 30;                    // 原版 distanceMin(30)
const COLLIDE_RADIUS = 60;                        // 原版 radius(60)
const COLLIDE_STRENGTH = 0.5;                     // 原版 strength(.5)
const jiggle = () => 1e-6 * (Math.random() - 0.5);

export class ForceSim {
  constructor() {
    this.nodes = [];              // {id,x,y,vx,vy,fx,fy}
    this.nodeById = new Map();
    this.links = [];              // {source,target}
    this.alpha = 1;
    this.alphaTarget = 0;
    this.centerStrength = 0.1;
    this.repelStrength = -1000;
    this.linkStrength = 1;
    this.linkDistance = 250;
    this.structureDirty = false;
  }

  /**
   * 原版 worker 的 setData 消息（{nodes:{id:[x,y]},links,alpha:.3,run:true}）。
   * nodeRefs 是渲染器算好初始位置的节点 [{id,x,y}]；已有节点保留自身坐标与速度。
   */
  setData(nodeRefs, links) {
    const next = [];
    for (const ref of nodeRefs) {
      let node = this.nodeById.get(ref.id);
      if (!node) {
        node = { id: ref.id, x: ref.x, y: ref.y, vx: 0, vy: 0, fx: null, fy: null, index: 0 };
        this.nodeById.set(ref.id, node);
      }
      next.push(node);
    }
    const alive = new Set(nodeRefs.map((ref) => ref.id));
    for (const id of Array.from(this.nodeById.keys())) if (!alive.has(id)) this.nodeById.delete(id);
    this.nodes = next;
    // 碰撞的配对去重需要稳定索引（d3 的 node.index）
    for (let i = 0; i < next.length; i += 1) next[i].index = i;
    const byId = this.nodeById;
    this.links = links.map(([s, t2]) => ({ source: byId.get(s), target: byId.get(t2) }))
      .filter((link) => link.source && link.target);
    // 拓扑改变时计数；逐帧对每条边重扫全图会产生 O(E²) 开销。
    this.linkCounts = new Map();
    for (const { source, target } of this.links) {
      this.linkCounts.set(source, (this.linkCounts.get(source) || 0) + 1);
      if (target !== source) this.linkCounts.set(target, (this.linkCounts.get(target) || 0) + 1);
    }
    this.structureDirty = true;
    this.run();
  }

  /* 原版 forceNode 消息：拖拽时钉住节点；x/y 传 null 解除钉住，alphaTarget 传 0 停止加速 */
  setForceNode(id, x, y, alpha, alphaTarget) {
    const node = this.nodeById.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
    if (alpha !== undefined && this.alpha < alpha) this.alpha = alpha;
    if (alphaTarget !== undefined) this.alphaTarget = alphaTarget;
  }

  setForces(forces) {
    if (forces.centerStrength !== undefined) this.centerStrength = forces.centerStrength;
    if (forces.linkStrength !== undefined) this.linkStrength = forces.linkStrength;
    if (forces.linkDistance !== undefined) this.linkDistance = forces.linkDistance;
    if (forces.repelStrength !== undefined) {
      /* 原版：|repel| < 1 时钳到 -1，避免零斥力 */
      this.repelStrength = Math.abs(forces.repelStrength) < 1 ? -1 : -forces.repelStrength;
    }
    this.run();
  }

  /* 原版 run 消息：只抬高 alpha，不重置 */
  run() {
    if (this.alpha < 0.3) this.alpha = 0.3;
  }

  get finished() {
    return this.alpha <= 0.001 && this.alphaTarget === 0;
  }

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
      const countSource = this._linkCount(source);
      const countTarget = this._linkCount(target);
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
    const minDist2 = REPEL_DISTANCE_MIN * REPEL_DISTANCE_MIN;
    /* 斥力与碰撞共用同一棵四叉树：tick 内节点位置未变 */
    const tree = buildQuadtree(nodes);
    if (tree) {
      this._accumulateRepulsion(tree);
      this._applyRepulsion(tree, nodes, alpha);
      this._applyCollision(tree, nodes);
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

  _linkCount(node) {
    return this.linkCounts?.get(node) || 1;
  }

  /* --------------------------------------------------------------------------
   * Barnes-Hut 斥力 / 四叉树碰撞（对齐原版 d3-force 的 accumulate / apply）
   * ------------------------------------------------------------------------ */

  /** 自底向上聚合强度与质心（d3 manyBody.accumulate）。 */
  _accumulateRepulsion(tree) {
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
  _applyRepulsion(tree, nodes, alpha) {
    const theta2 = 0.81;
    const minDist2 = REPEL_DISTANCE_MIN * REPEL_DISTANCE_MIN;
    const strength = this.repelStrength;
    const stack = this._scratch || (this._scratch = []);
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
  _applyCollision(tree, nodes) {
    const radius = COLLIDE_RADIUS;
    const reach = radius * 2;
    const reach2 = reach * reach;
    const share = (radius * radius) / (radius * radius + radius * radius);
    const stack = this._scratch2 || (this._scratch2 = []);
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
