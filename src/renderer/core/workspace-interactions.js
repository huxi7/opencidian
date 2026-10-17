/**
 * [INPUT]: 依赖 i18n、Menu 与 Notice；首参 workspace 提供叶子与分割操作。
 * [OUTPUT]: 导出新标签、标签菜单、拖拽绑定与落点判定函数。
 * [POS]: 将标签与叶子的 DOM 事件转为 Workspace 操作。
 * 不持有独立状态，不导入 Workspace；拖拽继续使用宿主的 _dragData。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from './i18n.js';
import { Menu } from './menu.js';
import { Notice } from './notices.js';

export function _onNewTab(workspace, tabs) {
  const leaf = workspace.createLeafInTabGroup(tabs);
  leaf.setViewState({ type: 'empty' });
  workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

export function _showTabContextMenu(workspace, ev, leaf) {
  const menu = new Menu(workspace.app);
  const isPinned = leaf.pinned;
  menu.addItem((item) => item.setTitle(isPinned ? (t('interface.menu.unpin') || 'Unpin') : (t('interface.menu.pin') || 'Pin')).setIcon('pin').onClick(() => { leaf.pinned = !leaf.pinned; workspace._syncAllTabs(); }));
  menu.addSeparator();
  menu.addItem((item) => item.setTitle(t('menu-items.close-tab') || 'Close').setIcon('x').onClick(() => leaf.detach()));
  menu.addItem((item) => item.setTitle(t('interface.menu.close-others') || 'Close others').onClick(() => {
    const tabs = leaf.parent;
    if (tabs) for (const l of [...tabs.children]) if (l !== leaf) l.detach();
  }));
  menu.addItem((item) => item.setTitle(t('commands.close-tab-group') || 'Close tab group').onClick(() => {
    const tabs = leaf.parent;
    if (tabs) for (const l of [...tabs.children]) l.detach();
  }));
  menu.addSeparator();
  menu.addItem((item) => item.setTitle(t('menu-items.new-tab') || 'New tab').setIcon('plus').onClick(() => {
    const newLeaf = workspace.getLeaf('tab', leaf.parent);
    newLeaf.setViewState({ type: 'empty' });
    workspace.setActiveLeaf(newLeaf, { focus: true });
  }));
  menu.addItem((item) => item.setTitle(t('menu-items.split-right') || 'Split right').setIcon('separator-vertical').onClick(async () => {
    const newLeaf = workspace.createLeafBySplit(leaf, 'vertical');
    const st = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
    await newLeaf.setViewState(st && st.file ? { type: leaf.view.getViewType(), state: { file: st.file, mode: st.mode } } : { type: 'empty' });
    workspace.setActiveLeaf(newLeaf, { focus: true });
  }));
  menu.addItem((item) => item.setTitle(t('menu-items.split-down') || 'Split down').setIcon('separator-horizontal').onClick(async () => {
    const newLeaf = workspace.createLeafBySplit(leaf, 'horizontal');
    const st = leaf.view && leaf.view.getState ? leaf.view.getState() : null;
    await newLeaf.setViewState(st && st.file ? { type: leaf.view.getViewType(), state: { file: st.file, mode: st.mode } } : { type: 'empty' });
    workspace.setActiveLeaf(newLeaf, { focus: true });
  }));
  if (leaf.parent && leaf.parent.children.length > 1) {
    menu.addItem((item) => item.setTitle(t('interface.menu.move-to-new-window') || 'Move to new window').setIcon('picture-in-picture-2').onClick(() => {
      new Notice('Opening new windows is not supported in this replica.');
    }));
  }
  menu.showAtMouseEvent(ev);
}

export function _showTabListMenu(workspace, ev, tabs) {
  const menu = new Menu(workspace.app);
  for (const leaf of tabs.children) {
    const active = tabs.activeLeaf === leaf;
    menu.addItem((item) => item.setTitle(leaf.view ? leaf.view.getDisplayText() : 'Tab').setChecked(active).onClick(() => workspace.setActiveLeaf(leaf, { focus: true })));
  }
  menu.addSeparator();
  menu.addItem((item) => item.setTitle(t('menu-items.new-tab') || 'New tab').setIcon('plus').onClick(() => workspace._onNewTab(tabs)));
  menu.showAtMouseEvent(ev);
}

export function _setupTabDrag(workspace, header, leaf) {
  header.addEventListener('dragstart', (ev) => {
    if (leaf.pinned) { ev.preventDefault(); return; }
    workspace._dragData = { leaf };
    try { ev.dataTransfer.setData('text/plain', leaf.view ? leaf.view.getDisplayText() : 'tab'); } catch (e) {}
    ev.dataTransfer.effectAllowed = 'move';
    header.addClass('is-being-dragged');
    workspace._dragGhost(ev);
  });
  header.addEventListener('dragend', () => {
    header.removeClass('is-being-dragged');
    workspace._dragData = null;
    workspace._clearDropIndicators();
  });
  // dropping onto the tab bar reorders / un-tabs
  const bar = header.parentElement;
  if (bar && !bar._dropBound) {
    bar._dropBound = true;
    bar.addEventListener('dragover', (ev) => {
      if (!workspace._dragData) return;
      ev.preventDefault();
      const target = ev.target.closest('.workspace-tab-header');
      for (const h of bar.children) h.removeClass('is-tab-drop-before', 'is-tab-drop-after');
      if (target && target._leaf && target._leaf !== workspace._dragData.leaf) {
        const rect = target.getBoundingClientRect();
        target.toggleClass('is-tab-drop-before', ev.clientX < rect.left + rect.width / 2);
        target.toggleClass('is-tab-drop-after', ev.clientX >= rect.left + rect.width / 2);
      }
      workspace._tabDropTarget = target;
    });
    bar.addEventListener('dragleave', (ev) => {
      if (!bar.contains(ev.relatedTarget)) {
        for (const h of bar.children) h.removeClass('is-tab-drop-before', 'is-tab-drop-after');
      }
    });
    bar.addEventListener('drop', async (ev) => {
      if (!workspace._dragData) return;
      ev.preventDefault();
      ev.stopPropagation();
      const drag = workspace._dragData;
      const target = workspace._tabDropTarget;
      const tabsEl = bar.closest('.workspace-tabs');
      const tabs = tabsEl && tabsEl._tabs;
      for (const h of bar.children) h.removeClass('is-tab-drop-before', 'is-tab-drop-after');
      if (!tabs) return;
      const after = target && target._leaf ? target : null;
      const draggedLeaf = drag.leaf;
      const idx = after ? tabs.children.indexOf(after._leaf) + (after.hasClass('is-tab-drop-after') ? 1 : 0) : tabs.children.length;
      const state = draggedLeaf.view && draggedLeaf.view.getState ? draggedLeaf.view.getState() : {};
      const type = draggedLeaf.view ? draggedLeaf.view.getViewType() : 'empty';
      if (draggedLeaf.parent === tabs) {
        // reorder within same stack
        const from = tabs.children.indexOf(draggedLeaf);
        let to = idx;
        if (from < to) to -= 1;
        tabs.children.splice(from, 1);
        tabs.children.splice(to, 0, draggedLeaf);
        tabs.currentTab = to;
        workspace._syncTabsHeaders(tabs);
        workspace._syncTabsVisibility(tabs);
      } else {
        draggedLeaf.detach();
        const newLeaf = workspace.createLeafInTabGroup(tabs, idx);
        await newLeaf.setViewState({ type, state });
        workspace.setActiveLeaf(newLeaf, { focus: true });
      }
      workspace._dragData = null;
    });
  }
}

export function _dragGhost(workspace, ev) {}

export function _setupLeafDrop(workspace, el, leaf) {
  el.addEventListener('dragover', (ev) => {
    if (!workspace._dragData) return;
    if (workspace._dragData.leaf === leaf) return;
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    const zone = workspace._dropZone(x, y);
    leaf._dropZone = zone;
    workspace._clearLeafDropIndicators();
    el.toggleClass('is-drop-target', zone === 'center');
    el.toggleClass('mod-drop-left', zone === 'left');
    el.toggleClass('mod-drop-right', zone === 'right');
    el.toggleClass('mod-drop-top', zone === 'top');
    el.toggleClass('mod-drop-bottom', zone === 'bottom');
  });
  el.addEventListener('dragleave', (ev) => {
    if (!el.contains(ev.relatedTarget)) workspace._clearLeafDropIndicators();
  });
  el.addEventListener('drop', async (ev) => {
    const drag = workspace._dragData;
    if (!drag) return;
    ev.preventDefault();
    ev.stopPropagation();
    const zone = leaf._dropZone || 'center';
    workspace._clearLeafDropIndicators();
    workspace._dragData = null;
    const draggedLeaf = drag.leaf;
    const type = draggedLeaf.view ? draggedLeaf.view.getViewType() : 'empty';
    const state = draggedLeaf.view && draggedLeaf.view.getState ? draggedLeaf.view.getState() : {};
    if (zone === 'center') {
      const tabs = leaf.parent;
      const idx = tabs.children.indexOf(leaf);
      draggedLeaf.detach();
      const newLeaf = workspace.createLeafInTabGroup(tabs, idx + 1);
      await newLeaf.setViewState({ type, state });
      workspace.setActiveLeaf(newLeaf, { focus: true });
    } else {
      const direction = (zone === 'left' || zone === 'right') ? 'vertical' : 'horizontal';
      const before = (zone === 'left' || zone === 'top');
      const newLeaf = workspace.createLeafBySplit(leaf, direction, before);
      draggedLeaf.detach();
      await newLeaf.setViewState({ type, state });
      workspace.setActiveLeaf(newLeaf, { focus: true });
    }
  });
}

export function _dropZone(workspace, x, y) {
  const margin = 0.25;
  if (x < margin && x < y && x < 1 - y) return 'left';
  if (x > 1 - margin && 1 - x < y && 1 - x < 1 - y) return 'right';
  if (y < margin && y < x && y < 1 - x) return 'top';
  if (y > 1 - margin && 1 - y < x && 1 - y < 1 - x) return 'bottom';
  return 'center';
}

export function _clearLeafDropIndicators(workspace) {
  workspace.containerEl.findAll('.workspace-leaf.is-drop-target, .workspace-leaf.mod-drop-left, .workspace-leaf.mod-drop-right, .workspace-leaf.mod-drop-top, .workspace-leaf.mod-drop-bottom')
    .forEach((el) => el.removeClass('is-drop-target', 'mod-drop-left', 'mod-drop-right', 'mod-drop-top', 'mod-drop-bottom'));
}

export function _clearDropIndicators(workspace) {
  workspace._clearLeafDropIndicators();
  workspace.containerEl.findAll('.workspace-tab-header.is-tab-drop-before, .workspace-tab-header.is-tab-drop-after')
    .forEach((el) => el.removeClass('is-tab-drop-before', 'is-tab-drop-after'));
}

export function _makeTabBarSortable(workspace, tabs) {
  // handled via header drag events
}
