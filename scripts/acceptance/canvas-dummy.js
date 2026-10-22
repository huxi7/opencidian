/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；vault 内自建 Note.md 与 Board.canvas（两节点一条边）。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas-dummy 场景：残留虚影体检 + 虚影几何 + 拖拽可用性 + 新建卡编辑态 + .canvas 卡片缩略图。
 *        逐条覆盖会创建临时节点/临时边的路径（卡片菜单三按钮、连线手柄、边端点、Alt 克隆、框选、pointercancel），
 *        每条路径收尾后断言画布内 .is-dummy 为 0；
 *        拖出中的虚影按原版：尺寸=目标尺寸（文本卡 250×60、笔记/媒体 400×400）、位置=以指针为中心、随吸附偏移；
 *        真实 PointerEvent 多帧拖动后节点坐标真的变化并落盘；
 *        卡片菜单新建的文本卡直接进编辑态、可写、写入画布 JSON；
 *        .canvas 文件卡按原版画布嵌入渲染缩略图（svg.canvas-minimap），不是 JSON 原文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const ok = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const until = async (predicate, label) => {
    for (let n = 0; n < 120; n++) { if (predicate()) { checks.push(label); return; } await wait(25); }
    throw new Error(label);
  };
  const dummies = () => document.querySelectorAll('.canvas-node.is-dummy').length;
  const text = (el) => String((el && el.textContent) || '').trim();

  /* ------------------------------------------------------------ 建库与白板 */
  await app.vault.create('Note.md', '# Note\n\n正文内容。\n');
  const boardData = {
    nodes: [
      { id: 'n1', type: 'text', text: '卡片一', x: -400, y: -200, width: 250, height: 60 },
      { id: 'n2', type: 'text', text: '卡片二', x: 200, y: -200, width: 250, height: 60 },
    ],
    edges: [{ id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left' }],
  };
  const board = await app.vault.create('Board.canvas', JSON.stringify(boardData));
  await app.workspace.openFile(board);
  await wait(800);
  const view = app.workspace.activeLeaf.view;
  ok(view.getViewType() === 'canvas', '白板视图已打开');
  const nodeOf = (id) => Array.from(view.nodes.values()).find((n) => n.id === id);
  const edgeOf = (id) => Array.from(view.edges.values()).find((e) => e.id === id);
  ok(nodeOf('n1') && nodeOf('n2') && edgeOf('e1'), '两个节点与一条边已装载');
  const rect = view.canvasRect;
  const pointer = (target, type, domPoint, extra = {}) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', pointerId: 31, button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: domPoint.x + rect.cx, clientY: domPoint.y + rect.cy, ...extra,
  }));
  const screenPointer = (target, type, clientPoint, extra = {}) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', pointerId: 32, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: clientPoint.x, clientY: clientPoint.y, ...extra,
  }));
  const centerOf = (node) => view.domFromPos({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  const closeSuggest = async () => {
    if (!document.querySelector('.suggestion-container')) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(200);
  };

  /* ================= A. 卡片菜单：纯点击不建虚影（原版 oM 懒建工厂） ================= */
  const cardButtons = Array.from(document.querySelectorAll('.canvas-card-menu .canvas-card-menu-button'));
  ok(cardButtons.length === 3, '卡片菜单三个按钮');
  ok(dummies() === 0, '开画布时没有虚影');
  const menuLabels = ['添加卡片', '添加笔记', '添加媒体'];

  // 先单点「添加卡片」：新卡直接进编辑态、可写、落盘（此时还没有别的弹窗抢焦点）
  const nodesBeforeMenu = view.nodes.size;
  const cardBtn = cardButtons[0];
  const cardBtnRect = cardBtn.getBoundingClientRect();
  const cardBtnAt = { x: cardBtnRect.x + cardBtnRect.width / 2, y: cardBtnRect.y + cardBtnRect.height / 2 };
  screenPointer(cardBtn, 'pointerdown', cardBtnAt);
  await wait(30);
  ok(dummies() === 0, '添加卡片：pointerdown 不建虚影');
  screenPointer(cardBtn, 'pointerup', cardBtnAt);
  cardBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cardBtnAt.x, clientY: cardBtnAt.y }));
  await wait(300);
  ok(dummies() === 0, '添加卡片：点击后无残留虚影');
  ok(view.nodes.size === nodesBeforeMenu + 1, '添加卡片点出一张文本卡');
  const editingCard = Array.from(view.nodes.values()).find((n) => n.text === '' && n.isEditing);
  ok(!!editingCard, '新建文本卡直接进编辑态（原版 createTextNode → startEditing）');
  ok(editingCard.width === 250 && editingCard.height === 60, '新建文本卡用默认尺寸 250×60');
  ok(!!editingCard.editor && editingCard.editor.cm.contentDOM.getAttribute('contenteditable') === 'true',
    '新建文本卡的编辑器可写');
  ok(document.activeElement === editingCard.editor.cm.contentDOM, '新建文本卡编辑器获得焦点');
  editingCard.editor.setValue('新卡内容');
  await wait(200);
  ok(editingCard.text === '新卡内容', '新建卡输入写回节点数据');
  await wait(800);
  const savedAfterEdit = JSON.parse(await app.vault.read(board));
  ok(savedAfterEdit.nodes.some((n) => n.text === '新卡内容'), '新建卡内容落盘画布 JSON');

  // 再点「添加笔记」「添加媒体」：弹文件选择框，同样不留虚影
  for (let i = 1; i < cardButtons.length; i++) {
    const el = cardButtons[i];
    const r = el.getBoundingClientRect();
    const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    screenPointer(el, 'pointerdown', at);
    await wait(30);
    ok(dummies() === 0, `${menuLabels[i]}：pointerdown 不建虚影`);
    screenPointer(el, 'pointerup', at);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
    await wait(250);
    ok(dummies() === 0, `${menuLabels[i]}：点击后无残留虚影`);
    await closeSuggest();
    ok(dummies() === 0, `${menuLabels[i]}：关闭选择框后仍无残留虚影`);
  }
  const textCards = Array.from(view.nodes.values()).filter((n) => n.text !== undefined);
  ok(textCards.length === 3, '板上两张 + 「添加卡片」一张；笔记/媒体按钮只弹选择框不建卡');
  // 只删本场新建的三张，保留板上的 n1/n2
  for (const n of textCards) {
    if (n.id !== 'n1' && n.id !== 'n2') view.removeNode(n);
  }
  await wait(150);
  ok(nodeOf('n1') && nodeOf('n2'), '板上两张卡仍在');

  /* ================= B. 卡片菜单拖出：虚影尺寸/位置/落点 ================= */
  view.options.snapToGrid = false;
  view.options.snapToObjects = false;
  const nodesBeforeDrag = view.nodes.size;
  const btn = cardButtons[0];
  const br = btn.getBoundingClientRect();
  const startAt = { x: br.x + br.width / 2, y: br.y + br.height / 2 };
  screenPointer(btn, 'pointerdown', startAt);
  const target = { x: 0, y: 0 };
  const dom = view.domFromPos(target);
  screenPointer(window, 'pointermove', { x: dom.x + rect.cx, y: dom.y + rect.cy });
  await wait(120);
  const temp = document.querySelector('.canvas-node.is-dummy');
  ok(!!temp, '拖出中出现虚影');
  ok(temp.style.width === '250px' && temp.style.height === '60px', '虚影尺寸=文本卡默认尺寸 250×60');
  const tempBox = { x: parseFloat(temp.style.transform.match(/translate\(([-\d.]+)px/)[1]), y: parseFloat(temp.style.transform.match(/,\s*([-\d.]+)px\)/)[1]) };
  ok(Math.abs(tempBox.x + 125 - target.x) < 2 && Math.abs(tempBox.y + 30 - target.y) < 2,
    '虚影以指针为中心（位置=指针减半尺寸）');
  screenPointer(window, 'pointerup', { x: dom.x + rect.cx, y: dom.y + rect.cy });
  await wait(250);
  ok(dummies() === 0, '拖出结束无残留虚影');
  ok(view.nodes.size === nodesBeforeDrag + 1, '拖出落下建了一张卡');
  const dropped = Array.from(view.nodes.values()).find((n) => n.text === '');
  ok(!!dropped && dropped.width === 250 && dropped.height === 60, '落下建的节点与虚影同尺寸');
  ok(!!dropped && Math.abs(dropped.x - tempBox.x) < 2 && Math.abs(dropped.y - tempBox.y) < 2,
    '落下节点落在虚影位置');
  if (dropped) view.removeNode(dropped);
  await wait(150);

  /* ================= C. 吸附：虚影随网格/物体吸附偏移 ================= */
  view.options.snapToGrid = true;
  view.options.snapToObjects = false;
  const gridNodes = view.nodes.size;
  screenPointer(btn, 'pointerdown', startAt);
  const gridTarget = { x: 37, y: 23 };
  const gridDom = view.domFromPos(gridTarget);
  screenPointer(window, 'pointermove', { x: gridDom.x + rect.cx, y: gridDom.y + rect.cy });
  await wait(120);
  const gridTemp = document.querySelector('.canvas-node.is-dummy');
  ok(!!gridTemp, '吸附拖出中出现虚影');
  const gridBox = { x: parseFloat(gridTemp.style.transform.match(/translate\(([-\d.]+)px/)[1]), y: parseFloat(gridTemp.style.transform.match(/,\s*([-\d.]+)px\)/)[1]) };
  ok(gridBox.x % view.gridSpacing === 0 && gridBox.y % view.gridSpacing === 0,
    '虚影位置按 snapToGrid 对齐网格');
  screenPointer(window, 'pointerup', { x: gridDom.x + rect.cx, y: gridDom.y + rect.cy });
  await wait(250);
  ok(dummies() === 0, '吸附拖出结束无残留虚影');
  ok(view.nodes.size === gridNodes + 1, '吸附拖出仍建卡');
  const snapped = Array.from(view.nodes.values()).find((n) => n.text === '' && n.x === gridBox.x);
  if (snapped) view.removeNode(snapped);
  await wait(150);
  view.options.snapToGrid = false;

  /* ========== C2. snapToObjects 开启 + 板上已有卡片：拖出不得卡死（NaN 吸附死循环） ========== */
  view.options.snapToObjects = true;
  const objBefore = view.nodes.size;
  screenPointer(btn, 'pointerdown', startAt);
  const objDom = view.domFromPos({ x: 60, y: 40 });
  screenPointer(window, 'pointermove', { x: objDom.x + rect.cx, y: objDom.y + rect.cy });
  await wait(150);
  const objTemp = document.querySelector('.canvas-node.is-dummy');
  ok(!!objTemp, '物体吸附拖出中出现虚影');
  const objStyle = String(objTemp && objTemp.style.transform);
  ok(!objStyle.includes('NaN') && /translate\([^)]*\)/.test(objStyle), '物体吸附虚影坐标有限:: ' + objStyle);
  screenPointer(window, 'pointerup', { x: objDom.x + rect.cx, y: objDom.y + rect.cy });
  await wait(300);
  ok(dummies() === 0, '物体吸附拖出结束无残留虚影');
  ok(view.nodes.size === objBefore + 1, '物体吸附拖出仍建卡');
  const objDropped = Array.from(view.nodes.values()).find((n) => n.text === '');
  if (objDropped) view.removeNode(objDropped);
  await wait(150);
  view.options.snapToObjects = false;

  /* ================= D. 连线手柄与边端点：纯点击不留虚影/悬空边 ================= */
  const n1 = nodeOf('n1');
  const n2 = nodeOf('n2');
  const edgesBefore = view.edges.size;
  const connectPoint = n1.nodeEl.querySelector('.canvas-node-connection-point[data-side="right"]');
  ok(!!connectPoint, '节点带连接点');
  const cpRect = connectPoint.getBoundingClientRect();
  screenPointer(connectPoint, 'pointerdown', { x: cpRect.x + cpRect.width / 2, y: cpRect.y + cpRect.height / 2 });
  await wait(30);
  ok(dummies() === 0, '连接点 pointerdown 不建虚影');
  screenPointer(connectPoint, 'pointerup', { x: cpRect.x + cpRect.width / 2, y: cpRect.y + cpRect.height / 2 });
  await wait(200);
  ok(dummies() === 0, '连接点点击后无残留虚影');
  ok(view.edges.size === edgesBefore, '连接点点击不留悬空边');
  const edge = edgeOf('e1');
  const edgeGroup = edge.lineGroupEl;
  const egRect = edgeGroup.getBoundingClientRect();
  screenPointer(edgeGroup, 'pointerdown', { x: egRect.x + egRect.width / 2, y: egRect.y + egRect.height / 2 });
  await wait(30);
  ok(dummies() === 0, '边端点 pointerdown 不建虚影');
  screenPointer(edgeGroup, 'pointerup', { x: egRect.x + egRect.width / 2, y: egRect.y + egRect.height / 2 });
  await wait(200);
  ok(dummies() === 0, '边端点点击后无残留虚影');
  ok(view.edges.size === edgesBefore, '边端点点击后边数不变');

  /* 拖动中的临时节点必须不挂 DOM：原版只做几何占位，挂出来就是 100×100 accent 方框 */
  screenPointer(connectPoint, 'pointerdown', { x: cpRect.x + cpRect.width / 2, y: cpRect.y + cpRect.height / 2 });
  await wait(30);
  pointer(window, 'pointermove', { x: 120, y: 80 });
  await wait(120);
  ok(dummies() === 0, '连线拖动中不出现可见虚影');
  window.dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', pointerId: 32, button: 0, buttons: 0,
    clientX: cpRect.x + cpRect.width / 2, clientY: cpRect.y + cpRect.height / 2,
  }));
  await wait(220);
  ok(dummies() === 0, '连线拖动取消后无残留虚影');
  ok(view.edges.size === edgesBefore, '连线拖动取消后不留悬空边');

  screenPointer(edgeGroup, 'pointerdown', { x: egRect.x + egRect.width / 2, y: egRect.y + egRect.height / 2 });
  await wait(30);
  pointer(window, 'pointermove', { x: 150, y: 90 });
  await wait(120);
  ok(dummies() === 0, '边端点拖动中不出现可见虚影');
  window.dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', pointerId: 32, button: 0, buttons: 0,
    clientX: egRect.x + egRect.width / 2, clientY: egRect.y + egRect.height / 2,
  }));
  await wait(220);
  ok(dummies() === 0, '边端点拖动取消后无残留虚影');

  /* 连线成功吸附后：边建立、拖动态复位、节点仍可拖动 */
  const cpRect2 = connectPoint.getBoundingClientRect();
  const n2Box = n2.nodeEl.getBoundingClientRect();
  const dropAt = { x: n2Box.x + n2Box.width / 2, y: n2Box.y + n2Box.height / 2 };
  screenPointer(connectPoint, 'pointerdown', { x: cpRect2.x + cpRect2.width / 2, y: cpRect2.y + cpRect2.height / 2 });
  await wait(30);
  screenPointer(window, 'pointermove', dropAt);
  await wait(100);
  screenPointer(window, 'pointerup', dropAt);
  await wait(300);
  ok(view.edges.size === edgesBefore + 1, '连线吸附后建立新边');
  ok(view.isDragging === false, '连线成功后拖动状态复位');
  const n2After = centerOf(n2);
  const snapBefore = { x: n2.x, y: n2.y };
  pointer(n2.contentBlockerEl, 'pointerdown', n2After);
  pointer(window, 'pointermove', { x: n2After.x + 45, y: n2After.y + 25 });
  await wait(80);
  pointer(window, 'pointerup', { x: n2After.x + 45, y: n2After.y + 25 });
  await wait(200);
  ok(n2.x !== snapBefore.x || n2.y !== snapBefore.y, '连线成功后节点仍可拖动');
  const addedEdge = Array.from(view.edges.values()).find((e) => e.id !== 'e1');
  if (addedEdge) view.removeEdge(addedEdge);
  await wait(150);

  /* 纯点击后拖动态必须复位：isDragging 卡死会吞掉滚轮、悬停手柄与双击建卡 */
  const c2click = centerOf(n2);
  pointer(n2.contentBlockerEl, 'pointerdown', c2click);
  await wait(20);
  pointer(window, 'pointerup', { x: c2click.x, y: c2click.y });
  await wait(150);
  ok(view.isDragging === false, '纯点击卡片后不残留拖动状态');
  ok(!view.wrapperEl.classList.contains('is-dragging'), '纯点击卡片后无 is-dragging 类');
  const beforeMove = { x: n2.x, y: n2.y };
  pointer(n2.contentBlockerEl, 'pointerdown', c2click);
  pointer(window, 'pointermove', { x: c2click.x + 50, y: c2click.y + 25 });
  await wait(80);
  pointer(window, 'pointerup', { x: c2click.x + 50, y: c2click.y + 25 });
  await wait(180);
  ok(n2.x !== beforeMove.x || n2.y !== beforeMove.y, '点击后节点仍可拖动');
  ok(view.isDragging === false, '拖动收尾后拖动状态复位');

  /* ================= E. Alt 克隆拖动：收尾不留替身虚影 ================= */
  view.selectOnly(n1);
  await wait(80);
  const c1 = centerOf(n1);
  pointer(n1.contentBlockerEl, 'pointerdown', c1);
  pointer(window, 'pointermove', { x: c1.x + 40, y: c1.y + 20 });
  await wait(60);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
  await wait(60);
  ok(dummies() === 1, '克隆拖动中出现替身虚影');
  pointer(window, 'pointerup', { x: c1.x + 40, y: c1.y + 20 }, { altKey: true });
  await wait(250);
  ok(dummies() === 0, '克隆拖动结束无残留虚影');
  view.deselectAll();
  await wait(80);

  /* ================= F. pointercancel 中断拖动 ================= */
  pointer(n1.contentBlockerEl, 'pointerdown', c1);
  pointer(window, 'pointermove', { x: c1.x + 30, y: c1.y + 15 });
  await wait(60);
  window.dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', pointerId: 31, button: 0, buttons: 0,
    clientX: c1.x + rect.cx, clientY: c1.y + rect.cy,
  }));
  await wait(200);
  ok(dummies() === 0, 'pointercancel 后无残留虚影');
  ok(!document.querySelector('.canvas-wrapper').classList.contains('is-dragging'), 'pointercancel 结束拖动态');

  /* ================= G. 真实多帧拖动：节点真的移动并落盘 ================= */
  const before = { x: n2.x, y: n2.y };
  const c2 = centerOf(n2);
  pointer(n2.contentBlockerEl, 'pointerdown', c2);
  for (let i = 1; i <= 4; i++) {
    pointer(window, 'pointermove', { x: c2.x + i * 18, y: c2.y + i * 9 });
    await wait(30);
  }
  pointer(window, 'pointerup', { x: c2.x + 72, y: c2.y + 36 });
  await wait(250);
  ok(n2.x !== before.x || n2.y !== before.y, '多帧拖动后节点坐标真的变化');
  ok(n2.x > before.x && n2.y > before.y, '节点跟着指针方向移动');
  ok(dummies() === 0, '拖动结束无残留虚影');
  await wait(800);
  const savedDrag = JSON.parse(await app.vault.read(board));
  const savedN2 = savedDrag.nodes.find((n) => n.id === 'n2');
  ok(savedN2 && savedN2.x === n2.x && savedN2.y === n2.y, '拖动结果落盘画布 JSON');

  /* ================= H. .canvas 文件卡：按原版画布嵌入渲染缩略图 ================= */
  const canvasCard = view.createFileNode({
    pos: { x: -200, y: 300 }, size: { width: 400, height: 400 }, file: board, focus: false, save: false,
  });
  await until(() => !!canvasCard.nodeEl.querySelector('svg.canvas-minimap'), '.canvas 卡渲染出缩略图');
  ok(canvasCard.contentEl.hasClass('canvas-embed'), '.canvas 卡内容层是画布嵌入（原版 cte）');
  ok(!canvasCard.contentEl.textContent.includes('"nodes"'), '.canvas 卡不显示原始 JSON 文本');
  const minimap = canvasCard.nodeEl.querySelector('svg.canvas-minimap');
  const boardNow = JSON.parse(await app.vault.read(board));
  ok(minimap.querySelectorAll('rect').length === boardNow.nodes.length, '缩略图每个节点一个圆角矩形');
  ok(minimap.querySelectorAll('path').length === boardNow.edges.length, '缩略图每条边一个路径');
  const firstRect = minimap.querySelector('rect');
  ok(firstRect.getAttribute('rx') === '20' && firstRect.getAttribute('ry') === '20', '缩略图节点是圆角矩形 rx/ry=20');
  const viewBox = (minimap.getAttribute('viewBox') || '').split(' ').map(Number);
  const xs = boardNow.nodes.map((n) => n.x);
  const xe = boardNow.nodes.map((n) => n.x + n.width);
  const ys = boardNow.nodes.map((n) => n.y);
  const ye = boardNow.nodes.map((n) => n.y + n.height);
  const union = {
    minX: Math.min(...xs), maxX: Math.max(...xe), minY: Math.min(...ys), maxY: Math.max(...ye),
  };
  const pad = Math.max(union.maxX - union.minX, union.maxY - union.minY) / 20;
  ok(viewBox.length === 4 && Math.abs(viewBox[0] - (union.minX - pad)) < 1
    && Math.abs(viewBox[1] - (union.minY - pad)) < 1
    && Math.abs(viewBox[2] - (union.maxX - union.minX + pad * 2)) < 1,
    '缩略图 viewBox 取内容并集外扩 5%');
  view.removeNode(canvasCard);
  await wait(120);

  /* ================= I. 文件卡：已聚焦时单击正文进编辑并写回真实文件 ================= */
  const noteFile = await app.vault.create('Note2.md', '# 标题\n\n原文');
  const mdCard = view.createFileNode({
    pos: { x: -400, y: 300 }, size: { width: 400, height: 300 }, file: noteFile, focus: false, save: false,
  });
  await until(() => !!mdCard.previewEl, '文件卡先渲染预览');
  view.selectOnly(mdCard);
  await wait(150);
  ok(mdCard.nodeEl.hasClass('is-focused'), '文件卡已聚焦');
  mdCard.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 0, clientY: 0 }));
  await until(() => mdCard.isEditing, '已聚焦的文件卡单击正文进编辑（原版 hg）');
  ok(mdCard.editor.cm.contentDOM.getAttribute('contenteditable') === 'true', '文件卡编辑器可写');
  mdCard.editor.setValue('# 标题\n\n改过的正文');
  // 400ms 防抖 + 异步落盘：全量并发时 800ms 可能不够，改为轮询等待（最多 3s）。
  let written = false;
  for (let n = 0; n < 120 && !written; n++) {
    written = (await app.vault.read(noteFile)).includes('改过的正文');
    if (!written) await wait(25);
  }
  ok(written, '文件卡编辑写回真实文件');
  view.removeNode(mdCard);
  await wait(120);

  await app.saveLayout();
  return { pass: true, checks, count: checks.length };
})()
