/**
 * [INPUT]: 未信任的布局对象；不依赖 DOM、视图或工作区宿主。
 * [OUTPUT]: 导出布局节点判别联合与 assertWorkspaceLayout 校验边界。
 * [POS]: 工作区持久化协议。先校验整棵树，再允许隔离反序列化。
 * 迭代遍历避免校验栈溢出；仅拒绝祖先循环，允许无 ID 节点共享。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
interface WorkspaceNodeData {
  id?: string | null;
  dimension?: number | null;
}
export interface WorkspaceLeafData extends WorkspaceNodeData {
  type: 'leaf';
  state?: Record<string, unknown> | null;
}
export interface WorkspaceTabsData extends WorkspaceNodeData {
  type: 'tabs';
  currentTab?: number | null;
  stacked?: boolean | null;
  children: WorkspaceLeafData[];
}
export interface WorkspaceSplitData extends WorkspaceNodeData {
  type: 'split';
  direction?: 'horizontal' | 'vertical' | null;
  size?: number | null;
  children: WorkspaceLayoutNode[];
}
export type WorkspaceLayoutNode = WorkspaceLeafData | WorkspaceTabsData | WorkspaceSplitData;
export interface WorkspaceLayoutData {
  main: WorkspaceSplitData;
  left: WorkspaceSplitData;
  right: WorkspaceSplitData;
  active?: string | null;
  lastOpenFiles?: string[] | null;
  leftCollapsed?: boolean | null;
  rightCollapsed?: boolean | null;
  leftWidth?: number | null;
  rightWidth?: number | null;
  leftActive?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertPositiveDimension(value: unknown): void {
  if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw Error('侧栏尺寸或分栏比例无效');
}

export function assertWorkspaceLayout(data: unknown): asserts data is WorkspaceLayoutData {
  if (!isRecord(data)) throw Error('布局必须是对象');
  if (data.lastOpenFiles != null && (!Array.isArray(data.lastOpenFiles) || data.lastOpenFiles.some(file => typeof file !== 'string'))) throw Error('最近文件列表无效');
  if (data.active != null && typeof data.active !== 'string') throw Error('活动文档 ID 无效');
  for (const key of ['leftWidth', 'rightWidth']) assertPositiveDimension(data[key]);
  for (const key of ['leftCollapsed', 'rightCollapsed']) if (data[key] != null && typeof data[key] !== 'boolean') throw Error('侧栏折叠状态无效');
  const ids = new Set<string>();
  const ancestors = new Set<object>();
  const pending: { value: unknown; exiting?: boolean }[] = [];
  for (const key of ['main', 'left', 'right']) {
    const root = data[key];
    if (!isRecord(root) || root.type !== 'split') throw Error('布局缺少主分栏或侧栏');
    pending.push({ value: root });
  }
  while (pending.length) {
    const step = pending.pop()!;
    const node = step.value;
    if (!isRecord(node) || (node.type !== 'leaf' && node.type !== 'tabs' && node.type !== 'split')) throw Error('布局节点无效');
    if (step.exiting) { ancestors.delete(node); continue; }
    if (ancestors.has(node)) throw Error('布局节点存在循环');
    if (node.id != null) {
      if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw Error('布局节点 ID 无效或重复');
      ids.add(node.id);
    }
    assertPositiveDimension(node.dimension);
    if (node.type === 'leaf') {
      if (node.state != null && !isRecord(node.state)) throw Error('文档状态无效');
      continue;
    }
    if (!Array.isArray(node.children)) throw Error('布局子节点必须是数组');
    if (node.type === 'tabs') {
      if (node.currentTab != null && (typeof node.currentTab !== 'number' || !Number.isInteger(node.currentTab))) throw Error('活动标签索引无效');
      if (node.stacked != null && typeof node.stacked !== 'boolean') throw Error('堆叠标签状态无效');
      if (node.children.some(child => !isRecord(child) || child.type !== 'leaf')) throw Error('标签组只能包含文档');
    } else {
      if (node.direction != null && node.direction !== 'horizontal' && node.direction !== 'vertical') throw Error('分栏方向无效');
      assertPositiveDimension(node.size);
    }
    ancestors.add(node);
    pending.push({ value: node, exiting: true });
    for (let i = node.children.length - 1; i >= 0; i--) pending.push({ value: node.children[i] });
  }
}
