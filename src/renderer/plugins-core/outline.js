/**
 * [INPUT]: View 生命周期、workspace 当前文件与 metadataCache 标题位置。
 * [OUTPUT]: 导出 OutlineView 与插件 create。
 * [POS]: 右栏标题树。按标题层级嵌套，按行跳转；关闭时释放订阅与计时器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';

export const nameKey = 'plugins.outline';

export class OutlineView extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'list';
    this.navigation = true;
    this._refs = [];
    this._followCursor = true;
    this._pending = null;
    this._filePath = null;
    this._collapsedHeadings = new Set();
  }
  getViewType() { return 'outline'; }
  getDisplayText() {
    const file = this.app.workspace.getActiveFile();
    return file ? (t('plugins.outline.tab-title', { displayText: file.basename }) || `Outline of ${file.basename}`) : (t('plugins.outline.name') || 'Outline');
  }
  getIcon() { return 'list'; }

  async onOpen() {
    this.contentEl.addClass('outline-view');
    this.contentEl.empty();
    this._tree = this.contentEl.createDiv('outline-view-container');
    this._render();
    this._refs = [
      this.app.workspace.on('active-leaf-change', () => this._render()),
      this.app.workspace.on('file-open', () => this._render()),
      this.app.metadataCache.on('changed', (file) => {
        const active = this.app.workspace.getActiveFile();
        if (active && file && file.path === active.path) this._queueRender();
      }),
    ];
  }
  onClose() {
    for (const r of this._refs) r.unregister && r.unregister();
    this._refs = [];
    clearTimeout(this._pending);
    this._pending = null;
    this._tree = null;
    this._collapsedHeadings.clear();
  }
  _queueRender() {
    if (!this._tree || this._pending !== null) return;
    this._pending = setTimeout(() => {
      this._pending = null;
      this._render();
    }, 100);
  }

  _render() {
    if (!this._tree) return;
    if (this.leaf) this.leaf.updateTabHeader();
    this._tree.empty();
    const file = this.app.workspace.getActiveFile();
    if (this._filePath !== (file?.path || null)) {
      this._filePath = file?.path || null;
      this._collapsedHeadings.clear();
    }
    if (!file) {
      this._tree.createDiv({ cls: 'pane-empty', text: t('plugins.outline.label-no-headings') || 'No headings found.' });
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = (cache && cache.headings) || [];
    if (!headings.length) {
      this._tree.createDiv({ cls: 'pane-empty', text: t('plugins.outline.label-no-headings') || 'No headings found.' });
      return;
    }
    const stack = [];
    const occurrences = new Map();
    const keys = new Set();
    for (const h of headings) {
      while (stack.length && stack[stack.length - 1].heading.level >= h.level) stack.pop();
      const parent = stack[stack.length - 1];
      const identity = `${h.level}:${h.heading}`;
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      const key = `${identity}:${occurrence}`;
      keys.add(key);
      const item = (parent ? parent.children : this._tree).createDiv('tree-item');
      item.setAttr('data-line', h.position.start.line);
      const self = item.createDiv('tree-item-self is-clickable');
      self.createDiv({ cls: 'tree-item-inner', text: h.heading });
      self.onclick = () => this._openHeading(file, h);
      const children = item.createDiv('tree-item-children');
      const node = { heading: h, item, self, children, key };
      if (parent && !parent.icon) this._makeCollapsible(parent);
      stack.push(node);
    }
    for (const key of this._collapsedHeadings) if (!keys.has(key)) this._collapsedHeadings.delete(key);
  }

  // --- 每个标题归属最近的较高层标题；跳级不创建空节点 ---
  _makeCollapsible(node) {
    node.self.addClass('mod-collapsible');
    const icon = node.self.createSpan('tree-item-icon collapse-icon');
    node.self.prepend(icon);
    node.icon = icon;
    setIcon(icon, 'right-triangle');
    const setCollapsed = (collapsed) => {
      node.item.toggleClass('is-collapsed', collapsed);
      icon.toggleClass('is-collapsed', collapsed);
      node.self.setAttr('aria-expanded', String(!collapsed));
      node.children.toggle(!collapsed);
      if (collapsed) this._collapsedHeadings.add(node.key);
      else this._collapsedHeadings.delete(node.key);
    };
    setCollapsed(this._collapsedHeadings.has(node.key));
    icon.onclick = (event) => {
      event.stopPropagation();
      setCollapsed(!node.item.hasClass('is-collapsed'));
    };
  }

  _openHeading(file, heading) {
    const workspace = this.app.workspace;
    const leaves = workspace.getLeavesOfType('markdown').filter((leaf) =>
      workspace._sideOf(leaf) === 'center' && leaf.view.file?.path === file.path);
    const leaf = leaves.find((item) => item === workspace.activeLeaf)
      || leaves.sort((a, b) => b.activeTime - a.activeTime)[0];
    const eState = { line: heading.position.start.line };
    if (!leaf) return workspace.openFile(file, { eState });
    workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.setEphemeralState(eState);
  }

  _fillViewActions(actions) {
    const more = actions.createDiv('clickable-icon view-action');
    setIcon(more, 'more-horizontal');
    more.setAttr('aria-label', 'More options');
    more.onclick = (ev) => {
      const menu = new Menu(this.app);
      menu.addItem((i) => i.setTitle(t('plugins.outline.label-follow-cursor') || 'Auto-scroll to current section').setChecked(this._followCursor).onClick(() => {
        this._followCursor = !this._followCursor;
      }));
      menu.addItem((i) => i.setTitle(t('plugins.outline.action-open-for-current') || 'Open outline of the current file').setIcon('list').onClick(() => {
        this.app.workspace.ensureSideLeaf('outline', 'right', { reveal: true });
      }));
      menu.showAtMouseEvent(ev);
    };
  }
}

export function create(app) {
  return {
    onload() {
      app.viewRegistry.registerView('outline', (leaf) => new OutlineView(leaf));
      app.commands.addCommand({
        id: 'outline:open',
        name: t('plugins.outline.action-open') || 'Open outline',
        callback: () => app.workspace.ensureSideLeaf('outline', 'right', { reveal: true }),
      });
      app.commands.addCommand({
        id: 'outline:open-for-current',
        name: t('plugins.outline.action-open-for-current') || 'Open outline of the current file',
        checkCallback: (checking) => {
          if (!app.workspace.getActiveFile()) return false;
          if (!checking) app.workspace.ensureSideLeaf('outline', 'right', { reveal: true });
          return true;
        },
      });
    },
    onunload() { app.viewRegistry.unregisterView('outline'); },
    deregister(app) { app.viewRegistry.unregisterView('outline'); },
  };
}
