/*
 * [INPUT]: OBS_ACT eval 注入；由 run.mjs 生成的 obs-copy-graph-perf-* 临时库；OBS_GRAPH_PERF_NODES 为节点数。
 * [OUTPUT]: 返回 {pass, role, nodes, edges, openMs, tickMs, fps, disposed}；同时写 <vault>/.obs-copy-graph-perf.json。
 * [POS]: 图谱性能基线场景：测打开耗时、力学单 tick 耗时、沉降期帧率与关闭后的资源释放。先记录结果，再决定优化。
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
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (label, predicate, timeout = 240000) => {
    const end = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > end) throw new Error('timeout: ' + label);
      await delay(50);
    }
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
  // 力学单 tick 成本：自适应采样（首 tick 已慢时不再叠加样本）
  const timeTicks = (k) => {
    const start = performance.now();
    for (let i = 0; i < k; i += 1) sim.tick();
    return (performance.now() - start) / k;
  };
  const firstTick = timeTicks(1);
  const tickMs = firstTick < 100 ? timeTicks(4) : firstTick;
  // 沉降期帧率：统计 1.5 秒内主线程实际完成的 rAF 帧数（渲染器同窗口持续 tick）
  let frames = 0;
  await new Promise((resolve) => {
    const end = performance.now() + 1500;
    const step = () => { frames += 1; if (performance.now() < end) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  });
  const fps = frames / 1.5;
  // 关闭并核对释放
  await leaf.setViewState({ type: 'empty' });
  await delay(250);
  const disposed = {
    destroyed: renderer.destroyed === true,
    canvasDetached: !renderer.canvasEl.isConnected,
    timerCleared: renderer.renderTimer === null,
    domCleared: !document.querySelector('.graph-view-container canvas'),
  };
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
    tickMs: Number(tickMs.toFixed(2)),
    fps: Number(fps.toFixed(1)),
    disposed,
    count: 4,
  };
  fs.writeFileSync(nodePath.join(root, '.obs-copy-graph-perf.json'), JSON.stringify(report, null, 2));
  return report;
})();
