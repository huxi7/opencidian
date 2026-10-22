/**
 * [INPUT]: 隔离临时库与真实 Electron app；原版格式 YAML 和未知扩展配置。
 * [OUTPUT]: 返回 {pass,count,checks}；验证数据库读取、筛选、排序、局部写回及笔记嵌入。
 * [POS]: Bases P1 验收。只由带 --no-screenshot 的隔离运行器执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message) => { for (let i = 0; i < 160; i++) { if (fn()) return; await wait(25); } throw Error(message); };
  const yaml = require('js-yaml');
  await app.plugins.enableInternalPlugin('bases');
  const plugin = app.plugins.getInternalPlugin('bases');
  check(plugin.enabled, '数据库核心插件启用');
  check(app.viewRegistry.getTypeByExtension('base') === 'bases', 'base 扩展注册为 bases');
  check(!!app.commands.commands['bases:new-file'], '注册新建数据库命令');
  await app.vault.createFolder('Projects');
  const notes = [
    ['Projects/Alpha.md', 'open', 2, true],
    ['Projects/Beta.md', 'open', 8, true],
    ['Projects/Gamma.md', 'done', 9, true],
    ['Projects/Hidden.md', 'open', 10, false],
    ['Outside.md', 'open', 99, true],
  ];
  for (const [path, status, score, visible] of notes) await app.vault.create(path, `---\nstatus: ${status}\nscore: ${score}\nvisible: ${visible}\ntags: [work]\n---\n# ${path}\n`);
  await until(() => app.metadataCache.getFileCache(app.vault.getFileByPath('Projects/Beta.md'))?.frontmatter?.score === 8, '等待笔记属性索引');
  const source = `# untouched top comment\ncustomFuture: {token: 'keep-me', enabled: true}\nfilters:\n  and:\n    - 'file.inFolder("Projects")'\n    - or:\n        - 'status == "open"'\n        - 'score < 3'\n    - not:\n        - 'visible == false'\nformulas:\n  doubled: 'score * 2'\nproperties:\n  note.score:\n    displayName: Score\nviews:\n  - type: table\n    name: Tasks\n    customView: {keep: 'exact'}\n    filters: 'file.hasTag("work")'\n    order: [file.name, note.score, formula.doubled]\n    sort:\n      - property: note.score\n        direction: DESC\n    limit: 1\n  - type: future-plugin\n    name: Future\n    vendor: {nested: [one, two]}\n`;
  const file = await app.vault.create('Tasks.base', source);
  const leaf = await app.workspace.openFile(file);
  const view = leaf.view;
  check(view.getViewType() === 'bases', '打开 base 使用数据库视图');
  const controller = view.controller;
  check(!!controller.document.data.filters.and, '解析嵌套 and 筛选');
  check(!!controller.document.data.filters.and[1].or, '解析嵌套 or 筛选');
  check(!!controller.document.data.filters.and[2].not, '解析嵌套 not 筛选');
  check(controller.document.data.formulas.doubled === 'score * 2', '保留公式源文本');
  check(controller.document.data.properties['note.score'].displayName === 'Score', '解析属性显示名称');
  check(controller.document.data.views.length === 2, '保留多个视图与未知类型');
  check(controller.result.total === 2, '全局嵌套与视图筛选交集命中两篇');
  check(controller.result.rows.length === 1, 'limit 限制为一行');
  check(controller.result.rows[0].file.path === 'Projects/Beta.md', '降序先取最高分笔记');
  check(view.contentEl.querySelectorAll('tbody tr').length === 1, '表格真实渲染一行');
  check(view.contentEl.querySelectorAll('thead th').length === 3, 'order 决定三个属性列');
  check(view.contentEl.querySelector('thead').textContent.includes('Score'), '列头使用属性显示名称');
  check(view.contentEl.querySelector('tbody').textContent.includes('16'), '公式基础算术渲染计算值');
  check((await app.vault.read(file)) === source, '打开数据库不触发写回');
  await controller.patchView('limit', 0);
  check(controller.result.rows.length === 2, '取消 limit 恢复两行');
  const afterLimit = await app.vault.read(file);
  check(afterLimit.startsWith('# untouched top comment\ncustomFuture: {token: \'keep-me\', enabled: true}\n'), '局部写回保持未知顶层原文');
  check(afterLimit.includes("customView: {keep: 'exact'}"), '局部写回保持当前视图未知原文');
  check(afterLimit.includes('vendor: {nested: [one, two]}'), '局部写回保持未知视图原文');
  check(yaml.load(afterLimit).views[1].type === 'future-plugin', '写回不丢未知视图类型');
  const scoreButton = [...view.contentEl.querySelectorAll('thead button')].find(button => button.textContent.includes('Score'));
  scoreButton.click(); await controller.queue;
  check(controller.document.getView().sort.length === 0, '降序列头再点清除排序');
  const scoreAgain = [...view.contentEl.querySelectorAll('thead button')].find(button => button.textContent.includes('Score'));
  scoreAgain.click(); await controller.queue;
  check(controller.result.rows[0].file.path === 'Projects/Alpha.md', '列头按钮将分数升序排序');
  check(yaml.load(await app.vault.read(file)).views[0].sort[0].direction === 'ASC', '列头排序持久化 ASC');
  await controller.patch(['filters'], { and: ['file.inFolder("Projects")', { not: ['status == "done"', 'visible == false'] }] });
  check(controller.result.total === 2, 'not 数组为所有条件均不匹配');
  await controller.patch(['filters'], { and: ['file.inFolder("Projects")', 'score >= 8'] });
  check(controller.result.total === 3, '修改全局筛选重新查询');
  const external = yaml.load(await app.vault.read(file)); external.views[0].limit = 1;
  await app.vault.modify(file, yaml.dump(external));
  await until(() => controller.document.getView().limit === 1, '等待外部 base 修改');
  check(controller.result.rows.length === 1, '外部 YAML 修改热更新表格');
  controller.viewName = 'Future'; controller.render();
  check(view.contentEl.textContent.includes('尚不支持的视图类型'), '未知视图明确显示降级');
  check(!view.contentEl.querySelector('table'), '未知视图不伪装成表格');
  check(!view.contentEl.querySelector('button,input'), '未知视图不显示不受支持的配置控件');
  controller.viewName = 'Tasks'; controller.render();
  await controller.patch(['filters'], 'file.nonexistentCapability("x")');
  check(controller.result.rows.length === 0, '未知筛选函数不返回假匹配结果');
  check(view.contentEl.textContent.includes('尚不支持的函数'), '未知函数明确提示能力边界');
  await controller.patch(['filters'], 'file.inFolder("Projects")');
  const originalDocument = controller.document;
  let invalid = false;
  try { originalDocument.patch(['filters'], { and: 'wrong' }); } catch { invalid = true; }
  check(invalid, '拒绝非数组逻辑筛选');
  check((await app.vault.read(file)).includes('file.inFolder'), '无效补丁不改磁盘');
  const Document = controller.document.constructor;
  const flow = new Document('{future: {keep: yes}, views: [{type: table, name: Flow, limit: 3}]}').patch(['views', 0, 'limit'], 1);
  check(flow.data.views[0].limit === 1 && flow.data.future.keep === 'yes', '流式顶层局部修改保留未知数据');
  check((flow.source.match(/^views:/gm) || []).length === 1, '流式顶层不追加重复 views 键');
  const flowViews = new Document('custom: {keep: true}\nviews: [{type: table, name: Flow, vendor: {x: 9}}]\n').patch(['views', 0, 'sort'], [{property:'score',direction:'DESC'}]);
  check(flowViews.data.views[0].vendor.x === 9, '流式视图写回保留未知视图字段');
  const anchored = new Document('future: &future {token: keep}\ncopy: *future\nviews:\n  - type: table\n    name: Anchors\n    limit: 2\n').patch(['views', 0, 'limit'], 1);
  check(anchored.source.includes('future: &future {token: keep}\ncopy: *future'), '无关 YAML 锚点与别名原文保持');
  check(anchored.data.copy.token === 'keep', '写回后 YAML 别名仍可解析');
  const anchorTarget = new Document('views: &views [{type: table, name: Anchor, limit: 2}]\nfuture: *views\n').patch(['views', 0, 'limit'], 1);
  check(anchorTarget.data.views[0].limit === 1 && anchorTarget.data.future[0].limit === 2, '修改锚点定义不误改未知别名数据');
  const created = await plugin.instance.createNewBase();
  check(created.extension === 'base', '新建数据库扩展名合法');
  const createdData = yaml.load(await app.vault.read(created));
  check(Array.isArray(createdData.views) && createdData.views[0].type === 'table', '新建数据库有合法 table 视图');
  check(app.workspace.activeLeaf.view.getViewType() === 'bases', '新建后打开数据库视图');
  const embedNote = await app.vault.create('Embed Bases.md', '# Embed\n\n![[Tasks.base]]\n\n![[Tasks.base#Future]]\n');
  const embedLeaf = await app.workspace.openFile(embedNote);
  await embedLeaf.view.setState({ file: embedNote.path, mode: 'preview' });
  await until(() => embedLeaf.view.readingEl.querySelector('.bases-embed table'), '等待阅读模式数据库嵌入');
  check(!!embedLeaf.view.readingEl.querySelector('.bases-embed tbody tr'), '阅读视图渲染数据库表格');
  check([...embedLeaf.view.readingEl.querySelectorAll('.bases-embed')].some(el => el.basesController?.viewName === 'Future' && el.textContent.includes('尚不支持的视图类型')), '阅读嵌入按#指定视图并明确降级');
  await embedLeaf.view.setState({ file: embedNote.path, mode: 'live' });
  await until(() => embedLeaf.view.contentEl.querySelector('.cm-content .bases-embed table'), '等待实时预览数据库嵌入');
  check(!!embedLeaf.view.contentEl.querySelector('.cm-content .bases-embed table'), '实时预览渲染数据库表格');
  check([...embedLeaf.view.contentEl.querySelectorAll('.cm-content .bases-embed')].some(el => el.basesController?.viewName === 'Future' && el.textContent.includes('尚不支持的视图类型')), '实时预览嵌入按#指定视图并明确降级');
  const liveController = embedLeaf.view.contentEl.querySelector('.cm-content .bases-embed').basesController;
  check(liveController.refs.length === 5, '实时预览挂五个 Vault/Metadata 订阅');
  await app.plugins.disableInternalPlugin('bases');
  check(liveController.refs.length === 0, '停用插件释放嵌入全部数据订阅');
  check(!liveController.container.querySelector('table') && liveController.container.textContent.includes('已停用'), '停用插件清表格并明确降级');
  await app.plugins.enableInternalPlugin('bases'); await liveController.ready;
  check(!!liveController.container.querySelector('table'), '重新启用插件重读数据库');
  await embedLeaf.view.setState({ file: embedNote.path, mode: 'source' });
  await until(() => liveController.closed, '等待实时预览嵌入销毁');
  check(liveController.refs.length === 0, '实时预览销毁后全部订阅归零');
  await embedLeaf.view.setState({ file: embedNote.path, mode: 'preview' });
  await until(() => embedLeaf.view.readingEl.querySelector('.bases-embed table'), '重新打开阅读嵌入');
  const closedReading = embedLeaf.view.readingEl.querySelector('.bases-embed').basesController;
  closedReading.container.remove(); await wait(20);
  check(closedReading.closed && closedReading.refs.length === 0, '阅读嵌入移除后观察器释放全部订阅');
  await app.saveLayout();
  return { pass: true, count: checks.length, checks };
})()
