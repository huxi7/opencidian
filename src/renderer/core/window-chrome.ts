/**
 * [INPUT]: 依赖 IPC 的窗口模式、操作和状态；图标与语言模块；CSS 窗口尺寸变量。
 * [OUTPUT]: 导出 createWindowChrome、syncTrafficLightPosition。
 * [POS]: 四类桌面窗口共用标题栏与状态同步。原生框交给系统；Windows/Linux 自绘右侧按钮。
 *        macOS 红绿灯同步保留原版 app.js 1553478 updateStatus：
 *        pos = floor(cssOffset * zoom / 2 - 8)，x 再 +2；主窗 offset 40px → (14,12)，设置 popout offset 32px → (10,8)。
 *        DOM 类变化（如 is-popout-modal）或缩放变化后必须重新调用，否则会沿用主窗坐标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop, ipcOn } from './ipc.js';
import { setIcon } from './icons.js';
import { tt } from './i18n.js';

export function syncTrafficLightPosition() {
  if (typeof navigator === 'undefined' || !navigator.platform.startsWith('Mac')) return;
  if (typeof getComputedStyle !== 'function') return;
  let zoom = 1;
  try { zoom = require('electron').webFrame.getZoomFactor() || 1; } catch (e) {}
  try {
    const styles = getComputedStyle(document.body);
    const reduce = (value: number) => { const t = Math.floor(value * zoom / 2 - 8); return t < -5 ? 0 : t; };
    const ox = parseFloat(styles.getPropertyValue('--traffic-lights-offset-x')) || 40;
    let oy = parseFloat(styles.getPropertyValue('--traffic-lights-offset-y')) || 40;
    if (!oy) oy = 40;
    Desktop.setTrafficLightPosition(reduce(ox) + 2, reduce(oy));
  } catch (e) { /* 无 Electron 的测试宿主忽略 */ }
}


const mountedChrome = new WeakMap<HTMLElement, HTMLElement>();

/** 窗口外壳只安装一次；启动页与工作区共享状态、按钮和焦点生命周期。 */
export function createWindowChrome(container: HTMLElement, options: { maximizable?: boolean } = {}) {
  const mounted = mountedChrome.get(container);
  if (mounted) return mounted;
  const isMac = navigator.platform.startsWith('Mac');
  container.addClass(isMac ? 'mod-macos' : navigator.platform.startsWith('Win') ? 'mod-windows' : 'mod-linux');
  let nativeFrame = false;
  try { nativeFrame = Desktop.frame() === 'native'; } catch (e) { /* 无主进程时沿用无边框布局 */ }
  container.toggleClass('is-native-frame', nativeFrame);
  container.toggleClass('is-frameless', !nativeFrame);
  container.toggleClass('is-hidden-frameless', !nativeFrame);
  const titlebar = container.createDiv('titlebar');
  const inner = titlebar.createDiv('titlebar-inner');
  const text = inner.createDiv('titlebar-text');
  mountedChrome.set(container, text);
  let maximizeButton: HTMLButtonElement | undefined;
  if (!isMac && !nativeFrame) {
    const controls = inner.createDiv('titlebar-button-container mod-right');
    const makeButton = (kind: string, icon: string, label: string, action: () => void) => {
      const button = controls.createEl('button', { cls: 'titlebar-button clickable-icon mod-' + kind, attr: { type: 'button', 'aria-label': label } });
      setIcon(button, icon);
      button.onclick = event => { event.stopPropagation(); action(); };
      return button;
    };
    makeButton('minimize', 'lucide-minus', tt('interface.window.minimize', '最小化'), () => Desktop.minimizeWindow());
    maximizeButton = makeButton('maximize', 'lucide-square', tt('interface.window.maximize', '最大化'), () => Desktop.maximizeWindow());
    maximizeButton.disabled = options.maximizable === false;
    makeButton('close', 'lucide-x', tt('interface.window.close', '关闭'), () => Desktop.closeWindow());
  }
  titlebar.addEventListener('dblclick', event => {
    if (options.maximizable === false || nativeFrame) return;
    if ((event.target as Element).closest('.titlebar-button, button, input, a')) return;
    Desktop.maximizeWindow();
  });
  installWindowState(container, maximizeButton);
  return text;
}

/** 主进程事件覆盖最大化、还原和全屏；缩放与焦点变化由当前渲染器补齐。 */
function installWindowState(container: HTMLElement, maximizeButton?: HTMLButtonElement) {
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return;
  let lastMaximized: boolean | undefined;
  const sync = () => {
    try {
      const state = Desktop.windowState();
      container.toggleClass('is-maximized', !!state.maximized);
      container.toggleClass('is-fullscreen', !!state.fullscreen);
      if (maximizeButton && state.maximized !== lastMaximized) {
        lastMaximized = state.maximized;
        setIcon(maximizeButton, state.maximized ? 'lucide-copy' : 'lucide-square');
        maximizeButton.setAttr('aria-label', state.maximized
          ? tt('interface.window.restore', '还原') : tt('interface.window.maximize', '最大化'));
      }
    } catch (e) { /* 内存 DOM 验收不提供窗口状态 */ }
    let zoom = 1;
    try { zoom = require('electron').webFrame.getZoomFactor() || 1; } catch (e) {}
    if (typeof container.style.setProperty === 'function') container.style.setProperty('--zoom-factor', String(zoom));
    syncTrafficLightPosition();
  };
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const syncAfterResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sync, 50);
  };
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => { container.addClass('is-focused'); sync(); });
    window.addEventListener('blur', () => container.removeClass('is-focused'));
    window.addEventListener('resize', syncAfterResize);
  }
  if (typeof document.addEventListener === 'function') document.addEventListener('fullscreenchange', sync);
  if (typeof ipcOn === 'function') ipcOn('window-state-changed', sync);
  if (typeof document.hasFocus === 'function') container.toggleClass('is-focused', document.hasFocus());
  sync();
}
