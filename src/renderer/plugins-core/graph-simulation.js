/**
 * [INPUT]: 依赖节点初始位置、有向边与力学参数。
 * [OUTPUT]: 导出 ForceSim；支持差量换图、节点固定、释放与逐帧积分。
 * [POS]: 图谱力学计算；渲染器拥有实例，斥力与碰撞保持 O(n²)。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
        node = { id: ref.id, x: ref.x, y: ref.y, vx: 0, vy: 0, fx: null, fy: null };
        this.nodeById.set(ref.id, node);
      }
      next.push(node);
    }
    const alive = new Set(nodeRefs.map((ref) => ref.id));
    for (const id of Array.from(this.nodeById.keys())) if (!alive.has(id)) this.nodeById.delete(id);
    this.nodes = next;
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
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 === 0) { dx = jiggle(); dy = jiggle(); dist2 = dx * dx + dy * dy; }
        if (dist2 < minDist2) dist2 = Math.sqrt(minDist2 * dist2);
        const force = this.repelStrength * alpha / dist2;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ax = a.x + a.vx;
      const ay = a.y + a.vy;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const bx = b.x + b.vx;
        const by = b.y + b.vy;
        let dx = ax - bx;
        let dy = ay - by;
        let dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = COLLIDE_RADIUS * 2;
        if (dist >= minDist) continue;
        if (dist === 0) { dx = jiggle(); dy = jiggle(); dist = Math.sqrt(dx * dx + dy * dy); }
        const scale = ((minDist - dist) / dist) * COLLIDE_STRENGTH;
        dx *= scale;
        dy *= scale;
        const weight = (COLLIDE_RADIUS * COLLIDE_RADIUS) / (COLLIDE_RADIUS * COLLIDE_RADIUS + COLLIDE_RADIUS * COLLIDE_RADIUS);
        a.vx += dx * weight;
        a.vy += dy * weight;
        b.vx -= dx * (1 - weight);
        b.vy -= dy * (1 - weight);
      }
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
}
