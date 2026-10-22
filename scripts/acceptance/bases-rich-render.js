/**
 * [INPUT]: 隔离临时库与 Bases HTML/Markdown 公式、阅读器、MathJax 及 IPC 拦截。
 * [OUTPUT]: {pass,count,checks}；验证富文本、嵌入、链接与脚本隔离。
 * [POS]: 富值渲染验收。只在 --no-screenshot 的真实 Electron 临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message) => { for (let i = 0; i < 500; i++) { if (await fn()) return; await wait(25); } throw Error(message); };
  const yaml = require('js-yaml');
  await app.plugins.enableInternalPlugin('bases');
  await app.vault.createFolder('Rich');
  const target = await app.vault.create('Rich/Target.md', '# Nested heading\n\n**Embedded bold**\n\n$x^2$\n\n<img src=x onerror="window.__basesInjected=99">\n');
  const row = await app.vault.create('Rich/Row.md', '# Row\n');
  await app.vault.create('Rich/Image.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="red"/></svg>');
  await until(() => app.metadataCache.getFileCache(target), '嵌入目标完成索引');
  window.__basesInjected = 0;
  const html = '<h2>HTML heading</h2><table><tr><td>Cell</td></tr></table><strong style="color:rgb(12, 34, 56)">Styled</strong><a href="Target.md">Go</a><img src="Image.svg" onerror="window.__basesInjected=1"><script>window.__basesInjected=2</script><style>body{display:none}</style><a href="javascript:window.__basesInjected=3">Bad</a><iframe src="about:blank" srcdoc="<script>top.__basesInjected=4</script>"></iframe>';
  const markdown = '# Markdown heading\n\n- First\n- **Second**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> [!tip] Tip\n> Callout body\n\n![[Target]]\n\n![[Image.svg]]\n\n$y^2$\n\n- [ ] Generated task\n\n[[Target|Internal]]\n\n[External](https://example.invalid/)\n\n```mermaid\ngraph LR\n A[Start] --> B[End]\n```\n\n<img src=x onerror="window.__basesInjected=5">';
  const file = await app.vault.create('Rich.base', yaml.dump({ filters: 'file.path == "Rich/Row.md"', formulas: { html: 'html(' + JSON.stringify(html) + ')', markdown: 'markdown(' + JSON.stringify(markdown) + ')' }, views: [{ type: 'table', name: 'Rich', order: ['formula.html', 'formula.markdown'] }] }));
  const leaf = await app.workspace.openFile(file);
  const controller = leaf.view.controller;
  await until(() => leaf.view.contentEl.querySelector('.bases-rich-markdown'), '富值节点已挂载');
  const root = leaf.view.contentEl;
  const richHtml = root.querySelector('.bases-rich-html');
  const richMarkdown = root.querySelector('.bases-rich-markdown');
  await richMarkdown.ready;
  await wait(150);
  check(richHtml.querySelector('h2')?.textContent === 'HTML heading', 'HTML 渲染标题而非源码');
  check(richHtml.querySelector('table td')?.textContent === 'Cell', 'HTML 渲染表格');
  check(getComputedStyle(richHtml.querySelector('strong')).color === 'rgb(12, 34, 56)', 'HTML 保留安全行内样式');
  check(!richHtml.querySelector('script,style,object,embed'), 'HTML 移除脚本和全局样式');
  check(!richHtml.querySelector('[onerror],[onclick],[srcdoc]'), 'HTML 移除事件属性与 srcdoc');
  check(![...richHtml.querySelectorAll('a')].some(a => /^javascript:/i.test(a.getAttribute('href') || '')), 'HTML 移除脚本协议');
  check(richHtml.querySelector('iframe')?.getAttribute('sandbox') === '', 'HTML iframe 强制无脚本沙箱');
  check(richHtml.querySelector('img').src.includes('/Rich/Image.svg'), 'HTML 库内图片转为受控资源 URL');
  check(richHtml.style.contain.includes('paint'), 'HTML 布局和绘制限制在值容器');
  check(!richHtml.dataset.basesDegraded, 'HTML 不再显示源码降级标记');
  check(richMarkdown.querySelector('h1')?.textContent === 'Markdown heading', 'Markdown 支持块级标题');
  check(richMarkdown.querySelectorAll('ul li').length >= 3, 'Markdown 支持列表与任务');
  check(!!richMarkdown.querySelector('table td'), 'Markdown 支持表格');
  check(!!richMarkdown.querySelector('.callout[data-callout="tip"]'), 'Markdown 复用阅读器 callout');
  check(!!richMarkdown.querySelector('.callout-icon svg path[d]'), 'Markdown 安全净化保留 SVG 图标路径');
  check(richMarkdown.textContent.includes('Nested heading') && richMarkdown.textContent.includes('Embedded bold'), 'Markdown 嵌入笔记正文');
  check(!!richMarkdown.querySelector('.markdown-embed strong'), '嵌入笔记复用 Markdown 格式');
  check(!!richMarkdown.querySelector('img[src*="/Rich/Image.svg"]'), 'Markdown 支持库内图片嵌入');
  check(richMarkdown.querySelectorAll('mjx-container').length >= 2, 'Markdown 与嵌入正文均渲染数学');
  check(!!richMarkdown.querySelector('.mermaid svg'), 'Markdown 复用图表渲染');
  check(!!richMarkdown.querySelector('.mermaid svg path[d]'), '图表后处理仍经过 SVG 净化边界');
  check(richMarkdown.querySelector('.mermaid').textContent.includes('Start') && richMarkdown.querySelector('.mermaid').textContent.includes('End'), '图表保留文字标签');
  check(!richMarkdown.querySelector('[onerror],[onclick],script'), 'Markdown 和嵌入在插入 DOM 前净化');
  check(window.__basesInjected === 0, '富值及嵌入中的脚本没有执行');
  check(!richMarkdown.dataset.basesDegraded, 'Markdown 不再显示行内降级标记');
  const before = await app.vault.read(row);
  const task = richMarkdown.querySelector('input.task-list-item-checkbox');
  check(task?.disabled, '公式任务控件只读，避免按派生 offset 改写笔记');
  task.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  check(await app.vault.read(row) === before, '点击派生任务不改写真实笔记');
  const open = app.workspace.openLinkText;
  const calls = [];
  app.workspace.openLinkText = (...args) => { calls.push(args); return Promise.resolve(); };
  try {
    richHtml.querySelector('a').click();
    check(calls[0]?.[0] === 'Target.md' && calls[0]?.[1] === row.path, 'HTML 内链使用行所属笔记解析');
    const anchor = [...richMarkdown.querySelectorAll('a.internal-link')].find(a => a.textContent === 'Internal');
    anchor.click();
    check(calls[1]?.[0] === target.path && calls[1]?.[1] === row.path, 'Markdown 内链复用阅读器导航');
  } finally { app.workspace.openLinkText = open; }
  await controller.refresh();
  check(controller.result.rows.length === 1, '富文本渲染保持原查询结果');
  return { pass: true, count: checks.length, checks };
})()
