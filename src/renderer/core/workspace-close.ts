/**
 * [INPUT]: 工作区叶子、视图 save/onClose、未绑定反序列化器；workspace-layout 校验持久化协议。
 * [OUTPUT]: 导出隔离布局准备、detachLeafGuarded 与 closeWorkspaceViews；同步视图同步摘除，异步视图等待保存结果。
 * [POS]: 标签和批量布局关闭边界。明确失败保留叶子，布局替换先在隔离树验证，再确认全部视图可保存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Notice } from './notices.js';
import { assertWorkspaceLayout } from './workspace-layout.js';
const rejected = (error: unknown): false => {
  new Notice('无法关闭文档：' + (error instanceof Error ? error.message : String(error)));
  return false;
};
function releaseView(view: { _children?: unknown[] } | null | undefined): void {
  for (const dispose of view?._children || []) if (typeof dispose === 'function') dispose();
  if (view) view._children = [];
}
export function detachLeafGuarded(workspace, leaf) {
  if (leaf._detachPending) return leaf._detachPending;
  if (!leaf.parent) return false;
  const view = leaf.view;
  const finish = accepted => {
    if (accepted === false || leaf.view !== view || !leaf.parent) return false;
    const tabs = leaf.parent; releaseView(view); leaf._closed = true;
    leaf._tabHeaderEl?.detach(); leaf._leafEl?.detach(); leaf._resizeObserver?.disconnect();
    tabs.removeLeaf(leaf); workspace._leafMap.delete(leaf.id);
    workspace._lastActiveLeaves = workspace._lastActiveLeaves.filter(item => item !== leaf);
    if (leaf === workspace.activeLeaf) {
      workspace.activeLeaf = null;
      if (tabs.activeLeaf) workspace.setActiveLeaf(tabs.activeLeaf, { focus: false }); else workspace.trigger('active-leaf-change', null);
    }
    if (!tabs.children.length) workspace._removeTabsNode(tabs);
    else { workspace._syncTabsHeaders(tabs); workspace._syncTabsVisibility(tabs); }
    workspace.trigger('layout-change'); return true;
  };
  try {
    const result = view?.onClose();
    if (!result?.then) return finish(result);
    const pending = result.then(finish).catch(rejected).finally(() => { if (leaf._detachPending === pending) leaf._detachPending = null; });
    leaf._detachPending = pending; return pending;
  } catch (error) { return rejected(error); }
}
export async function closeWorkspaceViews(workspace) {
  const leaves = []; workspace.iterateAllLeaves(leaf => leaves.push(leaf));
  const closed = [];
  const restore = async () => {
    for (const { leaf, state } of closed) {
      leaf.view = null; leaf._resizeObserver = null;
      await leaf.setViewState(state);
    }
  };
  try {
    // 先保存全部文档。任一失败时不开始销毁其它视图。
    for (const leaf of leaves) if (leaf.view?.save && await leaf.view.save() === false) return false;
    for (const leaf of leaves) {
      const state = leaf.view ? { type: leaf.view.getViewType(), state: leaf.view.getState() } : null;
      if (leaf.view && await leaf.view.onClose() === false) { await restore(); return false; }
      releaseView(leaf.view); leaf.view?._rootEl?.detach(); leaf._resizeObserver?.disconnect();
      if (state) closed.push({ leaf, state });
    }
    return true;
  } catch (error) { await restore(); return rejected(error); }
}


export async function prepareWorkspaceLayout(workspace, data: unknown, deserialize) {
  assertWorkspaceLayout(data);
  // 反序列化只写隔离索引，不让无效布局触碰当前树或视图。
  const staged = Object.create(workspace); staged._leafMap = new Map();
  staged.deserializeNode = async nodeData => {
    const node = await deserialize.call(staged, nodeData);
    if (nodeData?.type === 'tabs') node.setStacked(!!nodeData.stacked);
    return node;
  };
  const main = await staged.deserializeNode(data.main);
  const left = await staged.deserializeNode(data.left);
  const right = await staged.deserializeNode(data.right);
  const bind = node => { node.workspace = workspace; node.app = workspace.app; for (const child of node.children || []) bind(child); };
  for (const node of [main, left, right]) bind(node);
  return { main, left, right, leafMap: staged._leafMap };
}
