/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../views/slides-view.js 的 SlidesView
 * [OUTPUT]: 导出 nameKey、create(app)（注册 'slides' 视图 + 命令 slides:start）
 * [POS]: plugins-core/ 的幻灯片插件。原版用 reveal.js 全屏覆盖层；本实现注册工作区视图 'slides'，命令把当前 md 以该视图打开。checkCallback 语义与原版一致：活动文件不是 md 时命令不可用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: slides — present the current markdown file as slides. */
import { tt } from '../core/i18n.js';
import { SlidesView } from '../views/slides-view.js';

export const nameKey = 'plugins.slides';

function openSlides(app, file) {
  app.workspace.getLeaf(false).setViewState({ type: 'slides', state: { file: file.path } });
}

export function create(app) {
  return {
    onload() {
      app.viewRegistry.registerView('slides', (leaf) => new SlidesView(leaf));
      app.commands.addCommand({
        id: 'slides:start',
        name: tt('plugins.slides.action-start', 'Start presentation'),
        icon: 'lucide-monitor',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file || file.extension !== 'md') return false;
          if (!checking) openSlides(app, file);
          return true;
        },
      });
    },
    onunload() {
      app.viewRegistry.unregisterView('slides');
      app.commands.removeCommand('slides:start');
    },
    deregister(app2) {
      app2.viewRegistry.unregisterView('slides');
      app2.commands.removeCommand('slides:start');
    },
  };
}
