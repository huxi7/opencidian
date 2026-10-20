/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasContentNode（正文节点基类）；依赖 ./canvas-menu.js 的 FileSuggestModal（经 canvas 调用）；依赖 ../core/i18n.js 的 t；
 *          依赖 ../core/icons.js 的 setIcon；依赖 ../core/notices.js 的 Notice；依赖 ../core/ipc.js 的 Desktop；使用 Electron 的 webview 元素与 iframe 回退。
 * [OUTPUT]: 导出 CanvasLinkNode（链接卡片，内嵌网页预览、标题回写标签、换址/浏览器打开/复制/重载菜单）。
 * [POS]: views/ 画布节点层的链接卡片（从 canvas-node.js 拆出以守住 800 行上限）。DOM 对齐原版 I5：
 *        contentEl.canvas-node-content > webview.canvas-link（webviewTag 不可用时退化为同尺寸 iframe），卡片外上方标签显示网页标题，
 *        标题未到达前显示 URL。contentBlocker 在未聚焦时拦截指针，聚焦后把点击交给网页；双击卡片交给系统浏览器。
 *        菜单「重新加载」只在 http(s) 地址出现，调用 webview.reload() 或重设 iframe.src。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas link card — embedded webview preview with iframe fallback. */
import { CanvasContentNode } from './canvas-node.js';
import { t } from '../core/i18n.js';
import { Desktop } from '../core/ipc.js';
import { Notice } from '../core/notices.js';

const HTTP_URL = /^https?:\/\//i;

export class CanvasLinkNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.url = '';
    this.frameEl = null;
    this.frameTitle = '';
    this.useWebview = false;
  }

  initialize() {
    super.initialize();
    this.contentEl.addClass('canvas-link-content');
    this.createFrame();
    this.initializeEditing();
  }

  /** 原版 recreateFrame：桌面端 webview，其他运行环境 iframe。 */
  createFrame() {
    const content = this.contentEl;
    if (!content) return;
    content.empty();
    let frame = null;
    try {
      frame = document.createElement('webview');
      frame.className = 'canvas-link';
      frame.setAttribute('allowpopups', '');
      frame.setAttribute('partition', 'persist:vault-' + (this.app.vaultId || 'default'));
      content.appendChild(frame);
      this.useWebview = typeof frame.loadURL === 'function' || typeof frame.reload === 'function';
      if (!this.useWebview) frame.remove();
    } catch (e) {
      this.useWebview = false;
      if (frame && frame.parentNode) frame.remove();
    }
    if (!this.useWebview) {
      frame = content.createEl('iframe', { cls: 'canvas-link' });
      frame.setAttr('sandbox', 'allow-forms allow-presentation allow-same-origin allow-scripts allow-modals');
      frame.setAttr('allow', 'fullscreen');
    }
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = '0';
    this.frameEl = frame;
    if (this.useWebview) {
      frame.addEventListener('page-title-updated', (event) => {
        const title = (event && event.title) || (typeof frame.getTitle === 'function' ? frame.getTitle() : '');
        this.setFrameTitle(title);
      });
      frame.addEventListener('destroyed', () => {
        if (this.frameEl === frame) this.frameEl = null;
        if (!this.destroyed && this.isAttached && this.isContentMounted) this.createFrame();
      });
    }
    this.setFrameUrl();
  }

  setFrameTitle(title) {
    title = String(title || '').trim();
    if (!title || title === this.frameTitle) return;
    this.frameTitle = title;
    this.updateNodeLabel(title);
  }

  setFrameUrl() {
    const frame = this.frameEl;
    if (!frame) return;
    this.frameTitle = '';
    this.updateNodeLabel(this.url);
    if (!HTTP_URL.test(this.url)) return;
    if (this.useWebview) {
      try { frame.loadURL(this.url); } catch (e) { frame.src = this.url; }
    } else {
      frame.src = this.url;
    }
  }

  /** 重新加载网页（原版 I5.showMenu 的 actionReloadPage）。 */
  reloadFrame() {
    if (!HTTP_URL.test(this.url)) return;
    if (this.useWebview) {
      try { this.frameEl.reload(); } catch (e) { this.frameEl.src = this.url; }
    } else {
      this.frameEl.src = this.url;
    }
  }

  setUrl(url) {
    if (this.url === url) return;
    this.url = url;
    this.placeholderText = url;
    // setData 早于 initialize（importData 顺序：setData → attach → render），frameEl 可能尚未创建
    if (this.frameEl) this.setFrameUrl();
    this.renderPlaceholder();
    this.canvas.markDirty(this);
  }

  startEditing() { if (this.url) Desktop.openExternal(this.url); }

  /** 原版 link 节点 alwaysKeepLoaded：缩到断点以下不卸载网页，避免反复加载。 */
  unmountContent() {}

  updateBreakpoint(showContent) {
    this.isSmall = !showContent;
    this.mountContent();
  }

  mountContent() {
    super.mountContent();
    if (this.isContentMounted && !this.frameEl) this.createFrame();
  }

  /** 原版 I5.updateNodeLabel：卡片上方标签显示 URL/网页标题，Mod 单击 / 双击在新窗口打开。 */
  openFromLabel() { if (this.url) window.open(this.url, '_blank'); }

  render() {
    super.render();
    if (!this.initialized) return;
    this.updateNodeLabel(this.frameTitle || this.url);
    if (!this.frameEl) this.createFrame();
  }

  /** 原版 I5.showMenu：换网址 / 在浏览器打开 / 复制网址 / 重新加载。 */
  showMenu(menu) {
    super.showMenu(menu);
    if (this.canvas.readonly) return;
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-change-url')).setIcon('lucide-link')
      .onClick(() => this.canvas.promptLinkUrl(this)));
    menu.addItem((item) => item.setSection('canvas').setTitle(t('interface.menu.open-in-browser')).setIcon('lucide-globe')
      .onClick(() => window.open(this.url, '_blank')));
    menu.addItem((item) => item.setSection('canvas').setTitle(t('interface.menu.copy-url')).setIcon('lucide-copy')
      .onClick(() => {
        navigator.clipboard.writeText(this.url);
        new Notice(t('interface.copied', { item: 'URL' }));
      }));
    if (HTTP_URL.test(this.url)) {
      menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-reload-page')).setIcon('lucide-rotate-ccw')
        .onClick(() => this.reloadFrame()));
    }
  }

  destroy() {
    if (this.frameEl) {
      if (this.frameEl.parentNode) this.frameEl.remove();
      this.frameEl = null;
    }
    super.destroy();
  }

  getData() { return { ...super.getData(), type: 'link', url: this.url }; }

  setData(data) {
    super.setData(data);
    if (data.url) this.setUrl(data.url);
  }
}
