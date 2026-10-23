/**
 * [INPUT]: 隔离 Electron 工作区、真实侧栏手柄、鼠标/指针与布局保存恢复。
 * [OUTPUT]: 返回 {pass,count,checks}，验证外栏只改自身、中心弹性、轴向比例和取消清理。
 * [POS]: 侧栏拖宽回归。与收展动画共同运行，禁止截图或外部应用唤起。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const ws = app.workspace, checks = [], original = JSON.parse(JSON.stringify(ws.getLayout()));
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
  const rect = node => node.getBoundingClientRect();
  const handle = side => document.querySelector('.workspace-root > .workspace-leaf-resize-handle[data-divider-side="' + side + '"]');
  const side = name => ws[name + 'Split'];
  const mouseDown = (node, x, y, button = 0) => node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button, buttons: button === 0 ? 1 : 2, clientX: x, clientY: y }));
  const mouseMove = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { cancelable: true, buttons: 1, clientX: x, clientY: y }));
  const mouseUp = () => window.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 0 }));
  const resizeSide = async (name, wanted) => {
    const divider = handle(name), bounds = rect(divider), before = rect(side(name).containerEl).width;
    const x = bounds.left + bounds.width / 2, y = bounds.top + 100;
    mouseDown(divider, x, y); mouseMove(x + (wanted - before) * (name === 'left' ? 1 : -1), y); mouseUp(); await pause(30);
  };
  const originalBodyWidth = ws.containerEl.style.width;
  try {
    ws.showSidebar('left'); ws.showSidebar('right'); await pause(200);
    check(!!handle('left') && !!handle('right'), '左右侧栏根边界手柄真实存在');
    const leftBefore = rect(side('left').containerEl).width, centerBefore = rect(ws.centerSplit.containerEl).width;
    await resizeSide('right', 360);
    check(near(side('right').size, 360) && near(rect(side('right').containerEl).width, 360), '右边界拖动只保存右侧栏真实宽度');
    check(near(rect(side('left').containerEl).width, leftBefore), '拖右边界不修改左侧栏');
    check(Number(getComputedStyle(ws.centerSplit.containerEl).flexGrow) > 0 && Number(getComputedStyle(ws.centerSplit.containerEl).flexShrink) > 0, '拖宽后中心区保持可伸缩');
    check(rect(ws.centerSplit.containerEl).width < centerBefore && !ws.centerSplit.containerEl.style.width, '中心让出宽度但没有固定像素宽度');
    const beforeShrink = rect(ws.centerSplit.containerEl).width, containerWidth = ws.containerEl.clientWidth;
    ws.containerEl.style.width = containerWidth - 80 + 'px'; await pause(50);
    check(near(rect(ws.centerSplit.containerEl).width, beforeShrink - 80), '容器变窄时中心仍自动伸缩80像素');
    ws.containerEl.style.width = originalBodyWidth; await pause(50);
    ws.hideSidebar('right'); await pause(180); ws.showSidebar('right'); await pause(180);
    check(near(rect(side('right').containerEl).width, 360), '拖宽后收展恢复侧栏保存宽度');
    await resizeSide('left', 340);
    check(near(side('left').size, 340) && near(rect(side('right').containerEl).width, 360), '左边界拖动只修改左栏，右栏宽度不变');
    let divider = handle('right'), bounds = rect(divider), x = bounds.left, y = bounds.top + 100, saved = side('right').size;
    mouseDown(divider, x, y, 2); mouseMove(x - 80, y); mouseUp();
    check(side('right').size === saved && !document.body.hasClass('is-resizing'), '右键不启动尺寸拖动');
    mouseDown(divider, x, y); mouseMove(x - 10, y); window.dispatchEvent(new Event('blur')); saved = side('right').size; mouseMove(x - 90, y);
    check(side('right').size === saved && !document.body.hasClass('is-resizing') && !document.body.hasClass('is-grabbing'), '窗口失焦清理拖动态，后续mousemove不改宽度');
    mouseDown(divider, x, y); mouseMove(x - 10, y); ws.render(); saved = side('right').size; mouseMove(x - 100, y);
    check(side('right').size === saved && !document.body.hasClass('is-resizing'), '拖动中DOM重建取消旧监听且不再改新DOM');
    check(near(rect(side('right').containerEl).width, saved), '重建后侧栏宽度与保存模型一致');
    divider = handle('right'); bounds = rect(divider); x = bounds.left; y = bounds.top + 100;
    divider.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 17, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 17, buttons: 1, clientX: x - 10, clientY: y, cancelable: true }));
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 17 })); saved = side('right').size;
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 17, buttons: 1, clientX: x - 100, clientY: y }));
    check(side('right').size === saved && !document.body.hasClass('is-grabbing'), 'pointercancel释放窗口事件与抓取光标');
    divider = handle('right'); bounds = rect(divider); x = bounds.left; const startWidth = rect(side('right').containerEl).width;
    mouseDown(divider, x, y); mouseMove(x + startWidth - 30, y);
    check(side('right').collapsed && rect(side('right').containerEl).width === 0, '侧栏拖至小于50像素按原版收起');
    mouseMove(x + startWidth - 250, y); mouseMove(x + startWidth - 250, y); mouseUp();
    check(!side('right').collapsed && near(side('right').size, 250), '同次拖动达到200像素后重新展开并继续调整');
    await resizeSide('left', 300); await resizeSide('right', 300);
    const oldTabs = ws._firstTabsIn(ws.rightSplit), newTabs = new oldTabs.constructor(ws);
    ws.rightSplit.insertChild(ws.rightSplit.children.length, newTabs);
    const secondLeaf = ws.createLeafInTabGroup(newTabs); await secondLeaf.setViewState({ type: 'outline' }); ws.render(); await pause(40);
    const inner = ws.rightSplit.containerEl.querySelector(':scope > .workspace-leaf-resize-handle.mod-horizontal');
    check(!!inner, '恢复形态的侧栏内部水平分隔条存在');
    let firstHeight = rect(oldTabs.containerEl).height, secondHeight = rect(newTabs.containerEl).height;
    const sidebarWidth = rect(ws.rightSplit.containerEl).width; bounds = rect(inner); x = bounds.left + 100; y = bounds.top;
    mouseDown(inner, x, y); mouseMove(x, y + 50); mouseUp(); await pause(20);
    check(near(rect(ws.rightSplit.containerEl).width, sidebarWidth), '侧栏内部水平拖动不改外栏宽度');
    check(near(rect(oldTabs.containerEl).height, firstHeight + 50) && near(rect(newTabs.containerEl).height, secondHeight - 50), '水平手柄按clientY调整上下两组高度');
    check(near(oldTabs.dimension + newTabs.dimension, 100, .001) && oldTabs.dimension > newTabs.dimension, '内部尺寸完成后保存有限百分比dimension');
    check(!oldTabs.containerEl.style.height && !newTabs.containerEl.style.height && !oldTabs.containerEl.style.width, '完成后清掉临时像素宽高');
    const dimensionBeforeZero = oldTabs.dimension, flexBeforeZero = oldTabs.containerEl.style.flex, heightBeforeZero = rect(oldTabs.containerEl).height;
    mouseDown(inner, x, y); mouseMove(x, y); mouseUp();
    check(oldTabs.dimension === dimensionBeforeZero && oldTabs.containerEl.style.flex === flexBeforeZero && !oldTabs.containerEl.style.height, '零位移move/up不锁像素、不重写原比例');
    ws.render(); await pause(30);
    check(near(rect(oldTabs.containerEl).height, heightBeforeZero), '重绘保留内部拖动比例');
    const layout = JSON.parse(JSON.stringify(ws.getLayout()));
    check(layout.right.children.every(node => Number.isFinite(node.dimension) && node.dimension > 0), '布局JSON保存两个标签组的有限比例');
    const firstId = oldTabs.id, secondId = newTabs.id, active = await ws.loadLayout(layout); check(active !== false, '包含比例的布局通过真实预检并重载'); await ws.postLayoutLoad(active); await pause(30);
    const restored = ws.rightSplit.children;
    check(restored[0].id === firstId && restored[1].id === secondId && near(restored[0].dimension, dimensionBeforeZero, .001), '反序列化恢复标签组身份与比例');
    check(near(rect(restored[0].containerEl).height, heightBeforeZero), '保存并恢复后内部高度保持一致');
    check(!document.body.hasClass('is-resizing') && !document.body.hasClass('is-grabbing'), '全部操作后没有遗留拖动状态');
  } finally {
    mouseUp(); window.dispatchEvent(new Event('blur')); ws.containerEl.style.width = originalBodyWidth;
    const active = await ws.loadLayout(original); if (active !== false) await ws.postLayoutLoad(active);
  }
  return { pass: true, count: checks.length, checks };
})();
