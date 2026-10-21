/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；vault 内自建 Board.canvas / Empty.canvas / Broken.canvas 与嵌白板的笔记。
 * [OUTPUT]: 返回「笔记里嵌白板」的断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas-embed 场景。逐条对齐原版 1.14.4 的画布嵌入（原版 app.js 3428689 的 cte + 渲染器 lte）：
 *        阅读视图 DOM（span.internal-embed.canvas-embed.inline-embed.is-loaded + div.embed-title + svg.canvas-minimap）、
 *        缩略图几何（分组先于卡片、rx/ry=20、贝塞尔边、线宽 sqrt(宽/10)、viewBox 并集外扩 5%）、
 *        计算样式锁（display:block、标题 flex/gap/字重、缩略图 padding 与 --embed-canvas-max-height 限高）、
 *        降级（空白板与坏 JSON 只留标题、缺文件落 .file-embed.mod-empty）、
 *        实时预览形态（div 容器 + tabindex=-1）与阅读视图两态、点击进入白板与 Mod+点击新标签；右键按原版语义不弹菜单（原版渲染器只对链接/标签/图片派发右键）。
 *        原版事实取自 _analysis/obsidian-114/renderer/app.js 与 app.css（行号见注释）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  try {
      const checks = [];
    const check = (ok, msg) => { if (!ok) throw Error('✗ ' + msg); checks.push(msg); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn, msg, timeout = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { if (fn()) return; await wait(50); }
      throw Error('✗ timeout: ' + msg);
    };
    const px = (v) => Math.round(parseFloat(v || '0') * 100) / 100;
    const near = (a, b, tol = 0.6) => Math.abs(px(a) - px(b)) <= tol;
    const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();
    const cls = (el) => (el ? el.className : '');
    const attr = (el, name) => (el && el.getAttribute(name) ? el.getAttribute(name) : '');
    const activePath = () => { const f = app.workspace.getActiveFile(); return f ? f.path : ''; };
    const hasMenu = (s) => menuTitles().some((x) => x.includes(s));
    const rightClick = (el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 4, clientY: r.top + 4 }));
    };
    const closeMenu = async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(80); };

    /* ------------------------------------------------------------ 造库 */
    // 白板内容与原版取证用的一致：1 个分组 + 3 张卡片 + 1 条边，两张卡片带色
    const board = {
      nodes: [
        { id: 'g1', type: 'group', x: -100, y: -100, width: 600, height: 400, color: '1' },
        { id: 'n1', type: 'text', text: 'hello', x: 0, y: 0, width: 250, height: 120 },
        { id: 'n2', type: 'file', file: 'Note.md', x: 300, y: 50, width: 300, height: 200, color: '4' },
        { id: 'n3', type: 'text', text: 'third', x: 0, y: 200, width: 200, height: 100 },
      ],
      edges: [{ id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left' }],
    };
    await app.vault.create('Board.canvas', JSON.stringify(board));
    await app.vault.create('Empty.canvas', JSON.stringify({ nodes: [], edges: [] }));
    await app.vault.create('Broken.canvas', 'not json at all {');
    await app.vault.create('Note.md', '# 笔记\n\n正文。\n');
    const note = await app.vault.create('Embed.md', [
      '# 嵌白板',
      '',
      '![[Board.canvas]]',
      '',
      '![[Empty.canvas]]',
      '',
      '![[Broken.canvas]]',
      '',
      '![[Nope.canvas]]',
      '',
    ].join('\n'));

    /* ------------------------------------------------------------ 阅读视图 */
    await app.workspace.openFile(note);
    const view = app.workspace.getActiveViewOfType('markdown');
    check(!!view, 'markdown 视图已打开');
    await view.setState({ file: note.path, mode: 'preview' });
    await until(() => view.readingEl.querySelectorAll('.canvas-embed').length >= 3, '阅读视图渲染画布嵌入');
    const root = view.readingEl;
    const q = (s) => root.querySelector(s);
    const all = (s) => [...root.querySelectorAll(s)];

    const embed = q('.canvas-embed');
    check(!!embed, '阅读视图出现 .canvas-embed 容器');
    check(cls(embed).includes('internal-embed') && cls(embed).includes('canvas-embed')
      && cls(embed).includes('inline-embed') && cls(embed).includes('is-loaded'),
      '容器类名 = internal-embed canvas-embed inline-embed is-loaded，实际 ' + cls(embed));
    check(embed.tagName === 'SPAN', '阅读视图容器是 span（原版 markdown-it 的 iembed），实际 ' + embed.tagName);
    check(embed.getAttribute('src') === 'Board.canvas', '容器带 src = 链接文本，实际 ' + embed.getAttribute('src'));
    check(embed.getAttribute('alt') === 'Board.canvas', '容器带 alt = 链接文本，实际 ' + embed.getAttribute('alt'));
    check(!root.querySelector('.file-embed.mod-generic'), '.canvas 不再落通用附件嵌块（.file-embed.mod-generic）');

    const title = embed.querySelector(':scope > .embed-title');
    check(!!title && title.tagName === 'DIV', '标题行是 div.embed-title');
    check(!!title.querySelector(':scope > .file-embed-icon'), '标题内有 .file-embed-icon');
    const iconSvg = title.querySelector('.file-embed-icon > svg');
    check(!!iconSvg && attr(iconSvg, 'class').includes('lucide-layout-dashboard'), '图标是 lucide-layout-dashboard');
    check(!!iconSvg && iconSvg.querySelectorAll('rect').length === 4, '图标是 layout-dashboard 的四个矩形');
    check(title.textContent === ' Board', '标题文本 = 图标后一个空格 + 文件名（不含扩展名），实际 ' + JSON.stringify(title.textContent));

    const svg = embed.querySelector(':scope > svg.canvas-minimap');
    check(!!svg, '容器内直接子级是 svg.canvas-minimap');
    check(embed.children[0] === title && embed.children[1] === svg, 'DOM 顺序 = 标题在前、缩略图在后');

    /* -------------------------------------------- 缩略图几何（原版 lte） */
    const rects = [...svg.querySelectorAll('rect')];
    const paths = [...svg.querySelectorAll('path')];
    check(rects.length === 4, '圆角矩形数 = 4（1 分组 + 3 卡片），实际 ' + rects.length);
    check(rects.every((r) => r.getAttribute('rx') === '20' && r.getAttribute('ry') === '20'), '每个矩形 rx/ry = 20');
    check(rects[0].getAttribute('x') === '-100' && rects[0].getAttribute('width') === '600', '分组先画（第一个矩形是分组）');
    check(attr(rects[0], 'class').includes('is-themed') && attr(rects[0], 'class').includes('mod-canvas-color-1'), '着色分组带 is-themed 与 mod-canvas-color-1');
    check(attr(rects[2], 'class').includes('is-themed') && attr(rects[2], 'class').includes('mod-canvas-color-4'), '着色卡片带 is-themed 与 mod-canvas-color-4');
    check(!attr(rects[1], 'class').includes('is-themed'), '无色卡片不带 is-themed');
    check(paths.length === 1, '边数 = 1，实际 ' + paths.length);
    check(/^M-?\d+(\.\d+)?,-?\d+(\.\d+)? C/.test(paths[0].getAttribute('d')), '边是三次贝塞尔路径，实际 ' + paths[0].getAttribute('d'));
    check(paths[0].getAttribute('d') === 'M250,60 C320,60 230,150 300,150', '边的控制点与原版一致，实际 ' + paths[0].getAttribute('d'));
    check(near(parseFloat(paths[0].style.strokeWidth), Math.sqrt(700 / 10), 0.01), '边线宽 = sqrt(内容宽/10) = 8.3666，实际 ' + paths[0].style.strokeWidth);
    check(svg.getAttribute('viewBox') === '-135 -135 770 470', 'viewBox = 内容并集外扩 5%，实际 ' + svg.getAttribute('viewBox'));

    /* ------------------------------------------- 计算样式锁（原版 app.css） */
    check(cs(embed, 'display') === 'block', '.canvas-embed 是块级（.internal-embed:not(.image-embed)）');
    check(cs(embed, 'padding') === '0px', '.canvas-embed 无内边距，实际 ' + cs(embed, 'padding'));
    check(cs(embed, 'border-top-width') === '0px' && cs(embed, 'border-top-style') === 'none', '.canvas-embed 无边框');
    check(cs(embed, 'border-radius') === '0px', '.canvas-embed 无圆角，实际 ' + cs(embed, 'border-radius'));
    check(cs(embed, 'background-color') === 'rgba(0, 0, 0, 0)', '.canvas-embed 背景透明，实际 ' + cs(embed, 'background-color'));
    check(cs(embed, 'position') === 'static', '.canvas-embed 定位为 static（导出/打印不受影响）');
    check(cs(embed, 'cursor') === 'auto' && cs(svg, 'cursor') === 'auto', '画布嵌入不是链接（无指针手型，原版 .canvas-embed 无规则）');
    check(cs(title, 'display') === 'flex' && cs(title, 'align-items') === 'center', '.embed-title 是 flex 且垂直居中');
    check(near(cs(title, 'gap'), 4, 0.2), '.embed-title gap = 4px（--size-4-1），实际 ' + cs(title, 'gap'));
    check(near(cs(title, 'padding-bottom'), 8, 0.2), '.embed-title 下内边距 8px，实际 ' + cs(title, 'padding-bottom'));
    check(cs(title, 'padding-left') === '0px' && cs(title, 'padding-right') === '0px', '.embed-title 左右无内边距');
    check(cs(title, 'font-weight') === '600', '.embed-title 字重 600（--font-weight + --bold-modifier），实际 ' + cs(title, 'font-weight'));
    check(cs(title, 'white-space') === 'nowrap' && cs(title, 'text-overflow') === 'ellipsis', '.embed-title 单行省略');
    const iconBox = title.querySelector('.file-embed-icon').getBoundingClientRect();
    check(near(iconBox.width, 16, 0.5) && near(iconBox.height, 16, 0.5), '.file-embed-icon 是 16x16，实际 ' + iconBox.width + 'x' + iconBox.height);
    const probeColor = (name) => {
      const probe = document.createElement('div');
      probe.style.color = 'var(' + name + ')';
      root.appendChild(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    };
    check(cs(title.querySelector('.file-embed-icon'), 'color') === probeColor('--text-muted'), '.file-embed-icon 颜色 = --text-muted，实际 ' + cs(title.querySelector('.file-embed-icon'), 'color'));
    check(cs(svg, 'display') === 'inline', '缩略图是 inline svg（原版 .canvas-minimap 未设 display），实际 ' + cs(svg, 'display'));
    check(near(cs(svg, 'padding'), 4, 0.2), '缩略图内边距 4px（--size-4-1），实际 ' + cs(svg, 'padding'));
    check(cs(svg, 'max-height') === '400px', '缩略图限高 = --embed-canvas-max-height 400px，实际 ' + cs(svg, 'max-height'));
    check(near(svg.getBoundingClientRect().width, embed.getBoundingClientRect().width, 1), '缩略图宽度 = 容器宽度（width:100%）');
    check(cs(svg, 'overflow') === 'hidden', '缩略图溢出裁剪（svg 默认）');

    /* ------------------------------------------------ 导出与打印链路不被破坏 */
    check(!!embed.closest('p'), '画布嵌块仍留在段落里（原版 iembed 是行内 token）');
    check(cs(embed, 'overflow') !== 'hidden', '画布嵌块不裁切内容（打印可见），实际 ' + cs(embed, 'overflow'));
    check(cs(svg, 'position') === 'static', '缩略图不脱离文档流（打印随页排版）');
    check(cs(embed, 'position') === 'static' && cs(svg, 'position') === 'static', '画布嵌块与缩略图都用静态定位（printToPDF 取样式不受影响）');

    /* --------------------------------------------------- 降级（原版行为） */
    const embeds = all('.canvas-embed');
    check(embeds.length === 3, '.canvas 目标存在三个画布嵌入（Board/Empty/Broken），实际 ' + embeds.length);
    const empty = embeds.find((e) => e.getAttribute('src') === 'Empty.canvas');
    check(!!empty && !empty.querySelector('svg.canvas-minimap'), '空白板不画缩略图');
    check(!!empty && !!empty.querySelector(':scope > .embed-title'), '空白板仍留标题行');
    check(empty.textContent === ' Empty', '空白板标题 = 文件名');
    const broken = embeds.find((e) => e.getAttribute('src') === 'Broken.canvas');
    check(!!broken && !broken.querySelector('svg.canvas-minimap'), '坏 JSON 不画缩略图');
    check(!!broken && !!broken.querySelector(':scope > .embed-title'), '坏 JSON 仍留标题行');
    check(broken.textContent === ' Broken', '坏 JSON 标题 = 文件名');
    const missing = q('.file-embed.mod-empty');
    check(!!missing, '缺文件的白板落 .file-embed.mod-empty');
    check(!!missing && missing.textContent.includes('未创建，点击以创建'), '缺文件提示沿用原版文案，实际 ' + (missing ? missing.textContent : ''));

    /* ------------------------------------------------------- 右键无菜单（原版语义） */
    // 原版渲染器只对 a.internal-link / a.external-link / a.tag / img,video 派发右键，
    // 画布嵌入（.canvas-embed）本身**没有**右键菜单；故这里断言不弹菜单。
    rightClick(embed);
    await wait(420);
    check(!document.querySelector('body > .menu'), '画布嵌入右键不弹菜单（原版无此菜单）');
    await closeMenu();

    /* ------------------------------------------------------- 点击进入白板 */
    const leavesBefore = app.workspace.getLeavesOfType('canvas').length;
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await until(() => activePath() === 'Board.canvas', '点击缩略图打开白板');
    check(activePath() === 'Board.canvas', '点击画布嵌入打开该白板文件');
    check(app.workspace.activeLeaf.view.getViewType() === 'canvas', '打开后进入画布视图');
    check(app.workspace.getLeavesOfType('canvas').length === leavesBefore + 1, '普通点击在当前叶打开（不新增标签）');

    /* ------------------------------------------------------- Mod+点击新标签 */
    await app.workspace.openFile(note);
    await view.setState({ file: note.path, mode: 'preview' });
    await until(() => view.readingEl.querySelector('.canvas-embed svg.canvas-minimap'), '回到阅读视图');
    const embed2 = view.readingEl.querySelector('.canvas-embed');
    const before2 = app.workspace.getLeavesOfType('canvas').length;
    embed2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    await until(() => app.workspace.getLeavesOfType('canvas').length > before2, 'Mod+点击新开标签');
    check(app.workspace.getLeavesOfType('canvas').length === before2 + 1, 'Mod+点击在新标签页打开白板');
    await until(() => activePath() === 'Board.canvas', 'Mod+点击后活动文件是白板');
    check(activePath() === 'Board.canvas', 'Mod+点击后活动文件是白板');

    /* ------------------------------------------------------- 实时预览形态 */
    await app.workspace.openFile(note);
    const liveView = app.workspace.getActiveViewOfType('markdown');
    await liveView.setState({ file: note.path, mode: 'live' });
    await until(() => liveView.sourceEl.querySelector('.canvas-embed'), '实时预览渲染画布嵌入');
    const live = liveView.sourceEl.querySelector('.canvas-embed');
    check(!!live, '实时预览出现 .canvas-embed');
    check(live.tagName === 'DIV', '实时预览容器是 div（原版 CM6 widget），实际 ' + live.tagName);
    check(live.getAttribute('tabindex') === '-1', '实时预览容器带 tabindex=-1，实际 ' + live.getAttribute('tabindex'));
    check(cls(live).includes('internal-embed') && cls(live).includes('canvas-embed') && cls(live).includes('inline-embed'), '实时预览容器类名同阅读视图');
    check(live.getAttribute('src') === 'Board.canvas', '实时预览容器带 src');
    check(!!live.querySelector(':scope > .embed-title'), '实时预览有 .embed-title');
    check(!!live.querySelector('.file-embed-icon > svg.lucide-layout-dashboard'), '实时预览标题图标同原版');
    check(live.querySelector(':scope > .embed-title').textContent === ' Board', '实时预览标题文本同阅读视图');
    await until(() => liveView.sourceEl.querySelector('.canvas-embed svg.canvas-minimap'), '实时预览缩略图异步补齐');
    const liveSvg = liveView.sourceEl.querySelector('.canvas-embed svg.canvas-minimap');
    check(!!liveSvg, '实时预览渲染 svg.canvas-minimap');
    check(liveSvg.getAttribute('viewBox') === '-135 -135 770 470', '实时预览 viewBox 与阅读视图一致');
    check(liveSvg.querySelectorAll('rect').length === 4, '实时预览圆角矩形数一致');
    check(liveSvg.querySelectorAll('path').length === 1, '实时预览边数一致');
    check(cs(liveSvg, 'max-height') === '400px', '实时预览缩略图同样限高 400px');
    check(liveView.sourceEl.querySelectorAll('.canvas-embed').length === 3, '实时预览同样渲染三个画布嵌入');
    check(live.getAttribute('contenteditable') === 'false', '实时预览容器是 CM6 不可编辑 widget（contenteditable=false）');
    const liveMissing = liveView.sourceEl.querySelector('.file-embed.mod-empty');
    check(!!liveMissing, '实时预览的缺失白板同样落 .file-embed.mod-empty');
    check(!!liveMissing && liveMissing.textContent.includes('未创建，点击以创建'), '实时预览缺失白板文案与阅读视图一致');


    return { pass: true, checks, count: checks.length };
  } catch (e) { return { pass: false, debug: String((e && e.stack) || e) }; }
})()
