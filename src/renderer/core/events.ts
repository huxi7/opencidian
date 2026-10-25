/**
 * [INPUT]: 事件名称、回调与防抖时限。
 * [OUTPUT]: 导出按事件表校验的 Events、EventRef 和保留参数类型的 debounce。
 * [POS]: 核心事件原语。订阅返回释放句柄，宿主负责生命周期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Events — same shape as Obsidian's public Events class. */
// 未声明事件表的宿主沿用动态 API；声明事件表的宿主校验名称和参数。
// 该兼容类型仅位于事件分派边界，不向 Vault 数据模型传播。
type DynamicEvents = Record<string, any[]>;
type EventTable<T> = { [K in keyof T]: unknown[] };
export interface EventRef<Args extends unknown[] = unknown[]> {
  name: string;
  callback(...args: Args): void;
  unregister(): void;
}
export class Events<Table extends EventTable<Table> = DynamicEvents> {
  private _events: Partial<{ [K in keyof Table]: Array<(...args: Table[K]) => void> }> = Object.create(null);

  on<K extends keyof Table & string>(name: K, callback: (...args: Table[K]) => void): EventRef<Table[K]> {
    (this._events[name] = this._events[name] || []).push(callback);
    return { name, callback, unregister: () => this.off(name, callback) };
  }
  off<K extends keyof Table & string>(name: K, callback?: (...args: Table[K]) => void) {
    const listeners = this._events[name];
    if (!listeners) return;
    if (!callback) { delete this._events[name]; return; }
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  }
  once<K extends keyof Table & string>(name: K, callback: (...args: Table[K]) => void): EventRef<Table[K]> {
    const ref = this.on(name, (...args) => { this.off(name, ref.callback); callback(...args); });
    return ref;
  }
  trigger<K extends keyof Table & string>(name: K, ...args: Table[K]) {
    const listeners = this._events[name];
    if (!listeners) return;
    for (const callback of [...listeners]) {
      try { callback(...args); } catch (error) { console.error(`Error in event handler for "${name}"`, error); }
    }
  }
  offref(ref: Pick<EventRef, 'unregister'> | null | undefined) { ref?.unregister(); }
}

export interface Debounced<Args extends unknown[], Context, Result> {
  (this: Context, ...args: Args): void;
  run(): Result | undefined;
  cancel(): void;
}
export function debounce<Args extends unknown[], Context, Result>(
  fn: (this: Context, ...args: Args) => Result, timeout = 300, resetTimer = false,
): Debounced<Args, Context, Result> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { args: Args; context: Context } | null = null;
  const invoke = () => {
    const call = pending;
    pending = null;
    return call ? fn.apply(call.context, call.args) : undefined;
  };
  const debounced: Debounced<Args, Context, Result> = function (...args) {
    pending = { args, context: this };
    if (resetTimer || timer === null) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; invoke(); }, timeout);
    }
  };
  // 立即执行挂起的调用；先释放引用，允许回调再次安排防抖。
  debounced.run = () => {
    if (timer === null) return undefined;
    clearTimeout(timer);
    timer = null;
    return invoke();
  };
  // 取消时释放参数与宿主，避免长寿命防抖闭包保留已关闭视图。
  debounced.cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    pending = null;
  };
  return debounced;
}

export function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
