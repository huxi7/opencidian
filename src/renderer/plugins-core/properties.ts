/**
 * [INPUT]: View 生命周期、workspace 当前文件与 statusBar、metadataCache 的 frontmatter、markdown/properties.js 的可编辑渲染与 properties-types 类型服务、命令与菜单。
 * [OUTPUT]: 导出 AllPropertiesView、FilePropertiesView 与插件 create(app)（命令 properties:open / properties:open-local）。
 * [POS]: plugins-core/ 的属性插件（原版 id properties）。all-properties 汇总仓库内全部属性键并可按四种顺序排序；
 *        file-properties 编辑当前文件属性，类型持久化共用 properties-types；状态栏条目显示属性数并打开 file-properties。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: properties — the "All properties" and "File properties" panes. */
import { View } from '../core/view.js';
import { t, getNouns } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { IS_MAC } from '../core/keymap.js';
import { buildMetadataContainer } from '../markdown/properties.js';
import { getPropertyTypes } from '../markdown/properties-types.js';
import { showPropertyTypeMenu } from '../markdown/properties-menu.js';

export const nameKey = 'plugins.properties';

export const ALL_PROPERTIES_VIEW_TYPE = 'all-properties';
export const FILE_PROPERTIES_VIEW_TYPE = 'file-properties';

// 原版 g7/y7：两组各两项，组间分隔线；默认 frequency。
const SORT_GROUPS = [['alphabetical', 'alphabeticalReverse'], ['frequency', 'frequencyReverse']];
const SORT_LABELS = {
  alphabetical: () => t('plugins.properties.label-sort-by-name-a-to-z') || 'Property name (A to Z)',
  alphabeticalReverse: () => t('plugins.properties.label-sort-by-name-z-to-a') || 'Property name (Z to A)',
  frequency: () => t('plugins.properties.label-sort-by-frequency-high-to-low') || 'Frequency (high to low)',
  frequencyReverse: () => t('plugins.properties.label-sort-by-frequency-low-to-high') || 'Frequency (low to high)',
};

function isModEvent(ev) {
  return IS_MAC ? !!ev.metaKey : !!ev.ctrlKey;
}

export class AllPropertiesView extends View {
  declare icon: string;
  declare navigation: boolean;
  declare _refs: any[];
  declare _pending: any;
  declare _list: any;
  declare _header: any;
  declare _sortOrder: string;

  constructor(leaf) {
    super(leaf);
    this.icon = 'archive';
    this.navigation = true;
    this._refs = [];
    this._pending = null;
    this._list = null;
    this._header = null;
    this._sortOrder = 'frequency';
  }
  getViewType() { return ALL_PROPERTIES_VIEW_TYPE; }
  getIcon() { return 'archive'; }
  getDisplayText() { return t('plugins.properties.name-global') || 'All properties'; }
  getState() { return { sortOrder: this._sortOrder }; }

  async setState(state) {
    if (state && SORT_LABELS[state.sortOrder]) this._sortOrder = state.sortOrder;
    this._render();
  }

  async onOpen() {
    this.contentEl.addClass('all-properties-view');
    this._header = this.contentEl.createDiv('nav-header');
    this._renderHeader();
    this._list = this.contentEl.createDiv('properties-list');
    this._render();
    this._refs = [
      this.app.metadataCache.on('changed', () => this._queueRender()),
      this.app.metadataCache.on('resolved', () => this._queueRender()),
      this.app.workspace.on('properties-type-change', () => this._queueRender()),
      this.app.vault.on('create', () => this._queueRender()),
      this.app.vault.on('delete', () => this._queueRender()),
      this.app.vault.on('rename', () => this._queueRender()),
    ];
  }

  onClose() {
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
    clearTimeout(this._pending);
    this._pending = null;
    this._list = null;
    this._header = null;
  }

  _queueRender() {
    if (!this._list || this._pending !== null) return;
    this._pending = setTimeout(() => { this._pending = null; this._render(); }, 150);
  }

  _renderHeader() {
    const header = this._header;
    if (!header) return;
    header.empty();
    const buttons = header.createDiv('nav-buttons-container');
    const sortBtn = buttons.createDiv('clickable-icon nav-action-button');
    setIcon(sortBtn, 'sort-asc');
    sortBtn.setAttr('aria-label', t('plugins.file-explorer.action-change-sort') || 'Change sort order');
    sortBtn.onclick = (ev) => {
      ev.preventDefault();
      this._showSortMenu(sortBtn, ev);
    };
  }

  _showSortMenu(anchor, ev) {
    const menu = new Menu(this.app);
    SORT_GROUPS.forEach((group, groupIndex) => {
      for (const order of group) {
        menu.addItem((item) => item
          .setTitle(SORT_LABELS[order]())
          .setChecked(order === this._sortOrder)
          .onClick(() => this.setSortOrder(order)));
      }
      if (groupIndex < SORT_GROUPS.length - 1) menu.addSeparator();
    });
    menu.setParentElement(anchor).showAtMouseEvent(ev);
  }

  setSortOrder(order) {
    if (!SORT_LABELS[order]) return;
    this._sortOrder = order;
    this._render();
  }

  /** 统计：属性键 → 出现该键的 md 文件数（原版 metadataTypeManager.occurrences 语义）。 */
  _collectStats() {
    const stats = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter;
      if (!frontmatter) continue;
      for (const key of Object.keys(frontmatter)) {
        const normalized = key.toLowerCase();
        const entry = stats.get(normalized) || { name: key, count: 0, value: frontmatter[key] };
        entry.count += 1;
        stats.set(normalized, entry);
      }
    }
    return stats;
  }

  _sorted(stats) {
    const entries = [...stats.entries()].map(([, info]) => ({ name: info.name, count: info.count, value: info.value }));
    const byName = (a, b) => a.name.localeCompare(b.name);
    switch (this._sortOrder) {
      case 'alphabetical': return entries.sort(byName);
      case 'alphabeticalReverse': return entries.sort((a, b) => byName(b, a));
      case 'frequencyReverse': return entries.sort((a, b) => a.count - b.count || byName(a, b));
      default: return entries.sort((a, b) => b.count - a.count || byName(a, b));
    }
  }

  _render() {
    const list = this._list;
    if (!list) return;
    list.empty();
    const entries = this._sorted(this._collectStats());
    if (!entries.length) {
      list.createDiv({ cls: 'pane-empty', text: t('plugins.properties.label-no-properties') || 'No properties found.' });
      return;
    }
    for (const entry of entries) {
      const item = list.createDiv('tree-item');
      const row = item.createDiv('tree-item-self is-clickable property-item');
      const iconEl = row.createSpan('tree-item-icon');
      setIcon(iconEl, getPropertyTypes(this.app).getTypeInfo(entry.name, entry.value).expected.icon);
      row.createDiv({ cls: 'tree-item-inner' }).createDiv({ cls: 'tree-item-inner-text', text: entry.name });
      row.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(entry.count) });
      row.onclick = (ev) => this._openSearchForProperty(entry.name, ev);
      row.oncontextmenu = ev => showPropertyTypeMenu(this.app, { key: entry.name, value: entry.value }, row, ev);
    }
  }

  /** 原版 onSelfClick：打开全局搜索 ["name"]；Mod 点击在现有查询里切换该 token。 */
  _openSearchForProperty(name, ev) {
    const token = '["' + name + '"]';
    const open = (leaf) => {
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view;
      let next = token;
      if (isModEvent(ev) && view.getState) {
        const current = String(view.getState().query || '').trim();
        if (current) {
          next = current.includes(token)
            ? current.replace(token, '').trim()
            : current + ' ' + token;
        }
      }
      if (view.setQuery) view.setQuery(next);
    };
    const leaf = this.app.workspace.getLeavesOfType('search')[0];
    if (leaf) open(leaf);
    else this.app.workspace.ensureSideLeaf('search', 'left', { reveal: true }).then(open);
  }
}

export class FilePropertiesView extends View {
  declare icon: string;
  declare navigation: boolean;
  declare _refs: any[];
  declare _pending: any;
  declare _container: any;
  declare _stateFile: any;
  declare _renderedPath: any;

  constructor(leaf) {
    super(leaf);
    this.icon = 'info';
    this.navigation = true;
    this._refs = [];
    this._pending = null;
    this._container = null;
    this._stateFile = null;
    this._renderedPath = null;
  }
  getViewType() { return FILE_PROPERTIES_VIEW_TYPE; }
  getIcon() { return 'info'; }

  /** 跟随活动文件；没有活动文件时退回 setState 指定的文件。 */
  _file() {
    const active = this.app.workspace.getActiveFile();
    if (active) return active;
    if (this._stateFile) return this.app.vault.getFileByPath(this._stateFile) || null;
    return null;
  }
  getDisplayText() {
    const file = this._file();
    if (!file) return t('plugins.properties.name-local') || 'File properties';
    return t('plugins.properties.tab-title', { displayText: file.basename });
  }
  getState() { return this._renderedPath ? { file: this._renderedPath } : {}; }

  async setState(state) {
    if (state && typeof state.file === 'string') this._stateFile = state.file;
    this._render();
  }

  async onOpen() {
    this.contentEl.addClass('file-properties-view');
    this._container = this.contentEl.createDiv('file-properties-container');
    this._render();
    this._refs = [
      this.app.workspace.on('active-leaf-change', () => this._render()),
      this.app.workspace.on('file-open', () => this._render()),
      this.app.metadataCache.on('changed', (file) => {
        const active = this.app.workspace.getActiveFile();
        if (file && active && file.path === active.path) this._queueRender();
      }),
      this.app.metadataCache.on('resolved', () => this._queueRender()),
      this.app.workspace.on('properties-type-change', () => this._queueRender()),
    ];
  }

  onClose() {
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
    clearTimeout(this._pending);
    this._pending = null;
    this._container = null;
    this._renderedPath = null;
  }

  _queueRender() {
    if (!this._container || this._pending !== null) return;
    this._pending = setTimeout(() => { this._pending = null; this._render(); }, 120);
  }

  _render() {
    const container = this._container;
    if (!container) return;
    if (this.leaf) this.leaf.updateTabHeader();
    container.empty();
    const file = this._file();
    this._renderedPath = file ? file.path : null;
    if (!file || file.extension !== 'md') {
      container.createDiv({ cls: 'pane-empty', text: t('plugins.properties.label-no-properties') || 'No properties found.' });
      return;
    }
    // 侧栏与文档共用编辑器和 processFrontMatter；无 frontmatter 时也允许添加首个属性。
    const el = buildMetadataContainer(this.app, file, { editable: true });
    if (el) container.appendChild(el);
    else container.createDiv({ cls: 'pane-empty', text: t('plugins.properties.label-no-properties') || 'No properties found.' });
  }
}

class PropertiesPlugin {
  declare app: App;
  declare _refs: any[];
  declare _commandIds: any[];
  declare _statusBarEl: any;

  constructor(app: App) {
    this.app = app;
    this._refs = [];
    this._commandIds = [];
    this._statusBarEl = null;
  }

  onload() {
    const app = this.app;
    getPropertyTypes(app);
    app.viewRegistry.registerView(ALL_PROPERTIES_VIEW_TYPE, (leaf) => new AllPropertiesView(leaf));
    app.viewRegistry.registerView(FILE_PROPERTIES_VIEW_TYPE, (leaf) => new FilePropertiesView(leaf));
    this._commandIds = [];
    const add = (command) => {
      app.commands.addCommand(command);
      this._commandIds.push(command.id);
    };
    add({
      id: 'properties:open',
      name: t('plugins.properties.action-show') || 'Show all properties',
      icon: 'archive',
      callback: () => { app.workspace.ensureSideLeaf(ALL_PROPERTIES_VIEW_TYPE, 'right', { reveal: true }); },
    });
    add({
      id: 'properties:open-local',
      name: t('plugins.properties.action-show-local') || 'Show file properties',
      icon: 'info',
      callback: () => { this.ensurePropertiesView(app.workspace.getActiveFile()); },
    });
    this._statusBarEl = app.workspace.statusBar.createDiv('status-bar-item plugin-properties');
    this._statusBarEl.addClass('mod-clickable');
    this._statusBarEl.addEventListener('click', () => {
      this.ensurePropertiesView(app.workspace.getActiveFile());
    });
    this._refs = [
      app.workspace.on('file-open', () => this.updateStatusBar()),
      app.metadataCache.on('changed', (file) => {
        const active = app.workspace.getActiveFile();
        if (file && active && file.path === active.path) this.updateStatusBar();
      }),
    ];
    this.updateStatusBar();
  }

  onunload() {
    const app = this.app;
    if (this._statusBarEl) { this._statusBarEl.detach(); this._statusBarEl = null; }
    for (const id of this._commandIds) app.commands.removeCommand(id);
    this._commandIds = [];
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
    for (const type of [ALL_PROPERTIES_VIEW_TYPE, FILE_PROPERTIES_VIEW_TYPE]) {
      for (const leaf of app.workspace.getLeavesOfType(type)) leaf.detach();
      app.viewRegistry.unregisterView(type);
    }
  }

  /** 原版 updateStatusbar：文本为 nouns.properties-with-count，无属性时隐藏。 */
  updateStatusBar() {
    if (!this._statusBarEl) return;
    const file = this.app.workspace.getActiveFile();
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    const frontmatter = cache && cache.frontmatter;
    const count = frontmatter ? Object.keys(frontmatter).length : 0;
    this._statusBarEl.setText(getNouns().properties(count));
    this._statusBarEl.toggle(count > 0);
  }

  /** 原版 ensurePropertiesView：聚焦右侧 file-properties 并写入目标文件。 */
  async ensurePropertiesView(file) {
    const leaf = await this.app.workspace.ensureSideLeaf(FILE_PROPERTIES_VIEW_TYPE, 'right', { reveal: true });
    await leaf.setViewState({ type: FILE_PROPERTIES_VIEW_TYPE, state: file ? { file: file.path } : {} });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return leaf.view;
  }
}

export function create(app: App) {
  const plugin = new PropertiesPlugin(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregister() { plugin.onunload(); },
  };
}
