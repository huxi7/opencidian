/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: recovery 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * OBS_ACT eval：独立 fixture 的 recovery / workspaces / slides 验收。
 * 阶段：exercise → 退出并重启 → restart；history/layout/slides 用于截图；slides-check 可独立复验。
 * fixture 必须位于系统临时目录，且带 .obs-copy-recovery-fixture 标记。
 */
(async () => {
  const fs = require('fs');
  const path = require('path');
  const phase = process.env.OBS_RECOVERY_PHASE || 'exercise';
  const root = fs.realpathSync(app.vault.adapter.getBasePath());
  const temporaryRoots = ['/tmp', require('os').tmpdir()].map((p) => fs.realpathSync(p));
  if (!temporaryRoots.some((p) => root.startsWith(p + path.sep)) ||
      fs.readFileSync(path.join(root, '.obs-copy-recovery-fixture'), 'utf8').trim() !== 'recovery') {
    throw new Error('Refusing to run outside a marked temporary recovery fixture');
  }
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error('FAIL: ' + name); checks.push(name); };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (name, condition, timeout = 7000) => {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) await sleep(25);
    check(name, condition());
  };
  const ws = app.workspace;
  const vault = app.vault;
  const manifestPath = path.join(root, '.obs-copy-recovery-result.json');
  const snapshotFile = 'Recovery/note.md';
  const deletedFile = 'Deleted/Nested/note.md';
  const layoutFile = 'Layout.md';
  const slidesFile = 'Slides.md';
  const dataA = '# 恢复版本 A\n\n第一版内容。\n';
  const dataB = '# 恢复版本 B\n\n第二版内容。\n';
  const deckText = [
    '---', 'title: recovery presentation', '---', '# 第一页', '',
    '```md', '---', '围栏中不分页', '```', '', '> 引用', '>', '> ---', '>', '> 仍在第一页', '',
    '---', '', '# 第二页', '', '~~~text', '---', '波浪围栏中不分页', '~~~', '',
    '---', '', '# 第三页', '', '结束。',
  ].join('\n');
  const plugin = async (id) => {
    const entry = app.plugins.getInternalPlugin(id);
    check(id + ' registered', !!entry);
    if (!entry.enabled) check(id + ' enabled', await app.plugins.enableInternalPlugin(id));
    return app.plugins.getInternalPlugin(id).instance;
  };
  const recovery = await plugin('file-recovery');
  const spaces = await plugin('workspaces');
  await plugin('slides');
  const write = async (name, text) => {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (!vault.getAbstractFileByPath(parent)) await vault.createFolder(parent);
    }
    const file = vault.getFileByPath(name);
    return file ? vault.modify(file, text) : vault.create(name, text);
  };
  const visible = (el) => !!el && el.isConnected && el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
  const leafState = (leaf) => ({ id: leaf.id, type: leaf.view.getViewType(), state: leaf.view.getState() });
  const assertLayout = (name) => {
    const leaves = [];
    ws.iterateAllLeaves((leaf) => leaves.push(leaf));
    check(name + ': all leaves connected', leaves.every((leaf) => leaf._leafEl && leaf._leafEl.isConnected &&
      leaf.contentEl && leaf.view._rootEl.parentElement === leaf.contentEl));
    check(name + ': DOM leaf count equals model', document.querySelectorAll('.workspace-leaf').length === leaves.length);
    check(name + ': active leaf belongs to model', leaves.includes(ws.activeLeaf));
    for (const leaf of leaves.filter((leaf) => leaf.view.getViewType() === 'markdown')) {
      const view = leaf.view;
      const preview = view.mode === 'preview';
      check(name + ': mode DOM ' + leaf.id, preview
        ? getComputedStyle(view.sourceEl).display === 'none' && getComputedStyle(view.readingEl).display !== 'none'
        : getComputedStyle(view.sourceEl).display !== 'none' && getComputedStyle(view.readingEl).display === 'none' &&
          view.editor.cm.dom.getAttribute('data-editor-mode') === view.mode);
    }
    return leaves.map(leafState);
  };
  const startSlides = async () => {
    const file = vault.getFileByPath(slidesFile);
    check('slides fixture exists', !!file);
    const leaf = await ws.openFile(file);
    await leaf.view.setState({ file: slidesFile, mode: 'source' });
    // Editor 使用 0-based 坐标：line 3 是标题，line 4 是空行。
    const requestedSelection = { anchor: { line: 3, ch: 4 }, head: { line: 3, ch: 2 } };
    leaf.view.editor.setSelection(requestedSelection.anchor, requestedSelection.head);
    const expectedSelection = { anchor: leaf.view.editor.getCursor('anchor'), head: leaf.view.editor.getCursor('head') };
    check('fixture creates exact nonempty reverse selection',
      JSON.stringify(expectedSelection) === JSON.stringify(requestedSelection));
    ws.setActiveLeaf(leaf, { focus: true });
    check('slides command available', app.commands.findCommand('slides:start').checkCallback(true));
    app.commands.executeCommandById('slides:start');
    await wait('slides fully rendered', () => leaf.view.getViewType() === 'slides' && leaf.view.pages.length === 3 &&
      leaf.view.progressEl.textContent === '1 / 3');
    check('slides captures original selection', JSON.stringify(leaf.view.selection) === JSON.stringify(expectedSelection));
    leaf._acceptanceSelection = expectedSelection;
    leaf.view.onFocus();
    await sleep(100);
    return leaf;
  };
  const exerciseSlides = async () => {
    const leaf = await startSlides();
    const view = leaf.view;
    const key = (name, extra = {}) => view.slidesEl.dispatchEvent(new KeyboardEvent('keydown', {
      key: name, bubbles: true, cancelable: true, ...extra,
    }));
    check('fences and blockquote retained on first page', view.pages[0].querySelector('pre code').textContent.includes('---') &&
      !!view.pages[0].querySelector('blockquote hr'));
    check('exactly one page visible initially', view.pages.filter(visible).length === 1 && visible(view.pages[0]));
    key('ArrowRight');
    check('right key changes actual visible page', view.current === 1 && visible(view.pages[1]) && !visible(view.pages[0]));
    key('End'); check('End reaches last page', view.current === 2 && visible(view.pages[2]));
    key('ArrowRight'); check('last page clamps', view.current === 2);
    key('Home'); check('Home returns first page', view.current === 0);
    key('ArrowRight', { ctrlKey: true }); check('modified arrow does not page', view.current === 0);
    const box = view.deckEl.getBoundingClientRect();
    view.deckEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + box.width * 0.8 }));
    check('right half click advances', view.current === 1 && visible(view.pages[1]));
    view.deckEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + box.width * 0.2 }));
    check('left half click reverses', view.current === 0);
    const modal = recovery.openModal(snapshotFile);
    key('ArrowRight'); check('open modal blocks slide navigation', view.current === 0);
    modal.close(); await sleep(200); view.onFocus();
    key('Escape');
    await wait('Escape exits slides', () => leaf.view.getViewType() === 'markdown');
    await view._exiting;
    check('Escape restores source mode DOM', leaf.view.mode === 'source' &&
      leaf.view.editor.cm.dom.getAttribute('data-editor-mode') === 'source' && !visible(leaf.view.readingEl));
    const actualSelection = { anchor: leaf.view.editor.getCursor('anchor'), head: leaf.view.editor.getCursor('head') };
    check('Escape restores selection: ' + JSON.stringify({ expected: leaf._acceptanceSelection, actual: actualSelection }),
      JSON.stringify(actualSelection) === JSON.stringify(leaf._acceptanceSelection));
    check('Escape removes old keyboard handler', view._onKeyDown === null);
  };
  let prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  if (phase === 'exercise') {
    check('fresh independent fixture', prior === null && !vault.getFileByPath(snapshotFile));
    check('automatic snapshot fixture interval is zero', app.settings.loadPluginData('file-recovery.json', {}).intervalSeconds === 0);
    const file = await write(snapshotFile, dataA);
    await wait('create automatically snapshots A', () => recovery.getSnapshots(snapshotFile).some((s) => s.data === dataA));
    await vault.modify(file, dataB);
    await wait('modify automatically snapshots B', () => recovery.getSnapshots(snapshotFile)[0]?.data === dataB);
    const editLeaf = await ws.openFile(file);
    const modal = recovery.openModal(snapshotFile);
    check('history lists two snapshots', modal.versionListEl.children.length >= 2);
    const versionIndex = recovery.getSnapshots(snapshotFile).findIndex((s) => s.data === dataA);
    modal.versionListEl.children[versionIndex].click();
    check('history preview matches selected A', modal.textareaEl.value === dataA);
    await modal.restore();
    check('restore button writes A to disk', await vault.read(file) === dataA);
    check('restore synchronizes open editor', editLeaf.view.editor.getValue() === dataA);
    check('restored version sorted newest', recovery.getSnapshots(snapshotFile)[0].data === dataA);
    modal.close(); await sleep(200);
    const gone = await write(deletedFile, '# deleted version\n');
    await wait('deleted fixture has snapshot', () => recovery.getSnapshots(deletedFile).length > 0);
    const deletedSnapshot = recovery.getSnapshots(deletedFile)[0];
    await vault.delete(gone, true);
    const folder = vault.getAbstractFileByPath('Deleted');
    if (folder) await vault.delete(folder, true);
    await wait('deleted folder removed from index', () => !vault.getFileByPath(deletedFile) && !vault.getAbstractFileByPath('Deleted/Nested'));
    await recovery.restoreSnapshot(deletedFile, deletedSnapshot);
    check('deleted file restored to index immediately', !!vault.getFileByPath(deletedFile));
    check('deleted parents restored to index immediately', !!vault.getAbstractFileByPath('Deleted/Nested'));
    check('deleted file restored on disk', await vault.read(vault.getFileByPath(deletedFile)) === deletedSnapshot.data);
    await write(layoutFile, '# Layout\n');
    await write(slidesFile, deckText);
    await editLeaf.view.setState({ file: snapshotFile, mode: 'source' });
    const previewLeaf = ws.createLeafBySplit(editLeaf, 'vertical');
    await previewLeaf.setViewState({ type: 'markdown', state: { file: layoutFile, mode: 'preview' } });
    await previewLeaf.view.setState({ file: layoutFile, mode: 'preview' });
    ws.setActiveLeaf(editLeaf, { focus: true });
    const flushText = '# Flush before saving workspace\n';
    editLeaf.view.editor.setValue(flushText);
    await spaces.saveWorkspace('Recovery A');
    check('workspace save flushes pending edit', await vault.read(file) === flushText);
    const savedHistory = JSON.stringify(spaces.getWorkspaces()['Recovery A'].lastOpenFiles);
    ws.lastOpenFiles.push('unsaved-array-probe.md');
    check('saved history is immutable under live edits', JSON.stringify(spaces.getWorkspaces()['Recovery A'].lastOpenFiles) === savedHistory);
    await spaces.saveWorkspace('Recovery B');
    const before = [];
    ws.iterateAllLeaves((leaf) => before.push({ leaf, view: leaf.view, root: leaf.view._rootEl }));
    const flushLoad = '# Flush before loading workspace\n';
    editLeaf.view.editor.setValue(flushLoad);
    await spaces.loadWorkspace('Recovery A');
    check('workspace load flushes pending edit', await vault.read(file) === flushLoad);
    check('old view roots detached', before.every(({ root }) => !root.isConnected));
    check('old markdown subscriptions removed', before.filter(({ view }) => view.getViewType() === 'markdown')
      .every(({ view }) => view._refs.length === 0 && view._saveTimer === null));
    const loaded = assertLayout('saved workspace load');
    const counts = () => Object.fromEntries(Object.entries(vault._events).map(([name, list]) => [name, list.length]));
    const eventCounts = counts();
    await spaces.loadWorkspace('Recovery B'); await spaces.loadWorkspace('Recovery A');
    check('repeated workspace loads do not leak vault listeners', JSON.stringify(counts()) === JSON.stringify(eventCounts));
    await spaces.saveWorkspace('删除测试'); await spaces.loadWorkspace('删除测试'); await spaces.deleteWorkspace('删除测试');
    check('deleting active workspace clears active name', app.settings.loadPluginData('workspaces.json').active === '');
    await exerciseSlides();
    await spaces.loadWorkspace('Recovery A');
    assertLayout('final saved layout');
    prior = { done: true, file: snapshotFile, data: await vault.read(file), deletedData: deletedSnapshot.data,
      activeId: ws.activeLeaf.id, leafIds: loaded.map((leaf) => leaf.id).sort(), savedHistory,
      snapshotCount: recovery.getSnapshots(snapshotFile).length, exercised: new Date().toISOString() };
    fs.writeFileSync(manifestPath, JSON.stringify(prior, null, 2));
  } else if (phase === 'slides-check') {
    await exerciseSlides();
  } else {
    check('exercise completed in an earlier launch', prior && prior.done);
    if (phase === 'restart') {
      check('startup restores saved active leaf', ws.activeLeaf.id === prior.activeId);
      assertLayout('startup restored layout');
      check('startup restores note contents', await vault.read(vault.getFileByPath(snapshotFile)) === prior.data);
      check('snapshots survive process restart', recovery.getSnapshots(snapshotFile).length >= prior.snapshotCount &&
        recovery.getSnapshots(snapshotFile).some((s) => s.data === dataA) && recovery.getSnapshots(snapshotFile).some((s) => s.data === dataB));
      check('deleted-file recovery survives restart', await vault.read(vault.getFileByPath(deletedFile)) === prior.deletedData);
      check('workspace names survive restart', !!spaces.getWorkspaces()['Recovery A'] && !!spaces.getWorkspaces()['Recovery B']);
      check('active workspace name survives restart', app.settings.loadPluginData('workspaces.json').active === 'Recovery A');
      check('saved lastOpenFiles survives restart unchanged', JSON.stringify(spaces.getWorkspaces()['Recovery A'].lastOpenFiles) === prior.savedHistory);
      await spaces.loadWorkspace('Recovery B'); await spaces.loadWorkspace('Recovery A');
      const leaves = assertLayout('restart named layout load');
      check('same leaf IDs restored', JSON.stringify(leaves.map((leaf) => leaf.id).sort()) === JSON.stringify(prior.leafIds));
      await exerciseSlides(); await spaces.loadWorkspace('Recovery A');
    } else if (phase === 'history') {
      const modal = recovery.openModal(snapshotFile);
      check('history screenshot ready', visible(modal.modalEl) && modal.versionListEl.children.length >= 2);
    } else if (phase === 'layout') {
      await spaces.loadWorkspace('Recovery A'); assertLayout('layout screenshot');
      check('layout screenshot has source and preview', ws.getLeavesOfType('markdown').some((leaf) => leaf.view.mode === 'source') &&
        ws.getLeavesOfType('markdown').some((leaf) => leaf.view.mode === 'preview'));
    } else if (phase === 'slides') {
      const leaf = await startSlides(); leaf.view.next();
      check('slides screenshot second page ready', leaf.view.current === 1 && visible(leaf.view.pages[1]) && leaf.view.pages.filter(visible).length === 1);
      check('close button visibly positioned', visible(leaf.view.slidesEl.querySelector('.slides-close-btn')));
    } else throw new Error('Unknown OBS_RECOVERY_PHASE: ' + phase);
  }
  const report = { ok: true, role: 'recovery', phase, count: checks.length, checks, fixture: root };
  fs.writeFileSync(path.join(root, '.obs-copy-recovery-' + phase + '.json'), JSON.stringify(report, null, 2));
  return report;
})();
