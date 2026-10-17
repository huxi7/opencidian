/**
 * [INPUT]: View 生命周期、workspace 当前文件、metadataCache 的 links/embeds/headings/blocks 与 DOM 图标。
 * [OUTPUT]: 导出 OutgoingLinkView 与插件 create(app)（命令 outgoing-links:open / outgoing-links:open-for-current）。
 * [POS]: plugins-core/ 的出链面板（右栏视图 type outgoing-link）。逐条列出当前文件的已解析与未解析出链，
 *        点击打开目标；关闭时释放订阅与计时器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: outgoing-link — the "Outgoing links" sidebar pane. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { IS_MAC } from '../core/keymap.js';

export const nameKey = 'plugins.outgoing-links';

export const OUTGOING_LINK_VIEW_TYPE = 'outgoing-link';

// 原版 AT()：标题比较前去掉标点与空白。
const HEADING_NOISE_RE = /[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g;

function headingKey(text) {
  return String(text || '').replace(HEADING_NOISE_RE, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 原版 Ng.isModEvent：macOS 用 Meta，其余平台用 Ctrl。 */
function isModEvent(ev) {
  return IS_MAC ? !!ev.metaKey : !!ev.ctrlKey;
}

export class OutgoingLinkView extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'links-going-out';
    this.navigation = true;
    this._refs = [];
    this._pending = null;
    this._pane = null;
    this._linksCollapsed = false;
    this._unlinkedCollapsed = true;
  }
  getViewType() { return OUTGOING_LINK_VIEW_TYPE; }
  getIcon() { return 'links-going-out'; }
  getDisplayText() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return t('plugins.outgoing-links.name') || 'Outgoing links';
    return t('plugins.outgoing-links.tab-title', { displayText: file.basename });
  }
  getState() { return { linksCollapsed: this._linksCollapsed, unlinkedCollapsed: this._unlinkedCollapsed }; }

  async setState(state) {
    if (state && typeof state.linksCollapsed === 'boolean') this._linksCollapsed = state.linksCollapsed;
    if (state && typeof state.unlinkedCollapsed === 'boolean') this._unlinkedCollapsed = state.unlinkedCollapsed;
    this._render();
  }

  async onOpen() {
    this.contentEl.addClass('outgoing-link-view');
    this._pane = this.contentEl.createDiv('outgoing-link-pane');
    this._render();
    this._refs = [
      this.app.workspace.on('active-leaf-change', () => this._render()),
      this.app.workspace.on('file-open', () => this._render()),
      this.app.metadataCache.on('changed', (file) => {
        const active = this.app.workspace.getActiveFile();
        if (file && active && file.path === active.path) this._queueRender();
      }),
      this.app.metadataCache.on('resolved', () => this._queueRender()),
    ];
  }

  onClose() {
    for (const ref of this._refs) ref.unregister && ref.unregister();
    this._refs = [];
    clearTimeout(this._pending);
    this._pending = null;
    this._pane = null;
  }

  _queueRender() {
    if (!this._pane || this._pending !== null) return;
    this._pending = setTimeout(() => { this._pending = null; this._render(); }, 120);
  }

  // --- 收集：links + embeds 按位置排序，dest.path/未解析路径 + subpath 去重 ---
  _collectEntries(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return [];
    const links = [...(cache.links || []), ...(cache.embeds || [])]
      .filter((entry) => entry && !entry.isExternal);
    links.sort((a, b) => (a.position?.start?.offset ?? 0) - (b.position?.start?.offset ?? 0));
    const entries = [];
    const seen = new Set();
    for (const link of links) {
      const linkpath = link.link || '';
      const subpath = link.subpath || '';
      const destPath = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
      const dest = destPath ? this.app.vault.getFileByPath(destPath) : null;
      const key = (dest ? dest.path : linkpath.replace(/\.md$/i, '')) + (subpath ? '#' + subpath : '');
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        linkpath,
        subpath,
        dest,
        linktext: linkpath + (subpath ? '#' + subpath : ''),
      });
    }
    return entries;
  }

  /** 原版 IT()：把子路径解析为标题或块，供条目显示与图标选择。 */
  _resolveSubpath(file, subpath) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !subpath) return null;
    const parts = String(subpath).split('#').filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1 && parts[0].startsWith('^')) {
      const wanted = parts[0].slice(1).toLowerCase();
      const blocks = cache.blocks || {};
      for (const id of Object.keys(blocks)) {
        if (id.toLowerCase() === wanted) return { type: 'block', id: blocks[id].id };
      }
      return null;
    }
    const headings = cache.headings || [];
    if (!headings.length) return null;
    let index = 0;
    let level = 0;
    let current = null;
    for (const heading of headings) {
      if (current && heading.level <= level) break;
      if (!current && heading.level > level && headingKey(heading.heading) === headingKey(parts[index])) {
        index += 1;
        level = heading.level;
        if (index === parts.length) current = heading;
      }
    }
    return current ? { type: 'heading', heading: current.heading } : null;
  }

  _render() {
    const pane = this._pane;
    if (!pane) return;
    if (this.leaf) this.leaf.updateTabHeader();
    pane.empty();
    const file = this.app.workspace.getActiveFile();
    const entries = file ? this._collectEntries(file) : [];

    const header = pane.createDiv({ cls: 'tree-item-self is-clickable outgoing-links-header' });
    const collapseIcon = header.createSpan('tree-item-icon collapse-icon');
    setIcon(collapseIcon, 'right-triangle');
    collapseIcon.toggleClass('is-collapsed', this._linksCollapsed);
    header.createDiv({ cls: 'tree-item-inner', text: t('plugins.outgoing-links.label-links') || 'Links' });
    header.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(entries.length) });
    header.toggleClass('is-collapsed', this._linksCollapsed);
    header.setAttr('aria-expanded', String(!this._linksCollapsed));
    header.setAttr('aria-label', this._linksCollapsed
      ? (t('interface.tooltip.click-to-expand') || 'Click to expand')
      : (t('interface.tooltip.click-to-collapse') || 'Click to collapse'));
    header.onclick = () => {
      this._linksCollapsed = !this._linksCollapsed;
      this._render();
    };

    const list = pane.createDiv('search-result-container');
    if (this._linksCollapsed) list.hide();
    if (!entries.length) {
      list.createDiv({ cls: 'pane-empty', text: t('plugins.outgoing-links.label-no-links') || 'No links found.' });
    } else {
      for (const entry of entries) this._renderItem(list, file.path, entry);
    }
    if (file) this._renderUnlinked(pane, file);
  }

  /** 原版出链面板同样包含 Unlinked mentions 分节（与反链面板共用组件）：上下文 + Link 按钮。 */
  _renderUnlinked(pane, file) {
    const unlinked = (this.app.metadataCache.getUnlinkedMentions(file) || []).slice(0, 50);
    const header = pane.createDiv({ cls: 'tree-item-self is-clickable outgoing-links-header' });
    const collapseIcon = header.createSpan('tree-item-icon collapse-icon');
    setIcon(collapseIcon, 'right-triangle');
    collapseIcon.toggleClass('is-collapsed', this._unlinkedCollapsed);
    header.createDiv({ cls: 'tree-item-inner', text: t('plugins.backlinks.label-unlinked-mentions') || 'Unlinked mentions' });
    header.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(unlinked.length) });
    header.toggleClass('is-collapsed', this._unlinkedCollapsed);
    header.onclick = () => {
      this._unlinkedCollapsed = !this._unlinkedCollapsed;
      this._render();
    };
    const list = pane.createDiv('search-result-container');
    if (this._unlinkedCollapsed) list.hide();
    if (!unlinked.length) {
      list.createDiv({ cls: 'pane-empty', text: t('plugins.backlinks.label-no-unlinked-mentions') || 'No unlinked mentions found.' });
      return;
    }
    for (const entry of unlinked) {
      const source = entry.file;
      if (!source) continue;
      const contexts = findUnlinkedContexts(this.app, source, entry.name);
      const item = list.createDiv('tree-item search-result');
      const selfEl = item.createDiv('tree-item-self search-result-file-title is-clickable');
      selfEl.createDiv({ cls: 'tree-item-inner', text: source.basename });
      selfEl.createDiv('tree-item-flair-outer').createSpan({ cls: 'tree-item-flair', text: String(contexts.length) });
      const matchList = item.createDiv('search-result-file-matches');
      for (const ctx of contexts.slice(0, 5)) {
        const match = matchList.createDiv('search-result-file-match');
        match.setText(ctx.text.slice(0, 300));
        const linkBtn = match.createEl('button', {
          cls: 'backlink-unlinked-link-button',
          text: t('plugins.backlinks.label-link-button-text') || 'Link',
        });
        linkBtn.onclick = async (ev) => {
          ev.stopPropagation();
          const text = await this.app.vault.read(source);
          const lines = text.split('\n');
          lines[ctx.line] = lines[ctx.line].slice(0, ctx.start) + '[[' + file.basename + ']]' + lines[ctx.line].slice(ctx.end);
          await this.app.vault.modify(source, lines.join('\n'));
          this._render();
        };
        match.onclick = () => this.app.workspace.openFile(source, { eState: { line: ctx.line } });
      }
      selfEl.onclick = () => this.app.workspace.openFile(source, { eState: { line: contexts[0] ? contexts[0].line : 0 } });
    }
  }

  // --- 原版 a7()：图标按 标题/块/文件/未解析 变化，副文本显示链接路径或目标文件夹 ---
  _renderItem(container, sourcePath, entry) {
    const row = container.createDiv({ cls: 'tree-item-self is-clickable outgoing-link-item' });
    const iconEl = row.createSpan('tree-item-icon');
    let icon = 'link';
    let label = entry.linkpath || entry.subpath;
    let subtext = '';
    if (entry.dest) {
      if (entry.subpath) {
        const target = this._resolveSubpath(entry.dest, entry.subpath);
        subtext = label;
        if (target && target.type === 'heading') { icon = 'heading-glyph'; label = target.heading; }
        else if (target && target.type === 'block') { icon = 'layout-list'; label = target.id; }
        else { icon = 'file-question'; label = '#' + entry.subpath; }
      } else if (entry.dest.parent && entry.dest.parent.path !== '/') {
        subtext = entry.dest.parent.path;
      }
    } else {
      icon = 'file-plus';
      row.addClass('is-unresolved');
      row.setAttr('aria-label', t('plugins.outgoing-links.tooltip-not-created') || 'Not created yet');
    }
    setIcon(iconEl, icon);
    const inner = row.createDiv('tree-item-inner');
    inner.createDiv({ cls: 'tree-item-inner-text', text: label });
    if (subtext) inner.createDiv({ cls: 'tree-item-inner-subtext', text: subtext });
    row.onclick = (ev) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      this.app.workspace.openLinkText(entry.linktext, sourcePath, isModEvent(ev));
    };
  }
}

/** 在源文件中查找 name 的未链接提及上下文（原版 findContextsByName 同构）。 */
function findUnlinkedContexts(app, source, name) {
  const cache = app.metadataCache.getFileCache(source);
  const text = (cache && cache._rawText) || '';
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length && out.length <= 50; i++) {
    let idx = lines[i].indexOf(name);
    while (idx >= 0) {
      out.push({ line: i, text: lines[i], start: idx, end: idx + name.length });
      idx = lines[i].indexOf(name, idx + name.length);
      if (out.length > 50) break;
    }
  }
  return out;
}

export function create(app) {
  const commandIds = ['outgoing-links:open', 'outgoing-links:open-for-current'];
  const teardown = () => {
    for (const id of commandIds) app.commands.removeCommand(id);
    for (const leaf of app.workspace.getLeavesOfType(OUTGOING_LINK_VIEW_TYPE)) leaf.detach();
    app.viewRegistry.unregisterView(OUTGOING_LINK_VIEW_TYPE);
  };
  return {
    onload() {
      app.viewRegistry.registerView(OUTGOING_LINK_VIEW_TYPE, (leaf) => new OutgoingLinkView(leaf));
      app.commands.addCommand({
        id: 'outgoing-links:open',
        name: t('plugins.outgoing-links.action-show') || 'Show outgoing links',
        icon: 'link',
        callback: () => { app.workspace.ensureSideLeaf(OUTGOING_LINK_VIEW_TYPE, 'right', { reveal: true }); },
      });
      app.commands.addCommand({
        id: 'outgoing-links:open-for-current',
        name: t('plugins.outgoing-links.action-open-for-current') || 'Open outgoing links for the current file',
        icon: 'link',
        checkCallback: (checking) => {
          if (!app.workspace.getActiveFile()) return false;
          if (!checking) app.workspace.ensureSideLeaf(OUTGOING_LINK_VIEW_TYPE, 'right', { reveal: true });
          return true;
        },
      });
    },
    onunload() { teardown(); },
    deregister() { teardown(); },
  };
}
