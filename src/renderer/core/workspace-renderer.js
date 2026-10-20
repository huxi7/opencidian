/**
 * [INPUT]: 节点模型、workspace-profile 底栏、i18n、图标与桌面 IPC。
 * [OUTPUT]: 导出工作区挂载、DOM 渲染、标签同步、尺寸与 ribbon 函数；视图头构造/填充委托 view-header.js（_fillViewHeader 转发）。
 * [POS]: 侧栏只创建固定工具图标，库信息栏独立于标签树；由 Workspace 委托渲染，首参 workspace 提供树状态与交互入口。
 * 视图 _rootEl 只迁移不重建；节点类型统一由 workspace-model 导入；分割方向 vertical 横排、horizontal 纵排。
 * 标签组叶子挂 .workspace-tab-container（原版 tabsContainerEl）；堆叠头叶排布与滑动由模型落位。
 * 非堆叠态 _syncTabsHeaders 按 children 顺序重排标签头 DOM，保证模型顺序即视觉顺序。
 * view-header 由 view-header.js 落三块（left 导航钮 / title-container 面包屑+标题 mod-fade / actions）；活动叶与活动标签组带 mod-active（焦点规则挂它）。
 * updateSidebarChrome 是折叠态外观的唯一出口：顶栏组 mod-top 归位（原版 updateFrameless）、开关迁移、分隔条宽度/透明度、功能区 is-collapsed 底色。
 * mount 时装载 stacked 键的序列化装饰器（layout JSON 组装在 workspace.js）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf, installStackedSerialization } from './workspace-model.js';
import { tt } from './i18n.js';
import { createVaultProfile } from './workspace-profile.js';
import { Desktop, ipcOn } from './ipc.js';
import { setIcon } from './icons.js';
import { renderViewHeader, fillViewHeader, syncNavButtons } from './view-header.js';
import { animateTabIn, animateTabOut } from './tab-animation.js';

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
      if (ev.target.closest('.clickable-icon, .workspace-tab-header, button, a, input, .titlebar-button')) return;
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
        if (navigator.platform.startsWith('Mac') && typeof getComputedStyle === 'function') {
          const styles = getComputedStyle(document.body);
          const reduce = (value) => { const t = Math.floor(value * zoom / 2 - 8); return t < -5 ? 0 : t; };
          const ox = parseFloat(styles.getPropertyValue('--traffic-lights-offset-x')) || 40;
          let oy = parseFloat(styles.getPropertyValue('--traffic-lights-offset-y')) || 40;
          if (!oy) oy = 40;
          try { Desktop.setTrafficLightPosition(reduce(ox) + 2, reduce(oy)); } catch (e) {}
        }
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
      if (ev.target.closest('.clickable-icon, .workspace-tab-header, .titlebar-button, button, a, input')) return;
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
    for (const h of Array.from(container.children)) {
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
      // 原版 resizeItemsByDiff：单项最小 200
      const min = Math.min(200, Math.floor(total / 2));
      const s0 = Math.max(min, Math.min(total - min, sizes[0] + delta));
      const s1 = total - s0;
      const c0 = split.children[childIndex], c1 = split.children[childIndex + 1];
      if (c0) c0.size = s0;
      if (c1) c1.size = s1;
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
    document.body.removeClass('is-grabbing');
    if (!isSidebar && workspace.app && workspace.app.saveLayout) {
      Promise.resolve(workspace.app.saveLayout()).catch(() => {}); // 中心分栏尺寸落库
    }
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
    document.body.addClass('is-grabbing');
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

/** 原版 DD：{duration:140, fn:--anim-motion-swing}（cubic-bezier(0,0.55,0.45,1)）。 */
const TOGGLE_ANIM = { duration: 140, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' };

const togglePadLeft = (el) => {
  try { const v = parseInt(getComputedStyle(el).paddingLeft, 10); return Number.isFinite(v) ? v : 0; }
  catch (e) { return 0; }
};

/**
 * 原版 y()：toggle 迁移的 FLIP 动画。
 * oldStyle='offset' → 克隆幽灵从 newPad 滑到 -w（并补 left 偏移）；'none' → 直接消失；'' → 不动画。
 * newStyle='offset' → 新位置的按钮从 -(w+oldPad) 滑入；'' → 不动画。
 */
function moveToggle(toggle, target, opts = {}) {
  if (!toggle || !target || toggle.parentElement === target) return;
  const { prepend = false, oldStyle = '', newStyle = '' } = opts;
  const parent = toggle.parentElement;
  const width = toggle.offsetWidth;
  const oldPad = parent ? togglePadLeft(parent) : 0;
  const newPad = togglePadLeft(target);
  const drop = (el) => { try { el.remove(); } catch (e) { /* ignore */ } };
  // 宿主可能没有动画/克隆能力（内存 DOM 回归）：退化为纯迁移
  const canAnimate = typeof toggle.animate === 'function' && typeof toggle.cloneNode === 'function';
  if (parent && oldStyle !== '' && canAnimate) {
    const ghost = toggle.cloneNode(true);
    toggle.replaceWith(ghost);
    if (oldStyle === 'offset') {
      ghost.animate(
        [{ marginLeft: newPad + 'px', left: '0px' }, { marginLeft: -width + 'px', left: -oldPad + 'px' }],
        TOGGLE_ANIM,
      ).finished.then(() => drop(ghost)).catch(() => drop(ghost));
    } else if (oldStyle !== 'none') {
      ghost.style.overflow = 'hidden';
      ghost.animate([{ width: width + 'px' }, { width: '0px' }], TOGGLE_ANIM)
        .finished.then(() => drop(ghost)).catch(() => drop(ghost));
    } else {
      drop(ghost);   // 原版 'none'：幽灵配空动画立即完成并移除
    }
  }
  if (prepend) target.prepend(toggle); else target.appendChild(toggle);
  if (parent && newStyle !== '' && typeof toggle.animate === 'function') {
    if (newStyle === 'offset') {
      toggle.animate(
        [{ marginLeft: -(width + oldPad) + 'px', left: -oldPad + 'px' }, { marginLeft: '0px', left: '0px' }],
        TOGGLE_ANIM,
      );
    } else if (newStyle !== 'none') {
      toggle.style.overflow = 'hidden';
      toggle.animate([{ width: '0px' }, { width: width + 'px' }], TOGGLE_ANIM)
        .finished.then(() => { toggle.style.overflow = ''; }).catch(() => { toggle.style.overflow = ''; });
    }
  }
}

/**
 * 原版 updateFrameless：把 mod-top 归位到每个分支的上排标签组。
 * 顶栏底色变量（--tab-container-background）只挂在这些组上，因此焦点态
 * 整条顶栏（含功能区左上角）与中心标签栏必须由同一个变量驱动。
 * 顺带清掉平台留白类，避免折叠/展开后残留（原版每轮先 remove 再 add）。
 */
function syncTopTabs(workspace) {
  const groups = [];
  const collect = (node) => {
    if (node instanceof WorkspaceTabs) { groups.push(node); return; }
    for (const child of node.children || []) collect(child);
  };
  collect(workspace.rootSplit);
  for (const tabs of groups) {
    if (tabs.containerEl) tabs.containerEl.removeClass('mod-top', 'mod-top-left-space', 'mod-top-right-space');
  }
  const walk = (node) => {
    if (node instanceof WorkspaceTabs) { if (node.containerEl) node.containerEl.addClass('mod-top'); return; }
    if (!node.children || !node.children.length) return;
    // 横排（vertical）的每个孩子在同一个上排；纵排（horizontal）只有首个孩子在顶部
    if (node.direction === 'vertical') for (const child of node.children) walk(child);
    else walk(node.children[0]);
  };
  walk(workspace.rootSplit);
}

/** 左栏收起后开关移至中心标题栏，底部操作保留在功能区。 */
export function updateSidebarChrome(workspace) {
  syncTopTabs(workspace);
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
    const title = split.collapsed ? tt('interface.sidebar-expand', '展开') : tt('interface.sidebar-collapse', '收起');
    toggle.setAttr('aria-label', title); toggle.setAttr('title', title);
    toggle.setAttr('aria-expanded', String(!split.collapsed));
    if (side === 'left') {
      // 原版：macOS hidden 标题栏或 ribbon 隐藏时走 FLIP 迁移；否则开关常驻功能区顶部
      const body = document.body;
      const macHidden = body.hasClass('mod-macos') && body.hasClass('is-hidden-frameless');
      const useFlip = !body.hasClass('show-ribbon') || macHidden;
      if (!useFlip && workspace.ribbonEl) {
        moveToggle(toggle, workspace.ribbonEl, { prepend: true });
      } else if (target?._headersOuter) {
        if (workspace.leftSplit.collapsed) moveToggle(toggle, target._headersOuter, { prepend: true, oldStyle: 'none', newStyle: 'offset' });
        else moveToggle(toggle, target._headersOuter, { oldStyle: 'offset', newStyle: '' });
      }
    } else if (target?._headersOuter) {
      if (workspace.rightSplit.collapsed) moveToggle(toggle, target._headersOuter, { oldStyle: 'none', newStyle: '' });
      else moveToggle(toggle, target._headersOuter, { newStyle: '' });
    }
  }
  // 折叠侧的分隔条淡出（原版 r.style.opacity：0/1；否则 1px 线会横穿标题栏红绿灯区）。
  // 原版折叠时整个 split 连分隔条一起隐藏，不再占位；我们挂在根分割上，宽度一并归零，
  // 否则功能区与编辑区之间会多出 1px 竖缝，并打断顶栏底边那条 1px 横线。
  const dividers = workspace._dividerHandles || {};
  const applyDivider = (el, collapsed) => {
    if (!el) return;
    el.style.opacity = collapsed ? '0' : '1';
    el.style.pointerEvents = collapsed ? 'none' : '';   // 折叠后不可交互
    if (el.hasClass('mod-vertical')) el.style.width = collapsed ? '0px' : '';
  };
  applyDivider(dividers.left, workspace.leftSplit.collapsed);
  applyDivider(dividers.right, workspace.rightSplit.collapsed);
  // 原版 updateFrameless：开关宿主与折叠侧首组都带平台留白类（红绿灯净空）
  for (const [group, key] of [[leftTabs, 'mod-top-left-space'], [rightTabs, 'mod-top-right-space']]) {
    if (group && group.containerEl) group.containerEl.addClass(key);
  }
  if (left?.containerEl) left.containerEl.addClass('mod-top-left-space');
  if (right?.containerEl) right.containerEl.addClass('mod-top-right-space');
  // 原版 Ribbon.setCollapsedState：收起只换功能区底色（--ribbon-background-collapsed），不隐藏
  if (workspace.ribbonEl) workspace.ribbonEl.toggleClass('is-collapsed', workspace.leftSplit.collapsed);
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
