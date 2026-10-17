/* Core plugin: backlinks — linked & unlinked mentions of the active file. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { renderMarkdown } from '../markdown/reading.js';

export const nameKey = 'plugins.backlinks';

// find [[link]] / [text](link) occurrences that resolve to target
export function findLinkContexts(app, sourceFile, targetFile) {
  const cache = app.metadataCache.getFileCache(sourceFile);
  const text = (cache && cache._rawText) || '';
  if (!text) return [];
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = /(!?\[\[([^\[\]]+?)\]\])|((?<!!)\[([^\[\]]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\))/g;
    let m;
    while ((m = re.exec(line))) {
      let linktext;
      if (m[2] !== undefined) linktext = m[2].split('|')[0].split('#')[0].trim();
      else if (m[5] !== undefined) linktext = m[5].split('#')[0].trim();
      else continue;
      if (!linktext) continue;
      const dest = app.metadataCache.getFirstLinkpathDest(linktext, sourceFile.path);
      if (dest === targetFile.path) {
        out.push({ line: i, text: line, matchStart: m.index, matchEnd: m.index + m[0].length });
      }
    }
    if (out.length > 200) break;
  }
  return out;
}

export class BacklinkView extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'arrow-left-right';
    this.navigation = true;
    this._refs = [];
    this._showSearch = false;
    this._query = '';
    this._backlinkCollapsed = false;
    this._unlinkedCollapsed = false;
  }
  getViewType() { return 'backlink'; }
  getDisplayText() {
    const file = this.app.workspace.getActiveFile();
    return file ? (t('plugins.backlinks.tab-title', { displayText: file.basename }) || `Backlinks for ${file.basename}`) : (t('plugins.backlinks.name') || 'Backlinks');
  }
  getIcon() { return 'arrow-left-right'; }
  getState() { return { query: this._query }; }

  async onOpen() {
    this.contentEl.addClass('backlink-view');
    this._pane = this.contentEl.createDiv('backlink-pane');
    this._render();
    this._refs = [
      this.app.workspace.on('active-leaf-change', () => this._render()),
      this.app.workspace.on('file-open', () => this._render()),
      this.app.metadataCache.on('changed', () => this._queueRender()),
      this.app.metadataCache.on('resolved', () => this._queueRender()),
    ];
    this.app.workspace.on('layout-change', () => this._updateTitle());
  }
  onClose() {
    for (const r of this._refs) r.unregister && r.unregister();
    this._refs = [];
  }
  _queueRender() {
    if (this._pending) return;
    this._pending = setTimeout(() => { this._pending = null; this._render(); }, 120);
  }
  _updateTitle() {
    if (this.leaf) this.leaf.updateTabHeader();
  }

  _render() {
    if (!this._pane) return;
    this._pane.empty();
    this._updateTitle();
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this._pane.createDiv({ cls: 'pane-empty', text: t('plugins.backlinks.label-no-backlinks') || 'No backlinks found.' });
      return;
    }
    this._renderResults(file);
  }

  // Search filter lives in the tab title bar (view actions), like the original.
  _fillViewActions(actions) {
    actions.empty();
    const btn = actions.createDiv('clickable-icon backlink-filter-button');
    setIcon(btn, 'search');
    btn.setAttr('aria-label', t('plugins.backlinks.label-show-search') || 'Show search filter');
    btn.toggleClass('is-active', this._showSearch);
    btn.onclick = () => {
      this._showSearch = !this._showSearch;
      this._render();
      this._fillViewActions(actions);
    };
    if (this._showSearch) {
      const container = actions.createDiv('search-input-container backlink-search-input-container');
      const input = container.createEl('input', { type: 'search', cls: 'backlink-search-input' });
      input.value = this._query;
      input.placeholder = t('interface.search') || 'Search...';
      input.oninput = () => { this._query = input.value; this._render(); };
      setTimeout(() => input.focus(), 0);
    }
  }

  _section(pane, labelText, count, collapsed, onToggle) {
    const header = pane.createDiv('tree-item-self is-clickable backlink-pane-header');
    const iconSpan = header.createSpan('tree-item-icon collapse-icon');
    setIcon(iconSpan, 'right-triangle');
    iconSpan.toggleClass('is-collapsed', collapsed);
    header.createDiv({ cls: 'tree-item-inner', text: labelText });
    const flairOuter = header.createDiv('tree-item-flair-outer');
    flairOuter.createSpan({ cls: 'tree-item-flair', text: String(count) });
    header.onclick = () => onToggle(!collapsed);
    return header;
  }

  _renderResults(file) {
    const pane = this._pane;
    const q = this._query.toLowerCase();
    const data = this.app.metadataCache.getBacklinksForFile(file);
    const entries = Object.entries(data.backlinks).filter(([path]) => !q || path.toLowerCase().includes(q));
    const total = entries.reduce((a, [, info]) => a + (info.count || 0), 0);

    // linked mentions: header + search-result-container as siblings (original DOM)
    this._section(pane, t('plugins.backlinks.label-linked-mentions') || 'Linked mentions', total, this._backlinkCollapsed, (c) => {
      this._backlinkCollapsed = c;
      this._render();
    });
    const linkedDom = pane.createDiv('search-result-container');
    if (this._backlinkCollapsed) linkedDom.hide();
    if (!entries.length) {
      linkedDom.createDiv({ cls: 'pane-empty', text: t('plugins.backlinks.label-no-backlinks') || 'No backlinks found.' });
    } else {
      for (const [path, info] of entries) {
        this._renderBacklinkFile(linkedDom, path, info.count);
      }
    }

    // unlinked mentions
    const unlinked = this.app.metadataCache.getUnlinkedMentions(file).filter(({ file: f }) => !q || f.path.toLowerCase().includes(q));
    this._section(pane, t('plugins.backlinks.label-unlinked-mentions') || 'Unlinked mentions', unlinked.length, this._unlinkedCollapsed, (c) => {
      this._unlinkedCollapsed = c;
      this._render();
    });
    const unlinkedDom = pane.createDiv('search-result-container');
    if (this._unlinkedCollapsed) unlinkedDom.hide();
    if (!unlinked.length) {
      unlinkedDom.createDiv({ cls: 'pane-empty', text: t('plugins.backlinks.label-no-unlinked-mentions') || 'No unlinked mentions found.' });
    } else {
      for (const { file: source, name } of unlinked.slice(0, 50)) {
        const contexts = findContextsByName(this.app, source, name);
        const item = unlinkedDom.createDiv('tree-item search-result');
        const selfEl = item.createDiv('tree-item-self search-result-file-title is-clickable');
        selfEl.createDiv({ cls: 'tree-item-inner', text: source.basename });
        selfEl.createDiv({ cls: 'tree-item-flair', text: String(contexts.length) });
        const matchList = item.createDiv('tree-item-children');
        for (const ctx of contexts.slice(0, 5)) {
          const match = matchList.createDiv('search-result-file-match');
          match.setText(ctx.text.slice(0, 300));
          highlightRange(match, ctx.start, ctx.end);
          match.onclick = () => this.app.workspace.openFile(source, { eState: { line: ctx.line } });
          const linkBtn = match.createEl('button', { cls: 'backlink-unlinked-link-button', text: t('plugins.backlinks.label-link-button-text') || 'Link' });
          linkBtn.onclick = async (ev) => {
            ev.stopPropagation();
            const text = await this.app.vault.read(source);
            const lines = text.split('\n');
            lines[ctx.line] = lines[ctx.line].slice(0, ctx.start) + '[[' + file.basename + ']]' + lines[ctx.line].slice(ctx.end);
            await this.app.vault.modify(source, lines.join('\n'));
            this._render();
          };
        }
        selfEl.onclick = () => this.app.workspace.openFile(source, { eState: { line: contexts[0] ? contexts[0].line : 0 } });
      }
    }
  }

  _renderBacklinkFile(container, path, count) {
    const source = this.app.vault.getAbstractFileByPath(path);
    if (!source) return;
    const current = this.app.workspace.getActiveFile();
    const item = container.createDiv('tree-item search-result');
    const self = item.createDiv('tree-item-self search-result-file-title is-clickable');
    const icon = self.createSpan('tree-item-icon collapse-icon');
    setIcon(icon, 'right-triangle');
    self.createDiv({ cls: 'tree-item-inner', text: source.basename });
    self.createDiv({ cls: 'tree-item-flair', text: String(count) });
    const children = item.createDiv('tree-item-children');
    icon.onclick = (ev) => {
      ev.stopPropagation();
      const c = item.toggleClass('is-collapsed');
      icon.toggleClass('is-collapsed', c);
      children.toggle(!c);
    };
    self.onclick = () => this.app.workspace.openFile(source);
    const contexts = current ? findLinkContexts(this.app, source, current) : [];
    const q = this._query.toLowerCase();
    const filtered = q ? contexts.filter((c) => c.text.toLowerCase().includes(q)) : contexts;
    for (const ctx of filtered.slice(0, 30)) {
      const match = children.createDiv('search-result-file-match');
      match.setText(ctx.text.slice(0, 400));
      highlightRange(match, ctx.matchStart, ctx.matchEnd);
      match.onclick = () => {
        this.app.workspace.openFile(source, { eState: { line: ctx.line } });
      };
    }
    if (!filtered.length) {
      children.createDiv({ cls: 'search-result-file-match', text: t('plugins.backlinks.ellipsis') || '...' });
    }
  }
  onPaneMenu(menu, source) {
    menu.addItem((i) => i.setTitle(t('plugins.backlinks.label-linked-mentions') || 'Linked mentions').setChecked(true));
  }
}

function highlightRange(el, start, end) {
  const text = el.textContent;
  el.empty();
  el.appendText(text.slice(0, start));
  el.createSpan({ cls: 'search-result-file-matched-text', text: text.slice(start, end) });
  el.appendText(text.slice(end));
}

function findContextsByName(app, sourceFile, name) {
  const cache = app.metadataCache.getFileCache(sourceFile);
  const text = (cache && cache._rawText) || '';
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let idx = lines[i].indexOf(name);
    while (idx >= 0) {
      out.push({ line: i, text: lines[i], start: idx, end: idx + name.length });
      idx = lines[i].indexOf(name, idx + name.length);
      if (out.length > 50) break;
    }
    if (out.length > 50) break;
  }
  return out;
}

export function create(app) {
  return {
    onload() {
      app.viewRegistry.registerView('backlink', (leaf) => new BacklinkView(leaf));
      app.commands.addCommand({
        id: 'backlink:open',
        name: t('plugins.backlinks.action-open') || 'Open backlinks',
        callback: () => app.workspace.ensureSideLeaf('backlink', 'right', { reveal: true }),
      });
      app.commands.addCommand({
        id: 'backlink:open-backlinks',
        name: t('plugins.backlinks.action-open-for-current') || 'Open backlinks for the current note',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) app.workspace.ensureSideLeaf('backlink', 'right', { reveal: true });
          return true;
        },
      });
      app.commands.addCommand({
        id: 'backlink:toggle-backlinks-in-document',
        name: t('plugins.backlinks.action-toggle-backlinks-in-document') || 'Toggle backlinks in document',
        checkCallback: (checking) => {
          const file = app.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) app.workspace.ensureSideLeaf('backlink', 'right', { reveal: true });
          return true;
        },
      });
    },
    onunload() {
      app.viewRegistry.unregisterView('backlink');
    },
    deregister(app) {
      app.viewRegistry.unregisterView('backlink');
    },
  };
}
