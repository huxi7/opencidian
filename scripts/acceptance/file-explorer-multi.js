/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: file-explorer-multi 场景。仅由 run.mjs 在带标记的临时库执行。
 *        断言对齐原版 app.js 的 a2/S8/x8 选择层：Alt 切换、Shift 可见顺序范围、空白清空、
 *        方向键焦点、Delete 删除、拖动载荷 items、右键菜单作用于选择集。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (ok, msg) => { if (!ok) throw Error('✗ ' + msg); checks.push(msg); };
  const until = async (fn, msg) => {
    for (let i = 0; i < 80; i++) { if (fn()) { checks.push(msg); return; } await pause(50); }
    throw Error('✗ ' + msg);
  };
  const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

  // 打开文件树视图（默认启用；缺失则补建左栏叶子）
  const leaf = app.workspace.getLeavesOfType('file-explorer')[0]
    || await app.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true });
  const view = leaf.view;
  check(!!view && !!view.treeEl && !!view._selection, '文件树视图与选择层就绪');
  const container = view.container;

  // fixture：排序固定为 A→Z，折叠状态清空
  const stamp = Date.now().toString(36);
  const dir = 'FE-Multi-' + stamp;
  const probe = await app.vault.create('FE-Probe-' + stamp + '.md', '# probe\n');
  await app.workspace.openFile(probe);
  await app.vault.createFolder(dir);
  const sub = await app.vault.createFolder(dir + '/sub');
  const file = {};
  for (const name of ['a', 'b', 'c', 'd', 'e']) file[name] = await app.vault.create(`${dir}/${name}.md`, `# ${name}\n`);
  view._sortOrder = 'alphabetical';
  view._collapsed.clear();
  view.render();
  view._selection.clear();
  view._selection.setFocus(null, false);
  await pause(80);
  check(app.workspace.getActiveFile().path === probe.path, 'fixture 与活动文件就绪');

  const title = (path) => view.treeEl.querySelector(`.nav-file-title[data-path="${path}"], .nav-folder-title[data-path="${path}"]`);
  const rows = () => [...view.treeEl.querySelectorAll('.nav-file-title[data-path], .nav-folder-title[data-path]')]
    .map((el) => el.getAttribute('data-path')).filter((p) => p !== '/');
  const selectedPaths = () => [...view.treeEl.querySelectorAll('.nav-file-title.is-selected, .nav-folder-title.is-selected')]
    .map((el) => el.getAttribute('data-path'));
  const focusedPath = () => {
    const el = view.treeEl.querySelector('.nav-file-title.has-focus, .nav-folder-title.has-focus');
    return el ? el.getAttribute('data-path') : null;
  };
  const clickRow = (path, init = {}) => {
    const el = title(path);
    check(!!el, '行存在：' + path);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  };
  const key = (k, init = {}) => container.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  /** 逐项确认删除弹窗（可见的 .modal，跳过正在关闭的那个）。 */
  const confirmDialogs = async (count, label) => {
    for (let i = 0; i < count; i++) {
      let cta = null;
      let lastModal = null;
      for (let t = 0; t < 60 && !cta; t++) {
        await pause(50);
        const modal = document.querySelector('.modal:not(.is-hidden)');
        if (modal && modal !== lastModal) {
          lastModal = modal;
          cta = modal.querySelector('.modal-button-container button.mod-warning');
        }
      }
      check(!!cta, `${label} 弹出第 ${i + 1} 个确认框`);
      cta.click();
      await pause(150);
    }
  };

  // 1. 容器可聚焦（tabindex），键盘导航有焦点锚点
  check(container.getAttribute('tabindex') === '0', 'nav-files-container 带 tabindex');
  container.focus();
  check(document.activeElement === container, '容器可获得 DOM 焦点');

  // 2. Alt+点击 = 切换选择（原版 handleItemSelection：e.altKey && !e.shiftKey）
  clickRow(file.a.path, { altKey: true });
  check(JSON.stringify(selectedPaths()) === JSON.stringify([file.a.path]), 'Alt 点击两项之一 → 该项 is-selected');
  await pause(60);
  check(app.workspace.getActiveFile().path === probe.path, 'Alt 点击不打开文件');

  // 3. 多选建立：两项同时 is-selected
  clickRow(file.b.path, { altKey: true });
  check(selectedPaths().length === 2 && view._selection.has(file.a.path) && view._selection.has(file.b.path), 'Alt 点击第二项 → 两项 is-selected');

  // 4. Alt 再点已选中项 = 切换关闭，其余保留
  clickRow(file.a.path, { altKey: true });
  check(JSON.stringify(selectedPaths()) === JSON.stringify([file.b.path]), 'Alt 再点已选中项取消该选中');

  // 4b. 原版 handleItemSelection：Alt 增选新项时会把 activeDom（上次点击项）一并选回
  clickRow(file.c.path, { altKey: true });
  check(selectedPaths().length === 2 && view._selection.has(file.b.path) && view._selection.has(file.c.path),
    'Alt 增选保留上次点击项（原版 selectItem(activeDom)）');

  // 5. Shift+点击 = 按可见顺序范围选择（原版 _H 闭区间）
  clickRow(file.a.path);
  await pause(80);
  check(selectedPaths().length === 0, '普通点击清空多选集');
  check(!!view.treeEl.querySelector(`.nav-file-title.is-active[data-path="${file.a.path}"]`), '单击仍单选：a 带 is-active');
  clickRow(file.c.path, { shiftKey: true });
  const range = selectedPaths();
  check(range.length === 3 && range.includes(file.a.path) && range.includes(file.b.path) && range.includes(file.c.path),
    'Shift 点击范围 → 首尾与中间项全选');

  // 6. 空白处点击清空
  view.treeEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  check(selectedPaths().length === 0 && view._selection.size === 0, '空白处点击清空选择集');
  // 原版 clearSelectedDoms 不重置 activeDom（锚点），本场景需要确定的锚点，故提供复位助手
  const resetSelection = () => { view._selection.clear(); view._selection.anchorPath = null; };

  // 7. 重绘后按 path 恢复（DOM 每次重建，状态存在选择集）
  clickRow(file.a.path, { altKey: true });
  clickRow(file.b.path, { altKey: true });
  view.render();
  check(selectedPaths().length === 2, '重绘后 is-selected 按 path 重新贴类');

  // 8. 文件与文件夹可混选；Alt 点击文件夹不折叠
  resetSelection();
  clickRow(file.a.path, { altKey: true });
  clickRow(sub.path, { altKey: true });
  check(selectedPaths().length === 2 && view._selection.has(sub.path), '文件与文件夹混选');
  check(view._collapsed.has(sub.path) === false, 'Alt 点击文件夹不触发折叠');

  // 9. Cmd/Ctrl 点击 = 新标签打开（原版 isModEvent：Mod → "tab"），并清空选择集
  const before = app.workspace.getLeavesOfType('markdown').length;
  clickRow(file.e.path, isMac ? { metaKey: true } : { ctrlKey: true });
  await pause(120);
  check(app.workspace.getLeavesOfType('markdown').length === before + 1, 'Mod 点击在新标签页打开');
  check(app.workspace.getActiveFile().path === file.e.path, 'Mod 点击打开目标文件');
  check(selectedPaths().length === 0, 'Mod 点击清空选择集（原版选择修饰键是 Alt 而非 Mod）');

  // 10. Delete 删除多选（走现有确认 / 回收站流程，逐项确认）
  const e1 = await app.vault.create(`${dir}/del-1.md`, '# del 1\n');
  const e2 = await app.vault.create(`${dir}/del-2.md`, '# del 2\n');
  await pause(80);
  app.settings.updateAppSettings({ promptDelete: true, trashOption: 'none' });
  resetSelection();
  clickRow(e1.path, { altKey: true });
  clickRow(e2.path, { altKey: true });
  container.focus();
  key('Delete');
  await confirmDialogs(2, 'Delete');
  await until(() => !app.vault.getFileByPath(e1.path) && !app.vault.getFileByPath(e2.path), 'Delete 删除整个选择集的文件');
  await pause(120);
  check(view._selection.size === 0, '删除后选择集剔除已消失项');

  // 11. ↑/↓ 移动键盘焦点并选择
  await app.workspace.openFile(probe);
  resetSelection();
  view._selection.setFocus(null, false);
  container.focus();
  const order = rows();
  key('ArrowDown');
  check(focusedPath() === order[0], '首次 ArrowDown 聚焦首个可见行');
  key('ArrowDown');
  check(focusedPath() === order[1], 'ArrowDown 聚焦下一行');
  check(view.treeEl.querySelectorAll('.has-focus').length === 1, 'has-focus 始终单例');
  key('ArrowUp');
  check(focusedPath() === order[0], 'ArrowUp 回到上一行');
  view._selection.setFocus(file.a.path, false);
  key('ArrowDown', { shiftKey: true });
  const shifted = selectedPaths();
  check(shifted.length === 2 && shifted.includes(file.a.path) && shifted.includes(file.b.path), 'Shift+ArrowDown 选中焦点与下一行');
  check(focusedPath() === file.b.path, 'Shift+ArrowDown 移动焦点');

  // 12. Home / End：原版 initializeKeyboardNav 未注册（scope 仅方向键/Enter/Space/F2/Delete）
  const focusBeforeHome = focusedPath();
  key('Home');
  key('End');
  check(focusedPath() === focusBeforeHome, 'Home/End 未注册，按下不改变焦点（原版证据）');
  check(view._selection.size === 2, 'Home/End 不改变选择集');

  // 13. Enter（macOS=重命名）/ Mod+Enter / Space 打开
  container.focus();
  view._selection.setFocus(file.b.path, false);
  if (isMac) {
    key('Enter');
    const input = view.treeEl.querySelector('.nav-rename-input');
    check(!!input, 'macOS Enter 进入重命名（原版 handleRenameFocusedItem）');
    check(input.closest('.tree-item-self').getAttribute('data-path') === file.b.path, '重命名输入框落在焦点项');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await pause(60);
    check(!view.treeEl.querySelector('.nav-rename-input'), 'Escape 退出重命名');
  } else {
    key('Enter');
    await pause(150);
    check(app.workspace.getActiveFile().path === file.b.path, 'Enter 打开焦点项（非 macOS 平台注册）');
  }
  key('Enter', isMac ? { metaKey: true } : { ctrlKey: true });
  await until(() => app.workspace.getActiveFile().path === file.b.path, 'Mod+Enter 打开焦点项');
  view._selection.setFocus(file.a.path, false);
  container.focus();
  key(' ');
  await until(() => app.workspace.getActiveFile().path === file.a.path, 'Space 打开焦点项');

  // 14. 拖动载荷：整个选择集进 items，同时保留单项 path/type（编辑器插入链接兼容）
  resetSelection();
  clickRow(file.c.path, { altKey: true });
  clickRow(file.d.path, { altKey: true });
  const dt = new DataTransfer();
  const dragEl = title(file.c.path);
  dragEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const payload = JSON.parse(dt.getData('text/plain'));
  check(payload.path === file.c.path && payload.type === 'files', '拖动载荷保留 path 单项字段，多选 type=files（原版 dragFiles）');
  check(Array.isArray(payload.items) && payload.items.length === 2
    && payload.items.some((it) => it.path === file.c.path) && payload.items.some((it) => it.path === file.d.path),
    '拖动载荷 items 包含全部选中项');
  check(!!document.querySelector('body > .drag-ghost'), '多选拖动显示 drag-ghost');

  // 15. 拖动多选 → 移入文件夹（原版 f$）
  const folderEl = title(sub.path);
  folderEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  folderEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await until(() => !!app.vault.getFileByPath(`${dir}/sub/c.md`) && !!app.vault.getFileByPath(`${dir}/sub/d.md`), '拖动多选把整个选择集移入文件夹');
  dragEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  check(view._draggingItems === null, 'dragend 清理多选拖动载荷');

  // 15b. 单选拖动仍写单项载荷（编辑器插入链接路径不回归）
  resetSelection();
  clickRow(file.b.path, { altKey: true });
  const singleDt = new DataTransfer();
  const singleEl = title(file.b.path);
  singleEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: singleDt }));
  const single = JSON.parse(singleDt.getData('text/plain'));
  check(single.path === file.b.path && single.type === 'file' && single.items === undefined, '单选拖动保持单项 path/type 载荷');
  singleEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: singleDt }));

  // 16. 右键菜单作用于选择集：新建文件夹含选中项 + 移动到… + 删除（原版 onFileContextMenu 多选分支）
  const f1 = await app.vault.create(`${dir}/f1.md`, '# f1\n');
  const f2 = await app.vault.create(`${dir}/f2.md`, '# f2\n');
  await pause(80);
  resetSelection();
  clickRow(f1.path, { altKey: true });
  clickRow(f2.path, { altKey: true });
  // Menu 的 document 监听在 setTimeout(0) 后才挂上，打开后等一拍再交互
  const menuOf = async (path) => {
    title(path).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 160, clientY: 200 }));
    await pause(80);
    return document.querySelector('.menu');
  };
  let menu = await menuOf(f1.path);
  check(!!menu, '多选右键打开菜单');
  let menuItems = [...menu.querySelectorAll('.menu-item')];
  check(menuItems.length === 3, `多选菜单仅三项（新建文件夹含选中项 / 移动到… / 删除），实际 ${menuItems.length}`);
  check(menuItems[0].textContent.includes('2'), '新建文件夹项显示选中数量');
  check(menuItems.some((el) => el.classList.contains('is-warning')), '多选菜单含警告色删除项');
  menuItems.find((el) => el.classList.contains('is-warning')).click();
  await confirmDialogs(2, '菜单删除');
  await until(() => !app.vault.getFileByPath(f1.path) && !app.vault.getFileByPath(f2.path), '多选菜单删除项数量与选择集一致（2 项）');

  // 17. 新建文件夹含选中项（action-primary）
  const g1 = await app.vault.create(`${dir}/g1.md`, '# g1\n');
  const g2 = await app.vault.create(`${dir}/g2.md`, '# g2\n');
  await pause(80);
  resetSelection();
  clickRow(g1.path, { altKey: true });
  clickRow(g2.path, { altKey: true });
  menu = await menuOf(g1.path);
  check(!!menu, '二次右键打开菜单');
  menu.querySelectorAll('.menu-item')[0].click();
  await until(() => app.vault.getRoot().children.some((child) => child.children
    && !!app.vault.getFileByPath(child.path + '/g1.md') && !!app.vault.getFileByPath(child.path + '/g2.md')),
    '新建文件夹含选中项把两项移入新文件夹');
  await pause(120);
  check(view._selection.size === 0, '新建文件夹后清空选择集');
  const renameInput = view.treeEl.querySelector('.nav-rename-input');
  if (renameInput) renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  // 18. 单选右键菜单不回归（多选分支只在选择集命中时生效）
  await pause(80);
  resetSelection();
  menu = await menuOf(file.a.path);
  check(!!menu, '单选右键打开菜单');
  menuItems = [...menu.querySelectorAll('.menu-item')];
  check(menuItems.length >= 7, `单选菜单保留原有项（≥7），实际 ${menuItems.length}`);
  check(menuItems.some((el) => !!el.querySelector('svg.lucide-trash-2')), '单选菜单仍含删除项');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await pause(80);
  check(!document.querySelector('.menu'), 'Escape 关闭菜单');

  // 19. 单击文件夹仍折叠 / 展开
  clickRow(sub.path);
  check(view._collapsed.has(sub.path), '单击文件夹仍折叠');
  clickRow(sub.path);
  check(!view._collapsed.has(sub.path), '再次单击文件夹仍展开');

  return { pass: true, checks, count: checks.length, fixture: dir };
})()
