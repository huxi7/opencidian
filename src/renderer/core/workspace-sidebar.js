/**
 * [INPUT]: 插件启用状态、Workspace 模型与 ViewRegistry。
 * [OUTPUT]: 导出固定侧栏视图清单、reconcileSidebars 与 canCloseLeaf。
 * [POS]: 核心工具入口的生命周期边界。修复旧布局遗漏，插件禁用时才移除入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const SIDEBAR_VIEWS = [
  { plugin: 'file-explorer', type: 'file-explorer', side: 'left' },
  { plugin: 'global-search', type: 'search', side: 'left' },
  { plugin: 'bookmarks', type: 'bookmarks', side: 'left' },
  { plugin: 'backlink', type: 'backlink', side: 'right' },
  { plugin: 'outline', type: 'outline', side: 'right' },
  { plugin: 'tag-pane', type: 'tag', side: 'right' },
];

export function canCloseLeaf(workspace, leaf) {
  return !!leaf && workspace._sideOf(leaf) === 'center';
}

export async function reconcileSidebars(workspace) {
  if (!workspace.app.plugins?.internalPlugins) return;
  const active = workspace.activeLeaf;
  const selected = new Map();
  for (const side of [workspace.leftSplit, workspace.rightSplit]) {
    const tabs = workspace._firstTabsIn(side);
    if (tabs?.activeLeaf) selected.set(tabs, tabs.activeLeaf);
  }
  const damaged = [];
  workspace.iterateAllLeaves(leaf => {
    if (workspace._sideOf(leaf) !== 'center' && leaf.view?.getViewType() === 'empty') damaged.push(leaf);
  });
  for (const leaf of damaged) workspace.detachLeaf(leaf);
  for (const entry of SIDEBAR_VIEWS) {
    const enabled = workspace.app.plugins.getInternalPlugin(entry.plugin)?.enabled;
    const leaves = workspace.getLeavesOfType(entry.type)
      .filter(leaf => workspace._sideOf(leaf) === entry.side);
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
