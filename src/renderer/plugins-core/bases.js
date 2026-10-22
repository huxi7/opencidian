/**
 * [INPUT]: 数据库视图与 YAML 空模板；宿主提供命令、文件创建及视图注册。
 * [OUTPUT]: 导出核心插件入口；注册 bases 视图、新建命令与 CSV 导出命令。
 * [POS]: Bases 插件生命周期。扩展名 base 交给同一个视图与嵌入渲染器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BasesView, setBasesEnabled } from './bases-view.js';
import { EMPTY_BASE } from './bases-model.js';
import { t } from '../core/i18n.js';
import { exportBaseCsv } from './bases-csv.js';
export const nameKey = 'plugins.bases';
export function create(app) {
  return {
    app,
    onload() {
      setBasesEnabled(app, true);
      app.viewRegistry.registerView('bases', leaf => new BasesView(leaf));
      app.viewRegistry.getViewCreator('bases').extensions = ['base'];
      app.commands.addCommand({ id: 'bases:new-file', name: t('plugins.bases.command-create-new') || 'Create new base', icon: 'lucide-layout-list', callback: () => this.createNewBase() });
      app.commands.addCommand({ id: 'bases:export-csv', name: t('plugins.bases.action-export-c-s-v'), icon: 'lucide-file-down', checkCallback: checking => {
        const view = app.workspace.activeLeaf?.view, controller = view?.getViewType?.() === 'bases' && view.controller;
        if (!controller || !controller.enabled || controller.closed || controller.view?.type !== 'table') return false;
        if (!checking) exportBaseCsv(controller);
        return true;
      } });
    },
    onunload() { setBasesEnabled(app, false); app.commands.removeCommand('bases:new-file'); app.commands.removeCommand('bases:export-csv'); app.viewRegistry.unregisterView('bases'); },
    async createNewBase() {
      const current = app.workspace.getActiveFile();
      const folder = app.fileManager.getNewFileParent(current?.path || '');
      const file = await app.fileManager.createNewFile(folder, 'Untitled.base', EMPTY_BASE);
      if (file) await app.workspace.openFile(file);
      return file;
    },
  };
}
