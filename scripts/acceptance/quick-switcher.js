/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的 app；--screen light|dark 选择主题（OBS_SIDEBAR_VIEW）。
 * [OUTPUT]: 返回 {pass, checks}；失败抛异常，供 run.mjs 判定。截图前保留快速切换模态。
 * [POS]: quick-switcher 场景。锁 1.14.4（app.js oie/D5/IT、app.css 9953-10018/10193-10273）：
 *         Cmd+O 打开与单实例、prompt 几何/圆角/阴影/边框、输入容器与无 modal-content、
 *         六条指令、最近 10 项与 MRU、空态、文件/别名/未解析/书签行结构与图标、
 *         高亮/排序/分页滚动、创建项与 Enter/Shift+Enter/Cmd+Enter、Esc、清空、Tab 补全、
 *         附件/仅已创建/所有类型三开关，以及浅/深主题下的计算样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const fail = (m) => { throw new Error(m); };
  const ok = (condition, label) => { if (!condition) fail(label); checks.push(label); };
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
  const lang = (localStorage.getItem('language') || 'en').startsWith('zh') ? 'zh' : 'en';
  const L = (zh, en) => (lang === 'zh' ? zh : en);
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();
  const key = (target, k, options = {}) => target.dispatchEvent(new KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...options,
  }));
  const meta = () => (navigator.platform.startsWith('Mac') ? { metaKey: true } : { ctrlKey: true });
  const prompt = () => document.querySelector('.prompt');
  const input = () => prompt() && prompt().querySelector('.prompt-input');
  const rows = () => [...document.querySelectorAll('.prompt .suggestion-item')];
  const titles = () => rows().map((row) => (row.querySelector('.suggestion-title') || row).textContent);
  const type = async (value) => {
    const field = input();
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(40);
  };
  const open = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'o', bubbles: true, cancelable: true, ...meta(),
    }));
    await wait(120);
  };
  const close = async () => {
    if (prompt()) { key(document, 'Escape'); await wait(260); }
  };
  const theme = process.env.OBS_SIDEBAR_VIEW === 'dark' ? 'obsidian' : 'moonstone';
  app.settings.updateAppearance({ theme });
  await wait(200);
  ok(document.body.hasClass(theme === 'obsidian' ? 'theme-dark' : 'theme-light'), '主题类生效（' + theme + '）');

  await app.plugins.enableInternalPlugin('switcher');
  ok(!!app.commands.findCommand('switcher:open'), 'switcher:open 命令已注册');
  ok(app.hotkeyManager.getHotkeys('switcher:open').some((h) => h.key === 'O' && h.modifiers.includes('Mod')), 'switcher:open 默认 Mod+O');

  /* ------------------------------------------------------------ 建库 */
  const mk = (path, text) => app.vault.create(path, text);
  await app.vault.createFolder('Notes');
  await app.vault.createFolder('Folder');
  await app.vault.createFolder('Bulk');
  await mk('Notes/Alpha.md', '---\naliases:\n  - AA Alias\n---\n# Alpha\n');
  await mk('Notes/Bravo.md', '# Bravo\n');
  await mk('Folder/Charlie.md', '# Charlie\n');
  await mk('Zulu.md', '# Zulu\n');
  await mk('Links.md', '[[Missing Target]]\n');
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  await app.vault.createBinary('Picture.png', png);
  await app.vault.createBinary('Harbor.pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]));
  await app.vault.createBinary('Weird.zip', Uint8Array.from([1, 2, 3, 4]));
  await mk('Board.canvas', JSON.stringify({ nodes: [], edges: [] }));
  for (let i = 1; i <= 22; i++) await mk('Bulk/Item ' + String(i).padStart(2, '0') + '.md', '# Item ' + i + '\n');
  await app.metadataCache.initialize();
  await wait(200);

  const openFile = async (path) => {
    await app.workspace.openFile(app.vault.getFileByPath(path));
    await wait(90);
  };
  await openFile('Zulu.md');
  await openFile('Notes/Alpha.md');
  await openFile('Notes/Bravo.md');
  ok(app.workspace.lastOpenFiles[0] === 'Notes/Bravo.md', 'MRU：最近打开文件在数组首位');

  /* ------------------------------------------------------------ 打开与外壳 */
  await open();
  ok(!!prompt(), 'Cmd+O 打开快速切换');
  ok(document.querySelectorAll('.prompt').length === 1, '同时只存在一个 prompt');
  await open();
  ok(document.querySelectorAll('.prompt').length === 1, '再次 Cmd+O 不叠加（单实例）');
  const modal = prompt();
  const container = modal.closest('.modal-container');
  ok(container && container.hasClass('mod-dim'), '.prompt 位于 .modal-container.mod-dim');
  ok(!modal.querySelector('.modal-content'), 'DOM：无 .modal-content 包裹（原版 OT 清空骨架）');
  ok(!modal.querySelector('.modal-close-button') && !modal.querySelector('.modal-header'), 'DOM：prompt 无标题栏/关闭按钮');

  const box = modal.getBoundingClientRect();
  ok(near(box.width, 700), 'prompt 宽度 700px（实测 ' + box.width + '）');
  ok(near(box.left + box.width / 2, innerWidth / 2), 'prompt 水平居中');
  ok(near(box.top, (innerHeight - innerHeight * 0.7) / 2), 'prompt top = (100vh - 70vh)/2（实测 ' + box.top + '）');
  ok(css(modal, 'border-radius') === '12px', 'prompt 圆角 12px');
  ok(css(modal, 'box-shadow') !== 'none', 'prompt 大阴影 --shadow-l');
  ok(css(modal, 'position') === 'absolute', 'prompt position:absolute');
  ok(css(modal, 'overflow') === 'hidden', 'prompt overflow:hidden');
  ok(css(modal, 'z-index') === '1', 'prompt z-index:1');
  const probe = document.body.createDiv();
  probe.style.color = 'var(--prompt-background)';
  const promptBg = getComputedStyle(probe).color;
  probe.style.color = 'var(--background-modifier-border-hover)';
  const promptBorder = getComputedStyle(probe).color;
  probe.detach();
  ok(css(modal, 'background-color') === promptBg, 'prompt 背景 = --prompt-background');
  ok(css(modal, 'border-top-color') === promptBorder, 'prompt 边框色 = --background-modifier-border-hover（1.14 app.css:2646）');

  const inputEl = input();
  ok(!!inputEl, '存在 .prompt-input');
  ok(inputEl.placeholder === L('输入以切换或创建文件…', 'Find or create a note...'), '占位符：' + inputEl.placeholder);
  ok(inputEl.getBoundingClientRect().height >= 40, '输入框高度 ≥ 40（padding 24 撑高，实测 ' + inputEl.getBoundingClientRect().height + '）');
  ok(css(inputEl, 'font-size') === '15px', '输入框字号 --font-ui-medium（15px）');
  ok(css(inputEl, 'border-bottom-width') === '1px', '输入框底边框 1px');
  const inputContainer = modal.querySelector('.prompt-input-container');
  ok(!!inputContainer && inputContainer.hasClass('mod-raised'), '输入容器带 mod-raised');
  ok(!!inputContainer.querySelector('.prompt-input-cta'), '输入容器含 .prompt-input-cta');
  ok(!!inputContainer.querySelector('.search-input-clear-button'), '输入容器含清空按钮');
  const resultsEl = () => prompt().querySelector('.prompt-results');
  ok(!!resultsEl() && resultsEl().parentElement === modal, '.prompt-results 直挂 prompt');
  ok(css(resultsEl(), 'padding-top') === '12px' && css(resultsEl(), 'padding-left') === '12px', '.prompt-results 内边距 12px');
  ok(css(resultsEl(), 'max-height') === 'none', '.prompt-results 无 300px 上限（原版无 .suggestion-container）');
  const instructions = [...modal.querySelectorAll('.prompt-instruction')];
  ok(instructions.length === 6, '指令栏 6 条（实测 ' + instructions.length + '）');
  const instructionText = instructions.map((el) => [
    el.querySelector('.prompt-instruction-command').textContent,
    el.querySelector('.prompt-instruction-command').nextElementSibling.textContent,
  ]);
  const commands = instructionText.map((pair) => pair[0]);
  ok(commands.join('|') === ['↑↓', '↵', '⌘ ↵', '⌘ ⌥ ↵', 'shift ↵', 'esc'].join('|'), '指令键位顺序：' + commands.join('|'));
  ok(instructionText[0][1] === L('导航', 'to navigate'), '指令 1：导航');
  ok(instructionText[1][1] === L('打开', 'to open'), '指令 2：打开');
  ok(instructionText[2][1] === L('在新标签页中打开', 'to open in new tab'), '指令 3：新标签页');
  ok(instructionText[3][1] === L('在新标签组中打开', 'to open to the right'), '指令 4：新标签组');
  ok(instructionText[4][1] === L('创建', 'to create'), '指令 5：创建');
  ok(instructionText[5][1] === L('退出', 'to dismiss'), '指令 6：退出');
  ok(css(instructions[0].querySelector('.prompt-instruction-command'), 'font-weight') === '600' || Number(css(instructions[0].querySelector('.prompt-instruction-command'), 'font-weight')) > 500, '指令键位加粗（--bold-weight）');
  ok(css(modal.querySelector('.prompt-instructions'), 'border-top-width') === '0px', '指令栏无顶部分隔线（原版 app.css 10002）');

  /* ------------------------------------------------------------ 最近文件 */
  ok(!rows().some((row) => row.querySelector('.suggestion-action')), '空输入无创建项');
  ok(rows().length === 3, '空输入列出 3 个最近文件（实测 ' + rows().length + '）');
  ok(titles()[0] === 'Notes/Bravo' && titles()[1] === 'Notes/Alpha' && titles()[2] === 'Zulu', '最近文件 MRU 顺序：' + titles().join(' | '));
  ok(rows()[0].hasClass('is-selected') && !rows()[1].hasClass('is-selected'), '默认选中第一行');
  ok(resultsEl().scrollTop === 0, '默认滚动位置 0');
  ok(css(rows()[0], 'padding-top') === '6px' && css(rows()[0], 'padding-left') === '12px', '建议项内边距 6px 12px');
  ok(css(rows()[0], 'border-radius') === '4px', '建议项圆角 4px');
  ok(css(rows()[0], 'font-size') === '15px', '建议项字号 15px');
  ok(near(rows()[0].getBoundingClientRect().height, 31.5, 1.5), '建议项行高 ≈31.5px（1.3 行高 + 6px 上下内边距，实测 ' + rows()[0].getBoundingClientRect().height + '）');
  const clearBtn = modal.querySelector('.search-input-clear-button');
  ok(css(clearBtn, 'display') === 'flex', '清空按钮常显（原版 app.css 17288）');
  const clearAfter = getComputedStyle(clearBtn, '::after');
  ok(clearAfter.content !== 'none' && clearAfter.width === '17px', '清空按钮为 17px 圆形 ×（mask）');
  const selectedBg = (() => {
    const p = document.body.createDiv();
    p.style.color = 'var(--background-modifier-hover)';
    const color = getComputedStyle(p).color;
    p.detach();
    return color;
  })();
  ok(css(rows()[0], 'background-color') === selectedBg, '选中项底色 = --background-modifier-hover');

  const firstRow = rows()[0];
  const firstTitle = firstRow.querySelector('.suggestion-title');
  ok(firstRow.hasClass('mod-complex'), '文件行为 .suggestion-item.mod-complex');
  ok(firstRow.querySelector('.suggestion-content') && firstRow.querySelector('.suggestion-aux'), '行内 content + aux 两列');
  ok(firstTitle.textContent === 'Notes/Bravo', 'md 标题去扩展名：' + firstTitle.textContent);
  const fileFlair = firstRow.querySelector('.suggestion-aux .suggestion-flair');
  ok(!!fileFlair && fileFlair.childNodes.length === 0, '文件行 aux 为空 flair（原版无图标）');
  ok(css(firstRow.querySelector('.suggestion-content'), 'flex-direction') === 'column', 'content 列布局');

  /* ------------------------------------------------------------ 输入过滤与高亮 */
  await type('alp');
  ok(rows().length === 1 && titles()[0] === 'Notes/Alpha', '输入过滤到 Alpha（' + titles().join(' | ') + '）');
  const highlight = rows()[0].querySelectorAll('.suggestion-highlight');
  const highlighted = [...highlight].map((el) => el.textContent).join('');
  ok(highlight.length > 0 && 'Notes/Alpha'.includes(highlighted), '标题命中片段高亮：' + highlighted);
  ok(css(highlight[0], 'font-weight') === css(rows()[0], 'font-weight') || Number(css(highlight[0], 'font-weight')) >= 600, '高亮为粗体');
  const titleText = rows()[0].querySelector('.suggestion-title').textContent;
  ok(titleText === 'Notes/Alpha', '高亮不破坏标题文本完整性');

  await type('brvo');
  ok(rows().length >= 1 && titles()[0] === 'Notes/Bravo', '模糊子序列 brvo → Bravo');
  await type('folder');
  ok(rows().some((row) => row.querySelector('.suggestion-title').textContent === 'Folder/Charlie'), '目录名可命中文件');
  await type('notes');
  ok(rows().every((row) => row.querySelector('.suggestion-title').textContent.startsWith('Notes/')), '目录查询结果全部位于 Notes/');
  await type('bravo');
  ok(titles()[0] === 'Notes/Bravo', 'basename 命中排第一');

  await type('Harbor');
  ok(rows().length === 1 && titles()[0] === 'Harbor.pdf', 'PDF 附件显示（showAttachments 默认 true）');
  ok(!rows()[0].querySelector('.suggestion-aux svg'), '附件行同样无图标');
  await type('Picture');
  ok(titles()[0] === 'Picture.png', '图片附件显示');
  await type('Board');
  ok(titles()[0] === 'Board.canvas', 'Canvas 显示');
  await type('Weird');
  ok(rows().length === 1 && rows()[0].querySelector('.suggestion-action'), '未注册类型默认隐藏（只剩创建项）');
  ok(rows()[0].querySelector('.suggestion-title').textContent === 'Weird', '隐藏时创建项标题 = 原始输入');

  /* ------------------------------------------------------------ 别名 / 未解析 / 创建项 */
  await type('AA Alias');
  ok(rows().some((row) => row.querySelector('.suggestion-title').textContent === 'AA Alias'), '别名可搜索');
  const aliasRow = rows().find((row) => row.querySelector('.suggestion-title').textContent === 'AA Alias');
  ok(aliasRow.querySelector('.suggestion-note') && aliasRow.querySelector('.suggestion-note').textContent === 'Notes/Alpha', '别名行 note = 去扩展名路径');
  ok(aliasRow.querySelector('.suggestion-flair svg'), '别名行带 lucide-forward 图标');
  ok(aliasRow.querySelector('.suggestion-flair svg').classList.contains('lucide-forward'), '别名图标类名 lucide-forward');

  await type('Missing');
  const unresolvedRow = rows().find((row) => row.querySelector('.suggestion-title').textContent === 'Missing Target');
  ok(!!unresolvedRow, '未解析链接可搜索');
  ok(unresolvedRow.querySelector('.suggestion-flair svg').classList.contains('lucide-file-plus'), '未解析行图标 lucide-file-plus');
  ok(unresolvedRow.querySelector('.suggestion-flair').getAttribute('aria-label') === L('该笔记尚未创建，选择以创建', 'Not created yet, select to create'), '未解析行 tooltip 文案');

  await type('Brand New');
  ok(rows().length === 1, '无匹配时仅一个创建项');
  const createRow = rows()[0];
  ok(createRow.querySelector('.suggestion-title').textContent === 'Brand New', '创建项标题 = 输入值');
  ok(createRow.querySelector('.suggestion-action').textContent === L('创建该笔记', 'Enter to create'), '创建项右侧动作文案');
  ok(css(createRow.querySelector('.suggestion-action'), 'color') === (() => { const p = document.body.createDiv(); p.style.color = 'var(--interactive-accent)'; const c = getComputedStyle(p).color; p.detach(); return c; })(), '创建动作使用 --interactive-accent');
  key(inputEl, 'Enter');
  await wait(350);
  const created = app.vault.getFileByPath('Brand New.md');
  ok(!!created, 'Enter 创建笔记 Brand New.md');
  ok(!prompt(), '创建后模态关闭');
  ok(app.workspace.getActiveFile()?.path === 'Brand New.md', '创建后打开新笔记');

  /* ------------------------------------------------------------ 键盘与分页 */
  await open();
  ok(input().value === '', '重开时输入已清空');
  await type('Item');
  ok(rows().length === 20, '结果上限 20 项（实测 ' + rows().length + '）');
  ok(rows()[0].hasClass('is-selected'), '重新查询后选中第一项');
  key(input(), 'ArrowDown');
  ok(rows()[1].hasClass('is-selected') && !rows()[0].hasClass('is-selected'), '↓ 选中第二项');
  key(input(), 'ArrowUp');
  ok(rows()[0].hasClass('is-selected'), '↑ 回到第一项');
  key(input(), 'ArrowUp');
  ok(rows()[19].hasClass('is-selected'), '↑ 在首项环绕到末项');
  key(input(), 'ArrowDown');
  ok(rows()[0].hasClass('is-selected'), '↓ 在末项环绕到首项');
  key(input(), 'End');
  ok(rows()[19].hasClass('is-selected'), 'End 选中末项');
  const scrollInfo = 'top=' + resultsEl().scrollTop + ' clientH=' + resultsEl().clientHeight + ' scrollH=' + resultsEl().scrollHeight + ' promptTop=' + prompt().scrollTop + ' promptClient=' + prompt().clientHeight + ' promptScrollH=' + prompt().scrollHeight;
  ok(resultsEl().scrollTop > 0, 'End 后结果区滚动（' + scrollInfo + '）');
  const resultsBox = resultsEl().getBoundingClientRect();
  const lastBox = rows()[19].getBoundingClientRect();
  ok(lastBox.bottom <= resultsBox.bottom + 1 && lastBox.top >= resultsBox.top - 1, '键盘选中项完整可见（scrollIntoView nearest）');
  key(input(), 'Home');
  ok(rows()[0].hasClass('is-selected'), 'Home 选中首项');
  ok(resultsEl().scrollTop < 40, 'Home 回到列表顶部附近（scrollTop=' + resultsEl().scrollTop + '）');
  if (navigator.platform.startsWith('Mac')) {
    key(input(), 'n', { ctrlKey: true });
    ok(rows()[1].hasClass('is-selected'), 'Ctrl+N 下移');
    key(input(), 'p', { ctrlKey: true });
    ok(rows()[0].hasClass('is-selected'), 'Ctrl+P 上移');
  }
  key(input(), 'PageDown');
  ok(rows().findIndex((row) => row.hasClass('is-selected')) > 0, 'PageDown 跳页');
  ok(resultsEl().scrollTop > 0, 'PageDown 触发滚动');
  key(input(), 'PageUp');
  ok(rows()[0].hasClass('is-selected'), 'PageUp 回到首项');

  /* ------------------------------------------------------------ Tab 补全 */
  await type('alp');
  key(input(), 'Tab');
  await wait(60);
  ok(input().value === 'Notes/Alpha', 'Tab 补全为完整路径（去 .md）：' + input().value);
  key(input(), 'Tab');
  await wait(60);
  ok(input().value === 'Notes/Alpha/', '再次 Tab 追加 /');
  await type('alp');
  ok(rows()[0].hasClass('is-selected'), '补全后仍可重新过滤');

  /* ------------------------------------------------------------ Enter / Cmd+Enter */
  const leavesBefore = app.workspace.getLeavesOfType('markdown').length;
  await type('Zulu');
  key(input(), 'Enter');
  await wait(300);
  ok(!prompt(), 'Enter 关闭模态');
  ok(app.workspace.getActiveFile()?.path === 'Zulu.md', 'Enter 打开选中笔记');
  ok(app.workspace.getLeavesOfType('markdown').length === leavesBefore, 'Enter 复用当前标签页');

  await open();
  await type('Charlie');
  const leavesBeforeMod = app.workspace.getLeavesOfType('markdown').length;
  key(input(), 'Enter', meta());
  await wait(300);
  ok(app.workspace.getActiveFile()?.path === 'Folder/Charlie.md', 'Cmd+Enter 打开选中笔记');
  ok(app.workspace.getLeavesOfType('markdown').length === leavesBeforeMod + 1, 'Cmd+Enter 新建标签页');

  /* ------------------------------------------------------------ Shift+Enter 创建 */
  await open();
  await type('Sharpen');
  key(input(), 'Enter', { shiftKey: true });
  await wait(350);
  ok(!!app.vault.getFileByPath('Sharpen.md'), 'Shift+Enter 从输入创建笔记');
  ok(app.workspace.getActiveFile()?.path === 'Sharpen.md', 'Shift+Enter 创建后打开');
  await open();
  await type('Sharpen');
  key(input(), 'Enter', { shiftKey: true });
  await wait(350);
  ok(!!app.vault.getFileByPath('Sharpen.md') && !app.vault.getFileByPath('Sharpen 1.md'), '同名输入再次 shift ↵ 解析到已存在笔记，不重复创建');

  /* ------------------------------------------------------------ Esc / 清空按钮 */
  await open();
  await type('Zulu');
  key(document, 'Escape');
  await wait(300);
  ok(!prompt(), 'Esc 关闭模态');
  await open();
  await type('Zulu');
  const clearButton = prompt().querySelector('.search-input-clear-button');
  clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(60);
  ok(prompt() && input().value === '', '清空按钮清空输入并保持模态');
  ok(rows().length > 0 && !rows().some((row) => row.querySelector('.suggestion-action')), '清空后回到最近文件');
  clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(300);
  ok(!prompt(), '输入为空时再次点击清空按钮关闭');

  /* ------------------------------------------------------------ 最近文件上限与空态 */
  await open();
  for (let i = 1; i <= 12; i++) await app.workspace.openFile(app.vault.getFileByPath('Bulk/Item ' + String(i).padStart(2, '0') + '.md'));
  await close();
  await open();
  ok(rows().length === 10, '最近文件最多 10 项（实测 ' + rows().length + '）');
  ok(titles()[0] === 'Bulk/Item 12', '最近文件按 MRU 降序：' + titles()[0]);
  await close();
  const savedRecent = app.workspace.lastOpenFiles;
  app.workspace.lastOpenFiles = [];
  await open();
  const emptyEl = prompt().querySelector('.suggestion-empty');
  ok(!!emptyEl, '无最近文件时显示空态');
  ok(emptyEl.textContent === L('未找到最近文件。输入以搜索…', 'No recent files found. Type to search...'), '空态文案：' + emptyEl.textContent);
  ok(rows().length === 0, '空态下无建议项');
  await close();
  app.workspace.lastOpenFiles = savedRecent;

  /* ------------------------------------------------------------ 选项 */
  const instance = app.plugins.getInternalPlugin('switcher').instance;
  const options = instance.getOptions();
  const savedOptions = { ...options };
  options.showAttachments = false;
  await open();
  await type('Harbor');
  ok(!rows().some((row) => row.querySelector('.suggestion-title').textContent === 'Harbor.pdf'), 'showAttachments=false 隐藏 PDF');
  await type('Picture');
  ok(!rows().some((row) => row.querySelector('.suggestion-title').textContent === 'Picture.png'), 'showAttachments=false 隐藏图片');
  await close();
  Object.assign(options, savedOptions);

  options.showExistingOnly = true;
  await open();
  await type('Missing');
  ok(!rows().some((row) => row.querySelector('.suggestion-flair svg.lucide-file-plus')), 'showExistingOnly=true 隐藏未解析链接');
  ok(rows().some((row) => row.querySelector('.suggestion-action')), 'showExistingOnly=true 时无匹配落到创建项');
  await close();
  Object.assign(options, savedOptions);

  options.showAllFileTypes = true;
  await open();
  await type('Weird');
  ok(rows().some((row) => row.querySelector('.suggestion-title').textContent === 'Weird.zip'), 'showAllFileTypes=true 显示 zip');
  await close();
  Object.assign(options, savedOptions);

  /* ------------------------------------------------------------ 书签（存在时） */
  const bookmarksEntry = app.plugins.getInternalPlugin('bookmarks');
  if (bookmarksEntry && bookmarksEntry.enabled && bookmarksEntry.instance) {
    await open();
    await type('Zulu');
    ok(rows().some((row) => row.querySelector('.suggestion-title').textContent === 'Zulu'), '书签插件启用时文件建议仍正常');
    await close();
  }

  /* ------------------------------------------------------------ 截图前留景 */
  await open();
  await type('alp');
  ok(!!prompt() && rows().length >= 1, '截图前保持打开与过滤态');
  const live = prompt();
  const liveItem = live.querySelector('.suggestion-item');
  const liveInput = live.querySelector('.prompt-input');
  const ourMetrics = {
    viewport: { width: innerWidth, height: innerHeight },
    prompt: {
      rect: (() => { const r = live.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) }; })(),
      background: css(live, 'background-color'),
      color: css(live, 'color'),
      borderTop: css(live, 'border-top-width') + ' ' + css(live, 'border-top-color'),
      borderRadius: css(live, 'border-radius'),
      boxShadow: css(live, 'box-shadow'),
      top: css(live, 'top'),
    },
    input: {
      height: css(liveInput, 'height'),
      fontSize: css(liveInput, 'font-size'),
      padding: css(liveInput, 'padding'),
      borderBottom: css(liveInput, 'border-bottom-width') + ' ' + css(liveInput, 'border-bottom-color'),
    },
    item: {
      height: +liveItem.getBoundingClientRect().height.toFixed(2),
      padding: css(liveItem, 'padding'),
      borderRadius: css(liveItem, 'border-radius'),
      fontSize: css(liveItem, 'font-size'),
      background: css(liveItem, 'background-color'),
    },
    instructions: {
      padding: css(live.querySelector('.prompt-instructions'), 'padding'),
      gap: css(live.querySelector('.prompt-instructions'), 'gap'),
      fontSize: css(live.querySelector('.prompt-instructions'), 'font-size'),
      color: css(live.querySelector('.prompt-instructions'), 'color'),
      borderTopWidth: css(live.querySelector('.prompt-instructions'), 'border-top-width'),
    },
  };
  return {
    pass: true,
    theme,
    checks,
    count: checks.length,
    screenshotState: { query: input().value, rows: titles() },
    ourMetrics,
  };
})()
