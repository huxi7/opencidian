/**
 * [INPUT]: Workspace 分割树、当前 DOM 尺寸、指针事件与侧栏动画收敛入口。
 * [OUTPUT]: 导出 createWorkspaceResizeHandle、cancelWorkspaceResize 与纯尺寸分配函数。
 * [POS]: 工作区尺寸拖动边界。外侧栏只改自身宽度，内部拆分保存比例，取消与重绘释放全局监听。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Workspace } from './workspace.js';
import type { WorkspaceNode, WorkspaceLeaf, WorkspaceTabs as WorkspaceTabs, WorkspaceSplit as WorkspaceSplit } from './workspace-model.js';
import { createDiv } from './dom.js';
import { settleSidebarTransitions } from './workspace-sidebar-transition.js';
const MIN_SIZE = 200;
export function sidebarResizeTarget(workspace: Workspace, split: WorkspaceSplit, index: number, direction: 'horizontal' | 'vertical'): { split: WorkspaceSplit; side: 'left' | 'right'; sign: number } | null {
  if (split !== workspace.rootSplit || direction !== 'vertical') return null;
  const before = split.children[index], after = split.children[index + 1];
  const left = before === workspace.leftSplit ? workspace.leftSplit : before && 'side' in before && before.side === 'left' ? before : null;
  const right = after === workspace.rightSplit ? workspace.rightSplit : after && 'side' in after && after.side === 'right' ? after : null;
  if (left) return { split: left, side: 'left', sign: 1 };
  if (right) return { split: right, side: 'right', sign: -1 };
  return null;
}

export function computeWorkspaceResizeSizes(original: number[], index: number, delta: number) {
  const sizes = [...original];
  if (!Number.isFinite(delta) || !Number.isInteger(index) || index < 0 || index >= sizes.length - 1 || sizes.some(value => !Number.isFinite(value) || value <= 0)) return sizes;
  const before = sizes.map((_, position) => position).slice(0, index + 1).reverse();
  const after = sizes.map((_, position) => position).slice(index + 1);
  const shrinking = delta >= 0 ? after : before, growing = delta >= 0 ? before : after;
  let remainder = Math.min(Math.abs(delta), shrinking.reduce((sum, position) => sum + Math.max(0, sizes[position] - MIN_SIZE), 0));
  const allowed = remainder;
  for (const position of shrinking) { const take = Math.min(remainder, Math.max(0, sizes[position] - MIN_SIZE)); sizes[position] -= take; remainder -= take; }
  sizes[growing[0]] += allowed;
  return sizes;
}
export function cancelWorkspaceResize(workspace: Workspace) { return workspace._workspaceResizeSession?.finish() ?? false; }
export function createWorkspaceResizeHandle(workspace: Workspace, split: WorkspaceSplit, childIndex: number, direction: 'horizontal' | 'vertical') {
  const handle = createDiv('workspace-leaf-resize-handle');
  handle.addClass(direction === 'vertical' ? 'mod-vertical' : 'mod-horizontal'); handle.style.touchAction = 'none';
  const start = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 0 || ('isPrimary' in event && event.isPrimary === false)) return;
    if (workspace._workspaceResizeSession?.handle === handle) return;
    cancelWorkspaceResize(workspace); settleSidebarTransitions(workspace);
    const target = sidebarResizeTarget(workspace, split, childIndex, direction);
    if (target?.split.collapsed) return;
    const doc = handle.ownerDocument || document, win = doc.defaultView || window;
    const axis = direction === 'vertical' ? 'width' : 'height', coordinate = direction === 'vertical' ? 'clientX' : 'clientY';
    const children = [...split.children];
    const element = (node: WorkspaceNode) => node.containerEl || ('_leafEl' in node ? node._leafEl : null);
    const measure = (node: WorkspaceNode) => element(node)?.getBoundingClientRect()[axis] || element(node)?.[direction === 'vertical' ? 'offsetWidth' : 'offsetHeight'] || 0;
    const original = children.map(measure), origin = event[coordinate]; let next = [...original], changed = false, closed = false, temporaryWritten = false;
    const originalStyles = children.map((node: WorkspaceNode) => { const style = element(node)?.style; return style ? { flex: style.flex, width: style.width, height: style.height, flexGrow: style.flexGrow } : null; });
    const startWidth = target ? element(target.split)?.getBoundingClientRect().width || 0 : 0;
    if (!target && (original.length < 2 || original.some(value => value <= 0))) return;
    event.preventDefault(); event.stopPropagation?.();
    const listeners: Array<[EventTarget, string, EventListener]> = [];
    const listen = <K extends keyof WindowEventMap>(owner: EventTarget, type: K, callback: (event: WindowEventMap[K]) => unknown) => {
      const listener: EventListener = event => callback(event as WindowEventMap[K]);
      owner.addEventListener(type, listener); listeners.push([owner, type, listener]);
    };
    const finish = () => {
      if (closed) return false; closed = true;
      for (const [owner, type, callback] of listeners) owner.removeEventListener(type, callback);
      if (workspace._workspaceResizeSession?.handle === handle) workspace._workspaceResizeSession = null;
      doc.body.removeClass('is-resizing', 'is-grabbing'); handle.removeClass('is-active');
      try { if ('pointerId' in event && handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch {}
      if (temporaryWritten && !changed) for (let index = 0; index < children.length; index++) { const el = element(children[index]); if (el && originalStyles[index]) Object.assign(el.style, originalStyles[index]); }
      if (changed && !target) {
        const total = next.reduce((sum, value) => sum + value, 0);
        for (let index = 0; index < children.length; index++) {
          const child = children[index], el = element(child);
          child.dimension = 100 * next[index] / total;
          if (el) { el.style.width = ''; el.style.height = ''; el.style.flex = `${child.dimension} 1 0%`; el.style.flexGrow = String(child.dimension); }
        }
      }
      if (changed) {
        workspace._updateLeafSizes(); workspace.trigger('layout-change');
        if (workspace.app?.saveLayout) Promise.resolve(workspace.app.saveLayout()).catch(() => {});
      }
      return true;
    };
    const move = (current: MouseEvent) => {
      if (current.buttons === 0 || !handle.isConnected || target && (target.side === 'left' ? workspace.leftSplit : workspace.rightSplit) !== target.split) { finish(); return; }
      if (!Number.isFinite(current[coordinate])) return;
      current.preventDefault();
      if (target) {
        const requested = startWidth + target.sign * (current.clientX - event.clientX), dock = target.split;
        if (!dock.collapsed && requested < 50) { workspace.hideSidebar(target.side); settleSidebarTransitions(workspace); changed = true; return; }
        if (dock.collapsed) { if (requested >= MIN_SIZE) { workspace.showSidebar(target.side); settleSidebarTransitions(workspace); changed = true; } return; }
        const maximum = Math.max(MIN_SIZE, (workspace.containerEl?.clientWidth || win.innerWidth || MIN_SIZE) * .8);
        const size = Math.max(MIN_SIZE, Math.min(maximum, requested));
        dock.size = size; const el = element(dock); if (!el) return; el.style.width = size + 'px'; el.style.flex = `0 0 ${size}px`; changed = true;
      } else {
        temporaryWritten = true;
        next = computeWorkspaceResizeSizes(original, childIndex, current[coordinate] - origin);
        for (let index = 0; index < children.length; index++) {
          const el = element(children[index]); if (el) { el.style.flex = '0 0 auto'; el.style[axis] = next[index] + 'px'; }
        }
        changed = changed || next.some((value, index: number) => value !== original[index]);
      }
      workspace._updateLeafSizes();
    };
    workspace._workspaceResizeSession = { handle, finish };
    doc.body.addClass('is-resizing', 'is-grabbing'); handle.addClass('is-active');
    const pointer = event.type === 'pointerdown';
    listen(win, pointer ? 'pointermove' : 'mousemove', move);
    listen(win, pointer ? 'pointerup' : 'mouseup', finish);
    if (pointer) { listen(win, 'mouseup', finish); listen(win, 'pointercancel', finish); listen(handle, 'lostpointercapture', finish); }
    listen(win, 'blur', finish);
    try { if (pointer && 'pointerId' in event) handle.setPointerCapture?.(event.pointerId); } catch {}
  };
  handle.onmousedown = start; handle.addEventListener('pointerdown', start); return handle;
}
