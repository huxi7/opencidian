/**
 * [INPUT]: 依赖 GraphView、LocalGraphView、功能区、命令注册与 i18n。
 * [OUTPUT]: 导出 nameKey、create；兼容转导出原图谱数据、选项、查询、力学与引擎接口。
 * [POS]: 核心插件入口。启用时注册功能区与命令，禁用时一并移除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from '../core/i18n.js';
import { GraphView, LocalGraphView } from '../views/graph-view.js';

export * from './graph-utils.js';
export * from './graph-options.js';
export * from './graph-data.js';
export * from './graph-query.js';
export * from './graph-simulation.js';
export { GraphEngine } from './graph-engine.js';

export const nameKey = 'plugins.graph-view';

export function create(app) {
  let ribbonEl = null;
  const unload = () => {
    ribbonEl?.detach();
    ribbonEl = null;
    app.viewRegistry.unregisterView('graph');
    app.viewRegistry.unregisterView('localgraph');
    for (const id of ['graph:open', 'graph:open-local', 'graph:animate']) app.commands.removeCommand(id);
  };
  return {
    async onload() {
      app.viewRegistry.registerView('graph', (leaf) => new GraphView(leaf));
      app.viewRegistry.registerView('localgraph', (leaf) => new LocalGraphView(leaf));
      if (!ribbonEl) {
        ribbonEl = app.workspace.addRibbonItem('lucide-git-fork', t('plugins.graph-view.action-open'),
          (event) => openGraphView(app, event));
        ribbonEl.setAttr('data-command-id', 'graph:open');
      }
      app.commands.addCommand({
        id: 'graph:open',
        name: t('plugins.graph-view.action-open') || 'Open graph view',
        icon: 'git-fork',
        callback: (ev) => openGraphView(app, ev),
      });
      app.commands.addCommand({
        id: 'graph:open-local',
        name: t('plugins.graph-view.action-open-local') || 'Open local graph',
        icon: 'git-fork',
        checkCallback: (checking) => openLocalGraph(app, checking),
      });
      app.commands.addCommand({
        id: 'graph:animate',
        name: t('plugins.graph-view.action-timelapse') || 'Start graph timelapse animation',
        icon: 'wand',
        checkCallback: (checking) => {
          const view = app.workspace.getActiveViewOfType('graph');
          if (!view) return false;
          if (!checking) view.dataEngine.renderProgression();
          return true;
        },
      });
    },
    onunload: unload,
    deregister: unload,
  };
}

/* 原版 openGraphView：Mod 键按下时新开标签页（对应 Ng.isModEvent） */
async function openGraphView(app, ev) {
  const mod = !!(ev && (ev.metaKey || ev.ctrlKey));
  const leaf = app.workspace.getLeaf(mod ? 'tab' : false);
  await leaf.setViewState({ type: 'graph', state: {} });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

/* 原版 openLocalGraph：当前文件存在时竖向分割并打开局部图谱 */
function openLocalGraph(app, checking) {
  const file = app.workspace.getActiveFile();
  if (!file) return false;
  if (!checking && app.workspace.activeLeaf) {
    const leaf = app.workspace.createLeafBySplit(app.workspace.activeLeaf, 'vertical');
    leaf.setViewState({ type: 'localgraph', state: { file: file.path } });
  }
  return true;
}
