/**
 * [INPUT]: 隔离临时库、文件视图、真实 Electron 与受保护的外部打开 IPC。
 * [OUTPUT]: 返回 {pass,count,checks}；失败抛出具体断言。
 * [POS]: 视图动作契约验收。覆盖七类文件头、原生按钮、更多菜单事件链与模式目标状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { ipcRenderer } = require('electron');
  const checks = [], workspace = app.workspace;
  const check = (value, text) => { if (!value) throw Error(text); checks.push(text); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, text) => {
    for (let i = 0; i < 100; i++) { if (fn()) { check(true, text); return; } await wait(30); }
    throw Error(text);
  };
  const base = app.vault.adapter.getBasePath();
  check(base.includes('obs-copy-acceptance'), '只使用隔离验收库');
  await app.plugins.enableInternalPlugin('canvas');
  await app.plugins.enableInternalPlugin('bases');
  await app.plugins.disableInternalPlugin('bookmarks');
  app.settings.updateAppearance({ nativeMenus: false });
  const events = [], sent = [], refs = [];
  refs.push(workspace.on('file-menu', (menu, file, source, leaf) => events.push({ kind: 'file', menu, file, source, leaf })));
  refs.push(workspace.on('leaf-menu', (menu, leaf) => events.push({ kind: 'leaf', menu, leaf })));
  const send = ipcRenderer.send;
  ipcRenderer.send = function(channel, ...args) {
    if (channel === 'open-path') sent.push(args[0]);
    else return send.call(this, channel, ...args);
  };
  const opened = [];
  let markdownLeaf;
  const closeMenu = async () => {
    for (const menu of document.querySelectorAll('body > .menu')) menu.__menu?.close();
    await wait(10);
  };
  try {
    for (const [name, content, type] of [
      ['Actions.md', '# Actions\n', 'markdown'],
      ['Actions.canvas', '{"nodes":[],"edges":[]}', 'canvas'],
      ['Actions.base', 'views:\n  - type: table\n    name: Table\n', 'bases'],
      ['Actions.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', 'image'],
      ['Actions.wav', 'RIFF0000WAVE', 'audio'],
      ['Actions.mp4', '', 'video'],
      ['Actions.pdf', '%PDF-1.4\n%%EOF', 'pdf'],
    ]) {
      const file = await app.vault.create(name, content);
      const leaf = await workspace.openFile(file, { newLeaf: 'always' }); opened.push(leaf);
      if (type === 'markdown') markdownLeaf = leaf;
      const actions = leaf._viewActionsEl;
      check(leaf.view.getViewType() === type, name + ' 分派正确文件视图');
      check(!actions.querySelector('.mod-open-default-app'), name + ' 没有额外默认应用头按钮');
      check(actions.querySelectorAll('.view-action').length === (type === 'markdown' ? 2 : 1), name + ' 未启用书签时动作区仅含模式钮与更多钮');
      const more = actions.querySelector('.mod-more-options');
      check(more?.tagName === 'BUTTON' && more.type === 'button' && more.tabIndex === 0, name + ' 更多钮使用可键盘聚焦的原生button');
      check(!!more.querySelector('svg.lucide-more-vertical'), name + ' 更多钮使用竖三点');
      more.focus();
      check(document.activeElement === more, name + ' 更多钮可获得键盘焦点');
      events.length = 0;
      more.click();
      const menu = document.querySelector('body > .menu')?.__menu;
      check(!!menu && more.classList.contains('has-active-menu'), name + ' 更多菜单锚定按钮');
      check(events.length === 2 && events[0].kind === 'file' && events[1].kind === 'leaf', name + ' 文件事件先于叶子事件且各触发一次');
      check(events.every(event => event.menu === menu && event.leaf === leaf) && events[0].file === file && events[0].source === 'more-options', name + ' 扩展事件绑定当前文件与叶子');
      const titles = menu.items.map(item => item.title);
      check(titles.includes('重命名') && titles.includes('删除文件'), name + ' 文件面板含真实重命名与删除动作');
      check(titles.includes('左右分屏') && titles.includes('上下分屏'), name + ' 面板含拆分动作');
      const defaultApp = menu.items.find(item => item.title === '使用默认应用打开');
      check(!!defaultApp, name + ' 文件菜单保留原版默认应用项');
      defaultApp.callback();
      check(sent.at(-1) === path.join(base, file.path), name + ' 默认应用菜单走受保护绝对路径IPC');
      if (type === 'markdown') check(titles.includes('阅读视图') && titles.includes('增加笔记属性') && titles.includes('查找…'), 'Markdown更多菜单沿用视图扩展项');
      if (type === 'canvas') check(titles.includes('导出图片'), '画布更多菜单追加导出项');
      more.click();
      check(events.length === 2, name + ' 已打开菜单不重复触发事件');
      menu.close();
      check(!more.classList.contains('has-active-menu'), name + ' 关闭菜单清除按钮活动状态');
    }
    workspace.setActiveLeaf(markdownLeaf, { focus: false });
    const view = markdownLeaf.view;
    await markdownLeaf.setViewState({ type: 'markdown', state: { file: view.file.path, mode: 'live' } });
    view.editor.focus();
    const focused = document.activeElement;
    let toggle = markdownLeaf._viewActionsEl.querySelector('.mod-switch-view');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    toggle.dispatchEvent(down);
    check(down.defaultPrevented && document.activeElement === focused, '模式钮鼠标按下不抢编辑焦点');
    check(toggle.tagName === 'BUTTON' && toggle.type === 'button', '模式钮使用原生button');
    toggle.focus(); toggle.click();
    await until(() => view.mode === 'preview', '模式钮键盘等价click切到阅读');
    await wait(60);
    check(document.activeElement === markdownLeaf._viewActionsEl.querySelector('.mod-switch-view'), '模式切换重绘后保留按钮焦点');
    for (const eventType of ['click', 'auxclick']) {
      const before = workspace.getLeavesOfType('markdown').length;
      toggle = markdownLeaf._viewActionsEl.querySelector('.mod-switch-view');
      toggle.dispatchEvent(new MouseEvent(eventType, {
        bubbles: true, cancelable: true, button: eventType === 'auxclick' ? 1 : 0,
        metaKey: eventType === 'click' && navigator.platform.startsWith('Mac'),
        ctrlKey: eventType === 'click' && !navigator.platform.startsWith('Mac'),
      }));
      await until(() => workspace.activeLeaf !== markdownLeaf && workspace.activeLeaf.view?.getViewType() === 'markdown', eventType + ' 创建目标Markdown叶子');
      const target = workspace.activeLeaf;
      check(workspace.getLeavesOfType('markdown').length === before + 1 && target.parent !== markdownLeaf.parent, eventType + ' 精确创建一个右侧叶子');
      check(target.view.file === view.file && target.view.mode === 'live' && view.mode === 'preview', eventType + ' 目标切编辑模式且来源保持阅读');
      check(fs.readFileSync(path.join(base, view.file.path), 'utf8') === '# Actions\n', eventType + ' 模式操作不改笔记内容');
      await target.detach(); workspace.setActiveLeaf(markdownLeaf, { focus: false });
    }
    await markdownLeaf.setViewState({ type: 'markdown', state: { file: view.file.path, mode: 'source' } });
    await view.onSwitchView(new MouseEvent('click', { metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac') }));
    const sourcePreview = workspace.activeLeaf;
    check(sourcePreview !== markdownLeaf && view.mode === 'source' && sourcePreview.view.mode === 'preview', '源码Mod点击创建阅读副本并保持来源源码模式');
    check(sourcePreview.view.getState().source === true, '阅读副本状态保留源码偏好');
    await sourcePreview.view.onSwitchView(new MouseEvent('click'));
    check(sourcePreview.view.mode === 'source', '阅读副本切回原源码模式');
    await sourcePreview.detach(); workspace.setActiveLeaf(markdownLeaf, { focus: false });
    check(!document.querySelector('.mod-open-default-app'), '所有文件视图均无默认应用头按钮残留');
  } finally {
    await closeMenu(); ipcRenderer.send = send;
    for (const ref of refs) ref.unregister();
    for (const leaf of opened.reverse()) await leaf.detach();
  }
  return { pass: true, count: checks.length, checks };
})()
