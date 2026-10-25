/**
 * [INPUT]: 无模块依赖；使用 dom.js 安装的元素助手；调用方（TableWidget）提供 model/moveRow/moveColumn/selectCells 接口。
 * [OUTPUT]: 导出 attachDragHandle(widget, view, context) 与角度助手 axisRange。
 * [POS]: editor/ 表格部件的手柄拖拽层。逐字移植原版 createDragHandle 的 pointerdown 全流程：rAF 帧循环内做滚动容器边缘自动滚动、
 *        手柄位移钳制、`.table-drag-target.mod-row|mod-col` 落点指示线定位；pointerup 提交 moveRow/moveColumn，
 *        Esc/pointercancel/contextmenu 取消，dragstart/drop 视为结束。table-widget.js 的 buildDragHandle 是唯一调用方。
 *        它不写文档，只调用 widget 的方法。表头行拖拽不产生任何写回（原版 drop 落到 thead 时同样不移动）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** 原版 gg：自动滚动感应带的最大像素宽（随 devicePixelRatio 缩放）。 */
const AUTO_SCROLL_ZONE = 16 * (globalThis.devicePixelRatio || 1);

const eventPoint = (event) => ({ x: event.clientX, y: event.clientY });
const clampValue = (value, min, max) => Math.min(Math.max(value, min), max);

/** 原版 yg(scroller, point, delta, 2)：指针贴边时按超出比例滚动容器。 */
function autoScroll(scroller, point, delta) {
  const rect = scroller.getBoundingClientRect();
  const zoneY = Math.min(rect.height / 3, AUTO_SCROLL_ZONE);
  const zoneX = Math.min(rect.width / 3, AUTO_SCROLL_ZONE);
  let scrolled = false;
  if (point.y < rect.top + zoneY) { scroller.scrollTop -= 2 * delta * (rect.top + zoneY - point.y) / zoneY; scrolled = true; }
  else if (point.y > rect.bottom - zoneY) { scroller.scrollTop += 2 * delta * (point.y - (rect.bottom - zoneY)) / zoneY; scrolled = true; }
  if (point.x < rect.left + zoneX) { scroller.scrollLeft -= 2 * delta * (rect.left + zoneX - point.x) / zoneX; scrolled = true; }
  else if (point.x > rect.right - zoneX) { scroller.scrollLeft += 2 * delta * (point.x - (rect.right - zoneX)) / zoneX; scrolled = true; }
  return scrolled;
}

/** 一个矩形在拖拽轴上的 [min, max]（列取左右边，行取上下边）。 */
export function axisRange(rect, isCol) {
  return { min: isCol ? rect.left : rect.top, max: isCol ? rect.right : rect.bottom };
}

/**
 * 拖拽手柄按下后的完整流程 —— 原版 createDragHandle 的 pointerdown 分支。
 * context = { event, handle, container, tableEl, axis: 'row'|'col', row, col }
 */
export function attachDragHandle(widget, view, context) {
  const { event, handle, container, tableEl, axis, row, col } = context;
  const model = widget.model();
  if (!model) return;
  const isCol = axis === 'col';
  const win = (container.ownerDocument || document).defaultView || window;

  event.preventDefault();
  // 几何在加 is-dragging 之前量取：is-dragging 用 display:none 隐藏其它手柄，被按住的手柄在真实
  // 指针下靠 :active 保持显示，但合成事件不触发 :active，量取放前面两种路径都正确。
  const scroller = isCol ? container : view.scrollDOM;
  const handleRect = handle.getBoundingClientRect();
  const tableRect = tableEl.getBoundingClientRect();
  const wrapper = tableEl.parentElement;
  let borderWidth = parseInt(getComputedStyle(handle).getPropertyValue('--table-border-width'), 10);
  if (Number.isNaN(borderWidth)) borderWidth = 0;
  // 原版：候选箱体取自表头单元格（列拖拽）或全部行（行拖拽），坐标相对表格左上角
  const boxes = (isCol ? Array.from<HTMLTableCellElement>(tableEl.rows[0].cells) : Array.from<HTMLTableRowElement>(tableEl.rows)).map((el, index) => {
    const rect = el.getBoundingClientRect();
    return {
      index,
      left: rect.left - tableRect.left,
      top: rect.top - tableRect.top,
      right: rect.right - tableRect.left,
      bottom: rect.bottom - tableRect.top,
    };
  });

  const tableAxis = axisRange(tableRect, isCol);
  const handleAxis = axisRange(handleRect, isCol);
  const handleStart = isCol ? handle.offsetLeft : handle.offsetTop;
  const scrollStart = isCol ? scroller.scrollLeft : scroller.scrollTop;
  const start = eventPoint(event);
  const rtl = (container.dir || getComputedStyle(container).direction) === 'rtl';
  const handleCenter = (handleAxis.min + handleAxis.max) / 2 - tableAxis.min;
  const minOffset = tableAxis.min - handleAxis.min + borderWidth;
  const maxOffset = tableAxis.max - handleAxis.max - borderWidth;

  // 原版：按下的瞬间整行/整列进入选中态（mod-dragging 由 selectCells 的 dragging 参数给出）
  container.addClass('is-dragging');
  if (isCol) widget.selectCells(view, { row: 0, col }, { row: model.rows.length - 1, col }, true);
  else widget.selectCells(view, { row, col: 0 }, { row, col: model.alignments.length - 1 }, true);

  let pointer = start;
  let target = null;
  let marker = null;
  let frameId = 0;
  let lastFrame = 0;

  const update = (time) => {
    let delta = time - lastFrame;
    if (lastFrame === 0) delta = 50;
    lastFrame = time;
    autoScroll(scroller, pointer, delta);
    const scrollDelta = scrollStart - (isCol ? scroller.scrollLeft : scroller.scrollTop);
    const moved = (isCol ? pointer.x - start.x : pointer.y - start.y) - scrollDelta;
    const position = clampValue(handleCenter + moved, 0, tableAxis.max - tableAxis.min);
    const offset = clampValue(handleStart + moved, minOffset, maxOffset);
    handle.style[isCol ? 'left' : 'top'] = offset + 'px';
    for (const box of boxes) {
      const axisBox = axisRange(box, isCol);
      if (position >= axisBox.min && position <= axisBox.max) {
        target = box;
        if (!marker) marker = container.createDiv('table-drag-target mod-' + axis);
        const startEdge = rtl ? box.right : box.left;
        const endEdge = rtl ? box.left : box.right;
        // 原版落点线：目标在源之前画在目标前沿，否则画在目标后沿；源自身不画
        marker.setCssStyles(isCol ? {
          display: box.index === col ? 'none' : 'block',
          left: (box.index < col ? startEdge : endEdge) + wrapper.offsetLeft + 'px',
          top: wrapper.offsetTop + 'px',
          height: tableRect.height + 'px',
        } : {
          display: box.index === row ? 'none' : 'block',
          left: wrapper.offsetLeft + 'px',
          top: (box.index < row ? box.top : box.bottom) + wrapper.offsetTop + 'px',
          width: tableRect.width + 'px',
        });
        return;
      }
    }
  };
  const frame = (time) => {
    frameId = win.requestAnimationFrame(frame);
    update(time);
  };
  frameId = win.requestAnimationFrame(frame);

  const cleanup = () => {
    win.cancelAnimationFrame(frameId);
    handle.style.left = '';
    handle.style.top = '';
    if (marker) { marker.detach(); marker = null; }
    container.removeClass('is-dragging');
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onEnd);
    win.removeEventListener('pointercancel', onCancel);
    win.removeEventListener('dragstart', onEnd);
    win.removeEventListener('drop', onEnd);
    win.removeEventListener('contextmenu', onCancel);
    win.removeEventListener('keydown', onKeyDown);
  };

  const commit = () => {
    if (!target) return;
    const index = target.index;
    const isMouse = event.pointerType === 'mouse';
    if (isCol) {
      if (col !== index) {
        widget.moveColumn(view, col, index, {
          selection: { anchor: { row: 0, col: index }, head: { row: model.rows.length - 1, col: index } },
        });
      } else if (isMouse) {
        widget.selectCells(view, { row: 0, col: index }, { row: model.rows.length - 1, col: index });
      }
    } else if (row !== index) {
      widget.moveRow(view, row, index, {
        selection: { anchor: { row: index, col: 0 }, head: { row: index, col: model.alignments.length - 1 } },
      });
    } else if (isMouse) {
      widget.selectCells(view, { row: index, col: 0 }, { row: index, col: model.alignments.length - 1 });
    }
    if (index === (isCol ? col : row)) return;
    if (!isMouse) widget.deselectCells();
  };

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    pointer = eventPoint(moveEvent);
    // 帧循环之外再同步更新一次：落点不依赖 rAF 的帧率（隐藏/被遮挡窗口会节流 rAF）
    update(performance.now());
  };
  const onEnd = (endEvent) => {
    if (!endEvent || endEvent.pointerId === undefined || endEvent.pointerId === event.pointerId) {
      if (endEvent && endEvent.type === 'pointerup' && endEvent.button !== event.button) return;
      cleanup();
      commit();
    }
  };
  const onCancel = () => cleanup();
  const onKeyDown = (keyEvent) => { if (keyEvent.key === 'Escape') cleanup(); };

  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onEnd);
  win.addEventListener('pointercancel', onCancel);
  win.addEventListener('dragstart', onEnd);
  win.addEventListener('drop', onEnd);
  win.addEventListener('contextmenu', onCancel);
  win.addEventListener('keydown', onKeyDown);
}
