/**
 * [INPUT]: Node assert、AbortController 与阅读器取消原语。
 * [OUTPUT]: {pass,count,checks}；验证取消结算、监听释放及共享后端隔离。
 * [POS]: 异步渲染取消单测；晚到的结果和错误不再进入旧宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { RENDER_ABORTED, waitForRender } from '../src/renderer/markdown/render-cancel.ts';
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const signal = () => {
  const controller = new AbortController(), callbacks = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (name, callback, options) => { if (name === 'abort') callbacks.add(callback); add(name, callback, options); };
  controller.signal.removeEventListener = (name, callback, options) => { if (name === 'abort') callbacks.delete(callback); remove(name, callback, options); };
  return { controller, signal: controller.signal, callbacks };
};
await check('无信号时保留原结果', async () => assert.equal(await waitForRender(Promise.resolve(42)), 42));
await check('无信号时保留原错误', async () => assert.rejects(waitForRender(Promise.reject(Error('failure'))), /failure/));
await check('正常完成释放 AbortSignal 监听', async () => {
  const value = deferred(), owner = signal(); const waiting = waitForRender(value.promise, owner.signal);
  assert.equal(owner.callbacks.size, 1); value.resolve('ready'); assert.equal(await waiting, 'ready'); assert.equal(owner.callbacks.size, 0);
});
await check('异常完成释放 AbortSignal 监听', async () => {
  const value = deferred(), owner = signal(); const waiting = waitForRender(value.promise, owner.signal);
  value.reject(Error('failure')); await assert.rejects(waiting, /failure/); assert.equal(owner.callbacks.size, 0);
});
await check('取消在底层 Promise 未结算时立即完成', async () => {
  const value = deferred(), owner = signal(); const waiting = waitForRender(value.promise, owner.signal);
  owner.controller.abort(); assert.equal(await waiting, RENDER_ABORTED); assert.equal(owner.callbacks.size, 0);
});
await check('取消后的晚到结果不二次回调', async () => {
  const value = deferred(), owner = signal(); let count = 0;
  const waiting = waitForRender(value.promise, owner.signal).then(result => { count++; return result; });
  owner.controller.abort(); assert.equal(await waiting, RENDER_ABORTED); value.resolve('late'); await Promise.resolve(); assert.equal(count, 1);
});
await check('取消后的晚到错误不会产生未捕获拒绝', async () => {
  const failures = [], onFailure = error => failures.push(error); process.on('unhandledRejection', onFailure);
  try {
    const value = deferred(), owner = signal(); const waiting = waitForRender(value.promise, owner.signal);
    owner.controller.abort(); await waiting; value.reject(Error('late'));
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(failures, []);
  } finally { process.off('unhandledRejection', onFailure); }
});
await check('已取消信号不注册新监听', async () => {
  const owner = signal(); owner.controller.abort();
  assert.equal(await waitForRender(Promise.resolve('unused'), owner.signal), RENDER_ABORTED); assert.equal(owner.callbacks.size, 0);
});
await check('取消一个宿主不取消另一个共享后端宿主', async () => {
  const value = deferred(), first = signal(), second = signal();
  const a = waitForRender(value.promise, first.signal), b = waitForRender(value.promise, second.signal);
  first.controller.abort(); assert.equal(await a, RENDER_ABORTED); assert.equal(second.callbacks.size, 1);
  value.resolve('shared'); assert.equal(await b, 'shared'); assert.equal(second.callbacks.size, 0);
});
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
