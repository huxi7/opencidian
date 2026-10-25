/**
 * [INPUT]: Node VM、事件替身与 esbuild 捆绑的 dev-hooks；受控双窗动作 Promise。
 * [OUTPUT]: 输出 {pass,count,checks}，验证双窗完成协调、失败和缺回执超时。
 * [POS]: 验收调度器单测。不启动 Electron，不依赖固定页面执行时长。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import { buildSync } from 'esbuild';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const source = buildSync({ entryPoints: [path.resolve(import.meta.dirname, '../src/main/dev-hooks.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false, external: ['electron'] }).outputFiles[0].text;
const checks = [], check = (message, action) => { action(); checks.push(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) { const end = Date.now() + 500; while (!test()) { if (Date.now() > end) throw Error('test timeout'); await delay(1); } }
function harness(starter = true, timeout = 100) {
  const logs = [], errors = [], app = { quits: 0, quit() { this.quits++; } }, module = { exports: {} };
  const env = { OBS_ACT: JSON.stringify({ action: 'eval', js: 'MAIN_ACTION' }), OBS_SCREENSHOT_DELAY: '0', OBS_SCREENSHOT_EXIT: '1', OBS_STARTER_SCREENSHOT_DELAY: '0', OBS_STARTER_ACT_TIMEOUT: String(timeout) };
  if (starter) env.OBS_STARTER_ACT = JSON.stringify({ action: 'eval', js: 'STARTER_ACTION' });
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name === 'electron' ? { app } : fs, process: { env }, console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) }, setTimeout, clearTimeout });
  function window(action) {
    const win = new EventEmitter(); win.webContents = new EventEmitter(); win.webContents.isLoading = () => false;
    win.webContents.executeJavaScript = async script => script.includes('MAIN_ACTION') || script.includes('STARTER_ACTION') ? action() : undefined;
    return win;
  }
  return { app, logs, errors, window, hook: module.exports.devScreenshotHook };
}
const receipt = { pass: true, count: 1, checks: ['actual assertion'] };
{
  const h = harness(), main = h.window(() => receipt); let finish;
  const starter = h.window(() => new Promise(resolve => { finish = resolve; }));
  h.hook(main, 'main'); await until(() => h.logs.some(line => line.startsWith('[dev] eval:')));
  check('主场景先完成时不会提前退出', () => assert.equal(h.app.quits, 0));
  h.hook(starter, 'starter', { prefix: 'OBS_STARTER_', logTag: 'dev-starter', quit: false }); await until(() => !!finish);
  check('启动器已开始但未完成时继续等待', () => assert.equal(h.app.quits, 0));
  finish(receipt); await until(() => h.app.quits === 1);
  check('启动器有效回执完成后主进程才退出', () => assert.ok(h.logs.some(line => line.startsWith('[dev-starter] eval:')) && !h.errors.length));
}
{
  const h = harness(); h.hook(h.window(() => { throw Error('starter injected failure'); }), 'starter', { prefix: 'OBS_STARTER_', logTag: 'dev-starter', quit: false }); h.hook(h.window(() => receipt), 'main');
  await until(() => h.app.quits === 1);
  check('启动器动作失败保留原失败日志', () => assert.ok(h.errors.some(line => line.includes('[dev-starter] act failed') && line.includes('starter injected failure'))));
  check('启动器失败明确传回主场景', () => assert.ok(h.errors.some(line => line.includes('[dev] act failed'))));
}
{
  const h = harness(true, 20); h.hook(h.window(() => receipt), 'main'); await until(() => h.app.quits === 1);
  check('未出现伴随窗口时有界超时并明确失败', () => assert.ok(h.errors.some(line => line.includes('等待启动器验收回执超时：20ms'))));
}
{
  const h = harness(); h.hook(h.window(() => ({ pass: false, count: 0, checks: [], failures: ['failed'] })), 'starter', { prefix: 'OBS_STARTER_', logTag: 'dev-starter', quit: false }); h.hook(h.window(() => receipt), 'main'); await until(() => h.app.quits === 1);
  check('启动器失败回执不能通过完成门', () => assert.ok(h.errors.some(line => line.includes('没有返回有效的通过回执'))));
}
{
  const h = harness(); const starter = h.window(() => new Promise(() => {})); h.hook(starter, 'starter', { prefix: 'OBS_STARTER_', logTag: 'dev-starter', quit: false }); h.hook(h.window(() => receipt), 'main');
  await until(() => h.logs.some(line => line.startsWith('[dev] eval:'))); starter.emit('closed'); await until(() => h.app.quits === 1);
  check('伴随窗口提前关闭立即报告缺回执失败', () => assert.ok(h.errors.some(line => line.includes('窗口在回执前关闭'))));
}
for (const malformed of [undefined, { pass: true, count: 2, checks: ['one'] }]) {
  const h = harness(); h.hook(h.window(() => malformed), 'starter', { prefix: 'OBS_STARTER_', logTag: 'dev-starter', quit: false }); h.hook(h.window(() => receipt), 'main'); await until(() => h.app.quits === 1);
  check(malformed ? '伴随回执断言数不一致明确失败' : '伴随动作没有回执明确失败', () => assert.ok(h.errors.some(line => line.includes('没有返回有效的通过回执'))));
}
{
  const h = harness(false); h.hook(h.window(() => receipt), 'main'); await until(() => h.app.quits === 1);
  check('无伴随场景正常退出且没有额外超时', () => assert.equal(h.errors.length, 0));
}
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
