/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas-selection 场景。覆盖多选与批量操作：Shift+点击增删选、空白拖动框选（矩形挂 .canvas-selection、分组需完整包含、
 *        松手清除）、多选包围盒（.canvas-selection.mod-group-selection + 8 个 data-resize 手柄）、拖动任一选中卡片整体位移（相对位置保持）、
 *        Delete 删除选中与 Mod+Z 撤销恢复、Alt(mac)/Ctrl 拖动克隆整组、Mod+框选收尾弹建卡菜单；
 *        浮动工具条（.canvas-menu）菜单项文案，排布子菜单 13 项经真实点击驱动：对齐 6 向坐标断言、分布 2 向（首尾不动、间距均分）、
 *        拉伸与网格排列；层级（分组恒为负 z、数据按 z 升序写出、拖动即置顶）、分组（从选中集合建组、拖组带动内部节点、
 *        分组菜单无取消分组命令、删组保留子节点）。
 *        所有指针坐标落在画布自动平移死区（边缘 30px）之内，避免拖动过程中视口漂移。
 *        仅由 run.mjs 在带标记的临时库执行，不做视觉验收。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const ok = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const IS_MAC = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
  const cloneMods = IS_MAC ? { altKey: true } : { ctrlKey: true };

  await app.commands.findCommand('canvas:new-file').callback();
  await wait(300);
  const view = app.workspace.activeLeaf.view;
  const file = view.file;
  ok(view.canvasRect.width > 0, '画布已测量尺寸');
  ok(!!view.menu && !!view.menu.menuEl, '画布持有浮动工具条');

  /* ---------------------------------------------------- 指针与菜单助手 */
  const rect = () => view.canvasRect;
  const dom = (world) => view.domFromPos(world);
  let pointerId = 41;
  const ptr = (target, type, world, mods = {}) => {
    const p = dom(world);
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, isPrimary: true, pointerType: 'mouse', pointerId,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: p.x + rect().cx, clientY: p.y + rect().cy, ...mods,
    }));
  };
  const drag = async (target, from, to, mods = {}) => {
    pointerId += 1;
    ptr(target, 'pointerdown', from, mods);
    await wait(20);
    ptr(window, 'pointermove', to, mods);
    await wait(40);
    ptr(window, 'pointerup', to, mods);
    await wait(90);
  };
  const mouse = async (target, type, mods = {}) => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...mods }));
    await wait(50);
  };
  const key = async (k, mods = {}) => {
    view.wrapperEl.focus();
    view.wrapperEl.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
    await wait(120);
  };
  const world = (node, dx = 0, dy = 0) => ({ x: node.x + node.width / 2 + dx, y: node.y + node.height / 2 + dy });
  const selected = () => Array.from(view.selection);
  const toolbar = () => Array.from(view.menu.menuEl.querySelectorAll('button.clickable-icon'));
  const toolbarLabels = () => toolbar().map((el) => el.getAttribute('aria-label') || '');
  const button = (pattern) => toolbar().find((el) => pattern.test(el.getAttribute('aria-label') || ''));
  const menuItems = () => Array.from(document.querySelectorAll('.menu .menu-item'));
  const menuItemText = (el) => (el.querySelector('.menu-item-title')?.textContent || '');
  const clickMenuItem = (pattern) => {
    const el = menuItems().find((item) => pattern.test(menuItemText(item)));
    if (!el) throw new Error(`菜单项缺失：${pattern}（现有：${menuItems().map(menuItemText).join(' / ')}）`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  const openAlarrangeMenu = async () => {
    const el = button(/对齐|^Align$/);
    if (!el) throw new Error('工具条缺少对齐按钮');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(70);
  };
  const arrange = async (pattern) => {
    await openAlarrangeMenu();
    clickMenuItem(pattern);
    await wait(120);
  };
  const closeMenus = async () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(60);
  };

  /* ---------------------------------------------------- 三个卡片做基准 */
  const A = view.createTextNode({ pos: { x: -200, y: -120 }, size: { width: 100, height: 100 }, text: 'A', focus: false, save: false });
  const B = view.createTextNode({ pos: { x: -40, y: -120 }, size: { width: 100, height: 100 }, text: 'B', focus: false, save: false });
  const C = view.createTextNode({ pos: { x: 120, y: -120 }, size: { width: 100, height: 100 }, text: 'C', focus: false, save: false });
  view.options.snapToGrid = false;
  view.options.snapToObjects = false;
  view.setViewport(0, 0, 0);
  view.deselectAll();
  await wait(150);
  ok(view.nodes.size === 3 && view.selection.size === 0, '三个基准卡片就绪');

  /* --------------------------------------------------------- 1 多选状态 */
  await mouse(A.nodeEl, 'click');
  ok(view.selection.size === 1 && view.selection.has(A), '单击进入单选');
  ok(A.nodeEl.hasClass('is-focused') && !A.nodeEl.hasClass('is-selected'), '单选卡片只置聚焦态（原版单选语义）');
  await mouse(B.nodeEl, 'click', { shiftKey: true });
  ok(view.selection.size === 2 && view.selection.has(A) && view.selection.has(B), 'Shift+点击加入第二个卡片成多选');
  ok(A.nodeEl.hasClass('is-selected') && B.nodeEl.hasClass('is-selected'), '多选卡片都带 is-selected');
  ok(!A.nodeEl.hasClass('is-focused') && !B.nodeEl.hasClass('is-focused'), '单选转多选后不保留聚焦态');
  await mouse(B.nodeEl, 'click', { shiftKey: true });
  ok(view.selection.size === 1 && view.selection.has(A), 'Shift+再次点击移除该卡片');
  ok(A.nodeEl.hasClass('is-focused'), '回到单选恢复聚焦');
  await mouse(C.nodeEl, 'click');
  ok(view.selection.size === 1 && view.selection.has(C) && !view.selection.has(A), '普通点击替换为单选');

  /* ------------------------------------------------------------- 2 框选 */
  const marqueeEl = () => view.canvasEl.querySelector('.canvas-selection:not(.mod-group-selection)');
  view.deselectAll();
  await wait(60);
  ptr(view.wrapperEl, 'pointerdown', { x: -60, y: -160 });
  await wait(20);
  ptr(window, 'pointermove', { x: 240, y: -40 });
  await wait(50);
  const marquee = marqueeEl();
  ok(!!marquee, '框选矩形是 .canvas-selection（非多选包围盒）');
  const marqueePos = (marquee.style.transform.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  // 原版 V3.update 把矩形外扩 10px 后定位
  ok(Math.abs(marqueePos[0] + 70) < 1 && Math.abs(marqueePos[1] + 170) < 1, `框选矩形按拖动起点外扩 10px 定位（实际 ${marquee.style.transform}）`);
  ok(view.selection.size === 2 && view.selection.has(B) && view.selection.has(C), '框选命中两个卡片');
  ok(!view.selection.has(A), '框选未命中框外卡片');
  ptr(window, 'pointerup', { x: 240, y: -40 });
  await wait(90);
  ok(!marqueeEl(), '松手后框选矩形移除');

  /* ------------------------------------------- 3 多选包围盒与选择手柄 */
  await wait(60);
  const bboxEl = view.canvasEl.querySelector('.canvas-selection.mod-group-selection');
  ok(!!bboxEl, '多选出现 .canvas-selection.mod-group-selection 包围盒');
  ok(bboxEl.querySelectorAll('.canvas-node-resizer[data-resize]').length === 8, '包围盒带 8 个 data-resize 手柄');
  // 选中 B(-40..60) 与 C(120..220)，y 均为 -120..-20 → 并集 260x100 外扩 10px
  ok(Math.abs(parseFloat(bboxEl.style.width) - 280) < 1 && Math.abs(parseFloat(bboxEl.style.height) - 120) < 1, '包围盒尺寸为选中并集外扩 10px');
  ok(bboxEl.style.transform === 'translate(-50px, -130px)', '包围盒定位到并集左上角（外扩 10px）');
  ok(view.menu.containerEl.parentNode === view.wrapperEl, '工具条容器挂在画布 wrapper 上');

  /* ------------------------------------------- 4 拖动多选整体位移 */
  const beforeDrag = new Map(selected().map((node) => [node.id, { x: node.x, y: node.y }]));
  await drag(B.containerEl, world(B), world(B, 40, 30));
  let movedTogether = 0;
  for (const node of selected()) {
    const from = beforeDrag.get(node.id);
    if (node.x === from.x + 40 && node.y === from.y + 30) movedTogether += 1;
  }
  ok(movedTogether === 2, '拖动任一选中卡片让全部选中卡片同步位移');
  ok(B.x - C.x === beforeDrag.get(B.id).x - beforeDrag.get(C.id).x, '多选拖动保持相对位置');

  /* ---------------------------------------------- 5 删除与撤销/重做 */
  await wait(450);   // 历史条目由 250ms 防抖推进，先让拖动结果落成一条快照
  view.wrapperEl.focus();
  key('Delete');
  ok(view.nodes.size === 1 && view.selection.size === 0, 'Delete 删除全部选中卡片');
  await wait(650);
  ok(JSON.parse(await app.vault.read(file)).nodes.length === 1, '删除写入画布 JSON');
  await key('z', IS_MAC ? { metaKey: true } : { ctrlKey: true });
  await wait(120);
  ok(view.nodes.size === 3, 'Mod+Z 撤销恢复被删除的卡片');
  view.redo();
  await wait(150);
  ok(view.nodes.size === 1, '重做再次删除');
  view.undo();
  await wait(200);
  const nodeA = [...view.nodes.values()].find((n) => n.text === 'A');
  const nodeB = [...view.nodes.values()].find((n) => n.text === 'B');
  const nodeC = [...view.nodes.values()].find((n) => n.text === 'C');
  ok(!!nodeA && !!nodeB && !!nodeC, '撤销后三个卡片按正文取回');

  /* -------------------------------------------------------- 6 层级 */
  const dataOrder = view.getData().nodes.map((n) => n.id);
  const zOrder = Array.from(view.nodes.values()).sort((a, b) => a.zIndex - b.zIndex).map((n) => n.id);
  ok(JSON.stringify(dataOrder) === JSON.stringify(zOrder), '数据层按 z 升序写出节点（文件顺序即堆叠顺序）');
  ok(nodeA.zIndex < nodeC.zIndex, '（前置）A 位于 C 之下');
  nodeA.moveTo({ x: -200, y: -120 });
  await drag(nodeA.containerEl, world(nodeA), world(nodeA, 20, 0));
  ok(nodeA.zIndex > nodeC.zIndex, '拖动即置顶（原版 updateZIndex）');

  /* ------------------------------------------- 7 工具条按钮与排布菜单 */
  nodeA.moveTo({ x: -200, y: -120 });
  nodeB.moveTo({ x: 0, y: 0 });
  nodeC.moveTo({ x: 200, y: 120 });
  view.selectAll();
  await wait(120);
  const labels = toolbarLabels();
  ok(labels.some((l) => /移除|Remove/.test(l)), '工具条含移除按钮');
  ok(labels.some((l) => /设置颜色|Set color/.test(l)), '工具条含设置颜色按钮');
  ok(labels.some((l) => /聚焦当前卡片|Zoom to selection/.test(l)), '工具条含聚焦当前卡片按钮');
  ok(labels.some((l) => /创建分组|Create group/.test(l)), '多选时工具条含创建分组按钮');
  await openAlarrangeMenu();
  ok(menuItems().length === 13, '排布子菜单共 13 项（对齐 6 + 排列 3 + 分布 2 + 拉伸 2）');
  const submenuTexts = menuItems().map(menuItemText).join('|');
  ok(/左对齐|Align left/.test(submenuTexts) && /横向分布|Distribute horizontal/.test(submenuTexts) && /按网格排列|Arrange in a grid/.test(submenuTexts), '子菜单文案取自 plugins.canvas.* 词条');
  clickMenuItem(/左对齐|Align left/);
  await wait(120);
  ok(nodeA.x === -200 && nodeB.x === -200 && nodeC.x === -200, '左对齐：三卡 x 落到并集左边界');

  /* --------------------------------------------------- 8 对齐 6 向 */
  const resetAlign = () => {
    nodeA.moveTo({ x: -200, y: -120 });
    nodeB.moveTo({ x: 0, y: 0 });
    nodeC.moveTo({ x: 200, y: 120 });
  };
  resetAlign();
  await arrange(/水平居中|Align center/);
  const centersX = [nodeA, nodeB, nodeC].map((n) => n.x + n.width / 2);
  ok(new Set(centersX).size === 1 && Math.abs(centersX[0] - 50) < 1, '水平居中：三卡中心对齐到并集中线');
  resetAlign();
  await arrange(/右对齐|Align right/);
  ok(nodeA.x === 200 && nodeB.x === 200 && nodeC.x === 200, '右对齐：三卡右缘落到并集右边界');
  resetAlign();
  await arrange(/顶端对齐|Align top/);
  ok(nodeA.y === -120 && nodeB.y === -120 && nodeC.y === -120, '顶端对齐：三卡 y 落到并集顶边');
  resetAlign();
  await arrange(/垂直居中|Align middle/);
  const centersY = [nodeA, nodeB, nodeC].map((n) => n.y + n.height / 2);
  ok(new Set(centersY).size === 1 && Math.abs(centersY[0] - 50) < 1, '垂直居中：三卡中心对齐到并集中线');
  resetAlign();
  await arrange(/底端对齐|Align bottom/);
  ok(nodeA.y === 120 && nodeB.y === 120 && nodeC.y === 120, '底端对齐：三卡下缘落到并集底边');

  /* --------------------------------------------------- 9 分布 2 向 */
  nodeA.moveTo({ x: -200, y: -120 });
  nodeB.moveTo({ x: -50, y: -120 });
  nodeC.moveTo({ x: 150, y: -120 });
  await arrange(/横向分布|Distribute horizontal/);
  ok(nodeB.x === -25, '横向分布：中间卡片平分剩余空隙');
  ok(nodeA.x === -200 && nodeC.x === 150, '横向分布不改动首尾卡片');
  nodeA.moveTo({ x: -200, y: -120 });
  nodeB.moveTo({ x: -200, y: 0 });
  nodeC.moveTo({ x: -200, y: 150 });
  await arrange(/纵向分布|Distribute vertical/);
  ok(nodeB.y === 15, '纵向分布：中间卡片平分剩余空隙');
  ok(nodeA.y === -120 && nodeC.y === 150, '纵向分布不改动首尾卡片');

  /* ------------------------------------------ 10 拉伸与网格排列 */
  nodeA.moveAndResize({ x: -200, y: -120, width: 100, height: 100 });
  nodeB.moveAndResize({ x: -200, y: 0, width: 60, height: 100 });
  nodeC.moveAndResize({ x: -200, y: 120, width: 40, height: 100 });
  await arrange(/水平拉伸对齐|Justify horizontally/);
  ok([nodeA, nodeB, nodeC].every((n) => n.width === 100 && n.x === -200), '水平拉伸对齐：三卡宽度对齐并集宽度');
  nodeA.moveTo({ x: -200, y: -120 });
  nodeB.moveTo({ x: 0, y: -120 });
  nodeC.moveTo({ x: -200, y: 120 });
  await arrange(/按网格排列|Arrange in a grid/);
  const spacing = view.gridSpacing;
  ok(nodeA.x === -200 && nodeA.y === -120, '网格排列：首卡落到并集左上角');
  ok(nodeB.x === nodeA.x + nodeA.width + spacing, '网格排列：同一行按间距水平铺开');
  ok(nodeC.y === nodeA.y + nodeA.height + spacing && nodeC.x === -200, '网格排列：换行按行高加间距下移');

  /* ------------------------------------------------ 11 分组与组内拖动 */
  nodeA.moveTo({ x: 0, y: 0 });
  nodeB.moveTo({ x: 200, y: 0 });
  nodeC.moveTo({ x: 400, y: 200 });
  view.selectAll(new Set([nodeA, nodeB]));
  await wait(120);
  const groupButton = button(/创建分组|Create group/);
  ok(!!groupButton, '（前置）多选工具条含创建分组按钮');
  groupButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(220);
  const group = [...view.nodes.values()].find((n) => n.getData().type === 'group');
  ok(!!group, '工具条命令创建分组节点');
  ok(group.x === -20 && group.y === -20 && group.width === 340 && group.height === 140, '分组几何取选中并集外扩 20px');
  ok(view.getContainingNodes(group.getBBox()).filter((n) => !n.isGroup).length === 2, '分组包含两个卡片');
  ok(group.zIndex === -Math.round(group.width * group.height) && group.zIndex < 0, '分组 z 取 -宽*高（恒为负）');
  view.selectOnly(group);
  await wait(140);
  ok(group.zIndex < 0 && group.nodeEl.style.zIndex === String(group.zIndex), '单选分组不做临时置顶，仍是负 z');
  ok(!!button(/对齐|^Align$/), '单选分组时工具条仍提供对齐（作用于组内卡片）');
  const childBefore = { a: { x: nodeA.x, y: nodeA.y }, b: { x: nodeB.x, y: nodeB.y } };
  await drag(group.containerEl, world(group), world(group, 60, 40));
  ok(nodeA.x === childBefore.a.x + 60 && nodeA.y === childBefore.a.y + 40, '拖动分组带动内部卡片（A）');
  ok(nodeB.x === childBefore.b.x + 60 && nodeB.y === childBefore.b.y + 40, '拖动分组带动内部卡片（B）');
  const ctxPoint = dom(world(group));
  group.nodeEl.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: ctxPoint.x + rect().cx, clientY: ctxPoint.y + rect().cy,
  }));
  await wait(90);
  const nodeMenuTexts = menuItems().map(menuItemText);
  ok(nodeMenuTexts.some((x) => /编辑文字|Edit label/.test(x)), '分组菜单提供编辑文字');
  ok(!nodeMenuTexts.some((x) => /取消分组|Ungroup/.test(x)), '原版无「取消分组」命令：分组菜单不含该项');
  await closeMenus();
  view.removeNode(group);
  view.requestSave();
  await wait(120);
  ok(view.nodes.size === 3 && view.nodes.has(nodeA.id) && view.nodes.has(nodeB.id), '删除分组后内部卡片保留（取消分组的等价操作）');

  /* ----------------------------------------------------- 12 克隆拖动 */
  view.selectAll(new Set([nodeA, nodeB]));
  await wait(120);
  const cloneBase = { a: { x: nodeA.x, y: nodeA.y }, count: view.nodes.size };
  await drag(nodeA.containerEl, world(nodeA), world(nodeA, 60, 40), cloneMods);
  await wait(80);
  ok(view.nodes.size === cloneBase.count + 2, 'Alt/Ctrl 拖动克隆出两个新卡片');
  ok(nodeA.x === cloneBase.a.x && nodeA.y === cloneBase.a.y, '克隆拖动后原件留在原位');
  const clones = selected().filter((el) => el !== nodeA && el !== nodeB);
  ok(clones.length === 2 && clones.every((n) => n.text === 'A' || n.text === 'B'), '克隆结果成为当前选择且沿用原卡片内容');
  await wait(450);
  view.undo();
  await wait(220);
  ok(view.nodes.size === cloneBase.count, '撤销克隆拖动');

  /* ------------------------------------------------ 13 Mod+框选建卡 */
  view.deselectAll();
  await wait(80);
  pointerId += 1;
  ptr(view.wrapperEl, 'pointerdown', { x: 150, y: -200 });
  await wait(20);
  ptr(window, 'pointermove', { x: 240, y: -140 });
  await wait(40);
  ptr(window, 'pointerup', { x: 240, y: -140 }, IS_MAC ? { metaKey: true } : { ctrlKey: true });
  await wait(140);
  ok(menuItems().some((el) => /添加文本|Add card/.test(menuItemText(el))), 'Mod+框选收尾弹出建卡菜单');
  ok(!!marqueeEl(), '建卡菜单打开期间框选矩形仍在');
  await closeMenus();
  ok(!marqueeEl(), '关闭建卡菜单后框选矩形收起');

  /* ------------------------------------------------ 14 只读隐藏按钮 */
  view.selectAll();
  await wait(120);
  view.setReadonly(true);
  await wait(160);
  ok(!toolbarLabels().some((l) => /移除|Remove/.test(l)), '只读画布隐藏移除按钮');
  ok(toolbarLabels().some((l) => /聚焦当前卡片|Zoom to selection/.test(l)), '只读画布保留聚焦按钮（always）');
  view.setReadonly(false);
  await wait(100);

  await app.saveLayout();
  return {
    pass: true,
    checks,
    count: checks.length,
    file: file.path,
    nodes: view.nodes.size,
    toolbarButtons: toolbarLabels().length,
  };
})()
