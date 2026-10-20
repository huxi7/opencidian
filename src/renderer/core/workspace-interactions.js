/**
 * [INPUT]: 依赖 i18n 与 Menu；首参 workspace 提供叶子与分割操作。
 * [OUTPUT]: 导出新标签、标签菜单、拖拽绑定与落点判定函数。
 * [POS]: 仅中心文档标签响应关闭、拆分与拖拽。侧栏图标保持固定入口。
 * 不持有独立状态，不导入 Workspace；拖拽继续使用宿主的 _dragData。
 * 标签落点按原版 getTabInsertLocation 求插入 index；跨组/分割移动委托 workspace.moveLeafToTabs（搬叶子不重建视图）。
 * 落点覆盖层边缘取 max(尺寸/3,40)，center 用 10px 标签插入条。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from './i18n.js';
import { Menu } from './menu.js';
import { setIcon } from './icons.js';

export function _onNewTab(workspace, tabs) {
  if (workspace._sideOf(tabs) !== 'center') return null;
  const leaf = workspace.createLeafInTabGroup(tabs);
  leaf.setViewState({ type: 'empty' });
  workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

/**
 * 标签页右键菜单。逐条对应 1.14 WorkspaceLeaf.onOpenTabHeaderMenu：
 * 分节表 title/close/pane/open/action/find/info/info.copy/view/view.linked/system/danger；
 * close 组来自 View.onTabMenu（关闭 / 关闭其他 / 关闭右侧 / 全部关闭），pane 组来自 ItemView.onTabMenu（锁定）；
 * 视图自带项经 view.onTabMenu / view.onPaneMenu(menu, 'tab-header') 追加，随后触发 leaf-menu 供插件扩展。
 * popout 新窗口项（moveToNewWindow）由原版 canPopoutWindow 门控，本项目暂无窗口能力，故意缺失。
 */
export function _showTabContextMenu(workspace, ev, leaf) {
  if (!workspace.canCloseLeaf(leaf)) return;
  const menu = new Menu(workspace.app);
  menu.addSections(['title', 'close', 'pane', 'open', 'action', 'find', 'info', 'info.copy', 'view', 'view.linked', 'system', '', 'danger']);
  menu.setSectionSubmenu('info.copy', { title: t('interface.menu.copy-path'), icon: 'lucide-clipboard' });
  menu.setSectionSubmenu('view.linked', { title: t('interface.menu.open-linked-view'), icon: 'lucide-link' });
  const tabs = leaf.parent;
  if (tabs) {
    menu.addItem((item) => item.setSection('close').setTitle(t('interface.menu.close') || 'Close').setIcon('lucide-x').onClick(() => leaf.detach()));
    const siblings = tabs.children.slice();
    const others = siblings.filter((l) => !l.pinned && l !== leaf);
    if (others.length) {
      menu.addItem((item) => item.setSection('close').setTitle(t('interface.menu.close-others') || 'Close others').setIcon('lucide-x')
        .onClick(() => { for (const l of others) l.detach(); }));
    }
    const after = siblings.slice(siblings.indexOf(leaf) + 1).filter((l) => !l.pinned);
    if (after.length) {
      menu.addItem((item) => item.setSection('close').setTitle(t('interface.menu.close-after') || 'Close tabs after').setIcon('lucide-x')
        .onClick(() => { for (const l of after) l.detach(); }));
    }
    const closable = siblings.filter((l) => !l.pinned);
    if (closable.length > 0 && !(closable.length === 1 && closable[0] === leaf)) {
      menu.addItem((item) => item.setSection('close').setTitle(t('interface.menu.close-all') || 'Close all').setIcon('lucide-x')
        .onClick(() => { for (const l of closable) l.detach(); }));
    }
  }
  menu.addItem((item) => item.setSection('pane')
    .setTitle(leaf.pinned ? (t('interface.menu.unpin') || 'Unpin') : (t('interface.menu.pin') || 'Pin'))
    .setIcon('lucide-pin')
    .onClick(() => { leaf.pinned = !leaf.pinned; workspace._syncAllTabs(); }));
  // 原版 ItemView.onPaneMenu：拆分右侧/拆分下方（duplicateLeaf 复制当前视图状态）
  const duplicateLeaf = async (direction) => {
    const view = leaf.view;
    const state = view && view.getState ? view.getState() : null;
    const newLeaf = workspace.createLeafBySplit(leaf, direction);
    await newLeaf.setViewState(state ? { type: view.getViewType(), state } : { type: 'empty' });
    workspace.setActiveLeaf(newLeaf, { focus: true });
  };
  menu.addItem((item) => item.setSection('open').setTitle(t('commands.split-right') || 'Split right')
    .setIcon('lucide-separator-vertical').onClick(() => duplicateLeaf('vertical')));
  menu.addItem((item) => item.setSection('open').setTitle(t('commands.split-down') || 'Split down')
    .setIcon('lucide-separator-horizontal').onClick(() => duplicateLeaf('horizontal')));
  const view = leaf.view;
  if (view && typeof view.onTabMenu === 'function') view.onTabMenu(menu);
  if (view && typeof view.onPaneMenu === 'function') view.onPaneMenu(menu, 'tab-header');
  workspace.trigger('leaf-menu', menu, leaf);
  const header = ev && ev.currentTarget && ev.currentTarget.addClass ? ev.currentTarget : leaf._tabHeaderEl;
  if (header) menu.setParentElement(header);
  menu.showAtMouseEvent(ev);
}

export function _showTabListMenu(workspace, ev, tabs) {
  if (workspace._sideOf(tabs) !== 'center') return;
  const menu = new Menu(workspace.app);
  for (const leaf of tabs.children) {
    const active = tabs.activeLeaf === leaf;
    menu.addItem((item) => item.setTitle(leaf.view ? leaf.view.getDisplayText() : 'Tab').setChecked(active).onClick(() => workspace.setActiveLeaf(leaf, { focus: true })));
  }
  const closable = tabs.children.filter((l) => !l.pinned);
  if (closable.length) {
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t('interface.menu.close-all') || 'Close all').onClick(() => {
      for (const l of [...closable]) l.detach();
    }));
  }
  menu.addSeparator();
  menu.addItem((item) => item.setTitle(t('menu-items.new-tab') || 'New tab').setIcon('plus').onClick(() => workspace._onNewTab(tabs)));
  menu.showAtMouseEvent(ev);
}

/**
 * 原版 VD.getTabInsertLocation：按 clientX 在标签头上求插入 index。
 * 遍历含被拖头本身——同组重排由调用方按原版 `p>f&&p-- 且 f===p 返回` 消解。
 */
export function _tabInsertInfo(tabs, clientX) {
  const children = tabs.children;
  let index = children.length;
  let x = 0;
  let y = 0;
  let height = 0;
  for (let i = 0; i < children.length; i++) {
    const header = children[i]._tabHeaderEl;
    if (!header || !header.isConnected) continue;
    const rect = header.getBoundingClientRect();
    if (i === children.length - 1 || clientX <= rect.right) {
      index = i;
      x = rect.left;
      y = rect.top;
      height = rect.height;
      const mid = (rect.left + rect.right) / 2;
      if (clientX > mid) { index++; x = rect.right; }
      break;
    }
  }
  return { rect: { x: x - 5, y, width: 10, height }, index };
}

/** 原版 getTabInsertLocation 的落点覆盖层：10px 宽竖条贴在插入缝上。 */
function overlayAtRect(node, rect) {
  node.style.left = rect.x + 'px';
  node.style.top = rect.y + 'px';
  node.style.width = Math.max(0, rect.width) + 'px';
  node.style.height = Math.max(0, rect.height) + 'px';
  node.addClass('mod-active');
}

/** 标签栏落点复用 workspace-drop-overlay（原版 dragManager.showOverlay 的同一元素）。 */
function tabOverlayEl(workspace) {
  let el = workspace._tabDropOverlay;
  if (!el || !el.isConnected) {
    el = workspace.containerEl.createDiv('workspace-drop-overlay');
    workspace._tabDropOverlay = el;
  }
  return el;
}

/**
 * 原版 onDragLeaf 的 ghost：drag-ghost mod-leaf（图标 + 标题），setDragImage(0,0)。
 * Chromium 需要元素在 DOM 中渲染过，截图后即可摘除。
 */
export function _dragGhost(workspace, ev) {
  const leaf = workspace._dragData && workspace._dragData.leaf;
  if (!leaf) return;
  const ghost = createDiv('drag-ghost mod-leaf');
  const iconEl = ghost.createDiv('drag-ghost-icon');
  try { setIcon(iconEl, (leaf.view && leaf.view.getIcon && leaf.view.getIcon()) || 'file-text'); } catch (e) {}
  ghost.createSpan({ text: String(((leaf.view && leaf.view.getDisplayText && leaf.view.getDisplayText()) || 'Tab')).slice(0, 60) });
  document.body.appendChild(ghost);
  try {
    if (ev.dataTransfer && ev.dataTransfer.setDragImage) ev.dataTransfer.setDragImage(ghost, 0, 0);
  } catch (e) { /* setDragImage 不受支持时保持元素跟随（拖拽期间由浏览器接管） */ }
  setTimeout(() => ghost.detach(), 0);
}

/** 收尾：按原版移除 is-grabbing，清空宿主拖拽数据与全部落点指示。 */
export function _endTabDrag(workspace) {
  document.body.removeClass('is-grabbing');
  workspace._dragData = null;
  workspace._tabDropTarget = null;
  workspace._clearDropIndicators();
}

export function _setupTabDrag(workspace, header, leaf) {
  if (workspace.canCloseLeaf(leaf) && !header._tabDragBound) {
    header._tabDragBound = true;
    header.addEventListener('dragstart', (ev) => {
      if (leaf.pinned) { ev.preventDefault(); return; }
      workspace._dragData = {
        leaf,
        startX: ev.clientX, startY: ev.clientY, grabbing: false,
        dropTarget: null, dropAfter: false, dropIndex: null,
      };
      try { ev.dataTransfer.setData('text/plain', ''); } catch (e) {}
      ev.dataTransfer.effectAllowed = 'move';
      header.addClass('is-being-dragged');
      workspace._dragGhost(ev);
    });
    header.addEventListener('dragend', () => {
      header.removeClass('is-being-dragged');
      if (workspace._dragData && workspace._dragData.leaf === leaf) workspace._endTabDrag();
    });
  }
  const bar = header.parentElement;
  if (bar && !bar._dropBound) {
    bar._dropBound = true;
    const clearIndicators = () => { workspace._clearLeafDropIndicators(); };
    bar.addEventListener('dragover', (ev) => {
      const drag = workspace._dragData;
      if (!drag || !drag.leaf) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      // 原版 onDragLeaf：位移超过 5px 才进入 grabbing 光标态
      if (!drag.grabbing && (Math.abs(ev.clientX - drag.startX) > 5 || Math.abs(ev.clientY - drag.startY) > 5)) {
        drag.grabbing = true;
        document.body.addClass('is-grabbing');
      }
      const tabsEl = bar.closest('.workspace-tabs');
      const tabs = tabsEl && tabsEl._tabs;
      if (!tabs) return;
      // 原版 getTabInsertLocation + showOverlay：10px 竖条贴在插入缝，::before 内缩 3px、半径 m、50% accent
      const info = _tabInsertInfo(tabs, ev.clientX);
      drag.dropIndex = info.index;
      overlayAtRect(tabOverlayEl(workspace), info.rect);
      const hovered = ev.target && ev.target.closest ? ev.target.closest('.workspace-tab-header') : null;
      drag.dropTarget = hovered && hovered._leaf && hovered._leaf !== drag.leaf ? hovered : null;
      drag.dropAfter = false;
    });
    bar.addEventListener('dragleave', (ev) => {
      if (!bar.contains(ev.relatedTarget)) {
        const drag = workspace._dragData;
        if (drag) { drag.dropTarget = null; drag.dropAfter = false; drag.dropIndex = null; }
        clearIndicators();
      }
    });
    bar.addEventListener('drop', (ev) => {
      const drag = workspace._dragData;
      if (!drag || !drag.leaf) return;
      ev.preventDefault();
      ev.stopPropagation();
      const draggedLeaf = drag.leaf;
      const dropIndex = drag.dropIndex;
      const tabsEl = bar.closest('.workspace-tabs');
      const tabs = tabsEl && tabsEl._tabs;
      workspace._endTabDrag();
      if (!tabs) return;
      const idx = typeof dropIndex === 'number' && dropIndex >= 0 ? dropIndex : tabs.children.length;
      const from = tabs.children.indexOf(draggedLeaf);
      if (from >= 0) {
        // 原版 getTabInsertLocation 的 f===p 返回：拖回原位不动作（索引消解在 moveLeafToTabs 内完成）
        const expected = from < idx ? idx - 1 : idx;
        if (expected === from) return;
      }
      workspace.moveLeafToTabs(draggedLeaf, tabs, idx);
      if (workspace._sideOf(draggedLeaf) === 'center') workspace.setActiveLeaf(draggedLeaf, { focus: true });
    });
  }
}

/** 叶内落点覆盖层：fixed 定位 + 100ms 过渡（原版 workspace-drop-overlay）。
 *  边缘 d=max(尺寸/3, 40)，center 由调用方给标签插入条矩形（原版 showOverlay 语义）。 */
function layoutDropOverlay(el, node, zone) {
  const rect = el.getBoundingClientRect();
  let x = rect.left, y = rect.top, w = rect.width, h = rect.height;
  if (zone === 'left') w = Math.max(rect.width / 3, 40);
  else if (zone === 'right') { const d = Math.max(rect.width / 3, 40); x = rect.left + rect.width - d; w = d; }
  else if (zone === 'top') h = Math.max(rect.height / 3, 40);
  else if (zone === 'bottom') { const d = Math.max(rect.height / 3, 40); y = rect.top + rect.height - d; h = d; }
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  node.style.width = w + 'px';
  node.style.height = h + 'px';
  node.addClass('mod-active');
}

export function _setupLeafDrop(workspace, el, leaf) {
  if (!workspace.canCloseLeaf(leaf)) return;
  let overlayEl = null;
  const overlay = () => {
    if (!overlayEl || !overlayEl.isConnected) {
      overlayEl = el.querySelector(':scope > .workspace-drop-overlay') || el.createDiv('workspace-drop-overlay');
    }
    return overlayEl;
  };
  el.addEventListener('dragover', (ev) => {
    const drag = workspace._dragData;
    if (!drag || !drag.leaf || drag.leaf === leaf) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    const allowed = workspace._sideOf(leaf) !== 'center' ? ['left', 'right'] : null;
    const zone = workspace._dropZone(x, y, allowed);
    leaf._dropZone = zone;
    workspace._clearLeafDropIndicators();
    const node = overlay();
    if (zone === 'center') {
      const tabs = leaf.parent;
      if (tabs && tabs.children && tabs.children.length === 1 && tabs.children[0] === drag.leaf) return;   // 原版：单标签组拖回自身，无落点
      const info = tabs && tabs.children ? _tabInsertInfo(tabs, ev.clientX) : null;
      if (info) overlayAtRect(node, info.rect);
      else layoutDropOverlay(el, node, zone);
    } else {
      layoutDropOverlay(el, node, zone);
    }
    el.toggleClass('is-drop-target', zone === 'center');
    el.toggleClass('mod-drop-left', zone === 'left');
    el.toggleClass('mod-drop-right', zone === 'right');
    el.toggleClass('mod-drop-top', zone === 'top');
    el.toggleClass('mod-drop-bottom', zone === 'bottom');
  });
  el.addEventListener('dragleave', (ev) => {
    if (!el.contains(ev.relatedTarget)) workspace._clearLeafDropIndicators();
  });
  el.addEventListener('drop', (ev) => {
    const drag = workspace._dragData;
    if (!drag || !drag.leaf) return;
    ev.preventDefault();
    ev.stopPropagation();
    const draggedLeaf = drag.leaf;
    const zone = leaf._dropZone || 'center';
    const tabsOfTarget = leaf.parent;
    const info = zone === 'center' && tabsOfTarget && tabsOfTarget.children ? _tabInsertInfo(tabsOfTarget, ev.clientX) : null;
    workspace._clearLeafDropIndicators();
    workspace._endTabDrag();
    if (!tabsOfTarget) return;
    if (zone === 'center') {
      const idx = info ? info.index : tabsOfTarget.children.length;
      workspace.moveLeafToTabs(draggedLeaf, tabsOfTarget, idx);
    } else {
      const direction = (zone === 'left' || zone === 'right') ? 'vertical' : 'horizontal';
      const before = (zone === 'left' || zone === 'top');
      const targetTabs = workspace.createTabsBySplit(leaf, direction, before);
      workspace.moveLeafToTabs(draggedLeaf, targetTabs, 0);
    }
    workspace.setActiveLeaf(draggedLeaf, { focus: true });
  });
}

/** 原版 getDropDirection 的归一化移植：0.33 阈值，按最近边缘取最小值。 */
export function _dropZone(workspace, x, y, allowed) {
  const blocked = allowed || [];
  const left = x, top = y, right = 1 - x, bottom = 1 - y;
  let zone = 'center';
  let min = 1;
  if (top < 0.33 && top < min && !blocked.includes('top')) { min = top; zone = 'top'; }
  if (left < 0.33 && left < min && !blocked.includes('left')) { min = left; zone = 'left'; }
  if (right < 0.33 && right < min && !blocked.includes('right')) { min = right; zone = 'right'; }
  if (bottom < 0.33 && bottom < min && !blocked.includes('bottom')) { min = bottom; zone = 'bottom'; }
  return zone;
}

export function _clearLeafDropIndicators(workspace) {
  workspace.containerEl.findAll('.workspace-leaf.is-drop-target, .workspace-leaf.mod-drop-left, .workspace-leaf.mod-drop-right, .workspace-leaf.mod-drop-top, .workspace-leaf.mod-drop-bottom')
    .forEach((el) => el.removeClass('is-drop-target', 'mod-drop-left', 'mod-drop-right', 'mod-drop-top', 'mod-drop-bottom'));
  workspace.containerEl.findAll('.workspace-drop-overlay.mod-active').forEach((el) => {
    el.removeClass('mod-active');
    el.style.width = '0';
    el.style.height = '0';
  });
}

export function _clearDropIndicators(workspace) {
  workspace._clearLeafDropIndicators();
  workspace._tabDropTarget = null;
}

export function _makeTabBarSortable(workspace, tabs) {
  // handled via header drag events
}
