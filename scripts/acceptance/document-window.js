/**
 * [INPUT]: 隔离库、文档窗口命令、IPC 真实窗口探针与文件监听。
 * [OUTPUT]: 返回 {pass,count,checks}；验证加载、转移、同库同步、关闭保存与主布局隔离。
 * [POS]: 独立窗口 E2E。窗口透明且不可聚焦，不启动外部应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const { ipcRenderer } = require('electron'), fs = require('fs'), path = require('path');
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label) => { for (let n = 0; n < 140; n++) { if (await predicate()) return; await wait(100); } throw Error(label); };
  const list = () => ipcRenderer.invoke('document-window-list');
  const probe = (windowId, payload = {}) => ipcRenderer.invoke('document-window-probe', { windowId, ...payload });
  check(!!app.commands.findCommand('workspace:move-to-new-window'), '注册移动文档至新窗口命令');
  check(!!app.commands.findCommand('workspace:open-in-new-window'), '注册在新窗口打开文档命令');
  if (process.env.OBS_NOTES_STAGE === 'restart') {
    await until(async () => (await list()).length === 1, '重启恢复文档窗口');
    const restored = (await list())[0], details = await probe(restored.windowId);
    check(details.file === 'Persisted second.md' && details.text === '# second\n', '独立窗口重启恢复活动文件与内容');
    check(details.markdownFiles.includes('Persisted window.md') && details.markdownFiles.includes('Persisted second.md'), '重启恢复独立窗口的全部标签');
    check(restored.bounds.width === 640 && restored.bounds.height === 480, '重启恢复独立窗口尺寸');
    check(Math.abs(restored.zoom - 0.5) < 0.01, '重启恢复独立窗口缩放');
    await ipcRenderer.invoke('document-window-close', restored.windowId);
    await until(async () => (await list()).length === 0, '关闭恢复窗口');
    return { pass: true, count: checks.length, checks };
  }
  const file = await app.vault.create('Window note.md', '# window\n');
  const leaf = await app.workspace.openFile(file);
  leaf.view.editor.setValue('# unsaved before popout\n');
  app.commands.executeCommandById('workspace:open-in-new-window');
  await until(async () => (await list()).length === 1, '打开独立窗口');
  let entry = (await list())[0], info;
  await until(async () => { info = await probe(entry.windowId); return info?.file === file.path && info?.text === '# unsaved before popout\n'; }, '独立窗口读取保存后的笔记');
  check(await app.vault.read(file) === '# unsaved before popout\n', '弹出前保存尚未落盘的编辑');
  check(leaf.view?.file?.path === file.path && leaf.parent, '打开副本保留原标签');
  check(info.isolatedLayout && info.type === 'markdown' && info.vault === app.vaultPath, '独立窗口绑定同一库与真实视图');
  check(info.opacity === 0 && !entry.focused, 'E2E 独立窗口透明且不抢焦点');
  const workspacePath = path.join(app.vaultPath, '.obsidian/workspace.json');
  await app.saveLayout(); const saved = fs.readFileSync(workspacePath, 'utf8');
  await probe(entry.windowId, { action: 'edit', text: '# edited in window\n' });
  await until(() => leaf.view.editor.getValue() === '# edited in window\n', '子窗口编辑同步回主窗口');
  check(await app.vault.read(file) === '# edited in window\n', '子窗口编辑真实写盘');
  check(fs.readFileSync(workspacePath, 'utf8') === saved, '子窗口不会覆盖主窗口布局');
  leaf.view.editor.setValue('# edited in main\n'); await leaf.view.save();
  await until(async () => (await probe(entry.windowId))?.text === '# edited in main\n', '主窗口编辑同步至子窗口');
  await ipcRenderer.invoke('document-window-close', entry.windowId);
  await until(async () => (await list()).length === 0, '关闭独立窗口');
  check(leaf.parent && app.workspace.getActiveFile()?.path === file.path, '关闭子窗口保留主标签');
  app.commands.executeCommandById('workspace:move-to-new-window');
  await until(async () => (await list()).length === 1 && !leaf.parent, '新窗口就绪后移除来源标签');
  entry = (await list())[0]; info = await probe(entry.windowId);
  check(info.file === file.path && info.text === '# edited in main\n', '移动后目标文档和内容正确');
  await probe(entry.windowId, { action: 'edit-pending', text: '# close saves pending\n' });
  await ipcRenderer.invoke('document-window-close', entry.windowId);
  await until(async () => (await list()).length === 0, '关闭移动的文档窗口');
  check(await app.vault.read(file) === '# close saves pending\n', '关闭子窗口等待尚未提交的编辑落盘');
  const invalid = await ipcRenderer.invoke('document-window-open', { type: 'markdown', state: { file: '../outside.md' } });
  check(invalid.ok === false && (await list()).length === 0, '拒绝越出当前库的窗口路径');
  await app.workspace.openFile(file);
  check(app.workspace.activeLeaf.view.editor.getValue() === '# close saves pending\n', '关闭后从文件树重开内容完整');
  for (const [name, type, text] of [
    ['Window.base', 'bases', 'views:\n  - type: table\n    name: Table\n'],
    ['Window.canvas', 'canvas', JSON.stringify({ nodes: [{ id: 'one', type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'real canvas' }], edges: [] })],
  ]) {
    const resource = await app.vault.create(name, text);
    const opened = await ipcRenderer.invoke('document-window-open', app.workspace._getViewStateForFile(resource));
    check(opened.ok, type + ' 真实独立窗口加载成功');
    const details = await probe(opened.windowId);
    check(details.type === type && details.file === resource.path, type + ' 独立窗口保持文件类型与路径');
    if (type === 'canvas') check(details.canvasNodes === 1, '画布独立窗口加载真实节点');
    await ipcRenderer.invoke('document-window-close', opened.windowId);
    await until(async () => !(await list()).some(item => item.windowId === opened.windowId), '关闭资源窗口');
  }
  const persistent = await app.vault.create('Persisted window.md', '# persistent\n');
  const persistentOpened = await ipcRenderer.invoke('document-window-open', { type: 'markdown', state: { file: persistent.path }, size: { width: 640, height: 480 }, zoom: 0.5 });
  check(persistentOpened.ok, '真实文档窗口留待重启恢复');
  const persistentEntry = (await list()).find(entry => entry.windowId === persistentOpened.windowId);
  check(persistentEntry.bounds.width === 640 && Math.abs(persistentEntry.zoom - 0.5) < 0.01, '窗口接收来源尺寸与缩放');
  const second = await app.vault.create('Persisted second.md', '# second\n');
  await wait(180);
  await probe(persistentOpened.windowId, { action: 'open-another', path: second.path });
  check((await probe(persistentOpened.windowId)).leafCount === 2, '独立窗口新增第二个真实文档标签');
  return { pass: true, count: checks.length, checks };
})();
