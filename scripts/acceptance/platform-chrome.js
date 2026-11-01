/**
 * [INPUT]: 隔离 Electron 工作区、真实 CSS 与打包后的共享窗口外壳；平台和 IPC 使用局部替身。
 * [OUTPUT]: 三平台按钮几何、点击通道、边框模式、分屏与侧栏避让回执。
 * [POS]: Mac 上可重复的跨平台 DOM 验收；不替代 Windows/Linux 窗口管理器验收。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const path = require('path');
  const fs = require('fs');
  const root = require('electron').ipcRenderer.sendSync('resources');
  const repository = path.resolve(root, '..');
  const entry = path.join(repository, 'src/renderer/core/window-chrome.ts');
  const compiler = require('esbuild');
  const compiled = await compiler.build({ entryPoints: [entry], bundle: true, write: false,
    platform: 'browser', external: ['electron'], format: 'iife', globalName: 'ChromeTest' });
  const bundle = compiled.outputFiles[0].text;
  compiler.stop();
  const body = document.body;
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
  const originalClasses = body.className;
  const ws = app.workspace;
  const file = await app.vault.create('Window chrome.md', '# Window chrome\n');
  await ws.openFile(file);
  await wait(100);
  const initialLayout = ws.getLayout();
  const rect = element => element.getBoundingClientRect();
  const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  const visible = element => { const r = rect(element); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
  const assertNoOverlap = (controls, label) => {
    const controlRect = rect(controls);
    const candidates = document.querySelectorAll('.sidebar-toggle-button, .workspace-tab-header, .workspace-tab-header-new-tab, .workspace-tab-header-tab-list');
    for (const element of candidates) if (visible(element) && rect(element).top < controlRect.bottom) {
      check(!overlaps(controlRect, rect(element)), label + ' 不覆盖 ' + element.className);
    }
    const rightToggle = ws.rightSidebarToggleEl;
    check(visible(rightToggle) && rect(rightToggle).top < controlRect.bottom, label + ' 右侧开关处于顶排');
  };
  try {
    for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
      for (const frame of ['hidden', 'custom', 'native']) {
        document.querySelector('.titlebar')?.remove();
        body.removeClass('mod-macos', 'mod-windows', 'mod-linux', 'is-maximized', 'is-fullscreen');
        Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
        const calls = [], listeners = new Map();
        const notify = () => { for (const callback of listeners.get('window-state-changed') || []) callback({}); };
        const state = { maximized: false, fullscreen: false };
        const electron = {
          webFrame: { getZoomFactor: () => 1 },
          ipcRenderer: {
            sendSync: channel => channel === 'frame' ? frame : channel === 'window-state' ? state : undefined,
            send: channel => calls.push(channel),
            on: (channel, callback) => listeners.set(channel, [...(listeners.get(channel) || []), callback]), off: () => {},
          },
        };
        const chrome = new Function('require', bundle + '; return ChromeTest;')(() => electron);
        const title = chrome.createWindowChrome(body);
        check(chrome.createWindowChrome(body) === title && document.querySelectorAll('.titlebar').length === 1,
          platform + '/' + frame + ' 重复挂载不重复创建标题栏');
        const controls = document.querySelector('.titlebar-button-container.mod-right');
        const isCustomControls = !platform.startsWith('Mac') && frame !== 'native';
        check(!!controls === isCustomControls, platform + '/' + frame + ' 仅非Mac无边框创建自绘按钮');
        check(body.hasClass('is-native-frame') === (frame === 'native'), platform + '/' + frame + ' 原生边框状态正确');
        if (!isCustomControls) {
          if (frame === 'native') check(getComputedStyle(document.querySelector('.titlebar')).display === 'none', platform + ' 原生框隐藏自绘标题栏');
          continue;
        }
        await wait(30);
        const r = rect(controls);
        check(Math.abs(r.right - innerWidth) < 1 && Math.abs(r.top) < 1, platform + '/' + frame + ' 窗口按钮固定右上');
        check(Math.abs(r.width - 126) < 1, platform + '/' + frame + ' 三按钮总宽匹配126px预留');
        const buttons = [...controls.querySelectorAll('button')];
        check(buttons.length === 3 && buttons.every(button => Math.abs(rect(button).width - 42) < 1), platform + '/' + frame + ' 三按钮等宽42px');
        check(buttons.every(button => getComputedStyle(button).getPropertyValue('-webkit-app-region') === 'no-drag'), platform + '/' + frame + ' 窗口按钮可点击');
        for (const button of buttons) button.click();
        check(calls.slice(-3).join(',') === 'window-minimize,window-maximize,window-close', platform + '/' + frame + ' 点击分派三个窗口操作');
        state.maximized = true; notify();
        check(body.hasClass('is-maximized') && !!buttons[1].querySelector('.lucide-copy'), platform + '/' + frame + ' 最大化同步还原图标');
        state.maximized = false; notify();
        check(!body.hasClass('is-maximized') && !!buttons[1].querySelector('.lucide-square'), platform + '/' + frame + ' 还原同步最大化图标');
        for (const side of ['left', 'right']) if (ws[side + 'Split'].collapsed) ws.toggleSidebar(side);
        await wait(200);
        assertNoOverlap(controls, platform + '/' + frame + ' 双侧栏展开');
        ws.toggleSidebar('right'); await wait(200);
        assertNoOverlap(controls, platform + '/' + frame + ' 右侧栏收起');
        ws.toggleSidebar('left'); await wait(200);
        assertNoOverlap(controls, platform + '/' + frame + ' 双侧栏收起');
        if (frame === 'hidden') {
          ws.createLeafBySplit(ws._firstTabsIn(ws.centerSplit).children[0], 'horizontal');
          await wait(200);
          assertNoOverlap(controls, platform + ' 上下分屏');
          const reserves = [...document.querySelectorAll('.workspace-tabs.mod-top-right-space')].filter(visible);
          check(reserves.length === 1 && rect(reserves[0]).top < 1, platform + ' 只有真实右上组预留窗口按钮空间');
          await ws.loadLayout(initialLayout); await wait(200);
          for (const side of ['left', 'right']) if (!ws[side + 'Split'].collapsed) ws.toggleSidebar(side);
          const webFrame = require('electron').webFrame;
          for (const zoom of [1.25, 1.5]) {
            webFrame.setZoomFactor(zoom); await wait(150);
            check(Math.abs(rect(controls).right - innerWidth) < 1 && Math.abs(rect(controls).width - 126) < 1,
              platform + ' 界面缩放' + zoom + '按钮位置与净空一致');
            assertNoOverlap(controls, platform + ' 界面缩放' + zoom);
          }
          webFrame.setZoomFactor(1); await wait(150);
          body.addClass('is-popout-modal', 'is-settings-window');
          check(getComputedStyle(title).display !== 'none' && rect(title).height > 0, platform + ' 设置窗口保留标题文本');
          check(Math.abs(rect(controls).height - rect(title.closest('.titlebar')).height) <= 1 && rect(controls).height >= 28,
            platform + ' 设置窗口按钮铺满标题栏内容区');
          body.removeClass('is-popout-modal', 'is-settings-window');
          const fixture = body.createDiv();
          chrome.createWindowChrome(fixture, { maximizable: false });
          const disabledMax = fixture.querySelector('.mod-maximize');
          check(disabledMax.disabled, platform + ' 固定尺寸启动窗禁用最大化');
          const beforeClick = calls.length; disabledMax.click();
          check(calls.length === beforeClick, platform + ' 禁用最大化不发送窗口操作');
          fixture.remove();
        }
        state.fullscreen = true; notify();
        check(!visible(controls), platform + '/' + frame + ' 全屏隐藏窗口按钮');
        const host = document.querySelector('.workspace-tabs.mod-top-right-space .workspace-tab-header-container');
        if (host) check(parseFloat(getComputedStyle(host).paddingRight) < 40, platform + '/' + frame + ' 全屏释放右侧按钮留白');
        state.fullscreen = false; notify();
      }
    }
    check(fs.readFileSync(path.join(repository, 'src/renderer/starter.html'), 'utf8').includes('styles/window-chrome.css'), '启动页加载共享窗口按钮样式');
    return { pass: true, count: checks.length, checks };
  } finally {
    require('electron').webFrame.setZoomFactor(1);
    if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform);
    else delete navigator.platform;
    body.className = originalClasses;
    await ws.loadLayout(initialLayout);
  }
})();
