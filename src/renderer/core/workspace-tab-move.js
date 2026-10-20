/**
 * [INPUT]: 依赖 ./workspace-model.js 的 WorkspaceTabs/WorkspaceSplit；宿主 workspace 提供 render/_syncTabsHeaders/_syncTabsVisibility/_removeTabsNode/_sideOf/_firstLeafInCenter。
 * [OUTPUT]: 导出 moveLeafToTabs、createTabsBySplit。
 * [POS]: core/workspace 的标签组搬移层。原版 VD.insertChild + selectTabIndex 与 splitLeaf 的建组部分。
 *        只搬既有叶子与 DOM，不重开视图；建分割仍由宿主 render 落 DOM。workspace.js 只保留同名薄入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceTabs, WorkspaceSplit } from './workspace-model.js';

/**
 * 把既有叶子（连同视图、历史、DOM 元素）搬进目标标签组。
 * 同一个标签组内为纯重排；跨组不重建视图，只搬元素并刷新两边的头/可见性。
 * 源组搬空时交给 workspace._removeTabsNode 收敛分割树。
 */
export function moveLeafToTabs(workspace, leaf, targetTabs, index) {
  const sourceTabs = leaf.parent;
  if (!(targetTabs instanceof WorkspaceTabs) || !sourceTabs) return false;
  let to = (index === undefined || index === null || index < 0 || index > targetTabs.children.length)
    ? targetTabs.children.length : index;
  const from = sourceTabs.children.indexOf(leaf);
  if (from < 0) return false;
  if (sourceTabs === targetTabs) {
    sourceTabs.children.splice(from, 1);
    if (from < to) to -= 1;
    sourceTabs.children.splice(to, 0, leaf);
    sourceTabs.currentTab = to;
    workspace._syncTabsHeaders(sourceTabs);
    workspace._syncTabsVisibility(sourceTabs);
    workspace.trigger('layout-change');
    return true;
  }
  sourceTabs.removeLeaf(leaf);
  targetTabs.addLeaf(leaf, to);
  leaf._dragHost = null;   // 新宿主要重新绑定拖拽
  const header = leaf._tabHeaderEl;
  const host = targetTabs.isStacked ? (targetTabs._tabContainerEl || targetTabs._headersInner) : targetTabs._headersInner;
  if (header && host) host.appendChild(header);
  if (leaf._leafEl && targetTabs._tabContainerEl) targetTabs._tabContainerEl.appendChild(leaf._leafEl);
  if (sourceTabs.children.length === 0) {
    workspace._removeTabsNode(sourceTabs);   // 内部会 render，元素归属已迁走
  } else {
    workspace._syncTabsHeaders(sourceTabs);
    workspace._syncTabsVisibility(sourceTabs);
  }
  workspace._syncTabsHeaders(targetTabs);
  workspace._syncTabsVisibility(targetTabs);
  workspace.trigger('layout-change');
  return true;
}

/** 原版 splitLeaf 的建组部分：只建目标分割与空标签组，不建占位叶子。 */
export function createTabsBySplit(workspace, referenceLeaf, direction, before = false) {
  if (workspace._sideOf(referenceLeaf) !== 'center') referenceLeaf = workspace._firstLeafInCenter();
  const tabs = referenceLeaf.parent;
  const splitParent = tabs ? tabs.parent : null;
  const newTabs = new WorkspaceTabs(workspace);
  const theDirection = direction === 'horizontal' ? 'horizontal' : 'vertical';
  if (splitParent instanceof WorkspaceSplit && splitParent.direction === theDirection) {
    const idx = splitParent.children.indexOf(tabs);
    splitParent.insertChild(before ? idx : idx + 1, newTabs);
  } else if (splitParent instanceof WorkspaceSplit) {
    const idx = splitParent.children.indexOf(tabs);
    const newSplit = new WorkspaceSplit(workspace, theDirection);
    splitParent.removeChild(tabs);
    if (before) { newSplit.insertChild(0, newTabs); newSplit.insertChild(1, tabs); }
    else { newSplit.insertChild(0, tabs); newSplit.insertChild(1, newTabs); }
    splitParent.insertChild(idx, newSplit);
  } else {
    const newSplit = new WorkspaceSplit(workspace, theDirection);
    newSplit.insertChild(0, newTabs);
    workspace.centerSplit.insertChild(workspace.centerSplit.children.length, newSplit);
  }
  workspace.render();
  return newTabs;
}
