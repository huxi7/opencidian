/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../views/slides-presentation.js 的 SlidesPresentation
 * [OUTPUT]: 导出 nameKey、create(app)。命令 slides:start；包装层暴露 getPresentation() 供验收读取当前宿主。
 * [POS]: plugins-core/ 的幻灯片入口（对齐原版 E9/M9：不注册视图类型，body 级全窗口覆盖层）。仅 md 文件可开始演示。
 *        原版另有 file-menu 菜单项；本项目无 file-menu 来源，省略（与 graph-engine 的处理一致）。卸载先销毁宿主再撤销命令。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: slides — full-window presentation overlay for the active markdown file. */
import { tt } from '../core/i18n.js';
import { SlidesPresentation } from '../views/slides-presentation.js';

export const nameKey = 'plugins.slides';

export function create(app) {
  let presentation = null;
  const start = (file) => {
    if (!file || file.extension !== 'md') return;
    if (presentation) { presentation.destroy(); presentation = null; }
    const leaf = app.workspace.activeLeaf;
    const instance = new SlidesPresentation(app, () => {
      if (presentation === instance) presentation = null;
      // 底层视图未被动过；退出时把焦点还给演示前的叶子
      if (leaf && app.workspace.activeLeaf === leaf && leaf.contentEl && leaf.contentEl.isConnected) {
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const editor = leaf.view && leaf.view.editor;
        if (editor && editor.cm) editor.cm.focus();
      }
    });
    presentation = instance;
    instance.openFile(file).catch((error) => console.error('slides: presentation failed', error));
  };
  const unload = () => {
    if (presentation) { presentation.destroy(); presentation = null; }
    app.commands.removeCommand('slides:start');
  };
  return {
    onload() {
      app.commands.addCommand({
        id: 'slides:start',
        name: tt('plugins.slides.action-start', 'Start presentation'),
        icon: 'lucide-monitor',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file || file.extension !== 'md') return false;
          if (!checking) start(file);
          return true;
        },
      });
    },
    onunload: unload,
    deregister: unload,
    getPresentation: () => presentation,
  };
}
