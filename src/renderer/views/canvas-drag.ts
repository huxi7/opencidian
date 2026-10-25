/**
 * [INPUT]: 浏览器 PointerEvent、窗口监听与调用方拖拽回调。
 * [OUTPUT]: 导出 startDrag、suppressClick、suppressContextMenu。
 * [POS]: 画布拖拽原语。越过阈值才创建拖拽，清理先于结束。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/** 原版 kg：吞掉拖拽之后紧跟的那一次 click。 */
export function suppressClick(el) {
  const handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  window.setTimeout(() => el.removeEventListener('click', handler, { capture: true }), 0);
  el.addEventListener('click', handler, { capture: true });
}

/**
 * 原版 sM(el, "contextmenu")：吞掉拖拽收尾后浏览器补发的那一次 contextmenu。
 * Windows 的顺序是 pointerup → contextmenu；监听必须在 pointerup 的同一任务里挂好，
 * 所以这里与 suppressClick 一样用 0ms 定时器摘除，而不是等下一帧。
 */
export function suppressContextMenu(el) {
  const handler = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  window.setTimeout(() => el.removeEventListener('contextmenu', handler, { capture: true }), 0);
  el.addEventListener('contextmenu', handler, { capture: true });
}

/** 原版 wg：指针拖拽助手。factory 在超过 threshold 后调用一次；cleanup 先于 end/cancel 执行。 */
export function startDrag(e, factory, threshold = 5, onIdle = null) {
  const win = window;
  const start = { x: e.clientX, y: e.clientY };
  let drag = null;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    win.removeEventListener('pointermove', onMove, true);
    win.removeEventListener('pointerup', onUp, true);
    win.removeEventListener('pointercancel', onCancel, true);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('keyup', onKeyUp, true);
    if (drag && drag.cleanup) drag.cleanup();
  };
  function onMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    if (!drag) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < threshold) return;
      drag = factory();
      if (!drag) { cleanup(); return; }
    }
    if (drag.move) drag.move(ev);
  }
  function onUp(ev) {
    // 原版 oM：pointerup 必须来自发起拖动的同一个指针与同一个按键，避免右键拖动被左键松开收尾。
    if (ev.pointerId !== e.pointerId || ev.button !== e.button) return;
    const current = drag;
    cleanup();
    if (current && current.end) current.end(ev);
    // 纯点击（未越过阈值）：拖拽工厂从未创建，必须走 idle 收尾，
    // 否则调用方在 pointerdown 时置的拖动状态永远清不掉（原版 cleanup 总会执行）。
    else if (!current && onIdle) onIdle(ev);
  }
  function onCancel(ev) {
    if (ev.pointerId !== e.pointerId) return;
    const current = drag;
    cleanup();
    if (current && current.cancel) current.cancel(ev);
    else if (!current && onIdle) onIdle(ev);
  }
  function onKeyDown(ev) { if (drag && drag.keydown) drag.keydown(ev); }
  function onKeyUp(ev) { if (drag && drag.keyup) drag.keyup(ev); }
  win.addEventListener('pointermove', onMove, true);
  win.addEventListener('pointerup', onUp, true);
  win.addEventListener('pointercancel', onCancel, true);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('keyup', onKeyUp, true);
}
