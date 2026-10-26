/**
 * [INPUT]: 隔离库、真实搜索命令、核心插件生命周期与文件恢复入口。
 * [OUTPUT]: 返回 {pass,count,checks}；错误使运行器失败。
 * [POS]: 严格类型迁移发现的行为缺陷回归，不访问原版或录音设备。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const until = async (predicate, label) => {
    for (let n = 0; n < 160; n++) {
      if (await predicate()) { checks.push(label); return; }
      await wait(25);
    }
    throw new Error(label);
  };
  const workspace = app.workspace;
  await app.plugins.enableInternalPlugin('global-search');
  const source = 'strict selected phrase\n#strict/child\n';
  const file = await app.vault.create('Strict plugin regression.md', source);
  await app.metadataCache.parseFile(file);
  const noteLeaf = await workspace.openFile(file);
  const noteView = noteLeaf.view;
  noteView.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 22 });
  check(workspace.activeEditor.editor === noteView.editor, '活动编辑器宿主包含真实编辑器');
  app.commands.executeCommandById('global-search:open');
  await until(() => workspace.getLeavesOfType('search')[0]?.view?._query === '"strict selected phrase"',
    '全局搜索命令从宿主编辑器读取选区并转义空格');
  const search = workspace.getLeavesOfType('search')[0].view;
  await until(() => search.getFiles().some(entry => entry.path === file.path), '选区查询命中真实文件');

  const changes = [];
  const ref = workspace.on('layout-change', () => changes.push(search.getState()));
  try {
    for (const [apply, key, value] of [
      [() => search.setCollapseAll(true), 'collapseAll', true],
      [() => search.setExtraContext(true), 'extraContext', true],
      [() => search.setExplainSearch(true), 'explainSearch', true],
    ]) {
      const count = changes.length;
      apply();
      check(changes.length > count && changes.at(-1)[key] === value, key + ' 通过统一事件请求保存布局');
    }
    const findSearch = value => {
      if (!value || typeof value !== 'object') return null;
      if (value.type === 'search') return value.state;
      for (const child of Object.values(value)) {
        const found = findSearch(child);
        if (found) return found;
      }
      return null;
    };
    await until(async () => {
      if (!await app.vault.adapter.exists('.obsidian/workspace.json')) return false;
      const saved = JSON.parse(await app.vault.adapter.read('.obsidian/workspace.json'));
      const state = findSearch(saved);
      return state?.collapseAll && state.extraContext && state.explainSearch;
    }, '搜索选项由现有自动保存链真正写入 workspace.json');
  } finally { ref.unregister(); }

  await app.plugins.enableInternalPlugin('file-explorer');
  const ids = ['new-file', 'new-file-in-new-pane', 'new-folder', 'reveal-active-file', 'make-a-copy', 'move-file']
    .map(name => 'file-explorer:' + name);
  for (const id of ids) check(!!app.commands.findCommand(id), id + ' 启用时存在');
  await app.plugins.disableInternalPlugin('file-explorer');
  for (const id of ids) check(!app.commands.findCommand(id), id + ' 停用后撤销');
  await app.plugins.enableInternalPlugin('file-explorer');
  check(ids.every(id => !!app.commands.findCommand(id)), '文件树重新启用恢复完整命令集合');

  await app.plugins.enableInternalPlugin('tag-pane');
  const tagLeaf = await workspace.ensureSideLeaf('tag', 'right', { reveal: true });
  const tags = tagLeaf.view;
  let renders = 0;
  const render = tags._render;
  tags._render = function () { renders++; return render.call(this); };
  tags._queueRender();
  check(tags._pending != null, '标签视图建立延迟重绘任务');
  await app.plugins.disableInternalPlugin('tag-pane');
  const closedRenders = renders;
  check(tags._pending === null && tags._container === null, '关闭标签视图清理计时器和容器引用');
  await wait(300);
  check(renders === closedRenders, '关闭后不执行迟到重绘');

  await app.plugins.enableInternalPlugin('file-recovery');
  const recovery = app.plugins.getInternalPlugin('file-recovery').instance;
  await workspace.openFile(file);
  const current = workspace.activeLeaf.view;
  const save = current.save;
  let rejected = false;
  try {
    current.save = async () => false;
    try { await recovery.restoreSnapshot(file.path, { ts: 1, data: 'must not overwrite' }); }
    catch (error) { rejected = /could not be saved/.test(error.message); }
  } finally { current.save = save; }
  check(rejected, '恢复快照前保存失败会拒绝恢复');
  check(await app.vault.read(file) === source, '保存失败时恢复操作不覆盖原文件');
  return { pass: true, count: checks.length, checks };
})()
