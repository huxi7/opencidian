/**
 * [INPUT]: 依赖 ../core/view.js 的 View 基类；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/keymap.js 的 IS_MAC；依赖 ../editor/editor.js 的 Editor 与 livePreviewExtension；依赖 ../markdown/reading.js 的 renderMarkdown/attachMarkdownInteractions；依赖 ../markdown/properties.js 的 renderProperties；依赖 BacklinkView 的文件绑定结果与 file-view-actions 的共用文件动作
 * [OUTPUT]: 导出 MarkdownView 类（三模式：source/live/preview），registerView 注册 'markdown'
 * [POS]: views/ 的 Markdown 生命周期入口。行内标题挂在编辑器 .cm-sizer 内；行宽 class 挂视图元素。换文件前保存正文；首次加载与布局恢复均同步模式 DOM；设置事件热重配编辑器。阅读正文交给 markdown/ 渲染；底部反链复用 BacklinkView 并绑定当前文件。重命名/换文件后由 _updateTitles 回填视图头标题与面包屑。视图头模式钮按原版 1.14.4：图标表示「点它会切到哪个视图」（编辑视图 lucide-book-open / 阅读视图 lucide-edit-3），aria-label 三行（状态句 + 动作句 + ⌘+单击在新标签页打开），模式切换后随 _applyMode 立即换图标与文案。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * MarkdownView — source / live-preview / reading modes for .md files.
 * DOM follows the original: .markdown-source-view.mod-cm6 and
 * .markdown-reading-view > .markdown-preview-view.markdown-rendered.
 */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';
import { Editor } from '../editor/editor.js';
import {
  renderMarkdown, attachMarkdownInteractions, scrollToSubpath, stripFrontmatter,
} from '../markdown/reading.js';
import { renderProperties } from '../markdown/properties.js';
import { Notice } from '../core/notices.js';
import { normalizePath } from '../core/vault.js';
import { BacklinkView } from '../plugins-core/backlink.js';
import { addDefaultAppAction } from '../core/file-view-actions.js';
import { IS_MAC } from '../core/keymap.js';
import { PromptModal } from '../core/modals.js';
import { showEditorContextMenu } from '../editor/editor-menu.js';

const SAVE_DELAY = 150;

export class MarkdownView extends View {
  constructor(leaf) {
    super(leaf);
    this.file = null;
    this.mode = 'live';         // 'source' | 'live' | 'preview'
    this._lastEditMode = 'live';
    this.editor = null;
    this.navigation = true;
    this.icon = 'file-text';
    this._suppressChange = false;
    this._renderedText = null;
    this._saveTimer = null;
    this._pendingScroll = null;
    this.showBacklinks = !!this.app.workspace.backlinkInDocument;
  }

  getViewType() { return 'markdown'; }
  getIcon() { return 'file-text'; }
  getDisplayText() { return this.file ? this.file.basename : (this.getState().file || 'Untitled'); }
  getMode() { return this.mode; }

  getState() {
    const state = { file: this.file ? this.file.path : undefined, mode: this.mode, backlinks: this.showBacklinks };
    if (this.mode !== 'preview') state.mode = this.mode;
    if (this.editor && this.mode !== 'preview') {
      state.scroll = this.editor.getScrollInfo().top;
    }
    return state;
  }

  getEphemeralState() {
    return { ...(this._eState || {}) };
  }

  setEphemeralState(state) {
    this._eState = state || {};
    if (state && state.subpath) this._pendingScroll = { subpath: state.subpath };
    if (state && state.line !== undefined) this._pendingScroll = { line: state.line, ch: state.ch || 0 };
    this._applyPendingScroll();
  }

  async setState(state, result) {
    state = state || {};
    if (typeof state.backlinks === 'boolean') this.showBacklinks = state.backlinks;
    if (state.mode === 'preview') this.mode = 'preview';
    else if (state.mode === 'source' || state.mode === 'live') { this.mode = state.mode; this._lastEditMode = state.mode; }
    if (state.file && (!this.file || this.file.path !== state.file)) {
      await this._loadFile(state.file, state);
    }
    this._applyMode();
    if (state.scroll !== undefined && this.editor) {
      this.editor.applyScrollInfo({ top: state.scroll });
    }
    if (state.subpath) this._pendingScroll = { subpath: state.subpath };
    if (state.line !== undefined) this._pendingScroll = { line: state.line, ch: state.ch || 0 };
    this._applyPendingScroll();
  }

  async onOpen() {
    const contentEl = this.contentEl;
    contentEl.addClass('markdown-view');

    // ---- editing DOM (source / live preview)
    this.sourceEl = contentEl.createDiv('markdown-source-view mod-cm6');
    this.inlineTitleEdit = this.sourceEl.createDiv('inline-title');
    this.inlineTitleEdit.setAttr('contenteditable', 'true');
    this.inlineTitleEdit.setAttr('spellcheck', 'false');
    if (this.app.settings.appSettings.showInlineTitle === false) this.inlineTitleEdit.addClass('is-hidden');

    const editorHost = this.sourceEl.createDiv('cm-editor-host');
    this.editor = new Editor(editorHost, this.app, { doc: '' });
    this.editor.cm.dom.setAttr('data-editor-mode', 'source');
    // 原版：行内标题是 .cm-sizer 的子元素，随内容滚动、与正文同宽居中
    this.editor.sizerEl.prepend(this.inlineTitleEdit);
    this.editor.onChange(() => this._onEditorChange());
    // 原版 editor-selection-change：状态栏（字数/视图状态）据此刷新选区统计
    this.editor.onSelectionChange(() => this.app.workspace.trigger('editor-selection-change', this));
    this._bindEditorKeys();
    this._bindInlineTitle();
    // 原版 onContextMenu：编辑器右键菜单（属性行等组件已 preventDefault 的不再重复弹出）
    // 真实右键的 mousedown 会把 CM 选区折叠/移走；在捕获阶段记住按下前的选区，contextmenu 时若落点在选区内则恢复。
    let rightPress = null;
    this.editor.cm.dom.addEventListener('mousedown', (ev) => {
      // macOS 的 Ctrl+Click 是副键点击，DOM 里 button 仍为 0
      const secondary = ev.button === 2 || (navigator.platform.startsWith('Mac') && ev.ctrlKey && ev.button === 0);
      if (!secondary) return;
      const sel = this.editor.cm.state.selection.main;
      rightPress = sel.empty ? null : { from: sel.from, to: sel.to };
    }, true);
    this.editor.cm.dom.addEventListener('contextmenu', (ev) => {
      if (ev.defaultPrevented) return;
      if (rightPress) {
        const pos = this.editor.cm.posAtCoords({ x: ev.clientX, y: ev.clientY });
        if (pos != null && pos >= rightPress.from && pos <= rightPress.to) {
          this.editor.cm.dispatch({ selection: { anchor: rightPress.from, head: rightPress.to } });
        }
      }
      rightPress = null;
      showEditorContextMenu(this.app, this.editor, this, ev);
    });

    // ---- reading DOM
    this.readingEl = contentEl.createDiv('markdown-reading-view');
    this.readingSizer = this.readingEl.createDiv('markdown-preview-view markdown-rendered');
    this.readingContent = this.readingSizer.createDiv('markdown-preview-sizer markdown-preview-section');
    this.readingTitle = this.readingContent.createDiv('inline-title');
    this.propertiesReadingEl = this.readingContent.createDiv('metadata-container-host');
    this.renderedContent = this.readingContent.createDiv('markdown-content');
    this.backlinksEl = contentEl.createDiv('embedded-backlinks');
    attachMarkdownInteractions(this.app, this.readingEl, () => (this.file ? this.file.path : ''));

    // react to external changes/renames
    this._refs = [
      this.app.vault.on('modify', (file) => { if (this.file && file.path === this.file.path) this._onExternalModify(); }),
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.file && oldPath === this.file.path) { this.file = file; this._updateTitles(); }
      }),
      this.app.vault.on('delete', (file) => {
        if (this.file && file.path === this.file.path) { this._fileDeleted = true; this._renderFilePathMissing(); }
      }),
      // 设置变化即时生效：行号 / 实时预览 / 阅读渲染（strictLineBreaks 等）
      this.app.workspace.on('settings-changed', () => this._applyEditorSettings()),
    ];

    this._applyReadableLineLength();
    this._applyMode();
  }

  /** 原版 updateReadableLineLength：class 挂视图元素（源码视图 / 阅读视图）。 */
  _applyReadableLineLength() {
    const on = this.app.settings.appSettings.readableLineLength !== false;
    if (this.sourceEl) this.sourceEl.toggleClass('is-readable-line-width', on);
    if (this.readingSizer) this.readingSizer.toggleClass('is-readable-line-width', on);
  }

  /** 编辑器级设置变化后重配置 CM 扩展；阅读视图重渲染。 */
  _applyEditorSettings() {
    this._applyReadableLineLength();
    const s = this.app.settings.appSettings;
    if (!this.editor) return;
    this.editor.toggleLineNumbers(s.showLineNumber === true);
    this.editor.setIndentUnit();
    this.editor.setCloseBrackets(s.autoPairBrackets !== false);
    this.editor.setSpellcheck(s.spellcheck === true);
    this.editor.setFolding(s.foldHeading !== false, s.foldIndent !== false);
    this._applyMode();
  }

  async onClose() {
    for (const ref of this._refs || []) ref.unregister();
    this._refs = [];
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    await this.save();
    this.backlinks?.onClose();
    this.backlinks = null;
    if (this.editor) this.editor.destroy();
  }

  onResize() {
    if (this.editor) this.editor.refresh();
  }

  // -------------------------------------------------------------------------
  // File loading & saving
  // -------------------------------------------------------------------------
  async _loadFile(path, state) {
    if (this.file && !this._fileDeleted) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      await this.save();
    }
    const file = this.app.vault.getFileByPath(path) || this.app.vault.getAbstractFileByPath(path);
    if (!file || !file.path || file.extension !== 'md') {
      this.file = null;
      this._renderFilePathMissing(path);
      return;
    }
    this.file = file;
    this._fileDeleted = false;
    if (!this.contentEl.contains(this.sourceEl)) {
      this.contentEl.empty();
      this.contentEl.append(this.sourceEl, this.readingEl);
    }
    let text = '';
    try { text = await this.app.vault.cachedRead(file); } catch (e) { console.error(e); }
    this._loadedText = text;
    this._suppressChange = true;
    this.editor.sourcePath = file.path;
    this.editor.setValue(text);
    this._suppressChange = false;
    this._renderedText = null;
    this._updateTitles();
    this._renderProperties();
    this.app.workspace.trigger('markdown-view-file-loaded', this.file, this);
    this._emitEditorChange();
  }

  _renderFilePathMissing(path) {
    if (this.leaf?.contentEl) this.leaf.contentEl.setAttr('data-type', 'markdown');
    this.contentEl.empty();
    const msg = this.contentEl.createDiv('empty-state');
    msg.createDiv('empty-state-title', (el) => el.setText(this._fileDeleted ? 'File was deleted' : 'File not found'));
    if (path) msg.createDiv('empty-state-description', (el) => el.setText(path));
  }

  _onEditorChange() {
    if (this._suppressChange) return;
    if (!this.file) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.save(); }, SAVE_DELAY);
    this._renderedText = null;
    this._emitEditorChange();
  }

  _emitEditorChange() {
    this.app.workspace.trigger('editor-change', this.editor ? this.editor.getValue() : '', this);
  }

  async save() {
    if (!this.file || this._fileDeleted || !this.editor) return;
    const file = this.file;   // 写盘期间可能切文件：只更新仍在编辑的那份的 _loadedText
    const text = this.editor.getValue();
    if (text === this._loadedText) return;
    try {
      await this.app.vault.modify(file, text);
      if (this.file === file) this._loadedText = text;
    } catch (e) {
      console.error('Failed to save', e);
      new Notice('Failed to save file: ' + (e.message || e));
    }
  }

  async _onExternalModify() {
    if (!this.file || !this.editor) return;
    const path = this.file.path;   // 发起读取时的文件
    let text = '';
    try { text = await this.app.vault.cachedRead(this.file); } catch (e) { return; }
    // 读取期间切了文件 → 丢弃迟到内容，绝不打进另一个文件（跨文件内容损坏防线）
    if (!this.file || this.file.path !== path) return;
    // 与我们最后一次写盘/加载的内容一致 → 自家写入的迟到通知，绝不回滚正在编辑的文档
    if (text === this._loadedText) return;
    if (text === this.editor.getValue()) { this._loadedText = text; return; }
    // file changed on disk
    this._loadedText = text;
    const scroll = this.editor.getScrollInfo();
    const cursor = this.editor.getCursor();
    this._suppressChange = true;
    this.editor.setValue(text);
    this._suppressChange = false;
    try { this.editor.setCursor(cursor); this.editor.applyScrollInfo(scroll); } catch (e) {}
    this._renderedText = null;
    this._renderProperties();
    if (this.mode === 'preview') this._renderReading();
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------
  _applyMode() {
    const preview = this.mode === 'preview';
    const live = this.mode === 'live' && this.app.settings.appSettings.livePreview !== false;
    this.sourceEl.toggle(!preview);
    this.readingEl.toggle(preview);
    this.sourceEl.toggleClass('is-live-preview', live);
    this.sourceEl.toggleClass('is-source-mode', this.mode === 'source' || !live);
    this.editor.cm.dom.setAttr('data-editor-mode', this.mode);
    this.editor.setLivePreview(live);
    this._renderProperties();
    if (preview) {
      this._renderReading();
    } else {
      this.editor.refresh();
    }
    this.updateShowBacklinks();
    this._fillViewActions();
    this.app.workspace.trigger('markdown-view-mode-change', this);
    this.app.workspace.trigger('layout-change');
  }

  canToggleBacklinks() { return !!this.file && !!this.app.plugins.getInternalPlugin('backlink')?.enabled; }

  toggleBacklinks() {
    if (!this.canToggleBacklinks()) return;
    this.showBacklinks = !this.showBacklinks;
    this.updateShowBacklinks();
    this.app.workspace.trigger('layout-change');
  }

  updateShowBacklinks() {
    if (!this.backlinksEl) return;
    const visible = this.showBacklinks && this.canToggleBacklinks();
    this.backlinksEl.toggle(visible);
    if (!this.showBacklinks || !this.canToggleBacklinks()) {
      this.backlinks?.onClose(); this.backlinks = null;
      this.backlinksEl.empty();
      return;
    }
    const host = this.mode === 'preview' ? this.readingContent : this.editor.sizerEl;
    host.appendChild(this.backlinksEl);
    if (!this.backlinks) {
      this.backlinks = new BacklinkView(this.leaf);
      this.backlinks.ownerView = this;
      this.backlinks.contentEl = this.backlinksEl;
      this.backlinks.onOpen();
    } else this.backlinks._render();
  }

  toggleMode() {
    if (this.mode === 'preview') {
      this.mode = this._lastEditMode || 'live';
    } else {
      this._lastEditMode = this.mode;
      this.save();
      this.mode = 'preview';
    }
    this._applyMode();
  }

  toggleSourceLive() {
    if (this.mode === 'preview') { this.toggleMode(); return; }
    this.mode = this.mode === 'live' ? 'source' : 'live';
    this._lastEditMode = this.mode;
    this._applyMode();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  async _renderReading() {
    if (!this.file || !this.renderedContent) return;
    const text = this.editor ? this.editor.getValue() : '';
    this._renderedText = text;
    const body = stripFrontmatter(text);
    try {
      await renderMarkdown(this.app, body, this.renderedContent, this.file.path);
    } catch (e) {
      console.error('reading render failed', e);
      this.renderedContent.setText(body);
    }
    this._applyPendingScroll();
  }

  _renderProperties() {
    const settings = this.app.settings.appSettings;
    const mode = settings.propertiesInDocument || 'visible';
    const editable = this.mode !== 'preview' ? true : false;
    if (!this.file) return;
    // live preview: the properties widget renders inside the editor; the
    // container visibility is driven by the show-properties class
    if (this.sourceEl) this.sourceEl.toggleClass('show-properties', mode === 'visible');
    // reading view
    this.propertiesReadingEl.empty();
    if (mode === 'visible') {
      renderProperties(this.app, this.propertiesReadingEl, this.file, { editable: false, showAddButton: false });
    } else if (mode === 'hidden') {
      // nothing
    } else if (mode === 'source') {
      // raw frontmatter handled by reading renderer (kept in content)
    }
  }

  _applyPendingScroll() {
    if (!this._pendingScroll) return;
    const pending = this._pendingScroll;
    requestAnimationFrame(() => {
      if (pending.subpath) {
        if (this.mode === 'preview') {
          const ok = scrollToSubpath(this.readingEl, pending.subpath);
          if (!ok && this.editor) this._scrollEditorToHeadingText(pending.subpath);
        } else if (this.editor) {
          this._scrollEditorToHeadingText(pending.subpath);
        }
      } else if (pending.line !== undefined) {
        if (this.mode !== 'preview' && this.editor) {
          this.editor.scrollTo(pending.line, pending.ch || 0);
          this.editor.setCursor({ line: pending.line, ch: pending.ch || 0 });
        } else if (this.editor) {
          const total = Math.max(1, this.editor.lineCount);
          const frac = Math.min(1, pending.line / total);
          const scroller = this.readingEl;
          scroller.scrollTop = frac * scroller.scrollHeight;
        }
      }
      this._pendingScroll = null;
    });
  }

  _scrollEditorToHeadingText(subpath) {
    if (!this.file) return;
    const cache = this.app.metadataCache.getFileCache(this.file);
    if (!cache || !cache.headings) return;
    const target = subpath.replace(/^#/, '').trim().toLowerCase();
    const h = cache.headings.find((x) => x.heading.toLowerCase() === target) ||
      cache.headings.find((x) => x.heading.toLowerCase().includes(target));
    if (h) {
      this.editor.scrollTo(h.position.start.line, 0);
    }
  }

  // -------------------------------------------------------------------------
  // Titles
  // -------------------------------------------------------------------------
  _updateTitles() {
    const name = this.file ? this.file.basename : '';
    if (this.inlineTitleEdit) {
      this.inlineTitleEdit.setText(name);
      this.inlineTitleEdit.setAttr('data-path', this.file ? this.file.path : '');
    }
    if (this.readingTitle) this.readingTitle.setText(name);
    if (this.inlineTitleEdit) this.inlineTitleEdit.toggle(!(this.app.settings.appSettings.showInlineTitle === false));
    if (this.leaf) this.leaf.updateTabHeader();
    // 原版 onRename：重命名后同步视图头（标题 + 面包屑）
    if (this.leaf && this.app.workspace._fillViewHeader) this.app.workspace._fillViewHeader(this.leaf);
    this.app.workspace.updateTitle();
  }

  _bindInlineTitle() {
    this.inlineTitleEdit.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); this.inlineTitleEdit.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); this.inlineTitleEdit.setText(this.file ? this.file.basename : ''); this.inlineTitleEdit.blur(); }
    });
    this.inlineTitleEdit.addEventListener('blur', async () => {
      if (!this.file) return;
      const value = this.inlineTitleEdit.textContent.trim();
      if (!value || value === this.file.basename) return;
      const parent = this.file.path.split('/').slice(0, -1).join('/');
      const newPath = normalizePath((parent ? parent + '/' : '') + value + '.md');
      const ok = await this.app.fileManager.renameFile(this.file, newPath);
      if (!ok) this.inlineTitleEdit.setText(this.file.basename);
    });
    this.inlineTitleEdit.addEventListener('click', () => {
      if (document.activeElement === this.inlineTitleEdit) return;
      this.inlineTitleEdit.focus();
      const range = document.createRange();
      range.selectNodeContents(this.inlineTitleEdit);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  focusInlineTitle() {
    this.inlineTitleEdit.focus();
    const range = document.createRange();
    range.selectNodeContents(this.inlineTitleEdit);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // -------------------------------------------------------------------------
  // Editor key bindings
  // -------------------------------------------------------------------------
  _bindEditorKeys() {
    // handled through app-level hotkeys (editor:* commands)
    this.editor.cm.dom.addEventListener('click', (ev) => {
      const link = ev.target.closest('.cm-wikilink');
      if (link) return; // widget handles it
    });
  }

  // -------------------------------------------------------------------------
  // View header actions
  // -------------------------------------------------------------------------
  _fillViewActions(actions) {
    // 原版 1.14.4：模式切换后视图头按钮要跟着换图标与文案，
    // 所以这里没传 actions 时取叶子上的动作区（_applyMode 走的就是这条）。
    const el = actions || (this.leaf && this.leaf._viewActionsEl);
    if (!el) return;
    el.empty();
    const preview = this.mode === 'preview';
    const toggle = el.createDiv('clickable-icon view-action');
    // 原版 tooltip 三行：当前状态 + 点击动作 + 修饰键提示（app.css 同款 aria）
    const stateText = preview
      ? (t('interface.menu.read-view') || '该标签页处于阅读视图中')
      : (t('interface.menu.edit-view') || '该标签页处于编辑视图中');
    const actionText = preview
      ? (t('interface.menu.switch-to-edit-view') || '点击此处切换至编辑视图')
      : (t('interface.menu.switch-to-read-view') || '点击此处切换至阅读视图');
    const modText = t('interface.menu.mod-click-open-new-tab', { key: IS_MAC ? '⌘' : 'Ctrl' })
      || (IS_MAC ? '⌘' : 'Ctrl') + '+单击以在新标签页中打开';
    toggle.setAttr('aria-label', `${stateText}\n${actionText}\n${modText}`);
    // 原版图标表示「点它会切到哪个视图」：阅读视图 → 编辑（lucide-edit-3）；编辑视图 → 阅读（lucide-book-open）
    setIcon(toggle, preview ? 'edit-3' : 'book-open');
    toggle.onclick = (ev) => {
      if (ev && (ev.metaKey || ev.ctrlKey)) {
        // 原版 tooltip 第三行：⌘+单击以在新标签页中打开
        if (!this.file) return;
        this.app.workspace.openFile(this.file, { newLeaf: 'tab' });
        return;
      }
      this.toggleMode();
    };

    addDefaultAppAction(this.app, this, el);
    const more = el.createDiv('clickable-icon view-action mod-more-options');
    more.setAttr('aria-label', t('interface.menu.more-options') || 'More options');
    setIcon(more, 'more-horizontal');
    more.onclick = (ev) => this._showMoreMenu(ev);
  }

  _showMoreMenu(ev) {
    const menu = new Menu(this.app);
    if (this.mode === 'preview') {
      menu.addItem((i) => i.setTitle(t('interface.menu.edit') || 'Edit').setIcon('pencil').onClick(() => { this.mode = this._lastEditMode || 'live'; this._applyMode(); }));
      menu.addItem((i) => i.setTitle(t('interface.menu.toggle-source-mode') || 'Source mode').setIcon('code').onClick(() => { this.mode = 'source'; this._lastEditMode = 'source'; this._applyMode(); }));
    } else {
      menu.addItem((i) => i.setTitle(t('interface.menu.toggle-reading-view') || 'Reading view').setIcon('book-open')
        .setChecked(this.mode === 'preview').onClick(() => this.toggleMode()));
      if (this.mode === 'live') {
        menu.addItem((i) => i.setTitle(t('interface.menu.toggle-source-mode') || 'Source mode').setIcon('code').onClick(() => this.toggleSourceLive()));
      } else {
        menu.addItem((i) => i.setTitle(t('plugins.editor-status.edit-live-preview') || 'Live Preview').setIcon('pencil').onClick(() => this.toggleSourceLive()));
      }
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('interface.menu.close') || 'Close').setIcon('x').onClick(() => (this.leaf ? this.leaf.detach() : null)));
    menu.addItem((i) => i.setTitle('Duplicate current file').setIcon('copy').onClick(() => this._duplicateFile()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('menu-items.inline-title') || 'Inline title').setChecked(this.app.settings.appSettings.showInlineTitle !== false).onClick(() => {
      const next = !(this.app.settings.appSettings.showInlineTitle !== false);
      this.app.settings.updateAppSettings({ showInlineTitle: next });
      this._updateTitles();
    }));
    menu.addItem((i) => i.setTitle(t('menu-items.line-numbers') || 'Line numbers').setChecked(!!this.app.settings.appSettings.showLineNumber).onClick(() => {
      const next = !app.settings.appSettings.showLineNumber;
      this.app.settings.updateAppSettings({ showLineNumber: next });
      this.editor.toggleLineNumbers(next);
    }));
    menu.showAtMouseEvent(ev);
  }

  async _duplicateFile() {
    if (!this.file) return;
    const folder = this.app.vault.getFolderByPath(this.file.path.split('/').slice(0, -1).join('/') || '/');
    const copy = await this.app.fileManager.copyFile(this.file, folder);
    if (copy) this.app.workspace.openFile(copy, { newLeaf: 'tab' });
  }

  async promptAddProperty() {
    if (!this.file) return;
    new PromptModal(this.app, {
      title: 'Property name',
      onSubmit: async (key) => {
        if (!key) return;
        await this.app.fileManager.processFrontMatter(this.file, (fm) => { if (!(key in fm)) fm[key] = ''; });
      },
    }).open();
  }

  /**
   * 原版 MarkdownView.onPaneMenu：阅读视图切换（pane）、增加属性（action）、
   * 源码模式（pane，编辑态）、查找/替换（find，替换仅编辑态可用）。
   * 导出为 PDF 依赖原版导出链路，本项目未实现，故意缺失。
   */
  onPaneMenu(menu, source) {
    if (source !== 'tab-header' && source !== 'more-options') return;
    const editMode = this.mode === 'live' || this.mode === 'source';
    if (this.canToggleBacklinks()) menu.addItem((i) => i.setSection('pane')
      .setTitle(t('plugins.backlinks.menu-opt-backlinks-in-document'))
      .setIcon('links-coming-in').setChecked(this.showBacklinks).onClick(() => this.toggleBacklinks()));
    menu.addItem((i) => i.setSection('pane')
      .setTitle(t('interface.menu.toggle-reading-view') || 'Reading view')
      .setIcon('lucide-book-open')
      .setChecked(this.mode === 'preview')
      .onClick(() => this.toggleMode()));
    menu.addItem((i) => i.setSection('action')
      .setTitle(t('interface.menu.add-property') || 'Add property')
      .setIcon('lucide-plus-circle')
      .setDisabled(!this.file)
      .onClick(() => this.promptAddProperty()));
    if (editMode) {
      menu.addItem((i) => i.setSection('pane')
        .setTitle(t('interface.menu.toggle-source-mode') || 'Source mode')
        .setIcon('lucide-code-2')
        .setChecked(this.mode === 'source')
        .onClick(() => this.toggleSourceLive()));
    }
    menu.addItem((i) => i.setSection('find')
      .setTitle(t('interface.menu.find') || 'Find')
      .setIcon('lucide-file-search')
      .onClick(() => this.app.commands.executeCommandById('editor:open-search')));
    menu.addItem((i) => i.setSection('find')
      .setTitle(t('interface.menu.replace') || 'Replace')
      .setIcon('lucide-file-search')
      .setDisabled(!editMode)
      .onClick(() => this.app.commands.executeCommandById('editor:open-search-replace')));
  }
}
