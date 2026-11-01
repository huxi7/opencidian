/**
 * [INPUT]: 主进程窗口边框策略、事件通知与 Electron 事件替身。
 * [OUTPUT]: 三平台三种边框、红绿灯隔离和窗口状态事件回归回执。
 * [POS]: 窗口外壳边界回归；渲染几何由 platform-chrome 场景验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { transformSync } from 'esbuild';

const module = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync('src/main/window-chrome.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports });
const { frameWindowOptions, installWindowStateNotifications } = module.exports;
const checks = [];
const check = (label, fn) => { fn(); checks.push(label); };
for (const platform of ['darwin', 'win32', 'linux']) {
  for (const frame of ['hidden', 'custom', 'native']) {
    check(`${platform}/${frame} 平台窗口边框与按钮隔离`, () => {
      const options = frameWindowOptions(frame, platform, '/icon.png');
      assert.equal(options.frame, frame === 'native');
      assert.equal(options.icon, '/icon.png');
      assert.equal(options.autoHideMenuBar, platform === 'darwin' ? undefined : true);
      if (platform !== 'darwin' || frame === 'native') assert.equal(options.trafficLightPosition, undefined);
      if (frame === 'native') assert.equal(options.titleBarStyle, 'default');
      else if (platform === 'darwin') {
        assert.equal(options.titleBarStyle, frame === 'custom' ? 'hiddenInset' : 'hidden');
        assert.equal(options.trafficLightPosition.x, frame === 'custom' ? 12 : 14);
        assert.equal(options.trafficLightPosition.y, 12);
      } else assert.equal(options.titleBarStyle, undefined);
      assert.equal(options.titleBarOverlay, undefined);
    });
  }
}
check('未知边框值回退无边框并遵守平台边界', () => {
  assert.equal(frameWindowOptions('invalid', 'darwin').titleBarStyle, 'hidden');
  assert.equal(frameWindowOptions('invalid', 'win32').frame, false);
});
const win = new EventEmitter();
win.webContents = new EventEmitter();
let destroyed = false, contentsDestroyed = false;
win.isDestroyed = () => destroyed;
win.webContents.isDestroyed = () => contentsDestroyed;
const notifications = [];
win.webContents.send = channel => notifications.push(channel);
installWindowStateNotifications(win);
for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) {
  check(`${event} 通知当前窗口渲染器`, () => {
    const before = notifications.length;
    win.emit(event);
    assert.equal(notifications.length, before + 1);
    assert.equal(notifications.at(-1), 'window-state-changed');
  });
}
check('页面重载后重新同步窗口状态', () => {
  const before = notifications.length;
  win.webContents.emit('did-finish-load');
  assert.equal(notifications.length, before + 1);
});
check('已销毁窗口与页面不发送状态', () => {
  const before = notifications.length;
  destroyed = true; win.emit('maximize');
  destroyed = false; contentsDestroyed = true; win.emit('restore');
  assert.equal(notifications.length, before);
});
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
