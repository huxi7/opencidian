/**
 * [INPUT]: 真实 Electron V8 堆、DOM、事件订阅、Worker 与工作区生命周期。
 * [OUTPUT]: 返回 {pass,count,checks,metrics}；强制 GC 后比较重复开关前后的堆与资源。
 * [POS]: 长期运行回归。区别于使用 DOM 替身的工作区逻辑单测。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  require('v8').setFlagsFromString('--expose_gc');
  const gc = require('vm').runInNewContext('gc');
  check(typeof gc === 'function', '使用真实 V8 GC 测量堆');
  const activeWorkers = new Set(), WorkerClass = window.Worker;
  let workerCreated = 0;
  window.Worker = class extends WorkerClass {
    constructor(...args) { super(...args); workerCreated++; activeWorkers.add(this); }
    terminate() { activeWorkers.delete(this); return super.terminate(); }
  };
  const events = source => Object.values(source?._events || {}).reduce((sum, values) => sum + values.length, 0);
  const heap = async () => { gc(); await wait(30); gc(); await wait(30); return process.memoryUsage().heapUsed; };
  const resources = () => ({ vault: events(app.vault), metadata: events(app.metadataCache), workspace: events(app.workspace),
    dom: document.querySelectorAll('*').length, workers: activeWorkers.size });
  let metrics;
  try {
    for (let i = 0; i < 25; i++) await app.vault.create('Lifecycle ' + i + '.md', '# Lifecycle ' + i + '\n[[Lifecycle ' + ((i + 1) % 25) + ']]\n');
    const base = await app.vault.create('Lifecycle.base', 'views:\n  - type: table\n    name: Table\n');
    const host = await app.vault.create('Lifecycle host.md', '# Embedded\n\n![[Lifecycle.base]]\n');
    const leaf = app.workspace.getLeaf(true);
    const cycle = async () => {
      await leaf.setViewState({ type: 'bases', state: { file: base.path } }); await wait(30);
      await leaf.setViewState({ type: 'markdown', state: { file: host.path, mode: 'preview' } }); await wait(30);
      await leaf.setViewState({ type: 'graph', state: {} }); await wait(100);
      await leaf.setViewState({ type: 'empty', state: {} }); await wait(80);
    };
    for (let i = 0; i < 4; i++) await cycle();
    await wait(500); const startHeap = await heap(), start = resources();
    for (let i = 0; i < 30; i++) {
      await cycle();
      if (i % 5 === 0) { await app.plugins.disableInternalPlugin('bases'); await app.plugins.enableInternalPlugin('bases'); }
    }
    await wait(1000); const endHeap = await heap(), end = resources();
    metrics = { cycles: 30, workerCreated, startHeap, endHeap, growth: endHeap - startHeap, start, end };
    check(workerCreated >= 30, '压力循环创建真实 Worker：' + workerCreated);
    check(end.workers === 0, '关闭全部图谱后没有存活 Worker');
    check(end.vault <= start.vault, '反复开关不累积库订阅：' + start.vault + '→' + end.vault);
    check(end.metadata <= start.metadata, '反复开关不累积元数据订阅：' + start.metadata + '→' + end.metadata);
    check(end.workspace <= start.workspace, '反复开关不累积工作区订阅：' + start.workspace + '→' + end.workspace);
    check(end.dom <= start.dom + 10, '关闭后 DOM 恢复基线：' + start.dom + '→' + end.dom);
    check(!document.querySelector('.graph-view-container canvas, .bases-virtual-spacer'), '关闭移除图谱与数据库渲染节点');
    check(endHeap - startHeap < 16 * 1024 * 1024, '30 轮强制 GC 后堆增长 <16MiB：' + ((endHeap - startHeap) / 1048576).toFixed(2) + 'MiB');
    await app.workspace.openFile(host);
    check(app.workspace.activeLeaf.view.editor.getValue().includes('Embedded'), '压力循环后编辑器仍可用');
  } finally { for (const worker of activeWorkers) worker.terminate(); window.Worker = WorkerClass; }
  return { pass: true, count: checks.length, checks, metrics };
})();
