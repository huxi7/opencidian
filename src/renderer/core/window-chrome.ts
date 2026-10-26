/**
 * [INPUT]: 依赖 core/ipc.js 的 Desktop；electron.webFrame 读缩放；body 上的 --traffic-lights-offset-x/y。
 * [OUTPUT]: 导出 syncTrafficLightPosition()。
 * [POS]: macOS 窗口红绿灯位置同步。原版 app.js 1553478 updateStatus：
 *        pos = floor(cssOffset * zoom / 2 - 8)，x 再 +2；主窗 offset 40px → (14,12)，设置 popout offset 32px → (10,8)。
 *        DOM 类变化（如 is-popout-modal）或缩放变化后必须重新调用，否则会沿用主窗坐标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop } from './ipc.js';

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
