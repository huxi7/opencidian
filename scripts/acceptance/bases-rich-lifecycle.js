/**
 * [INPUT]: 临时库、真实富值宿主、挂起读盘与数学初始化、原生 MutationObserver 计数。
 * [OUTPUT]: {pass,count,checks}；验证异步取消、嵌入订阅释放、重绘与虚拟换窗。
 * [POS]: 富值资源回归；只在 --no-screenshot 的隔离 Electron 执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message) => { for (let i = 0; i < 600; i++) { if (await fn()) return; await wait(25); } throw Error(message); };
  const yaml = require('js-yaml');
  await app.plugins.enableInternalPlugin('bases');
  await app.vault.createFolder('Race');
  const target = await app.vault.create('Race/Target.md', '# Target\n\n**Nested content**\n');
  await app.vault.create('Race/Row.md', '# Row\n');
  await app.vault.create('Inner.base', yaml.dump({ filters: 'file.path == "Race/Target.md"', views: [{ type: 'table', name: 'Inner', order: ['file.name'] }] }));
  await until(() => app.metadataCache.getFileCache(target), '目标笔记完成索引');
  const source = '![[Target]]\n\n![[Inner.base]]\n\n$x^2$\n\n```mermaid\ngraph LR\n A[Start] --> B[End]\n```';
  const file = await app.vault.create('Lifecycle.base', yaml.dump({ filters: 'file.path == "Race/Row.md"', formulas: { body: 'markdown(' + JSON.stringify(source) + ')' }, views: [{ type: 'table', name: 'Cards', order: ['formula.body'] }] }));
  const NativeObserver = window.MutationObserver, activeObservers = new Set();
  window.MutationObserver = class extends NativeObserver {
    observe(...args) { activeObservers.add(this); return super.observe(...args); }
    disconnect() { activeObservers.delete(this); return super.disconnect(); }
  };
  const originalRead = app.vault.cachedRead;
  const append = document.head.appendChild;
  let releaseRead, releaseMath, mathHeld = false, readHeld = false, conversions = 0;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const mathGate = new Promise(resolve => { releaseMath = resolve; });
  app.vault.cachedRead = function (item) {
    if (item.path === target.path) { readHeld = true; return readGate.then(() => originalRead.call(this, item)); }
    return originalRead.call(this, item);
  };
  document.head.appendChild = function (node) {
    if (node.id === 'obsidian-mathjax-script') {
      const loaded = node.onload;
      node.onload = event => window.MathJax.startup.promise.then(() => {
        mathHeld = true;
        const convert = window.MathJax.tex2chtml;
        window.MathJax.tex2chtml = function (...args) { conversions++; return convert.apply(this, args); };
        mathGate.then(() => loaded(event));
      });
    }
    return append.call(this, node);
  };
  try {
    const leaf = await app.workspace.openFile(file), controller = leaf.view.controller;
    await until(() => readHeld && mathHeld, '读盘和数学初始化均已挂起');
    const retired = controller.container.querySelector('.bases-rich-markdown');
    check(!!retired && !retired.richRenderSignal.aborted, '富值拥有活动取消信号');
    retired.remove();
    await until(() => retired.richRenderSignal.aborted, '移出 DOM 自动取消');
    check(retired.richRenderSignal.aborted, '仅移除 DOM 即取消富值任务');
    const settled = await Promise.race([retired.ready.then(() => true), wait(500).then(() => false)]);
    check(settled, '不等待底层读盘或数学初始化即可结算宿主 ready');
    check(retired.childNodes.length === 0, '销毁清空旧宿主内容');
    check(!controller.richValues.has(retired), '控制器不再持有移除的富值');
    for (const node of [...controller.richValues]) node._baseRichCleanup();
    releaseRead(); releaseMath();
    app.vault.cachedRead = originalRead; document.head.appendChild = append;
    await wait(400);
    check(conversions === 0, '取消的数学任务不调用 tex2chtml');
    check(retired.childNodes.length === 0, '旧异步读盘完成后不重新挂载内容');
    check(!retired.querySelector('[data-base-embed]'), '旧流水线不在取消后创建数据库嵌入');
    await controller.patchView('type', 'cards');
    const stableValue = async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const candidate = controller.container.querySelector('.bases-rich-markdown');
        const inner = candidate?.querySelector('[data-base-embed]')?.basesController;
        if (candidate?.querySelector('mjx-container') && candidate.querySelector('.mermaid svg') && inner && !inner.closed && !candidate.richRenderSignal.aborted) {
          await wait(200);
          if (candidate === controller.container.querySelector('.bases-rich-markdown') && !candidate.richRenderSignal.aborted) return candidate;
        }
        await wait(25);
      }
      return null;
    };
    let current = await stableValue();
    check(!!current, '卡片数学和图表宿主连续 200ms 保持活动且可见');
    await current.ready;
    check(!!current.querySelector('mjx-container'), '新宿主数学正常渲染');
    check(current.textContent.includes('Nested content'), '新宿主笔记嵌入正常渲染');
    check(!!current.querySelector('.mermaid svg'), '新宿主图表正常渲染');
    const inner = current.querySelector('[data-base-embed]').basesController;
    check(!!inner && !inner.closed, '新宿主数据库嵌入拥有真实控制器');
    const baselineObservers = activeObservers.size;
    for (let i = 0; i < 5; i++) {
      const previous = current;
      await controller.refresh();
      current = await stableValue();
      check(!!current, '重绘 ' + i + ' 新宿主数学、图表和数据库嵌入稳定');
      await current.ready;
      check(previous.richRenderSignal.aborted && previous.childNodes.length === 0, '重绘 ' + i + ' 取消并清空旧宿主');
    }
    check(activeObservers.size === baselineObservers, '反复重绘不增加活动 MutationObserver');
    check(controller.richValues.size === 1, '反复重绘只保留当前富值');
    const finalInner = current.querySelector('[data-base-embed]').basesController;
    const root = controller.container;
    root.remove();
    await until(() => current.richRenderSignal.aborted && finalInner.closed, '移除整个容器释放子控制器');
    check(finalInner.closed && finalInner.refs.length === 0, '移除整个容器注销嵌入事件订阅');
    check(controller.richValues.size === 0, '移除整个容器释放富值集合');
    await until(() => activeObservers.size < baselineObservers, '销毁断开观察器');
    check(activeObservers.size < baselineObservers, '销毁断开富值和数据库嵌入观察器');
    await leaf.detach();
    await app.vault.createFolder('Virtual');
    await Promise.all(Array.from({ length: 220 }, (_, i) => app.vault.create('Virtual/n' + String(i).padStart(3, '0') + '.md', '# Row ' + i + '\n')));
    const virtualFile = await app.vault.create('Virtual.base', yaml.dump({ filters: 'file.inFolder("Virtual")', formulas: { body: 'markdown("**value**")' }, views: [{ type: 'table', name: 'Table', order: ['formula.body'] }] }));
    const virtualLeaf = await app.workspace.openFile(virtualFile), virtual = virtualLeaf.view.controller;
    await until(() => virtual.result?.rows.length === 220 && virtual.container.querySelectorAll('.bases-rich-markdown').length > 0, '虚拟富值表格挂载');
    const previous = [...virtual.container.querySelectorAll('.bases-rich-markdown')];
    const handle = [...virtual.virtualizers][0]; handle.scrollTo(180);
    await until(() => previous.every(node => node.richRenderSignal.aborted), '虚拟换窗取消旧值');
    check(previous.every(node => node.richRenderSignal.aborted && node.childNodes.length === 0), '虚拟换窗释放全部旧富值');
    check(virtual.richValues.size === virtual.container.querySelectorAll('.bases-rich-markdown').length, '虚拟换窗资源数等于当前 DOM 数');
    const last = [...virtual.richValues];
    await virtualLeaf.detach();
    await until(() => last.every(node => node.richRenderSignal.aborted), '关闭虚拟表格取消富值');
    check(last.every(node => node.richRenderSignal.aborted), '关闭虚拟表格释放最后一批富值');
    check(virtual.richValues.size === 0, '关闭虚拟表格清空所有资源');
    return { pass: true, count: checks.length, checks };
  } finally {
    app.vault.cachedRead = originalRead; document.head.appendChild = append;
    releaseRead(); releaseMath(); window.MutationObserver = NativeObserver;
  }
})()
