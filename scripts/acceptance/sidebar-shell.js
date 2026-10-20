/**
 * [INPUT]: 独立临时 vault、真实侧栏 DOM、命令与插件宿主。
 * [OUTPUT]: 固定入口、设置、库菜单、布局恢复与重启断言。
 * [POS]: 用户侧栏问题的验收入口。禁止用命令打开设置代替点击齿轮。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs');
  const path = require('path');
  const { ipcRenderer } = require('electron');
  const workspace = app.workspace;
  const checks = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const visible = el => !!el && el.isConnected && el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
  const phase = process.env.OBS_NOTES_STAGE || 'run';
  const screen = process.env.OBS_SIDEBAR_VIEW || 'outline';
  const sideLeaves = () => {
    const all = []; workspace.iterateAllLeaves(leaf => { if (workspace._sideOf(leaf) !== 'center') all.push(leaf); });
    return all;
  };
  const profile = () => document.querySelector('.workspace-sidedock-vault-profile');
  const settingButton = () => profile()?.querySelector('[aria-label="设置"], [aria-label="Settings"]');
  const closeMenu = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await pause(30);
  };
  if (phase === 'restart') {
    check(sideLeaves().length === 6, '重启后六个固定工具入口完整');
    check(visible(settingButton()), '重启后设置齿轮可见');
    check(!document.querySelector('.mod-sidedock .workspace-tab-header-inner-close-button'), '重启后没有关闭按钮');
    return { pass: true, checks };
  }
  const file = await app.vault.create('欢迎.md', '# 欢迎\n\n左侧选择文件、搜索或书签。\n\n设置与仓库切换固定在左下角。\n');
  await app.workspace.openFile(file);
  await pause(150);
  check(sideLeaves().length === 6, '首次启动有六个固定工具入口');
  check(visible(profile()) && visible(settingButton()), '库信息栏和设置齿轮在视口中');
  check(profile().querySelector('[aria-label="帮助"] svg path'), '帮助图标有真实图形');
  const bounds = profile().getBoundingClientRect();
  check(Math.abs(bounds.bottom - innerHeight) < 3, '库信息栏固定在左栏底部');
  check(document.querySelector('.workspace-drawer-vault-name').textContent === app.vault.getName(), '显示当前仓库名');
  const originalIds = sideLeaves().map(leaf => leaf.id).sort().join('|');
  for (const leaf of sideLeaves()) {
    const header = leaf._tabHeaderEl;
    check(!header.querySelector('.workspace-tab-header-inner-close-button'), leaf.view.getViewType() + ' 没有关闭叉');
    check(header.draggable === false, leaf.view.getViewType() + ' 不可拖走');
    header.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    header.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
    check(!document.querySelector('.menu'), '右键不出现关闭或删除菜单');
    header.click();
    check(app.commands.executeCommandById('workspace:close') === false, '侧栏焦点时关闭命令不可执行');
  }
  check(originalIds === sideLeaves().map(leaf => leaf.id).sort().join('|'), '中键与关闭命令未移除任何入口');
  check(!document.querySelector('.mod-sidedock .workspace-tab-header-new-tab'), '侧栏不显示文档加号');
  app.commands.executeCommandById('workspace:new-tab');
  await pause(40);
  check(workspace._sideOf(workspace.activeLeaf) === 'center', '侧栏焦点新建标签仍在中心');

  // 空标签页（原版 JT）：显示文本与空状态容器
  const emptyLeaf = workspace.activeLeaf;
  check(emptyLeaf.view.getViewType() === 'empty', '新建标签是空视图');
  check(/^(新标签页|New tab)$/.test(emptyLeaf.view.getDisplayText()), '空标签显示"新标签页"');
  check(!!emptyLeaf.view.contentEl.querySelector('.empty-state-container'), '空状态使用 empty-state-container');
  check(!emptyLeaf.view.contentEl.querySelector('.empty-state-action-icon'), '空状态无图标按钮（原版无）');

  // 标签列表按钮与"全部关闭"
  const listBtn = document.querySelector('.mod-root .workspace-tab-header-tab-list');
  check(visible(listBtn), '标签列表按钮可见');
  listBtn.click(); await pause(30);
  const listMenu = document.querySelector('.menu');
  check(!!listMenu && /全部关闭|Close all/.test(listMenu.textContent), '标签列表菜单含全部关闭');
  await closeMenu();

  // 固定标签：pin 图标出现/移除
  const mdLeaf = workspace.getLeavesOfType('markdown')[0];
  mdLeaf.pinned = true; workspace._syncAllTabs(); await pause(20);
  check(!!document.querySelector('.mod-root .workspace-tab-header-status-icon.mod-pinned'), '固定标签显示 pin 图标');
  mdLeaf.pinned = false; workspace._syncAllTabs(); await pause(20);
  check(!document.querySelector('.mod-root .workspace-tab-header-status-icon.mod-pinned'), '取消固定后 pin 图标移除');

  // 状态栏：词数 + 字符数两段
  const wcItem = document.querySelector('.status-bar-item.plugin-word-count');
  check(!!wcItem && wcItem.querySelectorAll('.status-bar-item-segment').length === 2, '状态栏含词数与字符数两段');
  check(/\d/.test(wcItem ? wcItem.textContent : ''), '状态栏计数含数字');

  // 拖拽幽灵（原版 drag-ghost）
  const dragHeader = document.querySelector('.mod-root .workspace-tab-header[data-type="markdown"]');
  const dataTransfer = new DataTransfer();
  dragHeader.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
  check(!!document.querySelector('body > .drag-ghost'), '拖拽时出现 drag-ghost');
  dragHeader.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  await pause(40);
  check(!document.querySelector('body > .drag-ghost'), '拖拽结束无残留 drag-ghost');

  check(app.commands.executeCommandById('workspace:close'), '中心文档仍可关闭');

  settingButton().click(); await pause(100);
  check(visible(app.setting.modalEl) && !!app.setting.activeTab, '实际点击底部齿轮打开设置');
  app.setting.close(); await pause(180);
  const switcher = profile().querySelector('.workspace-drawer-vault-switcher');
  switcher.click(); await pause(30);
  let menu = document.querySelector('.menu');
  check(visible(menu) && menu.textContent.includes(app.vault.getName()), '库名点击打开真实仓库列表');
  check(menu.querySelector('.mod-checked'), '库菜单标记当前库');
  check(menu.textContent.includes('管理仓库'), '库菜单包含管理仓库');
  check(menu.getBoundingClientRect().bottom <= switcher.getBoundingClientRect().top, '菜单向上展开不遮住齿轮');
  await closeMenu();
  check(!switcher.classList.contains('has-active-menu'), '关闭菜单清理活动态');
  switcher.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await pause(30); check(visible(document.querySelector('.menu')), '键盘也可展开库菜单'); await closeMenu();

  workspace.leftSidebarToggleEl.click(); await pause(320);
  check(workspace.leftSplit.collapsed && visible(workspace.leftSidebarToggleEl), '收起左栏后保留展开开关');
  const fallback = document.querySelector('.sidebar-profile-fallback [aria-label="设置"]');
  check(visible(fallback), '左栏收起时设置仍有可见入口');
  fallback.click(); await pause(40); check(visible(app.setting.modalEl), '收起状态仍能打开设置');
  app.setting.close(); await pause(180);
  workspace.leftSidebarToggleEl.click(); await pause(320);
  check(!workspace.leftSplit.collapsed && visible(profile()), '重新展开恢复库信息栏');
  if (workspace.rightSplit.collapsed) { workspace.showSidebar('right'); await pause(320); }
  workspace.rightSidebarToggleEl.click(); await pause(320);
  check(workspace.rightSplit.collapsed && visible(workspace.rightSidebarToggleEl), '右栏收起后保留开关');
  workspace.rightSidebarToggleEl.click(); await pause(320);

  const stale = JSON.parse(JSON.stringify(workspace.getLayout()));
  stale.left.children = []; stale.right.children = [];
  const old = []; workspace.iterateAllLeaves(leaf => old.push(leaf));
  for (const leaf of old) await leaf.view.onClose();
  const active = await workspace.loadLayout(stale); await workspace.postLayoutLoad(active);
  check(sideLeaves().length === 6, '修复已把工具关空的旧布局');
  check(document.querySelectorAll('.workspace-sidedock-vault-profile').length === 1, '布局恢复只有一个稳定底栏');
  await app.plugins.disableInternalPlugin('bookmarks');
  check(workspace.getLeavesOfType('bookmarks').length === 0, '禁用插件才移除其固定入口');
  await app.plugins.enableInternalPlugin('bookmarks');
  check(workspace.getLeavesOfType('bookmarks').length === 1, '重新启用插件恢复唯一入口');
  await app.workspace.openFile(file);
  await app.saveLayout();
  if (phase === 'switch') {
    const second = path.join(path.dirname(app.vaultPath), path.basename(app.vaultPath) + '-second');
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(second, '第二库.md'), '# 第二个测试库\n');
    check(ipcRenderer.sendSync('vault-open', second, false) === true, '注册第二个隔离库');
    await pause(1000);
    ipcRenderer.sendSync('vault-message', second, { action: 'exec', command: 'workspace:close-window' });
    for(let i=0;i<80&&Object.values(ipcRenderer.sendSync('vault-list')).some(entry=>entry.path===second&&entry.open);i++)await pause(50);
    check(Object.values(ipcRenderer.sendSync('vault-list')).some(entry=>entry.path===second&&!entry.open),'待切换目标库已关闭');
    profile().querySelector('.workspace-drawer-vault-switcher').click(); await pause(30);
    menu = document.querySelector('.menu');
    const row = [...menu.querySelectorAll('.menu-item')].find(el => el.textContent.includes(path.basename(second)));
    check(row, '菜单即时读取新增仓库'); row.click(); await pause(400);
    check(Object.values(ipcRenderer.sendSync('vault-list')).some(entry => entry.path === second && entry.open), '菜单切换调用真实目标库');
  }
  if (screen === 'narrow') {
    workspace.leftSplit.size=180;workspace.render();await pause(40);
    const button=settingButton().getBoundingClientRect(), footer=profile().getBoundingClientRect();
    check(button.width>0&&button.right<=footer.right,'窄侧栏设置按钮不被库名挤出');
  }
  await app.workspace.ensureSideLeaf('file-explorer','left',{reveal:true});
  await app.workspace.ensureSideLeaf('backlink','right',{reveal:true});
  workspace.setActiveLeaf(workspace._firstLeafInCenter());
  if (screen === 'settings') settingButton().click();
  if (screen === 'menu') profile().querySelector('.workspace-drawer-vault-switcher').click();
  return { pass: true, checks, profile: profile().getBoundingClientRect().toJSON(), vault: app.vaultPath };
})()
