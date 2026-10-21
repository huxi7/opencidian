/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasContentNode（基类）；依赖 ./canvas-minimap.js 的 renderCanvasMinimap；
 *          依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；
 *          依赖 ../markdown/reading.js 的 renderMarkdown；依赖 ../editor/editor.js 的 Editor；使用 core/dom.js 安装的元素助手。
 * [OUTPUT]: 导出 CanvasFileNode（md 渲染预览、canvas 渲染缩略图、图片/音视频直显、其余占位）与 takeLabelText（卡片上方标签文案）。
 * [POS]: views/ 画布节点层的文件卡片（从 canvas-node.js 拆出以守住 800 行上限）。几何与事件由 canvas-view/canvas-interactions 调度；
 *        挂载时按扩展名选择渲染方式；外部修改由画布视图重载后经 setData → setFilePath 刷新。
 *        md 卡片双击进入卡片内编辑（原版 D5：内嵌 markdown 视图 editMode），CM6 只活在编辑期间，输入 400ms 防抖写回真实文件，
 *        Escape / Mod+Enter / 失焦退出并恢复渲染预览；编辑期间登记为 workspace 活动编辑器（file 为被编辑的笔记）。
 *        md 卡片已聚焦时单击正文同样进编辑（原版 hg：卡片正文是可编辑嵌入，点进去就能落笔）。
 *        卡片标签（原版 D5.updateNodeLabel）挂在 nodeEl 上、显示在卡片外上方，受插件选项 cardLabelVisibility 控制（always/hover/never）；
 *        md 卡片标签为短名（非 md 取全名）、带 subpath 时追加 " › 小节"；缺失文件的标签是警告图标 + 路径。
 *        媒体卡片按资源真实宽高比回写几何（原版 D5.render 的 aspectRatio 分支）：图片取 naturalWidth/Height、视频取 videoWidth/Height、
 *        音频按 clientHeight 收窄；回写后走 canvas.overrideHistory，不额外产生撤销条目。
 *        md 卡片在正文之前先渲染页内标题（原版 .mod-header.mod-ui > .inline-title，文案是文件名）：
 *        renderMarkdown 整块替换 sizer，故标题在渲染完成后补挂到 sizer 首位；字号沿用 --inline-title-size（= h1 尺寸）。
 *        .canvas 卡片走原版画布嵌入（app.js 3428689 的 cte）：内容层挂 .canvas-embed，正文是缩略图（views/canvas-minimap.js），
 *        不再把 .canvas 的原始 JSON 当 markdown 渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas file card — md preview/editing, image/video/audio, or placeholder. */
import { CanvasContentNode } from './canvas-node.js';
import { renderCanvasMinimap } from './canvas-minimap.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { renderMarkdown } from '../markdown/reading.js';
import { Editor } from '../editor/editor.js';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga'];

/** 原版 TFile.getShortName：md 用不含扩展名的短名，其余文件用全名。 */
export function takeLabelText(file, subpath) {
  if (!file) return '';
  let label = file.extension === 'md' ? file.basename : file.name;
  if (subpath && file.extension === 'md') label += ' › ' + subpath.substring(1);
  return label;
}

export class CanvasFileNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.filePath = '';
    this.subpath = '';
    this.file = null;
    this.labelEl = null;
    this.minimapEl = null;
    this._renderToken = 0;
    this.editor = null;
    this.editorEl = null;
    this.sourceEl = null;
    this._saveTimer = 0;
    this._lastSaved = '';
  }

  initialize() {
    super.initialize();
    this.initializeEditing();
  }

  /**
   * 原版 hg：单击已聚焦的卡片同样进编辑。
   * 原版的 md 文件卡正文是可编辑嵌入（editable=!0），点进正文即可落笔；
   * 本复刻的正文是只读预览，故已聚焦时单击正文进卡片内编辑（未聚焦时 blocker 挡住指针，不会误触）。
   */
  initializeEditing() {
    super.initializeEditing();
    this.contentEl.addEventListener('click', (e) => this.onContentClick(e));
  }

  onContentClick(e) {
    if (e.defaultPrevented || e.detail > 1 || e.shiftKey) return;
    if (this.isEditing || this.canvas.readonly || this.isInteractiveTarget(e)) return;
    if (!this.file || (this.file.extension || '').toLowerCase() !== 'md') return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('button, input')) return;
    const pos = { x: e.clientX, y: e.clientY };
    window.setTimeout(() => {
      if (this.destroyed || this.isEditing) return;
      this.startEditing(pos);
    }, 10);
  }

  /* ------------------------------------------------------------ 卡片标签 */

  /** 原版 D5 的标签落点：Mod 单击开新页/分栏，双击在当前页打开链接。 */
  openFromLabel(leafType) {
    if (!this.filePath) return;
    this.app.workspace.getLeaf(leafType || false).openLinkText(this.filePath + this.subpath, '');
  }

  /* -------------------------------------------------------------- 文件 */

  setFilePath(filePath, subpath) {
    const nextSub = subpath || '';
    if (this.filePath === filePath && this.subpath === nextSub) return;
    if (this.isEditing) this.stopEditing();
    this.filePath = filePath;
    this.subpath = nextSub;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    this.file = file && file.extension !== undefined ? file : null;
    this.placeholderText = this.file ? takeLabelText(this.file, this.subpath) : filePath;
    this.renderPlaceholder();
    this.renderFile();
    this.canvas.markDirty(this);
  }

  setFile(file, subpath) {
    if (file) this.setFilePath(file.path, subpath);
  }

  renderFile(textOverride) {
    if (this.isEditing) return;
    const token = ++this._renderToken;
    if (!this.contentEl) return;
    this.contentEl.empty();
    this.contentEl.className = 'canvas-node-content';
    const file = this.file;
    if (!file) {
      this.renderFilePlaceholder('lucide-file-question', this.filePath || t('plugins.canvas.label-no-section-found'));
      return;
    }
    const ext = file.extension ? file.extension.toLowerCase() : '';
    if (ext === 'canvas') {
      // 原版画布插件把 .canvas 注册进 embedRegistry：文件卡走画布嵌入，正文是缩略图（.canvas-minimap），不是 JSON 文本。
      this.contentEl.addClass('canvas-embed');
      const reading = typeof textOverride === 'string'
        ? Promise.resolve(textOverride)
        : this.app.vault.cachedRead(file);
      reading
        .then((text) => {
          if (token !== this._renderToken) return;
          this.minimapEl = renderCanvasMinimap(this.contentEl, text);
        })
        .catch((e) => console.error('canvas minimap render failed', e));
      return;
    }
    if (ext === 'md') {
      this.contentEl.addClass('markdown-embed');
      this.embedContent = this.contentEl.createDiv('markdown-embed-content');
      this.previewEl = this.embedContent.createDiv('markdown-preview-view markdown-rendered');
      this.previewSizerEl = this.previewEl.createDiv('markdown-preview-sizer');
      const reading = typeof textOverride === 'string'
        ? Promise.resolve(textOverride)
        : this.app.vault.cachedRead(file);
      reading
        .then((text) => renderMarkdown(this.app, text, this.previewSizerEl, file.path))
        .then(() => {
          if (token !== this._renderToken) return;
          this.renderInlineTitle();
        })
        .catch((e) => console.error('canvas file render failed', e));
      return;
    }
    if (IMAGE_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext)) {
      this.contentEl.addClass('media-embed');
      const isImage = IMAGE_EXTENSIONS.includes(ext);
      const isAudio = AUDIO_EXTENSIONS.includes(ext);
      const el = this.contentEl.createEl(isImage ? 'img' : (isAudio ? 'audio' : 'video'));
      // 原版经 vault.getResourcePath（文件系统适配器）取 app:// 资源 URL
      el.src = this.app.vault.adapter.getResourcePath(file.path);
      el.draggable = false;
      if (!isImage) el.controls = true;
      if (isImage || VIDEO_EXTENSIONS.includes(ext)) {
        const apply = () => {
          if (token !== this._renderToken) return;
          const width = isImage ? el.naturalWidth : el.videoWidth;
          const height = isImage ? el.naturalHeight : el.videoHeight;
          this.fitAspectRatio(width, height);
        };
        if (isImage) {
          // 缓存命中的图片同步可用：直接量，否则等 load
          if (el.complete && el.naturalWidth) apply();
          else el.addEventListener('load', apply, { once: true });
        } else {
          if (el.readyState >= 1 && el.videoWidth) apply();
          else el.addEventListener('loadedmetadata', apply, { once: true });
        }
        el.addEventListener('error', () => {
          if (token !== this._renderToken) return;
          this.contentEl.empty();
          this.contentEl.className = 'canvas-node-content';
          this.renderFilePlaceholder(isImage ? 'lucide-image' : 'lucide-file-video', file.name);
        });
      } else {
        const apply = () => {
          if (token !== this._renderToken) return;
          this.resize({ width: this.width, height: el.clientHeight || 42 });
        };
        if (el.isConnected) window.setTimeout(apply, 0);
        else el.addEventListener('loadedmetadata', apply, { once: true });
      }
      return;
    }
    this.renderFilePlaceholder('lucide-file', file.name);
  }

  /**
   * 卡片内的页内标题（原版 .mod-header.mod-ui > .inline-title）。
   * 原版 1.14.4 的文件卡在正文之前先渲染文件名，再接正文（见原版 app.css 4674 的 .inline-title）。
   * 标题挂在正文层 sizer 的首位；renderMarkdown 会整块替换 sizer，故只能在渲染完成后补挂。
   */
  renderInlineTitle() {
    if (!this.previewSizerEl || !this.file) return;
    if (this.previewSizerEl.querySelector(':scope > .mod-header')) return;
    const header = this.previewSizerEl.createDiv('mod-header mod-ui');
    header.createDiv('inline-title').setText(takeLabelText(this.file, this.subpath));
    this.previewSizerEl.prepend(header);
  }

  /** 原版 D5.render 的 aspectRatio 分支：把卡片收成资源宽高比（不放大），记入当前历史条目。 */
  fitAspectRatio(width, height) {
    if (!width || !height) return;
    const ratio = width / height;
    this.aspectRatio = ratio;
    const w = this.width;
    const h = this.height;
    if (w / h === ratio) return;
    this.resize({ width: Math.min(w, h * ratio), height: Math.min(h, w / ratio) });
    this.canvas.overrideHistory();
  }

  renderFilePlaceholder(icon, text) {
    this.contentEl.addClass('canvas-file-placeholder');
    const iconEl = this.contentEl.createDiv('canvas-icon-placeholder');
    setIcon(iconEl, icon);
    this.contentEl.createDiv({ cls: 'canvas-file-name', text });
  }

  /** 双击：md 在卡片内编辑；图片/其他交给系统/标签页。 */
  startEditing(pos) {
    if (this.canvas.readonly || !this.file) { this.openFile(); return; }
    const ext = (this.file.extension || '').toLowerCase();
    if (ext !== 'md') { this.openFile(); return; }
    if (this.isEditing) return;
    this.setIsEditing(true);
    this.canvas.selectOnly(this);
    if (this.canvas.zoom < this.canvas.zoomBreakpoint + 0.1) this.canvas.zoomToBbox(this.getBBox());
    this.mountEditor();
    this.registerActiveEditor();
    if (pos && this.editor) {
      const editor = this.editor;
      window.setTimeout(() => {
        if (this.editor !== editor || !this.isEditing) return;
        let offset = null;
        try { offset = editor.cm.posAtCoords({ x: pos.x, y: pos.y }); } catch (e) { offset = null; }
        if (offset != null) editor.setSelection(editor.offsetToPos(offset));
      }, 0);
    }
  }

  isEditable() {
    return !!(this.file && (this.file.extension || '').toLowerCase() === 'md');
  }

  /* ------------------------------------------------------------ 卡片内编辑 */

  mountEditor() {
    if (this.editor || !this.contentEl) return;
    const file = this.file;
    const token = ++this._renderToken;
    this.contentEl.empty();
    this.contentEl.className = 'canvas-node-content markdown-embed';
    const embed = this.editorEl = this.contentEl.createDiv('markdown-embed-content');
    const sourceEl = this.sourceEl = embed.createDiv('markdown-source-view cm-s-obsidian mod-cm6');
    const hostEl = sourceEl.createDiv('cm-editor-host');
    const editor = this.editor = new Editor(hostEl, this.app, { doc: '', readOnly: false });
    editor.sourcePath = file.path;
    editor.cm.dom.setAttr('data-editor-mode', 'source');
    const live = this.app.settings.appSettings.livePreview !== false;
    sourceEl.toggleClass('is-live-preview', live);
    sourceEl.toggleClass('is-source-mode', !live);
    editor.setLivePreview(live);
    editor.onChange(() => this.scheduleSave());
    this.editorEl.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { this.stopEditing(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.stopEditing(); }
    }, true);
    this.app.vault.cachedRead(file).then((text) => {
      if (token !== this._renderToken || this.editor !== editor || this.file !== file) return;
      this._lastSaved = text;
      editor.setValue(text);
      editor.focus();
    }).catch((e) => console.error('canvas file edit failed', e));
  }

  /** 输入 400ms 防抖写回真实文件；不进入画布 JSON 历史（文件自身撤销由编辑器负责）。 */
  scheduleSave() {
    if (this._saveTimer) window.clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => { this.saveEditor(); }, 400);
  }

  async saveEditor() {
    if (this._saveTimer) { window.clearTimeout(this._saveTimer); this._saveTimer = 0; }
    const editor = this.editor;
    const file = this.file;
    if (!editor || !file) return;
    const text = editor.getValue();
    if (text === this._lastSaved) return;
    this._lastSaved = text;
    try {
      await this.app.vault.modify(file, text);
    } catch (e) {
      console.error('canvas file save failed', e);
    }
  }

  /** 退出卡片内编辑：同步抓取正文并交给写盘，随后销毁编辑器并用同一份正文明刻恢复预览。 */
  stopEditing() {
    if (!this.isEditing) return;
    this.setIsEditing(false);
    const text = this.editor ? this.editor.getValue() : '';
    this.saveEditor();
    const editor = this.editor;
    this.editor = null;
    this.editorEl = null;
    this.sourceEl = null;
    if (editor) editor.destroy();
    this.clearActiveEditor();
    if (this.contentEl) {
      this.contentEl.empty();
      this.contentEl.className = 'canvas-node-content';
      this.renderFile(text);
    }
    this.canvas.markMoved(this);
  }

  getActiveEditorHost() { return this.editor ? this : null; }
  getMode() { return 'source'; }

  blur() {
    if (this.isEditing) this.stopEditing();
    super.blur();
  }

  onReadonlyChange(readonly) {
    if (readonly && this.isEditing) this.stopEditing();
  }

  destroy() {
    if (this._saveTimer) { window.clearTimeout(this._saveTimer); this._saveTimer = 0; }
    if (this.editor) {
      const editor = this.editor;
      this.editor = null;
      editor.destroy();
    }
    super.destroy();
  }

  openFile() {
    if (!this.filePath) return;
    this.app.workspace.openLinkText(this.filePath + (this.subpath ? '#' + this.subpath : ''), '', false);
  }

  mountContent() {
    super.mountContent();
    if (!this.initialized || !this.contentEl) return;
    if (!this.contentEl.childElementCount) this.renderFile();
  }

  render() {
    super.render();
    if (!this.initialized || !this.contentEl || this.isEditing) return;
    const file = this.file;
    if (file) this.updateNodeLabel(takeLabelText(file, this.subpath));
    else if (this.filePath) this.renderMissingLabel(this.filePath);
    if (!this.contentEl.childElementCount) this.renderFile();
  }

  /** 原版 D5.render：缺失文件的标签是「警告图标 + 路径」片段，不是纯文本。 */
  renderMissingLabel(path) {
    this.updateNodeLabel(path);
    const labelEl = this.labelEl;
    if (!labelEl || !labelEl.isConnected) return;
    labelEl.empty();
    const iconEl = labelEl.createSpan();
    setIcon(iconEl, 'lucide-alert-triangle');
    labelEl.createSpan({ text: path });
  }

  getData() {
    return { ...super.getData(), type: 'file', file: this.file ? this.file.path : this.filePath, subpath: this.subpath || undefined };
  }

  setData(data) {
    super.setData(data);
    if (data.file) this.setFilePath(data.file, data.subpath || '');
  }
}
