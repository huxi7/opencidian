/**
 * [INPUT]: View 生命周期、workspace 当前文件、metadataCache 反链索引与 DOM 图标。
 * [OUTPUT]: 导出 BacklinkView、findLinkContexts 与插件 create。
 * [POS]: 右栏反链视图。复用搜索结果结构，关闭时释放订阅与重绘计时器。
 *        链接文件行与未链接提及行右键弹原版链接菜单（workspace.buildLinkMenu + handleLinkContextMenu）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';

export const nameKey = 'plugins.backlinks';

/**
 * 原版搜索/反链条目共用：右键挂链接菜单（分节表 title/open/action/view/info/info.copy/danger）。
 * linktext 用来源文件路径，sourcePath 用当前笔记路径，重命名等动作才能命中同一文件。
 */
function attachLinkRowMenu(app, el, sourceFile, currentFile) {
  el.addEventListener('contextmenu', (ev) => {
    const menu = app.workspace.buildLinkMenu();
    const ok = app.workspace.handleLinkContextMenu(menu, sourceFile.path, currentFile ? currentFile.path : '', ev);
    if (!ok) return;
    ev.preventDefault();
    menu.setParentElement(el).showAtMouseEvent(ev);
  });
}

// --- 从来源正文提取指向目标文件的链接上下文 ---
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
    this._unlinkedCollapsed = true;
    this._pending = null;
    this._filePath = null;
    this._collapsedFiles = new Set();
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
    this.contentEl.empty();
    this._header = this.contentEl.createDiv('nav-header');
    this._renderHeader();
    this._pane = this.contentEl.createDiv('backlink-pane');
    this._render();
    this._refs = [
      this.app.workspace.on('active-leaf-change', () => this._render()),
      this.app.workspace.on('file-open', () => this._render()),
      this.app.metadataCache.on('changed', () => this._queueRender()),
      this.app.metadataCache.on('resolved', () => this._queueRender()),
      this.app.workspace.on('layout-change', () => this._updateTitle()),
    ];
  }
  onClose() {
    for (const r of this._refs) r.unregister && r.unregister();
    this._refs = [];
    clearTimeout(this._pending);
    this._pending = null;
    this._pane = null;
    this._header = null;
    this._collapsedFiles.clear();
  }
  _queueRender() {
    if (!this._pane || this._pending !== null) return;
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
    if (this._filePath !== (file?.path || null)) {
      this._filePath = file?.path || null;
      this._collapsedFiles.clear();
    }
    if (!file) {
      this._pane.createDiv({ cls: 'search-empty-state', text: t('plugins.backlinks.label-no-backlinks') || 'No backlinks found.' });
      return;
    }
    this._renderResults(file);
  }

  // --- 原版筛选框位于面板导航栏，不放进标签标题操作区 ---
  _renderHeader() {
    const header = this._header;
    if (!header) return;
    header.empty();
    const actions = header.createDiv('nav-buttons-container');
    const btn = actions.createDiv('clickable-icon backlink-filter-button');
    setIcon(btn, 'search');
    btn.setAttr('aria-label', t('plugins.backlinks.label-show-search') || 'Show search filter');
    btn.toggleClass('is-active', this._showSearch);
    btn.onclick = () => {
      this._showSearch = !this._showSearch;
      this._render();
      this._renderHeader();
      this._header?.querySelector('input')?.focus();
    };
    if (this._showSearch) {
      const container = header.createDiv('search-input-container backlink-search-input-container');
      const input = container.createEl('input', { type: 'search', cls: 'backlink-search-input' });
      input.value = this._query;
      input.placeholder = t('plugins.search.prompt-start-search');
      input.oninput = () => { this._query = input.value; this._render(); };
    }
  }

  _section(pane, labelText, count, collapsed, onToggle) {
    const header = pane.createDiv('tree-item-self is-clickable backlink-pane-header');
    header.toggleClass('is-collapsed', collapsed);
    header.setAttr('aria-expanded', String(!collapsed));
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

    // --- 分节标题与搜索结果容器保持同级 ---
    this._section(pane, t('plugins.backlinks.label-linked-mentions') || 'Linked mentions', total, this._backlinkCollapsed, (c) => {
      this._backlinkCollapsed = c;
      this._render();
    });
    const linkedDom = pane.createDiv('search-result-container');
    if (this._backlinkCollapsed) linkedDom.hide();
    if (!entries.length) {
      linkedDom.createDiv({ cls: 'search-empty-state', text: t('plugins.backlinks.label-no-backlinks') || 'No backlinks found.' });
    } else {
      for (const [path, info] of entries) {
        this._renderBacklinkFile(linkedDom, path, info.count);
      }
    }

    // --- 未链接提及默认收起 ---
    const unlinked = this.app.metadataCache.getUnlinkedMentions(file).filter(({ file: f }) => f && (!q || f.path.toLowerCase().includes(q)));
    this._section(pane, t('plugins.backlinks.label-unlinked-mentions') || 'Unlinked mentions', unlinked.length, this._unlinkedCollapsed, (c) => {
      this._unlinkedCollapsed = c;
      this._render();
    });
    const unlinkedDom = pane.createDiv('search-result-container');
    if (this._unlinkedCollapsed) unlinkedDom.hide();
    if (!unlinked.length) {
      unlinkedDom.createDiv({ cls: 'search-empty-state', text: t('plugins.backlinks.label-no-unlinked-mentions') || 'No unlinked mentions found.' });
    } else {
      for (const { file: source, name } of unlinked.slice(0, 50)) {
        const contexts = findContextsByName(this.app, source, name);
        const item = unlinkedDom.createDiv('tree-item search-result');
        const selfEl = item.createDiv('tree-item-self search-result-file-title is-clickable');
        selfEl.createDiv({ cls: 'tree-item-inner', text: source.basename });
        selfEl.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(contexts.length) });
        const matchList = item.createDiv('search-result-file-matches');
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
        attachLinkRowMenu(this.app, selfEl, source, file);
      }
    }
  }

  _renderBacklinkFile(container, path, count) {
    const source = this.app.vault.getAbstractFileByPath(path);
    if (!source) return;
    const current = this.app.workspace.getActiveFile();
    const item = container.createDiv('tree-item search-result');
    item.setAttr('data-path', path);
    const self = item.createDiv('tree-item-self search-result-file-title is-clickable mod-collapsible');
    const icon = self.createSpan('tree-item-icon collapse-icon');
    setIcon(icon, 'right-triangle');
    self.createDiv({ cls: 'tree-item-inner', text: source.basename });
    self.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(count) });
    const children = item.createDiv('search-result-file-matches');
    const setCollapsed = (collapsed) => {
      item.toggleClass('is-collapsed', collapsed);
      icon.toggleClass('is-collapsed', collapsed);
      self.setAttr('aria-expanded', String(!collapsed));
      children.toggle(!collapsed);
      if (collapsed) this._collapsedFiles.add(path);
      else this._collapsedFiles.delete(path);
    };
    setCollapsed(this._collapsedFiles.has(path));
    icon.onclick = (ev) => {
      ev.stopPropagation();
      setCollapsed(!item.hasClass('is-collapsed'));
    };
    self.onclick = () => this.app.workspace.openFile(source);
    attachLinkRowMenu(this.app, self, source, current);
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
