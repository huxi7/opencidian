/**
 * [INPUT]: 独立临时 vault、真实文件树/标签组 DOM、OBS_SIDEBAR_VIEW=light|dark 主题开关。
 * [OUTPUT]: 返回 { pass, checks }；失败抛出异常，供 run.mjs 判定；截图由 run.mjs 在场景结束后抓取。
 * [POS]: drag-drop 场景。锁定 1.14.4 的两条核心拖拽链路：
 *        文件树（x8.dragFiles/f$/FI/RI、attachDropHandler 的 750ms 悬停展开、根容器落点）与
 *        标签（Workspace.onDragLeaf、VD.getTabInsertLocation/insertChild、落点覆盖层与指标类）。
 *        断言同时覆盖模型顺序、DOM 顺序与磁盘落盘，防止"模型动了、界面没动"假通过。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs');
  const path = require('path');
  const workspace = app.workspace;
  const checks = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, label) => { if (!value) throw new Error('✗ ' + label); checks.push(label); };
  const until = async (fn, label) => {
    for (let i = 0; i < 100; i++) { if (fn()) { checks.push(label); return; } await pause(40); }
    throw new Error('✗ ' + label);
  };
  const theme = process.env.OBS_SIDEBAR_VIEW === 'dark' ? 'obsidian' : 'moonstone';
  app.settings.updateAppearance({ theme });
  await pause(150);
  check(document.body.hasClass(theme === 'obsidian' ? 'theme-dark' : 'theme-light'), '浅/深主题类生效');

  const explorerLeaf = workspace.getLeavesOfType('file-explorer')[0]
    || await workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true });
  const view = explorerLeaf.view;
  view._sortOrder = 'alphabetical';
  view._collapsed.clear();
  view.render();
  view._selection.clear();
  await pause(120);

  const treeTitle = (p) => view.treeEl.querySelector(`.nav-file-title[data-path="${p}"], .nav-folder-title[data-path="${p}"]`);
  const rowCount = (p) => view.treeEl.querySelectorAll(`[data-path="${p}"]`).length;
  const disk = (p) => fs.existsSync(path.join(app.vaultPath, p));
  const dataTransfer = () => new DataTransfer();
  const fireDrag = (el, type, dt, extra = {}) => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...extra });
    el.dispatchEvent(event);
    return event;
  };
  const dragStart = (el, dt, x = 0, y = 0) => fireDrag(el, 'dragstart', dt, { clientX: x, clientY: y });
  const dragOver = (el, dt, x, y) => fireDrag(el, 'dragover', dt, { clientX: x, clientY: y });
  const dropOn = (el, dt, x, y) => fireDrag(el, 'drop', dt, { clientX: x, clientY: y });
  const dragEnd = (el, dt, x = 0, y = 0) => fireDrag(el, 'dragend', dt, { clientX: x, clientY: y });
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, width: r.width, top: r.top, height: r.height }; };

  // ---------------------------------------------------------------- fixture
  const stamp = Date.now().toString(36);
  const base = 'DD-' + stamp;
  await app.vault.createFolder(base);
  const alpha = await app.vault.createFolder(base + '/Alpha');
  const beta = await app.vault.createFolder(base + '/Beta');
  const sub = await app.vault.createFolder(base + '/Alpha/Sub');
  const fileA = await app.vault.create(base + '/file-a.md', '# file a\n');
  const fileB = await app.vault.create(base + '/file-b.md', '# file b\n');
  const rootBack = await app.vault.create(base + '/root-back.md', '# root back\n');
  const inner = await app.vault.create(base + '/Alpha/inner.md', '# inner\n');
  await app.vault.createFolder(base + '/Beta/Hover');
  await app.vault.create(base + '/Beta/Hover/h.md', '# hover\n');
  await pause(150);
  view.render();
  await pause(80);
  check(!!treeTitle(fileA.path) && !!treeTitle(alpha.path), '文件树 fixture 可见');

  // ------------------------------------------------------------ 文件 → 文件夹
  const dt1 = dataTransfer();
  const src1 = treeTitle(fileA.path);
  const dst1 = treeTitle(alpha.path);
  const evStart1 = dragStart(src1, dt1, 10, 10);
  check(!evStart1.defaultPrevented, '文件 dragstart 未被取消');
  check(!!treeTitle(fileA.path).hasClass('is-being-dragged'), '文件 dragstart 给源行 is-being-dragged');
  check(document.body.hasClass('is-grabbing'), '文件拖拽 body.is-grabbing');
  const ghost1 = document.querySelector('body > .drag-ghost');
  check(!!ghost1 && !!ghost1.querySelector('.drag-ghost-self > svg') && /file-a/.test(ghost1.textContent), '文件 ghost 用 drag-ghost-self + 图标 + 短名');
  const over1 = dragOver(dst1, dt1, center(dst1).x, center(dst1).y);
  check(over1.defaultPrevented, '文件拖到文件夹时 dragover 被接收');
  check(dst1.closest('.nav-folder').hasClass('is-being-dragged-over'), '文件夹落点显示 is-being-dragged-over');
  dropOn(dst1, dt1, center(dst1).x, center(dst1).y);
  await until(() => !!app.vault.getFileByPath(base + '/Alpha/file-a.md'), '文件移入文件夹（模型路径）');
  check(disk(base + '/Alpha/file-a.md'), '文件移入文件夹（真实落盘）');
  check(!app.vault.getFileByPath(base + '/file-a.md'), '移动后旧路径消失');
  dragEnd(src1, dt1);
  await pause(50);
  check(!document.querySelector('body > .drag-ghost'), 'dragend 清理 ghost');
  check(!document.body.hasClass('is-grabbing'), 'dragend 清理 body.is-grabbing');
  check(view._draggingItem === null && view._draggingItems === null, 'dragend 清理拖拽生命周期');
  check(!view.treeEl.querySelector('.is-being-dragged-over'), 'dragend 清理 hover 类');

  // ------------------------------------------------------------ 文件夹 → 文件夹
  const alphaMoved = base + '/Beta/Alpha';
  const dt2 = dataTransfer();
  const src2 = treeTitle(alpha.path);
  const dst2 = treeTitle(beta.path);
  dragStart(src2, dt2, 10, 10);
  check(!!document.querySelector('.drag-ghost'), '文件夹 dragstart 显示 ghost');
  dragOver(dst2, dt2, center(dst2).x, center(dst2).y);
  dropOn(dst2, dt2, center(dst2).x, center(dst2).y);
  await until(() => !!app.vault.getFolderByPath(alphaMoved), '文件夹移入文件夹（模型路径）');
  check(disk(alphaMoved) && disk(alphaMoved + '/file-a.md'), '文件夹整体移动真实落盘');
  dragEnd(src2, dt2);
  await pause(80);

  // ------------------------------------------------------------------ 多选拖拽
  const m1 = await app.vault.create(base + '/m1.md', '# m1\n');
  const m2 = await app.vault.create(base + '/m2.md', '# m2\n');
  await pause(120);
  view.render();
  view._selection.clear();
  treeTitle(m1.path).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  treeTitle(m2.path).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  check(view._selection.size === 2, '多选两项就绪');
  const dt3 = dataTransfer();
  const src3 = treeTitle(m1.path);
  dragStart(src3, dt3, 10, 10);
  const payload = JSON.parse(dt3.getData('text/plain'));
  check(payload.type === 'files' && Array.isArray(payload.items) && payload.items.length === 2, '多选载荷 type=files 且 items=2');
  check(payload.items.some((it) => it.path === m1.path) && payload.items.some((it) => it.path === m2.path), '多选载荷包含全部选中项');
  const multiGhost = document.querySelector('body > .drag-ghost');
  check(!!multiGhost && !!multiGhost.querySelector('.drag-ghost-self > svg') && /2/.test(multiGhost.textContent), '多选 ghost 显示数量');
  check(view.treeEl.querySelectorAll('.nav-file-title.is-being-dragged').length === 2, '多选拖动给所有选中行 is-being-dragged');
  const dst3 = treeTitle(base + '/Beta');
  dragOver(dst3, dt3, center(dst3).x, center(dst3).y);
  dropOn(dst3, dt3, center(dst3).x, center(dst3).y);
  await until(() => !!app.vault.getFileByPath(base + '/Beta/m1.md') && !!app.vault.getFileByPath(base + '/Beta/m2.md'), '多选整体移入文件夹');
  check(disk(base + '/Beta/m1.md') && disk(base + '/Beta/m2.md'), '多选移动真实落盘');
  dragEnd(src3, dt3);
  await pause(60);
  view._selection.clear();
  view.render();
  await pause(60);

  // ------------------------------------------------------------ 同父 no-op
  const innerNow = alphaMoved + '/inner.md';
  const dt4 = dataTransfer();
  const src4 = treeTitle(innerNow);
  dragStart(src4, dt4, 10, 10);
  const sameParent = treeTitle(alphaMoved);
  const sameOver = dragOver(sameParent, dt4, center(sameParent).x, center(sameParent).y);
  check(!sameOver.defaultPrevented, '同父文件夹不接收 dragover（无合法移动）');
  dropOn(sameParent, dt4, center(sameParent).x, center(sameParent).y);
  await pause(120);
  check(!!app.vault.getFileByPath(innerNow), '同父拖放是 no-op');
  check(rowCount(innerNow) === 1, '同父拖放不产生重复行');
  dragEnd(src4, dt4);

  // ------------------------------------------------------ 非法自嵌套被拒
  const dt5 = dataTransfer();
  const src5 = treeTitle(alphaMoved);
  dragStart(src5, dt5, 10, 10);
  const nestedTarget = treeTitle(alphaMoved + '/Sub');
  const nestedOver = dragOver(nestedTarget, dt5, center(nestedTarget).x, center(nestedTarget).y);
  check(!nestedOver.defaultPrevented, '文件夹拖进自身子目录不接收 dragover');
  dropOn(nestedTarget, dt5, center(nestedTarget).x, center(nestedTarget).y);
  await pause(120);
  check(!!app.vault.getFolderByPath(alphaMoved) && !!app.vault.getFolderByPath(alphaMoved + '/Sub'), '非法自嵌套后源与目标都还在');
  check(!app.vault.getFolderByPath(alphaMoved + '/Sub/Alpha'), '非法自嵌套未创建嵌套副本');
  dragEnd(src5, dt5);

  // ------------------------------------------------ 悬停 750ms 自动展开
  const hover = app.vault.getFolderByPath(base + '/Beta/Hover');
  view._collapsed.add(hover.path);
  view.render();
  await pause(60);
  check(view._collapsed.has(hover.path), 'Hover 文件夹初始折叠');
  const dt6 = dataTransfer();
  const src6 = treeTitle(rootBack.path);
  dragStart(src6, dt6, 10, 10);
  const hoverTitle = treeTitle(hover.path);
  dragOver(hoverTitle, dt6, center(hoverTitle).x, center(hoverTitle).y);
  await until(() => !view._collapsed.has(hover.path), '悬停折叠文件夹 750ms 自动展开');
  const hoverInner = treeTitle(hover.path + '/h.md');
  check(!!hoverInner, '自动展开后子项可见');
  const hoverTarget = treeTitle(hover.path);
  dragOver(hoverTarget, dt6, center(hoverTarget).x, center(hoverTarget).y);
  dropOn(hoverTarget, dt6, center(hoverTarget).x, center(hoverTarget).y);
  await until(() => !!app.vault.getFileByPath(hover.path + '/root-back.md'), '展开后可将文件放入该文件夹');
  dragEnd(src6, dt6);
  await pause(80);

  // ------------------------------------------------- 根容器空白处落点
  const rootDropFile = await app.vault.create(base + '/Beta/root-drop.md', '# root drop\n');
  await pause(140);
  view.render();
  await pause(60);
  const dt7 = dataTransfer();
  const src7 = treeTitle(rootDropFile.path);
  dragStart(src7, dt7, 10, 10);
  const rootOver = dragOver(view.treeEl, dt7, 20, 20);
  check(rootOver.defaultPrevented, '空白根区域接收库内拖拽');
  dropOn(view.treeEl, dt7, 20, 20);
  await until(() => !!app.vault.getFileByPath('root-drop.md'), '库内项拖到空白处移回仓库根');
  check(disk('root-drop.md') && !app.vault.getFileByPath(base + '/Beta/root-drop.md'), '根落点真实移动且旧路径消失');
  dragEnd(src7, dt7);
  await pause(80);

  // ================================================================= 标签拖拽
  const tA = await app.vault.create('Tab-A.md', '# tab a\n');
  const tB = await app.vault.create('Tab-B.md', '# tab b\n');
  const tC = await app.vault.create('Tab-C.md', '# tab c\n');
  const leafA = await workspace.openFile(tA);
  await pause(80);
  const leafB = await workspace.openFile(tB, { newLeaf: 'tab' });
  const leafC = await workspace.openFile(tC, { newLeaf: 'tab' });
  check(leafC._tabHeaderEl.getAnimations().some((a) => a.effect && a.effect.getTiming().duration === 200), '新标签头有 200ms 开启动画（原版 updateTabDisplay）');
  await pause(320);
  const group1 = leafC.parent;
  const headerA = leafA._tabHeaderEl;
  const headerB = leafB._tabHeaderEl;
  const headerC = leafC._tabHeaderEl;
  const groupOrder = () => group1.children.map((l) => l.view.getDisplayText());
  const headerOrder = () => [...group1._headersInner.children].filter((h) => h._leaf).map((h) => h._leaf.view.getDisplayText());
  const tabDt = dataTransfer();
  const cRect = center(headerC);
  const aRect = headerA.getBoundingClientRect();

  // 同组重排：C → A 之前
  dragStart(headerC, tabDt, cRect.x, cRect.y);
  check(tabDt.getData('text/plain') === '', '标签拖拽 text/plain 为空（原版 onDragLeaf）');
  const tabGhost = document.querySelector('body > .drag-ghost.mod-leaf');
  check(!!tabGhost && !!tabGhost.querySelector('.drag-ghost-icon svg') && /Tab-C|C/.test(tabGhost.textContent), '标签 ghost 是 drag-ghost.mod-leaf + 图标 + 标题');
  const tabOver = dragOver(headerA, tabDt, aRect.left + 2, aRect.top + aRect.height / 2);
  check(tabOver.defaultPrevented, '标签 dragover 被接收');
  const tabOverlay = () => document.querySelector('.workspace-drop-overlay.mod-active');
  const ov1 = tabOverlay();
  check(!!ov1, '同组重排显示 workspace-drop-overlay 落点');
  const ov1Rect = ov1.getBoundingClientRect();
  check(Math.abs(ov1Rect.left - (aRect.left - 5)) <= 1.01 && Math.abs(ov1Rect.width - 10) <= 0.5 && Math.abs(ov1Rect.height - aRect.height) <= 1.01,
    '落点=10px 竖条贴 A 左缝（x=A.left-5，高度=标签高）');
  check(getComputedStyle(ov1, '::before').opacity === '0.5', '落点 ::before 50% accent（原版 workspace-drop-overlay）');
  check(document.body.hasClass('is-grabbing'), '标签拖拽 body.is-grabbing');
  dropOn(headerA, tabDt, aRect.left + 2, aRect.top + aRect.height / 2);
  dragEnd(headerC, tabDt);
  await pause(80);
  const orderAfter = groupOrder();
  check(orderAfter.indexOf('Tab-C') === orderAfter.indexOf('Tab-A') - 1, '同组重排模型顺序：C 在 A 之前');
  check(JSON.stringify(headerOrder()) === JSON.stringify(orderAfter), '同组重排 DOM 头顺序跟随模型');
  check(workspace.activeLeaf === leafC, '重排后活动标签是被拖标签');
  check(!tabOverlay(), 'drop 后落点清理');
  check(!document.body.hasClass('is-grabbing'), 'drop 后 body.is-grabbing 清理');
  check(!document.querySelector('body > .drag-ghost.mod-leaf'), 'drop 后标签 ghost 清理');

  // 右半区指示线
  const bRect = headerB.getBoundingClientRect();
  const tabDt2 = dataTransfer();
  dragStart(headerC, tabDt2, cRect.x, cRect.y);
  dragOver(headerB, tabDt2, bRect.right - 2, bRect.top + bRect.height / 2);
  await pause(130);   // 原版 overlay 有 100ms transition
  const ov2 = tabOverlay();
  const ov2r = ov2 ? ov2.getBoundingClientRect() : null;
  check(!!ov2 && Math.abs(ov2.getBoundingClientRect().left - (bRect.right - 5)) <= 1.01,
    '右半区落点贴在 B 右缝 :: overlay=' + (ov2r ? ov2r.left.toFixed(2) + '/' + ov2r.width.toFixed(2) : 'none') + ' expected=' + (bRect.right - 5).toFixed(2) + ' b.right=' + bRect.right.toFixed(2));
  dragEnd(headerC, tabDt2);
  await pause(40);
  check(!tabOverlay(), 'dragend 清理落点');

  // 固定标签禁拖
  leafB.pinned = true;
  workspace._syncAllTabs();
  await pause(60);
  const pinDt = dataTransfer();
  const pinStart = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: pinDt });
  leafB._tabHeaderEl.dispatchEvent(pinStart);
  check(pinStart.defaultPrevented, 'pinned 标签 dragstart 被取消');
  check(!workspace._dragData, 'pinned 标签不建立 _dragData');
  check(!document.body.hasClass('is-grabbing') && !document.querySelector('body > .drag-ghost.mod-leaf'), 'pinned 标签不产生 ghost/抓取态');
  leafB.pinned = false;
  workspace._syncAllTabs();
  await pause(40);

  // 跨标签组移动：D 从分割组拖回 group1
  const tD = await app.vault.create('Tab-D.md', '# tab d\n');
  const splitLeaf = workspace.getLeaf('split');
  await splitLeaf.setViewState({ type: 'markdown', state: { file: tD.path } });
  await pause(120);
  const group2 = splitLeaf.parent;
  check(group2 !== group1 && group2.children.includes(splitLeaf), '第二标签组就绪');
  const dRect = center(splitLeaf._tabHeaderEl);
  const targetBRect = leafB._tabHeaderEl.getBoundingClientRect();
  const crossDt = dataTransfer();
  dragStart(splitLeaf._tabHeaderEl, crossDt, dRect.x, dRect.y);
  dragOver(leafB._tabHeaderEl, crossDt, targetBRect.right - 2, targetBRect.top + targetBRect.height / 2);
  dropOn(leafB._tabHeaderEl, crossDt, targetBRect.right - 2, targetBRect.top + targetBRect.height / 2);
  dragEnd(splitLeaf._tabHeaderEl, crossDt);
  await pause(120);
  check(splitLeaf.parent === group1, '跨组移动后叶子归属 group1（不重建）');
  check(group1.children.includes(splitLeaf), 'group1 模型包含被拖叶子');
  check(!group2.children.includes(splitLeaf), '源组模型移除被拖叶子');
  check(!group2.containerEl || !group2.containerEl.isConnected, '源组搬空后容器移除');
  check(JSON.stringify(headerOrder()) === JSON.stringify(groupOrder()), '跨组移动后 DOM 头顺序与模型一致');
  check(workspace.activeLeaf === splitLeaf, '跨组移动后活动叶子是被拖叶子');
  check(!document.body.hasClass('is-grabbing'), '跨组 drop 后 body.is-grabbing 清理');

  // ------------------------------------------- 标签落到叶容器：center 覆盖层
  const tE = await app.vault.create('Tab-E.md', '# tab e\n');
  const eLeaf = workspace.getLeaf('split');
  await eLeaf.setViewState({ type: 'markdown', state: { file: tE.path } });
  await pause(120);
  const group3 = eLeaf.parent;
  const targetLeaf = group1.activeLeaf;
  const targetLeafEl = targetLeaf._leafEl;
  const leafRect = targetLeafEl.getBoundingClientRect();
  const centerDt = dataTransfer();
  dragStart(eLeaf._tabHeaderEl, centerDt, 10, 10);
  const centerOver = dragOver(targetLeafEl, centerDt, leafRect.left + leafRect.width / 2, leafRect.top + leafRect.height / 2);
  check(centerOver.defaultPrevented, '标签落到叶中心区被接收');
  const centerOverlay = targetLeafEl.querySelector('.workspace-drop-overlay.mod-active');
  check(!!centerOverlay && targetLeafEl.hasClass('is-drop-target'), 'center 区显示 workspace-drop-overlay.mod-active + is-drop-target');
  check(Math.abs(parseFloat(centerOverlay.style.width) - 10) < 0.5, 'center 覆盖层为 10px 插入条');
  const insertLeft = parseFloat(centerOverlay.style.left);
  const boundary = group1.children.some((l) => Math.abs(l._tabHeaderEl.getBoundingClientRect().left - insertLeft - 5) < 2);
  check(boundary, 'center 覆盖层贴在标签插入缝上');
  dropOn(targetLeafEl, centerDt, leafRect.left + leafRect.width / 2, leafRect.top + leafRect.height / 2);
  dragEnd(eLeaf._tabHeaderEl, centerDt);
  await pause(120);
  check(eLeaf.parent === group1, 'center drop 把标签并入目标标签组');
  check(!group3.containerEl || !group3.containerEl.isConnected, 'center drop 后源组搬空并移除');
  check(!targetLeafEl.querySelector('.workspace-drop-overlay.mod-active'), 'center drop 后覆盖层清理');

  // ------------------------------------------ 标签落到叶边缘：左分割 + 覆盖层几何
  const tF = await app.vault.create('Tab-F.md', '# tab f\n');
  const fLeaf = workspace.getLeaf('split');
  await fLeaf.setViewState({ type: 'markdown', state: { file: tF.path } });
  await pause(120);
  const groupF = fLeaf.parent;
  const anchorLeaf = group1.activeLeaf;
  const anchorEl = anchorLeaf._leafEl;
  const anchorRect = anchorEl.getBoundingClientRect();
  const fDt = dataTransfer();
  dragStart(fLeaf._tabHeaderEl, fDt, 10, 10);
  dragOver(anchorEl, fDt, anchorRect.left + 4, anchorRect.top + anchorRect.height / 2);
  const leftOverlay = anchorEl.querySelector('.workspace-drop-overlay.mod-active');
  check(!!leftOverlay && anchorEl.hasClass('mod-drop-left'), '左边缘显示 mod-drop-left + 覆盖层');
  const expectedWidth = Math.max(anchorRect.width / 3, 40);
  check(Math.abs(parseFloat(leftOverlay.style.width) - expectedWidth) < 1, '左分割覆盖层宽度 max(width/3, 40)');
  check(Math.abs(parseFloat(leftOverlay.style.left) - anchorRect.left) < 1, '左分割覆盖层贴叶左缘');
  dropOn(anchorEl, fDt, anchorRect.left + 4, anchorRect.top + anchorRect.height / 2);
  dragEnd(fLeaf._tabHeaderEl, fDt);
  await pause(180);
  check(fLeaf.parent !== group1 && fLeaf.parent !== groupF, '左边缘 drop 建立新标签组');
  check(fLeaf.parent.children.length === 1 && fLeaf.parent.children[0] === fLeaf, '新分割组只含被拖标签');
  check(!anchorEl.hasClass('mod-drop-left'), '分割 drop 后 mod-drop-left 清理');
  const fTabsRect = fLeaf.parent.containerEl.getBoundingClientRect();
  const g1Rect = group1.containerEl.getBoundingClientRect();
  check(fTabsRect.left <= g1Rect.left + 1, '左分割组位于原组左侧');

  // 收尾：恢复浅/深主题与稳定布局供截图
  app.settings.updateAppearance({ theme });
  await pause(200);
  view.render();
  workspace.setActiveLeaf(leafA, { focus: false });
  await pause(120);
  return { pass: true, checks, count: checks.length, fixture: base };
})()
