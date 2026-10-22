/**
 * [INPUT]: 渲染 Promise 与可选 AbortSignal。
 * [OUTPUT]: RENDER_ABORTED、waitForRender；取消时清空结算回调和信号引用。
 * [POS]: 阅读器异步阶段的取消原语。不取消共享引擎初始化，只释放当前宿主的等待与回调。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const RENDER_ABORTED = Symbol('render-aborted');
function settleRender(state, failed, value) {
  if (!state.resolve) return;
  const settle = failed ? state.reject : state.resolve;
  state.signal.removeEventListener('abort', state.abort);
  state.resolve = state.reject = state.signal = state.abort = null;
  settle(value);
}
export function waitForRender(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  const state = { resolve: null, reject: null, signal, abort: null };
  const waiting = new Promise((resolve, reject) => { state.resolve = resolve; state.reject = reject; });
  // 底层 Promise 只持有可清空的状态，不捕获宿主的词法环境。
  state.abort = settleRender.bind(null, state, false, RENDER_ABORTED);
  Promise.resolve(promise).then(settleRender.bind(null, state, false), settleRender.bind(null, state, true));
  if (signal.aborted) state.abort();
  else signal.addEventListener('abort', state.abort, { once: true });
  return waiting;
}
