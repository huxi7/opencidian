/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；搜索插件、元数据缓存与 DOM。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: search 场景。仅由 run.mjs 在带标记的临时库执行；覆盖语法、开关、分组、键盘、空态，
 *        520 条结果下的虚拟列表（DOM 节点上限、滚动窗口正确性、键盘跨虚拟边界、计数与排序不变），
 *        以及搜索框建议弹层（算子建议、搜索历史存取与清除、键盘导航与插入）。
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
  const reportPath = path.join(output, 'search-report.json');
  const workspace = app.workspace;
  const metadata = app.metadataCache;
  const result = { ok: false, checks, vault: vaultPath };
  const folder = 'Search Acceptance ' + Date.now().toString(36);
  const sub = folder + '/Sub';
  let leaf = null;
  let view = null;
  let originalOpenFile = null;
  let opened = null;
  try {
    await app.plugins.enableInternalPlugin('global-search');
    check(!!app.commands.commands['global-search:open'], '注册全局搜索命令');
    await app.vault.createFolder(folder);
    await app.vault.createFolder(sub);
    const alphaText = [
      '---',
      'tags:',
      '  - project/alpha',
      'aliases:',
      '  - Alpha Alias',
      '---',
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
      '',
      '- [ ] open task alpha',
      '- [x] done task beta',
    ].join('\n');
    const betaText = [
      '# Beta Note',
      '',
      'Beta body mentions Token once.',
      'beta gamma delta.',
      '',
      '## Beta Section',
      '',
      'Only beta section text.',
      '',
      '- [ ] open beta task',
      '- [x] done gamma task',
    ].join('\n');
    const files = [
      await app.vault.create(folder + '/Alpha Note.md', alphaText),
      await app.vault.create(folder + '/Beta Note.md', betaText),
      await app.vault.create(folder + '/Gamma Note.md', '# Gamma Note\n\nGamma content only.\n'),
      await app.vault.create(sub + '/Deep Note.md', '# Deep Note\n\nDeep content with regex 123-456 and alpha.\n'),
      await app.vault.create(folder + '/Case.md', 'token only lower\nTOKEN upper\nToken mixed\n'),
      await app.vault.create(folder + '/Regex.md', 'abc123\nabc456\nzzz999\nline with foo bar\n'),
      await app.vault.create(folder + '/Empty.md', 'nothing relevant here\n'),
    ];
    for (const file of files) await metadata.parseFile(file);
    metadata.rebuildIndices();
    check(metadata.getFileCache(files[0]).tags.some((tag) => tag.tag === '#project/alpha'), 'fixture 标签进入元数据');
    check(metadata.getFileCache(files[0]).headings.length === 3, 'fixture 标题进入元数据');

    leaf = await workspace.ensureSideLeaf('search', 'left', { reveal: true });
    view = leaf.view;
    await until(() => view && view.inputEl && view.childrenEl, '搜索视图完成挂载');
    check(leaf.view.getViewType() === 'search', '叶子视图类型为 search');
    check(workspace._sideOf(leaf) === 'left', '搜索视图打开在左栏');
    check(view.getViewType() === 'search', '视图类型为 search');
    check(view.getDisplayText() === '搜索' || view.getDisplayText() === 'Search', '视图标题使用原版文案');
    check(view.getIcon() === 'search', '视图图标为 search');
    check(view.inputEl.value === '', '初始输入为空');
    check(view.searchInfoEl.style.display === 'none', '解释区域初始隐藏');
    check(view.childrenEl.children.length === 0, '初始结果为空');
    check(view.emptyEl.style.display === 'none', '空态初始隐藏');
    check(view.searchInfoEl !== view.resultEl, '解释区与结果区分离');

    // ------------------------------------------------------------- DOM 结构
    const row = view.contentEl.querySelector(':scope > .search-row');
    const inputContainer = row.querySelector(':scope > .search-input-container.global-search-input-container');
    const input = inputContainer.querySelector(':scope > input');
    check(!!row, '存在 search-row');
    check(!!inputContainer, '输入容器使用 global-search-input-container');
    check(input.type === 'search', '输入框类型为 search');
    check(input.getAttribute('enterkeyhint') === 'search', '输入框 enterkeyhint=search');
    check(input.getAttribute('spellcheck') === 'false', '输入框关闭拼写检查');
    check(input.placeholder.includes('搜索') || input.placeholder.includes('Search'), '输入框占位文案');
    check(!!inputContainer.querySelector('.search-input-clear-button'), '存在清除按钮');
    check(!!inputContainer.querySelector('.input-right-decorator.clickable-icon .uppercase-lowercase-a'), 'Aa 图标位于右侧装饰器');
    check(!!inputContainer.querySelector('.search-input-icon') === false, '不再使用旧 search-input-icon 节点');
    check(!!row.querySelector(':scope > .clickable-icon .lucide-sliders-horizontal'), '存在搜索设置按钮');
    check(!!view.contentEl.querySelector(':scope > .search-info-container'), '存在解释容器');
    check(!!view.contentEl.querySelector(':scope > .search-params'), '存在参数面板');
    check(view.contentEl.querySelectorAll('.search-params .setting-item.mod-toggle').length === 3, '参数面板三个开关');
    check(view.contentEl.querySelectorAll('.search-params .checkbox-container').length === 3, '参数面板三个 checkbox 容器');
    check(!!view.contentEl.querySelector(':scope > .search-results-info'), '存在结果信息行');
    check(!!view.contentEl.querySelector(':scope > .search-result-container.mod-global-search'), '结果容器使用 mod-global-search');
    check(!!view.resultEl.querySelector(':scope > .search-results-children'), '结果容器包含 search-results-children');
    check(!!view.resultEl.querySelector(':scope > .search-empty-state'), '结果容器包含空态节点');
    check(view.sortSelect.tagName === 'SELECT', '排序控件是原生 select');
    check(view.sortSelect.options.length === 6, '排序菜单六项');
    check(view.sortSelect.value === 'alphabetical', '默认按文件名 A-Z 排序');
    check(view.sortSelect.options[0].textContent.includes('A-Z'), '首项为 A-Z 文案');
    const measureSelect = view.contentEl.querySelector('.search-results-info select.dropdown.is-measuring');
    check(!!measureSelect, '排序下拉带原版测量 select');
    check(measureSelect.getAttribute('aria-hidden') === 'true', '测量 select 对辅助技术隐藏');
    check(measureSelect.tabIndex === -1, '测量 select 不可聚焦');
    check(css(measureSelect).visibility === 'hidden', '测量 select 不可见');
    check(css(view.paramsEl).display === 'none', '参数面板默认隐藏');
    row.querySelector(':scope > .clickable-icon').click();
    check(css(view.paramsEl).display === 'flex', '设置按钮展开参数面板');
    check(row.querySelector(':scope > .clickable-icon').classList.contains('is-active'), '设置按钮显示 active');
    row.querySelector(':scope > .clickable-icon').click();
    check(css(view.paramsEl).display === 'none', '再次点击收起参数面板');

    // ------------------------------------------------------------- 视觉约束
    check(css(view.contentEl).display === 'flex', '搜索视图 content 使用 flex');
    check(css(view.contentEl).flexDirection === 'column', '搜索视图纵向排列');
    check(css(view.contentEl).overflow === 'hidden', '搜索视图裁切溢出');
    check(css(row).display === 'flex', '搜索行使用 flex');
    check(css(row).marginTop === '12px', '搜索行上边距 12px');
    check(css(row).marginRight === '12px', '搜索行右边距 12px');
    check(css(row).marginBottom === '8px', '搜索行下边距 8px');
    check(css(row).marginLeft === '12px', '搜索行左边距 12px');
    check(css(row).gap === '4px', '搜索行间距 4px');
    check(css(row).height === '30px', '搜索行高度 30px (' + css(row).height + ')');
    check(css(inputContainer).position === 'relative', '输入容器相对定位');
    check(css(inputContainer).flexGrow === '1', '输入容器占满搜索行');
    check(css(input).height === '30px', '输入框高度 30px');
    check(css(input).paddingLeft === '30px', '输入框左侧留出搜索图标');
    check(css(input).borderRadius === '100px', '输入框胶囊圆角');
    check(css(inputContainer.querySelector('.input-right-decorator')).position === 'absolute', 'Aa 装饰器绝对定位');
    check(css(inputContainer.querySelector('.input-right-decorator')).width === '24px', 'Aa 装饰器宽 24px');
    check(css(row.querySelector(':scope > .clickable-icon')).width === '28px', '设置按钮宽 28px');
    check(css(row.querySelector(':scope > .clickable-icon')).height === '24px', '设置按钮高 24px');
    check(css(view.searchInfoEl).fontSize === '12px', '解释文本字号 12px');
    check(css(view.searchInfoEl).paddingTop === '4px', '解释区上内边距 4px');
    check(css(view.searchInfoEl).paddingLeft === '16px', '解释区左内边距 16px');
    check(css(view.searchInfoEl).paddingBottom === '8px', '解释区下内边距 8px');
    check(css(view.resultEl).overflowY === 'auto', '结果容器纵向滚动');
    check(css(view.resultEl).paddingTop === '12px', '结果容器上内边距 12px');
    check(css(view.resultEl).paddingLeft === '12px', '结果容器左内边距 12px');
    check(css(view.resultEl).flexGrow === '1' || css(view.resultEl).flex === '1 0 0px', '结果容器占据剩余高度');
    check(css(view.emptyEl).fontSize === '13px', '空态字号 13px');
    check(css(view.emptyEl).textAlign === 'start', '空态左对齐');
    check(css(view.resultEl).position === 'relative', '结果容器相对定位');

    originalOpenFile = workspace.openFile;
    workspace.openFile = async (file, options) => {
      opened = { path: file.path, options: options || {} };
      return null;
    };

    // ------------------------------------------------------------- 查询语法
    await view.setQuery('alpha');
    check(view.inputEl.value === 'alpha', 'setQuery 同步输入框');
    check(view._query === 'alpha', 'setQuery 保存查询');
    check(view.resultEl.classList.contains('is-loading') === false, '搜索结束后移除 loading');
    check(view.searchInfoEl.style.display === 'none', '未开启解释时隐藏解释区');
    check(view.searchInfoEl.innerText.includes('匹配') || view.searchInfoEl.innerText.includes('Match'), '解释内容在关闭时仍已渲染');
    check(!!view.searchInfoEl && !!view.resultsInfoEl, '结果信息行独立于解释区');
    check(view.resultCountEl.textContent.includes('项结果') || view.resultCountEl.textContent.includes('result'), '结果计数使用原版文案');
    check(view.childrenEl.querySelectorAll('.search-result').length >= 2, 'alpha 命中多个文件');
    check([...view.childrenEl.querySelectorAll('.search-result-file-title .tree-item-inner')].some((el) => el.textContent.includes('Alpha Note')), 'alpha 命中 Alpha Note');
    check(![...view.childrenEl.querySelectorAll('.search-result-file-title .tree-item-inner')].some((el) => el.textContent.includes('Beta Note')), 'alpha 不命中 Beta Note');
    check(view._countMatches() >= 3, 'alpha 计入文件名与正文多处命中');
    check(view.childrenEl.querySelectorAll('.search-result-file-match').length >= 2, 'alpha 渲染多个匹配行');
    check(view.childrenEl.querySelectorAll('.search-result-file-matched-text').length >= 2, '匹配文本带高亮 span');
    const alphaResult = [...view.childrenEl.querySelectorAll('.search-result')].find((el) => el.textContent.includes('Alpha Note'));
    check(!!alphaResult.querySelector('.tree-item-flair-outer .tree-item-flair'), '文件行显示命中计数');
    check(alphaResult.querySelector('.tree-item-flair').textContent === String(alphaResult.querySelectorAll('.search-result-file-match').length) || Number(alphaResult.querySelector('.tree-item-flair').textContent) >= alphaResult.querySelectorAll('.search-result-file-match').length, 'flair 计数不小于可见行数');
    check(alphaResult.querySelector('.tree-item-self.search-result-file-title.is-clickable') !== null, '文件标题使用原版 tree-item-self');
    check(alphaResult.querySelector(':scope > .search-result-file-matches') !== null, '文件标题后跟 matches 容器');
    check(alphaResult.querySelector('.collapse-icon .right-triangle') !== null, '文件标题带 right-triangle 折叠箭头');
    check(css(alphaResult.querySelector('.search-result-file-title')).paddingLeft === '24px', '文件标题左缩进 24px');
    check(css(alphaResult.querySelector('.search-result-file-title')).fontSize === '13px', '文件标题字号 13px');
    check(css(alphaResult.querySelector('.search-result-file-title')).borderRadius === '8px', '文件标题圆角 8px');
    check(css(alphaResult.querySelector('.search-result-file-matches')).boxShadow !== 'none', '匹配卡片带边框阴影');
    check(css(alphaResult.querySelector('.search-result-file-matches')).borderRadius === '4px', '匹配卡片圆角 4px');
    check(css(alphaResult.querySelector('.search-result-file-matches')).marginTop === '4px', '匹配卡片上边距 4px');
    check(css(alphaResult.querySelector('.search-result-file-matches')).marginBottom === '8px', '匹配卡片下边距 8px');
    check(css(alphaResult.querySelector('.search-result-file-match')).paddingTop === '8px', '匹配行上内边距 8px');
    check(css(alphaResult.querySelector('.search-result-file-match')).paddingRight === '20px', '匹配行右内边距 20px');
    check(css(alphaResult.querySelector('.search-result-file-match')).paddingLeft === '12px', '匹配行左内边距 12px');
    check(css(alphaResult.querySelector('.search-result-file-match')).whiteSpace === 'pre-wrap', '匹配行保留空白');
    check(css(alphaResult.querySelector('.search-result-file-matched-text')).backgroundColor !== 'rgba(0, 0, 0, 0)', '匹配文本有高亮底色');
    check(css(alphaResult.querySelector('.search-result-file-matched-text')).color === css(view.contentEl).color, '匹配文本使用正文色');
    check(css(view.resultsInfoEl).display === 'flex', '结果信息行使用 flex');
    check(css(view.resultsInfoEl).paddingTop === '0px', '结果信息行上内边距 0');
    check(css(view.resultsInfoEl).paddingRight === '12px', '结果信息行右内边距 12px');
    check(css(view.resultsInfoEl).paddingBottom === '8px', '结果信息行下内边距 8px');
    check(css(view.resultsInfoEl).paddingLeft === '12px', '结果信息行左内边距 12px');
    check(css(view.resultsInfoEl).borderBottomWidth === '1px', '结果信息行底边框 1px');
    check(css(view.resultsInfoEl).justifyContent === 'space-between', '结果信息行两端对齐');
    check(css(view.countEl).fontSize === '12px', '结果计数字号 12px');
    check(css(view.sortSelect).height === '24px', '排序下拉高度 24px (' + css(view.sortSelect).height + ')');
    check(css(view.sortSelect).fontSize === '12px', '排序下拉字号 12px');
    check(css(view.sortSelect).borderTopWidth === '0px', '排序下拉无边框');
    check(css(view.sortSelect).backgroundColor === 'rgba(0, 0, 0, 0)', '排序下拉透明背景');
    check(css(alphaResult.querySelector('.search-result-file-title')).display === 'flex', '文件标题使用 flex');
    check(css(alphaResult.querySelector('.search-result-file-title')).alignItems === 'baseline', '文件标题基线对齐');
    check(css(alphaResult.querySelector('.search-result-file-matches')).fontSize === '12px', '匹配卡片字号 12px');
    check(css(alphaResult.querySelector('.search-result-file-match')).borderBottomWidth === '1px', '匹配行底边框 1px');
    check(css(alphaResult.querySelector('.search-result-file-match')).borderBottomStyle === 'solid', '匹配行底边框实线');
    view._query = 'alpha';
    const loading = view.runSearch();
    check(view.resultEl.classList.contains('is-loading'), '搜索进行时结果容器带 is-loading');
    await loading;
    check(!view.resultEl.classList.contains('is-loading'), '搜索完成移除 is-loading');

    await view.setQuery('path:Sub');
    check(view.childrenEl.querySelectorAll('.search-result').length === 1, 'path: 只命中子目录文件');
    check(view.childrenEl.querySelector('.search-result-file-title .tree-item-inner').textContent.includes(sub), 'path: 标题显示完整路径');
    check(view._results[0].evaluation.content.length === 0, 'path: 只产生文件级命中');
    check(view.childrenEl.querySelector('.search-result-file-match') === null, 'path: 不渲染匹配行');
    check(view.childrenEl.querySelector('.search-result.is-collapsed') === null, '文件级命中默认展开');
    check(css(view.childrenEl.querySelector('.collapse-icon')).visibility === 'hidden', '文件级命中隐藏折叠箭头');

    await view.setQuery('file:Beta');
    check(view._results.length === 1 && view._results[0].file.basename === 'Beta Note', 'file: 命中文件名');
    check(view.childrenEl.querySelector('.search-result-file-match') === null, 'file: 无正文命中行');
    check(view._countMatches() === 1, 'file: 计数为一');

    await view.setQuery('file:md');
    check(view._results.length === 7, 'file:md 命中全部 Markdown 扩展名');
    check(view.childrenEl.querySelector('.search-result-file-title .tree-item-inner').textContent.includes('.md'), '扩展名命中时标题显示完整文件名');
    await view.setQuery('tag:project');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', 'tag: 命中父标签');
    await view.setQuery('tag:#project/alpha');
    check(view._results.length === 1, 'tag: 支持 # 前缀与层级');
    await view.setQuery('-tag:project');
    check(!view._results.some((item) => item.file.basename === 'Alpha Note'), '-tag: 排除标签文件');
    check(view._countMatches() === 0, '纯排除查询计数为零但保留结果行');

    await view.setQuery('[aliases:Alpha]');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', '属性值命中');
    check(view._countMatches() === 1, '属性命中计数为一');
    let propertyRow = view.childrenEl.querySelector('.search-result-file-match');
    check(propertyRow !== null && propertyRow.textContent === 'aliases: Alpha Alias', '属性命中行显示属性名与值');
    check(propertyRow.querySelector('.search-result-file-matched-text').textContent === 'Alpha', '属性值带高亮');
    await view.setQuery('[tags:project]');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', '属性数组值命中');
    propertyRow = view.childrenEl.querySelector('.search-result-file-match');
    check(propertyRow.textContent === 'tags: project/alpha', '属性数组行保留完整值');
    check(propertyRow.querySelector('.search-result-file-matched-text').textContent === 'project', '属性数组值带高亮');
    await view.setQuery('[aliases]');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', '属性存在命中');
    check(view.childrenEl.querySelector('.search-result-file-match').textContent.includes('Alpha Alias'), '属性存在行显示完整值');
    await view.setQuery('[missing]');
    check(view._results.length === 0, '不存在属性不命中');

    await view.setQuery('content:fox');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', 'content: 只查正文');
    check(view.childrenEl.querySelectorAll('.search-result-file-match').length === 1, 'content: 单行命中');
    await view.setQuery('file:fox');
    check(view._results.length === 0, 'file: 不查正文');

    await view.setQuery('line:(quick brown)');
    check(view._results.length === 1, 'line: 同行词命中');
    check(view._results[0].evaluation.content.length === 2, 'line: 两个词各产生一处命中');
    await view.setQuery('line:(quick missing)');
    check(view._results.length === 0, 'line: 不同行词不命中');
    await view.setQuery('line:(foo bar)');
    check(view._results.length === 1 && view._results[0].file.basename === 'Regex', 'line: 正则文件命中 foo bar');

    await view.setQuery('section:(alpha beta gamma)');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', 'section: 章节内多词命中');
    await view.setQuery('section:(beta gamma delta)');
    check(view._results.length === 1 && view._results[0].file.basename === 'Beta Note', 'section: 跨文件章节');
    await view.setQuery('section:(nothing relevant)');
    check(view._results.some((item) => item.file.basename === 'Empty'), 'section: 正文段落可命中');

    await view.setQuery('block:(block target)');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', 'block: 块内多词命中');
    await view.setQuery('block:(block missing)');
    check(view._results.length === 0, 'block: 块外词不命中');

    await view.setQuery('task:open');
    check(view._results.length === 2, 'task: 命中两个未完成任务行');
    await view.setQuery('task-todo:alpha');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', 'task-todo: 只匹配未完成');
    await view.setQuery('task-done:beta');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', 'task-done: 只匹配已完成');
    check(view.childrenEl.querySelector('.search-result-file-match').textContent.includes('[x]'), '任务命中行保留复选框原文');

    await view.setQuery('-alpha');
    check(!view._results.some((item) => item.file.basename === 'Alpha Note'), '否定词排除正文命中');
    check(view._results.length > 0, '否定查询保留未命中文件');
    check(view._countMatches() === 0, '否定查询不计命中数');
    await view.setQuery('alpha -file:Beta');
    check(view._results.some((item) => item.file.basename === 'Alpha Note'), '否定文件名保留其它文件');
    check(!view._results.some((item) => item.file.basename === 'Beta Note'), '否定文件名排除目标');

    await view.setQuery('(alpha OR delta) file:Note');
    check(view._results.length >= 2, '括号 OR 与文件名过滤组合');
    check(view._results.some((item) => item.file.basename === 'Alpha Note') && view._results.some((item) => item.file.basename === 'Beta Note'), 'OR 两侧均命中');
    await view.setQuery('alpha OR delta');
    check(view._results.length >= 3, '裸 OR 命中多文件');
    await view.setQuery('(alpha');
    check(view._results.length >= 2, '未闭合左括号按分组处理');
    check(!view.searchInfoEl.querySelector('.search-info'), '未闭合左括号不产生解析错误');

    await view.setQuery('"exact phrase"');
    check(view._results.length === 1 && view._results[0].file.basename === 'Alpha Note', '引号精确短语命中');
    await view.setQuery('"Exact Phrase"');
    check(view._results.length === 1, '精确短语默认忽略大小写');
    await view.setQuery('"Exact Phrase"');
    view.caseButtonEl.click();
    await wait(30);
    check(view._matchCase === true, '大小写开关置为开启');
    check(view.caseButtonEl.classList.contains('is-active'), '大小写按钮显示 active');
    check(view._results.length === 0, '大小写开启后精确短语不命中');
    view.caseButtonEl.click();
    await wait(30);
    check(view._matchCase === false && !view.caseButtonEl.classList.contains('is-active'), '大小写开关可关闭');
    await view.setQuery('match-case:TOKEN');
    check(view._results.length === 1 && view._results[0].file.basename === 'Case', 'match-case: 前缀区分大小写');
    check(view._results[0].evaluation.content.length === 1, 'match-case: 只命中大写行');
    await view.setQuery('ignore-case:TOKEN file:Case');
    check(view._results.length === 1 && view._results[0].evaluation.content.length === 3, 'ignore-case: 命中三行');
    await view.setQuery('token');
    check(view._results.some((item) => item.file.basename === 'Case'), '裸 token 忽略大小写');

    await view.setQuery('/abc\\d+/');
    check(view._results.length === 1 && view._results[0].file.basename === 'Regex', '正则命中文件');
    check(view._results[0].evaluation.content.length === 2, '正则命中两行');
    await view.setQuery('/ABC\\d+/i');
    check(view._results.length === 1 && view._results[0].evaluation.content.length === 2, '正则 i 标志忽略大小写');
    await view.setQuery('file:/^Beta/');
    check(view._results.length === 1 && view._results[0].file.basename === 'Beta Note', '字段后接正则');
    await view.setQuery('/zzz\\d+/');
    check(view._results.length === 1 && view._results[0].evaluation.content.length === 1, '正则命中单行');
    const countBeforeInvalidRegex = view.resultCountEl.textContent;
    await view.setQuery('/(/');
    check(!!view.searchInfoEl.querySelector('.search-info'), '非法正则写入错误');
    check(view.searchInfoEl.innerText.includes('Failed to parse regular expression'), '非法正则错误文案对齐原版');
    check(view.searchInfoEl.style.display === 'none', '关闭解释时隐藏非法正则错误');
    check(view.resultCountEl.textContent === countBeforeInvalidRegex, '非法正则保留上次计数');
    check(view.childrenEl.querySelectorAll('.search-result').length === 0, '非法正则清空结果');
    check(view.emptyEl.style.display !== 'none', '非法正则显示空态');
    view.explainToggle.setValue(true);
    check(view.searchInfoEl.style.display !== 'none', '开启解释后显示非法正则错误');
    check(view.searchInfoEl.innerText.includes('Failed to parse regular expression'), '开启解释后错误文案仍存在');
    view.explainToggle.setValue(false);

    // ------------------------------------------------------------- 排序
    await view.setQuery('alpha OR beta OR gamma');
    const names = () => [...view.childrenEl.querySelectorAll('.search-result-file-title .tree-item-inner')].map((el) => el.textContent);
    const ascending = names();
    check(ascending.length >= 3, '排序测试有多个结果');
    check(ascending.join('|') === [...ascending].sort((a, b) => a.localeCompare(b)).join('|'), '默认文件名升序');
    view.sortSelect.value = 'alphabeticalReverse';
    view.sortSelect.onchange();
    const descending = names();
    check(descending.join('|') === [...descending].sort((a, b) => b.localeCompare(a)).join('|'), '文件名降序');
    check(view._sortOrder === 'alphabeticalReverse', '排序状态记录降序');
    view._results.find((item) => item.file.basename === 'Alpha Note').file.stat.mtime = 3000;
    view._results.find((item) => item.file.basename === 'Beta Note').file.stat.mtime = 2000;
    view._results.find((item) => item.file.basename === 'Gamma Note').file.stat.mtime = 1000;
    view._results.find((item) => item.file.basename === 'Deep Note').file.stat.mtime = 500;
    view.setSortOrder('byModifiedTime');
    check(names()[0].includes('Alpha Note'), '修改时间新到旧');
    view.setSortOrder('byModifiedTimeReverse');
    check(names()[0].includes('Deep Note'), '修改时间旧到新');
    view._results.find((item) => item.file.basename === 'Alpha Note').file.stat.ctime = 1000;
    view._results.find((item) => item.file.basename === 'Beta Note').file.stat.ctime = 3000;
    view._results.find((item) => item.file.basename === 'Gamma Note').file.stat.ctime = 2000;
    view._results.find((item) => item.file.basename === 'Deep Note').file.stat.ctime = 500;
    view.setSortOrder('byCreatedTime');
    check(names()[0].includes('Beta Note'), '创建时间新到旧');
    view.setSortOrder('byCreatedTimeReverse');
    check(names()[0].includes('Deep Note'), '创建时间旧到新');
    view.setSortOrder('alphabetical');

    // ------------------------------------------------------------- 折叠与上下文
    await view.setQuery('alpha');
    const firstResult = view.childrenEl.querySelector('.search-result');
    const firstMatches = firstResult.querySelector('.search-result-file-matches');
    const firstArrow = firstResult.querySelector('.collapse-icon');
    check(css(firstArrow).visibility === 'visible', '有正文命中时折叠箭头可见');
    firstArrow.click();
    const collapsedResult = view.childrenEl.querySelector('.search-result');
    const collapsedMatches = collapsedResult.querySelector('.search-result-file-matches');
    const collapsedArrow = collapsedResult.querySelector('.collapse-icon');
    check(collapsedResult.classList.contains('is-collapsed'), '点击箭头折叠文件');
    check(css(collapsedMatches).display === 'none', '折叠后匹配行隐藏');
    check(collapsedArrow.classList.contains('is-collapsed'), '折叠后箭头旋转态');
    collapsedArrow.click();
    const expandedResult = view.childrenEl.querySelector('.search-result');
    const expandedMatches = expandedResult.querySelector('.search-result-file-matches');
    check(!expandedResult.classList.contains('is-collapsed'), '再次点击展开文件');
    check(css(expandedMatches).display !== 'none', '展开后匹配行可见');
    const title = expandedResult.querySelector('.search-result-file-title');
    opened = null;
    title.click();
    check(!!opened && opened.path === view._results[0].file.path, '点击文件标题打开文件');
    check(!expandedResult.classList.contains('is-collapsed'), '点击文件标题不折叠');
    const matchRow = expandedResult.querySelector('.search-result-file-match');
    const expectedLine = matchRow._line;
    opened = null;
    matchRow.click();
    check(!!opened && opened.path === view._results[0].file.path, '点击匹配行打开文件');
    check(opened.options.eState && opened.options.eState.line === expectedLine, '匹配行携带行号');
    check(typeof opened.options.eState.ch === 'number', '匹配行携带列号');
    check(!!matchRow.querySelector('.search-result-hover-button.mod-top'), '命中行带向上更多上下文按钮');
    check(!!matchRow.querySelector('.search-result-hover-button.mod-bottom'), '命中行带向下更多上下文按钮');
    check(css(matchRow.querySelector('.search-result-hover-button.mod-top')).position === 'absolute', '更多上下文按钮绝对定位');
    check(matchRow.querySelector('.search-result-hover-button.mod-top').getAttribute('aria-label').includes('上下文'), '更多上下文按钮带原版文案');

    view.collapseToggle.setValue(true);
    check(view._collapseAll === true, '折叠全部开关置为开启');
    check([...view.childrenEl.querySelectorAll('.search-result')].every((el) => el.classList.contains('is-collapsed')), '所有结果折叠');
    view.collapseToggle.setValue(false);
    check([...view.childrenEl.querySelectorAll('.search-result')].every((el) => !el.classList.contains('is-collapsed')), '所有结果展开');

    await view.setQuery('Exact phrase');
    const exactRow = view.childrenEl.querySelector('.search-result-file-match');
    const lineOnly = exactRow.textContent;
    view.extraContextToggle.setValue(true);
    check(view._extraContext === true, '更多上下文开关置为开启');
    const contextRow = view.childrenEl.querySelector('.search-result-file-match');
    check(contextRow.textContent.includes('Number 42') || contextRow.textContent !== lineOnly, '更多上下文显示相邻段落');
    view.extraContextToggle.setValue(false);
    check(view._extraContext === false, '更多上下文开关关闭');

    // ------------------------------------------------------------- 键盘
    await view.setQuery('alpha');
    view._list.clearFocus();
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check(view._list.focusedIndex === 0, 'ArrowDown 聚焦首个条目');
    check(view._list.focusedElement() !== null, '首个条目有焦点元素');
    check(view._list.focusedElement().classList.contains('has-focus'), '首个条目显示焦点环');
    check(css(view._list.focusedElement().querySelector('.search-result-file-title')).boxShadow.includes('inset'), '文件焦点显示内嵌描边');
    const firstFocus = view._list.focusedElement();
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check(view._list.focusedIndex === 1, 'ArrowDown 移动到下一个条目');
    check(!firstFocus.classList.contains('has-focus'), '旧焦点移除');
    check(view._list.focusedElement() !== firstFocus, '焦点转移到新条目');
    opened = null;
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check(!!opened && opened.path === view._list.focusRows[1].result.file.path, 'Enter 打开当前焦点');
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    check(view._list.focusedIndex === 0, 'ArrowUp 回到上一个条目');
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    check(view._list.focusedIndex === 0, '首个条目 ArrowUp 不越界');
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const focusResult = view.childrenEl.querySelector('.search-result');
    check(focusResult.classList.contains('is-collapsed'), 'ArrowLeft 折叠当前文件');
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    check(!view.childrenEl.querySelector('.search-result').classList.contains('is-collapsed'), 'ArrowRight 展开当前文件');

    // ------------------------------------------------------------- 空态/解释/复制
    await view.setQuery('zzzz-no-match');
    check(view.childrenEl.querySelectorAll('.search-result').length === 0, '无结果不渲染文件');
    check(view.emptyEl.style.display !== 'none', '无结果显示空态');
    check(view.emptyEl.textContent.includes('未找到') || view.emptyEl.textContent.includes('No matches'), '空态文案为原版');
    check(view.resultCountEl.textContent.startsWith('0'), '无结果计数为零');
    check(view.resultEl.classList.contains('is-loading') === false, '无结果结束 loading');
    await view.setQuery('');
    check(view.searchInfoEl.style.display === 'none', '清空查询隐藏解释区');
    check(view.childrenEl.children.length === 0, '清空查询清空结果');
    check(view.emptyEl.style.display !== 'none', '清空查询显示空态');
    check(view.resultsInfoEl.style.display === 'none', '清空查询隐藏结果信息行');
    view.inputEl.value = 'alpha';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => view.childrenEl.querySelectorAll('.search-result').length > 0, '输入事件触发搜索');
    const countBeforeClear = view.resultCountEl.textContent;
    view.clearButtonEl.click();
    await wait(40);
    check(view.inputEl.value === '', '清除按钮清空输入');
    check(view.childrenEl.children.length === 0, '清除按钮清空结果');
    check(view.searchInfoEl.style.display === 'none', '清除按钮隐藏解释区');
    check(view.emptyEl.style.display !== 'none', '清除按钮显示空态');
    check(view.resultsInfoEl.style.display === 'none', '清除按钮隐藏结果信息行');
    check(view.resultCountEl.textContent === countBeforeClear, '清除按钮保留上次计数');

    await view.setQuery('file:Alpha -path:Sub');
    view.explainToggle.setValue(true);
    check(view._explain === true, '解释开关置为开启');
    check(view.searchInfoEl.style.display !== 'none', '解释区显示');
    check(view.searchInfoEl.innerText.includes('匹配文件名') || view.searchInfoEl.innerText.includes('file name'), '解释包含文件名字段');
    check(view.searchInfoEl.innerText.includes('不包括') || view.searchInfoEl.innerText.includes('Excluding'), '解释包含否定分组');
    check(view.searchInfoEl.querySelector('.search-info-children') !== null, '解释使用嵌套子块');
    check(css(view.searchInfoEl.querySelector('.search-info-children')).borderLeftWidth === '1px', '解释子块使用 1px 缩进线');
    view.explainToggle.setValue(false);
    check(view.searchInfoEl.style.display === 'none', '关闭解释隐藏解释区');

    // ------------------------------------------------------------- 虚拟列表
    const bulkFolder = 'Bulk ' + Date.now().toString(36);
    await app.vault.createFolder(bulkFolder);
    const bulkCount = 520;
    const bulkFiles = [];
    for (let i = 0; i < bulkCount; i++) {
      bulkFiles.push(await app.vault.create(
        bulkFolder + '/Bulk Note ' + String(i).padStart(4, '0') + '.md',
        '# Bulk Note ' + i + '\n\nzebra token line one\n\nzebra token line two\n',
      ));
    }
    for (const file of bulkFiles) await metadata.parseFile(file);
    metadata.rebuildIndices();
    await view.setQuery('zebra');
    check(view._results.length === bulkCount, '虚拟列表：命中全部批量文件');
    check(view._countMatches() === bulkCount * 2, '虚拟列表：计数为每文件两处命中');
    check(view.resultCountEl.textContent.replace(/[^0-9]/g, '') === String(bulkCount * 2), '虚拟列表：计数文案与命中数一致');
    const domGroups = view.childrenEl.querySelectorAll('.search-result').length;
    check(domGroups > 0, '虚拟列表：渲染出结果分组');
    check(domGroups < 30, '虚拟列表：结果分组 DOM 节点有上限');
    check(domGroups * 10 < bulkCount, '虚拟列表：渲染分组远少于总结果数');
    check(view.childrenEl.querySelectorAll('.search-result-file-match').length < 90, '虚拟列表：命中行 DOM 节点有上限');
    check(view.childrenEl.querySelectorAll('.search-results-spacer').length === 2, '虚拟列表：上下占位块存在');
    check(view.resultEl.scrollHeight > view.resultEl.clientHeight * 4, '虚拟列表：滚动条高度与总条目数成比例');
    check(view.resultEl.scrollHeight > 2000, '虚拟列表：滚动高度覆盖全部结果');
    const bulkNames = () => [...view.childrenEl.querySelectorAll('.search-result-file-title .tree-item-inner')].map((el) => el.textContent);
    const bulkIndices = (names) => names.map((name) => view._results.findIndex((item) => item.file.basename === name));
    const firstRendered = bulkNames();
    check(firstRendered.length > 0, '虚拟列表：首屏有渲染条目');
    check(firstRendered[0] === 'Bulk Note 0000', '虚拟列表：首屏从第一条结果开始');
    const firstIndices = bulkIndices(firstRendered);
    check(firstIndices.every((value, index) => index === 0 || value === firstIndices[index - 1] + 1), '虚拟列表：首屏条目连续有序');
    // 渲染窗口与模型对齐：逐个分组核对文件名、命中行数、高亮与徽标
    const checkGroups = (names, indices, label) => {
      const groups = [...view.childrenEl.querySelectorAll('.search-result')];
      check(groups.length === names.length, '虚拟列表：' + label + '分组数与标题数一致');
      groups.forEach((groupEl, index) => {
        const result = view._results[indices[index]];
        const title = groupEl.querySelector('.tree-item-inner').textContent;
        const rows = groupEl.querySelectorAll('.search-result-file-match');
        const flair = groupEl.querySelector('.tree-item-flair');
        check(title === result.file.basename, '虚拟列表：' + label + '分组 ' + index + ' 文件名与模型一致');
        check(rows.length === result.evaluation.content.length, '虚拟列表：' + label + '分组 ' + index + ' 命中行数与模型一致');
        check(groupEl.querySelectorAll('.search-result-file-matched-text').length >= result.evaluation.content.length, '虚拟列表：' + label + '分组 ' + index + ' 命中高亮存在');
        check(!!flair && Number(flair.textContent) === result.evaluation.flair, '虚拟列表：' + label + '分组 ' + index + ' 徽标与模型一致');
        check(!!groupEl.querySelector('.collapse-icon'), '虚拟列表：' + label + '分组 ' + index + ' 带折叠箭头');
      });
    };
    checkGroups(firstRendered, firstIndices, '首屏');
    check(view.childrenEl.children.length === view.childrenEl.querySelectorAll('.search-result').length + 2, '虚拟列表：结果容器只含占位块与分组');
    const spacers = [...view.childrenEl.querySelectorAll('.search-results-spacer')];
    check(spacers.length === 2, '虚拟列表：占位块仍是两个');
    check(parseFloat(spacers[0].style.height) === 0, '虚拟列表：顶部时上占位块为零');
    check(parseFloat(spacers[1].style.height) > 0, '虚拟列表：顶部时下占位块有高度');

    // 滚动：窗口随位置移动，条目仍与模型一致
    view.resultEl.scrollTop = Math.floor(view.resultEl.scrollHeight * 0.5);
    await wait(160);
    const midGroups = view.childrenEl.querySelectorAll('.search-result').length;
    check(midGroups > 0, '虚拟列表：滚动后仍有分组');
    check(midGroups < 30, '虚拟列表：滚动后 DOM 节点仍有上限');
    check(view.childrenEl.querySelectorAll('.search-result-file-match').length < 90, '虚拟列表：滚动后命中行仍有上限');
    const midNames = bulkNames();
    check(midNames[0] !== firstRendered[0], '虚拟列表：滚动后渲染内容随位置变化');
    const midIndices = bulkIndices(midNames);
    check(midIndices.every((value) => value >= 0), '虚拟列表：滚动后条目来自结果集');
    check(midIndices.every((value, index) => index === 0 || value === midIndices[index - 1] + 1), '虚拟列表：滚动后条目连续有序');
    check(midIndices[0] > 0, '虚拟列表：滚动到中段后不再从首项开始');
    const midSpacers = [...view.childrenEl.querySelectorAll('.search-results-spacer')];
    check(parseFloat(midSpacers[0].style.height) > 0, '虚拟列表：滚动后上占位块有高度');
    check(parseFloat(midSpacers[1].style.height) > 0, '虚拟列表：滚动后下占位块有高度');
    checkGroups(midNames, midIndices, '滚动后');

    // 键盘导航跨虚拟边界
    view._list.clearFocus();
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check(view._list.focusedIndex === 0, '虚拟列表：ArrowDown 聚焦首行');
    for (let i = 0; i < 40; i++) view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check(view._list.focusedIndex === 40, '虚拟列表：连续下移索引不错位');
    const focusedRow = view._list.focusRows[40];
    check(focusedRow.kind === 'match', '虚拟列表：第 41 行是命中行');
    check(focusedRow.result.file.basename === 'Bulk Note 0013', '虚拟列表：焦点行对应第 14 个文件');
    check(view._list.focusedElement() !== null, '虚拟列表：焦点行已滚进视口并渲染');
    check(view._list.focusedElement().closest('.search-result').querySelector('.tree-item-inner').textContent === 'Bulk Note 0013', '虚拟列表：焦点元素与模型一致');
    check(view.childrenEl.querySelectorAll('.search-result').length < 30, '虚拟列表：键盘移动后 DOM 节点仍有上限');
    opened = null;
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check(!!opened && opened.path === focusedRow.result.file.path, '虚拟列表：Enter 打开焦点所在文件');
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    check(view._list.focusedIndex === 39, '虚拟列表：ArrowUp 回到上一行');
    check(view._list.focusRows[39].kind === 'file', '虚拟列表：文件行在命中行之前');
    view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    check(view._list.focusedIndex === 38, '虚拟列表：ArrowUp 继续回到命中行');

    // 排序不改变计数与结果数
    const countBeforeSort = view.resultCountEl.textContent;
    for (let i = 0; i < bulkFiles.length; i++) bulkFiles[i].stat.mtime = 1000 + i;
    view.setSortOrder('byModifiedTime');
    check(view._results.length === bulkCount, '虚拟列表：排序不改变结果数');
    check(view.resultCountEl.textContent === countBeforeSort, '虚拟列表：排序不改变计数');
    check(view._results[0].file.basename === 'Bulk Note 0519', '虚拟列表：按修改时间新到旧');
    check(view._results[bulkCount - 1].file.basename === 'Bulk Note 0000', '虚拟列表：按修改时间旧到新在末尾');
    const sortedNames = bulkNames();
    const sortedIndices = bulkIndices(sortedNames);
    check(sortedIndices.every((value, index) => index === 0 || value === sortedIndices[index - 1] + 1), '虚拟列表：排序后 DOM 顺序与结果集一致');
    view.setSortOrder('alphabetical');
    check(view._results[0].file.basename === 'Bulk Note 0000', '虚拟列表：恢复文件名升序');
    check(view._results[bulkCount - 1].file.basename === 'Bulk Note 0519', '虚拟列表：文件名升序末尾正确');

    // 折叠全部在虚拟列表下依然生效
    view.setCollapseAll(true);
    check([...view.childrenEl.querySelectorAll('.search-result')].every((el) => el.classList.contains('is-collapsed')), '虚拟列表：折叠全部生效');
    check(view.childrenEl.querySelectorAll('.search-result-file-match').length === 0, '虚拟列表：折叠全部后不渲染命中行');
    // 折叠后每组只剩标题行，视口内可容纳的分组变多，但仍远少于总数
    check(view.childrenEl.querySelectorAll('.search-result').length < 80, '虚拟列表：折叠全部后节点仍有上限');
    check(view.childrenEl.querySelectorAll('.search-result').length * 5 < bulkCount, '虚拟列表：折叠全部后渲染分组远少于总结果数');
    view.setCollapseAll(false);
    check(view.childrenEl.querySelectorAll('.search-result-file-match').length > 0, '虚拟列表：展开全部恢复命中行');

    // 解释区、空态与大小写开关在大结果集下仍可用
    view.explainToggle.setValue(true);
    check(view.searchInfoEl.style.display !== 'none', '虚拟列表：解释区在大结果集下可见');
    check(view.searchInfoEl.textContent.includes('匹配') || view.searchInfoEl.textContent.includes('Match'), '虚拟列表：解释区内容存在');
    view.explainToggle.setValue(false);
    check(view.searchInfoEl.style.display === 'none', '虚拟列表：关闭解释隐藏解释区');
    await view.setQuery('quokka-no-such-token');
    check(view.childrenEl.querySelectorAll('.search-result').length === 0, '虚拟列表：无结果不渲染分组');
    check(view.emptyEl.style.display !== 'none', '虚拟列表：无结果显示空态');
    check(view.resultCountEl.textContent.replace(/[^0-9]/g, '') === '0', '虚拟列表：无结果计数为零');
    await view.setQuery('zebra');
    check(view._results.length === bulkCount, '虚拟列表：重新搜索恢复结果数');
    view.caseButtonEl.click();
    await wait(80);
    check(view._matchCase === true, '虚拟列表：大小写开关生效');
    check(view._results.length === bulkCount, '虚拟列表：大小写开关不改变命中文件数');
    view.caseButtonEl.click();
    await wait(80);
    check(view._matchCase === false, '虚拟列表：大小写开关可关闭');

    // 继续滚动：窗口继续前移，条目仍与模型一致
    view.resultEl.scrollTop = Math.floor(view.resultEl.scrollHeight * 0.75);
    await wait(160);
    const quarterNames = bulkNames();
    const quarterIndices = bulkIndices(quarterNames);
    check(quarterIndices[0] > midIndices[0], '虚拟列表：继续滚动后窗口继续前移');
    check(quarterIndices.every((value, index) => index === 0 || value === quarterIndices[index - 1] + 1), '虚拟列表：继续滚动后条目连续有序');
    check(quarterNames.length < 30, '虚拟列表：继续滚动后节点仍有上限');
    check(quarterIndices.every((value) => value >= 0), '虚拟列表：继续滚动后条目来自结果集');
    view.resultEl.scrollTop = 0;
    await wait(160);
    check(bulkNames()[0] === 'Bulk Note 0000', '虚拟列表：滚回顶部恢复首条');
    check(view.childrenEl.querySelectorAll('.search-result').length < 30, '虚拟列表：滚回顶部后节点仍有上限');
    await view.setQuery('file:Alpha');

    // ------------------------------------------------------------- 建议弹层
    const panel = () => document.querySelector('.suggestion-container.mod-search-suggestion');
    const suggItems = () => (panel() ? [...panel().querySelectorAll('.suggestion-item')] : []);
    const zh = (re, text) => re.test(String(text || ''));
    view._suggest.saveHistory('zeta query');
    check(JSON.parse(localStorage.getItem('recent-searches') || '[]')[0] === 'zeta query', '历史写入 recent-searches 键');
    view.inputEl.value = '';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    view.inputEl.focus();
    await wait(150);
    check(!!panel(), '聚焦输入框弹出建议面板');
    check(panel().firstElementChild.className === 'suggestion', '建议面板内层是 .suggestion');
    const optGroup = suggItems()[0];
    check(optGroup.classList.contains('mod-group'), '首项是分组头');
    check(!!optGroup.querySelector('.suggestion-title.list-item-part.mod-extended'), '分组头用 list-item-part mod-extended');
    check(!!optGroup.querySelector('.suggestion-aux .search-suggest-icon.clickable-icon'), '分组头带图标按钮');
    check(zh(/了解更多|Read more/i, optGroup.querySelector('.search-suggest-icon').getAttribute('aria-label')), '搜索选项组图标带原版文案');
    check(optGroup.querySelector('.search-suggest-icon svg').getAttribute('class').includes('lucide-info'), '搜索选项组用 lucide-info');
    const opNames = suggItems().slice(1, 7).map((el) => el.querySelector('.suggestion-title span').textContent);
    check(opNames.join('|') === 'path:|file:|tag:|line:|section:|[property]', '算子建议六项且顺序对齐原版');
    check(zh(/路径|path/i, suggItems()[1].querySelector('.search-suggest-info-text').textContent), '算子项带说明文案');
    check(suggItems()[1].classList.contains('is-selected'), '默认选中第一项算子（跳过组头）');
    const historyGroup = suggItems()[7];
    check(historyGroup.classList.contains('mod-group'), '历史分组存在');
    check(zh(/清除|clear/i, historyGroup.querySelector('.search-suggest-icon').getAttribute('aria-label')), '历史组图标带清除文案');
    check(historyGroup.querySelector('.search-suggest-icon svg').getAttribute('class').includes('lucide-x'), '历史组用 lucide-x');
    check(suggItems()[8].textContent === 'zeta query', '历史项显示最近搜索');
    check(parseFloat(panel().style.width) >= 300, '建议面板宽度不小于 300px');
    const suggestRect = view.inputEl.getBoundingClientRect();
    check(Math.abs(parseFloat(panel().style.top) - (suggestRect.bottom + 5)) < 2, '建议面板贴在输入框下方 5px');
    view.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check(suggItems()[2].classList.contains('is-selected'), 'ArrowDown 移动选中项');
    view.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(80);
    check(view.inputEl.value === 'file:' && view.inputEl.selectionStart === 5, 'Enter 插入算子 token 且光标在末尾');
    check(!panel(), '选中后面板关闭');
    view.inputEl.value = 'pa';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    check(suggItems().length === 2 && suggItems()[1].textContent.startsWith('path:'), '按前缀过滤算子建议');
    view.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(60);
    check(!panel(), 'Escape 关闭建议面板');
    view.inputEl.value = '';
    view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    panel().querySelectorAll('.search-suggest-icon')[1].click();
    await wait(120);
    check(localStorage.getItem('recent-searches') === null, '清除历史按钮删除 recent-searches');
    check(!panel().textContent.includes('zeta query'), '清除后历史项消失');
    await view.setQuery('file:Alpha');
    await wait(5300);
    check(JSON.parse(localStorage.getItem('recent-searches') || '[]').includes('file:Alpha'), '搜索结束后写入最近搜索');

    // ------------------------------------------------------------- 状态
    view.setSortOrder('byModifiedTime');
    view.setExplainSearch(true);
    const state = view.getState();
    check(state.query === 'file:Alpha', '状态保存查询');
    check(state.matchingCase === false, '状态保存大小写');
    check(state.explainSearch === true, '状态保存解释开关');
    check(state.sortOrder === 'byModifiedTime', '状态保存排序');
    check(typeof view.setState === 'function', '视图提供 setState');
    check(state.collapseAll === view._collapseAll, '状态保存折叠全部');
    check(state.extraContext === view._extraContext, '状态保存上下文开关');
    await view.setState({
      query: 'task-todo:open',
      matchingCase: true,
      explainSearch: false,
      collapseAll: true,
      extraContext: true,
      sortOrder: 'alphabetical',
    });
    check(view.inputEl.value === 'task-todo:open', 'setState 恢复查询到输入框');
    check(view._matchCase === true, 'setState 恢复大小写');
    check(view._explain === false, 'setState 恢复解释开关');
    check(view._collapseAll === true, 'setState 恢复折叠全部');
    check(view._extraContext === true, 'setState 恢复上下文开关');
    check(view._sortOrder === 'alphabetical', 'setState 恢复排序');
    check(view.childrenEl.querySelectorAll('.search-result.is-collapsed').length === view.childrenEl.querySelectorAll('.search-result').length, 'setState 后结果按折叠全部呈现');

    await view.setState({
      query: 'alpha',
      matchingCase: false,
      explainSearch: true,
      collapseAll: false,
      extraContext: false,
      sortOrder: 'alphabetical',
    });

    result.ok = true;
    result.pass = true;
    result.count = checks.length;
    result.files = files.map((file) => file.path);
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    return { pass: true, count: checks.length, checks, reportPath };
  } finally {
    if (originalOpenFile) workspace.openFile = originalOpenFile;
    if (leaf && view && view.toggle) {
      // 保留视图供截图钩子使用，不主动关闭。
    }
  }
})();
