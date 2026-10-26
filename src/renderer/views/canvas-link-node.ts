/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasContentNode（正文节点基类）；依赖 ../core/i18n.js 的 t；
 *          依赖 ../core/icons.js 的 setIcon；依赖 ../core/ipc.js 的 Desktop；使用 Electron 的 webview 元素与 iframe 回退。
 * [OUTPUT]: 导出 CanvasLinkNode（链接卡片，内嵌网页预览、标题回写标签、失败占位、网页截图、换址/浏览器打开/复制/重载菜单）与 normalizeLinkUrl（原版 bj 的媒体地址归一化，验收可直接断言）。
 * [POS]: views/ 画布节点层的链接卡片（从 canvas-node.js 拆出以守住 800 行上限）。DOM 对齐原版 I5：
 *        contentEl.canvas-node-content > webview.canvas-link（webviewTag 不可用时退化为同尺寸 iframe），卡片外上方标签显示网页标题，
 *        标题未到达前显示 URL。contentBlocker 在未聚焦时拦截指针，聚焦后把点击交给网页；双击卡片交给系统浏览器。
 *        原版 setFrameUrl 的两个特判照搬：YouTube/Twitter 链接先换成 embed 地址；releases.obsidian.md/youtube 用 navigator.userAgent，
 *        其余 webview 清空 useragent；partition 钉到 vault：原版 getWebviewPartition 返回 "persist:vault-"+appId，此处用 app.vaultId 复刻同一字符串。
 *        did-fail-load（主框架、非 ERR_ABORTED）在 containerEl 上显示 URL + 原因 + 重试；did-finish-load/iframe load 清除。
 *        重载先清失败态；断点保活仍走 unmountContent 空实现，失败占位不影响网页继续存活。
 *        captureFrameImage 用 webview.capturePage 取真实网页画面（iframe 回退无法跨源截图，返回 null，导出时退回 URL 文本）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas link card — embedded webview preview with iframe fallback. */
import { CanvasContentNode } from './canvas-node.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Desktop } from '../core/ipc.js';
import { Notice } from '../core/notices.js';
import { Menu } from '../core/menu.js';

const HTTP_URL = /^https?:\/\//i;
/** 原版 bj 的两条媒体地址规则。 */
const YOUTUBE_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/(?:[\w-]+\?(?:.*?&)*v=|embed\/|v\/)?)([\w-]+)(?:\??&?(?:t|start)=([0-9]+))?(?:\S+)?$/;
const TWITTER_URL = /^(?:https?:\/\/)?(?:mobile\.)?(?:twitter|x)\.com\/.+\/(\d+)/;

/** 原版 bj：把 YouTube/Twitter 链接换成可嵌入的地址；普通网址返回 null（调用方继续用原 URL）。 */
export function normalizeLinkUrl(url: string) {
  if (!url || typeof url !== 'string') return null;
  let match = url.match(YOUTUBE_URL);
  if (match) {
    if (location.protocol !== 'https:' && /obsidian/i.test(navigator.userAgent)) {
      let next = 'https://releases.obsidian.md/youtube?v=' + match[1];
      if (match[2]) next += '&start=' + match[2];
      return next;
    }
    let next = 'https://www.youtube-nocookie.com/embed/' + match[1];
    if (match[2]) next += '?start=' + match[2];
    return next;
  }
  match = url.match(TWITTER_URL);
  if (match) {
    const dark = document.body.classList.contains('theme-dark');
    return 'https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=' + (dark ? 'dark' : 'light') + '&id=' + match[1];
  }
  return null;
}

export class CanvasLinkNode extends CanvasContentNode {
  declare url: string;
  declare frameEl: Electron.WebviewTag | HTMLIFrameElement | null;
  declare frameTitle: string;
  declare frameLoaded: boolean;
  declare frameError: { code: number; description: string; url: string; seq: number } | null;
  declare loadSeq: number;
  declare errorEl: HTMLDivElement | null;
  declare useWebview: boolean;
  declare placeholderText: string;
  declare isSmall: boolean | null;

  constructor(canvas: import('./canvas-view.js').CanvasView, id?: string) {
    super(canvas, id);
    this.url = '';
    this.frameEl = null;
    this.frameTitle = '';
    this.frameLoaded = false;
    this.frameError = null;
    this.loadSeq = 0;
    this.errorEl = null;
    this.useWebview = false;
  }

  initialize() {
    super.initialize();
    this.contentEl.addClass('canvas-link-content');
    this.createErrorEl();
    this.createFrame();
    this.initializeEditing();
  }

  /** 原版 recreateFrame：桌面端 webview（partition 固定到 vault），其他运行环境 iframe。 */
  createFrame() {
    const content = this.contentEl;
    if (!content) return;
    content.empty();
    this.frameLoaded = false;
    let frame: Electron.WebviewTag | HTMLIFrameElement | null = null;
    let candidate: Electron.WebviewTag | null = null;
    try {
      const webview = candidate = document.createElement('webview');
      webview.className = 'canvas-link';
      webview.setAttribute('allowpopups', '');
      webview.setAttribute('partition', 'persist:vault-' + (this.app.vaultId || 'default'));
      content.appendChild(webview);
      this.useWebview = typeof webview.loadURL === 'function' || typeof webview.reload === 'function';
      if (this.useWebview) frame = webview;
      else webview.remove();
    } catch { this.useWebview = false; candidate?.remove(); }
    if (!frame) {
      const iframe = content.createEl('iframe', { cls: 'canvas-link' });
      iframe.setAttr('sandbox', 'allow-forms allow-presentation allow-same-origin allow-scripts allow-modals');
      iframe.setAttr('allow', 'fullscreen');
      iframe.addEventListener('load', () => {
        if (this.frameEl !== iframe) return;
        this.frameLoaded = true; this.clearFrameError();
      });
      iframe.addEventListener('error', () => {
        if (this.frameEl === iframe) this.handleFrameFailure({ errorDescription: 'net::ERR_FAILED' });
      });
      frame = iframe;
    } else {
      const webview = frame;
      webview.addEventListener('page-title-updated', event => this.setFrameTitle(event.title || webview.getTitle()));
      webview.addEventListener('did-finish-load', () => {
        if (this.frameEl !== webview) return;
        this.frameLoaded = true;
        if (this.frameError && this.frameError.seq === this.loadSeq) return;
        this.clearFrameError();
      });
      webview.addEventListener('did-fail-load', event => {
        if (this.frameEl === webview) this.handleFrameFailure(event);
      });
      webview.addEventListener('destroyed', () => {
        if (this.frameEl === webview) this.frameEl = null;
        if (!this.destroyed && this.isAttached && this.isContentMounted) this.createFrame();
      });
    }
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = '0';
    this.frameEl = frame;
    this.setFrameUrl();
  }

  setFrameTitle(title: string) {
    title = String(title || '').trim();
    if (!title || title === this.frameTitle) return;
    this.frameTitle = title;
    this.updateNodeLabel(title);
  }

  /** 原版 setFrameUrl：先做媒体地址归一化与 UA 特判，再把地址交给 webview/iframe。 */
  setFrameUrl() {
    const frame = this.frameEl;
    if (!frame) return;
    this.frameTitle = '';
    this.frameLoaded = false;
    this.loadSeq += 1;
    this.clearFrameError();
    const target = normalizeLinkUrl(this.url) || this.url;
    this.updateNodeLabel(target);
    if (!HTTP_URL.test(this.url)) return;
    if ('loadURL' in frame) {
      try { frame.useragent = target.startsWith('https://releases.obsidian.md/youtube') ? navigator.userAgent : ''; } catch (e) { /* 属性不可写时保持默认 UA */ }
      try { frame.loadURL(target); } catch (e) { frame.src = target; }
    } else {
      frame.src = target;
    }
  }

  /** 重新加载网页（原版 I5.showMenu 的 actionReloadPage）。 */
  reloadFrame() {
    const frame = this.frameEl;
    if (!frame || !HTTP_URL.test(this.url)) return;
    this.clearFrameError();
    this.frameLoaded = false;
    this.loadSeq += 1;
    const target = normalizeLinkUrl(this.url) || this.url;
    if ('reload' in frame) {
      try { frame.reload(); } catch (e) { frame.src = target; }
    } else {
      frame.src = target;
    }
  }

  /* ------------------------------------------------------------- 失败占位 */

  createErrorEl() {
    if (this.errorEl || !this.containerEl) return;
    const el = this.errorEl = this.containerEl.createDiv('canvas-link-error');
    el.setAttr('role', 'alert');
  }

  /** did-fail-load：只处理主框架；ERR_ABORTED(-3) 是重载/停止造成的取消，不算失败。 */
  handleFrameFailure(event: { isMainFrame?: boolean; errorCode?: number; errorDescription?: string; message?: string; validatedURL?: string }) {
    if (event && event.isMainFrame === false) return;
    const code = event && event.errorCode !== undefined ? Number(event.errorCode) : 0;
    if (code === -3) return;
    this.frameLoaded = false;
    this.frameError = {
      code: Number.isFinite(code) ? code : 0,
      description: (event && (event.errorDescription || event.message)) || '',
      url: (event && event.validatedURL) || this.url,
      seq: this.loadSeq,
    };
    this.renderFrameError();
    this.updateNodeLabel(this.frameTitle || this.url);
  }

  clearFrameError() {
    if (!this.frameError) return;
    this.frameError = null;
    this.renderFrameError();
  }

  renderFrameError() {
    this.createErrorEl();
    const el = this.errorEl;
    if (!el) return;
    el.empty();
    el.toggleClass('is-visible', !!this.frameError);
    const error = this.frameError;
    if (!error) return;
    const iconEl = el.createDiv('canvas-link-error-icon');
    setIcon(iconEl, 'lucide-wifi-off');
    el.createDiv('canvas-link-error-title', (title) => title.setText('无法加载网页'));
    el.createDiv('canvas-link-error-url', (url) => url.setText(error.url || this.url));
    const reason = error.description
      || (error.code ? `错误代码 ${error.code}` : '网页加载失败');
    el.createDiv('canvas-link-error-reason', (text) => text.setText(reason));
    const retry = el.createEl('button', {
      cls: 'canvas-link-error-retry',
      text: t('plugins.canvas.action-reload-page') || 'Reload page',
    });
    retry.addEventListener('pointerdown', (e) => e.stopPropagation());
    retry.addEventListener('click', (e: { preventDefault: () => void; stopPropagation: () => void; }) => {
      e.preventDefault();
      e.stopPropagation();
      this.reloadFrame();
    });
  }

  setUrl(url: string) {
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

  updateBreakpoint(showContent: boolean) {
    this.isSmall = !showContent;
    this.mountContent();
  }

  mountContent() {
    super.mountContent();
    if (this.isContentMounted && !this.frameEl) this.createFrame();
  }

  /** 原版 I5.updateNodeLabel：卡片上方标签显示 URL/网页标题，Mod 单击 / 双击在新窗口打开。 */
  openFromLabel() { if (this.url) window.open(this.url, '_blank'); }

  /**
   * 导出用真实网页画面：webview.capturePage 返回 NativeImage。iframe 回退无法跨源截图，
   * 未加载/已失败/空图一律返回 null；调用方不得用占位图伪装网页。
   */
  async captureFrameImage() {
    const frame = this.frameEl;
    if (!frame || !this.useWebview || this.frameError) return null;
    if (!('capturePage' in frame)) return null;
    try {
      if (typeof frame.isLoading === 'function' && frame.isLoading()) return null;
      const image = await frame.capturePage();
      if (!image) return null;
      if (typeof image.isEmpty === 'function' && image.isEmpty()) return null;
      if (typeof image.getSize === 'function') {
        const size = image.getSize();
        if (!size || !size.width || !size.height) return null;
      }
      const dataURL = typeof image.toDataURL === 'function' ? image.toDataURL() : '';
      return dataURL && dataURL.startsWith('data:image/') ? dataURL : null;
    } catch (e) {
      return null;
    }
  }

  render() {
    super.render();
    if (!this.initialized) return;
    this.updateNodeLabel(this.frameTitle || this.url);
    if (!this.frameEl) this.createFrame();
  }

  /** 原版 I5.showMenu：换网址 / 在浏览器打开 / 复制网址 / 重新加载。 */
  showMenu(menu: Menu) {
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
    if (this.errorEl) {
      this.errorEl.remove();
      this.errorEl = null;
    }
    this.frameError = null;
    super.destroy();
  }

  getData() { return { ...super.getData(), type: 'link', url: this.url }; }

  setData(data: { url: string; }) {
    super.setData(data);
    if (data.url) this.setUrl(data.url);
  }
}
