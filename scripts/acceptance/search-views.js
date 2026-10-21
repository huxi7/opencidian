/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；global-search 插件、workspace 事件与 DOM。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: search-views 场景。覆盖 search.js 之外的搜索视图交互面：命中行“显示更多上下文”按钮、
 *        结果行右键链接菜单、复制结果弹窗、白板文本节点搜索、结果行悬停页面预览（Mod 门控与移出收起）、
 *        文件树/编辑器菜单接入的搜索入口、搜索视图在独立标签打开的形态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
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
    for (let i = 0; i < 80; i++) {
      if (predicate()) { checks.push(name); return; }
      await wait(50);
    }
    throw new Error(name);
  };
  const css = (el) => getComputedStyle(el);
  const output = '/tmp/obs-copy-acceptance';
  const vaultPath = fs.realpathSync(app.vault.getBasePath());
  const temporaryRoots = ['/tmp', os.tmpdir()].map((root) => fs.realpathSync(root));
  check(temporaryRoots.some((root) => vaultPath.startsWith(root + path.sep)), '只在临时 vault 验收');
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'search-views-report.json');
  const workspace = app.workspace;
  const metadata = app.metadataCache;
  const result = { ok: false, checks, vault: vaultPath };
  const folder = 'Search Views ' + Date.now().toString(36);
  const sub = folder + '/Sub';
  let leaf = null;
  let view = null;
  let originalOpenFile = null;
  let opened = null;
  try {
    await app.plugins.enableInternalPlugin('global-search');
    await app.vault.createFolder(folder);
    await app.vault.createFolder(sub);
    const note = await app.vault.create(folder + '/Alpha Note.md', [
      '# Alpha Note',
      '',
      'The quick brown fox jumps over the lazy dog.',
      'Case Token and case token live here.',
      '',
      '## Alpha Section',
      '',
      'alpha beta gamma inside section.',
      'Exact phrase appears here.',
      'Number 42 and 100.',
      '',
      '### Deep Block',
      '',
      'block target line.',
    ].join('\n'));
    await metadata.parseFile(note);
    metadata.rebuildIndices();
    leaf = await workspace.ensureSideLeaf('search', 'left', { reveal: true });
    view = leaf.view;
    await until(() => view && view.inputEl && view.childrenEl, '搜索视图完成挂载');
    originalOpenFile = workspace.openFile;
    workspace.openFile = async (file, options) => {
      opened = { path: file.path, options: options || {} };
      return null;
    };

    // ------------------------------------------------------------- 更多上下文
    await view.setQuery('Exact phrase');
    const ctxRow = view.childrenEl.querySelector('.search-result-file-match');
    const ctxBefore = ctxRow.textContent;
    const ctxUp = ctxRow.querySelector('.search-result-hover-button.mod-top');
    const ctxDown = ctxRow.querySelector('.search-result-hover-button.mod-bottom');
    check(ctxRow.textContent.includes('Exact phrase'), '更多上下文：命中行含命中词');
    check(!!ctxUp && !!ctxDown, '更多上下文：命中行带上下两个按钮');
    ctxUp.click();
    await wait(20);
    const ctxExpanded = view.childrenEl.querySelector('.search-result-file-match');
    check(ctxExpanded.textContent.length > ctxBefore.length, '更多上下文：向上展开后文本变长');
    check(ctxExpanded.textContent.includes('Exact phrase'), '更多上下文：向上展开后仍含命中词');
    check(ctxExpanded.querySelectorAll('.search-result-file-matched-text').length >= 1, '更多上下文：向上展开后保留高亮');
    check(ctxExpanded.textContent.includes('Alpha Section'), '更多上下文：向上展开包含上一段落');
    ctxDown.click();
    await wait(20);
    const ctxExpanded2 = view.childrenEl.querySelector('.search-result-file-match');
    check(ctxExpanded2.textContent.length > ctxExpanded.textContent.length, '更多上下文：向下展开后文本变长');
    check(ctxExpanded2.textContent.includes('Deep Block'), '更多上下文：向下展开包含下一段落');
    check(ctxExpanded2.querySelectorAll('.search-result-file-matched-text').length >= 1, '更多上下文：向下展开后保留高亮');

    // ------------------------------------------------------------- 结果右键菜单
    await view.setQuery('file:Alpha');
    const menuTarget = view.childrenEl.querySelector('.search-result-file-title');
    menuTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await wait(40);
    const resultMenu = document.querySelector('.menu');
    check(!!resultMenu, '结果行右键弹出菜单');
    const resultMenuItems = [...document.querySelectorAll('.menu .menu-item')].map((el) => el.textContent);
    check(resultMenuItems.some((text) => text.includes('标签') || text.toLowerCase().includes('tab')), '结果菜单含链接菜单项');
    check(resultMenuItems.some((text) => text.includes('删除') || text.toLowerCase().includes('delete')), '结果菜单含删除文件项');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(30);
    check(!document.querySelector('.menu') || document.querySelector('.menu').classList.contains('is-hidden'), '结果菜单可关闭');

    // ------------------------------------------------------------- 复制结果弹窗
    view.countEl.click();
    await wait(30);
    check(!!document.querySelector('.menu'), '结果计数打开菜单');
    const copyItem = [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.includes('复制') || el.textContent.toLowerCase().includes('copy'));
    check(!!copyItem, '菜单包含复制搜索结果');
    copyItem.click();
    await wait(30);
    const modal = document.querySelector('.modal-container .modal');
    check(!!modal, '复制弹窗打开');
    check(!!modal.querySelector('.modal-title'), '复制弹窗标题存在');
    check(!!modal.querySelector('.copy-search-result-container'), '复制弹窗使用原版容器');
    const textarea = modal.querySelector('.copy-search-result-textarea');
    check(!!textarea, '复制弹窗包含文本框');
    check(textarea.value.includes('Alpha Note'), '文本框包含文件名');
    check(!textarea.value.includes(folder), '短名模式不含目录（原版 getShortName）');
    const modalSettings = modal.querySelectorAll('.copy-search-result-container .setting-item');
    check(modalSettings.length === 3, '复制弹窗三个设置项');
    check(modal.querySelectorAll('.copy-search-result-container .dropdown').length === 2, '复制弹窗两个下拉框');
    modal.querySelector('.copy-search-result-container .setting-item.mod-toggle .checkbox-container').click();
    await wait(20);
    check(textarea.value.includes('Alpha Note.md'), '显示路径切换后包含扩展名');
    check(textarea.value.includes(folder), '显示路径切换后包含完整路径');
    modal.querySelector('.copy-search-result-container .setting-item.mod-toggle .checkbox-container').click();
    await wait(20);
    check(!textarea.value.includes(folder), '再次关闭显示路径回到短名');
    const selects = modal.querySelectorAll('.copy-search-result-container select');
    selects[0].value = 'wikilink';
    selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    check(textarea.value.includes('[['), '链接样式切换为 Wiki 链接');
    selects[1].value = '-';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    check(textarea.value.startsWith('- '), '列表前缀切换为无序列表');
    const done = [...modal.querySelectorAll('.modal-button-container button')].find((el) => el.textContent.includes('完成') || el.textContent.includes('Done'));
    check(!!done, '复制弹窗有完成按钮');
    done.click();
    await wait(30);
    check(!document.querySelector('.modal-container .modal') || document.querySelector('.modal-container .modal').classList.contains('is-hidden'), '完成关闭复制弹窗');

    // ------------------------------------------------------------- 白板节点搜索
    const canvasBody = JSON.stringify({
      nodes: [{ id: 'node-1', type: 'text', text: 'quokka canvas node text', x: 0, y: 0, width: 200, height: 60 }],
      edges: [],
    });
    await app.vault.create(folder + '/Board.canvas', canvasBody);
    await view.setQuery('quokka');
    const canvasGroup = [...view.childrenEl.querySelectorAll('.search-result')]
      .find((group) => group.querySelector('.tree-item-inner').textContent.includes('Board.canvas'));
    check(!!canvasGroup, '白板文本节点命中后出现白板结果');
    check(canvasGroup && canvasGroup.querySelector('.search-result-file-match').textContent.includes('quokka'), '白板命中行显示节点文字');
    check(view.resultCountEl.textContent.replace(/[^0-9]/g, '') === '0', '白板节点命中不计入结果数（原版 QI 口径）');
    await view.setQuery('Board');
    check(view.childrenEl.querySelectorAll('.search-result').length >= 1, '白板文件名命中也出结果');
    check(view.resultCountEl.textContent.replace(/[^0-9]/g, '') === '1', '白板文件名命中计入结果数');

    // ------------------------------------------------------------- 建议弹层上下文
    const tagged = await app.vault.create(folder + '/Tagged.md', '---\ntags:\n  - zeta-tag\n---\n\nbody\n');
    await metadata.parseFile(tagged);
    metadata.rebuildIndices();
    const suggPanel = () => [...document.querySelectorAll('.suggestion-container.mod-search-suggestion .suggestion-item')];
    view.inputEl.value = 'tag:zet';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    check(suggPanel().some((el) => el.textContent.includes('zeta-tag')), 'tag: 后给出标签建议');
    view.inputEl.value = 'path:';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    check(suggPanel().some((el) => el.textContent.includes(sub)), 'path: 后给出目录建议');
    view.inputEl.value = 'tag:zet';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    view.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(120);
    check(view.inputEl.value.trim() === 'tag:#zeta-tag', '选中标签建议写入查询词');

    // ------------------------------------------------------------- 悬停预览
    await app.plugins.enableInternalPlugin('page-preview');
    await view.setQuery('file:Alpha');
    const hoverTitle = view.childrenEl.querySelector('.search-result-file-title');
    const popover = () => document.querySelector('body > .popover.hover-popover');
    hoverTitle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, metaKey: true }));
    await wait(700);
    check(!!popover(), '按住 Mod 悬停结果行弹出页面预览');
    check(popover() && popover().textContent.includes('Alpha Note'), '预览内容为命中文件');
    hoverTitle.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    await wait(500);
    check(!popover(), '移出结果行后预览收起');
    hoverTitle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await wait(700);
    check(!popover(), '未按 Mod 悬停不弹预览（Mod 门控保留）');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }));
    await wait(700);
    check(!!popover(), '悬停后按下 Mod 补弹预览');
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false, bubbles: true }));
    await wait(300);
    check(!popover(), '松开 Mod 后预览收起');

    // ------------------------------------------------------------- 文件树/编辑器菜单接入
    const fakeMenu = () => {
      const items = [];
      const make = () => ({
        setSection() { return this; },
        setSectionSubmenu() { return this; },
        setTitle(title) { this.title = title; return this; },
        setIcon(icon) { this.icon = icon; return this; },
        setDisabled() { return this; },
        setWarning() { return this; },
        onClick(cb) { this.onClickHandler = cb; return this; },
      });
      return {
        items,
        addItem(cb) { const item = make(); cb(item); items.push(item); return item; },
        addSeparator() { return make(); },
        setSectionSubmenu() {},
        setSection() {},
      };
    };
    const folderMenu = fakeMenu();
    app.workspace.trigger('file-menu', folderMenu, app.vault.getFolderByPath(sub), 'file-explorer-context-menu', null);
    const searchFolderItem = folderMenu.items.find((item) => item.icon === 'folder-search');
    check(!!searchFolderItem, '文件夹右键出现“在文件夹中查找”');
    if (searchFolderItem) {
      searchFolderItem.onClickHandler();
      await wait(150);
      check(view.inputEl.value.includes('path:'), '“在文件夹中查找”把路径算子写进搜索框');
      check(view.inputEl.value.includes(sub), '“在文件夹中查找”带子目录路径');
    }
    const editorMenu = fakeMenu();
    const fakeEditor = {
      getSelection: () => ({ anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 5 } }),
      getRange: () => 'alpha beta',
    };
    app.workspace.trigger('editor-menu', editorMenu, fakeEditor);
    const searchSelectionItem = editorMenu.items.find((item) => item.title && item.title.includes('查找'));
    check(!!searchSelectionItem, '编辑器选区右键出现“查找 …”');
    check(searchSelectionItem && searchSelectionItem.title.includes('alpha beta'), '查找项显示选区关键词');

    // ------------------------------------------------------------- 独立标签形态
    const tabLeaf = app.workspace.getLeaf('tab');
    await tabLeaf.setViewState({ type: 'search', state: { query: 'alpha' } });
    await until(() => tabLeaf.view && tabLeaf.view.inputEl && tabLeaf.view.childrenEl, '搜索视图在独立标签打开');
    const tabView = tabLeaf.view;
    check(tabView.getViewType() === 'search', '独立标签的视图类型为 search');
    check(!!tabView.contentEl.querySelector(':scope > .search-row'), '独立标签同样有搜索行');
    check(!!tabView.contentEl.querySelector(':scope > .search-result-container.mod-global-search'), '独立标签同样有结果容器');
    check(css(tabView.contentEl).display === 'flex', '独立标签视图内容使用 flex');
    check(css(tabView.contentEl).flexDirection === 'column', '独立标签视图纵向排列');
    check(css(tabView.resultEl).overflowY === 'auto', '独立标签结果容器纵向滚动');
    check(css(tabView.contentEl).overflow === 'hidden', '独立标签视图裁切溢出');
    await tabView.setQuery('alpha');
    check(tabView.childrenEl.querySelectorAll('.search-result').length > 0, '独立标签可出结果');
    check(tabView.resultCountEl.textContent.includes('项结果') || tabView.resultCountEl.textContent.includes('result'), '独立标签显示计数');
    check(tabView.getState().query === 'alpha', '独立标签保存查询状态');
    tabView.inputEl.focus();
    check(document.activeElement === tabView.inputEl, '独立标签输入框可聚焦');
    tabView.inputEl.value = 'beta';
    tabView.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    check(tabView.inputEl.value === 'beta', '独立标签输入框保留文本');
    check(tabView.childrenEl.querySelectorAll('.search-result').length > 0, '独立标签输入触发搜索');
    tabView.clearButtonEl.click();
    await wait(80);
    check(tabView.inputEl.value === '', '独立标签清空按钮清空输入');
    check(tabView.childrenEl.children.length === 0, '独立标签清空按钮清空结果');
    check(tabView.resultsInfoEl.style.display === 'none', '独立标签清空后隐藏结果信息行');
    check(tabView.emptyEl.style.display !== 'none', '独立标签清空后显示空态');

    result.ok = true;
    result.pass = true;
    result.count = checks.length;
    result.files = [note.path];
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    return { pass: true, count: checks.length, checks, reportPath };
  } finally {
    if (originalOpenFile) workspace.openFile = originalOpenFile;
  }
})();
