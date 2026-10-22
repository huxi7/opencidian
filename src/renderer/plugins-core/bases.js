/**
 * [INPUT]: 数据库视图、YAML 模板、功能区、文件菜单与文件创建接口。
 * [OUTPUT]: 注册 bases 视图、功能区和文件夹新建入口、新建与 CSV 命令。
 * [POS]: Bases 插件生命周期。可见入口共用创建流程，停用时对称撤销。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BasesView, setBasesEnabled } from './bases-view.js';
import { EMPTY_BASE } from './bases-model.js';
import { t } from '../core/i18n.js';
import { exportBaseCsv } from './bases-csv.js';
import { TFolder } from '../core/vault.js';
import { IS_MAC } from '../core/keymap.js';
const newTab = event => !!(IS_MAC ? event?.metaKey : event?.ctrlKey);
export const nameKey = 'plugins.bases';
export function create(app) {
  return {
    app,
    onload() {
      if (this.ribbonEl) return;
      setBasesEnabled(app, true);
      app.viewRegistry.registerView('bases', leaf => new BasesView(leaf));
      app.viewRegistry.getViewCreator('bases').extensions = ['base'];
      const title = t('plugins.bases.command-create-new') || 'Create new base';
      app.commands.addCommand({ id: 'bases:new-file', name: title, icon: 'lucide-layout-list', callback: event => this.createNewBase(null, newTab(event)) });
      this.ribbonEl = app.workspace.addRibbonItem('lucide-layout-list', title, event => this.createNewBase(null, newTab(event)));
      this.ribbonEl.setAttr('data-command-id', 'bases:new-file');
      this.menuRef = app.workspace.on('file-menu', (menu, file, source) => {
        if (source !== 'file-explorer-context-menu' || !(file instanceof TFolder)) return;
        menu.addItem(item => item.setSection('action-primary').setIcon('lucide-layout-list')
          .setTitle(t('plugins.bases.action-new-base') || 'New base')
          .onClick(event => this.createNewBase(file, newTab(event))));
      });
      app.commands.addCommand({ id: 'bases:export-csv', name: t('plugins.bases.action-export-c-s-v'), icon: 'lucide-file-down', checkCallback: checking => {
        const view = app.workspace.activeLeaf?.view, controller = view?.getViewType?.() === 'bases' && view.controller;
        if (!controller || !controller.enabled || controller.closed || !['table', 'list', 'cards', 'kanban'].includes(controller.view?.type)) return false;
        if (!checking) exportBaseCsv(controller);
        return true;
      } });
    },
    onunload() {
      this.ribbonEl?.detach(); this.ribbonEl = null;
      this.menuRef?.unregister(); this.menuRef = null;
      setBasesEnabled(app, false); app.commands.removeCommand('bases:new-file'); app.commands.removeCommand('bases:export-csv'); app.viewRegistry.unregisterView('bases');
    },
    async createNewBase(targetFolder = null, openInNewTab = false) {
      const current = app.workspace.getActiveFile();
      const folder = targetFolder || app.fileManager.getNewFileParent(current?.path || '');
      const file = await app.fileManager.createNewFile(folder, 'Untitled.base', EMPTY_BASE);
      if (file) {
        const leaf = await app.workspace.openFile(file, { newLeaf: openInNewTab ? 'tab' : false });
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      }
      return file;
    },
  };
}
