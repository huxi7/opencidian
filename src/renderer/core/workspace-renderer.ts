/**
 * [INPUT]: 节点模型、workspace-profile 底栏、i18n、图标与桌面 IPC。
 * [OUTPUT]: 导出工作区挂载、DOM 渲染、标签同步、尺寸与 ribbon 函数；视图头构造/填充委托 view-header.js（_fillViewHeader 转发）。
 * [POS]: 侧栏只创建固定工具图标，库信息栏独立于标签树；由 Workspace 委托渲染，首参 workspace 提供树状态与交互入口。
 * 视图 _rootEl 只迁移不重建；节点类型统一由 workspace-model 导入；分割方向 vertical 横排、horizontal 纵排。
 * _refreshLeafContent 只保留当前视图的 .view-content：叶子先渲染时留下的占位内容必须移除，否则两个 view-content 各占一半高度，上半屏成为死区。
 * 标签组叶子挂 .workspace-tab-container（原版 tabsContainerEl）；堆叠头叶排布与滑动由模型落位。
 * 非堆叠态 _syncTabsHeaders 按 children 顺序重排标签头 DOM，保证模型顺序即视觉顺序。
 * view-header 由 view-header.js 落三块（left 导航钮 / title-container 面包屑+标题 mod-fade / actions）；活动叶与活动标签组带 mod-active（焦点规则挂它）。
 * 左右侧栏带 mod-primary-split/mod-secondary-split（原版侧栏标签与库信息栏选择器）；根级纵向分隔条负右外边距覆盖 1px，不占中心区宽。
 * 拖宽委托 workspace-resize；dimension 控制内部比例，根侧栏只保存宽度。
 * DOM 重建先结束拖宽和独立侧栏动画；侧栏外观委托 sidebar-chrome 的 updateSidebarChrome；本文件保留 re-export 兼容入口。折叠只挂 is-collapsed 类，不写 inline display:none。
 * mount 时装载 stacked 键的序列化装饰器（layout JSON 组装在 workspace.js）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf, installStackedSerialization } from './workspace-model.js';
import { tt } from './i18n.js';
import { createVaultProfile } from './workspace-profile.js';
import { Desktop, ipcOn } from './ipc.js';
import { setIcon } from './icons.js';
import { updateSidebarChrome } from './workspace-sidebar-chrome.js';
import { settleSidebarTransitions } from './workspace-sidebar-transition.js';
import { createWorkspaceResizeHandle, cancelWorkspaceResize } from './workspace-resize.js';
import { renderViewHeader, fillViewHeader, syncNavButtons } from './view-header.js';
import { animateTabIn, animateTabOut } from './tab-animation.js';
import { syncTrafficLightPosition } from './window-chrome.js';

export function mount(workspace, container) {
  workspace.containerEl = container;
  installStackedSerialization(workspace);
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
  const buttonContainer = inner.createDiv('titlebar-button-container');
  if (!navigator.platform.startsWith('Mac')) {
    const makeButton = (cls, icon, label, action) => {
      const btn = buttonContainer.createDiv('titlebar-button clickable-icon ' + cls);
      setIcon(btn, icon);
      btn.setAttr('aria-label', label);
      btn.onclick = (ev) => { ev.stopPropagation(); action(); };
      return btn;
    };
    makeButton('mod-minimize', 'lucide-minus', tt('interface.window.minimize', '最小化'), () => Desktop.minimizeWindow());
    const maxBtn = makeButton('mod-maximize', 'lucide-square', tt('interface.window.maximize', '最大化'), () => Desktop.maximizeWindow());
    makeButton('mod-close', 'lucide-x', tt('interface.window.close', '关闭'), () => Desktop.closeWindow());
    const refreshMaxIcon = () => { try { setIcon(maxBtn, Desktop.isWindowMaximized() ? 'lucide-copy' : 'lucide-square'); } catch (e) {} };
    window.addEventListener('resize', refreshMaxIcon);
    refreshMaxIcon();
  } else {
    // 原版 macOS：双击标题栏空白切换缩放（排除可点击元素）
    const dbl = (ev) => {
      if ((ev.target as Element).closest('.clickable-icon, .workspace-tab-header, button, a, input, .titlebar-button')) return;
      Desktop.maximizeWindow();
    };
    titlebar.addEventListener('dblclick', dbl);
  }

  workspace.leftSplit.containerEl = null;
  window.addEventListener('focus', () => container.addClass('is-focused'));
  window.addEventListener('blur', () => container.removeClass('is-focused'));
  if (document.hasFocus()) container.addClass('is-focused');
  // 历史栈在 app 命令层增长（file-open 时入栈）：开完文件后刷新 ← → 的可用性
  workspace.on('file-open', () => workspace._syncAllTabs());
  installWindowState();
}

/** 原版 updateStatus：同步 is-maximized / is-fullscreen / --zoom-factor，并补偿 macOS 红绿灯位置。 */
function installWindowState() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // 回归测试的 VM 宿主没有定时器/DOM 事件系统：直接跳过窗口状态同步
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return;
  let timer = null;
  const sync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        let state = { maximized: false, fullscreen: false };
        try { state = Desktop.windowState() || state; } catch (e) {}
        document.body.toggleClass('is-maximized', !!state.maximized);
        document.body.toggleClass('is-fullscreen', !!state.fullscreen);
        let zoom = 1;
        try { zoom = require('electron').webFrame.getZoomFactor() || 1; } catch (e) {}
        document.body.style.setProperty('--zoom-factor', String(zoom));
        syncTrafficLightPosition();
      } catch (e) { /* 无 DOM/无 Electron 的宿主（回归测试）忽略 */ }
    }, 50);
  };
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', sync);
    window.addEventListener('focus', sync);
  }
  if (typeof document.addEventListener === 'function') document.addEventListener('fullscreenchange', sync);
  if (typeof ipcOn === 'function') ipcOn('window-state-changed', sync);
  sync();
}

export function render(workspace) {
  cancelWorkspaceResize(workspace);
  settleSidebarTransitions(workspace);
  const rootEl = workspace._getRootEl();
  rootEl.empty();
  workspace._dividerHandles = {};   // 重建 DOM：旧引用作废
  for (let i = 0; i < workspace.rootSplit.children.length; i++) {
    const child = workspace.rootSplit.children[i];
    const el = workspace._renderNode(child);
    rootEl.appendChild(el);
    if (i < workspace.rootSplit.children.length - 1) {
      const handle = workspace._createResizeHandle(workspace.rootSplit, i, 'vertical');
      // 侧栏边界的分隔条：左邻是左栏 → 'left'；右邻是右栏 → 'right'；
      // 折叠时淡出并禁用指针（原版折叠整个 split 时分隔条随之消失；我们是 flex 兄弟节点，必须显式处理）
      const nextChild = workspace.rootSplit.children[i + 1];
      const dividerSide = child.side === 'left' ? 'left' : (nextChild && nextChild.side === 'right' ? 'right' : null);
      if (dividerSide) {
        handle.setAttr('data-divider-side', dividerSide);
        workspace._dividerHandles[dividerSide] = handle;
      }
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

function applyDimension(el, node) {
  if (Number.isFinite(node.dimension) && node.dimension > 0) el.style.flex = `${node.dimension} 1 0%`;
}

export function _renderNode(workspace, node) {
  if (node instanceof WorkspaceSplit) {
    const el = createDiv('workspace-split');
    el.addClass('mod-' + node.direction);
    if (node.side === 'left') el.addClass('mod-left-split', 'mod-sidedock', 'mod-primary-split');
    if (node.side === 'right') el.addClass('mod-right-split', 'mod-sidedock', 'mod-secondary-split');
    if (node.side === 'center') el.addClass('mod-root');
    node.containerEl = el;
    if (!['left', 'right'].includes(node.side)) applyDimension(el, node);
    el._split = node;
    if (node.side && node.collapsed) {
      el.addClass('is-collapsed');   // 只挂类；inline display:none 会让 showSidebar 无法重新展开
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
    const el = workspace._renderLeaf(node); applyDimension(el, node); return el;
  }
  return createDiv();
}

export function _renderTabs(workspace, tabs) {
  const el = createDiv('workspace-tabs');
  applyDimension(el, tabs);
  el._tabs = tabs;
  tabs.containerEl = el;
  el.toggleClass('mod-stacked', !!tabs.isStacked);   // 原版：堆叠状态落在容器类上
  const side = workspace._sideOf(tabs);
  const isRoot = side === 'center';
  if (isRoot) el.addClass('mod-root');
  // mod-top / mod-top-left-space / mod-top-right-space 由 updateSidebarChrome 的
  // syncTopTabs 统一落位（原版 updateFrameless 语义：只有分支上排的标签组带 mod-top）。

  const headersOuter = el.createDiv('workspace-tab-header-container');
  tabs._headersOuter = headersOuter;
  const headersInner = headersOuter.createDiv('workspace-tab-header-container-inner');
  tabs._headersInner = headersInner;
  // 原版 BD：滚轮横向滚动标签栏
  headersInner.addEventListener('wheel', (ev) => {
    if (headersInner.scrollWidth <= headersInner.clientWidth) return;
    ev.preventDefault();
    headersInner.scrollLeft += (ev.deltaY || 0) + (ev.deltaX || 0);
  }, { passive: false });
  if (navigator.platform.startsWith('Mac')) {
    headersOuter.addEventListener('dblclick', (ev) => {
      if ((ev.target as Element).closest('.clickable-icon, .workspace-tab-header, .titlebar-button, button, a, input')) return;
      Desktop.maximizeWindow();
    });
  }

  // 原版 VD.tabsContainerEl：叶子宿主；堆叠态下标签头也排进来，随容器横向滚动
  const tabContainer = el.createDiv('workspace-tab-container');
  tabs._tabContainerEl = tabContainer;
  tabContainer.addEventListener('scroll', () => tabs.onContainerScroll(), { passive: true });
  if (typeof ResizeObserver === 'function') {
    if (tabs._slidingObserver) tabs._slidingObserver.disconnect();
    tabs._slidingObserver = new ResizeObserver(() => tabs.updateSlidingTabs());
    tabs._slidingObserver.observe(tabContainer);
  }

  if (isRoot) {
    // 原版 app.js:1555654：外层 div + 内层 span.clickable-icon（图标/aria/hover 盒都在内层）
    const newTabBtn = headersOuter.createDiv('workspace-tab-header-new-tab');
    const newTabIcon = newTabBtn.createSpan('clickable-icon');
    newTabIcon.setAttr('aria-label', tt('menu-items.new-tab', '新标签页'));
    setIcon(newTabIcon, 'lucide-plus');
    newTabIcon.onclick = () => workspace._onNewTab(tabs);
    // 兼容旧命中：点击外层 padding 区域也等同点按钮（原版外层无可点区域）
    newTabBtn.onclick = (ev) => { if (ev.target === newTabBtn) workspace._onNewTab(tabs); };
  }
  headersOuter.createDiv('workspace-tab-header-spacer');
  if (isRoot) {
    // 原版：标签列表按钮在 spacer 之后（最右），外层 div + 内层 span.clickable-icon
    const tabListBtn = headersOuter.createDiv('workspace-tab-header-tab-list');
    const tabListIcon = tabListBtn.createSpan('clickable-icon');
    setIcon(tabListIcon, 'lucide-chevron-down');
    // 原版 VD：标签列表菜单由标签组自己弹出（含堆叠/取消堆叠项）；菜单以按钮内层为锚点
    const showMenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (tabListIcon.hasClass('has-active-menu')) return;
      tabs.showTabListMenu(ev, tabListIcon);
    };
    tabListIcon.onclick = showMenu;
    tabListIcon.oncontextmenu = showMenu;
    // 兼容旧命中：外层容器被直接点击/右键时转给内层
    tabListBtn.onclick = (ev) => { if (ev.target === tabListBtn) showMenu(ev); };
    tabListBtn.oncontextmenu = (ev) => { if (ev.target === tabListBtn) showMenu(ev); };
  }

  for (const leaf of tabs.children) {
    const header = workspace._createTabHeader(leaf);
    headersInner.appendChild(header);
    tabContainer.appendChild(workspace._renderLeaf(leaf));
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

  // 原版 View 构造器：view-header = left（导航钮）+ title-container（面包屑+标题）+ actions
  const header = content.createDiv('view-header');
  renderViewHeader(workspace, leaf, header);
  leaf._viewHeaderEl = header;
  if (leaf.view) {
    leaf.view._viewHeaderEl = header;
    leaf.view._viewActionsEl = leaf._viewActionsEl;
    leaf.view._viewTitleEl = leaf._viewTitleEl;
    workspace._fillViewHeader(leaf);
  }
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
  return fillViewHeader(workspace, leaf);
}

export function _refreshLeafContent(workspace, leaf) {
  if (!leaf.contentEl) return;
  const type = leaf.view ? leaf.view.getViewType() : 'empty';
  leaf.contentEl.setAttr('data-type', type);
  const rootEl = leaf.view && leaf.view._rootEl;
  // 叶子可能先由 _renderLeaf 建过占位 .view-content（视图尚未挂载），
  // 也可能刚切换过视图。只允许当前视图内容留在叶子里，否则两个 view-content
  // 会把叶子各占一半——上半屏成为点不动的死区。
  for (const child of [...leaf.contentEl.children]) {
    if (child !== rootEl && child.classList && child.classList.contains('view-content')) child.remove();
  }
  if (rootEl && rootEl.parentElement !== leaf.contentEl) {
    leaf.contentEl.appendChild(rootEl);
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
  const host = parentTabs._tabContainerEl || parentTabs.containerEl;
  host.appendChild(el);
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
  const header = createDiv('workspace-tab-header tappable');
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
  leaf._dragHost = null;   // 拖拽绑定在标签头落位后进行（updateTabDisplay）：宿主随堆叠态变化
  header.setAttr('draggable', String(isDocument));
  header.setAttr('role', 'tab');
  header.setAttr('tabindex', '0');
  const activate = () => {
    const tabs = leaf.parent;
    if (tabs) tabs.currentTab = tabs.children.indexOf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  };
  header.onclick = (ev) => {
    if ((ev.target as Element).closest('.workspace-tab-header-inner-close-button')) return;
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
  return header;
}

export function _syncTabsHeaders(workspace, tabs) {
  const inner = tabs._headersInner;
  if (!inner) return;
  const known = tabs._animatedLeaves;
  const current = new Set(tabs.children);
  const animate = !!known && !tabs.isStacked;
  // remove headers of removed leaves（堆叠态的头在 tab-container 里，两处都要清）
  const containers = [inner, tabs._tabContainerEl].filter(Boolean);
  for (const container of containers) {
    for (const h of Array.from<HTMLElement>(container.children)) {
      if (!h._leaf || tabs.children.includes(h._leaf)) continue;
      // 原版 updateTabDisplay：关闭/移出的标签在旧位置留一个克隆收窄 200ms
      if (animate && known.has(h._leaf)) animateTabOut(h, container);
      h.detach();
    }
  }
  tabs.syncHeaderOrder();
  // 新增/移入的标签从 0 宽展开；首次渲染不播动画
  if (animate) {
    for (const leaf of tabs.children) {
      if (!known.has(leaf) && leaf._tabHeaderEl) animateTabIn(leaf._tabHeaderEl);
    }
  }
  tabs._animatedLeaves = current;
}

export function _syncTabsVisibility(workspace, tabs) {
  for (const leaf of tabs.children) {
    const isActive = tabs.activeLeaf === leaf;
    // 原版：堆叠态下所有 pane 都显示（横向滑动可见），非堆叠态只显示活动 pane
    if (leaf._leafEl) leaf._leafEl.toggle(!!tabs.isStacked || isActive);
    // 原版 setActiveLeaf：活动叶子的 .workspace-leaf 带 mod-active（焦点底色规则挂它）
    if (leaf._leafEl) leaf._leafEl.toggleClass('mod-active', workspace.activeLeaf === leaf);
    if (leaf._tabHeaderEl) {
      leaf._tabHeaderEl.toggleClass('is-active', isActive);
      leaf._tabHeaderEl.setAttr('aria-selected', String(isActive));
      leaf._tabHeaderEl.toggleClass('is-pinned', !!leaf.pinned);
      syncPinnedStatus(workspace, leaf, leaf._tabHeaderEl);
    }
    syncNavButtons(workspace, leaf);
  }
  // 原版 setActiveLeaf：活动标签组带 mod-active（焦点态标签文字色规则挂它）
  if (tabs.containerEl) {
    tabs.containerEl.toggleClass('mod-active', !!workspace.activeLeaf && workspace.activeLeaf.parent === tabs);
  }
  tabs.updateTabDisplay();
}

/** 原版：pinned 标签显示 workspace-tab-header-status-icon.mod-pinned（lucide-pin，点击取消固定）且隐藏关闭钮。 */
function syncPinnedStatus(workspace, leaf, header) {
  const inner = header.querySelector('.workspace-tab-header-inner');
  if (!inner) return;
  let container = header.querySelector('.workspace-tab-header-status-container');
  const closeEl = inner.querySelector('.workspace-tab-header-inner-close-button');
  if (leaf.pinned) {
    if (!container) {
      container = createDiv('workspace-tab-header-status-container');
      const pin = container.createDiv('workspace-tab-header-status-icon mod-pinned clickable-icon');
      setIcon(pin, 'pin');
      pin.setAttr('aria-label', tt('interface.menu.unpin', '取消锁定'));
      pin.onclick = (ev) => {
        ev.stopPropagation();
        leaf.pinned = false;
        workspace._syncAllTabs();
      };
      inner.appendChild(container);
    }
    container.toggle(true);
    if (closeEl) closeEl.toggle(false);
  } else {
    if (container) container.detach();
    if (closeEl) closeEl.toggle(true);
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
  return createWorkspaceResizeHandle(workspace, split, childIndex, direction);
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
  workspace.ribbonItems = [];
  // 原版 Uv：功能区按钮过多时，指针位置驱动滚动
  actions.addEventListener('mousemove', (ev) => {
    const h = actions.clientHeight;
    const sh = actions.scrollHeight;
    if (sh <= h) return;
    const ratio = (ev.clientY - actions.getBoundingClientRect().y - 30) / (h - 60);
    actions.scrollTop = (sh - h) * Math.min(1, Math.max(0, ratio));
  });
  return ribbon;
}

// 功能区配置（原版 Zee）：隐藏项与顺序持久化在 localStorage
const RIBBON_HIDDEN_KEY = 'opensidian-ribbon-hidden';
const RIBBON_ORDER_KEY = 'opensidian-ribbon-order';
function ribbonState(workspace) {
  if (!workspace._ribbonState) {
    let hidden = [], order = [];
    try { hidden = JSON.parse(localStorage.getItem(RIBBON_HIDDEN_KEY) || '[]'); } catch (e) {}
    try { order = JSON.parse(localStorage.getItem(RIBBON_ORDER_KEY) || '[]'); } catch (e) {}
    workspace._ribbonState = {
      hidden: new Set(Array.isArray(hidden) ? hidden : []),
      order: Array.isArray(order) ? order : [],
    };
  }
  return workspace._ribbonState;
}
function applyRibbonOrder(workspace) {
  if (!workspace.ribbonActionsEl) return;
  const state = ribbonState(workspace);
  const items = (workspace.ribbonItems || []).filter((i) => i.target === 'actions' && i.el.isConnected);
  const ordered = [];
  for (const key of state.order) {
    const item = items.find((i) => i.key === key);
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  for (const item of items) if (!ordered.includes(item)) ordered.push(item);
  for (const item of ordered) workspace.ribbonActionsEl.appendChild(item.el);
}
export function getRibbonItems(workspace) {
  return (workspace.ribbonItems || []).filter((i) => i.target === 'actions' && i.el.isConnected);
}
export function isRibbonItemHidden(workspace, key) { return ribbonState(workspace).hidden.has(key); }
export function setRibbonItemHidden(workspace, key, hidden) {
  const state = ribbonState(workspace);
  if (hidden) state.hidden.add(key); else state.hidden.delete(key);
  try { localStorage.setItem(RIBBON_HIDDEN_KEY, JSON.stringify([...state.hidden])); } catch (e) {}
  const item = (workspace.ribbonItems || []).find((i) => i.key === key);
  if (item) item.el.toggle(!hidden);
}
export function setRibbonOrder(workspace, keys) {
  const state = ribbonState(workspace);
  state.order = Array.isArray(keys) ? keys.slice() : [];
  try { localStorage.setItem(RIBBON_ORDER_KEY, JSON.stringify(state.order)); } catch (e) {}
  applyRibbonOrder(workspace);
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
  // 登记到功能区配置：key 用 icon|title（title 为本地化文案，语言切换后隐藏状态可能重置）
  const key = icon + '|' + title;
  const entry = { key, icon, title, target: target === 'bottom' ? 'bottom' : 'actions', el };
  workspace.ribbonItems = workspace.ribbonItems || [];
  workspace.ribbonItems.push(entry);
  if (ribbonState(workspace).hidden.has(key)) el.toggle(false);
  if (entry.target === 'actions') applyRibbonOrder(workspace);
  return el;
}

export function refreshHeaderVisibility(workspace) {
  const show = workspace.app.settings.config.showViewHeader !== false;
  workspace.containerEl.findAll('.view-header').forEach((el) => el.toggleClass('is-hidden', !show));
}

export { updateSidebarChrome };
