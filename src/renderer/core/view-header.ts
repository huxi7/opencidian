/**
 * [INPUT]: 依赖 ./i18n.js 的 t；依赖 ./icons.js 的 setIcon；workspace 提供 app 命令层与文件树叶子；view-pane-menu 提供文件视图通用更多按钮。
 * [OUTPUT]: 导出 renderViewHeader / fillViewHeader / syncNavButtons。
 * [POS]: core/ 的视图头构造与填充层（原版 View 构造器，1.14.4 app.js:1236469）。
 *        三块：left（前后导航钮，命令层历史门控）+ title-container（父路径面包屑 + 标题，mod-fade 三态）+ actions。
 *        空视图同样渲染 ← →；面包屑点击在文件树揭示文件夹，右键复用文件树文件夹菜单。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from './i18n.js';
import { installViewMoreAction } from './view-pane-menu.js';
import { setIcon } from './icons.js';

/**
 * 原版 View 构造器（1.14.4 app.js:1236469）落 view-header 三个子块。
 * 桌面态 left 只有 view-header-nav-buttons（移动端才多一个侧栏开关按钮）；
 * 空视图同样有 ← →（用户截图证），因此这里不做视图类型分支。
 */
export function renderViewHeader(workspace, leaf, header) {
  const headerLeft = header.createDiv('view-header-left');
  const navButtons = headerLeft.createDiv('view-header-nav-buttons');
  const makeNavButton = (icon, label, commandId) => {
    const button = navButtons.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': label, 'aria-disabled': 'true' },
    });
    setIcon(button, icon);
    // 原版按钮 mousedown preventDefault：点击不抢走编辑器焦点
    button.addEventListener('mousedown', (ev) => ev.preventDefault());
    button.addEventListener('click', () => {
      if (button.getAttr('aria-disabled') === 'true') return;
      workspace.app.commands.executeCommandById(commandId);
    });
    return button;
  };
  leaf._viewNavBackEl = makeNavButton('lucide-arrow-left', t('navigate.back') || 'Navigate back', 'app:go-back');
  leaf._viewNavForwardEl = makeNavButton('lucide-arrow-right', t('navigate.forward') || 'Navigate forward', 'app:go-forward');

  // 原版：容器初始带 mod-at-start，滚动监听按 scrollLeft 切换 at-start/at-end
  const titleContainer = header.createDiv('view-header-title-container mod-at-start');
  leaf._viewTitleParentEl = titleContainer.createDiv('view-header-title-parent');
  leaf._viewTitleEl = titleContainer.createDiv('view-header-title');
  installTitleFade(leaf, titleContainer, leaf._viewTitleEl);

  const actions = header.createDiv('view-actions mod-raised');
  leaf._viewActionsEl = actions;
}

/** 原版 app.js:1051550 的 mod-fade 观察器：节流 10ms，按滚动位置切换渐隐蒙版。 */
function installTitleFade(leaf, container, titleEl) {
  container.addClass('mod-fade');
  let timer = null;
  const update = () => {
    timer = null;
    const scrollLeft = titleEl.scrollLeft;
    container.toggleClass('mod-at-start', scrollLeft === 0);
    container.toggleClass('mod-at-end', Math.ceil(scrollLeft) >= titleEl.scrollWidth - titleEl.offsetWidth);
  };
  leaf._updateTitleFade = update;
  titleEl.addEventListener('scroll', () => {
    if (timer) return;
    timer = setTimeout(update, 10);
  }, { passive: true });
  update();
}

/**
 * 原版 FileView.renderBreadcrumbs（1.14.4 app.js:~1550）：
 * 只渲染父文件夹路径；每段一个可点 view-header-breadcrumb，段后补 "/" 分隔符；
 * 无父路径（根目录/非文件视图）时留空，由 CSS :empty 隐藏。
 */
function renderViewBreadcrumbs(workspace, leaf) {
  const parentEl = leaf._viewTitleParentEl;
  if (!parentEl) return;
  parentEl.empty();
  const view = leaf.view;
  const parent = view && view.file && view.file.parent;
  const path = parent && parent.path;
  if (!path || path === '/') return;
  const segments = path.split('/');
  segments.forEach((name, index) => {
    const folderPath = segments.slice(0, index + 1).join('/');
    const crumb = parentEl.createSpan({ cls: 'view-header-breadcrumb', text: name });
    crumb.setAttr('aria-label', name);          // 原版桌面端给面包屑设 aria-label
    crumb.addEventListener('click', () => revealFolderInExplorer(workspace, folderPath));
    // 原版右键弹文件夹 file-menu；本仓库复用文件树的面包菜单
    crumb.addEventListener('contextmenu', (ev) => showFolderContextMenu(workspace, folderPath, ev));
    parentEl.createSpan({ cls: 'view-header-breadcrumb-separator', text: '/' });
  });
}

/** 原版 breadcrumb click：在文件浏览器里揭示并展开该文件夹。 */
function revealFolderInExplorer(workspace, folderPath) {
  const folder = workspace.app.vault.getFolderByPath(folderPath);
  if (!folder) return;
  const explorerLeaf = workspace.getLeavesOfType('file-explorer')[0];
  if (!explorerLeaf) return;
  workspace.revealLeaf(explorerLeaf);
  if (explorerLeaf.view && typeof explorerLeaf.view.revealFile === 'function') {
    explorerLeaf.view.revealFile(folder);
  }
}

/** 原版 breadcrumb contextmenu：文件夹上下文菜单（file-explorer 的 _showFolderMenu）。 */
function showFolderContextMenu(workspace, folderPath, ev) {
  const folder = workspace.app.vault.getFolderByPath(folderPath);
  const explorerLeaf = workspace.getLeavesOfType('file-explorer')[0];
  const view = explorerLeaf && explorerLeaf.view;
  if (!folder || !view || typeof view._showFolderMenu !== 'function') return;
  ev.preventDefault();
  ev.stopPropagation();
  view._showFolderMenu(ev, folder);
}

/** 原版 View.updateNavButtons：禁用态跟随历史可用性。
    本仓库历史在 app 命令层（app:go-back/forward），用 checkCallback(true) 查询可用性。 */
export function syncNavButtons(workspace, leaf) {
  const app = workspace.app;
  const available = (id) => {
    const commands = app && app.commands;
    const cmd = commands && commands.findCommand ? commands.findCommand(id) : null;
    if (!cmd) return false;
    if (cmd.checkCallback) { try { return cmd.checkCallback(true) !== false; } catch (e) { return false; } }
    return true;
  };
  if (leaf._viewNavBackEl) leaf._viewNavBackEl.setAttr('aria-disabled', String(!available('app:go-back')));
  if (leaf._viewNavForwardEl) leaf._viewNavForwardEl.setAttr('aria-disabled', String(!available('app:go-forward')));
}

export function fillViewHeader(workspace, leaf) {
  const view = leaf.view;
  if (!view) return;
  if (leaf._viewTitleEl) {
    leaf._viewTitleEl.empty();
    const title = view.getDisplayText();
    leaf._viewTitleEl.setText(typeof title === 'string' ? title : '');
  }
  renderViewBreadcrumbs(workspace, leaf);
  syncNavButtons(workspace, leaf);
  if (leaf._updateTitleFade) leaf._updateTitleFade();
  const actions = leaf._viewActionsEl;
  if (actions) {
    const activeElement = actions.ownerDocument?.activeElement;
    const focused = activeElement && actions.contains?.(activeElement)
      ? ['.mod-switch-view', '.mod-more-options'].find(selector => activeElement.matches(selector)) : null;
    actions.empty();
    view._fillViewActions && view._fillViewActions(actions);
    if (view.file) installViewMoreAction(view, actions);
    if (focused) actions.querySelector(focused)?.focus({ preventScroll: true });
  }
}
