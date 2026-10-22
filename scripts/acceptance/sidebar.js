/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks} 断言回执；失败抛出异常。
 * [POS]: sidebar 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * 在 OpenSidian 的 OBS_ACT eval 中执行。只允许临时 vault。
 * OBS_SCREENSHOT 指定截图路径；OBS_SIDEBAR_VIEW=backlink 让最终截图显示反链。
 * 默认最终显示大纲。报告写到 /tmp/obs-copy-acceptance/sidebar-report.json。
 * 不构建、不退出进程、不加载源码补丁；主代理先集成，再使用现有截图钩子。
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
  const reportPath = path.join(output, 'sidebar-report.json');
  const workspace = app.workspace;
  const metadata = app.metadataCache;
  const result = { ok: false, checks, vault: vaultPath, screenshotView: process.env.OBS_SIDEBAR_VIEW || 'outline' };
  const ownRow = (item) => item.querySelector(':scope > .tree-item-self');
  const ownChildren = (item) => item.querySelector(':scope > .tree-item-children');
  const click = (element, name) => { check(!!element, name); element.click(); };
  const events = () => ({
    active: (workspace._events['active-leaf-change'] || []).length,
    file: (workspace._events['file-open'] || []).length,
    layout: (workspace._events['layout-change'] || []).length,
    changed: (metadata._events.changed || []).length,
    resolved: (metadata._events.resolved || []).length,
  });
  const sameEvents = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  let originalOpenFile;
  try {
    await app.plugins.enableInternalPlugin('backlink');
    await app.plugins.enableInternalPlugin('outline');
    const folder = `Sidebar Acceptance ${Date.now().toString(36)}`;
    await app.vault.createFolder(folder);
    const lines = [
      '# 右栏验收', '', '正文开头。', '', '### 跳级子标题', '', '子标题正文。', '',
      '#### 深层标题', '', '深层正文。', '', '## 重复标题', '', '第一次同名标题。', '',
      ...Array.from({ length: 30 }, (_, i) => `正文段落 ${i + 1}。`), '',
      '## 重复标题', '', '第二次同名标题。', '', '# 另一个根标题', '',
      '## 一个很长的标题，用来确认右侧大纲在窄栏中自然换行而且保留完整文字', '', '结束。',
    ];
    const note = await app.vault.create(`${folder}/右栏验收.md`, lines.join('\n'));
    check(workspace.rightSplit.collapsed === true, '新库默认右栏收起（原版）');
    check(workspace.leftSplit.collapsed === false, '新库默认左栏展开');
    const linked = await app.vault.create(`${folder}/链接来源.md`, `# 链接来源\n\n首条 [[${note.path}]] 引用。\n\n第二条 [[${note.path}#重复标题|标题别名]] 引用。\n`);
    const unlinked = await app.vault.create(`${folder}/提及来源.md`, '# 提及来源\n\n这里提到右栏验收，但尚未建立链接。\n');
    const blank = await app.vault.create(`${folder}/没有标题.md`, '只有正文，没有标题。\n');
    for (const file of [note, linked, unlinked, blank]) await metadata.parseFile(file);
    metadata.rebuildIndices();
    const editorLeaf = await workspace.openFile(note);
    await editorLeaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'source' } });
    workspace.setActiveLeaf(editorLeaf, { focus: true });
    await wait(220);
    const headings = metadata.getFileCache(note).headings;
    check(headings.length === 7, 'fixture 元数据包含七个标题');
    const repeated = headings.filter((heading) => heading.heading === '重复标题');
    check(repeated.length === 2, 'fixture 包含两个同名标题');

    const backLeaf = await workspace.ensureSideLeaf('backlink', 'right', { reveal: true });
    const backlink = backLeaf.view;
    await wait(180);
    check(workspace._sideOf(backLeaf) === 'right', '反链打开在右侧栏');
    check(workspace.activeLeaf === backLeaf && workspace.getActiveFile()?.path === note.path, '反链获得焦点仍跟随最近中心文件');
    check(backlink.getDisplayText().includes(note.basename), '反链标签标题显示当前文件');
    check(backlink._pane.getBoundingClientRect().height > 0, '反链结果容器可见');
    check(getComputedStyle(backlink._pane).display === 'block', '反链分节按正文流布局');
    const sections = () => [...backlink._pane.querySelectorAll(':scope > .backlink-pane-header')];
    check(sections().length === 2, '反链包含已链接与未链接两个分节');
    check(sections()[1].classList.contains('is-collapsed'), '未链接提及默认收起');
    const linkedItem = () => [...backlink._pane.querySelectorAll('.search-result[data-path]')].find((item) => item.getAttribute('data-path') === linked.path);
    check(!!linkedItem(), '已链接来源可见');
    check(linkedItem().querySelectorAll('.search-result-file-match').length === 2, '两个链接上下文均可见');
    const resultMatches = linkedItem().querySelector('.search-result-file-matches');
    check(getComputedStyle(resultMatches).boxShadow !== 'none', '反链上下文使用原版有边框的结果卡片');
    check(getComputedStyle(resultMatches.firstElementChild).whiteSpace === 'pre-wrap', '反链上下文允许换行');
    click(ownRow(linkedItem()).querySelector('.collapse-icon'), '点击反链来源折叠箭头');
    check(linkedItem().classList.contains('is-collapsed'), '反链来源进入折叠状态');
    check(ownRow(linkedItem()).querySelector('.collapse-icon').classList.contains('is-collapsed'), '反链箭头状态同步');
    check(linkedItem().querySelector('.search-result-file-matches').style.display === 'none', '反链折叠后内容隐藏');
    metadata.trigger('resolved');
    await wait(170);
    check(linkedItem().classList.contains('is-collapsed'), '反链重绘保留来源折叠状态');
    click(ownRow(linkedItem()).querySelector('.collapse-icon'), '展开反链来源');
    check(getComputedStyle(linkedItem().querySelector('.search-result-file-matches')).display !== 'none', '反链再次展开后内容可见');
    click(sections()[0], '收起已链接分节');
    check(sections()[0].classList.contains('is-collapsed') && sections()[0].nextElementSibling.style.display === 'none', '已链接分节状态与显示同步');
    click(sections()[0], '展开已链接分节');
    click(sections()[1], '展开未链接提及');
    check(sections()[1].nextElementSibling.textContent.includes('提及来源'), '未链接来源正文可见');
    click(backlink._header.querySelector('.backlink-filter-button'), '显示反链筛选框');
    const input = backlink._header.querySelector('input');
    check(!!input && document.activeElement === input, '筛选输入框在面板导航栏中获得焦点');
    input.value = '不存在的来源';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    check(!backlink._pane.querySelector('.search-result[data-path]'), '筛选隐藏不匹配来源');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    check(!!linkedItem(), '清空筛选恢复来源');
    click(backlink._header.querySelector('.backlink-filter-button'), '收起筛选框');

    const outlineLeaf = await workspace.ensureSideLeaf('outline', 'right', { reveal: true });
    const outline = outlineLeaf.view;
    await wait(180);
    check(workspace._sideOf(outlineLeaf) === 'right', '大纲打开在右侧栏');
    check(workspace.activeLeaf === outlineLeaf && workspace.getActiveFile()?.path === note.path, '大纲获得焦点仍跟随最近中心文件');
    check(outline.getDisplayText().includes(note.basename), '大纲标签标题显示当前文件');
    const headingItem = (heading) => outline._tree.querySelector(`.tree-item[data-line="${heading.position.start.line}"]`);
    check(outline._tree.querySelectorAll('.tree-item[data-line]').length === headings.length, '所有标题各有一个树节点');
    check(outline._tree.querySelectorAll(':scope > .tree-item').length === 2, '两个一级标题是根节点');
    check(headingItem(headings[1]).parentElement === ownChildren(headingItem(headings[0])), '跳级标题直接归属最近较高层标题');
    check(headingItem(headings[2]).parentElement === ownChildren(headingItem(headings[1])), '深层标题嵌套正确');
    check(headingItem(repeated[1]).parentElement === ownChildren(headingItem(headings[0])), '同级标题从深层栈回退');
    check(ownRow(headingItem(headings[2])).querySelector('.collapse-icon') === null, '没有子标题的节点没有折叠箭头');
    check(ownRow(headingItem(headings[2])).style.paddingLeft === '', '大纲缩进由公共树样式提供');
    check(getComputedStyle(ownRow(headingItem(headings[6])).querySelector('.tree-item-inner')).whiteSpace === 'pre-wrap', '大纲长标题使用原版换行规则');
    const root = () => headingItem(headings[0]);
    click(ownRow(root()).querySelector('.collapse-icon'), '收起根标题');
    check(root().classList.contains('is-collapsed') && getComputedStyle(ownChildren(root())).display === 'none', '大纲折叠隐藏整个子树');
    check(workspace.activeLeaf === outlineLeaf, '折叠操作不跳转笔记');
    metadata.trigger('changed', note);
    metadata.trigger('changed', note);
    await wait(150);
    check(root().classList.contains('is-collapsed'), '元数据重绘保留大纲折叠状态');
    click(ownRow(root()).querySelector('.collapse-icon'), '展开根标题');
    check(getComputedStyle(ownChildren(root())).display !== 'none', '大纲子树可再次展开');

    let reopened = 0;
    originalOpenFile = workspace.openFile;
    workspace.openFile = function (...args) { reopened++; return originalOpenFile.apply(this, args); };
    click(ownRow(headingItem(repeated[1])), '点击第二个同名标题');
    await until(() => editorLeaf.view.editor.getCursor().line === repeated[1].position.start.line, '第二个同名标题准确跳转到自身行号');
    check(workspace.activeLeaf === editorLeaf, '标题跳转聚焦已有中心笔记');
    check(reopened === 0, '标题跳转复用对应笔记视图');
    check(editorLeaf.view.getMode() === 'source', '标题跳转保留源码模式');
    workspace.openFile = originalOpenFile;
    originalOpenFile = null;
    await editorLeaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'preview' } });
    workspace.revealLeaf(outlineLeaf);
    await wait(100);
    click(ownRow(headingItem(headings[5])), '阅读模式点击另一个根标题');
    await wait(120);
    check(editorLeaf.view.getMode() === 'preview', '阅读模式标题跳转不切换编辑模式');
    check(editorLeaf.view.getEphemeralState().line === headings[5].position.start.line, '阅读模式也传递准确标题行号');
    await workspace.openFile(blank);
    workspace.revealLeaf(outlineLeaf);
    await wait(140);
    check(!!outline._tree.querySelector('.pane-empty') && !outline._tree.querySelector('.tree-item[data-line]'), '无标题笔记显示大纲空态');
    await workspace.openFile(note);
    await wait(160);

    // 生命周期测试使用真实叶子；每轮关闭后比较完整监听数量与回调次数。
    for (const type of ['backlink', 'outline']) {
      for (const leaf of [...workspace.getLeavesOfType(type)]) leaf.detach();
      await wait(160);
      const baseline = events();
      for (let round = 0; round < 3; round++) {
        const leaf = await workspace.ensureSideLeaf(type, 'right', { reveal: true });
        const view = leaf.view;
        await wait(140);
        let renders = 0;
        let titles = 0;
        const render = view._render;
        const title = leaf.updateTabHeader;
        view._render = function (...args) { renders++; return render.apply(this, args); };
        leaf.updateTabHeader = function (...args) { titles++; return title.apply(this, args); };
        const refs = view._refs.slice();
        for (let i = 0; i < 5; i++) view._queueRender();
        const pending = view._pending;
        check(pending !== null, `${type} ${round + 1}: 延迟重绘持有计时器`);
        leaf.detach();
        const afterClose = { renders, titles };
        check(view._pending === null, `${type} ${round + 1}: 关闭取消计时器`);
        check(view._refs.length === 0, `${type} ${round + 1}: 关闭清空订阅引用`);
        check(refs.every((ref) => !Object.values(workspace._events).some((list) => list.includes(ref.callback))
          && !Object.values(metadata._events).some((list) => list.includes(ref.callback))), `${type} ${round + 1}: 所有回调均已注销`);
        workspace.trigger('layout-change');
        workspace.trigger('file-open', note);
        workspace.trigger('active-leaf-change', workspace.activeLeaf);
        metadata.trigger('changed', note);
        metadata.trigger('resolved');
        view._queueRender();
        await wait(200);
        check(renders === afterClose.renders && titles === afterClose.titles, `${type} ${round + 1}: 关闭后事件与计时器不再调用旧视图`);
        check(sameEvents(events(), baseline), `${type} ${round + 1}: 重复开关监听数量不增长`);
      }
    }
    await workspace.openFile(note);
    const statusItem = document.querySelector('.status-bar .status-bar-item.plugin-backlink');
    check(!!statusItem && /\d+ 条反向链接/.test(statusItem.textContent), '状态栏显示反链数：' + (statusItem && statusItem.textContent));
    const beforeStatus = parseInt((statusItem.textContent.match(/\d+/) || ['0'])[0], 10);
    const statusSource = await app.vault.create(`${folder}/状态栏来源.md`, `# 状态栏来源\n\n[[${note.basename}]]\n`);
    await metadata.parseFile(statusSource);
    metadata.rebuildIndices();
    metadata.trigger('resolved');
    await wait(250);
    const afterStatus = parseInt((statusItem.textContent.match(/\d+/) || ['0'])[0], 10);
    check(afterStatus > beforeStatus, '反链状态栏随 resolved 更新：' + beforeStatus + '→' + afterStatus);
    statusItem.click();
    await wait(160);
    check(workspace.rightSplit.collapsed === false, '点击反链状态栏展开右栏');
    const finalBacklink = await workspace.ensureSideLeaf('backlink', 'right', { reveal: true });
    const finalOutline = await workspace.ensureSideLeaf('outline', 'right', { reveal: true });
    workspace.revealLeaf(result.screenshotView === 'backlink' ? finalBacklink : finalOutline);
    await wait(220);
    result.ok = true;
    result.pass = true;
    result.count = checks.length;
    result.note = note.path;
    result.visibleType = workspace.activeLeaf.view.getViewType();
    result.finalListeners = events();
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (originalOpenFile) workspace.openFile = originalOpenFile;
    result.error = error.stack || String(error);
    result.count = checks.length;
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    throw error;
  }
})()
