/**
 * [INPUT]: 侧栏模型、真实容器、Web Animations 与 sidebar-chrome。
 * [OUTPUT]: setSidebarCollapsed 切换侧栏；settleSidebarTransitions 在重建前结算动画。
 * [POS]: 每侧独立的收展事务。锁内容宽度，收起活动侧栏恢复中心焦点；迟到回调不得污染新 DOM。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { updateSidebarChrome } from './workspace-sidebar-chrome.js';

const transitions = new WeakMap();
const MOTION = { duration: 140, easing: 'cubic-bezier(0, 0.55, 0.45, 1)', fill: 'both' };
const widthOf = el => el?.getBoundingClientRect?.().width ?? el?.offsetWidth ?? 0;
const sidebarWidth = split => Number.isFinite(split.size) && split.size > 0 ? split.size : 300;
/** 原版收起活动侧栏后，命令与真实焦点回到最近可见的文档。 */
function restoreCenterFocus(workspace, side) {
  if (workspace._sideOf(workspace.activeLeaf) !== side) return;
  const visible = leaf => leaf && !leaf._closed && !leaf.view?._closed &&
    workspace._leafMap.get(leaf.id) === leaf && workspace._sideOf(leaf) === 'center' &&
    (leaf.parent?.isStacked || leaf.parent?.activeLeaf === leaf);
  const candidates = [];
  workspace.iterateAllLeaves(leaf => { if (visible(leaf)) candidates.push(leaf); });
  const recent = workspace._lastActiveLeaves.find(visible) ||
    candidates.sort((a, b) => (b.activeTime || 0) - (a.activeTime || 0))[0];
  if (recent) workspace.setActiveLeaf(recent, { focus: true });
}
function records(workspace) {
  if (!transitions.has(workspace)) transitions.set(workspace, new Map());
  return transitions.get(workspace);
}
function lockContent(split, el) {
  const nodes = (split.children || []).map(node => node.containerEl || node._leafEl).filter(Boolean);
  const saved = nodes.map(node => [node, node.style.minWidth]);
  const overflow = el.style.overflow;
  for (const node of nodes) node.style.minWidth = sidebarWidth(split) + 'px';
  el.style.overflow = 'hidden';
  return () => {
    el.style.overflow = overflow;
    for (const [node, minWidth] of saved) node.style.minWidth = minWidth || '';
  };
}
function applyFinal(workspace, split, el) {
  if (split.containerEl !== el) return;
  const width = split.collapsed ? 0 : sidebarWidth(split);
  el.toggleClass('is-sidedock-collapsed', !!split.collapsed);
  el.toggleClass('is-collapsed', !!split.collapsed);
  el.style.flex = `0 0 ${width}px`;
  el.style.width = width + 'px';
  workspace._updateLeafSizes();
}
function finish(workspace, split, record) {
  const map = records(workspace);
  if (map.get(split) !== record) return;
  map.delete(split);
  if (record.animation) {
    record.animation.onfinish = null; record.animation.oncancel = null;
    record.animation.cancel();
  }
  record.unlock();
  applyFinal(workspace, split, record.el);
}
/** 重建 DOM 或开始拖宽时，模型的最新目标态优先于中间动画帧。 */
export function settleSidebarTransitions(workspace) {
  for (const [split, record] of records(workspace)) finish(workspace, split, record);
}
export function setSidebarCollapsed(workspace, side, collapsed) {
  const split = side === 'left' ? workspace.leftSplit : side === 'right' ? workspace.rightSplit : null;
  if (!split || split.collapsed === collapsed) return false;
  const map = records(workspace), previous = map.get(split), el = split.containerEl;
  const from = widthOf(el);
  if (previous) finish(workspace, split, previous);
  split.collapsed = collapsed;
  if (collapsed) restoreCenterFocus(workspace, side);
  if (!el) { updateSidebarChrome(workspace); workspace.trigger('layout-change'); return true; }
  el.removeClass('is-collapsed', 'is-sidedock-collapsed');
  const target = collapsed ? 0 : sidebarWidth(split);
  const record = { el, animation: null, unlock: lockContent(split, el) };
  map.set(split, record);
  el.style.flex = `0 0 ${target}px`; el.style.width = target + 'px';
  updateSidebarChrome(workspace);
  if (typeof el.animate === 'function' && from !== target) {
    try {
      record.animation = el.animate([
        { flexBasis: from + 'px', width: from + 'px' },
        { flexBasis: target + 'px', width: target + 'px' },
      ], MOTION);
      record.animation.onfinish = () => finish(workspace, split, record);
      record.animation.oncancel = () => finish(workspace, split, record);
    } catch { finish(workspace, split, record); }
  } else finish(workspace, split, record);
  // 目标态立即持久化，另一侧操作或重建不再依赖本动画的完成回调。
  workspace.trigger('layout-change');
  return true;
}
