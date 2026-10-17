/**
 * [INPUT]: 节点模型、workspace-profile 底栏、i18n、图标与桌面 IPC。
 * [OUTPUT]: 导出工作区挂载、DOM 渲染、标签同步、尺寸与 ribbon 函数。
 * [POS]: 侧栏只创建固定工具图标，库信息栏独立于标签树。由 Workspace 委托渲染。首参 workspace 提供树状态与交互入口。
 * 视图 _rootEl 只迁移不重建；节点类型统一由 workspace-model 导入。
 * 分割方向保持 vertical 横排、horizontal 纵排。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from './workspace-model.js';
import { t, tt } from './i18n.js';
import { createVaultProfile } from './workspace-profile.js';
import { Desktop } from './ipc.js';
import { setIcon } from './icons.js';

export function mount(workspace, container) {
  workspace.containerEl = container;
  container.addClass('workspace');
  // platform state classes, mirroring the original body classes
  container.addClass('is-frameless');
  container.addClass('is-hidden-frameless');
  if (navigator.platform.startsWith('Mac')) container.addClass('mod-macos');
  else if (navigator.platform.startsWith('Win')) container.addClass('mod-windows');
  else container.addClass('mod-linux');

  workspace.ribbonEl = workspace._createRibbon();
  container.appendChild(workspace.ribbonEl);

  workspace.rootSplit = new WorkspaceSplit(workspace, 'vertical');
  workspace.rootSplit.isRoot = true;
  workspace.leftSplit = new WorkspaceSplit(workspace, 'horizontal'); workspace.leftSplit.side = 'left'; workspace.leftSplit.size = 300;
  workspace.centerSplit = new WorkspaceSplit(workspace, 'horizontal'); workspace.centerSplit.side = 'center';
  workspace.rightSplit = new WorkspaceSplit(workspace, 'horizontal'); workspace.rightSplit.side = 'right'; workspace.rightSplit.size = 300;
  workspace.rootSplit.insertChild(0, workspace.leftSplit);
  workspace.rootSplit.insertChild(1, workspace.centerSplit);
  workspace.rootSplit.insertChild(2, workspace.rightSplit);

  workspace.statusBar = createDiv('status-bar');
  container.appendChild(workspace.statusBar);

  // titlebar for frameless window
  const titlebar = container.createDiv('titlebar');
  const inner = titlebar.createDiv('titlebar-inner');
  workspace.titlebarTextEl = inner.createDiv('titlebar-text');
  inner.createDiv('titlebar-button-container');

  workspace.leftSplit.containerEl = null;
  window.addEventListener('focus', () => container.addClass('is-focused'));
  window.addEventListener('blur', () => container.removeClass('is-focused'));
  if (document.hasFocus()) container.addClass('is-focused');
}

export function render(workspace) {
  const rootEl = workspace._getRootEl();
  rootEl.empty();
  for (let i = 0; i < workspace.rootSplit.children.length; i++) {
    const child = workspace.rootSplit.children[i];
    const el = workspace._renderNode(child);
    rootEl.appendChild(el);
    if (i < workspace.rootSplit.children.length - 1) {
      const handle = workspace._createResizeHandle(workspace.rootSplit, i, 'vertical');
      rootEl.appendChild(handle);
    }
  }
  updateSidebarChrome(workspace);
  workspace._updateLeafSizes();
  workspace.trigger('layout-change');
}

export function _getRootEl(workspace) {
  if (!workspace._rootEl) {
    workspace._rootEl = createDiv('workspace-split workspace-root');
    workspace.containerEl.appendChild(workspace._rootEl);
  }
  return workspace._rootEl;
}

export function _renderNode(workspace, node) {
  if (node instanceof WorkspaceSplit) {
    const el = createDiv('workspace-split');
    el.addClass('mod-' + node.direction);
    if (node.side === 'left') el.addClass('mod-left-split', 'mod-sidedock');
    if (node.side === 'right') el.addClass('mod-right-split', 'mod-sidedock');
    if (node.side === 'center') el.addClass('mod-root');
    node.containerEl = el;
    el._split = node;
    if (node.side && node.collapsed) {
      el.addClass('is-collapsed');
      el.style.display = 'none';
    }
    if (node.side && (node.side === 'left' || node.side === 'right')) {
      el.style.flex = `0 0 ${node.size || 300}px`;
      el.style.width = (node.size || 300) + 'px';
      el.style.order = node.side === 'left' ? '-1' : '1';
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      el.appendChild(workspace._renderNode(child));
      if (i < node.children.length - 1) {
        el.appendChild(workspace._createResizeHandle(node, i, node.direction));
      }
    }
    if (node.side === 'left') {
      workspace.vaultProfileEl ||= createVaultProfile(workspace);
      el.appendChild(workspace.vaultProfileEl);
    }
    return el;
  }
  if (node instanceof WorkspaceTabs) {
    return workspace._renderTabs(node);
  }
  if (node instanceof WorkspaceLeaf) {
    return workspace._renderLeaf(node);
  }
  return createDiv();
}

export function _renderTabs(workspace, tabs) {
  const el = createDiv('workspace-tabs');
  el._tabs = tabs;
  tabs.containerEl = el;
  const side = workspace._sideOf(tabs);
  const isRoot = side === 'center';
  if (isRoot) el.addClass('mod-root');
  else el.addClass('mod-top');
  if (side === 'left') el.addClass('mod-top-left-space');
  if (side === 'right') el.addClass('mod-top-right-space');

  const headersOuter = el.createDiv('workspace-tab-header-container');
  tabs._headersOuter = headersOuter;
  const headersInner = headersOuter.createDiv('workspace-tab-header-container-inner');
  tabs._headersInner = headersInner;

  if (isRoot) {
    const newTabBtn = headersOuter.createDiv('workspace-tab-header-new-tab clickable-icon');
    newTabBtn.setAttr('aria-label', tt('menu-items.new-tab', '新标签页'));
    setIcon(newTabBtn, 'plus');
    newTabBtn.onclick = () => workspace._onNewTab(tabs);
    const tabListBtn = headersOuter.createDiv('workspace-tab-header-tab-list clickable-icon');
    tabListBtn.setAttr('aria-label', '标签页列表');
    setIcon(tabListBtn, 'chevrons-up-down');
    tabListBtn.onclick = (ev) => { ev.stopPropagation(); workspace._showTabListMenu(ev, tabs); };
  }
  headersOuter.createDiv('workspace-tab-header-spacer');

  for (const leaf of tabs.children) {
    const header = workspace._createTabHeader(leaf);
    headersInner.appendChild(header);
    el.appendChild(workspace._renderLeaf(leaf));
    leaf.updateTabHeader();
  }
  workspace._syncTabsVisibility(tabs);
  workspace._makeTabBarSortable(tabs);
  return el;
}

export function _renderLeaf(workspace, leaf) {
  const el = createDiv('workspace-leaf');
  leaf._leafEl = el;
  el._leaf = leaf;
  const content = el.createDiv('workspace-leaf-content');
  leaf.contentEl = content;
  const side = workspace._sideOf(leaf);
  content.setAttr('data-type', leaf.view ? leaf.view.getViewType() : 'empty');
  if (leaf.view) leaf.view.containerEl = content;

  const header = content.createDiv('view-header');
  const titleContainer = header.createDiv('view-header-title-container');
  leaf._viewTitleEl = titleContainer.createDiv('view-header-title');
  const actions = header.createDiv('view-actions');
  leaf._viewActionsEl = actions;
  if (leaf.view) {
    leaf.view._viewHeaderEl = header;
    leaf.view._viewActionsEl = actions;
    leaf.view._viewTitleEl = leaf._viewTitleEl;
    workspace._fillViewHeader(leaf);
  }
  // breadcrumbs path for markdown views
  content.appendChild(leaf.view && leaf.view._rootEl ? leaf.view._rootEl : createDiv('view-content'));

  // focus
  content.addEventListener('mousedown', () => {
    if (workspace.activeLeaf !== leaf) workspace.setActiveLeaf(leaf, { focus: false });
  }, true);

  // drag over for tab/leaf drops
  workspace._setupLeafDrop(el, leaf);

  if (leaf._resizeObserver) leaf._resizeObserver.disconnect();
  leaf._resizeObserver = new ResizeObserver(() => {
    if (leaf._resizePending) return;
    leaf._resizePending = true;
    requestAnimationFrame(() => {
      leaf._resizePending = false;
      leaf.view && leaf.view.onResize && leaf.view.onResize();
    });
  });
  leaf._resizeObserver.observe(content);
  return el;
}

export function _fillViewHeader(workspace, leaf) {
  const view = leaf.view;
  if (!view) return;
  if (leaf._viewTitleEl) {
    leaf._viewTitleEl.empty();
    const title = view.getDisplayText();
    leaf._viewTitleEl.setText(typeof title === 'string' ? title : '');
  }
  const actions = leaf._viewActionsEl;
  if (actions) {
    actions.empty();
    view._fillViewActions && view._fillViewActions(actions);
  }
}

export function _refreshLeafContent(workspace, leaf) {
  if (!leaf.contentEl) return;
  const type = leaf.view ? leaf.view.getViewType() : 'empty';
  leaf.contentEl.setAttr('data-type', type);
  if (leaf.view && leaf.view._rootEl && leaf.view._rootEl.parentElement !== leaf.contentEl) {
    leaf.contentEl.appendChild(leaf.view._rootEl);
  }
  workspace._fillViewHeader(leaf);
  leaf.updateTabHeader();
}

export function _ensureLeafDom(workspace, leaf) {
  if (leaf._leafEl && leaf._leafEl.isConnected) { workspace._refreshLeafContent(leaf); return; }
  const tabs = leaf.parent;
  if (!(tabs instanceof WorkspaceTabs)) {
    // leaf not attached to a tabs node yet: create one
    const newTabs = new WorkspaceTabs(workspace);
    newTabs.addLeaf(leaf);
    workspace.centerSplit.insertChild(workspace.centerSplit.children.length, newTabs);
  }
  const parentTabs = leaf.parent;
  if (!parentTabs.containerEl || !parentTabs.containerEl.isConnected) {
    workspace.render();
    return;
  }
  const el = workspace._renderLeaf(leaf);
  parentTabs.containerEl.appendChild(el);
  // ensure tab header exists
  if (!leaf._tabHeaderEl) {
    const header = workspace._createTabHeader(leaf);
    parentTabs._headersInner.appendChild(header);
  }
  // insert header in right position
  workspace._syncTabsHeaders(parentTabs);
  workspace._syncTabsVisibility(parentTabs);
  workspace._makeTabBarSortable(parentTabs);
  leaf.updateTabHeader();
}

export function _createTabHeader(workspace, leaf) {
  const header = createDiv('workspace-tab-header');
  const inner = header.createDiv('workspace-tab-header-inner');
  const iconEl = inner.createDiv('workspace-tab-header-inner-icon');
  const titleEl = inner.createDiv('workspace-tab-header-inner-title');
  const isDocument = workspace.canCloseLeaf(leaf);
  if (isDocument) {
    const closeEl = inner.createDiv('workspace-tab-header-inner-close-button');
    closeEl.setAttr('aria-label', tt('interface.menu.close', '关闭'));
    setIcon(closeEl, 'x');
    closeEl.onclick = (ev) => { ev.stopPropagation(); if (workspace.canCloseLeaf(leaf)) leaf.detach(); };
  }
  header._leaf = leaf;
  leaf._tabHeaderEl = header;
  header.setAttr('draggable', String(isDocument));
  header.setAttr('role', 'tab');
  header.setAttr('tabindex', '0');
  const activate = () => {
    const tabs = leaf.parent;
    if (tabs) tabs.currentTab = tabs.children.indexOf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  };
  header.onclick = (ev) => {
    if (ev.target.closest('.workspace-tab-header-inner-close-button')) return;
    activate();
  };
  header.onkeydown = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
  };
  header.onmousedown = (ev) => { if (ev.button === 1) ev.preventDefault(); };
  header.onauxclick = (ev) => {
    if (ev.button === 1) { ev.preventDefault(); if (workspace.canCloseLeaf(leaf)) leaf.detach(); }
  };
  header.oncontextmenu = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (workspace.canCloseLeaf(leaf)) workspace._showTabContextMenu(ev, leaf);
  };
  if (isDocument) workspace._setupTabDrag(header, leaf);
  return header;
}

export function _syncTabsHeaders(workspace, tabs) {
  const inner = tabs._headersInner;
  if (!inner) return;
  // remove headers of removed leaves
  for (const h of Array.from(inner.children)) {
    if (h._leaf && !tabs.children.includes(h._leaf)) h.detach();
  }
  tabs.children.forEach((leaf, i) => {
    let h = leaf._tabHeaderEl;
    if (!h) h = workspace._createTabHeader(leaf);
    if (h.parentElement !== inner) {
      const ref = inner.children[i] || null;
      inner.insertBefore(h, ref);
    } else if (inner.children[i] !== h) {
      inner.insertBefore(h, inner.children[i] || null);
    }
  });
}

export function _syncTabsVisibility(workspace, tabs) {
  for (const leaf of tabs.children) {
    const isActive = tabs.activeLeaf === leaf;
    if (leaf._leafEl) leaf._leafEl.toggle(isActive);
    if (leaf._tabHeaderEl) {
      leaf._tabHeaderEl.toggleClass('is-active', isActive);
      leaf._tabHeaderEl.setAttr('aria-selected', String(isActive));
      leaf._tabHeaderEl.toggleClass('is-pinned', !!leaf.pinned);
    }
  }
}

export function _syncAllTabs(workspace) {
  const walk = (node) => {
    if (node instanceof WorkspaceTabs) workspace._syncTabsVisibility(node);
    else if (node.children) node.children.forEach(walk);
  };
  if (workspace.rootSplit) walk(workspace.rootSplit);
}

export function _createResizeHandle(workspace, split, childIndex, direction) {
  const handle = createDiv('workspace-leaf-resize-handle');
  handle.addClass(direction === 'vertical' ? 'mod-vertical' : 'mod-horizontal');
  let startPos = 0, sizes = [];
  const isSidebar = split === workspace.leftSplit || split === workspace.rightSplit;
  const onMove = (ev) => {
    if (isSidebar) {
      const delta = ev.clientX - startPos;
      const size = Math.max(180, Math.min(800, sizes[0] + (split === workspace.leftSplit ? delta : -delta)));
      split.size = size;
      if (split.containerEl) {
        split.containerEl.style.flex = `0 0 ${size}px`;
        split.containerEl.style.width = size + 'px';
      }
    } else {
      const delta = direction === 'vertical' ? ev.clientX - startPos : ev.clientY - startPos;
      const total = sizes[0] + sizes[1];
      const s0 = Math.max(80, Math.min(total - 80, sizes[0] + delta));
      const s1 = total - s0;
      const c0 = split.children[childIndex], c1 = split.children[childIndex + 1];
      const el0 = c0 && (c0.containerEl || c0._leafEl);
      const el1 = c1 && (c1.containerEl || c1._leafEl);
      if (el0) { el0.style.flex = `0 0 ${s0}px`; }
      if (el1) { el1.style.flex = `0 0 ${s1}px`; }
    }
    workspace._updateLeafSizes();
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.removeClass('is-resizing');
    workspace.trigger('layout-change');
  };
  handle.onmousedown = (ev) => {
    ev.preventDefault();
    startPos = direction === 'vertical' ? ev.clientX : ev.clientY;
    const c0 = split.children[childIndex], c1 = split.children[childIndex + 1];
    const el0 = c0 && (c0.containerEl || c0._leafEl);
    const el1 = c1 && (c1.containerEl || c1._leafEl);
    sizes = [
      el0 ? (direction === 'vertical' ? el0.offsetWidth : el0.offsetHeight) : 300,
      el1 ? (direction === 'vertical' ? el1.offsetWidth : el1.offsetHeight) : 300,
    ];
    document.body.addClass('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return handle;
}

export function _updateLeafSizes(workspace) {
  workspace.iterateAllLeaves((leaf) => {
    if (leaf._leafEl) {
      leaf.width = leaf._leafEl.offsetWidth;
      leaf.height = leaf._leafEl.offsetHeight;
    }
  });
}

export function _createRibbon(workspace) {
  const ribbon = createDiv('workspace-ribbon side-dock-ribbon mod-left');
  const actions = ribbon.createDiv('side-dock-actions');
  workspace.ribbonActionsEl = actions;
  const bottom = ribbon.createDiv('side-dock-settings');
  workspace.ribbonSettingsEl = bottom;
  return ribbon;
}

export function addRibbonItem(workspace, icon, title, callback, target) {
  const el = createDiv('side-dock-ribbon-action clickable-icon');
  el.setAttr('aria-label', title);
  el.setAttr('title', title);
  el.setAttr('role', 'button');
  el.setAttr('tabindex', '0');
  setIcon(el, icon);
  el.onclick = (ev) => callback(ev);
  el.onkeydown = (event) => {
    if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      callback(event);
    }
  };
  const container = target === 'bottom' ? workspace.ribbonSettingsEl : workspace.ribbonActionsEl;
  container.appendChild(el);
  return el;
}

export function refreshHeaderVisibility(workspace) {
  const show = workspace.app.settings.config.showViewHeader !== false;
  workspace.containerEl.findAll('.view-header').forEach((el) => el.toggleClass('is-hidden', !show));
}

/** 左栏收起后开关移至中心标题栏，底部操作保留在功能区。 */
function updateSidebarChrome(workspace) {
  const centerTabs = [];
  const collect = node => {
    if (node instanceof WorkspaceTabs) centerTabs.push(node);
    else for (const child of node.children || []) collect(child);
  };
  collect(workspace.centerSplit);
  const leftTabs = workspace._firstTabsIn(workspace.leftSplit);
  const rightTabs = workspace._firstTabsIn(workspace.rightSplit);
  const left = !workspace.leftSplit.collapsed && leftTabs ? leftTabs : centerTabs[0];
  const right = !workspace.rightSplit.collapsed && rightTabs ? rightTabs : centerTabs.at(-1);
  for (const side of ['left', 'right']) {
    const split = side === 'left' ? workspace.leftSplit : workspace.rightSplit;
    workspace.containerEl.toggleClass(`is-${side}-sidedock-open`, !split.collapsed);
    const key = side === 'left' ? 'leftSidebarToggleEl' : 'rightSidebarToggleEl';
    if (!workspace[key]) {
      const toggle = workspace[key] = createDiv(`sidebar-toggle-button mod-${side}`);
      toggle.setAttr('role', 'button'); toggle.setAttr('tabindex', '0');
      setIcon(toggle.createDiv('clickable-icon'), 'sidebar-toggle-button-icon');
      toggle.onclick = () => workspace.toggleSidebar(side);
      toggle.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); workspace.toggleSidebar(side); }
      };
    }
    const toggle = workspace[key];
    const target = side === 'left' ? left : right;
    const name = side === 'left' ? '左侧边栏' : '右侧边栏';
    const title = (split.collapsed ? '展开' : '收起') + name;
    toggle.setAttr('aria-label', title); toggle.setAttr('title', title);
    toggle.setAttr('aria-expanded', String(!split.collapsed));
    if (target?._headersOuter) {
      if (side === 'left' && workspace.leftSplit.collapsed) target._headersOuter.insertBefore(toggle, target._headersOuter.firstChild);
      else target._headersOuter.appendChild(toggle);
    }
  }
  if (left?.containerEl) left.containerEl.addClass('mod-top-left-space');
  if (right?.containerEl) right.containerEl.addClass('mod-top-right-space');
  if (!workspace._ribbonSettingsFallback) {
    workspace._ribbonSettingsFallback = createDiv('sidebar-profile-fallback');
    const actions = [
      ['open-vault', '切换仓库', () => Desktop.openStarter()],
      ['lucide-settings', tt('interface.settings', '设置'), () => workspace.app.setting.open()],
    ];
    for (const [icon, label, action] of actions) {
      const button = workspace._ribbonSettingsFallback.createDiv('clickable-icon side-dock-ribbon-action');
      button.setAttr('role', 'button'); button.setAttr('tabindex', '0');
      button.setAttr('aria-label', label); button.setAttr('title', label);
      setIcon(button, icon); button.onclick = action;
      button.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
      };
    }
    workspace.ribbonSettingsEl.appendChild(workspace._ribbonSettingsFallback);
  }
  workspace._ribbonSettingsFallback.toggle(workspace.leftSplit.collapsed);
}
