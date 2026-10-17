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
  return function (...args) {
    lastArgs = args;
    if (resetTimer || timer === null) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, lastArgs);
      }, timeout);
    }
  };
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
