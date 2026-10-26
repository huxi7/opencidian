/**
 * [INPUT]: esbuild、Node 断言与图谱力学门面。
 * [OUTPUT]: 输出 {pass,count,checks}，验证线程协议和位置回执。
 * [POS]: 图谱纯逻辑回归。使用内存 Worker，不启动 Electron。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-graph-simulation-'));
const checks = [];
const check = (name, action) => { action(); checks.push(name); };
const frame = (ids, positions) => ({ id: ids, buffer: new Float32Array(positions).buffer });
class MemoryWorker {
  messages = [];
  terminated = false;
  postMessage(message) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
}

try {
  const outfile = path.join(temporary, 'simulation.cjs');
  await build({ entryPoints: [path.join(root, 'src/renderer/plugins-core/graph-simulation.ts')], bundle: true,
    platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  const { ForceSim } = createRequire(import.meta.url)(outfile);
  const sim = new ForceSim({ forceLocal: true });
  check('指定本地模式不创建 Worker', () => assert.equal(sim.backend, 'local'));
  sim.setData([{ id: 'A', x: 12, y: 24 }, { id: 'B', x: 40, y: 80 }], [['A', 'B']]);
  check('节点与连线共享同一力学对象', () => {
    assert.equal(sim.kernel.links[0].source, sim.nodeById.get('A'));
    assert.equal(sim.kernel.links[0].target, sim.nodeById.get('B'));
  });
  const node = sim.nodeById.get('A');
  sim.setData([{ id: 'A', x: 900, y: 900 }, { id: 'B', x: 0, y: 0 }], [['A', 'B']]);
  check('已有节点保留对象、坐标与速度', () => {
    assert.equal(sim.nodeById.get('A'), node);
    assert.deepEqual([node.x, node.y], [12, 24]);
  });
  let updates = 0;
  sim.onUpdate = () => { updates++; };
  sim.onWorkerMessage(frame(['A', 'B'], [1, 2, 3, 4]));
  check('位置回执按节点 ID 应用并唤醒一次', () => {
    assert.deepEqual([node.x, node.y], [1, 2]);
    assert.equal(updates, 1);
    assert.equal(sim.workerResults, null);
  });
  sim.setForceNode('A', 0, 0, 0.3, 0.3);
  sim.onWorkerMessage(frame(['A'], [20, 30]));
  check('固定坐标为零时不被 Worker 回执覆盖', () => assert.deepEqual([node.x, node.y], [0, 0]));
  sim.setForceNode('A', null, null, undefined, 0);
  sim.onWorkerMessage(frame(['A'], [20, 30]));
  check('解除固定后恢复 Worker 坐标', () => assert.deepEqual([node.x, node.y], [20, 30]));

  for (const [name, invalid] of [
    ['空回执', null], ['非对象回执', 1], ['缺节点表', { buffer: new ArrayBuffer(8) }],
    ['非字符串节点', { id: [1], buffer: new ArrayBuffer(8) }],
    ['伪造缓冲区', { id: ['A'], buffer: { byteLength: 8 } }],
    ['短缓冲区', { id: ['A'], buffer: new ArrayBuffer(4) }],
    ['未对齐缓冲区', { id: ['A'], buffer: new ArrayBuffer(9) }],
  ]) {
    check(name + '不改坐标、不触发更新', () => {
      const before = updates;
      assert.doesNotThrow(() => sim.onWorkerMessage(invalid));
      assert.deepEqual([node.x, node.y], [20, 30]);
      assert.equal(updates, before);
    });
  }
  sim.onWorkerMessage(frame(['removed', 'A'], [90, 90, 5, 6]));
  check('迟到的已删除节点不重新进入节点表', () => {
    assert.equal(sim.nodeById.has('removed'), false);
    assert.deepEqual([node.x, node.y], [5, 6]);
  });
  const shared = new SharedArrayBuffer(12);
  const positions = new Float32Array(shared, 0, 2);
  const version = new Uint32Array(shared, 8, 1);
  positions.set([7, 8]); version[0] = 1;
  const message = { id: ['A'], buffer: shared, v: 0 };
  sim.onWorkerMessage(message);
  check('共享缓冲区读取新版本', () => { assert.deepEqual([node.x, node.y], [7, 8]); assert.equal(message.v, 1); });
  check('共享缓冲区重复版本不重复应用', () => {
    const before = updates;
    positions.set([9, 10]); sim.onWorkerMessage(message);
    assert.deepEqual([node.x, node.y], [7, 8]); assert.equal(updates, before);
  });
  version[0] = 2; sim.onWorkerMessage(message);
  check('共享版本递增后继续更新', () => assert.deepEqual([node.x, node.y], [9, 10]));
  sim.alpha = 0; sim.alphaTarget = 0;
  check('冻结时不写坐标也不唤醒渲染', () => {
    const before = updates; sim.onWorkerMessage(frame(['A'], [50, 60]));
    assert.deepEqual([node.x, node.y], [9, 10]); assert.equal(updates, before);
  });
  sim.run();
  const worker = new MemoryWorker();
  sim.attachWorker(worker);
  sim.setForceNode('A', 0, 0, 0.3, 0.3);
  const replacement = new MemoryWorker();
  sim.resendState(replacement);
  check('替补 Worker 收到节点、连线与零坐标固定状态', () => {
    assert.deepEqual(replacement.messages[0].links, [['A', 'B']]);
    assert.deepEqual(replacement.messages[1].forceNode, { id: 'A', x: 0, y: 0 });
    assert.equal(replacement.messages[2].forces.linkDistance, sim.linkDistance);
  });
  check('Worker 模式不在主线程重复积分', () => {
    const ticks = sim.localTicks; sim.tick(); assert.equal(sim.localTicks, ticks);
  });
  sim.useLocal('测试回退');
  check('本地回退释放 Worker 且保留节点状态', () => {
    assert.equal(worker.terminated, true); assert.equal(sim.backend, 'local'); assert.equal(sim.nodeById.get('A'), node);
    const ticks = sim.localTicks; sim.tick(); assert.equal(sim.localTicks, ticks + 1);
  });
  sim.destroy();
  check('销毁后回执与命令不修改力学状态', () => {
    const before = [node.x, node.y]; sim.onWorkerMessage(frame(['A'], [90, 90]));
    sim.setData([], []); sim.destroy(); assert.deepEqual([node.x, node.y], before); assert.equal(sim.nodeById.get('A'), node);
  });
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
