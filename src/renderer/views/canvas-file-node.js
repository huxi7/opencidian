/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasContentNode（基类）；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；
 *          依赖 ../markdown/reading.js 的 renderMarkdown；使用 core/dom.js 安装的元素助手。
 * [OUTPUT]: 导出 CanvasFileNode（md/canvas 渲染预览、图片/音视频直显、其余占位）与 takeLabelText（卡片上方标签文案）。
 * [POS]: views/ 画布节点层的文件卡片（从 canvas-node.js 拆出以守住 800 行上限）。几何与事件由 canvas-view/canvas-interactions 调度；
 *        挂载时按扩展名选择渲染方式；外部修改由画布视图重载后经 setData → setFilePath 刷新。
 *        卡片标签（原版 D5.updateNodeLabel）挂在 nodeEl 上、显示在卡片外上方，受插件选项 cardLabelVisibility 控制（always/hover/never）；
 *        md 卡片标签为短名（非 md 取全名）、带 subpath 时追加 " › 小节"。
 *        媒体卡片按资源真实宽高比回写几何（原版 D5.render 的 aspectRatio 分支）：图片取 naturalWidth/Height、视频取 videoWidth/Height、
 *        音频按 clientHeight 收窄；回写后走 canvas.overrideHistory，不额外产生撤销条目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas file card — md/canvas preview, image/video/audio, or placeholder. */
import { CanvasContentNode } from './canvas-node.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { renderMarkdown } from '../markdown/reading.js';

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
    this._renderToken = 0;
  }

  initialize() {
    super.initialize();
    this.initializeEditing();
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

  renderFile() {
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
    if (ext === 'md' || ext === 'canvas') {
      this.contentEl.addClass('markdown-embed');
      this.embedContent = this.contentEl.createDiv('markdown-embed-content');
      this.previewEl = this.embedContent.createDiv('markdown-preview-view markdown-rendered');
      this.previewSizerEl = this.previewEl.createDiv('markdown-preview-sizer');
      this.app.vault.cachedRead(file)
        .then((text) => renderMarkdown(this.app, text, this.previewSizerEl, file.path))
        .then(() => { if (token !== this._renderToken) return; })
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

  /** 双击打开文件（对齐原版：md 打开链接，图片/其他交给系统）。 */
  startEditing() { this.openFile(); }

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
    if (!this.initialized || !this.contentEl) return;
    const file = this.file;
    if (file) this.updateNodeLabel(takeLabelText(file, this.subpath));
    else if (this.filePath) this.updateNodeLabel(this.filePath);
    if (!this.contentEl.childElementCount) this.renderFile();
  }

  getData() {
    return { ...super.getData(), type: 'file', file: this.file ? this.file.path : this.filePath, subpath: this.subpath || undefined };
  }

  setData(data) {
    super.setData(data);
    if (data.file) this.setFilePath(data.file, data.subpath || '');
  }
}
