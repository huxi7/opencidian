/**
 * [INPUT]: Menu、i18n、图标、FileNameModal；宿主提供视图、叶子与文件操作。
 * [OUTPUT]: 导出 addViewAction、installViewMoreAction、fillFilePaneMenu。
 * [POS]: 文件视图共用动作边界。原生按钮保护编辑焦点；更多菜单沿面板、文件、叶子事件生成。
 * 文件菜单保留默认应用入口，视图头只提供视图动作与竖三点。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Menu, MenuEvent } from './menu.js';
import { t } from './i18n.js';
import { setIcon } from './icons.js';
import { FileNameModal } from './modals.js';
import { CanvasView } from '../views/canvas-view.js';
import { View } from './view.js';
import { WorkspaceLeaf } from './workspace-model.js';

/** 原版 View.addAction：button、mousedown 不抢焦点、左键及中键动作。 */
export function addViewAction(actions: HTMLElement, icon: string, label: string, callback: (event: MouseEvent) => unknown, className = '') {
  const button = actions.createEl('button', {
    cls: 'clickable-icon view-action' + (className ? ' ' + className : ''),
    attr: { type: 'button', 'aria-label': label },
  });
  setIcon(button, icon);
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', (event: MouseEvent) => { if (event.button === 0) callback(event); });
  button.addEventListener('auxclick', (event: MouseEvent) => { if (event.button === 1) callback(event); });
  return button;
}

/** 原版 ItemView/FileView.onPaneMenu；标签菜单已提供拆分项，避免重复。 */
export function fillFilePaneMenu(view: View, menu: Menu, source: string) {
  const { app, leaf, file } = view;
  if (!file) return;
  const workspace = app.workspace;
  if (source !== 'tab-header') {
    const split = async (direction: 'horizontal' | 'vertical') => {
      const state = { ...view.getState() };
      const target = workspace.createLeafBySplit(leaf, direction);
      await target.setViewState({ type: view.getViewType(), state });
      workspace.setActiveLeaf(target, { focus: true });
    };
    menu.addItem(item => item.setSection('open').setTitle(t('commands.split-right'))
      .setIcon('lucide-separator-vertical').setDisabled(workspace._sideOf(leaf) !== 'center')
      .onClick(() => split('vertical')));
    menu.addItem(item => item.setSection('open').setTitle(t('commands.split-down'))
      .setIcon('lucide-separator-horizontal').onClick(() => split('horizontal')));
  }
  menu.addItem(item => item.setSection('action').setTitle(t('plugins.file-explorer.menu-opt-rename'))
    .setIcon('lucide-edit-3').onClick(() => {
      new FileNameModal(app, file.basename, name => {
        const parent = file.parent?.path;
        const path = (parent && parent !== '/' ? parent + '/' : '') + name + (file.extension ? '.' + file.extension : '');
        return app.fileManager.renameFile(file, path);
      }).open();
    }));
  menu.addItem(item => item.setSection('danger').setTitle(t('interface.menu.delete-file'))
    .setIcon('lucide-trash-2').setWarning(true).onClick(() => app.fileManager.promptForDeletion(file)));
  workspace.trigger('file-menu', menu, file, source, leaf);
}

/** 原版 View.onMoreOptions：按钮锚点、分节与菜单扩展链。 */
export function installViewMoreAction(view: View, actions: HTMLElement) {
  const existing = actions.querySelector('.mod-more-options');
  if (existing) return existing;
  const button = addViewAction(actions, 'lucide-more-vertical', t('interface.menu.more-options'), (event: MouseEvent) => {
    event.preventDefault();
    if (button.classList.contains('has-active-menu')) return;
    const menu = new Menu(view.app).addSections(['close', 'pane', 'open', 'action', 'find', 'info', 'info.copy', 'view', 'view.linked', 'system', '', 'danger']);
    menu.setSectionSubmenu('info.copy', { title: t('interface.menu.copy-path'), icon: 'lucide-clipboard' });
    menu.setSectionSubmenu('view.linked', { title: t('interface.menu.open-linked-view'), icon: 'lucide-link' });
    view.onPaneMenu(menu, 'more-options');
    view.onMoreOptionsMenu?.(menu);
    view.app.workspace.trigger('leaf-menu', menu, view.leaf);
    const rect = button.getBoundingClientRect();
    menu.setParentElement(button).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  }, 'mod-more-options');
  return button;
}
