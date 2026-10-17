/* Notice — toast messages in the bottom right corner. */
let container = null;

export class Notice {
  constructor(message, timeout = 5000) {
    this.message = message;
    this.timeout = timeout;
    this.noticeEl = createDiv('notice');
    if (message instanceof Node) this.noticeEl.appendChild(message);
    else this.noticeEl.setText(String(message));
    if (!container) {
      container = createDiv('notice-container');
      document.body.appendChild(container);
    }
    container.appendChild(this.noticeEl);
    this.noticeEl.onclick = () => this.hide();
    if (timeout > 0) {
      this.timer = setTimeout(() => this.hide(), timeout);
    }
  }
  setMessage(message) {
    this.noticeEl.setText(String(message));
    return this;
  }
  hide() {
    if (this.timer) clearTimeout(this.timer);
    this.noticeEl.addClass('mod-outro');
    setTimeout(() => this.noticeEl.detach(), 200);
  }
}
