/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasContentNode（基类）；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../markdown/reading.js 的 renderMarkdown；使用 core/dom.js 安装的元素助手。
 * [OUTPUT]: 导出 CanvasFileNode（md/canvas 渲染预览、图片直显、其余占位）。
 * [POS]: views/ 画布节点层的文件卡片（从 canvas-node.js 拆出以守住 800 行上限）。几何与事件由 canvas-view/canvas-interactions 调度；
 *        挂载时按扩展名选择渲染方式；外部修改由画布视图重载后经 setData → setFilePath 刷新。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas file card — md/canvas preview, image, or placeholder. */
import { CanvasContentNode } from './canvas-node.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { renderMarkdown } from '../markdown/reading.js';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

export class CanvasFileNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.filePath = '';
    this.subpath = '';
    this.file = null;
    this._renderToken = 0;
  }

  initialize() {
    super.initialize();
    this.initializeEditing();
  }

  setFilePath(filePath, subpath) {
    const nextSub = subpath || '';
    if (this.filePath === filePath && this.subpath === nextSub) return;
    this.filePath = filePath;
    this.subpath = nextSub;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    this.file = file && file.extension !== undefined ? file : null;
    this.placeholderText = this.file ? this.file.basename : filePath;
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
    if (IMAGE_EXTENSIONS.includes(ext)) {
      this.contentEl.addClass('media-embed');
      const img = this.contentEl.createEl('img');
      img.src = this.app.vault.getResourcePath(file);
      img.addEventListener('error', () => {
        if (token !== this._renderToken) return;
        this.contentEl.empty();
        this.contentEl.className = 'canvas-node-content';
        this.renderFilePlaceholder('lucide-image', file.basename);
      });
      return;
    }
    this.renderFilePlaceholder('lucide-file', file.basename);
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
