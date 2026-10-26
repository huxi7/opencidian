/**
 * [INPUT]: Element.prototype 的 createDiv/addEventListener/offsetHeight 等原语(dom.js)。
 * [OUTPUT]: 导出 Notice(构造即 100ms 滑入、点按关闭、hover 暂停、120ms ease-in-out 翻转为 margin-top 收拢)。
 * [POS]: 右上角通知栈。容器随最后一个通知一起摘除；所有调用方沿用原 API。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Notice — toast messages in the top right corner (matches the original pb class). */

let container: HTMLDivElement | null = null;

function getContainer() {
  if (!container || !container.isConnected) {
    container = createDiv('notice-container');
    document.body.appendChild(container);
  }
  return container;
}

export class Notice {
  declare timerId: ReturnType<typeof setTimeout> | number;
  declare buttonContainerEl: HTMLDivElement | null;
  declare containerEl: HTMLDivElement;
  declare messageEl: HTMLDivElement;
  declare noticeEl: HTMLDivElement;

  constructor(message: unknown, timeout = 4000) {
    this.timerId = -1;
    this.buttonContainerEl = null;
    const host = getContainer();
    this.containerEl = host.createDiv('notice');
    this.messageEl = this.noticeEl = this.containerEl.createDiv({ cls: 'notice-message' });
    if (message instanceof Node) this.noticeEl.appendChild(message);
    else this.noticeEl.setText(String(message));
    // 入场：从右侧 350px 滑入（原版桌面端 transform 动画）
    this.containerEl.style.transform = 'translateX(350px)';
    this.containerEl.getBoundingClientRect();
    this.containerEl.style.transform = '';
    this.setAutoHide(timeout);
    this.containerEl.addEventListener('click', () => this.hide());
  }

  /** 重设文案；返回自身以支持链式调用。 */
  setMessage(message: unknown) {
    this.messageEl.setText(String(message));
    return this;
  }

  /** 重设定时；hover 期间暂停，移开后再等 1000ms（对齐原版）。 */
  setAutoHide(timeout: number) {
    const el = this.containerEl;
    if (this.timerId !== -1) {
      clearTimeout(this.timerId);
      this.timerId = -1;
    }
    if (!timeout) return this;
    let hovering = false;
    const expire = () => { if (!hovering) this.hide(); };
    this.timerId = setTimeout(expire, timeout);
    el.addEventListener('mouseenter', () => { hovering = true; });
    el.addEventListener('mouseleave', () => { hovering = false; setTimeout(expire, 1000); });
    return this;
  }

  /** 追加行动按钮：.notice-button-container > .notice-cta，点击先隐藏再回调。 */
  addButton(text: string, callback: (event: MouseEvent) => unknown) {
    if (!this.buttonContainerEl) this.buttonContainerEl = this.containerEl.createDiv('notice-button-container');
    this.buttonContainerEl.createDiv({ cls: 'notice-cta', text }).addEventListener('click', (ev) => {
      this.hide();
      callback(ev);
    });
    return this;
  }

  hide() {
    const el = this.containerEl;
    if (this.timerId !== -1) {
      clearTimeout(this.timerId);
      this.timerId = -1;
    }
    const remove = () => {
      el.detach();
      if (container && container.childElementCount === 0) {
        container.detach();
        container = null;
      }
    };
    if (!el.isConnected) { remove(); return; }
    // 出场：120ms ease-in-out 内 opacity → 0，margin-top 收拢自身高度（原版 qw 默认缓动）
    const styles = getComputedStyle(el);
    let collapse = -el.offsetHeight;
    const marginBottom = parseInt(styles.marginBottom, 10);
    if (!isNaN(marginBottom)) collapse -= marginBottom;
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.transition = 'opacity 120ms ease-in-out, margin-top 120ms ease-in-out';
    el.style.opacity = '1';
    el.style.marginTop = '0px';
    void el.offsetHeight;
    el.style.opacity = '0';
    el.style.marginTop = collapse + 'px';
    setTimeout(remove, 120);
  }
}

// 原版把 Notice 挂在 window 上(插件与调试脚本直接 `new Notice(...)`)
globalThis.Notice = Notice;
