/* Core plugin: outline — headings of the active file. */
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
  }
  getViewType() { return 'outline'; }
  getDisplayText() {
    const file = this.app.workspace.getActiveFile();
    return file ? (t('plugins.outline.tab-title', { displayText: file.basename }) || `Outline of ${file.basename}`) : (t('plugins.outline.name') || 'Outline');
  }
  getIcon() { return 'list'; }

  async onOpen() {
    this.contentEl.addClass('outline-view');
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
  }
  _queueRender() { setTimeout(() => this._render(), 100); }

  _render() {
    if (!this._tree) return;
    if (this.leaf) this.leaf.updateTabHeader();
    this._tree.empty();
    const file = this.app.workspace.getActiveFile();
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
    const minLevel = Math.min(...headings.map((h) => h.level));
    this._container = this._tree.createDiv('tree-item');
    const children = this._container.createDiv('tree-item-children');
    for (const h of headings) {
      const item = children.createDiv('tree-item');
      const self = item.createDiv('tree-item-self is-clickable');
      self.style.paddingLeft = (4 + (h.level - minLevel) * 14) + 'px';
      self.createDiv({ cls: 'tree-item-inner', text: h.heading });
      self.onclick = () => {
        this.app.workspace.openFile(file, { eState: { subpath: h.heading } });
      };
      this._bindFollow(self, h);
    }
  }

  _bindFollow(el, heading) {
    el.addEventListener('mouseenter', () => { this._hoverHeading = heading; });
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
