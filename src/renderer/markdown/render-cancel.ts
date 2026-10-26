/**
 * [INPUT]: 渲染 Promise 与可选 AbortSignal。
 * [OUTPUT]: RENDER_ABORTED、waitForRender；取消时清空结算回调和信号引用。
 * [POS]: 阅读器异步阶段的取消原语。不取消共享引擎初始化，只释放当前宿主的等待与回调。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const RENDER_ABORTED = Symbol('render-aborted');
interface RenderWaitState<T> {
  resolve: ((value: T | typeof RENDER_ABORTED) => void) | null;
  reject: ((reason: unknown) => void) | null;
  signal: AbortSignal | null;
  abort: (() => void) | null;
}
function settleRender<T>(state: RenderWaitState<T>, outcome: { ok: true; value: T | typeof RENDER_ABORTED } | { ok: false; error: unknown }) {
  if (!state.resolve) return;
  const resolve = state.resolve, reject = state.reject;
  if (state.signal && state.abort) state.signal.removeEventListener('abort', state.abort);
  state.resolve = state.reject = state.signal = state.abort = null;
  if (outcome.ok) resolve(outcome.value);
  else reject?.(outcome.error);
}
export function waitForRender<T>(promise: T | PromiseLike<T>, signal?: AbortSignal): Promise<T | typeof RENDER_ABORTED> {
  if (!signal) return Promise.resolve(promise);
  const state: RenderWaitState<T> = { resolve: null, reject: null, signal, abort: null };
  const waiting = new Promise<T | typeof RENDER_ABORTED>((resolve, reject) => { state.resolve = resolve; state.reject = reject; });
  // 底层 Promise 只持有可清空的状态，不捕获宿主的词法环境。
  state.abort = () => settleRender(state, { ok: true, value: RENDER_ABORTED });
  Promise.resolve(promise).then(value => settleRender(state, { ok: true, value }), error => settleRender(state, { ok: false, error }));
  if (signal.aborted) state.abort();
  else signal.addEventListener('abort', state.abort, { once: true });
  return waiting;
}
