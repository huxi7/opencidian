/**
 * [INPUT]: 依赖 ./graph-force.js 的 ForceKernel 与 ALPHA_MIN/ALPHA_START。
 * [OUTPUT]: 无导出；作为独立 Worker 脚本运行（esbuild → dist/graph-sim-worker.js），实现原版 /sim.js 的消息协议与位置发布。
 * [POS]: 图谱力学线程。渲染端 graph-simulation.js 门面通过 app:// opensidian.app/dist/graph-sim-worker.js 加载它。
 *        协议：nodes/links/forceNode/forces/alpha/alphaTarget/run → {id,buffer,v}；SharedArrayBuffer 可用时发布 SAB（末尾 Uint32 版本号），否则 transfer ArrayBuffer。
 *        与原版 sim.js 的差异：物理内核是本仓库的 JS/Barnes-Hut（graph-force.js），不复刻其内嵌 WASM；无节点时不空转（原版 60fps 空转）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ForceKernel, ALPHA_MIN } from './graph-force.js';

const FRAME_MS = 1000 / 60; // 原版 X
const kernel = new ForceKernel();
let timer = null;

/* SAB 探测（原版：try { new SharedArrayBuffer(1); postMessage({ignore:true,shared}) } 成功即用 SAB） */
let sharedBuffer = null;
let useShared = false;
if (typeof SharedArrayBuffer === 'function') {
  try {
    const probe = new SharedArrayBuffer(1);
    postMessage({ ignore: true, shared: probe });
    useShared = true;
  } catch (error) {
    useShared = false;
  }
}

/** 填位置：ids[i] 对应 buffer 的 [2i, 2i+1]（原版 L）。 */
function fillPositions(buffer) {
  const positions = new Float32Array(buffer);
  const ids = new Array(kernel.nodes.length);
  for (let i = 0; i < kernel.nodes.length; i += 1) {
    const node = kernel.nodes[i];
    ids[i] = node.id;
    positions[2 * i] = node.x;
    positions[2 * i + 1] = node.y;
  }
  return ids;
}

/** 发布一帧位置（原版 Y）。 */
function publish() {
  if (useShared) {
    const size = 4 * kernel.nodes.length * 2 + 4;
    if (!sharedBuffer || sharedBuffer.byteLength !== size) sharedBuffer = new SharedArrayBuffer(size);
    const ids = fillPositions(sharedBuffer);
    const version = new Uint32Array(sharedBuffer, sharedBuffer.byteLength - 4, 1);
    const v = version[0];
    version[0] += 1;
    postMessage({ id: ids, buffer: sharedBuffer, v });
    return;
  }
  const buffer = new ArrayBuffer(4 * kernel.nodes.length * 2);
  const ids = fillPositions(buffer);
  postMessage({ id: ids, buffer }, [buffer]);
}

/** 唤醒循环（原版 P）。 */
function wake() {
  if (!timer) timer = setTimeout(frame, FRAME_MS);
}

/** 一帧（原版 W）：先排下一帧，再衰减 alpha、跑物理、发布位置；alpha 降到阈值后自停。 */
function frame() {
  timer = null;
  if (kernel.alpha <= ALPHA_MIN) return;
  if (!kernel.nodes.length) return; // 无节点不空转：等下次 run 唤醒
  wake();
  kernel.tick();
  publish();
}

/* 原版 onmessage 逐条复刻 */
self.onmessage = (event) => {
  const data = event.data || {};
  if (data.nodes) kernel.setNodes(data.nodes);
  if (data.links) kernel.setLinks(data.links);
  if (data.forceNode) kernel.forceNode(data.forceNode.id, data.forceNode.x, data.forceNode.y);
  if (data.forces !== undefined) kernel.setForces(data.forces);
  if (data.alpha !== undefined) kernel.raiseAlpha(data.alpha);
  if (data.alphaTarget !== undefined) kernel.setAlphaTarget(data.alphaTarget);
  if (data.run !== undefined) wake();
};
