/**
 * [INPUT]: 隔离临时库、真实 Electron、backlink 设置页与原生窗口状态 IPC。
 * [OUTPUT]: 返回 {pass, count, checks}，失败抛出具体断言。
 * [POS]: 1.14.4 小缺口验收。锁定底部反链、库根 CSS 热更新、文件菜单默认应用通道与 vibrancy。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs'), path = require('path');
  const { ipcRenderer } = require('electron');
  const checks = [];
  const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (fn, name) => {
    for (let i = 0; i < 80; i++) { if (fn()) { check(true, name); return; } await wait(50); }
    throw Error(name);
  };
  const base = app.vault.adapter.getBasePath();
  check(/obs-copy-acceptance/.test(base), '只操作临时验收库');
  app.settings.updateAppSettings({ settingsPopoutWindow: false });
  await app.plugins.enableInternalPlugin('backlink');
  app.setting.open();
  check(app.setting.pluginTabs.some((tab) => tab.id === 'backlink'), '打开设置即登记反链页签');
  app.setting.openPluginOptions('backlink');
  const tab = app.setting.activeTab;
  check(tab?.id === 'backlink', '反链核心插件设置页可打开');
  const toggle = tab.containerEl.querySelector('.checkbox-container');
  check(!!toggle && !toggle.classList.contains('is-enabled'), '文档反链默认关闭');
  toggle.click();
  check(app.workspace.backlinkInDocument === true, '设置页开启后续笔记默认反链');
  check(JSON.parse(fs.readFileSync(path.join(base, '.obsidian/backlink.json'))).backlinkInDocument === true, '默认反链开关落盘');
  app.setting.close();
  const target = await app.vault.create('Gap Target.md', '# Target\n\n正文\n');
  const other = await app.vault.create('Gap Other.md', '# Other\n');
  const source = await app.vault.create('Gap Source.md', '一条 [[Gap Target]] 引用\n');
  for (const file of [target, other, source]) await app.metadataCache.parseFile(file);
  app.metadataCache.rebuildIndices();
  const leaf = await app.workspace.openFile(target, { newLeaf: 'tab' });
  const view = leaf.view;
  await leaf.setViewState({ type: 'markdown', state: { file: target.path, mode: 'preview' } });
  check(view.showBacklinks === true, '新笔记沿用全局反链默认值');
  check(view.backlinksEl.parentElement === view.readingContent, '阅读反链挂正文底部');
  check(getComputedStyle(view.backlinksEl).display !== 'none', '阅读反链可见');
  check(!!view.backlinksEl.querySelector('[data-path="Gap Source.md"]'), '阅读反链呈现真实引用来源');
  check(view.backlinksEl.textContent.includes('一条'), '反链呈现链接所在正文');
  check(view.getState().backlinks === true, '文档反链状态进入布局');
  view.mode = 'live'; view._applyMode();
  check(view.backlinksEl.parentElement === view.editor.sizerEl, '实时预览反链挂编辑器滚动内容底部');
  check(getComputedStyle(view.backlinksEl).display !== 'none', '实时预览反链可见');
  const otherLeaf = await app.workspace.openFile(other, { newLeaf: 'tab' });
  check(view.backlinks._getFile() === target, '分屏反链绑定所属文件，不跟活动标签漂移');
  app.workspace.setActiveLeaf(leaf, { focus: false });
  app.commands.executeCommandById('backlink:toggle-backlinks-in-document');
  check(view.showBacklinks === false && !view.backlinks, '命令关闭文档反链并销毁监听');
  check(view.getState().backlinks === false, '关闭状态可持久化');
  app.commands.executeCommandById('backlink:toggle-backlinks-in-document');
  check(view.showBacklinks === true && !!view.backlinks, '命令恢复文档反链');
  await leaf.setViewState({ type: 'markdown', state: { file: target.path, mode: 'preview', backlinks: false } });
  check(!view.showBacklinks && !view.backlinks, '恢复布局明确 false 覆盖全局默认');
  view.toggleBacklinks();
  await app.vault.modify(source, '修改 [[Gap Target]] 引用\n第二条 [[Gap Target]]\n');
  await app.metadataCache.parseFile(source); app.metadataCache.rebuildIndices();
  await until(() => view.backlinksEl.textContent.includes('修改'), '编辑来源后反链热更新');
  const cssFile = path.join(base, 'obsidian.css');
  fs.writeFileSync(cssFile, 'body { --gap-acceptance: first; }');
  await until(() => getComputedStyle(document.body).getPropertyValue('--gap-acceptance').trim() === 'first', '新建库根 CSS 自动应用');
  fs.writeFileSync(cssFile, 'body { --gap-acceptance: second; }');
  await until(() => getComputedStyle(document.body).getPropertyValue('--gap-acceptance').trim() === 'second', '修改库根 CSS 热更新');
  app.setting.open(); app.setting.openTabById('appearance');
  const root = app.setting.activeTab.containerEl;
  const row = [...root.querySelectorAll('.setting-item')].find((el) => /自定义 CSS|Custom CSS/.test(el.querySelector('.setting-item-name')?.textContent));
  check(!!row, '外观页提供库根 CSS 开关');
  row.querySelector('.checkbox-container').click();
  check(app.settings.appearance.customCss === false, 'CSS 停用写入偏好');
  check(!document.getElementById('opensidian-vault-css'), '停用真实移除 CSS');
  row.querySelector('.checkbox-container').click();
  check(app.settings.appearance.customCss === true && !!document.getElementById('opensidian-vault-css'), '重新启用恢复 CSS');
  check(JSON.parse(fs.readFileSync(path.join(base, '.obsidian/appearance.json'))).customCss === true, 'CSS 开关落盘');
  const appearancePath = path.join(base, '.obsidian/appearance.json');
  const persisted = JSON.parse(fs.readFileSync(appearancePath));
  fs.writeFileSync(appearancePath, JSON.stringify({ ...persisted, customCss: false }));
  await until(() => app.settings.appearance.customCss === false && !document.getElementById('opensidian-vault-css'), '设置独立窗口外观写盘同步主窗');
  fs.writeFileSync(appearancePath, JSON.stringify(persisted));
  await until(() => app.settings.appearance.customCss === true && !!document.getElementById('opensidian-vault-css'), '跨窗口外观重新启用同步');
  const backlinkPath = path.join(base, '.obsidian/backlink.json');
  fs.writeFileSync(backlinkPath, JSON.stringify({ backlinkInDocument: false }));
  await until(() => app.workspace.backlinkInDocument === false, '设置独立窗口反链默认值同步主窗');
  check(view.showBacklinks === true, '修改全局默认值保留当前标签独立反链状态');
  fs.unlinkSync(cssFile);
  await until(() => !document.getElementById('opensidian-vault-css'), '删除 CSS 自动卸载');
  if (process.platform === 'darwin') {
    const translucency = [...root.querySelectorAll('.setting-item')].find((el) => /半透明效果|Translucent/.test(el.querySelector('.setting-item-name')?.textContent));
    check(!!translucency, 'macOS 显示半透明开关');
    translucency.querySelector('.checkbox-container').click();
    await wait(100);
    check(app.settings.appearance.translucency === true, '半透明偏好开启');
    check(document.body.classList.contains('is-translucent'), '使用原版 is-translucent class');
    check(ipcRenderer.sendSync('window-state').vibrancy === 'sidebar', '主进程成功向 BrowserWindow 下发 sidebar vibrancy');
    check(JSON.parse(fs.readFileSync(path.join(base, '.obsidian/appearance.json'))).translucency === true, '半透明偏好落盘');
    translucency.querySelector('.checkbox-container').click(); await wait(100);
    check(ipcRenderer.sendSync('window-state').vibrancy === null, '关闭时成功向 BrowserWindow 清除 vibrancy');
    check(!document.body.classList.contains('is-translucent'), '关闭时清除半透明 class');
  }
  app.setting.close();
  app.workspace.setActiveLeaf(leaf, { focus: false });
  view._fillViewActions();
  check(!leaf._viewActionsEl.querySelector('.mod-open-default-app'), '视图头不添加默认应用打开动作');
  const sent = [], send = ipcRenderer.send;
  ipcRenderer.send = function(channel, ...args) { if (channel === 'open-path') sent.push(args[0]); else return send.call(this, channel, ...args); };
  try {
    const menu = app.workspace.buildLinkMenu();
    app.workspace.trigger('file-menu', menu, target, 'file-explorer', leaf);
    const item = menu.items.find((i) => /使用默认应用打开|Open in default app/.test(i.title));
    check(!!item, '文件菜单提供默认应用动作');
    item.callback();
    check(sent[0] === path.join(base, target.path), '文件菜单默认打开同一路径通道');
    for (const [name, source] of [['Default App.canvas', '{"nodes":[],"edges":[]}'], ['Default App.base', 'views:\n  - type: table\n    name: Table\n']]) {
      const file = await app.vault.create(name, source);
      const fileLeaf = await app.workspace.openFile(file, { newLeaf: 'tab' });
      check(!fileLeaf._viewActionsEl.querySelector('.mod-open-default-app'), name + ' 文件视图头不添加默认应用动作');
      const fileMenu = app.workspace.buildLinkMenu();
      app.workspace.trigger('file-menu', fileMenu, file, 'file-explorer', fileLeaf);
      const action = fileMenu.items.find((item) => /使用默认应用打开|Open in default app/.test(item.title));
      check(!!action, name + ' 文件菜单保留默认应用动作');
      action.callback();
      check(sent.at(-1) === path.join(base, name), name + ' 文件菜单传入对应绝对路径');
      await fileLeaf.detach();
    }
  } finally { ipcRenderer.send = send; }
  await app.plugins.disableInternalPlugin('backlink');
  check(!view.backlinks && !view.showBacklinks, '禁用插件撤销文档反链');
  check(!document.querySelector('.plugin-backlink'), '禁用插件移除反链状态栏');
  await otherLeaf.detach();
  return { pass: true, count: checks.length, checks };
})()
