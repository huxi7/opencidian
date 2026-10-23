/**
 * [INPUT]: 隔离库、真实五类侧栏面板与根分隔条鼠标事件。
 * [OUTPUT]: 两侧、明暗主题、三种宽度及收展后的共享工具栏几何断言。
 * [POS]: 侧栏工具栏统一对齐回归；中心书签验证样式作用域。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ws = app.workspace;
  const types = ['file-explorer', 'bookmarks', 'tag', 'backlink', 'all-properties'];
  for (const id of ['bookmarks', 'tag-pane', 'backlink', 'properties']) await app.plugins.enableInternalPlugin(id);
  const file = await app.vault.create('Toolbar.md', '---\nstatus: active\n---\n# Toolbar\n\n#toolbar/child\n');
  await ws.openFile(file);
  for (let n = 0; n < 100 && !app.metadataCache.getTags()['#toolbar/child']; n++) await wait(30);
  check(!!app.metadataCache.getTags()['#toolbar/child'], '真实标签夹具已进入元数据缓存');
  const center = ws.getLeaf('tab');
  await center.setViewState({ type: 'bookmarks', state: {} });
  const initialTheme = document.body.classList.contains('theme-dark');
  const initialSizes = { left: ws.leftSplit.size, right: ws.rightSplit.size };
  const panels = {};
  for (const side of ['left', 'right']) {
    panels[side] = [];
    for (const type of types) panels[side].push(await ws.ensureSideLeaf(type, side, { reveal: false }));
  }
  const rowOf = leaf => leaf.view.contentEl.querySelector('.nav-buttons-container');
  const snapshot = (leaf, label) => {
    const row = rowOf(leaf);
    const button = row?.querySelector('.clickable-icon');
    const rect = row?.getBoundingClientRect();
    check(!!button && rect.width > 0 && rect.height > 0, label + '：真实工具栏可见');
    const style = getComputedStyle(row);
    const first = button.getBoundingClientRect();
    const contentLeft = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    check(style.justifyContent === 'flex-start', label + '：共享工具栏靠左');
    check(Math.abs(first.left - contentLeft) < 1, label + '：首按钮贴工具栏内容左缘');
    const split = ws._sideOf(leaf) === 'left' ? ws.leftSplit : ws.rightSplit;
    return first.left - split.containerEl.getBoundingClientRect().left;
  };
  const drag = async (side, width) => {
    const split = side === 'left' ? ws.leftSplit : ws.rightSplit;
    const handle = ws._dividerHandles[side];
    const rect = handle.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + 80;
    const delta = (width - split.containerEl.getBoundingClientRect().width) * (side === 'left' ? 1 : -1);
    handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, bubbles: true, clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, bubbles: true, clientX: x + delta, clientY: y }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true, clientX: x + delta, clientY: y }));
    await wait(30);
    check(Math.abs(split.containerEl.getBoundingClientRect().width - width) < 1, side + '：真实拖动到 ' + width + 'px');
  };
  try {
    for (const theme of ['light', 'dark']) {
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme === 'light');
      for (const side of ['left', 'right']) {
        ws.hideSidebar(side === 'left' ? 'right' : 'left');
        ws.showSidebar(side);
        await wait(200);
        const offsets = new Map();
        for (const width of [260, 420, 640]) {
          await drag(side, width);
          for (const leaf of panels[side]) {
            leaf._tabHeaderEl.click();
            await wait(20);
            const label = theme + '/' + side + '/' + leaf.view.getViewType() + '/' + width;
            const offset = snapshot(leaf, label);
            if (offsets.has(leaf)) check(Math.abs(offset - offsets.get(leaf)) < 1, label + '：拖宽后左缘不漂移');
            else offsets.set(leaf, offset);
          }
        }
        // 每种面板都跨一次收展，防止只覆盖最后一个标签。
        for (const leaf of panels[side]) {
          leaf._tabHeaderEl.click();
          ws.hideSidebar(side); await wait(180);
          ws.showSidebar(side); await wait(180);
          const offset = snapshot(leaf, theme + '/' + side + '/' + leaf.view.getViewType() + '/重新展开');
          check(Math.abs(offset - offsets.get(leaf)) < 1, '重新展开后首按钮左缘保持');
        }
      }
      ws.setActiveLeaf(center);
      await wait(30);
      const row = rowOf(center), first = row.firstElementChild;
      const rect = row.getBoundingClientRect(), button = first.getBoundingClientRect();
      check(rect.width > 0 && button.width > 0 && getComputedStyle(row).justifyContent === 'center', theme + '：中心书签保持原有居中规则');
      check(button.left > rect.left + parseFloat(getComputedStyle(row).paddingLeft) + 5, theme + '：中心书签按钮实际留有居中空白');
    }
  } finally {
    document.body.classList.toggle('theme-dark', initialTheme);
    document.body.classList.toggle('theme-light', !initialTheme);
    ws.leftSplit.size = initialSizes.left;
    ws.rightSplit.size = initialSizes.right;
    ws.render();
  }
  return { pass: true, count: checks.length, checks };
})()
