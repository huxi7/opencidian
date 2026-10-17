/*
 * [INPUT]: OBS_ACT eval 注入；已启用 graph，且 vault 是新建的 graph-vault-* 临时目录。
 * [OUTPUT]: 返回 {role, passed, checks, screenshots}；断言失败会抛错。
 * [POS]: 图谱集成验收；创建独立 fixture，通过 DOM 事件验证交互。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * 截图终态：OBS_GRAPH_SCREEN=global|filter|local|menu，默认 local。
 */
(async () => {
  const fs = require('fs');
  const realVault = fs.realpathSync(app.vaultPath);
  if (!/^\/(?:private\/)?tmp\/obs-copy-acceptance\/graph-vault-[^/]+$/.test(realVault)) {
    throw new Error('只允许新建 /tmp/obs-copy-acceptance/graph-vault-* 独立 vault');
  }
  if (app.vault.getFiles().length) throw new Error('fixture 必须使用空 vault，请每次新建目录');
  const checks = [];
  const assert = (condition, label) => { if (!condition) throw new Error(`graph: ${label}`); checks.push(label); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    const end = Date.now() + 7000;
    while (!predicate()) { if (Date.now() > end) throw new Error(`graph timeout: ${label}`); await delay(25); }
  };
  const nodes = renderer => Object.keys(renderer.nodeLookup).sort();
  const sameNodes = (renderer, expected, label) => assert(nodes(renderer).join('|') === expected.sort().join('|'), label);
  const countMarkdown = () => app.workspace.getLeavesOfType('markdown').length;
  const fixture = {
    'A.md': '---\ntags: [project/root]\n---\n# A\nalpha\n[[B]] [[Missing]] ![[pixel.png]]\n',
    'B.md': '# B\nbeta\n[[C]]\n',
    'C.md': '# C\nterminal\n',
    'D.md': '# D\n[[A]] [[B]]\n',
    'Orphan.md': '# Orphan\nstandalone\n',
    'Board.canvas': '{"nodes":[],"edges":[]}',
  };
  for (const [name, content] of Object.entries(fixture)) await app.vault.create(name, content);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=', 'base64');
  await app.vault.createBinary('pixel.png', png);
  await wait(() => app.metadataCache.getCache('A.md') && app.metadataCache.resolvedLinks['A.md']?.['B.md'], 'fixture 元数据');
  const globalLeaf = app.workspace.getLeaf(true);
  await globalLeaf.setViewState({ type: 'graph', state: {} });
  app.workspace.revealLeaf(globalLeaf);
  const globalView = globalLeaf.view;
  const renderer = globalView.renderer;
  const engine = globalView.dataEngine;
  assert(!!renderer && !!engine, '全局图视图与引擎加载');
  await wait(() => renderer.canvasEl.width > 0 && renderer.canvasEl.height > 0, '真实画布尺寸');
  const search = async value => {
    engine.filterOptions.search.inputEl.value = value;
    engine.filterOptions.search.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    engine.filterOptions.search.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await delay(320);
    await wait(() => !engine.queue, '筛选队列完成');
  };
  engine.setOptions({ showTags: false, showAttachments: false, hideUnresolved: false, showOrphans: true, search: '', close: false });
  await search('');
  sameNodes(renderer, ['A.md', 'B.md', 'C.md', 'D.md', 'Orphan.md', 'Board.canvas', 'Missing'], '默认全局图含 Canvas 与未解析节点');
  engine.setOptions({ showTags: true, showAttachments: true });
  assert(!!renderer.nodeLookup['pixel.png'] && !!renderer.nodeLookup['#project/root'], '附件与标签可见');
  assert(renderer.links.some(link => link.source.id === 'A.md' && link.target.id === 'pixel.png'), '附件连线存在');
  engine.setOptions({ showTags: false, showAttachments: false, hideUnresolved: true, showOrphans: false });
  sameNodes(renderer, ['A.md', 'B.md', 'C.md', 'D.md'], '仅已创建且非孤立节点');
  engine.setOptions({ showOrphans: true });
  await search('tag:project');
  sameNodes(renderer, ['A.md'], 'tag: 筛选命中 frontmatter 嵌套标签');
  await search('-tag:project');
  assert(!renderer.nodeLookup['A.md'] && !!renderer.nodeLookup['B.md'], '负标签筛选剔除根标签笔记');
  await search('content:needle');
  sameNodes(renderer, [], '正文筛选初始为空');
  await app.vault.modify(app.vault.getFileByPath('Orphan.md'), '# Orphan\nneedle\n');
  await wait(() => !!renderer.nodeLookup['Orphan.md'] && !engine.queue, '编辑后刷新筛选');
  sameNodes(renderer, ['Orphan.md'], '编辑后命中集自动刷新');
  await app.vault.rename(app.vault.getFileByPath('Orphan.md'), 'Renamed.md');
  await wait(() => !!renderer.nodeLookup['Renamed.md'] && !renderer.nodeLookup['Orphan.md'] && !engine.queue, '重命名后筛选');
  assert(true, '重命名后节点 id 更新');
  await search('');
  engine.setOptions({ colorGroups: [{ query: 'tag:project', color: { a: 1, rgb: 0xff6633 } }] });
  engine.updateSearch();
  await wait(() => !engine.queue, '颜色组');
  assert(renderer.nodeLookup['A.md'].color?.rgb === 0xff6633, '标签颜色组着色');
  engine.controlsEl.querySelector('.mod-reset').click();
  await delay(320);
  await wait(() => !engine.queue, '重置颜色组');
  assert(!renderer.nodeLookup['A.md'].color, '重置后颜色立即清除');
  engine.setOptions({ close: true });
  engine.setOptions({ close: false });
  assert(!engine.controlsEl.hasClass('is-close'), 'close:false 可展开控制面板');
  engine.controlsEl.querySelector('.mod-close').click();
  assert(engine.controlsEl.hasClass('is-close'), '关闭按钮收起控制面板');
  engine.controlsEl.querySelector('.mod-open').click();
  assert(!engine.controlsEl.hasClass('is-close'), '打开按钮展开控制面板');
  engine.setOptions({ hideUnresolved: true, showTags: false, showAttachments: false });
  await search('');
  renderer.cancelInteraction();
  renderer.setScale(1); renderer.targetScale = 1; renderer.resetPan();
  // 固定初始坐标，避免力模拟随机落点影响同步 DOM 事件断言。
  for (const [index, node] of renderer.nodes.entries()) {
    node.x = index * 160; node.y = index * 90;
    Object.assign(renderer.sim.nodeById.get(node.id), { x: node.x, y: node.y, vx: 0, vy: 0 });
  }
  const a = renderer.nodeLookup['A.md'];
  a.x = a.y = 0;
  Object.assign(renderer.sim.nodeById.get(a.id), { x: 0, y: 0 });
  const point = node => {
    const rect = renderer.canvasEl.getBoundingClientRect();
    return { clientX: rect.left + (node.x * renderer.scale + renderer.panX) / devicePixelRatio,
      clientY: rect.top + (node.y * renderer.scale + renderer.panY) / devicePixelRatio };
  };
  const mouse = (target, type, point, button = 0) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, ...point }));
  const start = point(a);
  mouse(renderer.canvasEl, 'mousemove', start);
  assert(renderer.highlightNode === a, '鼠标悬停命中节点');
  mouse(renderer.canvasEl, 'mousedown', start);
  assert(renderer.dragNode === a, '按下节点开始拖拽');
  const rect = renderer.canvasEl.getBoundingClientRect();
  const outside = { clientX: rect.right + 45, clientY: rect.bottom + 30 };
  mouse(window, 'mousemove', outside);
  assert(renderer.dragMoved && Math.abs(a.fx - ((outside.clientX - rect.left) * devicePixelRatio - renderer.panX) / renderer.scale) < 0.01, '移出画布仍按画布坐标拖动');
  mouse(window, 'mouseup', outside);
  assert(!renderer.dragNode && a.fx === null && renderer.sim.nodeById.get(a.id).fx === null, '释放解除节点固定');
  assert(globalLeaf.view === globalView, '拖拽不会误开笔记');
  const emptyPoint = { clientX: rect.left + 4, clientY: rect.top + 4 };
  const oldPan = renderer.panX;
  mouse(renderer.canvasEl, 'mousedown', emptyPoint);
  assert(renderer.panning, '空白处按下平移');
  mouse(window, 'mousemove', { clientX: emptyPoint.clientX + 40, clientY: emptyPoint.clientY + 30 });
  assert(Math.abs(renderer.panX - oldPan - 40 * devicePixelRatio) < 0.01, '平移按设备像素换算');
  mouse(window, 'mouseup', emptyPoint);
  assert(!renderer.panning && !document.body.hasClass('is-grabbing'), '平移释放清除抓取状态');
  renderer.cancelInteraction();
  const wheelPoint = { clientX: rect.left + rect.width * 0.35, clientY: rect.top + rect.height * 0.4 };
  const anchor = (Math.trunc(wheelPoint.clientX) - rect.left) * devicePixelRatio;
  const worldX = (anchor - renderer.panX) / renderer.scale;
  const oldScale = renderer.scale;
  renderer.canvasEl.dispatchEvent(new WheelEvent('wheel', { ...wheelPoint, deltaY: -120, bubbles: true, cancelable: true }));
  renderer.updateZoom();
  assert(renderer.targetScale > oldScale && Math.abs((anchor - renderer.panX) / renderer.scale - worldX) < 0.001, '滚轮放大保持鼠标锚点 '+JSON.stringify({targetScale:renderer.targetScale,oldScale,worldX,now:(anchor-renderer.panX)/renderer.scale,anchor,center:renderer.zoomCenterX,scale:renderer.scale,pan:renderer.panX}));
  renderer.canvasEl.dispatchEvent(new WheelEvent('wheel', { ...wheelPoint, deltaY: 120, bubbles: true, cancelable: true }));
  assert(renderer.zoomCenterX === 0 && renderer.zoomCenterY === 0, '滚轮缩小使用视口中心');
  renderer.zoomTo(1); renderer.setScale(1); renderer.resetPan();
  a.x = a.y = 0; Object.assign(renderer.sim.nodeById.get(a.id), { x: 0, y: 0 });
  let markdownBefore = countMarkdown();
  mouse(renderer.canvasEl, 'contextmenu', point(a), 2);
  await wait(() => !!document.querySelector('.menu'), '右键菜单');
  assert(document.querySelector('.menu').textContent.includes('A.md'), '右键菜单显示节点文件名');
  const menuItems = document.querySelectorAll('.menu .menu-item');
  assert(menuItems.length >= 3, '菜单包含标题、新标签页和删除');
  menuItems[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); menuItems[1].click();
  await wait(() => countMarkdown() > markdownBefore, '菜单新标签页');
  assert(app.workspace.getLeavesOfType('graph').includes(globalLeaf), '右键新标签页保留图谱');
  app.workspace.revealLeaf(globalLeaf);
  markdownBefore = countMarkdown();
  for (const [i,node] of renderer.nodes.entries()) { node.x=2000+i*160;node.y=2000+i*90;Object.assign(renderer.sim.nodeById.get(node.id),{x:node.x,y:node.y}); }
  const middleTarget = renderer.nodeLookup['C.md'];
  middleTarget.x = middleTarget.y = 0;
  Object.assign(renderer.sim.nodeById.get(middleTarget.id), { x: 0, y: 0 });
  a.x = 300; a.y = 200;
  Object.assign(renderer.sim.nodeById.get(a.id), { x: a.x, y: a.y });
  mouse(renderer.canvasEl, 'mousedown', point(middleTarget), 1);
  mouse(window, 'mouseup', point(middleTarget), 1);
  await wait(() => countMarkdown() > markdownBefore, '中键新标签页');
  assert(globalLeaf.view === globalView, '中键新标签页保留图谱');
  await wait(() => app.workspace.getActiveFile()?.path === 'C.md', '中键笔记完成加载');
  const localLeaf = app.workspace.createLeafBySplit(globalLeaf, 'vertical');
  await localLeaf.setViewState({ type: 'localgraph', state: { file: 'A.md', options: { hideUnresolved: true, showAttachments: false, showTags: false } } });
  app.workspace.revealLeaf(localLeaf);
  const local = localLeaf.view;
  const localEngine = local.engine;
  await wait(() => local.renderer.nodeLookup['A.md']?.type === 'focused', '局部根节点');
  sameNodes(local.renderer, ['A.md', 'B.md', 'D.md'], '局部深度一包含前链与反链');
  localEngine.setOptions({ localBacklinks: false });
  sameNodes(local.renderer, ['A.md', 'B.md'], '关闭反链只保留前链');
  localEngine.setOptions({ localBacklinks: true, localForelinks: false });
  sameNodes(local.renderer, ['A.md', 'D.md'], '关闭前链只保留反链');
  localEngine.setOptions({ localForelinks: true, localInterlinks: false });
  assert(!local.renderer.nodeLookup['D.md'].forward['B.md'], '默认不显示邻居间连线');
  localEngine.setOptions({ localInterlinks: true });
  assert(!!local.renderer.nodeLookup['D.md'].forward['B.md'], '显示邻居连线开关生效');
  localEngine.setOptions({ localInterlinks: false, localJumps: 2 });
  assert(!!local.renderer.nodeLookup['C.md'], '深度二包含二跳节点');
  localEngine.setOptions({ localJumps: 1 });
  const bLeaf = app.workspace.getLeaf(true);
  await bLeaf.setViewState({ type: 'markdown', state: { file: 'B.md' } });
  app.workspace.setActiveLeaf(bLeaf);
  await wait(() => local.file?.path === 'B.md' && local.renderer.nodeLookup['B.md']?.type === 'focused', '切换已有笔记跟随');
  assert(true, '局部图跟随标签切换');
  await app.vault.rename(app.vault.getFileByPath('B.md'), 'B-renamed.md');
  await wait(() => local.renderer.nodeLookup['B-renamed.md']?.type === 'focused', '局部根重命名');
  assert(local.getState().file === 'B-renamed.md', '局部根重命名同步到状态');
  await app.vault.delete(app.vault.getFileByPath('B-renamed.md'), true);
  await wait(() => local.file === null && local.renderer.nodes.length === 0, '删除局部根');
  assert(true, '删除根文件清空局部图');
  // 恢复截图 fixture；同时保留全局与局部面板供视觉验收。
  await app.vault.create('B.md', fixture['B.md']);
  await wait(() => !!app.metadataCache.resolvedLinks['A.md']?.['B.md'], '恢复截图 fixture');
  await local.setState({ file: 'A.md', options: { localJumps: 1, localForelinks: true, localBacklinks: true, localInterlinks: true, hideUnresolved: true, 'collapse-filter': false } });
  await delay(100);
  const disposable = app.workspace.getLeaf(true);
  await disposable.setViewState({ type: 'graph', state: {} });
  const closedView = disposable.view;
  const closedEngine = closedView.dataEngine;
  const animation = closedEngine.renderProgression();
  closedEngine.filterOptions.search.setValue('file:A'); closedEngine.updateSearch();
  await disposable.setViewState({ type: 'empty' });
  await animation;
  await delay(300);
  assert(closedEngine.destroyed && closedEngine.queue === null && closedEngine.progression === 0, '关闭图谱取消查询与动画');
  assert(closedView.renderer.destroyed && !closedView.renderer.renderTimer && !closedView.renderer.canvasEl.isConnected, '关闭图谱停止渲染并移除画布');
  disposable.detach();
  engine.setOptions({ showTags: true, showAttachments: true, hideUnresolved: false, showOrphans: true, close: false, 'collapse-filter': false });
  await search('');
  const screen = process.env.OBS_GRAPH_SCREEN || 'local';
  const keep = screen === 'local' ? [globalLeaf, localLeaf] : [globalLeaf];
  const close = []; app.workspace.iterateAllLeaves(leaf=>{if(app.workspace._sideOf(leaf)==='center'&&!keep.includes(leaf))close.push(leaf);});
  for(const leaf of close)leaf.detach();
  app.workspace.revealLeaf(globalLeaf);
  if(screen === 'local') { app.workspace.revealLeaf(localLeaf); engine.setOptions({close:true});localEngine.setOptions({close:true}); }
  else engine.setOptions({close:false});
  await delay(500);
  if (screen === 'filter') await search('tag:project');
  if (screen === 'menu') {
    await delay(300);
    engine.onNodeRightClick(new MouseEvent('contextmenu', { button: 2, clientX: rect.left + 100, clientY: rect.top + 100 }), 'A.md', '');
  }
  return { role: 'graph', passed: checks.length, checks, fixture: realVault, screen,
    screenshots: ['global: 全局节点、附件/标签、控制面板', 'filter: tag:project 仅保留 A 和标签', 'local: 左右全局/局部图和邻居连线', 'menu: A.md 右键菜单'] };
})()
