/*
 * [INPUT]: OBS_ACT eval 注入；由 run.mjs 生成的 obs-copy-graph-perf-* 临时库；OBS_GRAPH_PERF_NODES 为节点数。
 * [OUTPUT]: 返回真实 checks、打开耗时、Worker 发布与帧率、释放状态，并写临时库报告。
 * [POS]: 图谱性能门槛。Worker 后端不把空 tick 当物理耗时；释放状态逐项断言。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs');
  const nodePath = require('path');
  const expected = parseInt(process.env.OBS_GRAPH_PERF_NODES || '0', 10);
  const root = fs.realpathSync(app.vault.adapter.getBasePath());
  const temporaryRoots = ['/tmp', require('os').tmpdir()].map((p) => fs.realpathSync(p));
  if (!expected || !temporaryRoots.some((p) => root.startsWith(p + nodePath.sep)) ||
      !/obs-copy-graph-perf-/.test(root)) {
    throw new Error('graph-perf 只在生成的临时库运行，且需要 OBS_GRAPH_PERF_NODES');
  }
  const checks = [];
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (label, predicate, timeout = 240000) => {
    const end = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > end) throw new Error('timeout: ' + label);
      await delay(50);
    }
    checks.push(label);
  };
  await wait('vault scan completes', () => app.vault.getMarkdownFiles().length === expected);
  // 打开图谱（与用户入口一致：新建叶子 → graph 视图）
  const t0 = performance.now();
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'graph', state: {} });
  const view = leaf.view;
  await wait('graph places every node', () => view.renderer && view.renderer.nodes.length === expected);
  const openMs = performance.now() - t0;
  const renderer = view.renderer;
  const sim = renderer.sim;
  const edges = renderer.links.length;
  check(renderer.nodes.length === expected, '精确节点数=' + expected);
  check(edges === expected * 2, '精确边数=' + edges);
  check(openMs < (expected > 1000 ? 15000 : 5000), '打开耗时符合预算：' + Math.round(openMs) + 'ms');
  // 力学单 tick 成本：自适应采样（首 tick 已慢时不再叠加样本）
  const timeTicks = (k) => {
    const start = performance.now();
    for (let i = 0; i < k; i += 1) sim.tick();
    return (performance.now() - start) / k;
  };
  const firstTick = sim.backend === 'local' ? timeTicks(1) : null;
  const tickMs = firstTick === null ? null : firstTick < 100 ? timeTicks(4) : firstTick;
  if (tickMs !== null) check(tickMs < 250, '本地物理 tick <250ms：' + tickMs.toFixed(2));
  let publications = 0;
  const onUpdate = sim.onUpdate;
  sim.onUpdate = (...args) => { publications++; onUpdate?.(...args); };
  // 沉降期帧率：统计 1.5 秒内主线程实际完成的 rAF 帧数（渲染器同窗口持续 tick）
  let frames = 0;
  await new Promise((resolve) => {
    const end = performance.now() + 1500;
    const step = () => { frames += 1; if (performance.now() < end) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  });
  const fps = frames / 1.5;
  check(fps >= (expected > 1000 ? 5 : 20), '沉降期帧率符合预算：' + fps.toFixed(1));
  if (sim.backend === 'worker') {
    check(publications > 0, 'Worker 在测量窗口发布真实物理位置：' + publications);
    check(sim.localTicks === 0, 'Worker 模式主线程不重复计算物理');
  }
  sim.onUpdate = onUpdate;
  // 关闭并核对释放
  await leaf.setViewState({ type: 'empty' });
  await delay(250);
  const disposed = {
    destroyed: renderer.destroyed === true,
    canvasDetached: !renderer.canvasEl.isConnected,
    timerCleared: renderer.renderTimer === null,
    domCleared: !document.querySelector('.graph-view-container canvas'),
  };
  for (const [key, value] of Object.entries(disposed)) check(value, '关闭释放：' + key);
  check(sim.destroyed === true && sim.worker === null, '关闭终止物理 Worker');
  // 关闭后应用仍可响应：打开一个 md 并读到内容
  const sample = app.vault.getMarkdownFiles()[0];
  const leaf2 = app.workspace.getLeaf(true);
  await leaf2.setViewState({ type: 'markdown', state: { file: sample.path, mode: 'source' } });
  await wait('app responsive after close', () => leaf2.view.editor && leaf2.view.editor.getValue().includes('Node'));
  const report = {
    pass: true,
    role: 'graph-perf',
    nodes: expected,
    edges,
    openMs: Math.round(openMs),
    tickMs: tickMs === null ? null : Number(tickMs.toFixed(2)),
    backend: sim.backend, publications,
    fps: Number(fps.toFixed(1)),
    disposed,
    count: checks.length,
    checks,
  };
  fs.writeFileSync(nodePath.join(root, '.obs-copy-graph-perf.json'), JSON.stringify(report, null, 2));
  return report;
})();
