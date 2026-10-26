/**
 * [INPUT]: 插件启用状态、Workspace 模型与 ViewRegistry。
 * [OUTPUT]: 导出固定侧栏视图清单、reconcileSidebars 与 canCloseLeaf。
 * [POS]: 核心工具入口的生命周期边界。修复旧布局遗漏，插件禁用时才移除入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Workspace } from './workspace.js';
import type { WorkspaceLeaf, WorkspaceTabs } from './workspace-model.js';
export const SIDEBAR_VIEWS = [
  { plugin: 'file-explorer', type: 'file-explorer', side: 'left' as const },
  { plugin: 'global-search', type: 'search', side: 'left' as const },
  { plugin: 'bookmarks', type: 'bookmarks', side: 'left' as const },
  { plugin: 'backlink', type: 'backlink', side: 'right' as const },
  { plugin: 'outline', type: 'outline', side: 'right' as const },
  { plugin: 'tag-pane', type: 'tag', side: 'right' as const },
];

export function canCloseLeaf(workspace: Workspace, leaf: WorkspaceLeaf) {
  return !!leaf && workspace._sideOf(leaf) === 'center';
}

export async function reconcileSidebars(workspace: Workspace) {
  if (!workspace.app.plugins?.internalPlugins) return;
  const active = workspace.activeLeaf;
  const selected = new Map<WorkspaceTabs, WorkspaceLeaf>();
  for (const side of [workspace.leftSplit, workspace.rightSplit]) {
    const tabs = workspace._firstTabsIn(side);
    if (tabs?.activeLeaf) selected.set(tabs, tabs.activeLeaf);
  }
  const damaged: WorkspaceLeaf[] = [];
  workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
    if (workspace._sideOf(leaf) !== 'center' && leaf.view?.getViewType() === 'empty') damaged.push(leaf);
  });
  for (const leaf of damaged) workspace.detachLeaf(leaf);
  for (const entry of SIDEBAR_VIEWS) {
    const enabled = workspace.app.plugins.getInternalPlugin(entry.plugin)?.enabled;
    const leaves = workspace.getLeavesOfType(entry.type)
      .filter((leaf: WorkspaceLeaf) => workspace._sideOf(leaf) === entry.side);
    if (!enabled) {
      for (const leaf of leaves) workspace.detachLeaf(leaf);
      continue;
    }
    if (leaves.length || !workspace.app.viewRegistry.getViewCreator(entry.type)) continue;
    await workspace.ensureSideLeaf(entry.type, entry.side, { reveal: false });
  }
  for (const [tabs, leaf] of selected) {
    const index = tabs.children.indexOf(leaf);
    if (index >= 0) tabs.currentTab = index;
  }
  if (active && workspace._leafMap.has(active.id)) workspace.activeLeaf = active;
  workspace.render();
}
