/**
 * [INPUT]: 临时 vault、核心插件宿主、功能区按钮和命令入口。
 * [OUTPUT]: 启停、重启、点击路由与键盘激活的逻辑断言。
 * [POS]: 功能区入口回归。通过 --no-screenshot 执行，不做视觉验收。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const until = async (predicate, label) => {
    for (let n = 0; n < 120; n++) { if (predicate()) { checks.push(label); return; } await wait(25); }
    throw new Error(label);
  };
  const entries = [
    ['graph', 'graph:open', 'lucide-git-fork'],
    ['canvas', 'canvas:new-file', 'lucide-layout-dashboard'],
    ['command-palette', 'command-palette:open', 'lucide-terminal'],
    ['switcher', 'switcher:open', 'lucide-file-search'],
    ['templates', 'insert-template', 'lucide-files'],
  ];
  const buttons = command => app.workspace.ribbonActionsEl.querySelectorAll(`[data-command-id="${command}"]`);
  const phase = process.env.OBS_NOTES_STAGE || 'run';
  if (phase === 'restart') {
    for (const [plugin, command] of entries) {
      check(app.plugins.getInternalPlugin(plugin).enabled, plugin + ' 启用配置保留');
      check(buttons(command).length === 1, plugin + ' 重启恢复唯一功能区入口');
    }
    return { pass: true, checks };
  }
  check(buttons('graph:open').length === 1, '默认启用的图谱启动即注册入口');
  for (const [plugin, command, icon] of entries) {
    await app.plugins.enableInternalPlugin(plugin);
    check(buttons(command).length === 1, plugin + ' 启用时注册唯一按钮');
    check(buttons(command)[0].querySelector('svg.' + icon), plugin + ' 使用原版图标');
    check(buttons(command)[0].getAttribute('role') === 'button', plugin + ' 提供按钮语义');
    await app.plugins.enableInternalPlugin(plugin);
    check(buttons(command).length === 1, plugin + ' 重复启用不增加入口');
    await app.plugins.disableInternalPlugin(plugin);
    check(buttons(command).length === 0, plugin + ' 禁用立即移除按钮');
    check(!app.commands.findCommand(command), plugin + ' 禁用撤销命令');
    await app.plugins.enableInternalPlugin(plugin);
    check(buttons(command).length === 1, plugin + ' 再启用恢复唯一入口');
  }

  // 通过核心插件设置开关启停，覆盖用户实际入口。
  app.setting.open(); app.setting.openTabById('plugins');
  const graphRow = () => [...app.setting.activeTab.containerEl.querySelectorAll('.setting-item')]
    .find(row => row.querySelector('.setting-item-name')?.textContent === app.plugins.getInternalPlugin('graph').manifest.name);
  graphRow().querySelector('.checkbox-container').click();
  await until(() => !app.plugins.getInternalPlugin('graph').enabled && buttons('graph:open').length === 0,
    '设置开关关闭后功能区同步移除');
  await wait(50);
  graphRow().querySelector('.checkbox-container').click();
  await until(() => app.plugins.getInternalPlugin('graph').enabled && buttons('graph:open').length === 1,
    '设置开关启用后功能区同步出现');
  app.setting.close(); await wait(170);

  const note = await app.vault.create('Ribbon.md', '# 功能区验收\n');
  await app.workspace.openFile(note);
  const original = app.workspace.activeLeaf;
  await app.workspace.ensureSideLeaf('search', 'left', { reveal: true });
  buttons('graph:open')[0].click();
  await until(() => app.workspace.activeLeaf?.view.getViewType() === 'graph', '点击图谱按钮打开并聚焦关系图谱');
  check(app.workspace.activeLeaf === original && app.workspace._sideOf(original) === 'center', '普通点击复用中心标签');
  await app.workspace.openFile(note);
  buttons('graph:open')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
  await until(() => app.workspace.activeLeaf !== original && app.workspace.activeLeaf?.view.getViewType() === 'graph',
    'Mod 点击新建图谱标签并聚焦');
  await app.workspace.openFile(note);
  buttons('graph:open')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => app.workspace.activeLeaf?.view.getViewType() === 'graph', '键盘 Enter 激活图谱入口');

  buttons('switcher:open')[0].click();
  check(document.querySelector('.prompt.mod-quick-switcher:not(.is-hidden)'), '快速切换按钮打开已有选择器');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(170);
  buttons('command-palette:open')[0].click();
  check(document.querySelector('.prompt.mod-command-palette:not(.is-hidden)'), '命令按钮打开已有命令面板');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(170);

  await app.workspace.openFile(note);
  const templateFolder = await app.vault.createFolder('Ribbon Templates');
  await app.vault.create(templateFolder.path + '/test.md', '模板正文');
  app.settings.savePluginData('templates.json', { folder: templateFolder.path });
  buttons('insert-template')[0].click();
  await until(() => [...document.querySelectorAll('.prompt:not(.is-hidden)')].some(el => el.textContent.includes('test')), '模板按钮打开模板选择器');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(170);
  buttons('canvas:new-file')[0].click();
  await until(() => app.workspace.activeLeaf?.view.getViewType() === 'canvas', '白板按钮创建并打开画布');
  check(app.workspace._sideOf(app.workspace.activeLeaf) === 'center', '白板在中心打开');
  await app.saveLayout();
  return { pass: true, checks };
})()
