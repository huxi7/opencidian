/**
 * [INPUT]: OBS_ACT eval；主代理统一 build 后启动 Electron，使用临时测试库。
 * [OUTPUT]: 返回 {role, pass, count, checks, fixture}；失败抛出具名断言。
 * [POS]: 表格交互验收：手柄拖拽重排（真实 PointerEvent + .table-drag-target 落点线 + Esc 取消）、单元格矩形选区与选区菜单
 *        （剪贴板三项/对齐/清空/删除）、Tab 换格（末格加行、首格上方插行）、单元格原位编辑（blur 提交/Enter 下移/Esc 取消/IME 挂起）。
 *        菜单标题同时接受中英文案。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const root = fs.realpathSync(app.vault.adapter.getBasePath());
  const tempRoots = ['/tmp', os.tmpdir()].filter((p) => fs.existsSync(p)).map((p) => fs.realpathSync(p));
  if (!tempRoots.some((p) => root.startsWith(p + path.sep)) || !/(?:obs-copy|vault-main|vault-test)/.test(root)) {
    throw new Error('table-interaction acceptance requires a temporary vault');
  }

  // 菜单标题：locale-zh / locale-en 成对，避免验收绑死界面语言。
  const T = {
    cut: ['剪切', 'Cut'],
    copy: ['复制', 'Copy'],
    paste: ['粘贴', 'Paste'],
    alignLeft: ['左对齐', 'Align left'],
    alignCenter: ['居中对齐', 'Align center'],
    alignRight: ['右对齐', 'Align right'],
    clear: ['清空选中的单元格', 'Clear cells'],
    delete: ['删除选中的单元格', 'Delete cells'],
  };

  const checks = [];
  const errors = [];
  window.addEventListener('error', (event) => errors.push(String(event.message)));
  const check = (value, label) => { if (!value) throw new Error('table-interaction: ' + label); checks.push(label); };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 7000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error('table-interaction timeout: ' + label);
      await delay(30);
    }
  };
  const settings = app.settings.appSettings;
  const saved = { livePreview: settings.livePreview };
  const previousLeaf = app.workspace.activeLeaf;
  const leaves = [];
  const fixture = 'acceptance/table-interaction-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  const interactionText = [
    '# 交互',
    '',
    '| A | B | C |',
    '| --- | --- | --- |',
    '| a1 | b1 | c1 |',
    '| a2 | b2 | c2 |',
    '| a3 | b3 | c3 |',
    '',
    'tail',
    '',
  ].join('\n');
  const tabText = [
    '# 换格',
    '',
    '| A | B |',
    '| --- | --- |',
    '| a1 | b1 |',
    '| a2 | b2 |',
    '',
    'tail',
    '',
  ].join('\n');

  try {
    app.settings.updateAppSettings({ livePreview: true });
    await delay(80);
    if (!app.vault.getAbstractFileByPath('acceptance')) await app.vault.createFolder('acceptance');
    await app.vault.createFolder(fixture);

    const note = await app.vault.create(fixture + '/interaction.md', interactionText);
    const leaf = app.workspace.getLeaf('tab');
    leaves.push(leaf);
    await leaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'live' } });
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
    const cellOf = (row, col) => widget().querySelectorAll('tr')[row].cells[col];
    const rowHandle = (row) => cellOf(row, 0).querySelector('.table-row-drag-handle');
    const colHandle = (col) => cellOf(0, col).querySelector('.table-col-drag-handle');
    const editorEl = () => widget() && widget().querySelector('.table-cell-editor');
    const editorPos = () => {
      const el = editorEl();
      if (!el) return null;
      const cell = el.closest('td, th');
      const rowEl = cell.parentElement;
      const table = rowEl.closest('table');
      return Array.prototype.indexOf.call(table.rows, rowEl) + ',' + cell.cellIndex;
    };
    const centerOf = (el) => {
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    };
    const selectedCells = () => Array.from(widget().querySelectorAll('tr')).flatMap((rowEl, row) => (
      Array.from(rowEl.cells).flatMap((cell, col) => (cell.hasClass('is-selected') ? [row + ',' + col] : []))
    )).join(' ');

    const pointerEvent = (type, target, point, options) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: Math.round(point.x), clientY: Math.round(point.y),
      ...(options || {}),
    }));
    const pressCell = (row, col) => {
      const point = centerOf(cellOf(row, col));
      pointerEvent('pointerdown', cellOf(row, col), point);
      pointerEvent('pointerup', window, point);
    };
    const dragCells = (fromRow, fromCol, toRow, toCol) => {
      pointerEvent('pointerdown', cellOf(fromRow, fromCol), centerOf(cellOf(fromRow, fromCol)));
      pointerEvent('pointermove', window, centerOf(cellOf(toRow, toCol)));
      pointerEvent('pointerup', window, centerOf(cellOf(toRow, toCol)));
    };
    const keyOn = (target, key, shift) => target.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key, shiftKey: !!shift,
    }));
    const reset = async (text) => {
      view.editor.setValue(text);
      view.editor.setSelection(0);
      await wait(() => widget() && widget().querySelector('.table-wrapper'), '表格重渲染');
      await delay(40);
    };

    const closeMenus = async () => {
      if (!document.querySelector('.menu')) return;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(50);
    };
    const openSelectionMenu = async (row, col) => {
      const point = centerOf(cellOf(row, col));
      cellOf(row, col).dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX: point.x, clientY: point.y,
      }));
      await wait(() => document.querySelector('.menu'), '选区菜单打开');
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
      await delay(150);
      check(!document.querySelector('.menu'), '点击「' + names[0] + '」后菜单关闭');
    };
    /** 打开 (row,col) 的原位编辑器：按下相邻的上一格（Tab 的作用起点）再按 Tab。 */
    const openEditor = async (row, col) => {
      const previous = col > 0 ? { row, col: col - 1 } : { row: row - 1, col: columnCount() - 1 };
      pressCell(previous.row, previous.col);
      keyOn(widget(), 'Tab');
      await delay(60);
      return editorEl();
    };

    // ---- 结构 ----
    check(!!widget(), '表格块渲染为 .cm-table-widget');
    check(tableRows().length === 5 && columnCount() === 3, 'fixture 为 3 列 × 3 行表体');
    check(widget().tabIndex === -1, '部件容器可编程聚焦（tabindex=-1）');

    // ---- 行手柄拖拽：第 1、2 行交换 ----
    await reset(interactionText);
    const rowStart = centerOf(rowHandle(1));
    const rowHeight = cellOf(1, 0).getBoundingClientRect().height;
    pointerEvent('pointerdown', rowHandle(1), rowStart);
    check(widget().hasClass('is-dragging'), '按下行手柄进入 is-dragging');
    check(selectedCells() === '1,0 1,1 1,2', '按下行手柄整行进入选中：' + selectedCells());
    check(!editorEl(), '拖拽起点不进入原位编辑');
    const rowTarget = { x: rowStart.x, y: rowStart.y + rowHeight + 4 };
    pointerEvent('pointermove', window, rowTarget);
    await delay(60);
    const rowMarker = widget().querySelector('.table-drag-target.mod-row');
    check(!!rowMarker, '行拖拽中出现 .table-drag-target.mod-row');
    check(rowMarker.style.display !== 'none', '落点线指向非源行时可见');
    pointerEvent('pointerup', window, rowTarget);
    await delay(80);
    check(bodyRows().map((row) => row[0]).join(',') === 'a2,a1,a3', '行拖拽把第 1、2 行交换：' + bodyRows().map((row) => row[0]).join(','));
    check(!widget().querySelector('.table-drag-target'), '松手后落点指示线移除');
    check(!widget().hasClass('is-dragging'), '松手后退出 is-dragging');
    check(selectedCells() === '2,0 2,1 2,2', '落点后选中移动后的行：' + selectedCells());

    // ---- 列手柄拖拽：第 1、2 列交换 ----
    await reset(interactionText);
    const colStart = centerOf(colHandle(1));
    const colWidth = cellOf(0, 1).getBoundingClientRect().width;
    pointerEvent('pointerdown', colHandle(1), colStart);
    check(widget().hasClass('is-dragging'), '按下列手柄进入 is-dragging');
    const colTarget = { x: colStart.x + colWidth + 4, y: colStart.y };
    pointerEvent('pointermove', window, colTarget);
    await delay(60);
    check(!!widget().querySelector('.table-drag-target.mod-col'), '列拖拽中出现 .table-drag-target.mod-col');
    pointerEvent('pointerup', window, colTarget);
    await delay(80);
    check(tableRows()[0].join(',') === 'A,C,B', '列拖拽把第 1、2 列交换：' + tableRows()[0].join(','));
    check(bodyRows().map((row) => row.join(',')).join(';') === 'a1,c1,b1;a2,c2,b2;a3,c3,b3',
      '列拖拽同步重排每行：' + bodyRows().map((row) => row.join(',')).join(';'));

    // ---- Esc 取消拖拽 ----
    await reset(interactionText);
    const cancelStart = centerOf(rowHandle(1));
    pointerEvent('pointerdown', rowHandle(1), cancelStart);
    pointerEvent('pointermove', window, { x: cancelStart.x, y: cancelStart.y + rowHeight + 4 });
    await delay(60);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await delay(60);
    check(!widget().hasClass('is-dragging') && !widget().querySelector('.table-drag-target'), 'Esc 取消清理拖拽状态');
    check(view.editor.getValue() === interactionText, 'Esc 取消不改动 Markdown');

    // ---- 矩形选区 ----
    await reset(interactionText);
    pointerEvent('pointerdown', cellOf(1, 0), centerOf(cellOf(1, 0)));
    pointerEvent('pointermove', window, centerOf(cellOf(2, 1)));
    await delay(40);
    check(widget().hasClass('mod-selecting'), '框选拖动期间容器带 mod-selecting');
    pointerEvent('pointerup', window, centerOf(cellOf(2, 1)));
    await delay(60);
    check(selectedCells() === '1,0 1,1 2,0 2,1', '拖过 2×2 区域形成矩形选区：' + selectedCells());
    check(widget().hasClass('has-selection'), '选区存在时容器带 has-selection');
    check(cellOf(1, 0).hasClass('top') && cellOf(1, 0).hasClass('start'), '左上角格子带 top/start');
    check(cellOf(2, 1).hasClass('bottom') && cellOf(2, 1).hasClass('end'), '右下角格子带 bottom/end');
    pointerEvent('pointerdown', cellOf(0, 2), centerOf(cellOf(0, 2)));
    pointerEvent('pointerup', window, centerOf(cellOf(0, 2)));
    await delay(40);
    check(!widget().hasClass('has-selection') && selectedCells() === '', '按下选区外的单元格清空选择');

    // ---- 选区菜单：剪贴板 / 对齐 / 清空 / 删除 ----
    await reset(interactionText);
    dragCells(1, 0, 2, 1);
    await delay(40);
    const selectionMenu = await openSelectionMenu(1, 0);
    requireMenu(...T.cut);
    requireMenu(...T.copy);
    requireMenu(...T.paste);
    requireMenu(...T.alignLeft);
    requireMenu(...T.alignCenter);
    requireMenu(...T.alignRight);
    requireMenu(...T.clear);
    requireMenu(...T.delete);
    check(selectionMenu.querySelectorAll('.menu-separator').length === 2, '选区菜单按 clipboard/对齐/表格 三段分隔');

    // 复制 2×2 → 粘贴到 (2,2) 起的选区：缺列补列
    await clickMenuItem(T.copy);
    dragCells(2, 2, 3, 2);
    await delay(40);
    await openSelectionMenu(2, 2);
    await clickMenuItem(T.paste);
    check(columnCount() === 4, '粘贴越过表右侧时补列：' + columnCount());
    check(tableRows()[0].join(',') === 'A,B,C,', '补列后表头多一个空列：' + tableRows()[0].join(','));
    check(bodyRows()[1].join(',') === 'a2,b2,a1,b1', '粘贴写入目标起点：' + bodyRows()[1].join(','));
    check(bodyRows()[2].join(',') === 'a3,b3,a2,b2', '粘贴第二行落在下一行：' + bodyRows()[2].join(','));

    // 剪切 1 列 × 2 行的矩形 → 清空这些单元格
    await reset(interactionText);
    dragCells(1, 0, 2, 0);
    await delay(40);
    await openSelectionMenu(1, 0);
    await clickMenuItem(T.cut);
    check(bodyRows()[0][0] === '' && bodyRows()[1][0] === '', '剪切清空选中单元格：' + bodyRows().map((row) => row[0]).join('|'));
    check(bodyRows()[0][1] === 'b1' && bodyRows()[2][0] === 'a3', '剪切不动选区外单元格');

    // 清空选中：矩形 2×2 → 4 格为空，选区保留
    await reset(interactionText);
    dragCells(1, 0, 2, 1);
    await delay(40);
    await openSelectionMenu(1, 0);
    await clickMenuItem(T.clear);
    check(bodyRows()[0].join(',') === ',,c1' && bodyRows()[1].join(',') === ',,c2',
      '清空选中后 4 格为空：' + bodyRows()[0].join(',') + ' / ' + bodyRows()[1].join(','));
    check(bodyRows()[2].join(',') === 'a3,b3,c3', '清空选中不动第三行');
    check(widget().hasClass('has-selection') && selectedCells() === '1,0 1,1 2,0 2,1', '清空后选区保留');

    // 对齐应用到选区覆盖的列
    await reset(interactionText);
    dragCells(1, 0, 2, 1);
    await delay(40);
    await openSelectionMenu(1, 0);
    await clickMenuItem(T.alignCenter);
    const alignedDelimiter = tableRows()[1];
    check(/^:--+:$/.test(alignedDelimiter[0]) && /^:--+:$/.test(alignedDelimiter[1]),
      '居中对齐应用到选中的两列：' + alignedDelimiter.join(','));
    check(!alignedDelimiter[2].startsWith(':') && !alignedDelimiter[2].endsWith(':'), '选中的列之外对齐不变：' + alignedDelimiter[2]);

    // 删除选中（矩形 = 清空单元格）；整列选中 = 删除整列
    await reset(interactionText);
    dragCells(1, 1, 2, 1);
    await delay(40);
    await openSelectionMenu(1, 1);
    await clickMenuItem(T.delete);
    check(bodyRows().length === 3 && bodyRows()[0].join(',') === 'a1,,c1' && bodyRows()[1].join(',') === 'a2,,c2',
      '删除单元格矩形清空内容：' + bodyRows().map((row) => row.join('')).join(' / '));
    await reset(interactionText);
    dragCells(0, 1, 3, 1);
    await delay(40);
    check(selectedCells() === '0,1 1,1 2,1 3,1', '整列拖拽选中该列：' + selectedCells());
    await openSelectionMenu(0, 1);
    await clickMenuItem(T.delete);
    check(columnCount() === 2, '整列删除后列数 -1：' + columnCount());
    check(tableRows()[0].join(',') === 'A,C' && bodyRows()[1].join(',') === 'a2,c2',
      '整列删除移除该列的每行数据：' + tableRows()[0].join(','));

    // 选中全部行（整个表宽）= 删除这些行；选中全表 = 删除整块
    await reset(interactionText);
    dragCells(1, 0, 2, 2);
    await delay(40);
    await openSelectionMenu(1, 0);
    await clickMenuItem(T.delete);
    check(bodyRows().length === 1 && bodyRows()[0].join(',') === 'a3,b3,c3',
      '选中整个表宽时删除这些行：' + bodyRows().map((row) => row.join(',')).join(' / '));
    await reset(interactionText);
    dragCells(0, 0, 3, 2);
    await delay(40);
    check(selectedCells() === '0,0 0,1 0,2 1,0 1,1 1,2 2,0 2,1 2,2 3,0 3,1 3,2',
      '整表拖拽选中全部单元格：' + selectedCells());
    await openSelectionMenu(0, 0);
    await clickMenuItem(T.delete);
    check(!widget() && !view.editor.getValue().includes('| A |'), '选中全表时删除整块表格');
    check(view.editor.getValue().includes('tail'), '整表删除保留表格外的文本');

    // ---- Tab 换格（2 列表格）----
    // 不切文件：MarkdownView 切文件时自家 save 的 modify 回声有竞态（见报告），验收只关心表格部件。
    await reset(tabText);

    pressCell(1, 1);
    keyOn(widget(), 'Enter');
    await delay(60);
    check(editorPos() === '2,1' && editorEl().value === 'b2', 'Enter 打开下方同列单元格：' + editorPos());
    keyOn(editorEl(), 'Escape');
    await delay(40);
    pressCell(2, 0);
    keyOn(widget(), 'Enter');
    await delay(80);
    check(editorPos() === '3,0' && tableRows().length === 5, '末行 Enter 追加一行：' + editorPos() + '/' + tableRows().length);
    keyOn(editorEl(), 'Escape');
    await delay(40);
    await reset(tabText);

    pressCell(0, 0);
    check(document.activeElement === widget(), '单元格上按下后表格容器获得键盘焦点');
    keyOn(widget(), 'Tab');
    await delay(60);
    check(editorPos() === '0,1', 'Tab 从 (0,0) 到 (0,1)：' + editorPos());
    check(editorEl().value === 'B' && editorEl().selectionStart === 0, 'Tab 进入的格子带全文选中');
    keyOn(editorEl(), 'Tab');
    await delay(60);
    check(editorPos() === '1,0', 'Tab 从 (0,1) 到 (1,0)：' + editorPos());
    check(editorEl().value === 'a1', 'Tab 换格取到正确单元格文本：' + editorEl().value);
    keyOn(editorEl(), 'Tab');
    await delay(60);
    check(editorPos() === '1,1', 'Tab 从 (1,0) 到 (1,1)：' + editorPos());
    keyOn(editorEl(), 'Tab');
    await delay(60);
    check(editorPos() === '2,0', 'Tab 从行末到下一行行首：' + editorPos());
    keyOn(editorEl(), 'Tab');
    await delay(60);
    check(editorPos() === '2,1', 'Tab 走到表体最后一格：' + editorPos());
    keyOn(editorEl(), 'Tab');
    await delay(80);
    check(editorPos() === '3,0', '末格 Tab 追加新行并停在该行首格：' + editorPos());
    check(tableRows().length === 5, '末格 Tab 后表格多一行：' + tableRows().length);
    keyOn(editorEl(), 'Escape');
    await delay(40);

    pressCell(0, 0);
    keyOn(widget(), 'Tab', true);
    await delay(80);
    check(tableRows().length === 6, '首格 Shift+Tab 在表头前插行：' + tableRows().length);
    check(editorPos() === '0,1', '首格 Shift+Tab 落在新行末列：' + editorPos());
    check(tableRows()[0].join(',') === ',', '新插入的表头行为空：' + tableRows()[0].join(','));
    keyOn(editorEl(), 'Escape');
    await delay(40);

    // ---- 原位编辑：blur 提交 / Esc 取消 / IME 挂起 / Enter 下移 ----
    await reset(interactionText);
    const editor = await openEditor(1, 0);
    check(!!editor && editor.value === 'a1', 'Tab 打开单元格编辑器并取原文：' + (editor ? editor.value : 'none'));
    editor.value = 'NEW';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new FocusEvent('blur'));
    await delay(80);
    check(!editorEl(), 'blur 提交后编辑器卸载');
    check(bodyRows()[0].join(',') === 'NEW,b1,c1', 'blur 提交写回该单元格：' + bodyRows()[0].join(','));
    check(bodyRows()[1].join(',') === 'a2,b2,c2', '提交不改动其它行');
    check(view.editor.getValue().includes('| NEW'), '写回按 | cell | 形式保留表格结构');

    const cancelEditor = await openEditor(1, 1);
    cancelEditor.value = 'ZZZ';
    cancelEditor.dispatchEvent(new Event('input', { bubbles: true }));
    keyOn(cancelEditor, 'Escape');
    await delay(60);
    check(!editorEl() && !view.editor.getValue().includes('ZZZ'), 'Esc 取消不写回：' + bodyRows()[0].join(','));

    const imeEditor = await openEditor(1, 0);
    imeEditor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    imeEditor.value = '合成X';
    imeEditor.dispatchEvent(new Event('input', { bubbles: true }));
    imeEditor.dispatchEvent(new FocusEvent('blur'));
    await delay(60);
    check(!view.editor.getValue().includes('合成X'), 'IME 合成期间 blur 不提交');
    check(!!editorEl(), 'IME 合成期间编辑器保持挂起');
    imeEditor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await delay(80);
    check(bodyRows()[0][0] === '合成X', '合成结束后提交写回：' + bodyRows()[0][0]);

    const enterEditor = await openEditor(2, 0);
    enterEditor.value = 'ENTER';
    enterEditor.dispatchEvent(new Event('input', { bubbles: true }));
    keyOn(enterEditor, 'Enter');
    await delay(80);
    check(bodyRows()[1][0] === 'ENTER' && editorPos() === '3,0', 'Enter 提交并下移一格：' + editorPos());
    check(tableRows().length === 5, '非末行 Enter 不新增行：' + tableRows().length);
    keyOn(editorEl(), 'Escape');
    await closeMenus();

    check(errors.length === 0, '无未捕获异常');
    return { role: 'table-interaction', pass: true, count: checks.length, checks, fixture };
  } finally {
    app.settings.updateAppSettings(saved);
    for (const leaf of leaves) {
      await leaf.view.save?.();
      leaf.detach();
    }
    if (previousLeaf && app.workspace._leafMap.has(previousLeaf.id)) app.workspace.revealLeaf(previousLeaf);
  }
})()
