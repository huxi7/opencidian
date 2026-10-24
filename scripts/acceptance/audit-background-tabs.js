/**
 * [INPUT]: 隔离库、真实文件树点击、关系图书签与新建标签命令。
 * [OUTPUT]: 返回 {pass,count,checks}，验证后台标签的可见项和命令目标一致。
 * [POS]: 新标签路由回归。同时检查模型、DOM、正文和查重数量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (test, message) => { for (let i = 0; i < 100; i++) { if (test()) return; await wait(20); } throw Error(message); };
  const visible = leaf => !!leaf?._leafEl && getComputedStyle(leaf._leafEl).display !== 'none' && leaf._leafEl.getBoundingClientRect().width > 0 && leaf._leafEl.getBoundingClientRect().height > 0;
  const centerLeaves = () => [...app.workspace._leafMap.values()].filter(leaf => !leaf._closed && app.workspace._sideOf(leaf) === 'center');
  const domCount = () => document.querySelectorAll('.workspace-split.mod-root .workspace-leaf').length;
  const originalFocus = app.settings.appSettings.focusNewTab;
  const prefix = 'Background-' + Date.now().toString(36);
  await app.plugins.enableInternalPlugin('file-explorer'); await app.plugins.enableInternalPlugin('bookmarks'); await app.plugins.enableInternalPlugin('graph');
  const sourceFile = await app.vault.create(prefix + '-Source.md', '# source\n'), file = await app.vault.create(prefix + '-Target.md', '# target\n');
  const source = await app.workspace.openFile(sourceFile); app.workspace.setActiveLeaf(source, { focus: true });
  const explorer = app.workspace.getLeavesOfType('file-explorer')[0]?.view;
  check(!!explorer?.treeEl, '真实文件树已装载');
  const assertBackground = (background, label) => {
    check(app.workspace.activeLeaf === source, label + ' 保持命令目标为来源');
    check(source.parent.activeLeaf === source && source.parent.children[source.parent.currentTab] === source, label + ' 保持标签组当前项');
    check(visible(source), label + ' 来源文档实际可见');
    check(!visible(background) && getComputedStyle(background._leafEl).display === 'none', label + ' 新文档实际隐藏');
    check(app.workspace.getActiveFile() === sourceFile, label + ' 活动文件仍是来源');
  };
  try {
    app.settings.updateAppSettings({ focusNewTab: false }); explorer.render();
    const row = explorer.treeEl.querySelector('.nav-file-title[data-path="' + file.path + '"]'); check(!!row, '目标文件真实行存在');
    const before = new Set(centerLeaves()), openedEvents = [];
    const eventRef = app.workspace.on('file-open', file => openedEvents.push(file?.path));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true, ctrlKey: true }));
    await until(() => centerLeaves().some(leaf => !before.has(leaf) && leaf.view?.file === file), '等待Mod文件打开超时');
    const background = centerLeaves().find(leaf => !before.has(leaf));
    check(centerLeaves().length === before.size + 1, 'Mod文件仅创建一个标签');
    assertBackground(background, 'Mod文件');
    check(source.view.editor.getValue() === '# source\n' && background.view.editor.getValue() === '# target\n', '来源与后台正文均正确');
    check(!openedEvents.includes(file.path), '后台加载不通知活动文件订阅切换目标');
    const bookmarks = app.plugins.getInternalPlugin('bookmarks').instance;
    const graph = bookmarks.addItem({ type: 'graph', ctime: Date.now(), title: prefix + '-Graph', options: { showTags: true, linkDistance: 123 } });
    const beforeGraph = new Set(centerLeaves());
    await bookmarks.openItem(graph, { button: 0, metaKey: true, ctrlKey: true });
    const graphLeaf = centerLeaves().find(leaf => !beforeGraph.has(leaf));
    check(graphLeaf?.view?.getViewType() === 'graph', '后台关系图书签创建真实视图');
    assertBackground(graphLeaf, '关系图书签');
    check(graphLeaf.view.dataEngine.getOptions().linkDistance === 123, '后台关系图恢复书签配置');
    const inserted = app.workspace.createLeafInTabGroup(source.parent, 0, { active: false });
    await inserted.setViewState({ type: 'empty' });
    check(source.parent.activeLeaf === source && source.parent.currentTab === source.parent.children.indexOf(source), '前置后台插入不漂移当前项');
    check(visible(source) && !visible(inserted), '前置后台插入保持实际可见性');
    const priorCount = centerLeaves().length, priorDom = domCount();
    const reused = await app.workspace.openFile(file, { newLeaf: 'tab' });
    check(reused === background, '再次新标签打开已有文件复用目标');
    check(centerLeaves().length === priorCount && domCount() === priorDom, '查重不留下额外模型或空标签DOM');
    assertBackground(background, '后台查重');
    check(!openedEvents.includes(file.path), '后台查重不发送活动文件切换事件'); eventRef.unregister();
    const oldLeaves = new Set(centerLeaves()); app.commands.executeCommandById('workspace:new-tab');
    await until(() => centerLeaves().some(leaf => !oldLeaves.has(leaf) && leaf.view?.getViewType() === 'empty'), '等待新建标签命令超时');
    const empty = centerLeaves().find(leaf => !oldLeaves.has(leaf));
    check(app.workspace.activeLeaf === empty && empty.parent.activeLeaf === empty && visible(empty), '显式新建标签命令仍激活新页');
    app.workspace.setActiveLeaf(source, { focus: true });
    app.settings.updateAppSettings({ focusNewTab: true });
    const focused = await app.workspace.openFile(file, { newLeaf: 'always' });
    check(app.workspace.activeLeaf === focused && focused.parent.activeLeaf === focused && visible(focused), '开启聚焦新标签后正常激活目标');
    check(!visible(source), '前台打开后旧文档正确隐藏');
    return { pass: true, count: checks.length, checks };
  } finally { app.settings.updateAppSettings({ focusNewTab: originalFocus }); }
})()
