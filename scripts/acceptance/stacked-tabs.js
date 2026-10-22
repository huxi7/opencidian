/**
 * [INPUT]: 独立临时 vault、真实标签组 DOM、命令入口与布局序列化/装载。
 * [OUTPUT]: 堆叠标签页的开关、结构、切换、关闭、固定、菜单、持久化与分组隔离断言。
 * [POS]: 堆叠标签页验收入口。堆叠状态以 mod-stacked 类与 layout JSON 的 stacked 键为准。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs');
  const path = require('path');
  const workspace = app.workspace;
  const checks = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const centerTabs = () => workspace._firstTabsIn(workspace.centerSplit);
  const stackItemText = '(堆叠标签页|取消堆叠标签页|Stack tabs|Unstack tabs)';

  const a = await app.vault.create('Stacked-A.md', '# A\n');
  const b = await app.vault.create('Stacked-B.md', '# B\n');
  const c = await app.vault.create('Stacked-C.md', '# C\n');
  const leafA = await workspace.openFile(a);
  const leafB = await workspace.openFile(b, { newLeaf: 'tab' });
  const leafC = await workspace.openFile(c, { newLeaf: 'tab' });
  await pause(80);
  const tabs = centerTabs();
  const container = () => tabs.containerEl.querySelector('.workspace-tab-container');
  check(tabs.children.length === 3, '中心标签组有三个标签');

  // 初始非堆叠
  check(!tabs.isStacked && !tabs.containerEl.hasClass('mod-stacked'), '初始标签组非堆叠');
  const command = app.commands.findCommand('workspace:toggle-stacked-tabs');
  check(!!command && command.icon === 'lucide-layers', '注册原版命令 id workspace:toggle-stacked-tabs');
  check(app.commands.executeCommandById('workspace:toggle-stacked-tabs') === true, '命令可执行');
  await pause(80);
  check(tabs.isStacked && tabs.containerEl.hasClass('mod-stacked'), '命令把当前标签组切到堆叠态');

  // 堆叠结构：头与叶交替进入 tab-container，头竖排并带吸附位，pane 有宽度区间
  const kinds = Array.from(container().children)
    .map((el) => (el.hasClass('workspace-tab-header') ? 'h' : (el.hasClass('workspace-leaf') ? 'l' : '?')))
    .join('');
  check(kinds === 'hlhlhl', '堆叠态头与叶交替排在 tab-container');
  check(tabs._headersInner.children.length === 0, '堆叠态标签头不再留在标签头容器内');
  const headerA = leafA._tabHeaderEl;
  check(getComputedStyle(headerA).writingMode === 'vertical-lr', '堆叠标签头竖排（writing-mode）');
  check(headerA.style.left === '0px' && headerA.style.right !== '', '滑动布局写入标签头吸附位');
  check(leafB._leafEl.style.minWidth !== '' && leafB._leafEl.style.maxWidth !== '', '滑动布局写入 pane 宽度区间');

  // 再执行恢复非堆叠
  check(app.commands.executeCommandById('workspace:toggle-stacked-tabs') === true, '命令可再次执行');
  await pause(80);
  const inner = tabs._headersInner;
  check(!tabs.isStacked && !tabs.containerEl.hasClass('mod-stacked'), '再次执行恢复非堆叠');
  check(inner.children.length === 3 && tabs.children.every((leaf) => leaf._tabHeaderEl.parentElement === inner), '标签头回到标签头容器');
  check(headerA.style.left === '' && leafB._leafEl.style.minWidth === '', '内联滑动样式清空');
  check(leafA._leafEl.style.display === 'none', '非堆叠态只有活动 pane 显示');

  // 堆叠态下的标签切换
  app.commands.executeCommandById('workspace:toggle-stacked-tabs');
  await pause(80);
  leafB._tabHeaderEl.click();
  await pause(80);
  check(workspace.activeLeaf === leafB && tabs.currentTab === tabs.children.indexOf(leafB), '堆叠态点击标签头切到该标签');
  check(leafB._tabHeaderEl.hasClass('is-active') && !headerA.hasClass('is-active'), '标签头选中态跟随活动标签');
  check(workspace.activeLeaf.view.getState().file === b.path, '活动叶子加载的是被点击的笔记');
  check(getComputedStyle(leafB._leafEl).display !== 'none' && !leafB._leafEl.hasClass('is-hidden'), '活动 pane 显示且未标隐藏');
  check(getComputedStyle(leafA._leafEl).display !== 'none', '堆叠态非活动 pane 仍参与横向布局');
  headerA.click();
  await pause(80);
  check(workspace.activeLeaf === leafA && tabs.currentTab === 0, '点击第一个标签头切回');

  // 堆叠态右键菜单仍可用（原版标签头菜单：固定/关闭/关闭其它/拆分…）
  leafA._tabHeaderEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  await pause(60);
  const contextMenu = document.querySelector('.menu');
  check(!!contextMenu && /(关闭|Close)/.test(contextMenu.textContent), '堆叠态标签头右键菜单可用');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await pause(40);
  check(!document.querySelector('.menu'), 'Escape 关闭标签头右键菜单');

  // 堆叠态拖拽重排：把末尾标签拖到第一个标签头上（本实现落点为"插到目标之前"）
  const beforeDrag = tabs.children.slice();
  const dragged = beforeDrag[2];
  const dataTransfer = new DataTransfer();
  dragged._tabHeaderEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
  const dropTarget = beforeDrag[0]._tabHeaderEl;
  const targetRect = dropTarget.getBoundingClientRect();
  const dropX = targetRect.left + targetRect.width / 2;
  const dropY = targetRect.top + targetRect.height / 2;
  dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: dropX, clientY: dropY }));
  dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: dropX, clientY: dropY }));
  dragged._tabHeaderEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  await pause(80);
  check(tabs.children[0] === dragged && tabs.children[1] === beforeDrag[0], '堆叠态拖拽重排把末尾标签移到最前');
  const headerOrder = Array.from(container().children)
    .filter((el) => el.hasClass('workspace-tab-header')).map((el) => el._leaf.id).join('|');
  check(headerOrder === tabs.children.map((leaf) => leaf.id).join('|'), '堆叠态标签头 DOM 顺序跟随标签顺序');
  check(tabs.isStacked && tabs.containerEl.hasClass('mod-stacked'), '拖拽重排后仍保持堆叠');
  workspace.setActiveLeaf(leafB, { focus: false });
  await pause(40);

  // 关闭与固定
  const closeBtn = leafC._tabHeaderEl.querySelector('.workspace-tab-header-inner-close-button');
  check(!!closeBtn, '堆叠态标签头保留关闭按钮');
  closeBtn.click();
  await pause(80);
  check(tabs.children.length === 2 && !tabs.children.includes(leafC), '关闭一个标签后该叶移除');
  check(tabs.isStacked && tabs.containerEl.hasClass('mod-stacked'), '关闭后仍保持堆叠');
  check(tabs.currentTab >= 0 && tabs.currentTab < tabs.children.length, '关闭后当前索引仍在范围内');
  leafB.pinned = true; workspace._syncAllTabs(); await pause(40);
  const pinned = leafB._tabHeaderEl.querySelector('.workspace-tab-header-status-icon.mod-pinned');
  check(!!pinned && leafB._tabHeaderEl.parentElement === container(), '固定标签在堆叠态仍显示 pin 图标');
  leafB.pinned = false; workspace._syncAllTabs(); await pause(40);
  check(!leafB._tabHeaderEl.querySelector('.workspace-tab-header-status-icon'), '取消固定后 pin 图标移除');

  // 保存布局 → 装载布局：stacked 键写入并读回
  const activeIndex = tabs.children.indexOf(leafB);
  workspace.setActiveLeaf(leafB, { focus: false });
  await pause(40);
  await app.saveLayout();
  const saved = JSON.parse(fs.readFileSync(path.join(app.vaultPath, '.obsidian', 'workspace.json'), 'utf8'));
  const savedTabs = (saved.main.children || []).find((child) => child.type === 'tabs');
  check(!!savedTabs && savedTabs.stacked === true, 'layout JSON 的 tabs 节点带 stacked 键');
  check(savedTabs.currentTab === activeIndex, 'layout JSON 的 currentTab 与活动标签一致');
  const layout = JSON.parse(JSON.stringify(workspace.getLayout()));
  const previous = []; workspace.iterateAllLeaves((leaf) => previous.push(leaf));
  for (const leaf of previous) await leaf.view.onClose();
  const active = await workspace.loadLayout(layout);
  await workspace.postLayoutLoad(active);
  await pause(150);
  const reloaded = centerTabs();
  check(reloaded !== tabs && reloaded.isStacked && reloaded.containerEl.hasClass('mod-stacked'), '装载布局后堆叠状态保持');
  check(reloaded.currentTab === activeIndex && workspace.activeLeaf && workspace.activeLeaf.parent === reloaded, '装载后活动标签与索引保持');

  // 标签组隔离：命令只作用于当前组
  workspace.setActiveLeaf(reloaded.children[0], { focus: false });
  const secondLeaf = workspace.getLeaf('split');
  await secondLeaf.setViewState({ type: 'empty' });
  await pause(80);
  const secondTabs = secondLeaf.parent;
  check(secondTabs !== reloaded && !secondTabs.isStacked && !secondTabs.containerEl.hasClass('mod-stacked'), '新建标签组默认非堆叠');
  check(app.commands.executeCommandById('workspace:toggle-stacked-tabs') === true, '第一组执行命令');
  await pause(80);
  check(!reloaded.isStacked && !reloaded.containerEl.hasClass('mod-stacked'), '第一组退出堆叠');
  workspace.setActiveLeaf(secondLeaf, { focus: false });
  check(app.commands.executeCommandById('workspace:toggle-stacked-tabs') === true, '第二组执行命令');
  await pause(80);
  check(secondTabs.isStacked && secondTabs.containerEl.hasClass('mod-stacked'), '堆叠只落在当前标签组');
  check(reloaded.isStacked === false && !reloaded.containerEl.hasClass('mod-stacked'), '另一个标签组不受影响');

  // 侧栏标签组不可堆叠
  const sideLeaf = workspace.getLeavesOfType('file-explorer')[0];
  check(!!sideLeaf, '侧栏工具入口存在');
  const sideTabs = sideLeaf.parent;
  workspace.setActiveLeaf(sideLeaf, { focus: false });
  check(app.commands.executeCommandById('workspace:toggle-stacked-tabs') === false, '侧栏组执行命令被拒绝');
  check(!sideTabs.isStacked && !sideTabs.containerEl.hasClass('mod-stacked'), '侧栏标签组不落堆叠');

  // 标签列表菜单：堆叠入口（原版在 Tabs 类内建菜单，第一项即堆叠切换）
  workspace.setActiveLeaf(reloaded.children[0], { focus: false });
  await pause(40);
  const listBtn = reloaded.containerEl.querySelector('.workspace-tab-header-tab-list');
  check(!!listBtn, '标签列表按钮存在');
  listBtn.click();
  await pause(60);
  const menu = document.querySelector('.menu');
  check(!!menu && new RegExp(stackItemText).test(menu.textContent), '标签列表菜单含堆叠入口');
  const stackItem = Array.from(menu.querySelectorAll('.menu-item')).find((el) => new RegExp(stackItemText).test(el.textContent));
  stackItem.click();
  await pause(80);
  check(reloaded.isStacked && reloaded.containerEl.hasClass('mod-stacked'), '菜单项把当前标签组切到堆叠态');
  check(!document.querySelector('.menu'), '点选菜单项后菜单关闭');
  return { pass: true, count: checks.length, checks, vault: app.vaultPath };
})()
