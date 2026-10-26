/**
 * [INPUT]: 分割树模型与 Workspace 的递归序列化入口。
 * [OUTPUT]: 导出保留节点判别联合的 serializeNode 和 getLayout。
 * [POS]: 布局持久化边界。递归经过宿主，保留堆叠标签装饰器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceLeaf, WorkspaceSplit, WorkspaceTabs } from './workspace-model.js';
import type { WorkspaceNode } from './workspace-model.js';
import type { Workspace } from './workspace.js';
import type { WorkspaceLayoutNode, WorkspaceLeafData, WorkspaceTabsData, WorkspaceSplitData, WorkspaceLayoutData } from './workspace-layout.js';
function withDimension<T extends WorkspaceLayoutNode>(node: WorkspaceNode, data: T): T {
  if (typeof node.dimension === 'number' && Number.isFinite(node.dimension) && node.dimension > 0) data.dimension = node.dimension;
  return data;
}
export function serializeNode(workspace: Workspace, node: WorkspaceLeaf): WorkspaceLeafData;
export function serializeNode(workspace: Workspace, node: WorkspaceTabs): WorkspaceTabsData;
export function serializeNode(workspace: Workspace, node: WorkspaceSplit): WorkspaceSplitData;
export function serializeNode(workspace: Workspace, node: WorkspaceNode): WorkspaceLayoutNode;
export function serializeNode(workspace: Workspace, node: WorkspaceNode): WorkspaceLayoutNode {
  if (node instanceof WorkspaceLeaf) return withDimension(node, { id: node.id, type: 'leaf', state: { type: node.view?.getViewType() || 'empty', state: node.view?.getState() || {} } });
  if (node instanceof WorkspaceTabs) return withDimension(node, { id: node.id, type: 'tabs', currentTab: node.currentTab, children: node.children.map(child => workspace.serializeNode(child)) });
  const data: WorkspaceSplitData = { id: node.id, type: 'split', direction: node.direction, children: node.children.map(child => workspace.serializeNode(child)) };
  if (node.size) data.size = node.size;
  return withDimension(node, data);
}
export function getLayout(workspace: Workspace): WorkspaceLayoutData {
  return { main: workspace.serializeNode(workspace.centerSplit), left: workspace.serializeNode(workspace.leftSplit), right: workspace.serializeNode(workspace.rightSplit),
    active: workspace.activeLeaf?.id || '', lastOpenFiles: workspace.lastOpenFiles,
    leftCollapsed: workspace.leftSplit.collapsed, rightCollapsed: workspace.rightSplit.collapsed,
    leftWidth: workspace.leftSplit.size, rightWidth: workspace.rightSplit.size,
    leftActive: workspace.leftSplit.children.length ? workspace.serializeNode(workspace.leftSplit) : null };
}
