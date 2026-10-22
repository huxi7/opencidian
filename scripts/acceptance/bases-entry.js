/**
 * [INPUT]: 隔离库、核心插件设置、功能区、空标签与文件树真实入口。
 * [OUTPUT]: 返回 {pass,count,checks}，核对可见新建、真实落盘与重开。
 * [POS]: Bases 入口回归。禁止用直接调用插件方法代替用户点击。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label) => { for (let n = 0; n < 160; n++) { if (predicate()) return; await wait(25); } throw Error(label); };
  const ribbon = () => app.workspace.ribbonActionsEl.querySelectorAll('[data-command-id="bases:new-file"]');
  const isBases = () => app.workspace.activeLeaf?.view.getViewType() === 'bases';
  const visible = element => !!element && element.isConnected && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0;
  check(app.plugins.getInternalPlugin('bases')?.enabled, '数据库默认启用');
  check(ribbon().length === 1 && visible(ribbon()[0]), '启动即显示唯一数据库功能区入口');
  check(!!ribbon()[0].querySelector('svg.lucide-layout-list path'), '数据库按钮有原版布局列表图标');
  check(ribbon()[0].getAttribute('aria-label') === '新建数据库', '数据库功能区提示可辨识');
  if (process.env.OBS_NOTES_STAGE === 'restart') {
    const file = app.vault.getFiles().find(file => file.path.startsWith('Entry Folder/') && file.extension === 'base');
    check(!!file, '重启保留通过菜单创建的数据库');
    await app.workspace.openFile(file);
    check(isBases() && !!app.workspace.activeLeaf.view.contentEl.querySelector('.bases-table'), '重启能重开真实数据库');
    return { pass: true, count: checks.length, checks };
  }
  await app.vault.create('Entry note.md', '# entry\n');
  const before = app.vault.getFiles().filter(file => file.extension === 'base').length;
  ribbon()[0].click(); await until(isBases, '点击功能区打开数据库');
  const created = app.workspace.getActiveFile();
  check(created.extension === 'base', '功能区创建真实 base 文件');
  check(app.vault.getFiles().filter(file => file.extension === 'base').length === before + 1, '一次点击只创建一个数据库');
  check(!!app.workspace.activeLeaf.view.contentEl.querySelector('.bases-table'), '功能区打开后显示表格');
  check(app.workspace.activeLeaf.view.controller.result.rows.some(row => row.file.path === 'Entry note.md'), '新数据库显示库内真实笔记');
  const firstLeaf = app.workspace.activeLeaf;
  ribbon()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }));
  await until(() => isBases() && app.workspace.activeLeaf !== firstLeaf, 'Mod 点击创建新数据库标签');
  check(app.workspace.getActiveFile().path !== created.path, 'Mod 点击创建独立文件且不覆盖旧库');

  const empty = app.workspace.getLeaf(true); await empty.setViewState({ type: 'empty', state: {} });
  const emptyButton = () => empty.view.contentEl.querySelector('[data-command-id="bases:new-file"]');
  check(visible(emptyButton()), '空标签显示新建数据库动作');
  const actions = [...empty.view.contentEl.querySelectorAll('.empty-state-action')].map(node => node.dataset.commandId);
  check(actions.indexOf('bases:new-file') === actions.indexOf('file-explorer:new-file') + 1, '空标签数据库动作紧随新建笔记');
  await app.plugins.disableInternalPlugin('bases');
  check(ribbon().length === 0 && !emptyButton(), '停用立即撤销功能区和空标签入口');
  check(!app.commands.findCommand('bases:new-file'), '停用撤销新建命令');
  await app.plugins.enableInternalPlugin('bases');
  check(ribbon().length === 1 && visible(emptyButton()), '启用立即恢复功能区和现有空标签入口');
  await app.plugins.enableInternalPlugin('bases');
  check(ribbon().length === 1, '重复启用不重复登记图标');
  emptyButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(isBases, '空标签键盘入口创建并打开数据库');
  check(app.workspace.getActiveFile().extension === 'base', '空标签创建真实数据库文件');

  const folder = await app.vault.createFolder('Entry Folder');
  const title = () => document.querySelector('.nav-folder-title[data-path="Entry Folder"]');
  await until(() => title(), '文件树显示新建文件夹');
  const contextMenu = element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 80, clientY: 120 }));
  const closeMenu = async () => { await wait(20); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(20); };
  const menuItem = () => [...document.querySelectorAll('body > .menu .menu-item')].find(node => node.querySelector('.menu-item-title')?.textContent === '新建数据库');
  contextMenu(title());
  check(!!menuItem()?.querySelector('svg.lucide-layout-list'), '文件夹菜单显示数据库图标与动作');
  menuItem().click();
  await until(() => isBases() && app.workspace.getActiveFile()?.parent.path === folder.path, '文件夹菜单在目标文件夹创建并打开数据库');
  const folderFile = app.workspace.getActiveFile();
  check(await app.vault.adapter.exists(folderFile.path), '文件夹数据库真实落盘');
  const fileTitle = () => document.querySelector('.nav-file-title[data-path="' + folderFile.path + '"]');
  await until(fileTitle, '新数据库出现在文件树');
  check(fileTitle().querySelector('.nav-file-tag')?.textContent === 'base', '文件树显示 base 文件类型');
  await app.workspace.openFile(app.vault.getFileByPath('Entry note.md'));
  fileTitle().click(); await until(isBases, '直接点击文件树重开数据库');
  check(app.workspace.getActiveFile().path === folderFile.path, '文件树打开正确数据库而非新建副本');
  contextMenu(document.querySelector('.nav-files-container'));
  check(!!menuItem(), '文件树空白区也有新建数据库入口');
  await closeMenu();
  await app.plugins.disableInternalPlugin('bases'); contextMenu(title());
  check(!menuItem(), '停用撤销文件夹数据库菜单');
  await closeMenu();
  await app.plugins.enableInternalPlugin('bases'); contextMenu(title());
  check([...document.querySelectorAll('body > .menu .menu-item-title')].filter(node => node.textContent === '新建数据库').length === 1, '再启用文件夹菜单不重复');
  await closeMenu();
  return { pass: true, count: checks.length, checks };
})();
