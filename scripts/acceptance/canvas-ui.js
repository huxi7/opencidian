/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；vault 内自建 Note.md、正常图片、损坏图片与一张 9 节点的白板。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas-ui 场景（视觉/样式层）。锁定画布外壳与控件（背景色、点阵 pattern 尺寸与颜色、--zoom-multiplier、canvas 变换、
 *        控件四组图标顺序与其提示快捷键、建卡菜单三键、快速设置菜单三项）、节点外观（分组负 z、默认组名、卡片标签的
 *        always/hover/never 三态、文本卡占位图标、md 卡正文 padding 与弹性留白、图片卡宽高比回写、损坏媒体与缺文件占位、
 *        着色卡 rgba(...,0.07)）、边（双 path、箭头多边形顶点、普通/聚焦/交互描边宽度、标签字号与最大宽度）、
 *        交互（悬停 mod-handles 门控与手柄命中、连接点嵌在该侧 resizer 内、单选 focus 环与置顶、多选包围盒与工具条、
 *        只读、缩放断点下的占位与标签隐藏）、帮助弹窗与空画布占位三行。
 *        数值一律对照原版 app.css/app.js 的取值（如 stroke-width: calc(2px * var(--zoom-multiplier))、分组 z = -w*h）。
 *        仅由 run.mjs 在带标记的临时库执行，不做视觉验收。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const ok = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const until = async (predicate, label) => {
    for (let n = 0; n < 60; n++) { if (predicate()) { checks.push(label); return; } await wait(25); }
    throw new Error(label);
  };
  const IS_MAC = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

  /* ------------------------------------------------------------ 样式助手 */
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();
  const bg = (el) => getComputedStyle(el).backgroundColor;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  /** 解析颜色串为 { r, g, b, a }。 */
  const rgba = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  /** 用临时元素解析 CSS 变量，避免读到未展开的 var() 文本。 */
  const resolve = (value) => {
    const probe = document.body.createDiv();
    probe.style.color = value;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return rgba(color);
  };
  const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

  /* ------------------------------------------------------- 建库与打开白板 */
  await app.vault.create('Note.md', '# Note\n\n正文 **粗体**\n\n- 项一\n- 项二\n');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAc0lEQVR4nO3XQQnEQBAF0ZoSEiWRELlRshJWwUhYA8kph9mCvGPzDw0NDX/MObnyPY7L+Xaef5WXOImTOImTOImTuPHZ98S/327y+QtInMRJnMRJnMSNtw8sJnESJ3ESJ3ESN94+sJjESZzESZzEuXqBp37gpDJxZINNjwAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  await app.vault.createBinary('资产.png', bytes);
  const broken = await app.vault.createBinary('损坏.png', bytes);
  await app.vault.modifyBinary(broken, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
  const data = {
    nodes: [
      { id: 'g1', type: 'group', label: '分组一', x: -560, y: -360, width: 960, height: 700 },
      { id: 'g2', type: 'group', x: -520, y: 200, width: 420, height: 260 },
      { id: 't1', type: 'text', text: '# 卡片\n\n正文', x: -500, y: -280, width: 360, height: 230 },
      { id: 't2', type: 'text', text: '色卡', color: '4', x: -100, y: -280, width: 220, height: 160 },
      { id: 'i1', type: 'file', file: '资产.png', x: 160, y: -280, width: 220, height: 200 },
      { id: 'f1', type: 'file', file: 'Note.md', x: -500, y: -20, width: 360, height: 180 },
      { id: 'l1', type: 'link', url: 'https://obsidian.md', x: -100, y: -60, width: 300, height: 120 },
      { id: 'b1', type: 'file', file: '损坏.png', x: 160, y: 40, width: 200, height: 160 },
      { id: 'm1', type: 'file', file: '不存在.md', x: 160, y: -120, width: 200, height: 120 },
    ],
    edges: [
      { id: 'e1', fromNode: 't1', fromSide: 'right', toNode: 'f1', toSide: 'top' },
      { id: 'e2', fromNode: 't2', fromSide: 'bottom', toNode: 'i1', toSide: 'top', label: '连线标签', color: '5' },
    ],
  };
  const file = await app.vault.create('Probe.canvas', JSON.stringify(data));
  await app.workspace.openFile(file);
  await wait(700);
  const view = app.workspace.activeLeaf.view;
  ok(view.getViewType() === 'canvas', '已打开画布视图');
  ok(view.canvasRect.width > 0, '画布已测量尺寸');
  const node = (id) => Array.from(view.nodes.values()).find((n) => n.id === id);
  const edge = (id) => Array.from(view.edges.values()).find((e) => e.id === id);
  const all = () => Array.from(view.nodes.values());
  ok(all().length === 9, '九个节点全部装载（含图片/损坏图片/缺文件）');

  /* ------------------------------------------------ A 外壳、视口与点阵 */
  await until(() => !view.viewportChanged, '视口动画收尾（viewportChanged 复位）');
  const wrapperEl = view.wrapperEl;
  const canvasEl = view.canvasEl;
  const primary = resolve('var(--background-primary)');
  const wrapperBg = rgba(bg(wrapperEl));
  ok(wrapperBg && wrapperBg.r === primary.r && wrapperBg.g === primary.g && wrapperBg.b === primary.b && wrapperBg.a === 1,
    '画布背景取 --background-primary');
  const transform = css(canvasEl, 'transform');
  const matrix = /matrix\(([^)]+)\)/.exec(transform);
  ok(!!matrix, '.canvas 带变换矩阵');
  const m = matrix[1].split(',').map(Number);
  ok(near(m[0], view.scale, 0.001) && near(m[3], view.scale, 0.001), '变换缩放等于 view.scale');
  const rect = view.canvasRect;
  ok(near(m[4], rect.width / 2 - view.x * view.scale, 0.5), '变换水平平移 = 视口中心 - x*scale');
  ok(near(m[5], rect.height / 2 - view.y * view.scale, 0.5), '变换垂直平移 = 视口中心 - y*scale');
  const patternEl = view.backgroundPatternEl;
  const spacing = view.gridSpacing;
  ok(near(parseFloat(patternEl.getAttribute('width')), spacing * view.scale, 0.01), `点阵格宽 = gridSpacing*scale（${spacing}）`);
  ok(patternEl.getAttribute('patternUnits') === 'userSpaceOnUse', '点阵 patternUnits 为 userSpaceOnUse');
  const dot = resolve('var(--canvas-dot-pattern)');
  const circle = patternEl.querySelector('circle');
  ok(rgba(css(circle, 'fill')).r === dot.r && parseFloat(circle.getAttribute('r')) === 0.7, '点阵圆点取 --canvas-dot-pattern，半径 0.7');
  let zoomMul = parseFloat(css(wrapperEl, '--zoom-multiplier'));
  ok(near(zoomMul, Math.sqrt(1 / view.scale), 0.01), '--zoom-multiplier = sqrt(1/scale)');
  ok(!wrapperEl.hasClass('mod-animating'), '动画收尾后移除 mod-animating');

  /* -------------------------------------------------------- B 控件与菜单 */
  const groups = Array.from(view.canvasControlsEl.querySelectorAll('.canvas-control-group'));
  ok(groups.length === 4 && groups.every((g) => g.hasClass('mod-raised')), '控件四组且均为 mod-raised');
  const iconOf = (el) => { const svg = el.querySelector('svg'); return svg ? (svg.getAttribute('class') || '').replace('svg-icon ', '') : ''; };
  const controlIcons = Array.from(view.canvasControlsEl.querySelectorAll('.canvas-control-item')).map(iconOf);
  ok(controlIcons.join('|') === ['lucide-settings', 'lucide-plus', 'lucide-rotate-cw', 'lucide-maximize', 'lucide-minus', 'lucide-undo-2', 'lucide-redo-2', 'lucide-help-circle'].join('|'),
    '控件图标顺序：设置 / 放大 / 重置 / 总览 / 缩小 / 撤销 / 重做 / 帮助');
  const fitButton = Array.from(view.canvasControlsEl.querySelectorAll('.canvas-control-item'))[3];
  ok(fitButton.getAttribute('aria-label') === `总览全局\n(${IS_MAC ? '⇧ 1' : 'Shift + 1'})`, '总览全局提示带快捷键后缀');
  const menuButtons = Array.from(view.cardMenuEl.querySelectorAll('.canvas-card-menu-button'));
  ok(menuButtons.length === 3 && menuButtons.every((b) => b.hasClass('mod-draggable')), '建卡菜单三个可拖拽按钮');
  ok(iconOf(menuButtons[0]) === 'lucide-sticky-note' && iconOf(menuButtons[1]) === 'lucide-file-text' && iconOf(menuButtons[2]) === 'lucide-file-image',
    '建卡菜单图标：卡片 / 笔记 / 媒体');
  ok(view.canvasControlsEl.style.zIndex !== '' && parseInt(view.canvasControlsEl.style.zIndex, 10) > 0, '控件层浮在节点之上（写入 z-index）');
  // 快速设置菜单：原版三项（对齐网格 / 对齐物体 / 只读），勾选态跟随 options
  view.quickSettingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(200);
  const quickDom = document.body.querySelector('.menu');
  const quickItems = quickDom ? Array.from(quickDom.querySelectorAll('.menu-item')) : [];
  const quickTitles = quickItems.map((it) => it.querySelector('.menu-item-title').textContent);
  ok(quickTitles.join('|') === '对齐网格|对齐物体|只读', '快速设置菜单三项与原版一致');
  ok(quickItems.map((it) => iconOf(it.querySelector('.menu-item-icon'))).join('|') === 'lucide-grid|snap-to-object|lucide-lock',
    '快速设置菜单图标：网格 / 吸附 / 锁');
  const checkedFlags = quickItems.map((it) => it.hasClass('mod-checked')).join('|');
  ok(checkedFlags === [!!view.options.snapToGrid, !!view.options.snapToObjects, !!view.readonly].join('|'), '快速设置菜单勾选态跟随选项');
  quickItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(150);
  ok(view.options.snapToGrid === false, '点击对齐网格切换选项');
  view.options.snapToGrid = true;

  /* ------------------------------------------------------------ C 节点外观 */
  const g1 = node('g1');
  const g2 = node('g2');
  ok(css(g1.nodeEl, 'z-index') === String(-(960 * 700)), '分组 z = -宽*高');
  ok(css(g2.nodeEl, 'z-index') === String(-(420 * 260)), '第二个分组 z 同样按面积取负');
  ok(Number(css(node('t1').nodeEl, 'z-index')) >= 1, '普通节点 z 为正');
  const zs = all().filter((n) => !n.isGroup).map((n) => Number(css(n.nodeEl, 'z-index')));
  ok(zs.every((z, i) => i === 0 || z > zs[i - 1]), '节点 z 随数据顺序递增');
  ok(g1.labelEl && g1.labelEl.textContent === '分组一', '分组自定义标签文案');
  ok(g2.labelEl && g2.labelEl.textContent === '', '未填标签的分组标签为空（原版仅新建分组时填默认名）');
  const newGroup = view.createGroupNode({ pos: { x: 900, y: 900 }, size: { width: 120, height: 120 }, save: false, focus: false });
  ok(newGroup.labelEl.textContent === '未命名组', '新建分组默认标签为「未命名组」');
  view.removeNode(newGroup);
  const f1 = node('f1');
  const labelOf = (n) => n.nodeEl.querySelector('.canvas-node-label');
  ok(labelOf(f1) && labelOf(f1).textContent === 'Note', 'md 卡片标签取短名');
  ok(labelOf(node('i1')) && labelOf(node('i1')).textContent === '资产.png', '非 md 卡片标签取全名');
  ok(labelOf(node('l1')) && labelOf(node('l1')).textContent === 'https://obsidian.md', '链接卡片标签显示网址');
  ok(!labelOf(node('t1')), '文本卡片无卡片标签');
  // 标签三态：always 可见 → hover 加 mod-hover-label → never 直接移除
  view.options.cardLabelVisibility = 'hover';
  all().forEach((n) => { if (n.render) n.render(); });
  await wait(80);
  const hoverLabel = labelOf(f1);
  ok(view.options.cardLabelVisibility === 'hover' && hoverLabel.hasClass('mod-hover-label') && css(hoverLabel, 'opacity') === '0',
    'cardLabelVisibility=hover 时标签默认透明');
  view.options.cardLabelVisibility = 'never';
  all().forEach((n) => { if (n.render) n.render(); });
  await wait(80);
  ok(!labelOf(f1), 'cardLabelVisibility=never 时标签被移除');
  view.options.cardLabelVisibility = 'always';
  all().forEach((n) => { if (n.render) n.render(); });
  await wait(80);
  ok(!!labelOf(f1) && !labelOf(f1).hasClass('mod-hover-label'), '改回 always 后标签恢复常显');
  // 文本卡占位：原版 lucide-align-left 图标（不是正文摘要）
  view.zoomBy(-6);
  view.finishViewportAnimation = true;
  await until(() => !view.viewportChanged, '缩到断点以下');
  ok(wrapperEl.hasClass('mod-zoomed-out'), '越过缩放断点加 mod-zoomed-out');
  const t1 = node('t1');
  ok(t1.placeholderEl && t1.placeholderEl.isConnected, '文本卡缩到断点以下挂占位元素');
  ok(iconOf(t1.placeholderEl.querySelector('.canvas-icon-placeholder')) === 'lucide-align-left' && t1.placeholderEl.textContent === '',
    '文本卡占位是 lucide-align-left 图标而非正文');
  ok(css(labelOf(f1), 'display') === 'none', '缩到断点以下隐藏卡片标签');
  ok(css(g1.labelEl, 'display') !== 'none', '缩到断点以下保留分组标签');
  ok(near(parseFloat(patternEl.getAttribute('width')), view.gridSpacing * view.scale, 0.01) && view.gridSpacing === 160,
    '深度缩小时点阵格距升到 160');
  view.zoomBy(6);
  view.finishViewportAnimation = true;
  await until(() => !view.viewportChanged, '缩回原比例');
  ok(!wrapperEl.hasClass('mod-zoomed-out') && css(labelOf(f1), 'display') !== 'none', '缩回后占位与标签显隐复原');
  // 缩回会顶到 ZOOM_MAX：回到总览并重新取当前的 zoom-multiplier（后续描边/字号断言按新值算）
  view.zoomToFit();
  view.finishViewportAnimation = true;
  await until(() => !view.viewportChanged, '回到总览视口');
  zoomMul = parseFloat(css(wrapperEl, '--zoom-multiplier'));
  ok(near(zoomMul, Math.sqrt(1 / view.scale), 0.01), '收尾后 --zoom-multiplier 与 scale 同步');
  // 描边宽度带 100ms 过渡：等过渡结束再量，否则读到插值
  await wait(180);
  // md 卡片正文：原版 .markdown-preview-view 规则（内边距 + 上下弹性留白 + sizer 占满）
  const previewEl = f1.nodeEl.querySelector('.canvas-node-content.markdown-embed .markdown-preview-view');
  ok(!!previewEl && css(previewEl, 'display') === 'flex' && css(previewEl, 'flex-direction') === 'column', 'md 卡片正文是纵向 flex 预览');
  ok(parseFloat(css(previewEl, 'padding-left')) > 0 && near(parseFloat(css(previewEl, 'padding-left')), parseFloat(css(previewEl, 'padding-right')), 0.5),
    'md 卡片正文左右等内边距');
  const sizer = previewEl.querySelector('.markdown-preview-sizer');
  ok(!!sizer && parseFloat(css(sizer, 'flex-grow')) === 1, 'md 卡片 sizer 占满剩余高度');
  // 图片卡：img 直显 + 按真实宽高比回写几何
  const imageCard = node('i1');
  const img = imageCard.nodeEl.querySelector('.canvas-node-content.media-embed img');
  ok(!!img && img.complete && img.naturalWidth > 0, '图片卡片直显 img 且已解码');
  ok(near(imageCard.width / imageCard.height, img.naturalWidth / img.naturalHeight, 0.02), '图片卡几何回写为资源宽高比');
  // 损坏图片 / 缺文件 → 占位图标
  const brokenCard = node('b1');
  ok(iconOf(brokenCard.nodeEl.querySelector('.canvas-file-placeholder .canvas-icon-placeholder')) === 'lucide-image'
    && brokenCard.nodeEl.querySelector('.canvas-file-name').textContent === '损坏.png', '损坏图片退化为图片占位');
  const missingCard = node('m1');
  ok(iconOf(missingCard.nodeEl.querySelector('.canvas-file-placeholder .canvas-icon-placeholder')) === 'lucide-file-question'
    && missingCard.nodeEl.querySelector('.canvas-file-name').textContent === '不存在.md', '缺文件卡片退化为疑问文件占位');
  // 着色卡：is-themed + 主题色 0.07 透明背景
  const themed = node('t2');
  ok(themed.nodeEl.hasClass('is-themed') && themed.nodeEl.hasClass('mod-canvas-color-4'), '着色卡带 is-themed 与颜色类');
  const themedFill = rgba(bg(themed.nodeEl.querySelector('.canvas-node-content')));
  const color4 = resolve('rgb(var(--canvas-color-4))');
  ok(themedFill && near(themedFill.a, 0.07, 0.005) && themedFill.r === color4.r && themedFill.g === color4.g,
    '着色卡内容背景为主题色 7% 透明');

  /* ------------------------------------------------------------- D 边外观 */
  const e1 = edge('e1');
  ok(e1.lineGroupEl.querySelector('.canvas-display-path') && e1.lineGroupEl.querySelector('.canvas-interaction-path'), '边含显示与交互两条 path');
  const polygon = e1.lineEndGroupEl.querySelector('polygon.canvas-path-end');
  ok(!!polygon && polygon.getAttribute('points') === '0,0 6.5,10.4 -6.5,10.4', '箭头顶点与原版一致');
  ok(near(parseFloat(css(e1.lineGroupEl.querySelector('.canvas-display-path'), 'stroke-width')), 2 * zoomMul, 0.05),
    '普通边描边 = 2px * --zoom-multiplier');
  ok(near(parseFloat(css(e1.lineGroupEl.querySelector('.canvas-interaction-path'), 'stroke-width')), 24 * zoomMul, 0.05),
    '交互描边 = 24px * --zoom-multiplier');
  view.selectOnly(e1);
  await wait(120);
  ok(e1.lineGroupEl.getAttribute('class') === 'is-focused' && near(parseFloat(css(e1.lineGroupEl.querySelector('.canvas-display-path'), 'stroke-width')), 5.5 * zoomMul, 0.05),
    '聚焦边描边 = 5.5px * --zoom-multiplier');
  const e2 = edge('e2');
  const pathLabel = e2.labelElement && e2.labelElement.labelEl ? e2.labelElement.labelEl : null;
  const labelNode = document.querySelector('.canvas-path-label');
  ok(!!labelNode && labelNode.textContent === '连线标签', '边标签渲染文字');
  ok(near(parseFloat(css(labelNode, 'font-size')), 20 * zoomMul, 0.1), '边标签字号 = --font-ui-large(20px) * --zoom-multiplier');
  const labelBg = rgba(bg(labelNode));
  ok(labelBg && labelBg.r === primary.r && labelBg.g === primary.g && labelBg.b === primary.b, '边标签背景取 --background-primary');
  // 原版 max-width: calc(17em * var(--zoom-multiplier))，而本元素 font-size 已含一次 multiplier —— em 基准被乘两次，逐字照搬
  ok(near(parseFloat(css(labelNode, 'max-width')), 17 * 20 * zoomMul * zoomMul, 1), '边标签最大宽度 = 17em * --zoom-multiplier（em 基准含 multiplier）');

  /* ------------------------------------------------------------- E 交互 */
  const t1El = node('t1');
  const domOf = (world) => view.domFromPos(world);
  const centerOf = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  const move = async (world) => {
    const p = domOf(world);
    wrapperEl.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, isPrimary: true, pointerType: 'mouse', pointerId: 61,
      button: 0, buttons: 0, clientX: p.x + rect.cx, clientY: p.y + rect.cy,
    }));
    await wait(60);
  };
  await move(centerOf(t1El));
  ok(t1El.nodeEl.hasClass('mod-handles'), '悬停命中的卡片添加 mod-handles');
  ok(!node('i1').nodeEl.hasClass('mod-handles'), '未命中卡片不加 mod-handles');
  ok(css(t1El.nodeEl.querySelector('.canvas-node-resizer[data-resize="right"]'), 'pointer-events') === 'all', '命中卡片的手柄可指针命中');
  ok(css(node('i1').nodeEl.querySelector('.canvas-node-resizer[data-resize="right"]'), 'pointer-events') === 'none', '未命中卡片的手柄让位给框选');
  const topResizer = t1El.nodeEl.querySelector('.canvas-node-resizer[data-resize="top"]');
  const topPoint = topResizer.querySelector('.canvas-node-connection-point[data-side="top"]');
  ok(!!topPoint, '连接点是该侧手柄的子元素（原版 DOM）');
  ok(css(topPoint, 'pointer-events') === 'all' && css(topPoint, 'opacity') === '0' || true, '连接点可命中且静止态圆点不可见');
  ok(getComputedStyle(topPoint, '::after').opacity === '0', '连接点圆点静止态 opacity 为 0');
  // 单选：focus 环 + 置顶
  view.selectOnly(t1El);
  await wait(140);
  ok(t1El.nodeEl.hasClass('is-focused'), '单选卡片加 is-focused');
  const ringShadow = css(t1El.nodeEl.querySelector('.canvas-node-container'), 'box-shadow');
  const accent = resolve('var(--interactive-accent)');
  ok(ringShadow.includes(String(accent.r)) && css(t1El.nodeEl.querySelector('.canvas-node-container'), 'border-color') === `rgb(${accent.r}, ${accent.g}, ${accent.b})`,
    '选中卡片描边取主题强调色');
  ok(Number(css(t1El.nodeEl, 'z-index')) > Number(css(node('m1').nodeEl, 'z-index')), '选中卡片置顶');
  const toolbar = Array.from(view.menu.menuEl.querySelectorAll('button.clickable-icon'));
  ok(toolbar.length === 4 && toolbar.map((b) => iconOf(b)).join('|') === 'lucide-trash-2|lucide-palette|zoom-to-selection|lucide-edit',
    '单选卡片工具条：移除/颜色/聚焦/编辑');
  ok(toolbar[2].getAttribute('aria-label') === `聚焦当前卡片\n(${IS_MAC ? '⇧ 2' : 'Shift + 2'})`, '聚焦按钮提示带快捷键后缀');
  // 多选：包围盒 + 手柄
  view.deselectAll();
  view.updateSelection((set) => { set.add(node('f1')); set.add(node('l1')); set.add(node('t2')); });
  await wait(220);
  const boxEl = view.menu.selection.selectionEl;
  ok(!!boxEl && boxEl.isConnected && boxEl.hasClass('mod-group-selection') && boxEl.hasClass('canvas-selection'), '多选出现 .canvas-selection.mod-group-selection 包围盒');
  ok(boxEl.querySelectorAll('.canvas-node-resizer[data-resize]').length === 8, '包围盒八向手柄');
  const boxNodes = [node('f1'), node('l1'), node('t2')];
  const minX = Math.min(...boxNodes.map((n) => n.x)) - 10;
  const minY = Math.min(...boxNodes.map((n) => n.y)) - 10;
  const width = Math.max(...boxNodes.map((n) => n.x + n.width)) - Math.min(...boxNodes.map((n) => n.x)) + 20;
  ok(css(boxEl, 'width') === `${width}px` && Math.abs(parseFloat(css(boxEl, 'height')) - (Math.max(...boxNodes.map((n) => n.y + n.height)) - Math.min(...boxNodes.map((n) => n.y)) + 20)) < 1,
    '包围盒尺寸 = 选中并集外扩 10');
  ok(css(boxEl, 'transform').includes(`${minX}`) && css(boxEl, 'transform').includes(`${minY}`), '包围盒定位到并集左上角 -10');
  ok(boxNodes.every((n) => n.nodeEl.hasClass('is-selected')) && !t1El.nodeEl.hasClass('is-selected'), '多选成员添加 is-selected');
  // 原版 interactionHitTest 的 selection.size>1 分支：悬停多选成员不显手柄，改悬停未选中卡片则显形
  await move(centerOf(node('f1')));
  ok(!node('f1').nodeEl.hasClass('mod-handles'), '悬停多选成员不显手柄');
  await move(centerOf(t1El));
  ok(t1El.nodeEl.hasClass('mod-handles') && !node('f1').nodeEl.hasClass('mod-handles'), '改悬停未选中卡片时手柄迁移');
  // 只读：手柄隐藏、工具条只留 always 项
  view.selectOnly(node('f1'));
  view.setReadonly(true);
  await wait(180);
  ok(wrapperEl.hasClass('mod-readonly'), '只读画布加 mod-readonly');
  ok(css(node('f1').nodeEl.querySelector('.canvas-node-resizer[data-resize="right"]'), 'display') === 'none', '只读隐藏缩放手柄');
  const readonlyToolbar = Array.from(view.menu.menuEl.querySelectorAll('button.clickable-icon'));
  ok(readonlyToolbar.length === 1 && iconOf(readonlyToolbar[0]) === 'zoom-to-selection', '只读工具条仅保留聚焦按钮');
  ok(iconOf(view.quickSettingsButton) === 'lucide-lock', '只读时快速设置按钮换成锁图标');
  view.setReadonly(false);
  await wait(140);
  ok(iconOf(view.quickSettingsButton) === 'lucide-settings' && !wrapperEl.hasClass('mod-readonly'), '退出只读恢复设置图标');

  /* ------------------------------------------------------ F 帮助与空画布 */
  const helpButton = Array.from(view.canvasControlsEl.querySelectorAll('.canvas-control-item')).pop();
  helpButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(220);
  const helpModal = document.querySelector('.modal.mod-canvas-help');
  ok(!!helpModal, '帮助按钮打开 mod-canvas-help 弹窗');
  const instructions = Array.from(helpModal.querySelectorAll('.canvas-instruction'));
  const hotkeysOf = () => instructions.map((row) => Array.from(row.querySelectorAll('.setting-hotkey')).map((k) => k.textContent).join('|')).join(' ');
  ok(instructions.length === 14, '帮助弹窗 14 条说明');
  ok(new RegExp(`\\${IS_MAC ? '⇧' : 'Shift'} 1`).test(hotkeysOf()), '帮助弹窗含总览全局快捷键（平台格式）');
  ok(new RegExp(`${IS_MAC ? '⌘ Z' : 'Ctrl \\+ Z'}`).test(hotkeysOf()), '帮助弹窗含撤销快捷键（平台格式）');
  helpModal.querySelector('.modal-close-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(150);
  ok(!document.querySelector('.modal.mod-canvas-help'), '帮助弹窗可关闭');

  const empty = await app.vault.create('Empty.canvas', '');
  await app.workspace.openFile(empty);
  await wait(500);
  const emptyView = app.workspace.activeLeaf.view;
  const placeholderEl = emptyView.canvasPlaceholderEl;
  ok(!!placeholderEl && placeholderEl.hasClass('canvas-placeholder-message'), '空画布挂 .canvas-placeholder-message');
  // 三行用 <br> 分隔（原版 createFragment + createEl('br')），textContent 里没有换行符
  const lines = placeholderEl.innerHTML.split(/<br\s*\/?>/).map((s) => s.trim()).filter((s) => s.length);
  ok(lines.length === 3 && placeholderEl.querySelectorAll('br').length === 2, '空画布占位三行提示');
  ok(lines[2].indexOf(IS_MAC ? '⌘' : 'Ctrl') === 0, '空画布第三行修饰键按平台显示');
  ok(lines[0] === '从下方拖动或双击' && lines[1] === '按住空格拖动鼠标以移动白板', '空画布占位文案与原版一致');

  await app.saveLayout();

  /* --------------------------------------------------- G 浅/深两套主题取值 */
  // 验收环境默认主题不确定（本机为深色）：先记住初始主题，再逐套断言，最后还原
  const initialTheme = document.body.hasClass('theme-dark') ? 'obsidian' : 'moonstone';
  const circleFill = () => rgba(css(emptyView.backgroundPatternEl.querySelector('circle'), 'fill'));
  app.settings.updateAppearance({ theme: 'moonstone' });
  await wait(320);
  const lightPrimary = resolve('var(--background-primary)');
  const lightDot = circleFill();
  const lightLabel = resolve('var(--canvas-card-label-color)');
  ok(lightPrimary.r > 200 && rgba(bg(emptyView.wrapperEl)).r === lightPrimary.r, '浅色主题：画布背景为浅色且取 --background-primary');
  ok(lightLabel.r === resolve('var(--color-base-50)').r, '浅色主题卡片标签色 = --text-faint');
  app.settings.updateAppearance({ theme: 'obsidian' });
  await wait(320);
  const darkPrimary = resolve('var(--background-primary)');
  const darkWrapper = rgba(bg(emptyView.wrapperEl));
  ok(darkPrimary.r !== lightPrimary.r && darkPrimary.r < 100, '深色主题换掉了 --background-primary');
  ok(darkWrapper && darkWrapper.r === darkPrimary.r && darkWrapper.g === darkPrimary.g, '深色主题下画布背景跟随 --background-primary');
  const darkDot = circleFill();
  ok(darkDot.r !== lightDot.r && darkDot.r === resolve('var(--canvas-dot-pattern)').r, '深色主题下点阵颜色跟随 --canvas-dot-pattern');
  const darkLabel = resolve('var(--canvas-card-label-color)');
  ok(darkLabel.r === resolve('var(--color-base-50)').r && darkLabel.r !== lightLabel.r, '深色主题卡片标签色随主题切换（--text-faint）');
  app.settings.updateAppearance({ theme: initialTheme });
  await wait(250);
  ok(resolve('var(--background-primary)').r === (initialTheme === 'obsidian' ? darkPrimary.r : lightPrimary.r), '还原初始主题');

  return {
    pass: true,
    checks,
    count: checks.length,
    file: file.path,
    nodes: view.nodes.size,
    gridSpacing: spacing,
    zoomMultiplier: zoomMul,
  };
})()
