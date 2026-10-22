/**
 * [INPUT]: 事件名称、回调与防抖时限。
 * [OUTPUT]: 导出 Events 与可取消、可立即执行的 debounce。
 * [POS]: 核心事件原语。订阅返回释放句柄，宿主负责生命周期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Events — same shape as Obsidian's public Events class. */
export class Events {
  constructor() { this._events = {}; }

  on(name, callback) {
    (this._events[name] = this._events[name] || []).push(callback);
    return { name, callback, unregister: () => this.off(name, callback) };
  }
  off(name, callback) {
    if (!this._events[name]) return;
    if (!callback) { delete this._events[name]; return; }
    const arr = this._events[name];
    const i = arr.indexOf(callback);
    if (i >= 0) arr.splice(i, 1);
  }
  once(name, callback) {
    const ref = this.on(name, (...args) => { this.off(name, ref.callback); callback(...args); });
    return ref;
  }
  trigger(name, ...args) {
    const arr = this._events[name];
    if (!arr) return;
    for (const cb of [...arr]) {
      try { cb(...args); } catch (e) { console.error(`Error in event handler for "${name}"`, e); }
    }
  }
  offref(ref) { if (ref && ref.unregister) ref.unregister(); }
}

export function debounce(fn, timeout = 300, resetTimer = false) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;
  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;
    if (resetTimer || timer === null) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(lastThis, lastArgs);
      }, timeout);
    }
  };
  // 立即执行挂起的调用（对齐原版 yc.run）
  debounced.run = function () {
    if (timer === null) return undefined;
    clearTimeout(timer);
    timer = null;
    return fn.apply(lastThis, lastArgs);
  };
  // 丢弃挂起的调用（对齐原版 yc.cancel）
  debounced.cancel = function () {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  return debounced;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
