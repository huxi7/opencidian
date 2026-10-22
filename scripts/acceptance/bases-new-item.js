/**
 * [INPUT]: 隔离 Electron 库、真实筛选/分组、模板属性与锚定编辑浮层。
 * [OUTPUT]: 返回 {pass,count,checks}，验证立即创建、推导、编辑、改名、模板和释放。
 * [POS]: Bases 新建笔记回归。只写隔离库，不打开外部程序或原生弹窗。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const yaml = require('js-yaml'), checks = [];
  const check = (value, text) => { if (!value) throw Error(text); checks.push(text); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, text) => { for (let step = 0; step < 200; step++) { if (fn()) return; await delay(25); } throw Error(text); };
  await app.plugins.enableInternalPlugin('bases'); await app.vault.createFolder('NewItems');
  await app.vault.create('NewItems/Seed.md', '---\nstatus: done\nscore: 8\n---\nSeed');
  await until(() => app.metadataCache.getFileCache(app.vault.getFileByPath('NewItems/Seed.md'))?.frontmatter?.score === 8, '等待数据索引');
  const source = yaml.dump({ future: 42, filters: { and: ['file.inFolder("NewItems")', 'status == "open"', 'score >= 4', 'file.hasTag("project")'] }, views: [{ name: 'Table', type: 'table', order: ['file.name', 'note.status', 'note.score', 'note.extra'] }] });
  const file = await app.vault.create('NewItems.base', source), leaf = await app.workspace.openFile(file); let c = leaf.view.controller;
  await delay(120); const oldLeaves = app.workspace.getLeavesOfType('markdown').length;
  const create = async () => {
    c.container.querySelector('.bases-toolbar-new-item-menu button').click();
    await until(() => c._basesNewItem?.editor && c._basesNewItem.panel.isConnected, '等待立即创建并打开锚定浮层');
    await delay(120); return c._basesNewItem;
  };
  const close = async state => { state.panel.querySelector('[aria-label="关闭新笔记"]').click(); await until(() => !c._basesNewItem, '等待关闭并保存'); };
  let state = await create();
  check(state.file.basename.startsWith('Untitled') && await app.vault.adapter.exists(state.file.path), '点击新建直接创建真实 Untitled 笔记');
  check(state.file.parent.path === 'NewItems', '新建文件夹从 file.inFolder 筛选推导');
  const created = yaml.load((await app.vault.read(state.file)).split('---')[1]);
  check(created.status === 'open' && created.score === 4, '等于和边界比较推导初始属性');
  check(created.tags.includes('project') && Object.hasOwn(created, 'extra') && created.extra === null, '标签与显示属性空值按原版推导');
  check(app.workspace.activeLeaf === leaf && app.workspace.getLeavesOfType('markdown').length === oldLeaves, '新建在锚定浮层编辑，保留当前数据库标签');
  check(state.panel.classList.contains('hover-editor') && state.panel.querySelector('.cm-editor'), '浮层使用真实 Markdown CodeMirror 编辑器');
  const rect = state.panel.getBoundingClientRect(), anchor = c.container.querySelector('.bases-toolbar-new-item-menu').getBoundingClientRect();
  check(rect.top >= anchor.bottom && rect.left >= 0 && rect.right <= document.documentElement.clientWidth, '浮层贴新建入口并限制在窗口内 ' + JSON.stringify({ popup: { top: rect.top, left: rect.left, right: rect.right, width: rect.width }, anchor: { bottom: anchor.bottom }, viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } }));
  state.editor.setValue(state.editor.getValue() + '\nEdited in popover\n'); check(await leaf.view.save() === true, '成功 CAS 保存返回 true');
  check((await app.vault.read(state.file)).includes('Edited in popover'), '浮层正文编辑真实落盘');
  check(state.file.stat.size === (await app.vault.adapter.stat(state.file.path)).size, 'CAS 成功更新真实 TFile stat');
  const title = state.panel.querySelector('[aria-label="新笔记名称"]'); title.value = 'Created'; title.dispatchEvent(new Event('blur'));
  await until(() => state.file.path === 'NewItems/Created.md', '等待浮层改名');
  check(state.editor.sourcePath === state.file.path && await app.vault.adapter.exists(state.file.path), '浮层改名更新实际文件与编辑器来源');
  await close(state); check(!state.panel.isConnected && state.closed, '关闭浮层销毁编辑器和外部指针订阅');
  await c.patch(['filters'], 'file.inFolder("NewItems")'); await c.patchView('filters', 'score >= 4'); await c.patchView('groupBy', { property: 'note.status', direction: 'ASC' });
  const done = [...c.container.querySelectorAll('.bases-group-heading')].find(node => node.querySelector('.bases-group-value').textContent === 'done');
  done.querySelector('.bases-group-new-item').click(); await until(() => c._basesNewItem?.editor, '等待组内新建'); state = c._basesNewItem;
  const grouped = yaml.load((await app.vault.read(state.file)).split('---')[1]);
  check(grouped.status === 'done' && grouped.score === 4, '组内加号将实际组键与视图筛选共同写入初始属性');
  await close(state); await c.patchView('groupBy', null);
  await app.vault.createFolder('Templates'); await app.vault.create('Templates/Default.md', '---\nfromTemplate: true\nscore: 99\n---\nTemplate body must stay in template\n');
  await until(() => app.metadataCache.getFileCache(app.vault.getFileByPath('Templates/Default.md'))?.frontmatter?.fromTemplate, '等待模板索引');
  await c.patch(['newItemTemplate'], 'Templates/Default.md'); state = await create();
  const templated = await app.vault.read(state.file), templateData = yaml.load(templated.split('---')[1]);
  check(state.file.parent.path === 'Templates', '未指定新建文件夹时优先使用模板所在文件夹');
  check(templateData.fromTemplate === true && templateData.score === 99 && !Object.hasOwn(templateData, 'extra'), '模板属性替代筛选推导属性，保持原版语义');
  check(!templated.includes('Template body'), '数据库模板只复制属性，不擅自复制原版未复制的正文');
  await until(() => state.panel.querySelector('.bases-filter-query-message'), '等待新建项被筛选提示');
  check(state.panel.querySelector('.bases-filter-query-message').textContent.length > 0, '不满足筛选的新建文件保留并提示实际状态');
  await close(state); await c.patch(['newItemFolder'], 'Explicit'); state = await create();
  check(state.file.parent.path === 'Explicit', '显式 newItemFolder 优先于模板目录并真实创建文件夹');
  state.editor.setValue(state.editor.getValue() + 'Save before close\n'); await close(state);
  check((await app.vault.read(state.file)).includes('Save before close'), '关闭浮层先保存尚未触发防抖的文本');
  state = await create(); const before = await app.vault.read(state.file);
  state.editor.setValue(before + 'Uncommitted draft\n');
  const { ipcRenderer } = require('electron'), invoke = ipcRenderer.invoke; let raced = false, requestSeen, competitor;
  try {
    // 两次请求都执行真实主进程 CAS；竞争者在本次提交前先写入。
    ipcRenderer.invoke = async function(channel, request, ...args) {
      if (channel === 'vault-write-cas' && request?.path === state.file.path && !raced) {
        raced = true; requestSeen = { ...request };
        competitor = await invoke.call(this, channel, { path: request.path, expected: before, text: before + 'External CAS edit\n' });
      }
      return invoke.call(this, channel, request, ...args);
    };
    check(await leaf.view.save() === false, '主进程 CAS 冲突使 BasesView.save 返回 false');
  } finally { ipcRenderer.invoke = invoke; }
  check(raced && competitor.ok && requestSeen.expected === before && requestSeen.text.includes('Uncommitted draft'), '浮层提交真实 expected/text，竞争者实际 CAS 先成功');
  check(state.panel.isConnected && (await app.vault.read(state.file)).includes('External CAS edit') && !(await app.vault.read(state.file)).includes('Uncommitted draft'), 'CAS 冲突不覆盖磁盘且保留未保存浮层');
  const savedController = c, oldParent = leaf.parent;
  check(await leaf.view.onClose() === false && leaf.view.controller === savedController && !c.closed, 'onClose 拒绝销毁未保存草稿');
  check(await leaf.view.setState({ file: file.path }) === false && leaf.view.controller === savedController, 'setState 传播失败并保留原控制器');
  check(await leaf.detach() === false && leaf.parent === oldParent && state.panel.isConnected, '工作区尊重关闭拒绝并保留实际标签和草稿');
  c.render(); check(state.panel.isConnected && state.editor.getValue().includes('Uncommitted draft'), '数据库重绘不丢冲突草稿');
  state.panel.querySelector('.bases-new-item-save-draft').click();
  await until(() => !state.failed && state.preservedFile, '等待另存草稿');
  const draft = state.preservedFile;
  check((await app.vault.read(draft)).includes('Uncommitted draft') && state.editor.getValue().includes('External CAS edit'), '用户可将冲突草稿另存真实笔记，再载入最新内容');
  await close(state);
  state = await create(); const external = await app.vault.read(state.file);
  state.editor.setValue(external + 'Must preserve on shutdown\n'); await app.vault.modify(state.file, external + 'Other content\n');
  const createNew = app.fileManager.createNewMarkdownFile;
  try {
    app.fileManager.createNewMarkdownFile = async function(folder, name, text) { if (name.includes(' draft ')) throw Error('injected draft write failure'); return createNew.call(this, folder, name, text); };
    check(await c.setEnabled(false) === false && c.enabled && c.refs.length === 5 && state.panel.isConnected, '草稿另存失败时拒停控制器且保留订阅和编辑器');
    check(await c.destroy() === false && !c.closed && state.editor.getValue().includes('Must preserve'), '草稿另存失败时 destroy 返回 false 且不丢输入');
    check(await app.plugins.disableInternalPlugin('bases') === false && app.plugins.getInternalPlugin('bases').enabled, '草稿另存失败时核心插件拒绝停用');
    check(app.commands.findCommand('bases:new-file') && c.container.querySelector('.bases-toolbar') && state.panel.isConnected, '拒绝停用不移除入口、数据库或草稿');
  } finally { app.fileManager.createNewMarkdownFile = createNew; }
  const stopped = await app.plugins.disableInternalPlugin('bases');
  check(stopped && !state.panel.isConnected && state.closed, '恢复写入后停用先保存冲突草稿再释放浮层');
  check(state.preservedFile && (await app.vault.read(state.preservedFile)).includes('Must preserve on shutdown') && (await app.vault.read(state.file)).includes('Other content'), '强制释放保留实际草稿文件与外部版本');
  await app.plugins.enableInternalPlugin('bases'); await c.ready;
  state = await create(); const destroyOriginal = await app.vault.read(state.file);
  state.editor.setValue(destroyOriginal + 'Preserve on destroy\n'); await app.vault.modify(state.file, destroyOriginal + 'External on destroy\n');
  check(await c.destroy() === true && c.closed && state.closed && state.preservedFile, '直接销毁冲突控制器先成功另存再返回 true');
  check((await app.vault.read(state.preservedFile)).includes('Preserve on destroy') && (await app.vault.read(state.file)).includes('External on destroy'), '直接销毁不覆盖外部文本且草稿真实可读');
  check(yaml.load(await app.vault.read(file)).future === 42, '新建交互保留数据库未知键');
  return { pass: true, count: checks.length, checks };
})();
