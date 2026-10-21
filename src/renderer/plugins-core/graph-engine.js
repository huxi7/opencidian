/**
 * [INPUT]: 依赖 vault、metadataCache、workspace、Menu 与图谱数据、查询、面板模块。
 * [OUTPUT]: 导出 GraphEngine；连接筛选、节点动作、悬停预览、动画与渲染器。
 * [POS]: 图谱编排层；由全局和局部视图共同持有，关闭时停止异步任务并收起悬停预览。
 *        节点右键菜单按原版分节表排布，并向 workspace 触发 file-menu（供核心层与图谱插件补项）。
 *        悬停预览走 workspace 的 hover-link 事件（source=graph、targetEl=null），需按住 Mod 才弹。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { debounce } from '../core/events.js';
import { has, clamp, isModEvent } from './graph-utils.js';
import { FILTER_DEFAULTS } from './graph-options.js';
import { GraphQuery } from './graph-query.js';
import { buildGraphData, filterLocalGraph, removeOrphans } from './graph-data.js';
import { FilterSection, ColorGroupSection, DisplaySection, ForceSection } from './graph-controls.js';

const KEYBOARD_ACTIONS = { 38: 'up', 40: 'down', 37: 'left', 39: 'right', 187: 'zoomin', 189: 'zoomout' };

export class GraphEngine {
  constructor(app, view, renderer, isLocal) {
    this.app = app;
    this.view = view;
    this.renderer = renderer;
    this.isLocal = isLocal;
    this.options = { ...FILTER_DEFAULTS };
    this.searchQueries = null;
    this.fileFilter = {};
    this.hasFilter = false;
    this.queue = null;
    this.progression = 0;
    this.progressionSpeed = 20;
    this.currentFocusFile = '';
    this.destroyed = false;
    this.animationId = 0;
    this.lastHoverLink = null;
    this.hoverPopover = null;
    this.onOptionsChange = debounce(() => { if (!this.destroyed) this.view.onOptionsChange(); }, 100, true);
    this.requestUpdateSearch = debounce(() => this.updateSearch(), 250, true);
    renderer.onNodeClick = (ev, id, type) => this.onNodeClick(ev, id, type);
    renderer.onNodeRightClick = (ev, id, type) => this.onNodeRightClick(ev, id, type);
    renderer.onNodeHover = (ev, id, type) => this.onNodeHover(ev, id, type);
    renderer.onNodeUnhover = () => this.onNodeUnhover();
    const controlsEl = this.controlsEl = renderer.containerEl.createDiv('graph-controls');
    controlsEl.dataset.ignoreSwipe = 'true';
    controlsEl.createDiv('clickable-icon graph-controls-button mod-close', (el) => {
      setIcon(el, 'x');
      el.setAttr('aria-label', t('interface.menu.close'));
      el.addEventListener('click', () => { controlsEl.addClass('is-close'); this.onOptionsChange(); });
    });
    controlsEl.createDiv('clickable-icon graph-controls-button mod-open', (el) => {
      setIcon(el, 'settings');
      el.setAttr('aria-label', t('plugins.graph-view.tooltip-open-graph-settings'));
      el.addEventListener('click', () => { controlsEl.removeClass('is-close'); this.onOptionsChange(); });
    });
    if (!isLocal) {
      controlsEl.createDiv('clickable-icon graph-controls-button mod-animate', (el) => {
        setIcon(el, 'wand-2');
        el.setAttr('aria-label', t('plugins.graph-view.tooltip-start-timelapse-animation'));
        el.addEventListener('click', () => this.renderProgression());
      });
    }
    controlsEl.createDiv('clickable-icon graph-controls-button mod-reset', (el) => {
      setIcon(el, 'rotate-ccw');
      el.setAttr('aria-label', t('interface.tooltip-restore-default-settings'));
      el.addEventListener('click', () => {
        this.filterOptions.setDefaultOptions();
        this.colorGroupOptions.setColorQueries([]);
        this.displayOptions.setDefaultOptions();
        this.forceOptions.setDefaultOptions();
        this.updateSearch();
      });
    });
    this.filterOptions = new FilterSection(this, isLocal);
    this.colorGroupOptions = new ColorGroupSection(this);
    this.displayOptions = new DisplaySection(this, isLocal);
    this.forceOptions = new ForceSection(this);
    this.filterOptions.setDefaultOptions();
    this.colorGroupOptions.setColorQueries([]);
    this.displayOptions.setDefaultOptions();
    this.forceOptions.setDefaultOptions();
  }

  /* 原版 load：文件/元数据/外观/打开文件事件 + 缩放持久化定时器 + 键盘缩放平移 */
  load() {
    const app = this.app;
    const view = this.view;
    view.registerEvent(app.vault.on('create', (file) => this.onFileChanged(file)));
    view.registerEvent(app.vault.on('modify', (file) => this.onFileChanged(file)));
    view.registerEvent(app.vault.on('rename', () => this.recomputeFile()));
    view.registerEvent(app.vault.on('delete', () => this.recomputeFile()));
    view.registerEvent(app.metadataCache.on('changed', () => this.recomputeFile()));
    view.registerEvent(app.metadataCache.on('resolved', () => this.recomputeFile()));
    view.registerEvent(app.workspace.on('settings-changed', () => this.onCssChange()));
    view.registerEvent(app.workspace.on('file-open', (file) => this.onFileOpen(file)));
    view.registerEvent(app.workspace.on('active-leaf-change', () => {
      const file = app.workspace.getActiveFile();
      if (file) this.onFileOpen(file);
    }));
    let lastScale = 0;
    view.registerInterval(window.setInterval(() => {
      if (this.renderer.targetScale !== lastScale) { lastScale = this.renderer.targetScale; this.onOptionsChange(); }
    }, 2000));
    const onKey = (ev) => {
      const renderer = this.renderer;
      renderer.keyboardActions.shift = ev.shiftKey;
      const down = ev.type === 'keydown';
      if (down) {
        if (ev.repeat || ev.defaultPrevented) return;
        if (app.workspace.activeLeaf !== view.leaf) return;
        if (document.activeElement !== document.body) return;
      }
      const code = ev.which || ev.keyCode;
      if (!has(KEYBOARD_ACTIONS, code)) return;
      renderer.keyboardActions[KEYBOARD_ACTIONS[code]] = down;
      renderer.changed();
    };
    view.registerDomEvent(window, 'keydown', onKey);
    view.registerDomEvent(window, 'keyup', onKey);
    view.registerDomEvent(window, 'blur', () => { this.renderer.keyboardActions = {}; });
    this.onFileOpen(app.workspace.getActiveFile());
  }

  destroy() {
    this.destroyed = true;
    this.animationId++;
    this.progression = 0;
    if (this.queue) clearTimeout(this.queue.timer);
    this.queue = null;
    this.filterOptions.stopSearch();
    /* 关闭视图时同步收起悬停预览（预览由 page-preview 插件持有） */
    if (this.hoverPopover && this.hoverPopover.hide) this.hoverPopover.hide();
    this.hoverPopover = null;
    this.lastHoverLink = null;
  }

  onCssChange() { this.renderer.testCSS(); }

  updateSearch() {
    if (this.destroyed) return;
    const queries = [];
    const search = this.filterOptions.search.getValue();
    if (search) queries.push({ query: search, color: null });
    this.setQuery(queries.concat(this.colorGroupOptions.getColoredQueries()));
    this.onOptionsChange();
  }

  /* 原版 setQuery：丢弃空检索式；非颜色检索式决定 hasFilter；分块扫描文件后重绘 */
  setQuery(queries) {
    if (this.destroyed) return;
    if (this.queue) { clearTimeout(this.queue.timer); this.queue = null; }
    this.filterOptions.stopSearch();
    this.hasFilter = false;
    let list = [];
    for (const entry of queries) {
      const query = new GraphQuery(entry.query);
      if (!query.matcher) continue;
      list.push({ query, color: entry.color });
      if (!entry.color) this.hasFilter = true;
    }
    if (list.length === 0) list = null;
    this.searchQueries = list;
    if (!list) { this.fileFilter = {}; this.render(); return; }
    const fileFilter = this.fileFilter = {};
    const files = this.app.vault.getFiles();
    const queue = this.queue = { timer: null };
    let index = 0;
    this.filterOptions.startSearch();
    const step = () => {
      if (this.queue !== queue) return;
      const started = performance.now();
      while (index < files.length && performance.now() - started < 12) {
        const file = files[index++];
        const text = file.extension === 'md' ? this.fileText(file) : '';
        const tags = (this.app.metadataCache.getCache(file.path)?.tags || []).map((entry) => entry.tag);
        let keep = true;
        let color = null;
        for (const entry of list) {
          const matched = entry.query.match(file, text, tags);
          if (!matched && !entry.color) { keep = false; break; }
          if (matched && entry.color) { color = entry.color; break; }
        }
        fileFilter[file.path] = keep ? (color || true) : false;
      }
      if (index < files.length) { queue.timer = setTimeout(step, 0); return; }
      this.queue = null;
      this.filterOptions.stopSearch();
      this.render();
    };
    queue.timer = setTimeout(step, 0);
  }

  fileText(file) {
    const cache = this.app.metadataCache.getCache(file.path);
    return (cache && cache._rawText) || '';
  }

  /* 原版 render：构建数据 → 局部过滤 → 去孤立 → 焦点类型 → 交给渲染器 */
  render() {
    if (this.destroyed) return 0;
    const app = this.app;
    const renderer = this.renderer;
    const options = this.options;
    const searchQueries = this.searchQueries;
    const fileFilter = this.fileFilter;
    if (!this.isLocal || options.localFile) {
      if (this.isLocal) this.progression = 0;
      const nodeFilter = (path, type) => {
        if (!searchQueries) return true;
        if (type === '') return path === options.localFile || (has(fileFilter, path) ? fileFilter[path] : !this.hasFilter);
        if (type === 'tag') return searchQueries.every((entry) => !!entry.color || !!entry.query.matchTag(path));
        if (type === 'attachment') return searchQueries.every((entry) => !!entry.color || !!entry.query.matchFilepath(path));
        return true;
      };
      let data = buildGraphData(app.metadataCache, app.vault, options, nodeFilter, this.progression);
      const numLinks = data.numLinks;
      if (options.localFile) data = filterLocalGraph(data, options);
      if (!options.showOrphans) removeOrphans(data);
      const focusFile = this.isLocal ? options.localFile : this.currentFocusFile;
      if (focusFile) {
        const node = data.nodes[focusFile];
        if (node) node.type = 'focused';
      }
      renderer.setData(data);
      return numLinks;
    }
    renderer.setData({ nodes: {} });
    return 0;
  }

  /* 原版 renderProgression：按链接总数决定生长速度，逐帧推进进度到总量后收尾 */
  async renderProgression() {
    if (this.destroyed || this.isLocal) return;
    const animationId = ++this.animationId;
    this.progression = 1;
    const total = this.render() || 0;
    this.progressionSpeed = clamp(0.5 * Math.sqrt(total), 5, 100);
    const started = Date.now();
    while (this.progression > 0 && !this.destroyed && animationId === this.animationId) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      if (this.destroyed || animationId !== this.animationId) break;
      const snapshot = this.progression;
      const next = 1 + Math.floor(this.progressionSpeed * (Date.now() - started) / 1000);
      if (snapshot !== this.progression) break;
      if (next === this.progression) continue;
      if (next > total) {
        this.progression = 0;
        this.render();
        break;
      }
      this.progression = next;
      this.render();
    }
  }

  onFileChanged(file) { if (file.extension !== 'md') this.recomputeFile(); }

  recomputeFile() {
    if (this.searchQueries) this.updateSearch();
    else this.render();
  }

  onFileOpen(file) {
    const path = file ? file.path : '';
    if (path === this.currentFocusFile) return;
    this.currentFocusFile = path;
    this.render();
  }

  onNodeClick(ev, id, type) {
    if (type !== 'tag') return this.app.workspace.openLinkText(id, '', ev?.button === 1 || isModEvent(ev));
    else this.openTagSearch(id);
  }

  /* 原版右键菜单：分节表 title/open/action/info/info.copy/view/view.linked/system/''/danger，
     view.linked 是子菜单（打开关联视图），条目依次为标题（短文件名）/ 在新标签页中打开 /
     file-menu 事件贡献项 / 删除文件。file-menu 事件本项目由核心层与图谱插件各贡献一段。 */
  onNodeRightClick(ev, id, type) {
    if (type === 'tag') { this.openTagSearch(id); return; }
    const app = this.app;
    const path = app.metadataCache.getFirstLinkpathDest(id, '');
    const file = path ? app.vault.getFileByPath(path) : null;
    if (!file || !(ev instanceof MouseEvent)) return;
    const menu = new Menu(app);
    menu.addSections(['title', 'open', 'action', 'info', 'info.copy', 'view', 'view.linked', 'system', '', 'danger']);
    menu.setSectionSubmenu('view.linked', { title: t('interface.menu.open-linked-view'), icon: 'lucide-link' });
    menu.addItem((item) => item.setSection('title').setTitle(file.basename).setIsLabel(true));
    menu.addItem((item) => item.setSection('open')
      .setTitle(t('interface.menu.open-in-new-tab')).setIcon('file-plus')
      .onClick(() => app.workspace.openLinkText(id, '', true)));
    app.workspace.trigger('file-menu', menu, file, 'graph-context-menu', this.view.leaf);
    menu.addItem((item) => item.setSection('danger')
      .setTitle(t('interface.menu.delete-file')).setIcon('trash-2').setWarning(true)
      .onClick(() => { app.fileManager.promptForDeletion(file); }));
    menu.showAtMouseEvent(ev);
  }

  /* 原版 onNodeHover：文件、焦点与附件节点经 workspace 的 hover-link 事件请求页面预览；
     标签与未解析节点不触发。同一节点的预览仍在时只续命，不重复请求。
     原版载荷只有 event/source/hoverParent/targetEl/linktext 五项，没有 sourcePath。 */
  onNodeHover(ev, id, type) {
    this.onNodeUnhover();
    if (!(ev instanceof MouseEvent)) return;
    if (!(type === '' || type === 'focused' || type === 'attachment')) return;
    const popover = this.hoverPopover;
    if (popover && popover.isShown && this.lastHoverLink === id) {
      popover.onTarget = true;
      popover.transition();
      return;
    }
    this.lastHoverLink = id;
    this.app.workspace.trigger('hover-link', {
      event: ev, source: 'graph', hoverParent: this, targetEl: null, linktext: id,
    });
  }

  /* 原版 onNodeUnhover：预览的持有者是 page-preview 插件，这里只撤销悬停标记 */
  onNodeUnhover() {
    const popover = this.hoverPopover;
    if (popover) { popover.onTarget = false; popover.transition(); }
  }

  /* page-preview 在延迟显示前回调本方法：悬停已结束时不再打开预览 */
  isHoveringLink(id) {
    const node = this.renderer.getHighlightNode();
    return !!node && node.id === id;
  }

  /* 标签节点点击：原版调用 global-search 插件的 openGlobalSearch("tag:xxx") */
  openTagSearch(tag) {
    const open = (leaf) => {
      const view = leaf && leaf.view;
      if (view && view.setQuery) view.setQuery('tag:' + tag);
      if (view && view.focus) view.focus();
    };
    const leaves = this.app.workspace.getLeavesOfType('search');
    if (leaves.length) { this.app.workspace.revealLeaf(leaves[0]); open(leaves[0]); return; }
    this.app.workspace.ensureSideLeaf('search', 'left', { reveal: true }).then(open);
  }

  getOptions() {
    const options = {};
    this.filterOptions.getOptions(options);
    this.colorGroupOptions.getOptions(options);
    this.displayOptions.getOptions(options);
    this.forceOptions.getOptions(options);
    options.scale = this.renderer.targetScale;
    options.close = this.controlsEl.hasClass('is-close');
    return options;
  }

  setOptions(options) {
    if (!options) return;
    this.filterOptions.setOptions(options);
    this.colorGroupOptions.setOptions(options);
    this.displayOptions.setOptions(options);
    this.forceOptions.setOptions(options);
    if (options.scale) this.renderer.zoomTo(options.scale);
    if (typeof options.close === 'boolean') this.controlsEl.toggleClass('is-close', options.close);
    this.render();
  }
}
