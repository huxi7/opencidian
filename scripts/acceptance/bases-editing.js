/**
 * [INPUT]: 隔离 Electron 临时库、真实表格编辑事件与看板拖放。
 * [OUTPUT]: 返回 {pass,count,checks}；证明最新文件写回、单元格与分组编辑真实落盘。
 * [POS]: Bases 编辑端到端验收。只由持锁且 --no-screenshot 的运行器执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message) => { for (let i = 0; i < 160; i++) { if (fn()) return; await wait(30); } throw Error(message); };
  const yaml = require('js-yaml');
  const baselineTypeListeners = app.workspace._events['properties-type-change']?.length || 0;
  await app.plugins.enableInternalPlugin('bases');
  await app.vault.createFolder('Edit'); await app.vault.createFolder('EditNext');
  const alpha = await app.vault.create('Edit/Alpha.md', '---\nStatus: open\nscore: 2\ndone: false\ndue: 2024-02-28\nlink: "[[Alpha]]"\nitems: [a, b]\n---\n# Keep Alpha\n');
  const beta = await app.vault.create('Edit/Beta.md', '---\nStatus: done\nscore: 8\ndone: true\ndue: 2024-02-29\nlink: "[[Beta]]"\nitems: [c, d]\n---\n# Keep Beta\n\nParagraph ^existing\n');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.score === 2 && app.metadataCache.getFileCache(beta)?.frontmatter?.score === 8, '等待编辑属性索引');
  const data = { future: { keep: 'unchanged' }, filters: 'file.inFolder("Edit") || file.inFolder("EditNext")', formulas: { calc: 'score * 2' }, views: [
    { name: 'Main', type: 'table', order: ['file.name', 'note.Status', 'note.score', 'note.done', 'note.due', 'note.link', 'note.items', 'formula.calc'], future: { intact: true } },
    { name: 'Other', type: 'list', order: ['file.name'] },
    { name: 'Board', type: 'kanban', order: ['file.name'], groupBy: { property: 'note.Status', direction: 'ASC' } },
  ] };
  const file = await app.vault.create('Editing.base', '# Keep database comment\n' + yaml.dump(data));
  const leaf = await app.workspace.openFile(file), c = leaf.view.controller, root = leaf.view.contentEl;
  check(c.result.rows.length === 2, '表格真实查询两篇笔记');
  const cell = property => root.querySelector('.bases-tbody .bases-tr[data-path="' + alpha.path + '"] .bases-td[data-property="' + property + '"]');
  check(cell('note.score')?.dataset.editable === 'true', '笔记属性提供可用编辑入口');
  check(cell('formula.calc')?.dataset.readonly === 'true', '公式单元格保持只读');
  check(!cell('formula.calc').querySelector('input'), '只读公式不显示假编辑器');
  async function edit(property, value, event = 'dblclick') {
    const target = cell(property);
    target.dispatchEvent(event === 'keydown' ? new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) : new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const input = target.querySelector('.bases-cell-editor');
    check(!!input, property + ' 能打开真实编辑器');
    input.value = value; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await c.queue;
  }
  const front = async note => yaml.load((await app.vault.read(note)).split('---')[1]);
  await edit('note.score', '0', 'keydown');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.score === 0, '等待数字编辑索引');
  check((await front(alpha)).score === 0, 'Enter 编辑数字零真实落盘');
  await c.refresh(); await edit('note.Status', 'waiting');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.Status === 'waiting', '等待大小写编辑');
  check((await front(alpha)).Status === 'waiting' && !Object.hasOwn(await front(alpha), 'status'), '文本编辑保留属性原大小写');
  await c.refresh(); const checkbox = cell('note.done').querySelector('input[type="checkbox"]'); checkbox.click(); await c.queue;
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.done === true, '等待复选值索引');
  check((await front(alpha)).done === true, '复选框点击保留布尔类型');
  await c.refresh();
  const untouchedDate = await app.vault.read(alpha), dateCell = cell('note.due'); dateCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const dateEditor = dateCell.querySelector('input');
  check(dateEditor.value === '2024-02-28', 'YAML Date 日期编辑器显示正确原值');
  dateEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check((await app.vault.read(alpha)) === untouchedDate, '未改动日期不写回，保留原始 Date 类型与 CSV 展示语义');
  await edit('note.due', '2024-03-01');
  await until(() => String(app.metadataCache.getFileCache(alpha)?.frontmatter?.due).startsWith('2024-03-01'), '等待日期编辑');
  check(String((await front(alpha)).due).startsWith('2024-03-01'), '日期编辑按 ISO 日期写入');
  await c.refresh(); await edit('note.link', '[[Alpha|Shown]]');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.link === '[[Alpha|Shown]]', '等待链接编辑');
  check((await front(alpha)).link === '[[Alpha|Shown]]', '链接编辑保留目标与显示文字');
  await c.refresh(); await edit('note.items', '["one,two", "[[Beta]]"]');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.items?.[0] === 'one,two', '等待列表编辑');
  check(JSON.stringify((await front(alpha)).items) === '["one,two","[[Beta]]"]', '列表编辑支持带逗号项和内部链接');
  check((await app.vault.read(alpha)).includes('# Keep Alpha'), '所有单元格编辑保留正文');
  await c.refresh();
  const cancelCell = cell('note.score'); cancelCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  cancelCell.querySelector('input').value = '999'; cancelCell.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!cancelCell.querySelector('.bases-cell-editor') && (await front(alpha)).score === 0, 'Escape 取消单元格编辑不落盘');
  const staleCell = cell('note.score'); staleCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const staleInput = staleCell.querySelector('input');
  await app.fileManager.processFrontMatter(alpha, fm => { fm.score = 11; });
  staleInput.value = '12'; staleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check((await front(alpha)).score === 11, '过时单元格拒绝覆盖外部属性更新');
  check(staleCell.querySelector('.bases-cell-error')?.textContent.includes('属性已变化'), '过时编辑向用户显示拒绝原因');
  await c.refresh();
  staleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await c.refresh();
  const retryCell = cell('note.score'); retryCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const retryInput = retryCell.querySelector('input'), beforeRetry = await app.vault.read(alpha), originalProcess = app.fileManager.processFrontMatter;
  app.fileManager.processFrontMatter = async () => { throw Error('injected cell save failure'); };
  try { retryInput.value = '15'; retryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue; }
  finally { app.fileManager.processFrontMatter = originalProcess; }
  check((await app.vault.read(alpha)) === beforeRetry && !retryInput.disabled, '单元格写入失败保持磁盘原文并恢复输入');
  check(retryCell.querySelector('.bases-cell-error').textContent.includes('injected cell save failure'), '单元格真实写入异常可见');
  retryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check((await front(alpha)).score === 15, '失败后原编辑器再次保存能成功');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.score === 15, '等待失败恢复索引');
  await c.refresh();
  function begin(property) { const target = cell(property); target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return target.querySelector('.bases-cell-editor'); }
  let suggestionInput = begin('note.Status'); suggestionInput.value = 'do'; suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(document.querySelector('.bases-cell-suggestions[data-property-key="status"] .suggestion-item')?.dataset.value === 'done', '文本候选来自真实库属性且忽略键大小写');
  check(suggestionInput.getAttribute('role') === 'combobox' && suggestionInput.getAttribute('aria-expanded') === 'true', '候选提供 combobox 和 listbox 可访问语义');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); await c.queue;
  check((await front(alpha)).Status === 'done' && !document.querySelector('.bases-cell-suggestions'), 'Tab 选中候选真实落盘并释放浮层');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.Status === 'done', '等待文本候选保存'); await c.refresh();
  suggestionInput = begin('note.link'); suggestionInput.value = '[[Be'; suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(document.querySelector('.bases-cell-suggestions .suggestion-item')?.dataset.value === '[[Edit/Beta]]', '内部链接候选来自真实文件路径');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  check(document.querySelector('.bases-cell-suggestions .suggestion-item').getAttribute('aria-selected') === 'true', '方向键选择实际候选且更新 aria-selected');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check((await front(alpha)).link === '[[Edit/Beta]]', 'Enter 选择链接候选并真实保存');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.link === '[[Edit/Beta]]', '等待链接候选保存'); await c.refresh();
  suggestionInput = begin('note.link'); suggestionInput.value = '[[Beta#Keep'; suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(document.querySelector('.bases-cell-suggestions .suggestion-item')?.dataset.value === '[[Edit/Beta#Keep Beta]]', '标题候选读取目标笔记的真实标题');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check((await front(alpha)).link === '[[Edit/Beta#Keep Beta]]', '标题候选保存包含真实标题的内部链接');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.link === '[[Edit/Beta#Keep Beta]]', '等待标题候选保存'); await c.refresh();
  suggestionInput = begin('note.link'); suggestionInput.value = '[[Beta#^ex'; suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(document.querySelector('.bases-cell-suggestions .suggestion-item')?.dataset.value === '[[Edit/Beta#^existing]]', '块候选只来自目标笔记已存在的块ID');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check((await front(alpha)).link === '[[Edit/Beta#^existing]]', '块候选保存真实块链接而不修改目标笔记');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.link === '[[Edit/Beta#^existing]]', '等待块候选保存'); await c.refresh();
  suggestionInput = begin('note.items'); suggestionInput.value = '["one,two"]'; suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
  const candidate = [...document.querySelectorAll('.bases-cell-suggestions .suggestion-item')].find(item => item.dataset.value === 'c');
  check(!!candidate, '列表候选展示其它笔记同名属性中的真实项');
  candidate.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); await c.queue;
  check(JSON.stringify((await front(alpha)).items) === '["one,two","c"]', '指针选择候选追加真实列表且保留已有项');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.items?.[1] === 'c', '等待列表候选保存'); await c.refresh();
  suggestionInput = begin('note.Status'); suggestionInput.value = ''; suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  check(!!document.querySelector('.bases-cell-suggestions .is-selected'), '空输入方向键可以导航候选');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check(!document.querySelector('.bases-cell-suggestions') && suggestionInput.isConnected, '第一次 Escape 仅关闭候选而保留编辑器');
  suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check(!root.querySelector('.bases-cell-editor'), '第二次 Escape 取消编辑');
  const types = app.metadataTypeManager;
  await types.setType('Status', 'multitext');
  check(cell('note.Status')?.dataset.editable === 'true' && c.typeRef, '库级属性类型变化自动刷新 Bases 编辑器并登记类型订阅');
  await c.refresh();
  suggestionInput = begin('note.Status'); suggestionInput.value = '["one", "two"]'; suggestionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await c.queue;
  check(JSON.stringify((await front(alpha)).Status) === '["one","two"]', 'Bases 单元格遵守库级显式列表类型');
  await types.unsetType('Status'); await app.fileManager.processFrontMatter(alpha, fm => { fm.Status = 'waiting'; fm.link = '[[Alpha|Shown]]'; });
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.Status === 'waiting', '等待恢复建议夹具'); await c.refresh();
  const header = root.querySelector('.bases-thead .bases-td[data-property="note.score"]'), resizer = header.querySelector('.bases-table-header-resizer');
  const before = header.getBoundingClientRect().width;
  resizer.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true, cancelable: true }));
  document.dispatchEvent(new PointerEvent('pointermove', { clientX: 180, bubbles: true }));
  document.dispatchEvent(new PointerEvent('pointerup', { clientX: 180, bubbles: true })); await c.queue;
  check(Math.abs(c.view.columnSize['note.score'] - Math.round(before + 80)) <= 1, '列宽拖动写回原版 columnSize 键');
  check(yaml.load(await app.vault.read(file)).views[0].columnSize['note.score'] > 40, '列宽真实写入数据库');
  const transfer = new DataTransfer();
  const from = root.querySelector('.bases-thead .bases-td[data-property="note.score"]'), to = root.querySelector('.bases-thead .bases-td[data-property="note.Status"]');
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); await c.queue;
  check(c.view.order.indexOf('note.score') < c.view.order.indexOf('note.Status'), '列拖放真实调整 order');
  check(root.querySelectorAll('.bases-thead .bases-td')[1].dataset.property === 'note.score', '列重排更新可见表头顺序');
  const reordered = yaml.load(await app.vault.read(file)); reordered.views = [reordered.views[1], reordered.views[0], reordered.views[2]];
  await app.vault.modify(file, yaml.dump(reordered));
  await c.patchView('limit', 1);
  const after = yaml.load(await app.vault.read(file));
  check(after.views[0].name === 'Other' && after.views[0].limit === undefined && after.views[1].limit === 1, '外部重排后配置写回仍定位 Main');
  check(after.future.keep === 'unchanged' && after.views[1].future.intact, '写回保留顶层和视图未知键');
  await c.patchView('limit', 0);
  const secondLeaf = await app.workspace.openFile(file, { newLeaf: 'always' }), otherController = secondLeaf.view.controller;
  otherController.switchView('Main');
  await Promise.all([c.patchViewKey('columnSize', 'note.score', 171), otherController.patchViewKey('columnSize', 'note.Status', 231)]);
  const simultaneous = yaml.load(await app.vault.read(file)).views.find(view => view.name === 'Main');
  check(simultaneous.columnSize['note.score'] === 171 && simultaneous.columnSize['note.Status'] === 231, '两个真实控制器并发改列宽不丢其它列');
  await Promise.all([c.patchView('name', 'Renamed'), c.patchView('limit', 2)]);
  const renamed = yaml.load(await app.vault.read(file)).views.find(view => view.name === 'Renamed');
  check(renamed?.limit === 2 && c.viewName === 'Renamed', '同队列重命名后续操作跟随视图新名称');
  await c.patchView('name', 'Main');
  const backgroundRename = c.patchView('name', 'Background'); c.switchView('Board'); await backgroundRename;
  check(c.viewName === 'Board' && yaml.load(await app.vault.read(file)).views.some(view => view.name === 'Background'), '异步重命名完成不抢回用户已切换的视图');
  c.switchView('Background'); await c.patchView('name', 'Main');
  await c.patchView('name', 'Other');
  check(c.viewName === 'Main' && yaml.load(await app.vault.read(file)).views.filter(view => view.name === 'Other').length === 1, '拒绝重复视图名称且保留当前视图');
  await otherController.refresh(); otherController.switchView('Main'); await otherController.patchView('name', 'FromOther');
  const externalRename = await app.vault.read(file); clearTimeout(c.timer); await c.patchView('limit', 99);
  check((await app.vault.read(file)) === externalRename && root.textContent.includes('重命名或删除'), '另一控制器重命名目标后旧控件明确拒写');
  await otherController.patchView('name', 'Main'); await c.refresh();
  check(c.view.name === 'Main', '外部重命名拒写后重新选取恢复使用');
  const { ipcRenderer } = require('electron'), invoke = ipcRenderer.invoke;
  let conflicts = 0;
  ipcRenderer.invoke = async function(channel, request, ...args) {
    if (channel === 'vault-write-cas' && request?.path === file.path && conflicts++ === 0) {
      const changed = yaml.load(await app.vault.read(file)); changed.future.externalWindow = true; changed.views.reverse();
      await app.vault.modify(file, yaml.dump(changed));
    }
    return invoke.call(this, channel, request, ...args);
  };
  try { await c.patchView('limit', 7); } finally { ipcRenderer.invoke = invoke; }
  let concurrentDisk = yaml.load(await app.vault.read(file));
  check(conflicts >= 2 && concurrentDisk.views.find(view => view.name === 'Main').limit === 7, '跨窗口 CAS 冲突后重读重算并定位原视图');
  check(concurrentDisk.future.externalWindow && concurrentDisk.views[0].name === 'Board', 'CAS 重试保留另一窗口的重排和未知键');
  const rejectedSource = await app.vault.read(file); let attempts = 0;
  ipcRenderer.invoke = async function(channel, request, ...args) { if (channel === 'vault-write-cas' && request?.path === file.path) { attempts++; return { ok: false, conflict: true }; } return invoke.call(this, channel, request, ...args); };
  try { await c.patchView('name', 'Rejected'); } finally { ipcRenderer.invoke = invoke; }
  check(attempts === 8 && (await app.vault.read(file)) === rejectedSource && c.viewName === 'Main', '持续 CAS 冲突有界拒写且不提前更新视图身份');
  check(root.textContent.includes('持续被其它窗口修改'), '持续冲突向用户显示取消原因');
  await c.patchView('limit', 0);
  check(c.view.name === 'Main' && c.view.limit === 0, '持续冲突后队列恢复并成功保存');
  await c.refresh(); await otherController.refresh(); otherController.switchView('Main');
  await Promise.all([
    c.transact(current => current.patch(['views'], [...current.data.views, { name: 'Added', type: 'list', vendor: { preserve: 9 } }])),
    otherController.transact(current => current.patch(['views'], current.data.views.filter(view => view.name !== 'Other'))),
  ]);
  concurrentDisk = yaml.load(await app.vault.read(file));
  check(concurrentDisk.views.some(view => view.name === 'Added') && !concurrentDisk.views.some(view => view.name === 'Other'), '两个控制器并发新增与删除视图均保留');
  await c.refresh(); c.switchView('Main');
  await otherController.transact(current => current.patch(['views'], current.data.views.filter(view => view.name !== 'Main')));
  const deletedSource = await app.vault.read(file); await c.patchView('limit', 99);
  check((await app.vault.read(file)) === deletedSource && root.textContent.includes('重命名或删除'), '另一控制器删除目标后旧控件拒绝误写相邻视图');
  await c.transact(current => current.patch(['views'], [...current.data.views, { name: 'Main', type: 'table', order: data.views[0].order }])); c.switchView('Main');
  check(c.view.name === 'Main' && yaml.load(await app.vault.read(file)).views.find(view => view.name === 'Added').vendor.preserve === 9, '删除拒写后能恢复视图且保留并发新增的未知键');
  secondLeaf.detach(); app.workspace.setActiveLeaf(leaf);
  c.switchView('Board');
  root.querySelector('.bases-add-group').click();
  root.querySelector('.bases-group-add-input').value = 'future'; root.querySelector('.bases-group-add-line button').click(); await c.queue;
  check(c.view.groupOrder.includes('future'), '添加新分组写入 groupOrder');
  const column = key => [...root.querySelectorAll('.bases-kanban-column')].find(node => node.querySelector('.bases-group-value').textContent === key);
  check(column('future') && column('future').querySelectorAll('.bases-kanban-item').length === 0, '新建空组真实显示且不创建假笔记');
  async function drag(note, target) {
    const card = root.querySelector('.bases-kanban-item[data-path="' + note.path + '"]'), transfer = new DataTransfer();
    check(card?.draggable, '分组属性卡片可拖动：' + c.view.groupBy.property);
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }); target.dispatchEvent(over);
    check(over.defaultPrevented, '目标列接受真实拖放');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); await c.queue;
  }
  await drag(alpha, column('future')); await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.Status === 'future', '等待新分组拖放');
  check((await front(alpha)).Status === 'future', '卡片可以移动到新建空组');
  async function changeGroup(property) { await c.patchView('groupOrder', null); await c.patchView('groupBy', { property, direction: 'ASC' }); await c.refresh(); }
  await changeGroup('note.due'); await drag(alpha, root.querySelector('.bases-kanban-item[data-path="' + beta.path + '"]').closest('.bases-kanban-column'));
  await until(() => String(app.metadataCache.getFileCache(alpha)?.frontmatter?.due).startsWith('2024-02-29'), '等待日期组写回');
  check(String((await front(alpha)).due).startsWith('2024-02-29'), '日期组拖放真实写入日期');
  await changeGroup('note.link'); await drag(alpha, root.querySelector('.bases-kanban-item[data-path="' + beta.path + '"]').closest('.bases-kanban-column'));
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.link === '[[Beta]]', '等待链接组写回');
  check((await front(alpha)).link === '[[Beta]]', '链接组拖放真实写入 wikilink');
  await changeGroup('note.items'); await drag(alpha, root.querySelector('.bases-kanban-item[data-path="' + beta.path + '"]').closest('.bases-kanban-column'));
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.items?.[0] === 'c', '等待列表组写回');
  check(JSON.stringify((await front(alpha)).items) === '["c","d"]', '列表组拖放保留列表类型');
  await changeGroup('file.folder'); await c.patchView('groupOrder', ['Edit', 'EditNext']);
  await drag(alpha, column('EditNext'));
  check(alpha.path === 'EditNext/Alpha.md' && !!app.vault.getFileByPath('EditNext/Alpha.md'), 'file.folder 拖放真实移动文件');
  check((await app.vault.read(alpha)).includes('# Keep Alpha') && !(await app.vault.adapter.exists('Edit/Alpha.md')), '文件移动保留内容并移除旧路径');
  await changeGroup('formula.calc');
  check([...root.querySelectorAll('.bases-kanban-item')].every(card => !card.draggable), '公式分组保持只读且没有假拖放');
  await types.setType('Rank', 'number');
  await c.patchView('groupOrder', null); await c.patchView('groupBy', { property: 'note.Rank', direction: 'ASC' });
  root.querySelector('.bases-add-group').click();
  let groupInput = root.querySelector('.bases-group-add-input');
  check(groupInput.type === 'number', '空属性的新组编辑器使用库级显式数值类型');
  groupInput.value = '7'; root.querySelector('.bases-group-add-line button').click(); await c.queue;
  check(c.view.groupOrder.includes(7) && !c.view.groupOrder.includes('7'), '新组数值按真实数值类型写入 groupOrder');
  await types.unsetType('Rank');
  await app.fileManager.processFrontMatter(alpha, fm => { fm.tags = ['project']; });
  await app.fileManager.processFrontMatter(beta, fm => { fm.tags = ['private']; });
  await until(() => app.metadataCache.getFileCache(beta)?.frontmatter?.tags?.[0] === 'private', '等待标签候选索引');
  await c.patchView('groupOrder', null); await c.patchView('groupBy', { property: 'note.tags', direction: 'ASC' });
  root.querySelector('.bases-add-group').click(); groupInput = root.querySelector('.bases-group-add-input'); groupInput.value = '#priv'; groupInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(document.querySelector('.bases-cell-suggestions[data-property-key="tags"] .suggestion-item')?.dataset.value === 'private', '新组标签候选来自真实库标签索引');
  groupInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); groupInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check(!document.querySelector('.bases-cell-suggestions'), '关闭新组输入后候选浮层清理');
  await leaf.setViewState({ type: 'empty' });
  check(c.closed && c.typeRef === null && (app.workspace._events['properties-type-change']?.length || 0) === baselineTypeListeners, '关闭数据库恢复库级属性类型监听基线');
  check(c.queryCache.entries?.size === 0 && c.result === null && c.document === null && !document.querySelector('.bases-cell-suggestions'), '关闭清空行缓存、文档、结果与候选浮层');
  return { pass: true, count: checks.length, checks };
})();
