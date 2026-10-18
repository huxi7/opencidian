/**
 * [INPUT]: OBS_ACT eval；主代理统一 build 后启动 Electron，使用临时测试库。
 * [OUTPUT]: 返回 {role, pass, count, checks, fixture}；失败抛出具名断言。
 * [POS]: 实时预览表格部件验收：加行/加列按钮、行列拖拽手柄右键菜单、对齐写回、排序与单元格点击进入源码。菜单标题同时接受中英文案。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const root = fs.realpathSync(app.vault.adapter.getBasePath());
  const tempRoots = ['/tmp', os.tmpdir()].filter((p) => fs.existsSync(p)).map((p) => fs.realpathSync(p));
  if (!tempRoots.some((p) => root.startsWith(p + path.sep)) || !/(?:obs-copy|vault-main|vault-test)/.test(root)) {
    throw new Error('table-widget acceptance requires a temporary vault');
  }

  // 菜单标题：locale-zh / locale-en 成对，避免验收绑死界面语言。
  const T = {
    rowBefore: ['在上方新增行', 'Add row above'],
    rowAfter: ['在下方新增行', 'Add row below'],
    rowUp: ['向上移动行', 'Move row up'],
    rowDown: ['向下移动行', 'Move row down'],
    duplicateRow: ['复制行', 'Duplicate row'],
    deleteRow: ['删除行', 'Delete row'],
    colAfter: ['在右侧新增列', 'Add column to the right'],
    alignLeft: ['左对齐', 'Align left'],
    alignCenter: ['居中对齐', 'Align center'],
    alignRight: ['右对齐', 'Align right'],
    duplicateCol: ['复制列', 'Duplicate column'],
    deleteCol: ['删除列', 'Delete column'],
    sortAZ: ['按列升序 (A-Z)', 'Sort by column (A to Z)'],
    sortZA: ['按列降序 (Z-A)', 'Sort by column (Z to A)'],
  };

  const checks = [];
  const errors = [];
  window.addEventListener('error', (event) => errors.push(String(event.message)));
  const check = (value, label) => { if (!value) throw new Error('table-widget: ' + label); checks.push(label); };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 7000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error('table-widget timeout: ' + label);
      await delay(30);
    }
  };
  const settings = app.settings.appSettings;
  const saved = { livePreview: settings.livePreview };
  const previousLeaf = app.workspace.activeLeaf;
  const leaves = [];
  const fixture = 'acceptance/table-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  try {
    app.settings.updateAppSettings({ livePreview: true });
    await delay(80);
    if (!app.vault.getAbstractFileByPath('acceptance')) await app.vault.createFolder('acceptance');
    await app.vault.createFolder(fixture);

    const mechanicsText = [
      '# 表格',
      '',
      '| 名称 | 值 |',
      '| --- | --- |',
      '| b | 2 |',
      '| a | 1 |',
      '',
      'tail',
      '',
    ].join('\n');
    const mechanics = await app.vault.create(fixture + '/mechanics.md', mechanicsText);
    const leaf = app.workspace.getLeaf('tab');
    leaves.push(leaf);
    await leaf.setViewState({ type: 'markdown', state: { file: mechanics.path, mode: 'live' } });
    app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    const cm = view.editor.cm;
    view.editor.setSelection(0);
    await wait(() => cm.dom.querySelector('.cm-table-widget .table-wrapper'), '表格部件渲染');

    const widget = () => cm.dom.querySelector('.cm-table-widget');
    const tableLines = () => view.editor.getValue().split('\n').filter((line) => line.trim().startsWith('|'));
    const tableRows = () => tableLines().map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
    const bodyRows = () => tableRows().slice(2);
    const columnCount = () => (tableRows()[0] || []).length;
    const rowButton = () => widget().querySelector('.table-row-btn');    const colButton = () => widget().querySelector('.table-col-btn');
    const colHandle = (index) => widget().querySelectorAll('thead th')[index].querySelector('.table-col-drag-handle');
    const rowHandle = (index) => widget().querySelectorAll('tbody tr')[index].querySelector('td .table-row-drag-handle');

    const closeMenus = async () => {
      if (!document.querySelector('.menu')) return;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(50);
    };
    const openMenu = async (element, label) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2,
        clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2),
      }));
      await wait(() => document.querySelector('.menu'), label);
      await delay(40);
      return document.querySelector('.menu');
    };
    const menuText = () => {
      const menu = document.querySelector('.menu');
      return menu ? menu.textContent : '';
    };
    const requireMenu = (...names) => check(names.some((name) => menuText().includes(name)), '菜单含「' + names[0] + '」');
    const menuItem = (...names) => {
      const menu = document.querySelector('.menu');
      if (!menu) return null;
      return [...menu.querySelectorAll('.menu-item')].find((el) => {
        const titleEl = el.querySelector('.menu-item-title');
        return titleEl && names.includes(titleEl.textContent.trim());
      }) || null;
    };
    const clickMenuItem = async (names) => {
      const item = menuItem(...names);
      check(!!item, '菜单含「' + names[0] + '」');
      item.click();
      await delay(90);
      check(!document.querySelector('.menu'), '点击「' + names[0] + '」后菜单关闭');
    };

    // ---- 结构：部件、按钮、手柄、中文单元格 ----
    check(!!widget(), '表格块渲染为 .cm-table-widget');
    check(!!widget().querySelector('.table-wrapper > table.table-editor'), 'DOM 为 .table-wrapper > table.table-editor');
    check(!!rowButton() && !!colButton(), '.table-row-btn 与 .table-col-btn 存在');
    check(!!rowButton().querySelector('svg.svg-icon.lucide-plus'), '加行按钮带 lucide-plus 图标');
    check(T.rowAfter.includes(rowButton().getAttribute('aria-label')), '加行按钮 aria-label 为「' + T.rowAfter[0] + '」');
    check(T.colAfter.includes(colButton().getAttribute('aria-label')), '加列按钮 aria-label 为「' + T.colAfter[0] + '」');
    const headerCell = widget().querySelector('thead th');
    check(!!headerCell.querySelector('.table-cell-wrapper'), '表头单元格含 .table-cell-wrapper');
    check(headerCell.textContent.trim() === '名称', '中文表头单元格渲染');
    check(!!headerCell.querySelector('.table-col-drag-handle'), '表头单元格带列拖拽手柄');
    check(!!widget().querySelector('tbody tr td .table-row-drag-handle'), '首列单元格带行拖拽手柄');
    check(!!headerCell.querySelector('.table-col-drag-handle svg.svg-icon.lucide-grip-horizontal'), '列手柄用 grip-horizontal 图标');
    check(!!widget().querySelector('tbody tr td .table-row-drag-handle svg.svg-icon.lucide-grip-vertical'), '行手柄用 grip-vertical 图标');
    check(getComputedStyle(headerCell.querySelector('.table-col-drag-handle')).opacity === '0', '手柄默认隐藏（hover 显形的原版规则）');
    check(tableRows().length === 4 && columnCount() === 2, 'fixture 为 2 列 × 2 行表体');

    // ---- 加行按钮：文本行数 +1、列数不变 ----
    rowButton().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    rowButton().click();
    await delay(80);
    check(tableRows().length === 5, '点击加行按钮后表格行数 +1');
    check(columnCount() === 2, '加行后列数不变');
    check(bodyRows()[2].join(',') === ',', '加行按钮把空行插在表体末尾');
    check(bodyRows()[0].join(',') === 'b,2' && bodyRows()[1].join(',') === 'a,1', '加行不改动既有行');

    // ---- 加列按钮：每行多一个 | 段 ----
    colButton().click();
    await delay(80);
    check(tableRows().length === 5, '加列后行数不变');
    check(columnCount() === 3, '加列后列数 +1');
    check(tableLines().every((line) => (line.match(/\|/g) || []).length === 4), '加列后每行多一个 | 段');
    check(tableRows()[0].join(',') === '名称,值,', '加列把空列插在最右侧');
    check(bodyRows()[0].join(',') === 'b,2,', '加列不改动既有单元格');

    // ---- 行菜单：新增 / 移动 / 复制 / 删除 ----
    await closeMenus();
    const rowMenu = await openMenu(rowHandle(1), '行手柄右键打开菜单');
    requireMenu(...T.rowAfter);
    requireMenu(...T.deleteRow);
    requireMenu(...T.rowBefore);
    requireMenu(...T.duplicateRow);
    requireMenu(...T.rowUp);
    requireMenu(...T.rowDown);
    check(rowMenu.querySelectorAll('.menu-separator').length >= 2, '行菜单按组插入分隔线');
    await clickMenuItem(T.deleteRow);
    check(bodyRows().length === 2, '删除行后表体行数回落');
    check(!bodyRows().some((row) => row[0] === 'a'), '删除行移除了对应行');

    await openMenu(rowHandle(0), '行手柄右键打开菜单');
    await clickMenuItem(T.rowDown);
    const afterDown = bodyRows().map((row) => row.join('/')).join(' ; ');
    check(bodyRows()[0][0] === '' && bodyRows()[1][0] === 'b', '「向下移动行」改写行序：' + afterDown);
    await openMenu(rowHandle(1), '行手柄右键打开菜单');
    await clickMenuItem(T.duplicateRow);
    const afterDuplicate = bodyRows().map((row) => row.join('/')).join(' ; ');
    check(bodyRows().length === 3 && bodyRows().filter((row) => row[0] === 'b').length === 2,
      '「复制行」产生重复行：' + afterDuplicate);

    // ---- 对齐与排序：换一条干净的笔记 ----
    const alignedText = [
      '# 排序',
      '',
      '| 名称 | 值 |',
      '| --- | --- |',
      '| b | 3 |',
      '| c | 1 |',
      '| a | 2 |',
      '',
      'tail',
      '',
    ].join('\n');
    const aligned = await app.vault.create(fixture + '/aligned.md', alignedText);
    await view.setState({ file: aligned.path, mode: 'live' });
    view.editor.setSelection(0);
    await wait(() => cm.dom.querySelector('.cm-table-widget .table-wrapper'), '第二条表格部件渲染');
    await delay(60);

    await closeMenus();
    await openMenu(colHandle(0), '列手柄右键打开菜单');
    requireMenu(...T.colAfter);
    requireMenu(...T.deleteCol);
    requireMenu(...T.alignLeft);
    requireMenu(...T.alignCenter);
    requireMenu(...T.alignRight);
    await clickMenuItem(T.alignCenter);
    const delimiter = tableRows()[1];
    check(/^:--+:$/.test(delimiter[0]), '「居中对齐」写回 :---: 分隔段：' + delimiter[0]);
    await openMenu(colHandle(1), '列手柄右键打开菜单');
    await clickMenuItem(T.alignRight);
    check(tableRows()[1][1].endsWith(':') && !tableRows()[1][1].startsWith(':'), '「右对齐」写回 --: 分隔段：' + tableRows()[1][1]);
    await openMenu(colHandle(1), '列手柄右键打开菜单');
    await clickMenuItem(T.alignLeft);
    check(tableRows()[1][1].startsWith(':') && !tableRows()[1][1].endsWith(':'), '「左对齐」写回 :-- 分隔段：' + tableRows()[1][1]);

    await openMenu(colHandle(0), '列手柄右键打开菜单');
    requireMenu(...T.sortAZ);
    await clickMenuItem(T.sortAZ);
    check(bodyRows().map((row) => row[0]).join(',') === 'a,b,c', '排序 A→Z 生效：' + bodyRows().map((row) => row[0]).join(','));
    await openMenu(colHandle(0), '列手柄右键打开菜单');
    await clickMenuItem(T.sortZA);
    check(bodyRows().map((row) => row[0]).join(',') === 'c,b,a', '排序 Z→A 生效：' + bodyRows().map((row) => row[0]).join(','));

    await openMenu(colHandle(0), '列手柄右键打开菜单');
    await clickMenuItem(T.duplicateCol);
    check(columnCount() === 3, '「复制列」列数 +1');
    check(bodyRows().every((row) => row[0] === row[1]), '「复制列」复制原列内容');
    await openMenu(colHandle(1), '列手柄右键打开菜单');
    await clickMenuItem(T.deleteCol);
    check(columnCount() === 2, '「删除列」列数回落');
    check(tableRows()[0].join(',') === '名称,值', '「删除列」移除被点击的列');

    // ---- 菜单 Esc 关闭 ----
    await openMenu(colHandle(0), '列手柄右键打开菜单');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await delay(60);
    check(!document.querySelector('.menu'), 'Escape 关闭表格菜单');

    // ---- 点击单元格进入源码 ----
    const cell = widget().querySelector('tbody tr td .table-cell-wrapper');
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await delay(80);
    check(!widget(), '点击单元格后部件让位给原始 Markdown');
    const rawNeedle = tableLines()[0].replace(/\s+/g, '');
    check(cm.contentDOM.textContent.replace(/\s+/g, '').includes(rawNeedle), '源码行可见：' + rawNeedle);
    check(view.editor.getValue().split('\n').length === alignedText.split('\n').length, '行列编辑不改变文档行数');
    check(view.editor.getValue().includes('# 排序') && view.editor.getValue().includes('tail'), '表格外的文本未受影响');
    view.editor.setSelection(0);
    await delay(60);
    check(!!widget(), '光标离开表格后部件恢复渲染');

    check(errors.length === 0, '无未捕获异常');
    return { role: 'table-widget', pass: true, count: checks.length, checks, fixture };
  } finally {
    app.settings.updateAppSettings(saved);
    for (const leaf of leaves) {
      await leaf.view.save?.();
      leaf.detach();
    }
    if (previousLeaf && app.workspace._leafMap.has(previousLeaf.id)) app.workspace.revealLeaf(previousLeaf);
  }
})()
