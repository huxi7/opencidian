/**
 * [INPUT]: 隔离库、真实数据库与关系图插件、用户排除设置。
 * [OUTPUT]: 返回 {pass,count,checks}；验证默认表格、排除规则与关系图书签。
 * [POS]: 全项目审计的核心插件回归。只由 --no-screenshot 运行器执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], failures = [];
  const check = (value, message) => { if (!value) failures.push(message); else checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async test => { for (let i = 0; i < 100; i++) { if (test()) return true; await wait(25); } return false; };
  const yaml = require('js-yaml');
  await app.plugins.enableInternalPlugin('bases');
  await app.plugins.enableInternalPlugin('graph');
  await app.plugins.enableInternalPlugin('bookmarks');
  const note = await app.vault.create('Audit visible.md', '---\nstatus: open\n---\nVisible\n');
  await app.vault.createFolder('Audit excluded');
  const hidden = await app.vault.create('Audit excluded/Hidden.md', '---\nstatus: open\n---\nHidden\n');
  await app.metadataCache.parseFile(note); await app.metadataCache.parseFile(hidden);
  for (const [name, source] of [
    ['Empty', ''], ['Missing', '# preserve me\nfuture: {token: keep}\nfilters: \'status == "open"\'\n'],
    ['No views', '# preserve me\nfuture: {token: keep}\nviews: []\n'],
  ]) {
    const file = await app.vault.create('Audit ' + name + '.base', source);
    const leaf = await app.workspace.openFile(file), controller = leaf.view.controller;
    check(controller?.view?.type === 'table', name + ' 自动提供默认表格');
    check(!!leaf.view.contentEl.querySelector('.bases-header'), name + ' 有真实工具栏');
    check(!!leaf.view.contentEl.querySelector('table'), name + ' 渲染真实表格');
    check(await app.vault.read(file) === source, name + ' 打开不改写原文');
    if (controller?.view) {
      await controller.patchView('limit', 1);
      const next = yaml.load(await app.vault.read(file));
      check(next.views?.[0]?.type === 'table' && next.views[0].limit === 1, name + ' 默认视图首次编辑写成合法 YAML');
      if (source) check(next.future?.token === 'keep' && (await app.vault.read(file)).startsWith('# preserve me'), name + ' 首次编辑保留未知键和注释');
    }
  }
  const source = 'filters: \'status == "open"\'\nviews:\n  - type: table\n    name: Audit\n';
  const file = await app.vault.create('Audit exclusions.base', source);
  const controller = (await app.workspace.openFile(file)).view.controller;
  check(controller.result.rows.some(row => row.file === hidden), '未配置排除时显示候选笔记');
  app.settings.updateAppSettings({ userIgnoreFilters: ['Audit excluded/'] });
  check(await until(() => !controller.result.rows.some(row => row.file === hidden)), '排除设置变化自动更新已打开数据库');
  check(controller.result.rows.some(row => row.file === note), '路径排除保留其它笔记');
  app.settings.updateAppSettings({ userIgnoreFilters: ['/AUDIT VISIBLE\\.md$/', '/[/'] });
  await controller.refresh();
  check(!controller.result.rows.some(row => row.file === note) && controller.result.rows.some(row => row.file === hidden), '正则排除忽略大小写且坏正则不破坏查询');
  app.settings.updateAppSettings({ userIgnoreFilters: null }); await controller.refresh();
  check(controller.result.rows.some(row => row.file === note) && controller.result.rows.some(row => row.file === hidden), '移除排除规则恢复笔记');
  check(await app.vault.read(file) === source, '排除规则不改写数据库配置');
  const settingsCallback = controller.settingsRef?.callback;
  check(!!settingsCallback && app.workspace._events['settings-changed'].includes(settingsCallback), '数据库持有真实排除设置订阅');
  await app.plugins.disableInternalPlugin('bases');
  check(controller.settingsRef === null && !app.workspace._events['settings-changed'].includes(settingsCallback) && controller.refs.length === 0 && !controller.enabled, '停用数据库释放真实设置与数据订阅');
  app.settings.updateAppSettings({ userIgnoreFilters: ['Audit excluded/'] });
  await app.plugins.enableInternalPlugin('bases'); await controller.ready;
  check(!!controller.settingsRef && !controller.result.rows.some(row => row.file === hidden), '重新启用数据库读取最新排除设置');
  app.settings.updateAppSettings({ userIgnoreFilters: null }); await controller.refresh();
  const bookmarks = app.plugins.getInternalPlugin('bookmarks').instance;
  const options = { search: 'path:"Audit visible"', showTags: true, showOrphans: false, showArrow: true, linkDistance: 123, scale: 0.8, close: false };
  const item = bookmarks.addItem({ type: 'graph', ctime: Date.now(), title: 'Audit saved graph', options });
  await bookmarks.openBookmarksPane();
  const bookmarkView = app.workspace.getLeavesOfType('bookmarks')[0].view;
  await until(() => [...bookmarkView.contentEl.querySelectorAll('.bookmark')].some(row => row.textContent.includes(item.title)));
  const row = [...bookmarkView.contentEl.querySelectorAll('.bookmark')].find(row => row.textContent.includes(item.title));
  check(!!row, '原版关系图书签显示真实入口'); row?.click();
  check(await until(() => app.workspace.activeLeaf?.view?.getViewType() === 'graph'), '点击书签真正打开关系图');
  const view = app.workspace.activeLeaf?.view;
  check(controller.closed && controller.settingsRef === null, '切走数据库释放排除设置订阅');
  if (view?.getViewType() === 'graph') {
    const restored = view.dataEngine.getOptions();
    for (const key of ['search', 'showTags', 'showOrphans', 'showArrow', 'linkDistance', 'close']) check(restored[key] === options[key], '关系图书签恢复选项 ' + key);
    check(JSON.stringify(item.options) === JSON.stringify(options), '打开关系图不污染书签快照');
    view.dataEngine.setOptions({ ...restored, showTags: false });
    check(item.options.showTags === true, '活动关系图变化不修改已有书签');
    check(bookmarks.bookmarkCurrentView(view), '当前关系图支持收藏');
    const saved = bookmarks.items.at(-1);
    check(saved.type === 'graph' && saved.options.showTags === false, '新关系图书签保存当前选项');
    view.dataEngine.setOptions({ ...restored, showTags: true });
    check(saved.options.showTags === false, '新关系图书签与活动选项隔离');
    check(app.settings.readJson('bookmarks.json').items.some(entry => entry.type === 'graph' && entry.options?.linkDistance === 123), '关系图选项真正写入书签文件');
  }
  const fileItem = bookmarks.addItem({ type: 'file', ctime: Date.now() + 1, title: 'Audit file destination', path: note.path });
  const rowFor = async title => {
    await until(() => [...bookmarkView.contentEl.querySelectorAll('.bookmark')].some(row => row.textContent.includes(title)));
    return [...bookmarkView.contentEl.querySelectorAll('.bookmark')].find(row => row.textContent.includes(title));
  };
  const leaves = () => [...app.workspace._leafMap.values()].filter(leaf => app.workspace._sideOf(leaf) === 'center' && !leaf._closed);
  const originalFocus = app.settings.appSettings.focusNewTab;
  app.settings.updateAppSettings({ focusNewTab: true });
  for (const [target, type] of [[item, 'graph'], [fileItem, 'markdown']]) {
    for (const [label, event] of [
      ['Mod', new MouseEvent('click', { button: 0, metaKey: true, ctrlKey: true, bubbles: true })],
      ['中键', new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })],
    ]) {
      const before = new Set(leaves()), sourceLeaf = app.workspace.activeLeaf, previousType = sourceLeaf.view.getViewType();
      (await rowFor(target.title)).dispatchEvent(event);
      await until(() => leaves().length > before.size); await wait(100);
      const created = leaves().filter(leaf => !before.has(leaf));
      check(created.length === 1, type + ' 书签 ' + label + ' 只新建一个真实标签');
      const destination = created[0];
      check(destination?.view?.getViewType() === type, type + ' 书签 ' + label + ' 目标视图可用');
      check(sourceLeaf.view.getViewType() === previousType && !sourceLeaf._closed, type + ' 书签 ' + label + ' 保留来源');
      if (destination) {
        check(app.workspace.activeLeaf === destination, type + ' 书签 ' + label + ' 聚焦新标签');
        check(type === 'graph' ? destination.view.dataEngine.getOptions().linkDistance === 123 : destination.view.file === note, type + ' 书签 ' + label + ' 恢复目标状态');
      }
    }
  }
  const before = leaves().length;
  (await rowFor(fileItem.title)).click(); await wait(150);
  check(leaves().length === before && app.workspace.getActiveFile() === note, '普通书签点击复用当前标签');
  app.settings.updateAppSettings({ focusNewTab: false });
  const active = app.workspace.activeLeaf, existing = new Set(leaves()), originalTab = active.parent.currentTab;
  (await rowFor(item.title)).dispatchEvent(new MouseEvent('click', { button: 0, metaKey: true, ctrlKey: true, bubbles: true }));
  await until(() => leaves().length > existing.size); await wait(100);
  check(app.workspace.activeLeaf === active && leaves().filter(leaf => !existing.has(leaf))[0]?.view?.getViewType() === 'graph', '关闭新标签聚焦时书签在后台恢复关系图');
  check(active.parent.currentTab === originalTab && active.parent.activeLeaf === active, '后台书签保持来源标签组的当前标签');
  check(!!active._leafEl && active._leafEl.getBoundingClientRect().width > 0 && active._leafEl.getBoundingClientRect().height > 0 && getComputedStyle(active._leafEl).display !== 'none', '后台书签保持来源笔记真实可见');
  const background = leaves().find(leaf => !existing.has(leaf));
  check(!!background?._leafEl && getComputedStyle(background._leafEl).display === 'none', '后台关系图标签未替换当前可见内容');
  app.settings.updateAppSettings({ focusNewTab: originalFocus });
  if (failures.length) throw Error(JSON.stringify({ checks, failures }));
  return { pass: true, count: checks.length, checks };
})()
