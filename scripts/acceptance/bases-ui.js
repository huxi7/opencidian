/**
 * [INPUT]: 隔离 Electron 库、原版工具栏静态契约与真实数据库文件。
 * [OUTPUT]: 返回 {pass,count,checks}，断言八组入口、菜单操作、筛选写回与搜索。
 * [POS]: Bases UI 交互回归。只用 --no-screenshot，不触发外部应用或原生对话框。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(25); } throw Error(label); };
  const yaml = require('js-yaml'); await app.plugins.enableInternalPlugin('bases');
  await app.vault.createFolder('UI');
  for (const [name, score, status, done] of [['Alpha', 2, 'open', false], ['Beta', 8, 'open', true], ['Gamma', 4, 'done', false]]) await app.vault.create('UI/' + name + '.md', `---\nscore: ${score}\nstatus: ${status}\ndone: ${done}\n---\n# ${name}\n`);
  await until(() => app.metadataCache.getFileCache(app.vault.getFileByPath('UI/Gamma.md'))?.frontmatter?.score === 4, '等待 UI 数据索引');
  const original = { future: { preserve: 42 }, filters: 'file.inFolder("UI")', views: [{ type: 'table', name: 'Table', order: ['file.name', 'note.score', 'note.status'] }, { type: 'list', name: 'List', order: ['file.name', 'note.score'] }] };
  const file = await app.vault.create('UI.base', yaml.dump(original)); const leaf = await app.workspace.openFile(file), c = leaf.view.controller;
  await c.ready; await delay(150);
  const root = c.container, toolbar = () => root.querySelector('.bases-toolbar');
  const click = cls => { const item = toolbar().querySelector('.' + cls + ' button'); check(!!item, cls + ' 真实按钮存在'); item.click(); return root.querySelector('.bases-config-menu'); };
  const change = async (node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); await c.queue; await delay(110); };
  const groups = ['views-menu', 'results-menu', 'sort-menu', 'group-menu', 'filter-menu', 'properties-menu', 'search', 'new-item-menu'];
  check(!!toolbar(), '数据库显示原版 bases-toolbar 容器');
  check([...toolbar().children].map(node => groups.find(group => node.classList.contains('bases-toolbar-' + group))).join(',') === groups.join(','), '八组工具栏顺序与原版一致');
  check(toolbar().querySelectorAll('svg').length >= 8, '各入口渲染真实 SVG 图标');
  check(Math.round(root.querySelector('.bases-header').getBoundingClientRect().height) === 40, '工具栏真实高度为原版 40 像素');
  check(!toolbar().querySelector('select,input'), '工具栏使用图标按钮，不铺开原生下拉和结果上限');
  check(toolbar().querySelector('.bases-toolbar-result-count').textContent.includes('3'), '结果数位于视图后工具栏区域');
  let panel = click('bases-toolbar-views-menu');
  check(panel.getAttribute('role') === 'dialog', '视图菜单有可访问对话框语义');
  check(panel.querySelectorAll('[data-view]').length === 2, '视图菜单列出两种视图');
  const viewSearch = panel.querySelector('input[type="search"]'); viewSearch.value = 'List'; viewSearch.dispatchEvent(new Event('input'));
  check(panel.querySelector('[data-view="Table"]').hidden && !panel.querySelector('[data-view="List"]').hidden, '视图菜单搜索过滤真实选项');
  panel.querySelector('[data-view="List"] button').click();
  check(c.viewName === 'List' && root.querySelector('.bases-list-container'), '视图菜单点击切换真实列表');
  click('bases-toolbar-views-menu').querySelector('[data-view="Table"] button').click();
  toolbar().querySelector('.bases-view-switcher').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  panel = root.querySelector('.view-config-menu'); check(!!panel, '右键当前视图打开配置页');
  check(!panel.querySelector('textarea'), '配置页不暴露 YAML 文本编辑');
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!root.querySelector('.bases-config-menu'), 'Escape 关闭配置');
  panel = click('bases-toolbar-results-menu'); await change(panel.querySelector('input[type="number"]'), '2');
  check(c.result.rows.length === 2 && c.view.limit === 2, '结果数菜单真实写回结果上限');
  await c.patchView('limit', 0);
  panel = click('bases-toolbar-sort-menu'); panel.querySelectorAll('.menu-scroll > .text-icon-button')[0].click();
  let sortRow = panel.querySelector('.base-toolbar-sort-item'); await change(sortRow.querySelectorAll('select')[0], 'note.score');
  panel = root.querySelector('.bases-sort-page'); sortRow = panel.querySelector('.base-toolbar-sort-item');
  await change(sortRow.querySelectorAll('select')[1], 'DESC');
  check(!root.querySelector('.bases-sort-page .mod-cta'), '排序按属性和方向即时写回，没有非原版应用按钮');
  check(yaml.load(await app.vault.read(file)).views[0].sort[0].direction === 'DESC' && root.querySelector('.bases-sort-page'), '即时排序落盘后保持原菜单打开');
  check(c.result.rows.map(row => row.file.basename).join(',') === 'Beta,Gamma,Alpha', '排序菜单按数值降序实际排序');
  check(toolbar().querySelector('.bases-toolbar-sort-menu .is-active'), '激活排序有原版激活状态');
  panel = click('bases-toolbar-group-menu'); await change(panel.querySelector('select'), 'note.status');
  check(c.view.groupBy.property === 'note.status' && root.querySelectorAll('.bases-group-heading').length === 2, '分组菜单真实生成两个状态组');
  await c.patchView('groupBy', null);
  panel = click('bases-toolbar-properties-menu');
  const pathToggle = panel.querySelector('[aria-label="显示属性 file.path"]'); pathToggle.click(); await c.queue; await delay(110);
  check(c.result.columns.includes('file.path') && root.querySelector('thead').textContent.includes('file.path'), '属性菜单显示新列并保存');
  panel = click('bases-toolbar-filter-menu');
  check(panel.querySelectorAll('details').length === 2 && panel.querySelector('details:nth-child(2)').open, '筛选菜单分所有视图与当前视图，默认展开当前视图');
  check(!panel.querySelector('textarea'), '筛选菜单完全不暴露 YAML');
  let local = panel.querySelectorAll('details')[1];
  const addFormula = [...local.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '添加公式'); addFormula.click();
  const formulaEditor = local.querySelector('.formula-editor').basesFormulaEditor;
  check(!!formulaEditor.view.contentDOM && local.querySelector('.cm-editor'), '公式筛选使用真实 CodeMirror 6 编辑器');
  formulaEditor.setValue('file.inFolder("UI")'); formulaEditor.view.dispatch({ selection: { anchor: 16 } }); formulaEditor.focus(); await delay(50);
  check(document.querySelector('.bases-formula-function-signature')?.textContent.includes('inFolder(folder: String)'), '公式函数调用显示原版参数签名浮层');
  check(document.querySelector('.bases-formula-function-signature .active')?.textContent === 'folder: String', '签名浮层高亮当前活动参数');
  check(local.querySelector('.formula-editor .token.string'), '公式 CodeMirror 使用现有语义颜色高亮字符串');
  formulaEditor.setValue('file.inF'); formulaEditor.view.dispatch({ selection: { anchor: 8 } }); formulaEditor.complete();
  await until(() => document.querySelector('.cm-completionInfo')?.textContent.includes('specified folder'), '等待原版函数说明补全信息');
  check(document.querySelector('.cm-completionInfo').textContent.includes('inFolder(folder: String)'), '函数补全使用原版说明与参数类型');
  formulaEditor.setValue('file.'); formulaEditor.focus(); formulaEditor.complete();
  await until(() => document.querySelector('.cm-tooltip-autocomplete'), '等待公式属性补全');
  check(document.querySelector('.cm-tooltip-autocomplete').textContent.includes('name'), '公式 file 属性补全显示原版字段');
  formulaEditor.setValue('score >= 4');
  check(local.querySelector('.formula-editor-status').textContent.includes('公式有效'), '公式编辑实时校验语法');
  local.querySelector('.bases-filter-apply').click(); await c.queue; await delay(110);
  check(c.result.rows.length === 2 && c.view.filters === 'score >= 4', '公式筛选保存至当前视图且真实过滤');
  check(c.document.data.filters === original.filters, '局部筛选保留全局条件');
  panel = click('bases-toolbar-filter-menu'); local = panel.querySelectorAll('details')[1];
  const value = local.querySelector('.bases-filter-value'); check(!!value && value.value === '4', '已有简单比较恢复为属性条件控件');
  await change(value, '7'); local.querySelector('.bases-filter-apply').click(); await c.queue; await delay(110);
  check(c.result.rows.length === 1 && c.result.rows[0].file.basename === 'Beta', '属性条件编辑真实改变查询');
  await c.patchView('filters', { and: ['score >= 2', { or: ['status == "open"', 'score > 7'] }, { not: ['score < 4'] }] });
  panel = click('bases-toolbar-filter-menu');
  check(panel.querySelector('[data-operator="and"]') && panel.querySelector('[data-operator="or"]') && panel.querySelector('[data-operator="not"]'), '嵌套 and/or/not 以条件组显示');
  local = panel.querySelectorAll('details')[1]; local.querySelector('.bases-filter-apply').click(); await c.queue; await delay(110);
  check(JSON.stringify(c.view.filters) === JSON.stringify({ and: ['score >= 2', { or: ['status == "open"', 'score > 7'] }, { not: ['score < 4'] }] }), '无操作应用保留嵌套表达式原文');
  await c.patchView('filters', null);
  click('bases-toolbar-search'); const search = root.querySelector('.bases-search-row input'); search.value = 'Gamma'; search.dispatchEvent(new Event('input'));
  check(c.result.rows.length === 1 && c.result.rows[0].file.basename === 'Gamma', '数据库搜索筛选当前显示属性');
  root.querySelector('.bases-search-row input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(c.result.rows.length === 3 && !c.searchQuery, 'Escape 清除临时搜索且不修改筛选');
  panel = click('bases-toolbar-properties-menu'); document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  check(!root.querySelector('.bases-config-menu') && !toolbar().querySelector('.has-active-menu'), '点击菜单外关闭菜单并释放按钮激活态');
  check(JSON.stringify(yaml.load(await app.vault.read(file)).future) === JSON.stringify(original.future), '所有 UI 操作保留未知 YAML 键');
  check(!(await app.vault.read(file)).includes('Gamma\n'), '临时搜索不写入数据库定义');
  await c.patch(['formulas'], { blocks: 'markdown("# Heading\\n\\nParagraph\\n\\n- A\\n- B")' });
  await c.patchView('order', ['file.name', 'formula.blocks']);
  let rich = root.querySelector('.bases-rich-markdown'); await rich.ready;
  let richCell = rich.closest('.bases-table-cell');
  check(!!rich.querySelector('h1,ul') && getComputedStyle(richCell).overflow === 'hidden', '短行保留富内容 DOM 并按原版裁切');
  check(Math.abs(richCell.getBoundingClientRect().height - 30) <= 1, '默认短行固定为原版30像素');
  panel = c.openConfig(); await change(panel.querySelector('[data-config-field="rowHeight"]'), 'medium');
  rich = root.querySelector('.bases-rich-markdown'); await rich.ready; richCell = rich.closest('.bases-table-cell');
  check(c.view.rowHeight === 'medium' && richCell.closest('.bases-table-container').classList.contains('mod-multiline'), '行高选项写原版 rowHeight 并开启多行样式');
  check(Math.abs(richCell.getBoundingClientRect().height - 60) <= 1, '原版中行使用2倍基础行高');
  panel = c.openConfig(); await change(panel.querySelector('[data-config-field="rowHeight"]'), 'extra');
  rich = root.querySelector('.bases-rich-markdown'); await rich.ready; richCell = rich.closest('.bases-table-cell');
  check(Math.abs(richCell.getBoundingClientRect().height - 240) <= 1, '原版超高行使用8倍基础行高');
  check(richCell.querySelector('h1').textContent === 'Heading' && richCell.querySelectorAll('li').length === 2, '调整行高保留完整真实块内容');
  // 属性筛选必须按新选属性的类型写字面量，不能沿用默认名称条件的字符串。
  await c.patchView('filters', null);
  panel = c.openConfig(); let filterSection = panel.querySelector('.bases-config-filter'); filterSection.open = true;
  filterSection.querySelector('.bases-filter-actions button').click();
  await change(filterSection.querySelector('[aria-label="筛选属性"]'), 'note.score');
  check(filterSection.querySelector('.bases-filter-value').type === 'number', '配置筛选切到数值属性后使用数字输入');
  await change(filterSection.querySelector('.bases-filter-value'), '8');
  filterSection.querySelector('.bases-filter-apply').click(); await c.queue; await delay(110);
  check(c.view.filters === 'note["score"] == 8' && c.result.rows.length === 1 && c.result.rows[0].file.basename === 'Beta', '新建数值筛选保存数字8并实际匹配笔记');
  await c.patchView('filters', null);
  panel = click('bases-toolbar-filter-menu'); filterSection = panel.querySelectorAll('details')[1];
  filterSection.querySelector('.bases-filter-actions button').click();
  await change(filterSection.querySelector('[aria-label="筛选属性"]'), 'note.done');
  check(filterSection.querySelector('.bases-filter-value').tagName === 'SELECT', '工具栏筛选切到复选属性后提供布尔选项');
  await change(filterSection.querySelector('.bases-filter-value'), 'false');
  filterSection.querySelector('.bases-filter-apply').click(); await c.queue; await delay(110);
  check(c.view.filters === 'note["done"] == false' && c.result.rows.length === 2 && c.result.rows.every(row => row.file.basename !== 'Beta'), '新建布尔筛选保存false并实际匹配两篇笔记');
  await c.patchView('filters', null);
  panel = c.openConfig(); filterSection = panel.querySelector('.bases-config-filter'); filterSection.open = true;
  filterSection.querySelector('.bases-filter-actions button').click();
  await change(filterSection.querySelector('[aria-label="筛选属性"]'), 'note.score');
  const invalidNumber = filterSection.querySelector('.bases-filter-value'), sourceBeforeInvalid = await app.vault.read(file);
  await change(invalidNumber, 'not-a-number'); filterSection.querySelector('.bases-filter-apply').click(); await c.queue; await delay(30);
  check(!invalidNumber.checkValidity() && await app.vault.read(file) === sourceBeforeInvalid, '无效数字留在输入且不把默认0或字符串写入筛选');
  await change(invalidNumber, '4'); filterSection.querySelector('.bases-filter-apply').click(); await c.queue; await delay(110);
  check(c.view.filters === 'note["score"] == 4' && c.result.rows[0].file.basename === 'Gamma', '修正无效数字后恢复真实筛选保存');
  await c.patchView('filters', null);
  const { ipcRenderer } = require('electron'), invoke = ipcRenderer.invoke, originalName = c.view.name;
  panel = c.openConfig(); const renameInput = panel.querySelector('input[type="text"]'), unchangedSource = await app.vault.read(file);
  try {
    ipcRenderer.invoke = function(channel, request, ...args) {
      if (channel === 'vault-write-cas' && request?.path === file.path) return invoke.call(this, channel, { ...request, path: 'Missing-rename-target.base' }, ...args);
      return invoke.call(this, channel, request, ...args);
    };
    await change(renameInput, 'MustNotSelect');
  } finally { ipcRenderer.invoke = invoke; }
  check(await app.vault.read(file) === unchangedSource && c.viewName === originalName && renameInput.value === originalName, '真实主进程拒写改名后保留磁盘与原视图选择');
  check(c.view?.name === originalName && root.querySelector('.bases-view-switcher').textContent.includes(originalName), '改名保存失败不切到不存在的视图');
  panel = c.openConfig(); let competitor, raced = false;
  try {
    ipcRenderer.invoke = async function(channel, request, ...args) {
      if (channel === 'vault-write-cas' && request?.path === file.path && !raced) {
        raced = true; const concurrent = yaml.load(request.expected);
        concurrent.views.push({ type: 'table', name: 'ConcurrentRename', order: ['file.name'] });
        competitor = await invoke.call(this, channel, { path: file.path, expected: request.expected, text: yaml.dump(concurrent) });
      }
      return invoke.call(this, channel, request, ...args);
    };
    await change(panel.querySelector('input[type="text"]'), 'ConcurrentRename');
  } finally { ipcRenderer.invoke = invoke; }
  const afterRace = yaml.load(await app.vault.read(file));
  check(raced && competitor.ok && afterRace.views.some(view => view.name === 'ConcurrentRename') && afterRace.views.some(view => view.name === originalName), '真实CAS竞争者新增同名视图且原视图不被改写');
  check(c.viewName === originalName && leaf.view.getState().viewName === originalName && c.view?.name === originalName, '最新文档拒绝同名改名时不误选竞争者视图');
  return { pass: true, count: checks.length, checks };
})();
