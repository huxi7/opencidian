/**
 * [INPUT]: 依赖 ./graph-force.js 的 ForceKernel 与 ALPHA_START/ALPHA_MIN；依赖浏览器 Worker/fetch/Blob/URL API。
 * [OUTPUT]: 导出 ForceSim 与 GRAPH_WORKER_URL。
 * [POS]: 图谱力学的线程门面（原版渲染端 TQ 内 worker 交互的对应物）。worker 后端把原版 sim.js 协议发给 Worker：
 *        app:// 直载 → 失败退 fetch + Blob URL（原版 Rz 手法）→ 再失败退本地线程，物理交给共享内核 graph-force.js。
 *        对外方法名与旧实现一致（setData/setForceNode/setForces/run/tick/finished/nodeById），graph-renderer 只新增 onUpdate 与 destroy 接线。
 *        位置在收到 worker 结果时写入 nodeById 并回调；SAB 用 buffer 末尾 Uint32 版本守卫，transfer 的 ArrayBuffer 应用后清空结果。
 *        位置回执先校验缓冲区长度与节点 ID；零坐标固定点同样阻止 Worker 覆盖。
 *        更换 worker（直载失败或运行中崩溃）时重发镜像状态（nodes/links/钉住/力参数），避免替补 worker 空图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { GraphWorkerCommand, GraphPositionFrame, GraphForceOptions } from './graph-types.js';
import { ForceKernel, ALPHA_START, ALPHA_MIN, type ForceNode } from './graph-force.js';

export const GRAPH_WORKER_URL = 'app://opensidian.app/dist/graph-sim-worker.js';
const WORKER_NAME = 'Graph Worker';   // 原版 new Worker("/sim.js", { name: "Graph Worker" })
const IDLE_MS = 250;                  // worker 后端沉降判定：连续静默超过该时长即视为停摆

function isPositionFrame(value: object): value is GraphPositionFrame {
  if (!('buffer' in value) || !('id' in value) || !Array.isArray(value.id) || !value.id.every(id => typeof id === 'string')) return false;
  const buffer = value.buffer;
  const shared = typeof SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer;
  if (!(buffer instanceof ArrayBuffer) && !shared) return false;
  return buffer.byteLength >= value.id.length * 8 + (shared ? 4 : 0) && buffer.byteLength % 4 === 0;
}

export class ForceSim {
  declare kernel: ForceKernel;
  declare nodeById: Map<string, ForceNode>;
  declare backend: 'local' | 'worker';
  declare worker: Worker | null;
  declare workerActive: boolean;
  declare workerShared: boolean;
  declare fallbackReason: string;
  declare destroyed: boolean;
  declare localTicks: number;
  declare onUpdate: (() => void) | null;
  declare workerResults: GraphPositionFrame | null;
  declare pendingMessages: GraphWorkerCommand[];
  declare attempts: number;
  declare attachedOnce: boolean;
  declare lastActivity: number;

  constructor(options: { forceLocal?: boolean } = {}) {
    this.kernel = new ForceKernel();
    this.nodeById = this.kernel.nodeById;
    this.backend = 'local';           // 'worker' | 'local'（worker 创建期间先置 'worker'，失败回退改回）
    this.worker = null;               // Worker 实例；终止/回退后为 null
    this.workerActive = false;
    this.workerShared = false;        // worker 的 SAB 探测消息（shared 非空即支持）
    this.fallbackReason = '';         // 回退原因（验收与报告用）
    this.destroyed = false;
    this.localTicks = 0;              // 主线程实际跑的物理帧数（worker 后端保持 0）
    this.onUpdate = null;             // 收到新位置后触发（渲染端接 changed()）
    this.workerResults = null;        // 最近一次位置消息（版本守卫与诊断用）
    this.pendingMessages = [];        // worker 就绪前排队的消息
    this.attempts = 0;
    this.attachedOnce = false;        // 是否已挂过 worker（决定替补 worker 是否重发镜像状态）
    this.lastActivity = 0;
    if (!options.forceLocal) this.startWorker();
  }

  /* --------------------------------------------------------------------------
   * worker 生命周期（原版 Bz / Rz 的复刻）
   * ------------------------------------------------------------------------ */

  /** 直载 app:// 脚本；抛错则改走 fetch + Blob。创建期间 backend 先置 'worker'（此时消息排队）。 */
  startWorker() {
    this.backend = 'worker';
    this.attempts += 1;
    let worker = null;
    try {
      worker = new Worker(GRAPH_WORKER_URL, { name: WORKER_NAME });
    } catch (error) {
      worker = null;
    }
    if (worker) this.attachWorker(worker);
    else this.loadWorkerFromSource();
  }

  /** 原版 Rz：取回脚本文本，用 Blob URL 起 worker。 */
  loadWorkerFromSource() {
    fetch(GRAPH_WORKER_URL)
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then((text) => {
        if (this.destroyed) return;
        this.attempts += 1;
        const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
        this.attachWorker(new Worker(url, { name: WORKER_NAME }));
      })
      .catch(() => { if (!this.destroyed) this.useLocal('worker 脚本不可用'); });
  }

  attachWorker(worker: Worker) {
    this.worker = worker;
    this.workerActive = true;
    this.backend = 'worker';
    worker.onmessage = (event) => this.onWorkerMessage(event.data);
    worker.onerror = () => { if (this.worker === worker) this.workerFailed('worker 运行时错误'); };
    /* 替补 worker（直载失败或崩溃后换 Blob）拿不到历史消息：重发镜像状态，避免换 worker 后图谱静止 */
    if (this.attachedOnce && this.kernel.nodes.length) this.resendState(worker);
    this.attachedOnce = true;
    const queued = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of queued) worker.postMessage(message);
    this.noteActivity();
  }

  /** 镜像状态重发：nodes/links/钉住节点/力参数。只用于 worker 更换（原版没有这条路径）。 */
  resendState(worker: Worker) {
    const kernel = this.kernel;
    const nodes: NonNullable<GraphWorkerCommand['nodes']> = {};
    for (const node of kernel.nodes) nodes[node.id] = [node.x, node.y];
    const links = kernel.links.map((link) => [link.source.id, link.target.id]);
    worker.postMessage({ nodes, links, alpha: ALPHA_START, run: true });
    for (const node of kernel.nodes) {
      if (node.fx !== null || node.fy !== null) worker.postMessage({ forceNode: { id: node.id, x: node.fx, y: node.fy } });
    }
    worker.postMessage({
      forces: {
        centerStrength: kernel.centerStrength,
        repelStrength: -kernel.repelStrength,
        linkStrength: kernel.linkStrength,
        linkDistance: kernel.linkDistance,
      },
      alpha: ALPHA_START,
      run: true,
    });
  }

  /** worker 失败：直载失败还有一次 Blob 机会，否则退回本地线程（图谱不因 worker 失败中断）。 */
  workerFailed(reason: string) {
    const worker = this.worker;
    this.worker = null;
    this.workerActive = false;
    if (worker) { try { worker.terminate(); } catch (error) { /* 已停止 */ } }
    if (this.attempts < 2) this.loadWorkerFromSource();
    else this.useLocal(reason);
  }

  /** 本地回退：终止 worker，物理改由渲染回调驱动 tick()。镜像状态已一致，无需搬运。 */
  useLocal(reason: string) {
    if (this.destroyed) return;
    if (reason) this.fallbackReason = reason;
    this.backend = 'local';
    this.workerActive = false;
    this.pendingMessages = [];
    this.workerResults = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) { try { worker.terminate(); } catch (error) { /* 已停止 */ } }
    if (this.onUpdate) this.onUpdate(); // 唤醒渲染循环：本地后端接下来由 tick 推进
  }

  /** 发送消息；worker 未就绪时排队（视图打开时 setData 可能早于 worker 创建完成）。 */
  send(message: GraphWorkerCommand) {
    if (this.destroyed) return;
    if (this.workerActive && this.worker) {
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.workerFailed('worker 消息发送失败');
      }
      return;
    }
    if (this.backend === 'worker') this.pendingMessages.push(message);
  }

  noteActivity() {
    this.lastActivity = performance.now();
  }

  /* --------------------------------------------------------------------------
   * worker → 渲染端
   * ------------------------------------------------------------------------ */

  /** ignore 是 SAB 探测消息；其余是位置帧。冻结（alpha 归零）时既不写坐标也不回调。 */
  onWorkerMessage(data: unknown) {
    if (this.destroyed || !data) return;
    if (typeof data !== 'object') return;
    if ('ignore' in data && data.ignore) { this.workerShared = 'shared' in data && !!data.shared; return; }
    if (!isPositionFrame(data)) return;
    this.workerResults = data;
    this.noteActivity();
    if (this.frozen) return;
    if (!this.applyResult(data)) return;
    if (this.onUpdate) this.onUpdate();
  }

  /**
   * 应用位置缓冲区（原版渲染回调里的消费逻辑）：
   * SAB 用 buffer 末尾 Uint32 版本号守卫，与消息携带的 v 相同即跳过；transfer 的 ArrayBuffer 应用后清空。
   */
  applyResult(data: GraphPositionFrame) {
    const buffer = data.buffer;
    if (buffer instanceof ArrayBuffer) {
      this.workerResults = null;
    } else {
      const version = new Uint32Array(buffer, buffer.byteLength - 4, 1);
      if (version[0] === data.v) return false;
      data.v = version[0];
    }
    const positions = new Float32Array(buffer);
    const ids = data.id;
    for (let i = 0; i < ids.length; i += 1) {
      const node = this.kernel.nodeById.get(ids[i]);
      if (!node) continue;
      node.x = positions[2 * i];
      node.y = positions[2 * i + 1];
      if (node.fx !== null) node.x = node.fx;
      if (node.fy !== null) node.y = node.fy;
    }
    return true;
  }

  /* --------------------------------------------------------------------------
   * 发送侧 API（方法名与旧实现一致）
   * ------------------------------------------------------------------------ */

  /** 原版渲染端 setData：{nodes:{id:[x,y]},links,alpha:.3,run:true}。已有节点传 false（保留 worker 自身坐标与速度），新节点才带初值。 */
  setData(nodeRefs: Array<{ id: string; x: number | null; y: number | null }>, links: [string, string][]) {
    if (this.destroyed) return;
    const nodes: NonNullable<GraphWorkerCommand['nodes']> = {};
    for (const ref of nodeRefs) nodes[ref.id] = this.kernel.nodeById.has(ref.id) ? false : [ref.x ?? 0, ref.y ?? 0];
    const pairs = links.map((pair): [string, string] => [pair[0], pair[1]]);
    this.kernel.setNodes(nodes);
    this.kernel.setLinks(pairs);
    this.kernel.raiseAlpha(ALPHA_START);
    this.send({ nodes, links: pairs, alpha: ALPHA_START, run: true });
    this.noteActivity();
  }

  /** 原版拖拽：{alpha:.3,alphaTarget:.3,run:true,forceNode}；解钉是 {alphaTarget:0,forceNode:{x:null,y:null}}。 */
  setForceNode(id: string, x: number|null, y: number|null, alpha: number|undefined, alphaTarget: number|undefined) {
    if (this.destroyed) return;
    this.kernel.forceNode(id, x, y);
    if (alpha !== undefined) this.kernel.raiseAlpha(alpha);
    if (alphaTarget !== undefined) this.kernel.setAlphaTarget(alphaTarget);
    const message: GraphWorkerCommand = { forceNode: { id, x, y } };
    if (alpha !== undefined) { message.alpha = alpha; message.run = true; }
    if (alphaTarget !== undefined) message.alphaTarget = alphaTarget;
    this.send(message);
    if (alpha !== undefined) this.noteActivity();
  }

  /** 原版 setForces：{forces,alpha:.3,run:true}。 */
  setForces(forces: GraphForceOptions) {
    if (this.destroyed) return;
    this.kernel.setForces(forces);
    this.kernel.raiseAlpha(ALPHA_START);
    this.send({ forces, alpha: ALPHA_START, run: true });
    this.noteActivity();
  }

  /** 原版 run 消息的语义：worker 侧只做唤醒，这里同时抬高镜像 alpha。 */
  run() {
    if (this.destroyed) return;
    this.kernel.raiseAlpha(ALPHA_START);
    this.send({ alpha: ALPHA_START, run: true });
    this.noteActivity();
  }

  /* --------------------------------------------------------------------------
   * 状态（alpha/力参数是内核字段的直通；graph.js 直接写 alpha 冻结模拟）
   * ------------------------------------------------------------------------ */

  get alpha() { return this.kernel.alpha; }
  set alpha(value) { this.kernel.alpha = value; }
  get alphaTarget() { return this.kernel.alphaTarget; }
  set alphaTarget(value) { this.kernel.alphaTarget = value; }
  get centerStrength() { return this.kernel.centerStrength; }
  set centerStrength(value) { this.kernel.centerStrength = value; }
  get repelStrength() { return this.kernel.repelStrength; }
  set repelStrength(value) { this.kernel.repelStrength = value; }
  get linkStrength() { return this.kernel.linkStrength; }
  set linkStrength(value) { this.kernel.linkStrength = value; }
  get linkDistance() { return this.kernel.linkDistance; }
  set linkDistance(value) { this.kernel.linkDistance = value; }

  /** alpha 已低且没有加速目标：主线程冻结（不写坐标、不回调）。 */
  get frozen() {
    return this.kernel.alpha <= ALPHA_MIN && this.kernel.alphaTarget === 0;
  }

  /**
   * 沉降完成：本地后端看内核 alpha；worker 后端看「最近 ~250ms 无新位置且无加速目标」
   * （worker 只在 alpha > .001 时发布位置，静默即停摆）。
   */
  get finished() {
    if (this.destroyed) return true;
    if (this.backend === 'local') return this.kernel.finished;
    return this.kernel.alphaTarget === 0 && performance.now() - this.lastActivity > IDLE_MS;
  }

  /** 本地后端推进一帧（由渲染回调驱动）；worker 后端为 no-op（worker 自己跑循环）。 */
  tick() {
    if (this.destroyed || this.backend !== 'local') return undefined;
    this.localTicks += 1;
    return this.kernel.tick();
  }

  /** 终止 worker、清结果、置 destroyed。重复调用安全。 */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onUpdate = null;
    this.workerResults = null;
    this.pendingMessages = [];
    this.workerActive = false;
    const worker = this.worker;
    this.worker = null;
    if (worker) { try { worker.terminate(); } catch (error) { /* 已停止 */ } }
  }
}
