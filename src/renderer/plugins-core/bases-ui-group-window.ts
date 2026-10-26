/**
 * [INPUT]: 完整分组清单、单组渲染回调与控制器虚拟器集合。
 * [OUTPUT]: 导出 mountBaseGroupWindow；垂直布局按组测高，看板按列窗口化。
 * [POS]: Bases 组层窗口化。先限制组 DOM，再由组内虚拟器限制记录 DOM。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReadyBasesController as BasesController } from './bases-view.js';
import type { BaseRowGroup } from './bases-types.js';
import { mountBaseVirtualGrid } from './bases-virtual.js';
interface GroupElement extends HTMLElement { basesGroupRelease?: () => void; }
const GROUP_THRESHOLD = 20;
export function mountBaseGroupWindow(controller: BasesController, parent: HTMLElement, groups: BaseRowGroup[], renderGroup: (group: BaseRowGroup) => HTMLElement) {
  const release = (nodes: Iterable<Element>) => {
    for (const node of nodes) {
      if ('basesGroupRelease' in node && typeof node.basesGroupRelease === 'function') node.basesGroupRelease();
      for (const group of node.querySelectorAll?.<GroupElement>('[data-bases-group]') || []) group.basesGroupRelease?.();
    }
  };
  const create = (group: BaseRowGroup) => {
    const before = new Set(controller.virtualizers), node: GroupElement = renderGroup(group);
    const owned = [...controller.virtualizers].filter(handle => !before.has(handle)); node.dataset.basesGroup = group.id;
    node.basesGroupRelease = () => { for (const handle of owned) { handle.destroy(); controller.virtualizers.delete(handle); } };
    return node;
  };
  if (groups.length <= GROUP_THRESHOLD) { for (const group of groups) parent.appendChild(create(group)); return null; }
  parent.classList.add('bases-groups-virtual'); parent.dataset.virtualGroups = String(groups.length);
  const horizontal = controller.view.type === 'kanban';
  if (!horizontal) {
    const virtual = mountBaseVirtualGrid(parent, groups, create, { viewport: parent, columns: 1, estimatedHeight: 180, gap: 10, overscan: 2, forceVirtual: true, onRemove: release });
    const handle = { get destroyed() { return virtual.destroyed; }, destroy() { virtual.destroy(); release([...parent.children]); }, refresh: virtual.refresh, scrollTo: virtual.scrollTo };
    controller.virtualizers.add(handle); return handle;
  }
  const doc = parent.ownerDocument, win = doc.defaultView || window, width = controller.view.columnWidth || 280, gap = 12;
  let start = -1, end = -1, frame = 0, destroyed = false;
  const spacer = (fragment: DocumentFragment, size: number) => { const node = doc.createElement('div'); node.className = 'bases-group-spacer'; node.setAttribute('aria-hidden', 'true'); node.style.cssText = `flex:0 0 ${Math.max(0, size - gap)}px;min-width:0`; fragment.appendChild(node); };
  const paint = () => {
    if (destroyed) return;
    const from = Math.max(0, Math.floor(parent.scrollLeft / (width + gap)) - 1), to = Math.min(groups.length, from + Math.ceil((parent.clientWidth || 900) / (width + gap)) + 3);
    if (from === start && to === end) return;
    start = from; end = to; release([...parent.children]);
    const fragment = doc.createDocumentFragment(); if (from) spacer(fragment, from * (width + gap));
    for (let index = from; index < to; index++) fragment.appendChild(create(groups[index]));
    if (to < groups.length) spacer(fragment, (groups.length - to) * (width + gap));
    parent.replaceChildren(fragment); parent.dataset.groupStart = String(from); parent.dataset.groupEnd = String(to);
  };
  const scroll = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; paint(); }); };
  const resize = new win.ResizeObserver(scroll); resize.observe(parent); parent.addEventListener('scroll', scroll, { passive: true }); paint();
  const handle = { get destroyed() { return destroyed; }, refresh: paint, destroy() { destroyed = true; if (frame) win.cancelAnimationFrame(frame); resize.disconnect(); parent.removeEventListener('scroll', scroll); release([...parent.children]); } };
  controller.virtualizers.add(handle); return handle;
}
