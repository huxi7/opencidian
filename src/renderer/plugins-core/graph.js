/**
 * [INPUT]: 依赖 GraphView、LocalGraphView、功能区、命令注册与 i18n。
 * [OUTPUT]: 导出 nameKey、create；兼容转导出原图谱数据、选项、查询、力学与引擎接口。
 * [POS]: 核心插件入口。启用时注册功能区、命令与 file-menu 贡献项（打开局部关系图），禁用时一并移除。
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
  /* 原版 onFileMenu：文件菜单的 view.linked 段追加「打开局部关系图」。
     条件与原版一致——必须是 md 文件、菜单带叶子（叶子级菜单），且不是侧栏上下文菜单。 */
  const onFileMenu = (menu, file, source, leaf) => {
    if (!file || file.extension !== 'md' || !leaf) return;
    if (source === 'sidebar-context-menu') return;
    menu.addItem((item) => item.setSection('view.linked')
      .setTitle(t('plugins.graph-view.action-open-local')).setIcon('git-fork')
      .onClick(() => openLocalGraphFor(app, file, leaf)));
  };
  const unload = () => {
    ribbonEl?.detach();
    ribbonEl = null;
    app.viewRegistry.unregisterView('graph');
    app.viewRegistry.unregisterView('localgraph');
    for (const id of ['graph:open', 'graph:open-local', 'graph:animate']) app.commands.removeCommand(id);
    if (fileMenuRef) { fileMenuRef.unregister(); fileMenuRef = null; }
  };
  let fileMenuRef = null;
  return {
    async onload() {
      app.viewRegistry.registerView('graph', (leaf) => new GraphView(leaf));
      app.viewRegistry.registerView('localgraph', (leaf) => new LocalGraphView(leaf));
      if (!ribbonEl) {
        ribbonEl = app.workspace.addRibbonItem('lucide-git-fork', t('plugins.graph-view.action-open'),
          (event) => openGraphView(app, event));
        ribbonEl.setAttr('data-command-id', 'graph:open');
      }
      if (!fileMenuRef) fileMenuRef = app.workspace.on('file-menu', onFileMenu);
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

/* 原版 file-menu 的「打开局部关系图」：在给定叶子右侧竖向分割出局部图谱 */
function openLocalGraphFor(app, file, leaf) {
  const target = app.workspace.createLeafBySplit(leaf, 'vertical');
  target.setViewState({ type: 'localgraph', state: { file: file.path } });
  return target;
}
