/**
 * [INPUT]: View 生命周期、文件资源URL与图标。
 * [OUTPUT]: 导出 ImageView、VideoView、AudioView、PdfView。
 * [POS]: 媒体正文视图。文件头与面板菜单继承View和通用视图头，不添加系统打开按钮。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Media views — image / audio / video / pdf. */
import { View } from '../core/view.js';
import { setIcon } from '../core/icons.js';
import type { TFile } from '../core/vault.js';
import { WorkspaceLeaf } from '../core/workspace-model.js';

class MediaView extends View {
  declare type: string;
    declare icon: string;

  constructor(leaf: WorkspaceLeaf, type: string) {
    super(leaf);
    this.type = type;
    this.file = null;
    this.icon = type === 'image' ? 'image' : type === 'video' ? 'video' : type === 'audio' ? 'audio-lines' : 'file';
  }
  getViewType() { return this.type; }
  getDisplayText() { return this.file ? this.file.name : this.type; }
  getIcon() { return this.icon; }
  getState() { return { file: this.file ? this.file.path : undefined }; }
  getResourcePath() { return this.app.vault.adapter.getResourcePath(this.file?.path || ''); }

  async setState(state: Record<string,unknown>) {
    if (state && typeof state.file === 'string') {
      this.file = this.app.vault.getFileByPath(state.file);
      this.render();
    }
  }
  async onOpen() { this.render(); }
  onLoadFile(file: TFile) { this.file = file; this.render(); }
  render() {
    this.contentEl.empty();
    if (!this.file) {
      this.contentEl.createDiv({ cls: 'empty-state-title', text: 'File not found' });
      return;
    }
    const url = this.getResourcePath();
    const container = this.contentEl.createDiv('media-view mod-' + this.type);
    if (this.type === 'image') {
      const img = container.createEl('img', { cls: 'image-view' });
      img.src = url;
      img.onerror = () => this._showError(container, 'Unable to load image');
    } else if (this.type === 'video') {
      const video = container.createEl('video', { cls: 'video-view', attr: { controls: 'controls' } });
      video.src = url;
    } else if (this.type === 'audio') {
      const audio = container.createEl('audio', { cls: 'audio-view', attr: { controls: 'controls' } });
      audio.src = url;
      container.createDiv({ cls: 'audio-file-name', text: this.file.name });
    } else if (this.type === 'pdf') {
      const frame = container.createEl('iframe', { cls: 'pdf-view' });
      frame.src = url;
    }
  }
  _showError(container: HTMLDivElement, msg: string) {
    container.empty();
    const err = container.createDiv('media-error');
    setIcon(err.createDiv('media-error-icon'), 'file-x');
    err.createDiv('media-error-message', (el) => el.setText(msg));
  }
  _fillViewActions(actions: HTMLElement) {}
}

export class ImageView extends MediaView {
  constructor(leaf: WorkspaceLeaf) { super(leaf, 'image'); }
}
export class VideoView extends MediaView {
  constructor(leaf: WorkspaceLeaf) { super(leaf, 'video'); }
}
export class AudioView extends MediaView {
  constructor(leaf: WorkspaceLeaf) { super(leaf, 'audio'); }
}
export class PdfView extends MediaView {
  constructor(leaf: WorkspaceLeaf) { super(leaf, 'pdf'); }
}
