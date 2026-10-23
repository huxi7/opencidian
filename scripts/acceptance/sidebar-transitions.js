/**
 * [INPUT]: 隔离库、真实左右侧栏、Web Animations 与 Workspace 布局。
 * [OUTPUT]: 返回 {pass,count,checks}，覆盖并行、反向、中断与内容宽度锁。
 * [POS]: 侧栏收起失败的行为回归。通过真实按钮和 DOM 重建验证最终态，不靠单个模型布尔值过关。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], ws = app.workspace;
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const split = side => side === 'left' ? ws.leftSplit : ws.rightSplit;
  const button = side => side === 'left' ? ws.leftSidebarToggleEl : ws.rightSidebarToggleEl;
  const width = side => split(side).containerEl.getBoundingClientRect().width;
  const settled = async () => {
    const deadline = Date.now() + 2500;
    while (['left', 'right'].some(side => split(side).containerEl.getAnimations().some(a => a.playState === 'running'))) {
      if (Date.now() > deadline) throw Error('侧栏动画没有结束');
      await wait(20);
    }
    await wait(40);
  };
  const set = async (side, collapsed) => { if (!!split(side).collapsed !== collapsed) button(side).click(); await settled(); };
  const coherent = (side, collapsed, label) => {
    const node = split(side), el = node.containerEl;
    check(node.collapsed === collapsed, label + '：模型目标正确');
    check(el.hasClass('is-collapsed') === collapsed && (collapsed ? width(side) === 0 : width(side) >= 199), label + '：真实DOM与模型一致');
    check(button(side).getAttribute('aria-expanded') === String(!collapsed), label + '：开关状态正确');
    check(ws.getLayout()[side + 'Collapsed'] === collapsed, label + '：序列化目标正确');
  };
  const file = await app.vault.create('Sidebar transitions.md', '# 一级标题\n\n' + '很长的文字用于验证侧栏收展时不重新换行。'.repeat(20));
  await ws.openFile(file);
  await set('left', false); await set('right', false);
  check(width('left') > 0 && width('right') > 0, '左右侧栏真实展开');

  // 旧实现共用一个句柄；第二次点击会取消第一侧的收起完成回调。
  button('right').click(); button('left').click(); await settled();
  coherent('right', true, '同时收起右栏'); coherent('left', true, '同时收起左栏');
  button('left').click(); button('right').click(); await settled();
  coherent('left', false, '同时展开左栏'); coherent('right', false, '同时展开右栏');

  const right = ws.rightSplit, child = right.children[0].containerEl;
  const original = child.getBoundingClientRect().width;
  button('right').click();
  check(parseFloat(child.style.minWidth) >= original - 2, '收起立即锁住内部宽度');
  check(child.getBoundingClientRect().width >= original - 2, '动画内真实内容不因外壳缩窄而重排');
  await settled();
  check(child.style.minWidth === '', '收起结束释放临时内容宽度');
  coherent('right', true, '内容锁释放后');

  button('right').click();
  check(parseFloat(child.style.minWidth) >= 199, '展开同样锁住内部宽度');
  await settled(); check(child.style.minWidth === '', '展开结束释放临时宽度');
  const remembered = width('right');
  for (let i = 0; i < 12; i++) { button('right').click(); await wait(7); }
  await settled(); coherent('right', false, '同侧快速反向12次');
  check(Math.abs(width('right') - remembered) < 2, '快速反向保留原侧栏宽度');
  coherent('left', false, '另一侧不被快速反向取消');

  button('right').click(); await wait(15);
  const old = right.containerEl; ws.render();
  check(old !== right.containerEl && !old.isConnected, '动画中重建替换旧容器');
  await settled(); coherent('right', true, '重建后收起');
  check(!right.containerEl.style.overflow && !right.children[0].containerEl.style.minWidth, '重建后无动画临时样式');
  button('right').click(); await wait(15); ws.render(); await settled();
  coherent('right', false, '重建后展开');

  button('right').click();
  const animation = right.containerEl.getAnimations().find(a => a.effect.getKeyframes().some(frame => 'width' in frame));
  check(!!animation, '实际收起采用宽度动画');
  animation.cancel(); await wait(200);
  coherent('right', true, '浏览器取消动画后');
  check(!right.containerEl.style.overflow && !right.children[0].containerEl.style.minWidth, '取消动画也释放内容锁');

  const layout = ws.getLayout();
  await ws.loadLayout(layout); await ws.postLayoutLoad(layout.active); await settled();
  coherent('right', true, '布局恢复保持收起');
  coherent('left', false, '布局恢复保持左栏展开');
  button('right').click(); await settled(); coherent('right', false, '恢复后仍可展开');
  check(document.querySelectorAll('.sidebar-toggle-button.mod-right').length === 1, '恢复和快速切换不留下右开关幽灵');
  return { pass: true, count: checks.length, checks };
})()
