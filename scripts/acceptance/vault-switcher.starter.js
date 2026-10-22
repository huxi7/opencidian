/**
 * [INPUT]: starter 第二窗口、预置仓库注册表（A/B/C 未打开）、原版 DOM 类名与计算样式。
 * [OUTPUT]: DOM/几何/菜单/打开/新建/空态/移除归档等断言；浅/深截图由 OBS_STARTER_* 钩子完成。
 * [POS]: vault-switcher 场景的第二窗口脚本。主窗只负责触发 starter；主进程在本脚本回执完成后才退出。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs');
  const path = require('path');
  const ipc = require('electron').ipcRenderer;
  const checks = [];
  const stage = label => console.log('[starter-checkpoint] ' + label);
  const failures = [];
  const check = (value, label) => { if (value) checks.push(label); else failures.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const text = element => element ? (element.textContent || '').trim() : '';
  const visible = element => !!element && element.isConnected &&
    element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 &&
    getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
  const byText = (selector, value, root = document) =>
    $$(selector, root).find(element => text(element) === value) || null;

  const rawSync = ipc.sendSync;
  const rawSend = ipc.send;
  let closeCalls = [];
  const patch = (overrides) => {
    closeCalls = [];
    ipc.sendSync = function (channel, ...args) {
      if (Object.prototype.hasOwnProperty.call(overrides, channel)) return overrides[channel](...args);
      return rawSync.call(ipc, channel, ...args);
    };
    ipc.send = function (channel, ...args) {
      // 拦截关闭，保留窗口继续断言；其他异步通道照常发送。
      if (channel === 'window-close') { closeCalls.push([channel, ...args]); return; }
      return rawSend.call(ipc, channel, ...args);
    };
  };
  const restore = () => { ipc.sendSync = rawSync; ipc.send = rawSend; };
  const menuItems = () => $$('.menu .menu-item');
  const menuTitles = () => menuItems().map(item => text(item.querySelector('.menu-item-title')));
  const closeMenu = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await pause(30);
  };
  const openMenu = async (row) => {
    const button = row.querySelector('.recent-vaults-list-item-option-button');
    const rect = button.getBoundingClientRect();
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 4,
    }));
    await pause(40);
    return button;
  };

  try {
    stage('started');
    window.addEventListener('error', (event) => {
      failures.push('window error: ' + (event.error && event.error.message || event.message));
    });
    window.addEventListener('unhandledrejection', (event) => {
      failures.push('rejection: ' + (event.reason && event.reason.message || event.reason));
    });
    const registry = ipc.sendSync('vault-list') || {};
    const entries = Object.entries(registry)
      .map(([id, entry]) => ({ id, path: entry.path, ts: entry.ts || 0 }))
      .sort((a, b) => b.ts - a.ts);
    const mainEntry = entries[0];
    const seeded = ['A', 'B', 'C'].map(letter =>
      path.join(path.dirname(mainEntry.path), 'vault-switcher-seeded-' + letter));
    const seededA = seeded[0];
    const seededB = seeded[1];
    const seededC = seeded[2];

    // ---------------------------------------------------------------- window
    check(innerWidth === 800 && innerHeight === 650, '窗口内容区 800×650');
    check(document.body.classList.contains('starter'), 'body.starter');
    check(document.body.classList.contains('theme-dark'), '默认深色主题');
    const titlebar = document.querySelector('.titlebar');
    check(visible(titlebar), 'titlebar 存在');
    check(Math.round(titlebar.getBoundingClientRect().height) === 30, 'titlebar 高度 30');
    check(!document.querySelector('.starter-header'), '旧版 starter-header 已移除');
    check(!document.querySelector('.starter-action'), '旧版 starter-action 已移除');
    check(!document.querySelector('.starter-vault-list'), '旧版 starter-vault-list 已移除');

    // ------------------------------------------------------------------ list
    const recent = document.querySelector('.recent-vaults');
    const splash = document.querySelector('.splash');
    const rows = $$('.recent-vaults-list-item');
    check(visible(recent), '最近仓库列可见');
    check(rows.length === entries.length, '列表行数等于注册库数');
    check(Math.round(recent.getBoundingClientRect().width) === 280, '最近仓库列宽 280');
    check(Math.round(splash.getBoundingClientRect().width) === 520, 'splash 占满剩余 520');
    check(getComputedStyle(recent).paddingTop === '32px', '列表列顶部留白 32');
    check(getComputedStyle(recent).borderRightWidth === '1px', '列表右边框 1px');
    check(getComputedStyle(recent).backgroundColor !== getComputedStyle(splash).backgroundColor, '列表与 splash 底色分层');
    check(!visible(document.querySelector('.quick-start-container')), '有仓库时隐藏快速开始');

    check(rows.length >= 4, '至少 4 行（主库 + A/B/C）');
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const entry = entries[index];
      const name = row.querySelector('.recent-vaults-list-item-name');
      const desc = row.querySelector('.recent-vaults-list-item-path');
      const option = row.querySelector('.recent-vaults-list-item-option-button');
      check(!!name && text(name) === path.basename(entry.path), '行名 = 目录名 #' + index);
      check(!!desc && text(desc) === path.dirname(entry.path), '行路径 = 父目录 #' + index);
      check(!!option && option.getAttribute('aria-label') === '更多选项', '行更多按钮 aria-label #' + index);
      check(!!option.querySelector('svg'), '行更多图标存在 #' + index);
      check(row.getAttribute('tabindex') === '0', '行可键盘聚焦 #' + index);
      check(!row.querySelector('.flair, .mod-current'), '原版无当前库标识 #' + index);
      check(getComputedStyle(row).paddingTop === '8px' &&
        getComputedStyle(row).paddingLeft === '12px' &&
        getComputedStyle(row).paddingRight === '24px', '行内边距 8/12/24 #' + index);
      check(Math.round(option.getBoundingClientRect().width) === 30 &&
        Math.round(option.getBoundingClientRect().height) === 30, '更多按钮 30×30 #' + index);
      check(parseFloat(getComputedStyle(name).fontSize) === 15, '行名字号 15 #' + index);
      check(parseFloat(getComputedStyle(desc).fontSize) === 12, '行路径字号 12 #' + index);
    }
    const firstRowName = text(rows[0].querySelector('.recent-vaults-list-item-name'));
    check(firstRowName === path.basename(mainEntry.path), '最近打开的库排在最上');

    // ---------------------------------------------------------------- brand
    check(!!document.querySelector('.splash-brand-logo svg'), 'splash 晶体 logo');
    check(text(document.querySelector('.splash-brand-logo-text')) === 'OpenSidian', '品牌字 OpenSidian');
    check(/版本|Version/.test(text(document.querySelector('.splash-brand-version'))), '版本行');

    // -------------------------------------------------------------- options
    const openScreen = document.querySelector('.open-vault-options.mod-open-vault');
    const createScreen = document.querySelector('.open-vault-options.mod-create-vault');
    check(visible(openScreen), '打开页默认可见');
    check(openScreen.querySelectorAll('.setting-items > .setting-item').length === 3,
      '打开页三行（新建/打开/语言）');
    check(!openScreen.textContent.includes('同步远程仓库'), '无 Sync 服务时不渲染同步行');
    const openRows = $$('.setting-items > .setting-item', openScreen);
    check(text(openRows[0].querySelector('.setting-item-name')) === '新建仓库', '新建仓库行文案');
    check(text(openRows[1].querySelector('.setting-item-name')) === '打开本地仓库', '打开本地仓库行文案');
    check(openRows[0].querySelector('.setting-item-control button').classList.contains('mod-cta'),
      '新建按钮为主按钮');
    check(!openRows[1].querySelector('.setting-item-control button').classList.contains('mod-cta'),
      '打开按钮为普通按钮');
    for (const row of openRows.slice(0, 2)) {
      const button = row.querySelector('.setting-item-control button');
      check(Math.round(button.getBoundingClientRect().width) === 100, '行按钮宽 100');
      check(Math.round(button.getBoundingClientRect().height) === 30, '行按钮高 30');
    }
    const itemsBox = openScreen.querySelector('.setting-items');
    check(Math.round(itemsBox.getBoundingClientRect().width) === 448, '设置组宽 448');
    check(Math.round(itemsBox.getBoundingClientRect().top) === 251, '设置组顶部 251');
    check(parseFloat(getComputedStyle(itemsBox).borderRadius) === 12, '设置组圆角 12');
    check(getComputedStyle(itemsBox).backgroundColor !== getComputedStyle(openScreen).backgroundColor,
      '设置组有独立底色');
    check(Math.round(openRows[0].getBoundingClientRect().height) === 76, '设置行高 76');
    const languageRow = openScreen.querySelector('.setting-item.mod-change-language');
    check(!!languageRow, '语言/帮助行');
    check(Math.round(languageRow.getBoundingClientRect().height) === 70, '语言行高 70');
    check(!!languageRow.querySelector('svg'), '帮助图标');
    const languageSelect = languageRow.querySelector('select');
    check(!!languageSelect && languageSelect.options.length === 2, '语言下拉两项');
    check(text(languageSelect.options[0]) === 'English' && text(languageSelect.options[1]) === '简体中文',
      '语言下拉文案');
    check(languageSelect.getBoundingClientRect().width ===
      languageRow.querySelector('.setting-item-control').getBoundingClientRect().width,
      '语言下拉占满剩余宽度');

    stage('menus');
    // ----------------------------------------------------------------- menu
    const rowA = rows.find(row => text(row.querySelector('.recent-vaults-list-item-name')) === 'vault-switcher-seeded-A');
    check(!!rowA, '找到 A 行');
    await openMenu(rowA);
    check(visible(document.querySelector('.menu')), '更多按钮打开菜单');
    check(JSON.stringify(menuTitles()) === JSON.stringify([
      '复制仓库 ID', '重命名仓库…', '移动仓库…', '在访达中显示仓库文件夹', '从仓库列表中移除',
    ]), '菜单项与顺序对齐原版');
    check(menuItems().every(item => !!item.querySelector('.menu-item-icon svg')), '菜单项都有图标');
    check(menuItems().at(-1).classList.contains('is-warning'), '移除项为危险色');
    await closeMenu();
    check(!visible(document.querySelector('.menu')), 'Esc 关闭菜单');

    const moreA = rowA.querySelector('.recent-vaults-list-item-option-button');
    moreA.focus();
    moreA.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await pause(40);
    check(visible(document.querySelector('.menu')), '键盘 Enter 打开行菜单');
    await closeMenu();

    // rename 行内编辑：Esc 不落盘
    await openMenu(rowA);
    const renameItem = menuItems().find(item => text(item.querySelector('.menu-item-title')) === '重命名仓库…');
    renameItem.click();
    await pause(40);
    const nameA = rowA.querySelector('.recent-vaults-list-item-name');
    check(nameA.getAttribute('contenteditable') === 'true', '重命名进入行内编辑');
    nameA.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await pause(40);
    check(nameA.getAttribute('contenteditable') === null, 'Esc 退出行内编辑');
    check(text(nameA) === 'vault-switcher-seeded-A', 'Esc 恢复原名');

    stage('open-folder');
    // ------------------------------------------------------------ open folder
    patch({
      'dialog-open': (options) => {
        check(options.properties.includes('openDirectory'), '打开文件夹对话框含 openDirectory');
        return { canceled: false, filePaths: [seededB] };
      },
      'vault-open': (target, create) => {
        check(target === seededB && create === false, '打开本地仓库调用 vault-open(B,false)');
        return true;
      },
    });
    const openButton = byText('button', '打开', openScreen);
    openButton.click();
    await pause(80);
    check(closeCalls.some(call => call[0] === 'window-close'), '成功打开后关闭 starter');
    restore();

    stage('create');
    // ---------------------------------------------------------------- create
    const createRowButton = byText('button', '创建', openScreen);
    createRowButton.click();
    await pause(220);
    const optionsContainer = document.querySelector('.open-vault-options-container');
    check(createScreen.getBoundingClientRect().left === optionsContainer.getBoundingClientRect().left &&
      createScreen.getBoundingClientRect().left > openScreen.getBoundingClientRect().left,
      '新建页滑入');
    check(text(createScreen.querySelector('.back-button')) === '返回', '新建页返回按钮');
    check(text(createScreen.querySelector('.setting-item-heading .setting-item-name')) === '创建本地仓库',
      '新建页标题');
    const nameInput = createScreen.querySelector('input[type="text"]');
    check(!!nameInput && nameInput.placeholder === '仓库名称', '仓库名称输入框');
    check(!!byText('button', '浏览', createScreen), '浏览按钮');
    check(!!byText('button', '创建', createScreen), '新建页创建按钮');

    byText('button', '创建', createScreen).click();
    await pause(60);
    const notice = $$('.notice').find(item => text(item).includes('仓库名称不能为空'));
    check(!!notice, '空名称提示');
    $$('.notice-container').forEach(container => container.remove());

    const parent = path.dirname(mainEntry.path);
    patch({
      'dialog-open': () => ({ canceled: false, filePaths: [parent] }),
      'vault-open': (target, create) => {
        check(target === path.join(parent, 'Acceptance Vault'), '新建路径 = 位置 + 名称');
        check(create === true, '新建调用 vault-open(create=true)');
        return true;
      },
    });
    byText('button', '浏览', createScreen).click();
    await pause(40);
    check(text(createScreen.querySelector('.setting-item:nth-child(2) .setting-item-description'))
      .includes(parent), '位置预览显示父目录');
    check(!!createScreen.querySelector('.u-pop'), '位置预览高亮路径');
    nameInput.value = 'Acceptance Vault';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    byText('button', '创建', createScreen).click();
    await pause(80);
    check(closeCalls.some(call => call[0] === 'window-close'), '新建成功后关闭 starter');
    restore();
    createScreen.querySelector('.back-button').click();
    await pause(200);
    check(openScreen.getBoundingClientRect().left < createScreen.getBoundingClientRect().left,
      '返回打开页');

    stage('quick-start');
    // ------------------------------------------------------- empty + quick start
    const defaultVault = path.join(parent, 'Default Vault');
    patch({
      'vault-list': () => ({}),
      'get-default-vault-path': () => defaultVault,
      'vault-open': (target, create) => {
        check(target === defaultVault && create === true, '快速开始创建默认库');
        return true;
      },
      'vault-message': (target, payload) => {
        check(target === defaultVault, '快速开始默认库路径');
        check(payload && payload.action === 'vault-setup', '快速开始发送 vault-setup');
        return '';
      },
    });
    window.__starterTest.renderVaults();
    await pause(30);
    check(!visible(document.querySelector('.recent-vaults')), '空态隐藏最近仓库列');
    check(visible(document.querySelector('.quick-start-container')), '空态显示快速开始');
    check(Math.round(document.querySelector('.splash').getBoundingClientRect().width) === 800,
      '空态 splash 全宽 800');
    check(Math.round(document.querySelector('.open-vault-options-container').getBoundingClientRect().width) === 540,
      '空态选项区限宽 540');
    const quick = document.querySelector('.quick-start-container button');
    check(text(quick) === '快速开始', '快速开始文案');
    quick.click();
    await pause(80);
    check(closeCalls.some(call => call[0] === 'window-close'), '快速开始成功后关闭 starter');
    restore();
    window.__starterTest.renderVaults();

    stage('row-click');
    // -------------------------------------------------------------- row click
    patch({
      'vault-open': (target, create) => {
        check(target === seededA && create === false, '点击行打开 A 库');
        return true;
      },
    });
    const liveRows = $$('.recent-vaults-list-item');
    liveRows.find(row => text(row.querySelector('.recent-vaults-list-item-name')) === 'vault-switcher-seeded-A').click();
    await pause(80);
    check(closeCalls.some(call => call[0] === 'window-close'), '点击行成功打开后关闭 starter');
    restore();

    stage('remove');
    // ------------------------------------------------------------- remove (C)
    const rowC = $$('.recent-vaults-list-item')
      .find(row => text(row.querySelector('.recent-vaults-list-item-name')) === 'vault-switcher-seeded-C');
    check(!!rowC, '找到 C 行');
    check(fs.existsSync(seededC), 'C 库目录移除前存在');
    await openMenu(rowC);
    const removeItem = menuItems().find(item => text(item.querySelector('.menu-item-title')) === '从仓库列表中移除');
    check(!!removeItem && removeItem.classList.contains('is-warning'), '移除菜单项为危险色');
    removeItem.click();
    await pause(80);
    check(!$$('.recent-vaults-list-item-name').some(element => text(element) === 'vault-switcher-seeded-C'),
      'C 行已从列表移除');
    check(fs.existsSync(seededC), '移除只删列表项，不删用户文件夹');
    check(!Object.values(ipc.sendSync('vault-list') || {}).some(entry => entry.path === seededC),
      'C 已从注册表移除');

    stage('final');
    // ------------------------------------------------------------- final state
    window.__starterTest.showScreen('open');
    await pause(200);
    $$('.notice-container').forEach(container => container.remove());
    $$('.menu').forEach(menu => menu.remove());
    check($$('.recent-vaults-list-item').length === entries.length - 1, '最终列表行数（移除 C）');
    check(getComputedStyle(document.body).getPropertyValue('--background-primary').trim().length > 0,
      '主题令牌可用');
    check(document.body.classList.contains('theme-dark'), '截图前恢复深色主题');
  } catch (error) {
    failures.push('exception: ' + (error && error.message ? error.message : String(error)));
  } finally { restore(); }

  return {
    pass: failures.length === 0,
    count: checks.length,
    checks,
    failures,
  };
})()
