/**
 * [INPUT]: 工作区叶子、视图 save/onClose、未绑定反序列化器与布局树维护入口。
 * [OUTPUT]: 导出隔离布局准备、detachLeafGuarded 与 closeWorkspaceViews；同步视图同步摘除，异步视图等待保存结果。
 * [POS]: 标签和批量布局关闭边界。明确失败保留叶子，布局替换先在隔离树验证，再确认全部视图可保存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Notice } from './notices.js';
const rejected = error => { new Notice('无法关闭文档：' + error.message); return false; };
function releaseView(view) {
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


export async function prepareWorkspaceLayout(workspace, data, deserialize) {
  const ids = new Set();
  const validate = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !['leaf', 'tabs', 'split'].includes(node.type)) throw Error('布局节点无效');
    if (node.id != null) {
      if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw Error('布局节点 ID 无效或重复');
      ids.add(node.id);
    }
    if (node.type === 'leaf') {
      if (node.state != null && (typeof node.state !== 'object' || Array.isArray(node.state))) throw Error('文档状态无效');
      return;
    }
    if (!Array.isArray(node.children)) throw Error('布局子节点必须是数组');
    if (node.type === 'tabs' && node.currentTab != null && !Number.isInteger(node.currentTab)) throw Error('活动标签索引无效');
    if (node.type === 'tabs' && node.children.some(child => child?.type !== 'leaf')) throw Error('标签组只能包含文档');
    if (node.type === 'split' && node.direction != null && !['horizontal', 'vertical'].includes(node.direction)) throw Error('分栏方向无效');
    node.children.forEach(validate);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('布局必须是对象');
  if (data.lastOpenFiles != null && (!Array.isArray(data.lastOpenFiles) || data.lastOpenFiles.some(file => typeof file !== 'string'))) throw Error('最近文件列表无效');
  if (data.active != null && typeof data.active !== 'string') throw Error('活动文档 ID 无效');
  for (const key of ['leftWidth', 'rightWidth']) if (data[key] != null && (!Number.isFinite(data[key]) || data[key] <= 0)) throw Error('侧栏尺寸无效');
  for (const key of ['main', 'left', 'right']) { if (data[key]?.type !== 'split') throw Error('布局缺少主分栏或侧栏'); validate(data[key]); }
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
