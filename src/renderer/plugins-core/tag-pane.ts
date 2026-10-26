/**
 * [INPUT]: View、Vault 标签元数据和菜单组件。
 * [OUTPUT]: 导出标签插件入口、设置页和 TagView。
 * [POS]: 核心插件中的标签索引视图。关闭释放订阅、计时器与容器引用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: tag-pane — all tags with counts, nested hierarchy. */
import type { EventRef } from '../core/events.js';
import { SearchView } from './global-search.js';
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { WorkspaceLeaf } from '../core/workspace-model.js';

interface TagNode { children: Map<string, TagNode>; total: number; count: number; name: string; path: string; }

export const nameKey = 'plugins.tag-pane';

export class TagView extends View {
  declare icon: string;
  declare navigation: boolean;
  declare _refs: EventRef[];
  declare _sort: string;
  declare _showNested: boolean;
  declare _collapsed: Set<string>;
  declare _container: HTMLDivElement | null;
  declare _pending: ReturnType<typeof setTimeout> | null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.icon = 'tags';
    this.navigation = true;
    this._refs = [];
    this._sort = localStorage.getItem('tag-pane-sort') || 'frequency';
    this._showNested = localStorage.getItem('tag-pane-nested') !== 'false';
    this._collapsed = new Set();
  }
  getViewType() { return 'tag'; }
  getDisplayText() { return t('plugins.tag-pane.name') || 'Tags'; }
  getIcon() { return 'tags'; }

  async onOpen() {
    this.contentEl.addClass('tag-pane-view');
    this._container = this.contentEl.createDiv('tag-container');
    this._render();
    this._refs = [
      this.app.metadataCache.on('changed', () => this._queueRender()),
      this.app.metadataCache.on('resolved', () => this._queueRender()),
    ];
  }
  onClose() {
    clearTimeout(this._pending ?? undefined);
    this._pending = null;
    this._container = null;
    for (const r of this._refs) r.unregister && r.unregister();
    this._refs = [];
  }
  _queueRender() {
    if (this._pending) return;
    this._pending = setTimeout(() => { this._pending = null; this._render(); }, 200);
  }

  _render() {
    if (!this._container) return;
    this._container.empty();
    const counts = this.app.metadataCache.getTags();
    const tags = Object.entries(counts);
    if (!tags.length) {
      this._container.createDiv({ cls: 'pane-empty', text: t('plugins.tag-pane.label-no-tags') || 'No tags found.' });
      return;
    }
    // header buttons
    const header = this._container.createDiv('tag-pane-header nav-buttons-container');
    const sortBtn = header.createDiv('nav-action-button clickable-icon');
    setIcon(sortBtn, 'arrow-up-narrow-wide');
    sortBtn.setAttr('aria-label', 'Sort');
    sortBtn.onclick = (ev: MouseEvent) => this._showSortMenu(ev);
    const collapseBtn = header.createDiv('nav-action-button clickable-icon');
    setIcon(collapseBtn, 'chevrons-down-up');
    collapseBtn.setAttr('aria-label', t('plugins.tag-pane.action-collapse-all') || 'Collapse all');
    collapseBtn.onclick = () => { for (const [tag] of tags) this._collapsed.add(tag); this._render(); };
    const expandBtn = header.createDiv('nav-action-button clickable-icon');
    setIcon(expandBtn, 'chevrons-up-down');
    expandBtn.setAttr('aria-label', t('plugins.tag-pane.action-expand-all') || 'Expand all');
    expandBtn.onclick = () => { this._collapsed.clear(); this._render(); };

    const list = this._container.createDiv('tag-list');
    if (this._showNested) {
      this._renderNested(list, tags);
    } else {
      for (const [tag, count] of this._sortEntries(tags)) {
        this._renderTagItem(list, tag, count, 0);
      }
    }
  }

  _sortEntries(entries: [string,number][]) {
    const arr = [...entries];
    if (this._sort === 'frequency') arr.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    else if (this._sort === 'frequency-asc') arr.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    else if (this._sort === 'alpha') arr.sort((a, b) => a[0].localeCompare(b[0]));
    else if (this._sort === 'alpha-desc') arr.sort((a, b) => b[0].localeCompare(a[0]));
    return arr;
  }

  _renderNested(container: HTMLElement, tags: [string,number][]) {
    // build a tree from tag paths
    const root: TagNode = { children: new Map(), total: 0, count: 0, name: '', path: '' };
    for (const [tag, count] of tags) {
      const parts = tag.replace(/^#/, '').split('/');
      let node = root;
      let prefix = '#';
      for (const part of parts) {
        let child = node.children.get(part);
        if (!child) { child = { name: part, children: new Map(), count: 0, total: 0, path: prefix + part }; node.children.set(part, child); }
        node = child;
        node.total += count;
        prefix += part + '/';
      }
      node.count += count;
    }
    const renderNode = (node: TagNode, el: HTMLElement): void => {
      const entries = [...node.children.values()];
      entries.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      for (const child of entries) {
        const hasChildren = child.children.size > 0;
        const item = el.createDiv('tree-item tag-item');
        const self = item.createDiv('tree-item-self is-clickable tag-pane-tag');
        const collapsed = this._collapsed.has(child.path);
        if (hasChildren) {
          const icon = self.createDiv('tree-item-icon collapse-icon');
          setIcon(icon, 'right-triangle');
          icon.onclick = (ev: { stopPropagation: () => void; }) => {
            ev.stopPropagation();
            if (this._collapsed.has(child.path)) this._collapsed.delete(child.path);
            else this._collapsed.add(child.path);
            this._render();
          };
          if (collapsed) { icon.addClass('is-collapsed'); }
        } else {
          self.createDiv('tree-item-icon');
        }
        self.createDiv({ cls: 'tree-item-inner', text: '#' + child.path.replace(/^#/, '') });
        self.createDiv({ cls: 'tree-item-flair', text: String(child.total) });
        self.onclick = () => this._openTag(child.path);
        self.oncontextmenu = (ev: MouseEvent) => {
          ev.preventDefault();
          this._showTagMenu(ev, child.path);
        };
        const childrenEl = item.createDiv('tree-item-children');
        childrenEl.toggle(!collapsed);
        if (hasChildren) renderNode(child, childrenEl);
      }
    };
    renderNode(root, container);
  }

  _renderTagItem(container: HTMLElement, tag: string, count: number, depth: number) {
    const item = container.createDiv('tree-item tag-item');
    const self = item.createDiv('tree-item-self is-clickable tag-pane-tag');
    self.createDiv({ cls: 'tree-item-icon' });
    self.createDiv({ cls: 'tree-item-inner', text: tag });
    self.createDiv({ cls: 'tree-item-flair', text: String(count) });
    self.onclick = () => this._openTag(tag);
    self.oncontextmenu = (ev: MouseEvent) => { ev.preventDefault(); this._showTagMenu(ev, tag); };
  }

  _openTag(tag: string) {
    const leaf = this.app.workspace.getLeavesOfType('search')[0];
    if (leaf?.view instanceof SearchView) {
      leaf.view.setQuery(`tag:${tag}`);
      this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.ensureSideLeaf('search', 'left', { state: { query: `tag:${tag}` }, reveal: true });
    }
  }

  _showSortMenu(ev: MouseEvent) {
    const menu = new Menu(this.app);
    const opts = [
      ['alpha', t('plugins.tag-pane.label-sort-by-name-a-to-z') || 'Tag name (A to Z)'],
      ['alpha-desc', t('plugins.tag-pane.label-sort-by-name-z-to-a') || 'Tag name (Z to A)'],
      ['frequency', t('plugins.tag-pane.label-sort-by-frequency-high-to-low') || 'Frequency (high to low)'],
      ['frequency-asc', t('plugins.tag-pane.label-sort-by-frequency-low-to-high') || 'Frequency (low to high)'],
    ];
    for (const [key, label] of opts) {
      menu.addItem((i) => i.setTitle(label).setChecked(this._sort === key).onClick(() => {
        this._sort = key;
        localStorage.setItem('tag-pane-sort', key);
        this._render();
      }));
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('plugins.tag-pane.action-show-nested-tags') || 'Show nested tags').setChecked(this._showNested).onClick(() => {
      this._showNested = !this._showNested;
      localStorage.setItem('tag-pane-nested', String(this._showNested));
      this._render();
    }));
    menu.showAtMouseEvent(ev);
  }

  _showTagMenu(ev: MouseEvent, tag: string) {
    const menu = new Menu(this.app);
    menu.addItem((i) => i.setTitle('Copy tag').setIcon('clipboard').onClick(() => { try { const p = navigator.clipboard.writeText(tag); if (p && p.catch) p.catch(() => {}); } catch (e) {} }));
    menu.addItem((i) => i.setTitle(t('plugins.tag-pane.label-sort-by-frequency-high-to-low') || 'Sort by frequency').onClick(() => {
      this._sort = 'frequency'; this._render();
    }));
    menu.showAtMouseEvent(ev);
  }
}

export function create(app: App) {
  return {
    onload() {
      app.viewRegistry.registerView('tag', (leaf) => new TagView(leaf));
      app.commands.addCommand({
        id: 'tag-pane:open',
        name: t('plugins.tag-pane.action-show') || 'Show tags',
        callback: () => app.workspace.ensureSideLeaf('tag', 'right', { reveal: true }),
      });
    },
    onunload() { app.viewRegistry.unregisterView('tag'); },
    deregister(app: App) { app.viewRegistry.unregisterView('tag'); },
  };
}
