/**
 * [INPUT]: 隔离库、两个真实 Electron App、固定文档窗口探针与 CAS 保存。
 * [OUTPUT]: 返回 {pass,count,checks}；断言双窗竞争、失败保留、双向同步与关闭前落盘。
 * [POS]: 多窗口数据保护回归。冲突后显式丢弃本地草稿恢复，防止关闭守卫正确拒绝退出。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const { ipcRenderer } = require('electron');
  const checks = [], check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (test, message) => { for (let i = 0; i < 160; i++) { if (await test()) return; await delay(50); } throw Error(message); };
  const list = () => ipcRenderer.invoke('document-window-list');
  const probe = (windowId, payload = {}) => ipcRenderer.invoke('document-window-probe', { windowId, ...payload });
  const stopTimer = view => { clearTimeout(view._saveTimer); view._saveTimer = null; };
  const opened = [];
  async function open(file) { const result = await ipcRenderer.invoke('document-window-open', app.workspace._getViewStateForFile(file)); check(result.ok, file.extension + ' 独立窗口真实打开'); opened.push(result.windowId); return result.windowId; }
  async function discardMain(view) {
    stopTimer(view); const text = await app.vault.read(view.file);
    if (view.editor) { view._suppressChange = true; view.editor.setValue(text); view._suppressChange = false; view._loadedText = text; }
    else { view._savedDataText = JSON.stringify(view.getData(), null, '\t'); await view._applyFileFromDisk(view.file.path); }
    view._dirty = false; view._saveError = null; view._saveConflict = false;
  }
  try {
    const file = await app.vault.create('Window save race.md', '# original\n'), leaf = await app.workspace.openFile(file), view = leaf.view;
    const id = await open(file); await until(async () => (await probe(id)).text === '# original\n', '等待副本读取原文');
    await probe(id, { action: 'edit-pending', text: '# remote draft\n', hold: true });
    view.editor.setValue('# main draft\n'); stopTimer(view);
    const [mainSaved, remoteSaved] = await Promise.all([view.save(), probe(id, { action: 'save' })]);
    const disk = await app.vault.read(file);
    check(Number(mainSaved === true) + Number(remoteSaved.saveResult === true) === 1, '同原文两个真实窗口并发保存仅一个成功');
    check(disk === '# main draft\n' || disk === '# remote draft\n', 'CAS 磁盘保留一个完整草稿');
    const remote = await probe(id);
    check(mainSaved ? remote.text === '# remote draft\n' && remote.dirty : view.editor.getValue() === '# main draft\n' && view._dirty, '失败窗口保留未保存编辑和dirty');
    check(mainSaved ? remote.saveConflict && remote.saveError : view._saveConflict && view._saveError, '冲突向失败窗口提供明确错误');
    check((await app.flushForClose()).ok === (mainSaved === true), '主窗关闭前flush准确拒绝本地冲突草稿');
    if (mainSaved) { await ipcRenderer.invoke('document-window-close', id); await delay(160); check((await list()).some(entry => entry.windowId === id), '子窗冲突时关闭守卫保留真实窗口'); }
    await discardMain(view); await probe(id, { action: 'discard-local' });
    view.editor.setValue('# preserve by copy\n'); stopTimer(view);
    await probe(id, { action: 'edit', text: '# disk before copy\n' });
    await until(() => view._saveConflict, '等待真实外部冲突提示');
    check(view.editor.getValue() === '# preserve by copy\n', '磁盘回显不会覆盖未保存草稿');
    const oldParent = leaf.parent, oldState = leaf.viewState;
    check(await leaf.detach() === false && leaf.parent === oldParent, '保存冲突时关闭标签返回false且保留DOM叶子');
    check(await leaf.setViewState({ type: 'empty' }) === false && leaf.view === view && view.editor.getValue() === '# preserve by copy\n', '保存冲突时切换视图不会销毁编辑器');
    const another = await app.vault.create('Other save guard.md', '# other\n');
    check(await leaf.setViewState({ type: 'markdown', state: { file: another.path } }) === false && leaf.viewState === oldState && view.file === file, '同类型切文件保存失败时保留原状态');
    check(await app.workspace.loadLayout(JSON.parse(JSON.stringify(app.workspace.getLayout()))) === false && leaf.parent === oldParent && !view._closed, '保存冲突时批量换布局保留原工作区');
    view._saveNotice.messageEl.querySelector('.window-save-resolve').click();
    let recovery = document.querySelector('.window-save-conflict');
    check(!!recovery, '冲突通知按钮打开真实恢复弹层');
    recovery.querySelector('[data-action="save-copy"]').click();
    await until(() => app.workspace.getActiveFile()?.path.includes('(conflict copy)'), '等待真实副本创建并打开');
    const copy = app.workspace.getActiveFile();
    check(await app.vault.read(copy) === '# preserve by copy\n' && await app.vault.read(file) === '# disk before copy\n', '另存本地副本真实保存草稿且不覆盖原文件');
    check(!view._dirty && view.editor.getValue() === '# disk before copy\n', '副本成功创建后才解除原文档dirty并载入磁盘');
    await until(() => !document.querySelector('.window-save-conflict:not(.is-hidden)'), '等待副本恢复弹层关闭');
    app.workspace.setActiveLeaf(leaf, { focus: false });
    view.editor.setValue('# copy before slow reload\n'); stopTimer(view);
    await probe(id, { action: 'edit', text: '# disk before slow reload\n' }); await until(() => view._saveConflict, '等待延迟恢复夹具冲突');
    const actualRead = app.vault.read, actualCreate = app.fileManager.createNewFile;
    let copiedForRace = false, readingForRace = false, finishRecoveryRead;
    app.fileManager.createNewFile = async function(...args) { const created = await actualCreate.apply(this, args); copiedForRace = true; return created; };
    app.vault.read = async function(target) {
      const text = await actualRead.call(this, target);
      if (target === file && copiedForRace && !readingForRace) { readingForRace = true; return new Promise(resolve => { finishRecoveryRead = () => resolve(text); }); }
      return text;
    };
    try {
      view._saveNotice.messageEl.querySelector('.window-save-resolve').click(); recovery = [...document.querySelectorAll('.window-save-conflict')].at(-1); recovery.querySelector('[data-action="save-copy"]').click();
      await until(() => readingForRace, '等待副本创建后的恢复读取挂起');
      recovery.querySelector('.modal-close-button').click(); view.editor.setValue('# new input during recovery\n'); stopTimer(view); finishRecoveryRead();
      await until(() => app.workspace.getActiveFile()?.path.includes('(conflict copy)'), '等待延迟恢复后打开副本');
      check(view._dirty && view.editor.getValue() === '# new input during recovery\n', '副本后读盘等待期间的新输入不会丢失或清dirty');
      check(await actualRead.call(app.vault, app.workspace.getActiveFile()) === '# copy before slow reload\n', '旧快照副本仍真实保存并打开，新输入保留在原标签');
    } finally { app.vault.read = actualRead; app.fileManager.createNewFile = actualCreate; finishRecoveryRead?.(); }
    app.workspace.setActiveLeaf(leaf, { focus: false });
    view.editor.setValue('# abandon only after confirm\n'); stopTimer(view);
    await probe(id, { action: 'edit', text: '# disk reload confirmed\n' });
    await until(() => view._saveConflict, '等待载入磁盘前冲突');
    view._saveNotice.messageEl.querySelector('.window-save-resolve').click(); recovery = [...document.querySelectorAll('.window-save-conflict')].at(-1);
    recovery.querySelector('[data-action="reload"]').click();
    check(view._dirty && recovery.querySelector('.window-save-discard-confirm'), '载入磁盘需要明确放弃草稿确认');
    recovery.querySelector('[data-action="confirm-reload"]').click();
    await until(() => !view._dirty && view.editor.getValue() === '# disk reload confirmed\n', '等待确认后载入磁盘');
    check(await app.vault.read(file) === '# disk reload confirmed\n', '确认载入磁盘解除dirty且不覆盖磁盘');
    const cleanLayout = JSON.parse(JSON.stringify(app.workspace.getLayout())), cleanMap = app.workspace._leafMap;
    check(await app.workspace.loadLayout({}) === false && app.workspace._leafMap === cleanMap && leaf.view === view && !view._closed, '干净文档遇空布局也在关闭旧视图前拒绝');
    check(await app.workspace.loadLayout({ ...cleanLayout, main: { ...cleanLayout.main, children: 'invalid' } }) === false && view.editor.getValue() === '# disk reload confirmed\n', '损坏子节点布局保留原文档、索引与编辑器');
    view.editor.setValue('# failed copy preserves draft\n'); stopTimer(view);
    await probe(id, { action: 'edit', text: '# disk during failed copy\n' }); await until(() => view._saveConflict, '等待副本失败夹具冲突');
    const create = app.fileManager.createNewFile; app.fileManager.createNewFile = async () => { throw Error('injected copy failure'); };
    try {
      view._saveNotice.messageEl.querySelector('.window-save-resolve').click(); recovery = [...document.querySelectorAll('.window-save-conflict')].at(-1); recovery.querySelector('[data-action="save-copy"]').click();
      await until(() => recovery.querySelector('[role="alert"]').textContent.includes('injected copy failure'), '等待副本失败提示');
      check(view._dirty && view.editor.getValue() === '# failed copy preserves draft\n', '副本创建失败时保留原dirty草稿');
    } finally { app.fileManager.createNewFile = create; }
    recovery.querySelector('[data-action="reload"]').click(); recovery.querySelector('[data-action="confirm-reload"]').click(); await until(() => !view._dirty, '清理副本失败草稿');
    const originalInvoke = ipcRenderer.invoke, before = await app.vault.read(file);
    view.editor.setValue('# retry after IO\n'); stopTimer(view);
    ipcRenderer.invoke = async function(channel, request, ...args) { if (channel === 'vault-write-cas' && request?.path === file.path) return { ok: false, error: 'injected IO failure' }; return originalInvoke.call(this, channel, request, ...args); };
    try { check(await view.save() === false, '真实视图保存IO失败返回false'); } finally { ipcRenderer.invoke = originalInvoke; }
    check(view._dirty && await app.vault.read(file) === before, 'IO失败不清dirty也不改磁盘');
    check(await view.save() === true && !view._dirty, 'IO恢复后同一视图保存成功');
    await until(async () => (await probe(id)).text === '# retry after IO\n', '主窗正常编辑同步至子窗');
    check((await probe(id)).text === '# retry after IO\n', '主窗正常保存双向同步之一');
    await probe(id, { action: 'edit', text: '# remote normal\n' });
    await until(() => view.editor.getValue() === '# remote normal\n', '子窗正常编辑同步至主窗');
    check(await app.vault.read(file) === '# remote normal\n' && !view._dirty, '子窗正常保存双向同步之二');
    view.editor.setValue('# final 150ms\n');
    check((await app.flushForClose()).ok && await app.vault.read(file) === '# final 150ms\n', '主窗关闭前立即flush最后150ms输入');
    await until(async () => (await probe(id)).text === '# final 150ms\n', '等待主窗flush同步');
    const canvasText = JSON.stringify({ nodes: [{ id: 'one', type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'original' }], edges: [], vendor: { preserved: true } });
    const canvasFile = await app.vault.create('Window save race.canvas', canvasText), canvasLeaf = await app.workspace.openFile(canvasFile), canvas = canvasLeaf.view, canvasId = await open(canvasFile);
    await probe(canvasId, { action: 'canvas-edit-pending', text: 'remote canvas', hold: true });
    canvas.nodes.get('one').setText('main canvas'); stopTimer(canvas);
    const [canvasSaved, remoteCanvasSaved] = await Promise.all([canvas.save(), probe(canvasId, { action: 'save' })]);
    const canvasDisk = JSON.parse(await app.vault.read(canvasFile)), remoteCanvas = await probe(canvasId);
    check(Number(canvasSaved === true) + Number(remoteCanvasSaved.saveResult === true) === 1, '画布两个真实窗口并发保存仅一个成功');
    check(canvasDisk.vendor.preserved && ['main canvas', 'remote canvas'].includes(canvasDisk.nodes[0].text), '画布CAS保持节点与未知字段完整');
    check(canvasSaved ? remoteCanvas.dirty && remoteCanvas.canvasData.nodes[0].text === 'remote canvas' : canvas._dirty && canvas.nodes.get('one').text === 'main canvas', '画布失败窗口保留完整未保存节点');
    await discardMain(canvas);
    const discarded = await probe(canvasId, { action: 'discard-local' });
    check(!discarded.dirty && JSON.stringify(discarded.canvasData.nodes) === JSON.stringify(canvasDisk.nodes), '画布冲突清理实际载入磁盘节点');
    canvas.nodes.get('one').setText('main normal'); stopTimer(canvas); check(await canvas.save(), '画布正常CAS保存成功');
    await until(async () => (await probe(canvasId)).canvasData.nodes[0].text === 'main normal', '画布主窗同步子窗');
    await probe(canvasId, { action: 'canvas-edit-pending', text: 'remote normal', hold: true }); await probe(canvasId, { action: 'save' });
    await until(() => canvas.nodes.get('one').text === 'remote normal', '画布子窗同步主窗');
    check(!canvas._dirty && JSON.parse(await app.vault.read(canvasFile)).nodes[0].text === 'remote normal', '画布正常双向同步并清dirty');
  } finally {
    for (const id of opened) { await probe(id, { action: 'discard-local' }); await ipcRenderer.invoke('document-window-close', id); }
    for (const leaf of [...app.workspace.getLeavesOfType('markdown'), ...app.workspace.getLeavesOfType('canvas')]) await discardMain(leaf.view);
  }
  await until(async () => !(await list()).length, '验收关闭全部自建窗口');
  check(!(await list()).length, '冲突恢复后全部独立窗口正常关闭');
  return { pass: true, count: checks.length, checks };
})();
