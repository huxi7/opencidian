/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../views/slides-view.js 的 SlidesView
 * [OUTPUT]: 导出 nameKey、create(app)（注册 'slides' 视图 + 命令 slides:start）
 * [POS]: plugins-core/ 的幻灯片入口。仅当前 Markdown 可开始演示。切换前保存返回模式、滚动与选区；叶子关闭流程负责保存正文。卸载先退出全部演示再撤销注册。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: slides — present the current markdown file as slides. */
import { tt } from '../core/i18n.js';
import { SlidesView } from '../views/slides-view.js';

export const nameKey = 'plugins.slides';

async function openSlides(app, file) {
  const leaf = app.workspace.activeLeaf;
  if (!leaf || leaf._openingSlides || leaf.view.getViewType() !== 'markdown') return;
  const view = leaf.view;
  const returnState = { ...view.getState() };
  const returnEphemeral = { ...view.getEphemeralState() };
  const selection = view.editor ? {
    anchor: view.editor.getCursor('anchor'), head: view.editor.getCursor('head'),
  } : null;
  leaf._openingSlides = true;
  try {
    await leaf.setViewState({ type: 'slides', state: { file: file.path, returnState, returnEphemeral, selection } });
  } finally { leaf._openingSlides = false; }
}

export function create(app) {
  const unload = async () => {
    for (const leaf of app.workspace.getLeavesOfType('slides')) await leaf.view.exit();
    app.viewRegistry.unregisterView('slides');
    app.commands.removeCommand('slides:start');
  };
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
          if (!checking) openSlides(app, file).catch((error) => console.error('slides: presentation failed', error));
          return true;
        },
      });
    },
    onunload: unload,
    deregister: unload,
  };
}
