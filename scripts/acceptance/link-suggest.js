/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回单列 [[链接]] 浮窗的 DOM/几何/键盘/过滤断言；失败抛出异常，供运行器判定。
 * [POS]: link-suggest 场景。只用 Input.insertText 等价路径（execCommand insertText）与 KeyboardEvent；不直接调用 LinkSuggest 内部方法。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (value, label) => {
    if (!value) throw new Error('✗ ' + label);
    checks.push(label);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
  const has = (el, cls) => !!el && el.classList.contains(cls);
  const note = await app.vault.create('Note.md', '# Note\n\n## Section A\n\nBody text ^block-a\n');
  const scratch = await app.vault.create('Scratch.md', '');
  await app.vault.create('Other.md', '# Other\n\n## Section B\n\nOther body ^block-b\n');
  await app.vault.createFolder('Folder');
  await app.vault.create('Folder/Deep.md', '# Deep\n\n## Heading D\n');
  await app.vault.create('Aliased.md', '---\naliases:\n  - Alias One\n---\n# Aliased\n');
  await app.vault.create('NoBlocks.md', '# No Blocks\n');
  await app.vault.create('Plain.md', 'Just text without a heading\n');
  await app.vault.create('Source.md', '[[Ghost Target]]\n');
  await app.vault.createFolder('DupA');
  await app.vault.createFolder('DupB');
  await app.vault.create('DupA/Dupe.md', '# Dupe A\n');
  await app.vault.create('DupB/Dupe.md', '# Dupe B\n');
  for (let index = 1; index <= 20; index += 1) {
    await app.vault.create('Bulk' + String(index).padStart(2, '0') + '.md', '');
  }
  const leaf = app.workspace.getLeaf('tab');
  await leaf.setViewState({ type: 'markdown', state: { file: scratch.path, mode: 'source' } });
  app.workspace.revealLeaf(leaf);
  await wait(600);
  // 原版对照值取自 light 主题（#fff / #e4e4e4 / #5c5c5c）；E2E 默认跟随系统深色，这里固定 light。
  document.body.removeClass('theme-dark');
  document.body.addClass('theme-light');
  const view = leaf.view;
  const editor = view.editor;
  const content = editor.cm.contentDOM;
  editor.focus();
  content.focus();
  const type = async (text) => {
    editor.focus();
    content.focus();
    const ok = document.execCommand('insertText', false, text);
    await wait(180);
    return ok;
  };
  const reset = async (text, ch = text.length) => {
    editor.setValue(text);
    editor.setCursor({ line: 0, ch });
    editor.focus();
    content.focus();
    await wait(120);
  };
  const container = () => document.querySelector('.suggestion-container');
  const items = () => Array.from(document.querySelectorAll('.suggestion-container .suggestion-item'));
  const selected = () => document.querySelector('.suggestion-container .suggestion-item.is-selected');

  await reset('');
  check(await type('[[Not'), 'execCommand insertText 生效（真实输入路径）');
  check(!!container(), '输入 [[Not 后出现 .suggestion-container :: doc=' + JSON.stringify(editor.getValue()) + ' focus=' + editor.cm.hasFocus);
  check(container().parentElement === document.body, '浮窗挂在 body（原版 attachDom）');
  check(has(container(), 'link-suggest'), '浮窗带 link-suggest 标识');
  check(!document.querySelector('.cm-completionInfo'), '没有 cm-completionInfo 第二列');
  check(!document.querySelector('.cm-tooltip-autocomplete'), '没有 CM6 autocomplete 列表');
  check(document.querySelectorAll('.suggestion-container .suggestion').length === 1, '只有一个 .suggestion 列');
  check(items().length > 0, '候选非空');
  const first = items()[0];
  check(has(first, 'mod-complex'), '条目带 mod-complex');
  check(first.children.length === 2, '条目只有 content + aux 两段');
  check(first.children[0].className === 'suggestion-content', '第一段是 suggestion-content');
  check(first.children[0].children[0].className === 'suggestion-title', '标题节点');
  check(first.children[0].children[1].className === 'suggestion-note', '灰色路径节点');
  check(first.children[1].className === 'suggestion-aux', '辅助节点');
  check(first.textContent.includes('Note'), '过滤出 Note');
  const cr = container().getBoundingClientRect();
  check(near(cr.width, 382.8, 1), '容器宽度由内容收缩为 382.8（' + cr.width + '）');
  check(near(cr.height, 78.1, 1), '单条文件建议容器高 78.1（' + cr.height + '）items=' + items().map((el) => el.textContent).join('|'));
  const head = editor.cm.state.selection.main.head;
  const line = editor.cm.state.doc.lineAt(head);
  const beforeCursor = line.text.slice(0, head - line.from);
  const queryStart = line.from + beforeCursor.lastIndexOf('[[') + 2;
  const startCoords = editor.cm.coordsAtPos(queryStart);
  const cursor = editor.cm.coordsAtPos(head);
  const anchorLeft = Math.min(startCoords.left, cursor.left);
  const clampLeft = Math.max(10, Math.min(anchorLeft, document.body.clientWidth - 10 - cr.width));
  check(near(cr.left, clampLeft), '浮窗左缘对齐查询起点并受 10px 视口边距钳制（' + cr.left + ' / ' + clampLeft + '）');
  check(near(cr.top, cursor.bottom + 5), '浮窗顶缘=光标底+5（' + cr.top + ' / ' + (cursor.bottom + 5) + '）');
  const style = getComputedStyle(container());
  check(style.position === 'absolute', '容器 absolute');
  check(parseFloat(style.maxWidth) === 500, '容器 max-width 500');
  check(parseFloat(style.maxHeight) === 300, '容器 max-height 300');
  check(parseFloat(style.borderRadius) === 8, '容器圆角 8');
  check(style.borderTopWidth === '1px', '容器 1px 边框');
  check(style.padding === '0px', '容器 padding 0');
  check(style.overflow === 'hidden', '容器 overflow hidden');
  check(style.boxShadow !== 'none', '容器有 shadow-s');
  check(style.display === 'flex', '容器 flex');
  check(style.flexDirection === 'column', '容器纵向 flex');
  const suggestionStyle = getComputedStyle(document.querySelector('.suggestion-container .suggestion'));
  check(suggestionStyle.padding === '6px', '.suggestion padding 6 :: ' + suggestionStyle.padding + ' / ' + suggestionStyle.paddingLeft);
  check(suggestionStyle.overflowY === 'auto', '.suggestion 纵向滚动');
  const is = getComputedStyle(first);
  check(is.padding === '6px 12px', '条目 padding 6 12');
  check(parseFloat(is.borderRadius) === 4, '条目圆角 4');
  check(is.fontSize === '15px', '条目字号 15');
  check(is.lineHeight === '19.5px', '条目行高 19.5');
  check(is.display === 'flex', '条目 flex');
  const ts = getComputedStyle(first.querySelector('.suggestion-title'));
  check(ts.fontSize === '15px' && ts.lineHeight === '19.5px', '标题 15/19.5');
  const ns = getComputedStyle(first.querySelector('.suggestion-note'));
  check(ns.fontSize === '12px' && ns.lineHeight === '15.6px', '路径 12/15.6');
  check(ns.color === 'rgb(92, 92, 92)', '路径颜色 #5c5c5c :: ' + ns.color);
  const instr = document.querySelector('.suggestion-container .prompt-instructions');
  check(!!instr, '底部有 prompt-instructions');
  check(instr.querySelectorAll('.prompt-instruction').length === 3, '文件模式三条指令');
  check(instr.querySelectorAll('.prompt-instruction-command')[0].textContent === '输入 #', '指令1 输入 #');
  check(instr.querySelectorAll('.prompt-instruction')[0].textContent === '输入 #可以链接到标题', '指令1 文案');
  check(instr.querySelectorAll('.prompt-instruction')[1].textContent === '输入 ^链接文本块', '指令2 文案');
  check(instr.querySelectorAll('.prompt-instruction')[2].textContent === '输入 |指定显示的文本', '指令3 文案');
  const ins = getComputedStyle(instr);
  check(ins.fontSize === '12px' && ins.lineHeight === '15.6px', '指令栏 12/15.6');
  check(ins.padding === '8px', '指令栏 padding 8');
  check(ins.gap === '12px', '指令栏 gap 12');
  check(parseFloat(getComputedStyle(instr.querySelector('.prompt-instruction-command')).fontWeight) >= 600, '指令快捷键加粗');
  check(style.backgroundColor === 'rgb(255, 255, 255)', 'light 主题容器背景 #fff');
  check(style.borderTopColor === 'rgb(228, 228, 228)', 'light 主题边框 #e4e4e4');
  check(style.zIndex === '60', '容器 z-index 60（layer-notice）');
  check(style.boxShadow.includes('rgba'), '容器阴影为 shadow-s');
  check(near(parseFloat(getComputedStyle(first.querySelector('.suggestion-note')).height), 0, 0.1), '根目录文件 note 高度 0');

  const titleOf = (el) => el.querySelector('.suggestion-title').textContent;
  const noteOf = (el) => el.querySelector('.suggestion-note').textContent;
  const key = async (name, extra = {}) => {
    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: name, bubbles: true, cancelable: true, ...extra,
    }));
    await wait(140);
  };
  const hover = async (el) => {
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
    await wait(40);
  };
  const click = async (el) => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(180);
  };

  // ---- 空查询、选择与滚动 ------------------------------------------------
  await reset('');
  await type('[[');
  check(!selected(), '空查询 [[ 不预选任何行（原版 forceSetSelectedItem(-1)）');
  check(items().length >= 25, '空查询列出全部文件与别名（' + items().length + '）');
  check(items().some((el) => titleOf(el) === 'Aliased') && items().some((el) => titleOf(el) === 'Alias One'), '带别名的文件同时保留文件项与别名项');
  check(document.querySelector('.suggestion-container .suggestion').scrollHeight >
    document.querySelector('.suggestion-container .suggestion').clientHeight, '超过 300px 时 .suggestion 内部滚动');
  check(near(container().getBoundingClientRect().height, 300, 1), '大量条目时容器封顶 300');
  await key('ArrowDown');
  check(!!selected() && selected() === items()[0], 'ArrowDown 从无选择落到第一项');
  await key('ArrowUp');
  check(selected() === items()[items().length - 1], 'ArrowUp 从第一项回绕到最后一项');
  await key('Home');
  check(selected() === items()[0], 'Home 选第一项');
  await key('End');
  check(selected() === items()[items().length - 1], 'End 选最后一项');
  await key('ArrowDown');
  check(selected() === items()[0], 'ArrowDown 从最后一项回绕到第一项');
  await key('End');
  check(document.querySelector('.suggestion-container .suggestion').scrollTop > 0, '选中末项时列表滚动到可见位置');

  await reset('');
  await type('[[');
  const second = items()[1];
  await hover(second);
  check(selected() === second, '鼠标悬停切换选中行');

  // ---- 过滤 ----------------------------------------------------------------
  await reset('');
  await type('[[Not');
  check(items().length === 1 && titleOf(items()[0]) === 'Note', '输入继续过滤到 Note');
  check(selected() === items()[0], '非空查询预选第一项');
  await type('e');
  check(titleOf(items()[0]) === 'Note', '续输 e 保持 Note');
  await type('x');
  check(items().length === 1 && titleOf(items()[0]) === '未找到匹配结果', '无匹配显示原版空态文案');
  check(noteOf(items()[0]) === '', '空态 note 为空');
  check(!items()[0].classList.contains('suggestion-empty'), '空态不是 .suggestion-empty（原版为普通 mod-complex 项）');
  check(!!selected(), '非空查询的空态项可被选中');

  await reset('');
  await type('[[note');
  check(items().length === 1 && titleOf(items()[0]) === 'Note', '过滤大小写不敏感');

  await reset('');
  await type('[[Ot');
  const highlight = items()[0].querySelector('.suggestion-title .suggestion-highlight');
  check(titleOf(items()[0]) === 'Other' && !!highlight, '匹配字符渲染 suggestion-highlight');
  check(highlight.textContent === 'Ot', '高亮区间与查询一致');

  await reset('');
  await type('[[Deep');
  check(titleOf(items()[0]) === 'Deep', '子目录文件标题=basename');
  check(noteOf(items()[0]) === 'Folder/', '子目录文件 note=目录+斜杠');
  check(parseFloat(getComputedStyle(items()[0].querySelector('.suggestion-note')).height) > 15, '两行条目 note 有高度');
  check(near(items()[0].getBoundingClientRect().height, 47.1, 1), '两行条目高 47.1');
  check(near(container().getBoundingClientRect().height, 93.7, 1), '两行条目容器高 93.7');
  await key('Enter');
  check(editor.getValue() === '[[Deep]]', '子目录文件插入最短链接 [[Deep]]');
  check(!container(), '回车后浮窗关闭');

  await reset('');
  await type('[[Dupe');
  check(items().length === 2, '同名 basename 出现两条候选');
  check(items().every((el) => /^Dup[AB]\/$/.test(noteOf(el))), '同名候选 note 显示各自目录');
  await key('Enter');
  check(/^\[\[Dup[AB]\/Dupe\|Dupe\]\]$/.test(editor.getValue()), '非唯一路径自动补显示文本 [[DupX/Dupe|Dupe]]');

  await reset('');
  await type('[[Ghost');
  check(items().length === 1 && titleOf(items()[0]) === 'Ghost Target', '未创建但被引用的目标进入 linktext 补全');
  check(noteOf(items()[0]) === '', 'linktext 条目 note 为空');
  await key('Enter');
  check(editor.getValue() === '[[Ghost Target]]', 'linktext 插入原始目标文本');

  // ---- Enter / Tab / Shift+Enter / 点击 ------------------------------------
  await reset('');
  await type('[[Note');
  await key('Tab');
  check(editor.getValue() === '[[Note]]', 'Tab 接受选中项');
  check(editor.getCursor().ch === 8, 'Tab 后光标在 ]] 之后');
  check(!container(), 'Tab 后浮窗关闭');

  await reset('');
  await type('[[Oth');
  await key('Enter');
  check(editor.getValue() === '[[Other]]', 'Enter 接受选中项');
  check(!container(), 'Enter 后浮窗关闭');

  await reset('');
  await type('![[Note');
  await key('Enter');
  check(editor.getValue() === '![[Note]]', '嵌入前缀 ! 保留');

  await reset('');
  await type('[[Brand New');
  await key('Enter', { shiftKey: true });
  check(editor.getValue() === '[[Brand New]]', 'Shift+Enter 接受原始查询文本');

  await reset('');
  await type('[[');
  await key('Enter');
  check(editor.getValue() === '[[\n', '空查询无选中时 Enter 交给编辑器换行');
  check(!container(), '换行后浮窗关闭');

  await reset('');
  await type('[[Note');
  await click(items()[0]);
  check(editor.getValue() === '[[Note]]', '点击条目接受');
  check(!container(), '点击后浮窗关闭');

  // ---- 关闭路径 ------------------------------------------------------------
  await reset('');
  await type('[[Note');
  await key('Escape');
  check(!container(), 'Esc 关闭浮窗');
  check(editor.getValue() === '[[Note', 'Esc 不改写文档');

  await reset('');
  await type('[[Note');
  content.dispatchEvent(new FocusEvent('blur'));
  await wait(80);
  check(!container(), '编辑器失焦关闭浮窗');

  await reset('');
  await type('[[Note');
  window.dispatchEvent(new Event('blur'));
  await wait(80);
  check(!container(), '窗口失焦关闭浮窗');

  await reset('');
  await type('[[Note');
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await wait(80);
  check(!container(), '点击浮窗外关闭');

  await reset('');
  await type('[[Note');
  content.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await wait(80);
  check(!container(), '点击编辑器关闭浮窗');

  await reset('');
  await type('[[Note');
  editor.setCursor({ line: 0, ch: 0 });
  await wait(120);
  check(!container(), '光标移出 [[ 范围后关闭');

  // ---- 标题 # --------------------------------------------------------------
  await reset('');
  await type('[[Note#');
  check(document.querySelectorAll('.suggestion-container .prompt-instruction').length === 1, '标题模式只有一条 ↵ 指令');
  check(document.querySelector('.suggestion-container .prompt-instructions').textContent === '↵接受', '标题模式指令文案 ↵ 接受');
  check(items().some((el) => titleOf(el) === 'Note'), '本地标题包含 H1 Note');
  const sectionA = items().find((el) => titleOf(el) === 'Section A');
  check(!!sectionA, '本地标题包含 Section A');
  check(sectionA.querySelector('.suggestion-aux').textContent === 'H2', '标题等级 H2 显示在 aux');
  check(noteOf(sectionA) === '', '本地标题 note 为空（原版 !global 不填路径）');
  check(parseFloat(getComputedStyle(sectionA.querySelector('.suggestion-note')).height) === 0, '本地标题 note 高度 0');
  await type('Sec');
  check(items().length === 1 && titleOf(items()[0]) === 'Section A', '# 后继续过滤标题');
  check(items()[0].querySelector('.suggestion-highlight').textContent === 'Sec', '标题高亮匹配');
  await key('Enter');
  check(editor.getValue() === '[[Note#Section A]]', '标题插入 [[Note#Section A]]');
  check(editor.getCursor().ch === 18, '标题插入后光标在 ]] 之后');

  await reset('');
  await type('[[Note');
  await key('#', { shiftKey: true });
  check(editor.getValue() === '[[Note#]]', '# 键先接受文件并补出 [[Note#]]');
  check(editor.getCursor().ch === 7, '# 接受后光标在 ]] 之前');
  check(!!container() && document.querySelectorAll('.suggestion-container .prompt-instruction').length === 1, '# 接受后立即进入标题模式');
  await type('Sec');
  check(editor.getValue() === '[[Note#Sec]]', '在预置 ]] 内继续输入标题');
  await key('Enter');
  check(editor.getValue() === '[[Note#Section A]]', '标题接受吞掉已有 ]] 不重复');
  check(!container(), '标题接受后关闭');

  await reset('');
  await type('[[#');
  check(items().length === 1 && titleOf(items()[0]) === '小标题', '空文件 [[# 返回 小标题 空态');
  check(noteOf(items()[0]) === '', '空文件标题 note 为空');

  await reset('');
  await type('[[##');
  check(document.querySelectorAll('.suggestion-container .prompt-instruction').length === 1, '全局标题模式单条指令');
  const globalNote = items().find((el) => titleOf(el) === 'Note');
  check(!!globalNote, '[[## 聚合全库标题');
  check(noteOf(globalNote) === 'Note', '全局标题 note=文件路径');
  check(globalNote.querySelector('.suggestion-aux').textContent === 'H1', '全局标题 aux=H1');
  await type('Sec');
  check(items().length === 2, '全局标题按 Sec 过滤出两条');
  await key('Enter');
  check(/^\[\[(Note|Other)#Section [AB]\]\]$/.test(editor.getValue()), '全局标题插入带文件名的链接');

  await reset('');
  await type('[[Plain#');
  check(titleOf(items()[0]) === '小标题', '无标题文件返回 小标题');
  check(!!items()[0].querySelector('.suggestion-empty-suggestion'), '小标题使用 suggestion-empty-suggestion');
  check(noteOf(items()[0]) === '', '小标题 fallback note 为空');

  // ---- 显示文本 | ----------------------------------------------------------
  await reset('');
  await type('[[Note|');
  check(document.querySelectorAll('.suggestion-container .prompt-instruction').length === 1, '显示文本模式单条指令');
  check(titleOf(items()[0]) === '显示文本', '空显示文本回退 显示文本');
  check(!!items()[0].querySelector('.suggestion-empty-suggestion'), '显示文本回退使用 suggestion-empty-suggestion');
  check(noteOf(items()[0]) === 'Note', '显示文本模式 note=目标路径');
  check(!!items()[0].querySelector('.suggestion-aux svg.svg-icon'), '别名条目带 forward 图标');
  await type('Hello');
  check(titleOf(items()[0]) === 'Hello' && noteOf(items()[0]) === 'Note', '输入显示文本实时更新条目');
  await key('Enter');
  check(editor.getValue() === '[[Note|Hello]]', '| 插入显示文本 [[Note|Hello]]');

  await reset('');
  await type('[[Aliased|');
  check(titleOf(items()[0]) === 'Alias One', '目标文件 frontmatter 别名进入显示文本候选');
  check(noteOf(items()[0]) === 'Aliased', '别名条目 note=文件路径');
  await key('Enter');
  check(editor.getValue() === '[[Aliased|Alias One]]', '别名插入 [[Aliased|Alias One]]');

  await reset('');
  await type('[[Note#Section A|Ali');
  check(noteOf(items()[0]) === 'Note#Section A', '显示文本可与标题子路径组合');
  await key('Enter');
  check(editor.getValue() === '[[Note#Section A|Ali]]', '标题+显示文本插入完整链接');

  // ---- 块 ^ ----------------------------------------------------------------
  await reset('');
  await type('[[Note^');
  check(document.querySelectorAll('.suggestion-container .prompt-instruction').length === 1, '块模式单条指令');
  check(titleOf(items()[0]) === 'Body text', '块候选显示真实行内容');
  check(noteOf(items()[0]) === 'block-a', '本地块 note=块 ID');
  check(parseFloat(getComputedStyle(items()[0].querySelector('.suggestion-note')).height) > 15, '块 ID 占第二行');
  await key('Enter');
  check(editor.getValue() === '[[Note#^block-a]]', '块插入 [[Note#^block-a]]');

  await reset('');
  await type('[[Note');
  await key('^', { shiftKey: true });
  check(editor.getValue() === '[[Note^]]', '^ 键先接受文件并补出 [[Note^]]');
  check(editor.getCursor().ch === 7, '^ 接受后光标在 ]] 之前');
  check(!!container() && document.querySelectorAll('.suggestion-container .prompt-instruction').length === 1, '^ 接受后立即进入块模式');
  await type('block');
  await key('Enter');
  check(editor.getValue() === '[[Note#^block-a]]', '^ 模式最终插入块链接');

  await reset('');
  await type('[[Note^block');
  check(items().length === 1 && titleOf(items()[0]) === 'Body text', '块 ID 可过滤候选');
  await key('Enter');
  check(editor.getValue() === '[[Note#^block-a]]', '块 ID 过滤后插入同一链接');

  await reset('');
  await type('[[NoBlocks^');
  check(items().length === 1 && titleOf(items()[0]) === '未找到匹配结果', '无块索引显示原版空态，不造假块');

  await reset('');
  await type('[[^^block');
  check(items().length === 2, '[[^^ 聚合全库块');
  check(items().every((el) => noteOf(el).includes(' > block-')), '全局块 note=路径 > 块 ID');
  await key('Enter');
  check(/^\[\[(Note|Other)#\^block-[ab]\]\]$/.test(editor.getValue()), '全局块插入文件+块 ID');

  // ---- 定位跟随、滚动与缩放 ------------------------------------------------
  editor.setValue('\n\n\n[[Not');
  editor.setCursor({ line: 3, ch: 5 });
  editor.focus();
  content.focus();
  await wait(80);
  await type('e');
  const lineCursor = editor.cm.coordsAtPos(editor.cm.state.selection.main.head);
  check(near(container().getBoundingClientRect().top, lineCursor.bottom + 5, 1), '浮窗随光标所在行定位');
  check(container().getBoundingClientRect().top > 100, '第四行浮窗位于文档下方');

  await reset('');
  const longLines = ['[[Not'];
  for (let index = 0; index < 60; index += 1) longLines.push('line ' + index);
  editor.setValue(longLines.join('\n'));
  editor.setCursor({ line: 0, ch: 5 });
  editor.focus();
  content.focus();
  await wait(80);
  await type('e');
  const beforeScrollTop = container().getBoundingClientRect().top;
  const scroller = editor.cm.scrollDOM;
  scroller.scrollTop = scroller.scrollTop + 100;
  scroller.dispatchEvent(new Event('scroll'));
  await wait(140);
  const afterScroll = container();
  check(!afterScroll || Math.abs(afterScroll.getBoundingClientRect().top - beforeScrollTop) > 20,
    '编辑器滚动时浮窗重新定位或关闭');
  window.dispatchEvent(new Event('resize'));
  await wait(80);
  check(!container() || Number.isFinite(container().getBoundingClientRect().top), '窗口缩放后浮窗位置有效');

  editor.setValue(longLines.join('\n') + '\n[[Not');
  editor.setCursor({ line: longLines.length, ch: 5 });
  editor.scrollIntoView({ from: { line: longLines.length, ch: 5 }, to: { line: longLines.length, ch: 5 } }, true);
  editor.focus();
  content.focus();
  await wait(160);
  await type('e');
  const bottomCursor = editor.cm.coordsAtPos(editor.cm.state.selection.main.head);
  const bottomBox = container().getBoundingClientRect();
  check(bottomBox.bottom <= bottomCursor.top + 1, '底部空间不足时浮窗翻到光标上方');
  check(bottomBox.height <= 300, '翻转后高度不超过 300');

  return { pass: true, count: checks.length, checks };
})()

