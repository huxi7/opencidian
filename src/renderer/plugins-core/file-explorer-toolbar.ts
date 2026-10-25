/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu。
 * [OUTPUT]: 导出 createExplorerToolbar(view)、syncExplorerToolbar(view)、SORT_ORDER_IDS。
 * [POS]: plugins-core/ 文件浏览器的头部按钮行。按原版 QL.addNavButton（app.js:1506625）建
 *        .nav-header > .nav-buttons-container 与五个 div.clickable-icon.nav-action-button；
 *        排序菜单按原版 addSortButton（app.js:1473296）三组各两项、组后分隔线并挂按钮（has-active-menu 守卫）；
 *        按钮视觉只由 syncExplorerToolbar 依据 view._autoReveal / view._allCollapsed 渲染，本模块不持有状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';

const SORT_GROUPS = [
  ['alphabetical', 'alphabeticalReverse'],
  ['byModifiedTime', 'byModifiedTimeReverse'],
  ['byCreatedTime', 'byCreatedTimeReverse'],
];
const SORT_LABELS = {
  alphabetical: () => t('plugins.file-explorer.label-sort-a-to-z') || 'File name (A to Z)',
  alphabeticalReverse: () => t('plugins.file-explorer.label-sort-z-to-a') || 'File name (Z to A)',
  byModifiedTime: () => t('plugins.file-explorer.label-sort-new-to-old') || 'Modified time (new to old)',
  byModifiedTimeReverse: () => t('plugins.file-explorer.label-sort-old-to-new') || 'Modified time (old to new)',
  byCreatedTime: () => t('plugins.file-explorer.label-sort-created-new-to-old') || 'Created time (new to old)',
  byCreatedTimeReverse: () => t('plugins.file-explorer.label-sort-created-old-to-new') || 'Created time (old to new)',
};
export const SORT_ORDER_IDS = new Set(Object.keys(SORT_LABELS));

/** 建头部按钮行；返回按钮引用供 view 持有。顺序与图标同原版：新建笔记/新建文件夹/排序/自动显示/全部折叠-展开。 */
export function createExplorerToolbar(view) {
  const headerEl = view.contentEl.createDiv('nav-header');
  const buttons = headerEl.createDiv('nav-buttons-container');
  const app = view.app;
  const addBtn = (icon, label, cb) => {
    const btn = buttons.createDiv('clickable-icon nav-action-button');
    btn.setAttr('aria-label', label);
    setIcon(btn, icon);
    btn.onclick = cb;
    return btn;
  };
  addBtn('lucide-edit', t('plugins.file-explorer.action-new-note') || 'New note', () => app.commands.executeCommandById('file-explorer:new-file'));
  addBtn('lucide-folder-plus', t('plugins.file-explorer.action-new-folder') || 'New folder', () => app.commands.executeCommandById('file-explorer:new-folder'));
  const sortBtn = addBtn('lucide-sort-asc', t('plugins.file-explorer.action-change-sort') || 'Change sort order', (ev) => showSortMenu(view, ev));
  const autoRevealBtn = addBtn('lucide-gallery-vertical', t('plugins.file-explorer.action-auto-reveal') || 'Auto-reveal current file', () => view._toggleAutoReveal());
  const collapseAllBtn = addBtn('lucide-chevrons-down-up', t('plugins.file-explorer.action-collapse-all') || 'Collapse all', () => view._toggleCollapseAll());
  return { headerEl, buttons, sortBtn, autoRevealBtn, collapseAllBtn };
}

/** 原版 setAutoReveal / setIsAllCollapsed：按钮的 is-active、图标与文案跟随视图状态。 */
export function syncExplorerToolbar(view) {
  if (view._autoRevealBtn) view._autoRevealBtn.toggleClass('is-active', !!view._autoReveal);
  const btn = view._collapseAllBtn;
  if (!btn) return;
  setIcon(btn, view._allCollapsed ? 'lucide-chevrons-up-down' : 'lucide-chevrons-down-up');
  btn.setAttr('aria-label', view._allCollapsed
    ? (t('plugins.file-explorer.action-expand-all') || 'Expand all')
    : (t('plugins.file-explorer.action-collapse-all') || 'Collapse all'));
}

function showSortMenu(view, ev) {
  const anchor = (ev && ev.currentTarget) || view._sortBtn;
  if (anchor && anchor.hasClass && anchor.hasClass('has-active-menu')) return;
  const menu = new Menu(view.app);
  for (const group of SORT_GROUPS) {
    for (const order of group) {
      menu.addItem((item) => item
        .setTitle(SORT_LABELS[order]())
        .setChecked(view._sortOrder === order)
        .onClick(() => view.setSortOrder(order)));
    }
    menu.addSeparator();
  }
  if (anchor) menu.setParentElement(anchor);
  menu.showAtMouseEvent(ev);
}
