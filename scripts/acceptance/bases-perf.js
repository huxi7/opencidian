/**
 * [INPUT]: 带验收标记的隔离 Electron 库；真实千条和万条 Markdown 文件。
 * [OUTPUT]: 返回 {pass,count,checks,metrics}；查询、DOM 预算、滚动和修改超时即失败。
 * [POS]: Bases 大库回归。验证窗口化真实查询，不以合成行或耗时日志替代断言。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs'), path = require('path');
  const checks = [], metrics = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label, timeout = 15000) => { const end = performance.now() + timeout; while (!predicate()) { if (performance.now() > end) throw Error(label); await delay(25); } };
  const rootPath = fs.realpathSync(app.vaultPath);
  if (!fs.existsSync(path.join(rootPath, '.obs-copy-acceptance-fixture')) || !rootPath.includes('obs-copy-bases-perf-')) throw Error('仅允许独立 Bases 性能验收库');
  await app.plugins.enableInternalPlugin('bases');
  const makeFiles = async (folderName, count) => {
    // 批量准备真实磁盘夹具时暂停监听，避免一万次 create 重建全库索引。
    // 这不计入打开预算；准备完成恢复真实监听，再验证修改刷新。
    if (app.vault.watcher) { await app.vault.watcher.close(); app.vault.watcher = null; }
    const folder = await app.vault.createFolder(folderName);
    for (let index = 0; index < count; index++) fs.writeFileSync(path.join(rootPath, folderName, 'Note-' + String(index).padStart(5, '0') + '.md'), `---\nscore: ${index}\nstatus: ${index % 2 ? 'open' : 'done'}\ndescription: ${JSON.stringify('variable height '.repeat((index % 4) * 6 + 1))}\n---\n# Note ${index}\n`);
    await app.vault.recurseLoad(folder);
    const files = app.vault.getMarkdownFiles().filter(file => file.path.startsWith(folderName + '/'));
    for (let offset = 0; offset < files.length; offset += 100) await Promise.all(files.slice(offset, offset + 100).map(file => app.metadataCache.parseFile(file, true)));
    app.metadataCache.rebuildIndices(); app.vault.watch();
    await delay(200);
    check(files.length === count && files.every(file => app.metadataCache.getFileCache(file)?.frontmatter?.score >= 0), count + ' 条真实磁盘笔记及属性完成索引');
  };
  for (const count of [1000, 10000]) {
    const folder = 'Perf' + count; await makeFiles(folder, count);
    const source = `filters: 'file.inFolder("${folder}")'\nviews:\n  - type: table\n    name: Table\n    order: [file.name, note.score, note.status, note.description]\n    sort:\n      - property: note.score\n        direction: ASC\n`;
    const file = await app.vault.create(folder + '.base', source);
    const started = performance.now(), leaf = await app.workspace.openFile(file), c = leaf.view.controller;
    await c.ready; const openMs = performance.now() - started;
    check(c.result.rows.length === count && c.result.total === count, count + ' 条数据库查询不截断数据');
    check(openMs < (count === 1000 ? 3000 : 10000), count + ' 条打开时间低于 ' + (count === 1000 ? '3000' : '10000') + 'ms 预算');
    let body = c.container.querySelector('.bases-tbody'), wrap = body.closest('.bases-table-container');
    check(body.dataset.virtualTotal === String(count), count + ' 条表格启用真实窗口化');
    check(body.querySelectorAll('tr[data-path]').length <= 120, count + ' 条挂载行数不超过 120');
    check(body.querySelector('[data-path]')?.dataset.path === folder + '/Note-00000.md', count + ' 条首窗口显示首条真实笔记');
    const scrollStart = performance.now(); wrap.scrollTop = wrap.scrollHeight; wrap.dispatchEvent(new Event('scroll'));
    await until(() => [...body.querySelectorAll('tr[data-path]')].some(row => row.dataset.path === folder + '/Note-' + String(count - 1).padStart(5, '0') + '.md'), '滚到底部显示末条真实笔记', 1000);
    const scrollMs = performance.now() - scrollStart;
    check(scrollMs < 1000, count + ' 条滚动换窗低于 1000ms 预算');
    check(body.querySelectorAll('tr[data-path]').length <= 120, count + ' 条末窗口仍保持 DOM 行数预算');
    const renderStart = performance.now(); c.render(); const renderMs = performance.now() - renderStart;
    check(renderMs < (count === 1000 ? 1500 : 5000), count + ' 条重复查询和绘制低于 ' + (count === 1000 ? '1500' : '5000') + 'ms 预算');
    await c.patchView('filters', 'score >= ' + (count - 10));
    check(c.result.rows.length === 10 && c.result.rows[0].file.basename === 'Note-' + String(count - 10).padStart(5, '0'), count + ' 条大库筛选保留精确数值顺序');
    await c.patchView('limit', 3); check(c.result.rows.length === 3 && c.result.total === 10, count + ' 条筛选与 limit 交集正确');
    await c.patchView('limit', 0); await c.patchView('filters', null);
    const changed = app.vault.getFileByPath(folder + '/Note-00000.md');
    const updateStart = performance.now(); await app.fileManager.processFrontMatter(changed, fm => { fm.score = count + 1; });
    await until(() => c.result.rows.at(-1)?.file.path === changed.path, '属性修改后排序增量更新', 10000);
    const updateMs = performance.now() - updateStart;
    check(updateMs < 10000, count + ' 条属性修改后刷新低于 10000ms 预算');
    check(c.container.querySelectorAll('.bases-tbody tr[data-path]').length <= 120, count + ' 条修改后不展开全部 DOM');
    metrics.push({ count, openMs: Math.round(openMs), renderMs: Math.round(renderMs), scrollMs: Math.round(scrollMs), updateMs: Math.round(updateMs), mounted: c.container.querySelectorAll('.bases-tbody tr[data-path]').length });
    for (const type of ['list', 'cards', 'kanban']) {
      await c.patchView('type', type);
      if (type === 'kanban') await c.patchView('groupBy', { property: 'note.status', direction: 'ASC' });
      const selector = type === 'list' ? '.bases-list-item' : type === 'cards' ? '.bases-cards-item' : '.bases-kanban-item';
      const mounted = c.container.querySelectorAll(selector).length;
      check(mounted > 0 && mounted <= (type === 'kanban' ? 160 : 120), count + ' 条 ' + type + ' 布局挂载数量有界');
      const virtuals = [...c.container.querySelectorAll('[data-virtual-total]')];
      check(virtuals.length > 0 && virtuals.reduce((sum, node) => sum + Number(node.dataset.virtualTotal), 0) === count, count + ' 条 ' + type + ' 布局不丢失真实结果');
      if (type !== 'list') check(c.container.querySelector('.bases-virtual-band'), count + ' 条 ' + type + ' 布局使用实测可变高度网格行');
      const viewport = type === 'kanban' ? virtuals.find(node => node.closest('.bases-kanban-column')?.querySelector('.bases-group-value')?.textContent === 'done') : virtuals.at(-1); viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await until(() => Number(viewport.dataset.virtualEnd) === Number(viewport.dataset.virtualTotal), type + ' 滚动至末尾 ' + count + ' ' + JSON.stringify({ start: viewport.dataset.virtualStart, end: viewport.dataset.virtualEnd, total: viewport.dataset.virtualTotal, top: viewport.scrollTop, height: viewport.scrollHeight, viewport: viewport.clientHeight }), 1000);
      check(c.container.querySelectorAll(selector).length <= (type === 'kanban' ? 160 : 120), count + ' 条 ' + type + ' 滚到底部仍有界');
      check([...viewport.querySelectorAll('[data-path]')].some(node => node.dataset.path === folder + '/Note-00000.md'), count + ' 条 ' + type + ' 末窗口显示修改后分数最高笔记');
      if (type === 'kanban') await c.patchView('groupBy', null);
    }
    const groupMetrics = [];
    await c.patchView('groupBy', { property: 'note.score', direction: 'ASC' });
    for (const type of ['table', 'list', 'cards', 'kanban']) {
      const started = performance.now(); await c.patchView('type', type);
      const outer = c.container.querySelector('.bases-groups-virtual');
      check(outer?.dataset.virtualGroups === String(count), count + ' 个唯一分组 ' + type + ' 启用组层窗口化');
      check(c.container.querySelectorAll('.bases-group-heading').length <= 20 && c.container.querySelectorAll('*').length <= 2500, count + ' 个分组 ' + type + ' 整页 DOM 与组数量有硬上界');
      const openGroupsMs = performance.now() - started;
      check(openGroupsMs < 10000, count + ' 个分组 ' + type + ' 打开低于10000ms预算');
      if (type === 'kanban') outer.scrollLeft = outer.scrollWidth; else outer.scrollTop = outer.scrollHeight;
      outer.dispatchEvent(new Event('scroll'));
      await until(() => [...outer.querySelectorAll('.bases-group-value')].some(node => node.textContent === String(count + 1)), count + ' 个分组 ' + type + ' 滚动至末组', 1500);
      check(c.container.querySelectorAll('.bases-group-heading').length <= 20 && c.container.querySelectorAll('*').length <= 2500, count + ' 个分组 ' + type + ' 末组不展开全部 DOM');
      check(c.virtualizers.size <= 60, count + ' 个分组 ' + type + ' 换窗销毁旧组虚拟器');
      groupMetrics.push({ type, openMs: Math.round(openGroupsMs), mountedGroups: c.container.querySelectorAll('.bases-group-heading').length, domNodes: c.container.querySelectorAll('*').length, virtualizers: c.virtualizers.size });
    }
    metrics.at(-1).groups = groupMetrics;
    await c.patchView('groupBy', null);
    await c.patchView('type', 'table');
    const activeVirtualizers = [...c.virtualizers];
    await leaf.setViewState({ type: 'empty' });
    check(activeVirtualizers.length > 0 && activeVirtualizers.every(handle => handle.destroyed) && c.virtualizers.size === 0, count + ' 条关闭销毁所有虚拟器及其观察器/滚动监听');
    check(c.closed && c.refs.length === 0, count + ' 条视图关闭释放订阅');
  }
  fs.writeFileSync(path.join(rootPath, '.opensidian-bases-perf.json'), JSON.stringify(metrics, null, 2));
  return { pass: true, count: checks.length, checks, metrics };
})();
