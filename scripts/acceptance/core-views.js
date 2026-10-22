/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks} 断言回执；失败抛出异常。
 * [POS]: core-views 场景。覆盖 outgoing-link 与 properties 两个核心插件：
 *        出链列表/未解析样式/空态、全部属性排序、文件属性跟随、状态栏计数与禁停恢复。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * 在 OpenSidian 的 OBS_ACT eval 中执行。只允许临时 vault。
 * 报告写到 /tmp/obs-copy-acceptance/core-views-report.json。
 */
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const checks = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const until = async (predicate, name) => {
    for (let i = 0; i < 60; i++) {
      if (predicate()) { checks.push(name); return; }
      await wait(50);
    }
    throw new Error(name);
  };
  const output = '/tmp/obs-copy-acceptance';
  const vaultPath = fs.realpathSync(app.vault.getBasePath());
  const temporaryRoots = ['/tmp', os.tmpdir()].map((root) => fs.realpathSync(root));
  check(temporaryRoots.some((root) => vaultPath.startsWith(root + path.sep)), '只在临时 vault 验收');
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'core-views-report.json');
  const workspace = app.workspace;
  const metadata = app.metadataCache;
  const result = { ok: false, checks, vault: vaultPath };
  const events = () => ({
    active: (workspace._events['active-leaf-change'] || []).length,
    file: (workspace._events['file-open'] || []).length,
    layout: (workspace._events['layout-change'] || []).length,
    changed: (metadata._events.changed || []).length,
    resolved: (metadata._events.resolved || []).length,
    vaultCreate: ((app.vault._events || {}).create || []).length,
    vaultDelete: ((app.vault._events || {}).delete || []).length,
    vaultRename: ((app.vault._events || {}).rename || []).length,
  });
  const sameEvents = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const propsStatusItem = () => document.querySelector('.status-bar .status-bar-item.plugin-properties');
  try {
    await app.plugins.enableInternalPlugin('outgoing-link');
    await app.plugins.enableInternalPlugin('properties');

    const folder = `Core Views ${Date.now().toString(36)}`;
    await app.vault.createFolder(folder);
    const a = await app.vault.create(`${folder}/A.md`, '---\ntags: [x]\nstatus: draft\nrating: 5\n---\n\n正文 [[B]] 与 [[Missing]]。\n');
    const b = await app.vault.create(`${folder}/B.md`, '# B\n\n被 A 链接。\n');
    const c = await app.vault.create(`${folder}/C.md`, '---\nstatus: published\n---\n\n没有出链。\n');
    for (const file of [a, b, c]) await metadata.parseFile(file);
    metadata.rebuildIndices();
    await wait(150);
    check(!metadata.getFirstLinkpathDest('Missing', a.path), 'fixture 的 Missing 未解析');
    check(metadata.getFirstLinkpathDest('B', a.path) === b.path, 'fixture 的 B 可解析');

    // ------------------------------------------------------------- 出链视图
    await workspace.openFile(a);
    await wait(150);
    const outgoingLeaf = await workspace.ensureSideLeaf('outgoing-link', 'right', { reveal: true });
    const outgoing = outgoingLeaf.view;
    await wait(200);
    check(workspace._sideOf(outgoingLeaf) === 'right', '出链面板打开在右侧栏');
    check(outgoing.getViewType() === 'outgoing-link', '出链面板视图类型正确');
    check(outgoing.getDisplayText().includes('A'), '出链面板标签标题显示当前文件');
    const linkItems = () => [...outgoing._pane.querySelectorAll('.outgoing-link-item')];
    const linkLabels = () => linkItems().map((el) => el.querySelector('.tree-item-inner-text').textContent);
    check(linkItems().length === 2, '出链面板列出 2 条链接');
    check(linkLabels().includes('B') && linkLabels().includes('Missing'), '已解析与未解析出链都在列表中');
    const headerFlair = outgoing._pane.querySelector('.outgoing-links-header .tree-item-flair');
    check(!!headerFlair && headerFlair.textContent === '2', '出链分节计数为 2');
    const unresolvedItem = linkItems().find((el) => el.classList.contains('is-unresolved'));
    check(!!unresolvedItem && unresolvedItem.textContent.includes('Missing'), '未解析出链带 is-unresolved');
    check(!!unresolvedItem.getAttribute('aria-label'), '未解析出链带未创建 tooltip');
    const resolvedItem = linkItems().find((el) => !el.classList.contains('is-unresolved'));
    const subtext = resolvedItem.querySelector('.tree-item-inner-subtext');
    check(!!subtext && subtext.textContent === folder, '已解析出链副文本显示目标文件夹');
    resolvedItem.click();
    await until(() => workspace.getActiveFile() && workspace.getActiveFile().path === b.path, '点击出链打开目标文件');

    await workspace.openFile(c);
    workspace.revealLeaf(outgoingLeaf);
    await wait(180);
    check(linkItems().length === 0, '无出链文件列表为空');
    check(!!outgoing._pane.querySelector('.pane-empty'), '无出链文件显示空态');
    await workspace.openFile(a);
    workspace.revealLeaf(outgoingLeaf);
    await wait(180);
    const sectionHeader = () => outgoing._pane.querySelector('.outgoing-links-header');
    sectionHeader().click();
    check(sectionHeader().classList.contains('is-collapsed') && linkItems().length === 2
      && outgoing._pane.querySelector('.search-result-container').style.display === 'none', '出链分节可折叠');
    sectionHeader().click();
    check(outgoing._pane.querySelector('.search-result-container').style.display !== 'none', '出链分节可再次展开');

    // ------------------------------------------------ Unlinked mentions（出链面板第二分节）
    const targetNote = await app.vault.create(`${folder}/Target Note.md`, '# Target Note\n\n没有出链。\n');
    const mentioner = await app.vault.create(`${folder}/Mentioner.md`, '这里提到了 Target Note 但没有链接。\n');
    await until(() => !!metadata.getCache(`${folder}/Mentioner.md`) &&
      (metadata.getCache(`${folder}/Mentioner.md`)._rawText || '').includes('Target Note'), '未链接提及 fixture 已索引');
    await workspace.openFile(targetNote);
    workspace.revealLeaf(outgoingLeaf);
    await until(() => outgoing._pane.querySelectorAll('.outgoing-links-header').length >= 2, '出链面板含 Unlinked mentions 分节');
    const unlinkedHeader = [...outgoing._pane.querySelectorAll('.outgoing-links-header')][1];
    unlinkedHeader.click();
    await wait(120);
    check(outgoing._pane.textContent.includes('Mentioner'), '未链接提及列出 Mentioner');
    const unlinkedLinkBtn = outgoing._pane.querySelector('.backlink-unlinked-link-button');
    check(!!unlinkedLinkBtn, '未链接提及有 Link 按钮');
    unlinkedLinkBtn.click();
    await wait(250);
    const mentionerText = await app.vault.read(app.vault.getFileByPath(`${folder}/Mentioner.md`));
    check(mentionerText.includes('[[Target Note]]'), 'Link 按钮插入内部链接');

    await workspace.openFile(a);
    workspace.revealLeaf(outgoingLeaf);
    await wait(150);
    check(outgoing._pane.querySelectorAll('.outgoing-links-header').length >= 2, '普通文件同样显示出链与未链接两分节');

    // --------------------------------------------------------- 全部属性视图
    app.commands.executeCommandById('properties:open');
    await until(() => workspace.getLeavesOfType('all-properties').length === 1, 'properties:open 打开全部属性视图');
    const allLeaf = workspace.getLeavesOfType('all-properties')[0];
    const allView = allLeaf.view;
    await wait(200);
    check(workspace._sideOf(allLeaf) === 'right', '全部属性面板在右侧栏');
    const propertyNames = () => [...allView._list.querySelectorAll('.tree-item-inner-text')].map((el) => el.textContent);
    const propertyRow = (name) => [...allView._list.querySelectorAll('.property-item')]
      .find((el) => el.querySelector('.tree-item-inner-text').textContent === name);
    for (const name of ['tags', 'status', 'rating']) {
      check(propertyNames().includes(name), `全部属性包含 ${name}`);
    }
    check(propertyRow('status').querySelector('.tree-item-flair').textContent === '2', 'status 计数为 2');
    check(propertyRow('tags').querySelector('.tree-item-flair').textContent === '1', 'tags 计数为 1');
    check(propertyNames()[0] === 'status', '默认按频次排序，高频属性在前');
    const sortButton = allView._header.querySelector('.nav-action-button');
    check(!!sortButton, '全部属性面板有排序按钮');
    sortButton.click();
    await wait(80);
    const menuItems = [...document.querySelectorAll('.menu .menu-item')];
    check(menuItems.length === 4, '排序菜单有四个选项');
    const frequencyFirst = propertyNames().join(',');
    menuItems[0].click();
    await wait(120);
    check(propertyNames()[0] === 'rating', '切换 A→Z 后顺序变化');
    check(propertyNames().join(',') !== frequencyFirst, '两种排序结果不同');
    propertyRow('tags').click();
    await until(() => {
      const searchLeaf = workspace.getLeavesOfType('search')[0];
      return searchLeaf && searchLeaf.view.getState && searchLeaf.view.getState().query === '["tags"]';
    }, '点击属性打开全局搜索 ["tags"]');

    // --------------------------------------------------------- 文件属性视图
    await workspace.openFile(a);
    await wait(180);
    app.commands.executeCommandById('properties:open-local');
    await until(() => workspace.getLeavesOfType('file-properties').length === 1, 'properties:open-local 打开文件属性视图');
    const fileLeaf = workspace.getLeavesOfType('file-properties')[0];
    const fileView = fileLeaf.view;
    await wait(200);
    check(workspace._sideOf(fileLeaf) === 'right', '文件属性面板在右侧栏');
    const fileRows = () => [...fileView._container.querySelectorAll('.metadata-property')];
    const fileKeys = () => fileRows().map((el) => el.getAttribute('data-property-key'));
    check(fileRows().length === 3, '文件属性列出 A 的三个属性');
    for (const name of ['tags', 'status', 'rating']) check(fileKeys().includes(name), `文件属性包含 ${name}`);

    // ------------------------------------------------------------ 状态栏计数
    await workspace.openFile(b);
    await wait(180);
    check(fileRows().length === 0 && !!fileView._container.querySelector('.metadata-add-button'), '无属性文件仍可添加首个属性');
    const statusItem = propsStatusItem();
    check(!!statusItem, '状态栏存在属性计数条目');
    check(statusItem.style.display === 'none', '无属性时状态栏条目隐藏');
    await workspace.openFile(a);
    await until(() => {
      const item = propsStatusItem();
      return item && item.textContent.includes('3') && item.style.display !== 'none';
    }, '有属性时状态栏显示 3');

    // 关闭释放：回调注销、计时器取消、重复开关监听数量不增长
    for (const type of ['outgoing-link', 'file-properties']) {
      for (const leaf of [...workspace.getLeavesOfType(type)]) leaf.detach();
      await wait(160);
      const baseline = events();
      for (let round = 0; round < 2; round++) {
        const leaf = await workspace.ensureSideLeaf(type, 'right', { reveal: true });
        const view = leaf.view;
        await wait(180);
        let renders = 0;
        const render = view._render;
        view._render = function (...args) { renders++; return render.apply(this, args); };
        const refs = view._refs.slice();
        view._queueRender();
        view._queueRender();
        check(view._pending !== null, `${type} ${round + 1}: 延迟重绘持有计时器`);
        leaf.detach();
        const afterClose = renders;
        check(view._pending === null, `${type} ${round + 1}: 关闭取消计时器`);
        check(view._refs.length === 0, `${type} ${round + 1}: 关闭清空订阅引用`);
        check(refs.every((ref) => !Object.values(workspace._events).some((list) => list.includes(ref.callback))
          && !Object.values(metadata._events).some((list) => list.includes(ref.callback))
          && !Object.values(app.vault._events || {}).some((list) => list.includes(ref.callback))), `${type} ${round + 1}: 所有回调均已注销`);
        workspace.trigger('file-open', a);
        workspace.trigger('active-leaf-change', workspace.activeLeaf);
        metadata.trigger('changed', a);
        metadata.trigger('resolved');
        view._queueRender();
        await wait(230);
        check(renders === afterClose, `${type} ${round + 1}: 关闭后事件不再调用旧视图`);
        check(sameEvents(events(), baseline), `${type} ${round + 1}: 重复开关监听数量不增长`);
      }
    }

    // ------------------------------------------------------------ 禁停与恢复
    await workspace.openFile(a);
    await wait(150);
    await app.plugins.disableInternalPlugin('outgoing-link');
    await app.plugins.disableInternalPlugin('properties');
    await wait(250);
    check(workspace.getLeavesOfType('outgoing-link').length === 0
      && workspace.getLeavesOfType('all-properties').length === 0
      && workspace.getLeavesOfType('file-properties').length === 0, '禁用后三个视图窗格全部移除');
    check(!app.viewRegistry.getViewCreator('outgoing-link') && !app.viewRegistry.getViewCreator('all-properties')
      && !app.viewRegistry.getViewCreator('file-properties'), '禁用后视图类型撤销');
    check(!app.commands.findCommand('outgoing-links:open') && !app.commands.findCommand('outgoing-links:open-for-current')
      && !app.commands.findCommand('properties:open') && !app.commands.findCommand('properties:open-local'), '禁用后命令撤销');
    check(!propsStatusItem(), '禁用后状态栏属性条目移除');

    await app.plugins.enableInternalPlugin('outgoing-link');
    await app.plugins.enableInternalPlugin('properties');
    await wait(250);
    check(!!app.viewRegistry.getViewCreator('outgoing-link') && !!app.viewRegistry.getViewCreator('all-properties')
      && !!app.viewRegistry.getViewCreator('file-properties'), '重新启用恢复视图类型');
    check(!!app.commands.findCommand('outgoing-links:open') && !!app.commands.findCommand('properties:open')
      && !!app.commands.findCommand('properties:open-local'), '重新启用恢复命令');
    await workspace.openFile(a);
    await wait(200);
    check(!!propsStatusItem() && propsStatusItem().textContent.includes('3'), '重新启用恢复状态栏计数');
    const reopenedOutgoing = await workspace.ensureSideLeaf('outgoing-link', 'right', { reveal: true });
    await wait(200);
    check(reopenedOutgoing.view._pane.querySelectorAll('.outgoing-link-item').length === 2, '重新启用后出链面板可用');

    // ----------------------------------------------------- 设置页核心插件行
    app.setting.open();
    app.setting.openTabById('plugins');
    await wait(250);
    const settingsTab = app.setting.activeTab.containerEl;
    const settingsRow = (name) => [...settingsTab.querySelectorAll('.setting-item')]
      .find((el) => {
        const title = el.querySelector('.setting-item-name');
        return title && title.textContent === name;
      });
    const outgoingEntry = app.plugins.internalPlugins['outgoing-link'];
    const propertiesEntry = app.plugins.internalPlugins['properties'];
    check(!!outgoingEntry && outgoingEntry.manifest.name !== 'outgoing-link' && !!settingsRow(outgoingEntry.manifest.name)
      && !!settingsRow(outgoingEntry.manifest.name).querySelector('.checkbox-container'), '设置页有出链开关');
    const propertiesRow = settingsRow(propertiesEntry.manifest.name);
    check(!!propertiesEntry && propertiesEntry.manifest.name !== 'properties' && !!propertiesEntry.manifest.description
      && !!propertiesRow && propertiesRow.querySelector('.checkbox-container').classList.contains('is-enabled'), '设置页有属性列表开关且默认开启');
    propertiesRow.querySelector('.checkbox-container').click();
    await until(() => !app.plugins.internalPlugins['properties'].enabled, '设置页开关可禁用属性插件');
    check(!propsStatusItem(), '设置页禁用后状态栏条目移除');
    settingsRow(propertiesEntry.manifest.name).querySelector('.checkbox-container').click();
    await until(() => app.plugins.internalPlugins['properties'].enabled, '设置页开关可重新启用属性插件');
    app.setting.close();
    await wait(200);

    workspace.revealLeaf(reopenedOutgoing);
    await wait(150);
    result.ok = true;
    result.pass = true;
    result.count = checks.length;
    result.folder = folder;
    result.visibleType = workspace.activeLeaf.view.getViewType();
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    result.error = error.stack || String(error);
    result.count = checks.length;
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    throw error;
  }
})()
