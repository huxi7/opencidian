/**
 * [INPUT]: 真实 Events/debounce 源码和 VM 内的确定性时钟。
 * [OUTPUT]: 验证任意事件名称、取消和回调重入的生命周期。
 * [POS]: 核心事件回归。不启动 Electron，不等待真实时钟。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const source = transformSync(fs.readFileSync('src/renderer/core/events.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const module = { exports: {} }, timers = new Map();
let serial = 0;
vm.runInNewContext(source, {
  module, exports: module.exports, console,
  setTimeout(fn) { const key = ++serial; timers.set(key, fn); return key; },
  clearTimeout(key) { timers.delete(key); },
});
const { Events, debounce } = module.exports;
const checks = [], check = (name, action) => { action(); checks.push(name); };
const events = new Events();
let count = 0;
const increment = () => count++;
for (const name of ['constructor', '__proto__']) {
  check(`事件名称 ${name} 不与原型碰撞`, () => {
    const before = count;
    const ref = events.on(name, increment);
    events.trigger(name); ref.unregister(); events.trigger(name);
    assert.equal(count, before + 1);
  });
}
check('once在回调重入之前解除', () => {
  const before = count;
  events.once('once', () => { count++; events.trigger('once'); });
  events.trigger('once');
  assert.equal(count, before + 1);
});
const calls = [], target = { label: 'host' };
const task = debounce(function (value) { calls.push([this.label, value]); return value * 2; }, 20);
check('run保留最新参数、this和返回值，且不重放已结算调用', () => {
  task.call(target, 1); task.call(target, 2);
  assert.equal(timers.size, 1);
  assert.equal(task.run(), 4);
  assert.deepEqual(calls, [['host', 2]]);
  assert.equal(timers.size, 0);
  assert.equal(task.run(), undefined);
});
check('cancel取消定时器并丢弃待执行调用', () => {
  task.call(target, 3); task.cancel();
  assert.equal(timers.size, 0);
  assert.equal(task.run(), undefined);
  assert.equal(calls.length, 1);
});
check('防抖回调重入保留下一次调用', () => {
  const values = [];
  const reentrant = debounce(value => { values.push(value); if (value === 1) reentrant(2); }, 20);
  reentrant(1); reentrant.run();
  assert.equal(timers.size, 1);
  reentrant.run();
  assert.deepEqual(values, [1, 2]);
  assert.equal(timers.size, 0);
});
check('resetTimer替换旧定时器并执行最后参数', () => {
  const values = [], resetting = debounce(value => values.push(value), 20, true);
  resetting(4); const old = [...timers.keys()][0]; resetting(5);
  assert.equal(timers.size, 1);
  assert.ok(!timers.has(old));
  resetting.run();
  assert.deepEqual(values, [5]);
});
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
