/**
 * [INPUT]: 依赖 ./workspace-model.js 的 WorkspaceLeaf/WorkspaceTabs/WorkspaceSplit；宿主 workspace 提供 serializeNode 实例方法。
 * [OUTPUT]: 导出 serializeNode、getLayout。
 * [POS]: core/workspace 的布局序列化层。递归必须经 workspace.serializeNode，保留 installStackedSerialization 对 tabs 的 stacked 键装饰。
 *        workspace.js 只保留同名薄入口；反序列化仍在 workspace.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceLeaf, WorkspaceSplit, WorkspaceTabs } from './workspace-model.js';

export function serializeNode(workspace, node) {
  if (node instanceof WorkspaceLeaf) {
    const type = node.view ? node.view.getViewType() : 'empty';
    const state = node.view && node.view.getState ? node.view.getState() : {};
    return { id: node.id, type: 'leaf', state: { type, state } };
  }
  if (node instanceof WorkspaceTabs) {
    return { id: node.id, type: 'tabs', currentTab: node.currentTab, children: node.children.map((c) => workspace.serializeNode(c)) };
  }
  if (node instanceof WorkspaceSplit) {
    const s = { id: node.id, type: 'split', direction: node.direction, children: node.children.map((c) => workspace.serializeNode(c)) };
    if (node.size) s.size = node.size;
    return s;
  }
  return null;
}

export function getLayout(workspace) {
  return {
    main: workspace.serializeNode(workspace.centerSplit),
    left: workspace.serializeNode(workspace.leftSplit),
    right: workspace.serializeNode(workspace.rightSplit),
    active: workspace.activeLeaf ? workspace.activeLeaf.id : '',
    lastOpenFiles: workspace.lastOpenFiles,
    leftCollapsed: !!workspace.leftSplit.collapsed,
    rightCollapsed: !!workspace.rightSplit.collapsed,
    leftWidth: workspace.leftSplit.size,
    rightWidth: workspace.rightSplit.size,
    leftActive: workspace.leftSplit.children.length ? workspace.serializeNode(workspace.leftSplit) : null,
  };
}
