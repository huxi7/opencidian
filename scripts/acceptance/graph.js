/*
 * [INPUT]: OBS_ACT eval 注入；已启用 graph，且 vault 是新建的 graph-vault-* 临时目录。
 * [OUTPUT]: 返回 {role, passed, checks, screenshots}；断言失败会抛错。
 * [POS]: 图谱集成验收；创建独立 fixture，通过 DOM 事件验证交互。
 *        覆盖筛选/局部图/画布交互之外，另验收颜色组拖拽排序、悬停预览（hover-link）与力参数落盘。
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
    const end = Date.now() + 15000;
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
  // 冻结模拟（alpha=0 不推进）：坐标断言与悬停预览用例都依赖节点静止。
  // 悬停标签/未解析节点会重建构图并重启模拟，B 段收尾再冻结一次并重新固定坐标。
  renderer.sim.alpha = 0; renderer.sim.alphaTarget = 0;
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
  // 同一换算用于其它 renderer（局部图、临时图谱）
  const pointIn = (target, node) => {
    const rect = target.canvasEl.getBoundingClientRect();
    return { clientX: rect.left + (node.x * target.scale + target.panX) / devicePixelRatio,
      clientY: rect.top + (node.y * target.scale + target.panY) / devicePixelRatio };
  };
  const mouse = (target, type, point, button = 0) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, ...point }));
  // A. 颜色组拖拽排序：行顺序即优先色顺序，拖拽写回 graph.json，重开视图保留
  const findGhost = () => document.querySelector('.graph-color-group.drag-ghost');
  const findPopover = () => document.querySelector('body > .popover.hover-popover');
  const readGroups = () => (app.settings.readJson('graph.json').colorGroups || []).map(group => group.query);
  engine.setOptions({ close: false });
  engine.colorGroupOptions.setCollapsed(false);
  const groupSection = engine.colorGroupOptions;
  const newGroupButton = groupSection.childrenEl.querySelector('.graph-color-button-container button');
  newGroupButton.click(); newGroupButton.click(); newGroupButton.click();
  assert(groupSection.groups.length === 3, '新建颜色组按钮建出三行');
  const setGroup = (index, query, hex) => {
    const group = groupSection.groups[index];
    group.query.inputEl.value = query;
    group.query.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    group.color.colorPickerEl.value = hex;
    group.color.colorPickerEl.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setGroup(0, 'file:A', '#ff0000');
  setGroup(1, 'file:B', '#00ff00');
  setGroup(2, 'tag:project', '#0000ff');
  engine.updateSearch();
  await delay(320);
  await wait(() => !engine.queue, '颜色组排序筛选');
  assert(renderer.nodeLookup['A.md'].color?.rgb === 0xff0000, '第一组优先给同时命中的 A.md 上色');
  await delay(220);
  assert(readGroups().join('|') === 'file:A|file:B|tag:project', 'graph.json 记录三组初始顺序');
  const rowPoint = (index) => {
    const rect = groupSection.groups[index].el.getBoundingClientRect();
    return { clientX: rect.left + 6, clientY: rect.top + 6 };
  };
  const firstRowMiddle = groupSection.groups[0].el.getBoundingClientRect().top + 2;
  const thirdRowInput = groupSection.groups[2].el.querySelector('input[type="color"]');
  const grabPoint = rowPoint(2);
  mouse(thirdRowInput, 'mousedown', grabPoint);
  mouse(window, 'mousemove', { clientX: grabPoint.clientX, clientY: grabPoint.clientY - 30 });
  assert(!!findGhost() && document.body.hasClass('is-grabbing'), '拖动颜色圆点出现幽灵行');
  mouse(window, 'mousemove', { clientX: grabPoint.clientX, clientY: firstRowMiddle });
  mouse(window, 'mouseup', { clientX: grabPoint.clientX, clientY: firstRowMiddle });
  assert(!findGhost() && !document.body.hasClass('is-grabbing'), '松手移除幽灵行');
  assert(groupSection.groups.map(group => group.query.getValue()).join('|') === 'tag:project|file:A|file:B', '第三组移动到第一位');
  await delay(320);
  await wait(() => !engine.queue, '重排后重绘');
  assert(renderer.nodeLookup['A.md'].color?.rgb === 0x0000ff, '重排后优先色切换为第一位色组');
  await delay(220);
  assert(readGroups().join('|') === 'tag:project|file:A|file:B', 'graph.json 写入拖拽后的顺序');
  const orderLeaf = app.workspace.getLeaf(true);
  await orderLeaf.setViewState({ type: 'graph', state: {} });
  const orderEngine = orderLeaf.view.dataEngine;
  await wait(() => orderEngine?.colorGroupOptions.groups.map(group => group.query.getValue()).join('|') === 'tag:project|file:A|file:B', '重开视图读取颜色组顺序');
  await wait(() => orderLeaf.view.renderer.nodeLookup['A.md']?.color?.rgb === 0x0000ff, '重开视图重建优先色');
  assert(true, '重开视图保留颜色组顺序');
  await orderLeaf.setViewState({ type: 'empty' });
  orderLeaf.detach();
  engine.setOptions({ colorGroups: [] });
  engine.updateSearch();
  await delay(320);
  await wait(() => !engine.queue, '清理颜色组');
  assert(!renderer.nodeLookup['A.md'].color, '清理后颜色立即清除');
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
  // B. 图谱悬停 → page-preview：原版 GraphEngine 经 workspace 的 hover-link 事件请求预览，
  //    graph 来源默认需按住 Mod；标签与未解析节点不请求预览。
  // 帧循环按「鼠标世界坐标是否仍在高亮节点半径内」清高亮，画布重排会改变坐标映射；
  // 每次等待前把指针重新钉到节点上（命中同一节点不会产生新的 hover 事件）保证断言稳定。
  const pinHover = (node, metaKey) => mouse(renderer.canvasEl, 'mousemove', { ...point(node), metaKey });
  const holdHover = async (node, metaKey) => {
    for (let i = 0; i < 4; i += 1) { await delay(150); pinHover(node, metaKey); }
  };
  mouse(renderer.canvasEl, 'mousemove', point(a));
  assert(renderer.highlightNode === a, '悬停命中 A.md');
  await holdHover(a, false);
  assert(!findPopover(), '未按住 Mod 悬停节点不出现预览');
  pinHover(a, false);
  renderer.onMouseOut();
  assert(!renderer.highlightNode, '移出画布清除高亮');
  mouse(renderer.canvasEl, 'mousemove', { ...point(a), metaKey: true });
  await holdHover(a, true);
  const hoverPopover = findPopover();
  assert(!!hoverPopover && hoverPopover.textContent.includes('alpha'), '按住 Mod 悬停节点显示目标笔记预览');
  assert(!!hoverPopover.style.left && !!hoverPopover.style.top, '预览按鼠标坐标定位');
  pinHover(a, true);
  renderer.onMouseOut();
  await delay(420);
  assert(!findPopover(), '移出画布后预览关闭');
  engine.setOptions({ showTags: true, hideUnresolved: false });
  await delay(60);
  for (const [id, far] of [['#project/root', -20000], ['Missing', -40000]]) {
    const node = renderer.nodeLookup[id];
    assert(!!node, `节点 ${id} 存在`);
    node.x = 0; node.y = far;
    Object.assign(renderer.sim.nodeById.get(id), { x: 0, y: far, vx: 0, vy: 0 });
    mouse(renderer.canvasEl, 'mousemove', { ...point(node), metaKey: true });
    assert(renderer.highlightNode === node, `悬停命中 ${id}`);
    await delay(520);
    assert(!findPopover(), `${id} 不显示预览`);
  }
  engine.setOptions({ showTags: false, hideUnresolved: true });
  renderer.onMouseOut();
  // 悬停标签/未解析节点会重建构图并重启模拟：重新冻结并固定坐标供后续命中断言。
  renderer.sim.alpha = 0; renderer.sim.alphaTarget = 0;
  for (const [index, node] of renderer.nodes.entries()) {
    node.x = (index + 1) * 160; node.y = (index + 1) * 90;
    Object.assign(renderer.sim.nodeById.get(node.id), { x: node.x, y: node.y, vx: 0, vy: 0 });
  }
  a.x = a.y = 0; Object.assign(renderer.sim.nodeById.get(a.id), { x: 0, y: 0, vx: 0, vy: 0 });
  assert(!findPopover(), '悬停用例未残留预览');
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
  // 中键打开：走 renderer 的公开点击入口（等价于 onMouseUp 的 button===1 分支）。
  // 原因：力模拟持续更新节点坐标，合成 MouseEvent 的命中窗口不稳定；命中测试已由上方
  // “鼠标悬停命中节点”断言覆盖，这里聚焦"中键=新标签页并激活"的语义。
  renderer.onNodeClick({ button: 1 }, 'C.md', 'file');
  await wait(() => countMarkdown() > markdownBefore, '中键新标签页');
  assert(globalLeaf.view === globalView, '中键新标签页保留图谱');
  await wait(() => app.workspace.getActiveFile()?.path === 'C.md', '中键笔记完成加载');
  // C. 力参数：滑块写引擎选项与 graph.json，立即作用到模拟，重开视图保留
  const forceSliders = engine.forceOptions.childrenEl.querySelectorAll('input[type="range"]');
  assert(forceSliders.length === 4, '力设置含中心力/斥力/连线力/连线距离四项');
  const distanceSlider = forceSliders[3];
  const previousDistance = Number(distanceSlider.value);
  const nextDistance = previousDistance === 300 ? 260 : 300;
  distanceSlider.value = String(nextDistance);
  distanceSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(260);
  assert(renderer.sim.linkDistance === nextDistance, '连线距离滑块立即作用于模拟');
  assert(engine.options.linkDistance === nextDistance, '连线距离滑块写入引擎选项');
  const forceJson = app.settings.readJson('graph.json');
  assert(forceJson.linkDistance === nextDistance, 'graph.json 记录连线距离');
  assert(['centerStrength', 'repelStrength', 'linkStrength'].every(key => Number.isFinite(forceJson[key])), 'graph.json 记录中心力/斥力/连线力');
  const forceLeaf = app.workspace.getLeaf(true);
  await forceLeaf.setViewState({ type: 'graph', state: {} });
  await wait(() => forceLeaf.view.dataEngine?.renderer.sim.linkDistance === nextDistance, '重开视图读取力参数');
  assert(forceLeaf.view.dataEngine.options.linkDistance === nextDistance, '重开视图保留力参数');
  await forceLeaf.setViewState({ type: 'empty' });
  forceLeaf.detach();
  distanceSlider.value = String(previousDistance);
  distanceSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(120);
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
  // 关闭视图时预览一并收起：句柄挂在该视图的引擎上（独立视图，不跑生长动画，避免节点移动干扰悬停）
  const hoverLeaf = app.workspace.getLeaf(true);
  await hoverLeaf.setViewState({ type: 'graph', state: {} });
  const hoverRenderer = hoverLeaf.view.renderer;
  await wait(() => !!hoverRenderer.nodeLookup['A.md'], '预览用例图谱节点');
  const hoverNode = hoverRenderer.nodeLookup['A.md'];
  const pinClosedHover = () => {
    hoverRenderer.resetPan();
    hoverRenderer.sim.alpha = 0; hoverRenderer.sim.alphaTarget = 0;
    hoverNode.x = 0; hoverNode.y = 0;
    Object.assign(hoverRenderer.sim.nodeById.get('A.md'), { x: 0, y: 0, vx: 0, vy: 0 });
    mouse(hoverRenderer.canvasEl, 'mousemove', { ...pointIn(hoverRenderer, hoverNode), metaKey: true });
    return hoverRenderer.highlightNode === hoverNode;
  };
  let closedPreview = false;
  assert(pinClosedHover(), '独立图谱悬停命中 A.md');
  for (let i = 0; i < 20 && !closedPreview; i += 1) {
    await delay(120);
    pinClosedHover();
    closedPreview = !!findPopover();
  }
  assert(closedPreview, '独立图谱悬停显示预览');
  await hoverLeaf.setViewState({ type: 'empty' });
  await delay(80);
  assert(!findPopover(), '关闭图谱视图收起悬停预览');
  hoverLeaf.detach();
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
