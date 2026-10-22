/**
 * [INPUT]: 文件树真实菜单、外观原生菜单开关、Electron Menu IPC 验收接口。
 * [OUTPUT]: 返回 {pass,count,checks}；验证真实原生菜单树、分节和动作回传。
 * [POS]: 原生菜单桥验收。E2E 构建系统菜单但不弹出，避免抢焦点。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const { ipcRenderer } = require('electron');
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label) => { for (let n = 0; n < 120; n++) { if (await predicate()) return; await wait(40); } throw Error(label); };
  const inspect = () => ipcRenderer.invoke('native-menu-test');
  const rightClick = element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 70, clientY: 120 }));
  const close = async () => { const menu = await inspect(); if (menu) ipcRenderer.send('native-menu-close', menu.token); await until(async () => !await inspect(), '关闭原生菜单'); };
  const file = await app.vault.create('Native menu.md', '# native\n');
  const folder = await app.vault.createFolder('Native folder');
  const title = () => document.querySelector('.nav-file-title[data-path="Native menu.md"]');
  await until(title, '文件树渲染原生菜单夹具');
  app.settings.updateAppearance({ nativeMenus: true }); window.__NATIVE_MENU_TEST__ = true;
  try {
    rightClick(title()); let menu;
    await until(async () => { menu = await inspect(); return !!menu; }, '原生菜单 IPC 就绪');
    check(menu.native === true, '主进程构建真实 Electron Menu');
    check(menu.popupSuppressed === true, 'E2E 不弹出系统菜单');
    check(!document.querySelector('body > .menu'), '启用原生菜单时不创建 DOM 菜单');
    check(menu.items.some(item => item.separator), '原生菜单保留分节');
    check(menu.items.some(item => item.label === '在新标签页中打开'), '原生菜单含文件打开动作');
    check(menu.items.some(item => item.label === '在新窗口中打开'), '原生菜单含独立窗口动作');
    const copyPath = menu.items.find(item => item.label === '复制路径');
    check(copyPath?.submenu?.length >= 2, '复制路径保留原生子菜单');
    check(copyPath.submenu.every(item => item.separator || typeof item.enabled === 'boolean'), '子菜单逐项携带可用状态');
    const copy = menu.items.findIndex(item => item.label === '创建副本');
    check(copy >= 0, '文件菜单含真实创建副本动作');
    const before = app.vault.getMarkdownFiles().length;
    await ipcRenderer.invoke('native-menu-test', { select: [copy] });
    await until(() => app.vault.getMarkdownFiles().length === before + 1, '系统菜单选择回传创建副本');
    check(app.workspace.getActiveFile()?.path !== file.path, '原生菜单副本动作打开新文件');
    check(await inspect() === null, '选中后清理主进程菜单状态');
    const folderTitle = () => document.querySelector('.nav-folder-title[data-path="Native folder"]');
    await until(folderTitle, '文件树显示目标文件夹'); rightClick(folderTitle());
    await until(async () => { menu = await inspect(); return !!menu; }, '文件夹原生菜单就绪');
    const database = menu.items.findIndex(item => item.label === '新建数据库');
    check(database >= 0, '数据库新建入口进入原生菜单');
    await ipcRenderer.invoke('native-menu-test', { select: [database] });
    await until(() => app.workspace.getActiveFile()?.extension === 'base', '原生菜单创建数据库');
    check(app.workspace.getActiveFile().parent.path === folder.path, '原生菜单数据库写入目标文件夹');
    rightClick(title()); await until(inspect, '取消菜单就绪'); await close();
    check(!title().classList.contains('has-active-menu'), '取消后解除触发项活动状态');
    app.workspace.getLeavesOfType('file-explorer')[0].view._sortBtn.click();
    await until(async () => { menu = await inspect(); return !!menu; }, '排序原生菜单就绪');
    const choices = menu.nativeItems.filter(item => item.type !== 'separator');
    check(choices.length === 6 && choices.every(item => item.type === 'checkbox'), '原生排序保留已选与未选复选项');
    check(choices.filter(item => item.checked).length === 1, '原生排序只有当前选项勾选');
    await close();
  } finally { window.__NATIVE_MENU_TEST__ = false; app.settings.updateAppearance({ nativeMenus: false }); }
  rightClick(title()); await wait(40);
  check(!!document.querySelector('body > .menu'), '停用原生菜单恢复主题 DOM 菜单');
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return { pass: true, count: checks.length, checks };
})();
