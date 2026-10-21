/**
 * [INPUT]: 依赖 View、GraphEngine、GraphRenderer、图谱选项读写与剪贴板接口。
 * [OUTPUT]: 导出 GraphView 与 LocalGraphView；保留 graph/localgraph 视图类型。
 * [POS]: 图谱视图壳；全局选项写 graph.json，局部文件与选项随布局保存。
 *        面板菜单（原版 onPaneMenu）只追加「复制截图」一项，放在 action 段；
 *        原版没有局部图/导出/聚焦等图谱专属菜单项，其余来自通用叶子菜单。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { debounce } from '../core/events.js';
import { GraphEngine } from '../plugins-core/graph-engine.js';
import { readGraphOptions, writeGraphOptions } from '../plugins-core/graph-options.js';
import { GraphRenderer } from './graph-renderer.js';

/* 原版 TQ.copyToClipboard：把画布导出为 PNG 写入剪贴板 */
async function copyCanvasToClipboard(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to export the graph canvas');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (e) {
    // 窗口未聚焦等场景 clipboard 会拒绝；导出失败不产生未处理 rejection
    console.warn('clipboard write failed', e && e.message);
  }
}

// 视图：全局图谱（原版 bJ）与局部图谱（原版 kJ）
/* 本项目 View 没有 registerEvent/registerInterval，这里补齐并统一销毁 */
class GraphViewBase extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'git-fork';
    this.renderer = null;
    this._cleaned = false;
  }
  onResize() { if (this.renderer) this.renderer.onResize(); }
  registerEvent(ref) { if (ref && ref.unregister) this._children.push(() => ref.unregister()); }
  registerDomEvent(el, type, callback) {
    el.addEventListener(type, callback);
    this._children.push(() => el.removeEventListener(type, callback));
  }
  registerInterval(id) { this._children.push(() => clearInterval(id)); }
  /* 原版 onPaneMenu：通用叶子菜单之外只加一条「复制截图」（action 段，图标 lucide-image） */
  onPaneMenu(menu) {
    menu.addItem((item) => item.setSection('action')
      .setTitle(t('plugins.graph-view.action-copy-screenshot')).setIcon('image')
      .onClick(async () => {
        try {
          await copyCanvasToClipboard(this.renderer.getTransparentScreenshot());
          new Notice(t('plugins.graph-view.msg-screenshot-copied'));
        } catch (error) {
          new Notice(String(error));
        }
      }));
  }
  cleanup() {
    if (this._cleaned) return;
    this._cleaned = true;
    for (const dispose of this._children) {
      try { dispose(); } catch (error) { console.error(error); }
    }
    this._children.length = 0;
  }
  async onClose() {
    this.cleanup();
    (this.dataEngine || this.engine)?.destroy();
    if (this.renderer) this.renderer.destroy();
  }
}

export class GraphView extends GraphViewBase {
  constructor(leaf) {
    super(leaf);
    this.navigation = true;
    this.dataEngine = null;
  }
  getViewType() { return 'graph'; }
  getDisplayText() { return t('plugins.graph-view.name'); }
  async onOpen() {
    this.contentEl.addClass('graph-view-container');
    this.renderer = new GraphRenderer(this.contentEl);
    this.dataEngine = new GraphEngine(this.app, this, this.renderer, false);
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.update()));
    this.dataEngine.load();
    this.dataEngine.setOptions(readGraphOptions(this.app));
    this.dataEngine.requestUpdateSearch();
    this.update();
  }
  update() { if (this.dataEngine) this.dataEngine.render(); }
  /* 原版 showSearch：展开控制面板与筛选区并选中搜索框 */
  showSearch() {
    this.dataEngine.controlsEl.removeClass('is-close');
    this.dataEngine.filterOptions.setCollapsed(false);
    this.dataEngine.filterOptions.search.autoSelect();
  }
  onOptionsChange() {
    if (this._loaded && this.dataEngine) writeGraphOptions(this.app, this.dataEngine.getOptions());
  }
}

export class LocalGraphView extends GraphViewBase {
  constructor(leaf) {
    super(leaf);
    this.file = null;
    this.renderedFile = null;
    this.engine = null;
  }
  getViewType() { return 'localgraph'; }
  getDisplayText() {
    /* 原版：绑定文件时显示「X 的关系图」，未绑定文件时显示「局部关系图」 */
    if (!this.file) return t('plugins.graph-view.local-name');
    return t('plugins.graph-view.tab-title', { displayText: this.file.basename });
  }
  getState() {
    return {
      file: this.file ? this.file.path : null,
      options: this.engine ? this.engine.getOptions() : {},
    };
  }
  async setState(state) {
    if (state && state.options && this.engine) this.engine.setOptions(state.options);
    if (state && state.file !== undefined) this.loadFile(state.file ? this.app.vault.getFileByPath(state.file) : null);
    else this.loadFile(this.app.workspace.getActiveFile());
  }
  async onOpen() {
    this.contentEl.addClass('graph-view-container');
    this.renderer = new GraphRenderer(this.contentEl);
    this.engine = new GraphEngine(this.app, this, this.renderer, true);
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.update()));
    this.registerEvent(this.app.workspace.on('file-open', (file) => this.loadFile(file)));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const file = this.app.workspace.getActiveFile();
      if (file) this.loadFile(file);
    }));
    this.registerEvent(this.app.vault.on('rename', (file) => {
      if (file === this.file) { this.leaf.updateTabHeader(); this.requestUpdate(); }
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => { if (file === this.file) this.loadFile(null); }));
    this.registerEvent(this.app.vault.on('modify', (file) => { if (file === this.file) this.requestUpdate(); }));
    this.engine.load();
  }
  loadFile(file) {
    if (file === this.file) return;
    this.file = file;
    if (this.leaf.updateTabHeader) this.leaf.updateTabHeader();
    this.requestUpdate();
  }
  requestUpdate() {
    this._requestUpdate = this._requestUpdate || debounce(() => this.update(), 10);
    this._requestUpdate();
  }
  /* 原版 kJ.update：换文件时重置平移，局部图谱以当前文件为根 */
  update() {
    if (this._cleaned || !this.renderer || !this.engine) return;
    if (this.renderedFile !== this.file) {
      this.renderer.resetPan();
      this.renderedFile = this.file;
    }
    this.renderer.highlightNode = null;
    this.engine.options.localFile = this.file ? this.file.path : null;
    this.engine.render();
  }
  /* 原版 requestSaveLayout：本项目布局由 layout-change 触发防抖保存 */
  onOptionsChange() { this.app.workspace.trigger('layout-change'); }
}
