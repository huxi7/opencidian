/**
 * [INPUT]: 数据库视图与 YAML 空模板；宿主提供命令、文件创建及视图注册。
 * [OUTPUT]: 导出核心插件入口；注册 bases 视图与 bases:new-file 命令。
 * [POS]: Bases 插件生命周期。扩展名 base 交给同一个视图与嵌入渲染器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BasesView, setBasesEnabled } from './bases-view.js';
import { EMPTY_BASE } from './bases-model.js';
import { t } from '../core/i18n.js';
export const nameKey = 'plugins.bases';
export function create(app) {
  return {
    app,
    onload() {
      setBasesEnabled(app, true);
      app.viewRegistry.registerView('bases', leaf => new BasesView(leaf));
      app.viewRegistry.getViewCreator('bases').extensions = ['base'];
      app.commands.addCommand({ id: 'bases:new-file', name: t('plugins.bases.command-create-new') || 'Create new base', icon: 'lucide-layout-list', callback: () => this.createNewBase() });
    },
    onunload() { setBasesEnabled(app, false); app.commands.removeCommand('bases:new-file'); app.viewRegistry.unregisterView('bases'); },
    async createNewBase() {
      const current = app.workspace.getActiveFile();
      const folder = app.fileManager.getNewFileParent(current?.path || '');
      const file = await app.fileManager.createNewFile(folder, 'Untitled.base', EMPTY_BASE);
      if (file) await app.workspace.openFile(file);
      return file;
    },
  };
}
