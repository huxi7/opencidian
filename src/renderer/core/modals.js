/**
 * [INPUT]: Events、图标与 Keymap 的弹窗作用域。
 * [OUTPUT]: Modal、PromptModal、prompt、confirmDialog 和弹窗状态查询。
 * [POS]: 弹窗生命周期基座。复开取消延迟卸载，确认值先于关闭回调结算。dimBackground/getRootEl 对齐原版，供设置独立窗口复用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Modal base class + prompt helpers. */
import { Events } from './events.js';
import { setIcon } from './icons.js';
import { tt } from './i18n.js';

const openModals = [];

export class Modal extends Events {
  constructor(app) {
    super();
    this.app = app;
    // 原版 Modal：dimBackground 默认 true（mod-dim → --shadow-l 大阴影），bgOpacity 默认 0.85
    this.dimBackground = true;
    this.bgOpacity = '0.85';
    this.containerEl = createDiv('modal-container');
    this.bgEl = this.containerEl.createDiv('modal-bg');
    this.modalEl = this.containerEl.createDiv('modal');
    this.closeButtonEl = this.modalEl.createDiv('modal-close-button mod-raised clickable-icon');
    setIcon(this.closeButtonEl, 'x');
    this.closeButtonEl.setAttr('aria-label', tt('interface.menu.close', '关闭'));
    this.headerEl = this.modalEl.createDiv('modal-header');
    this.titleEl = this.headerEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
    this.buttonContainerEl = this.modalEl.createDiv('modal-button-container');
    this.closeButtonEl.onclick = () => this.close();
    // 原版 macOS 保护：按下与松开位移 <5px 才视为背景点击（防拖选误关）
    this.bgEl.onmousedown = (ev) => { this._bgDown = { x: ev.screenX, y: ev.screenY }; };
    this.bgEl.onclick = (ev) => {
      const down = this._bgDown;
      this._bgDown = null;
      if (this.shouldCloseOnBgClick() === false) return;
      if (down && Math.hypot(ev.screenX - down.x, ev.screenY - down.y) >= 5) return;
      this.close();
    };
    this.scope = app.keymap ? app.keymap.createScope() : null;
  }
  shouldCloseOnBgClick() { return true; }
  /** 原版 getRootEl：默认 modal-container；设置独立窗口覆写为 modalEl（body > .modal）。 */
  getRootEl() { return this.containerEl; }
  setDimBackground(dim) { this.dimBackground = !!dim; return this; }
  setBackgroundOpacity(opacity) { this.bgOpacity = opacity; return this; }
  setTitle(title) { this.titleEl.setText(title); return this; }
  setContent(content) {
    this.contentEl.empty();
    if (typeof content === 'string') this.contentEl.setText(content);
    else if (Array.isArray(content)) for (const c of content) this.contentEl.appendChild(c);
    else this.contentEl.appendChild(content);
    return this;
  }
  open() {
    clearTimeout(this._closeTimer);
    if (openModals.includes(this)) return this;
    this.bgEl.removeClass('is-hidden');
    this.modalEl.removeClass('is-hidden');
    document.body.appendChild(this.getRootEl());
    openModals.push(this);
    this._prevFocusEl = document.activeElement;
    this.onOpen && this.onOpen();
    this.containerEl.addClass('is-open');
    // 原版 open：mod-dim（大阴影）+ 遮罩 bgOpacity；dimBackground=false 时遮罩不可见
    this.containerEl.toggleClass('mod-dim', this.dimBackground);
    this.bgEl.style.opacity = this.dimBackground ? this.bgOpacity : '0';
    if (this.scope && this.app.keymap) this.app.keymap.pushScope(this.scope);
    this._onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
      } else if (ev.key === 'Tab') {
        this._trapTab(ev);
      }
    };
    document.addEventListener('keydown', this._onKeyDown, true);
    setTimeout(() => {
      if (!this.containerEl.isConnected) return;
      try {
        this.modalEl.setAttr('tabindex', '-1');
        this.modalEl.focus({ preventScroll: true });
      } catch (e) {}
    }, 0);
    return this;
  }

  /** 原版 Jy：Tab 焦点锁在弹窗内。 */
  _trapTab(ev) {
    const focusables = [...this.modalEl.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) { ev.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (ev.shiftKey) {
      if (active === first || !this.modalEl.contains(active)) { ev.preventDefault(); last.focus(); }
    } else if (active === last || !this.modalEl.contains(active)) {
      ev.preventDefault();
      first.focus();
    }
  }
  close() {
    const i = openModals.indexOf(this);
    if (i < 0) return;
    openModals.splice(i, 1);
    if (this.scope && this.app.keymap) this.app.keymap.popScope(this.scope);
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown, true);
    this.bgEl.addClass('is-hidden');
    this.bgEl.style.opacity = '0';
    this.modalEl.addClass('is-hidden');
    this._closeTimer = setTimeout(() => this.getRootEl().detach(), 150);
    // 原版：关闭后把焦点还给打开前的元素（焦点已被其它弹窗接管时不抢）
    const prev = this._prevFocusEl;
    this._prevFocusEl = null;
    if (prev && prev.isConnected) {
      const active = document.activeElement;
      if (!active || active === document.body || this.containerEl.contains(active)) {
        setTimeout(() => { try { prev.focus({ preventScroll: true }); } catch (e) {} }, 0);
      }
    }
    this.onClose && this.onClose();
    this.trigger('closed');
  }
}

export function closeAllModals() {
  for (const m of [...openModals]) m.close();
}

export function isModalOpen() { return openModals.length > 0; }

// ---------------------------------------------------------------------------
// Prompt-style dialogs
// ---------------------------------------------------------------------------
export class PromptModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.value = options.value || '';
    this.setTitle(options.title || '');
    if (options.cls) this.modalEl.addClass(options.cls);
    this.inputEl = this.contentEl.createEl('input', { type: 'text', cls: 'prompt-input' });
    this.inputEl.value = this.value;
    if (options.placeholder) this.inputEl.placeholder = options.placeholder;
    this.contentEl.appendChild(this.inputEl);
    const buttons = this.contentEl.createDiv('prompt-buttons');
    const submit = () => this.submit();
    const cancelBtn = buttons.createEl('button', { text: options.cancelText || tt('dialogue.button-cancel', '取消') });
    cancelBtn.onclick = () => { this.close(); options.onCancel && options.onCancel(); };
    const ok = buttons.createEl('button', { text: options.okText || tt('dialogue.button-confirm', '确认'), cls: 'mod-cta' });
    ok.onclick = submit;
    this.okBtn = ok;
    this.onOpen = () => {
      setTimeout(() => { this.inputEl.focus(); this.inputEl.select(); }, 10);
    };
    this.inputEl.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    };
  }
  submit() {
    const value = this.inputEl.value;
    this.options.onSubmit && this.options.onSubmit(value);
    this.close();
  }
}

export function prompt(app, title, options = {}) {
  return new Promise((resolve) => {
    const modal = new PromptModal(app, {
      title,
      placeholder: options.placeholder,
      value: options.value || '',
      cls: options.cls,
      onSubmit: (v) => resolve(v),
      onCancel: () => resolve(null),
    });
    modal.onClose = () => resolve(null);
    modal.open();
  });
}

/**
 * 文件名弹窗（对齐原版 aI/sI）：重命名式 textarea、保存/取消、Enter 提交、非法字符校验。
 * 校验顺序：空名 → 非法字符（\ / :）→ 点开头 → 链接不安全字符（# ^ [ ] |）。
 */
export class FileNameModal extends Modal {
  constructor(app, defaultValue, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.setTitle(tt('dialogue.label-rename-file-generic', 'File name'));
    this.modalEl.addClass('mod-file-rename');
    this.inputEl = this.contentEl.createEl('textarea', { cls: 'rename-textarea', attr: { rows: '1' } });
    this.inputEl.value = defaultValue || '';
    this.errorEl = this.contentEl.createDiv('rename-error');
    this.errorEl.hide();
    this.inputEl.addEventListener('keypress', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); this.submit(); }
    });
    this.inputEl.addEventListener('input', () => {
      this.autoSize();
      this.errorEl.hide();
    });
    this.saveBtnEl = this.buttonContainerEl.createEl('button', { cls: 'mod-cta', text: tt('dialogue.button-save', 'Save') });
    this.saveBtnEl.onclick = () => this.submit();
    this.cancelBtnEl = this.buttonContainerEl.createEl('button', { text: tt('dialogue.button-cancel', 'Cancel') });
    this.cancelBtnEl.onclick = () => this.close();
  }

  onOpen() {
    setTimeout(() => { this.inputEl.focus(); this.inputEl.select(); this.autoSize(); }, 10);
  }

  autoSize() {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = this.inputEl.scrollHeight + 'px';
  }

  validate(name) {
    if (!name) return tt('plugins.file-explorer.msg-empty-file-name', 'File name cannot be empty.');
    if (/[\\/:]/.test(name)) {
      return tt('plugins.file-explorer.msg-invalid-characters', 'File name cannot contain any of these characters: ') + '\\ / :';
    }
    if (name.startsWith('.')) return tt('plugins.file-explorer.msg-bad-dotfile', 'File name must not start with a dot.');
    if (/[#^\[\]|]/.test(name)) {
      return tt('plugins.file-explorer.msg-unsafe-characters', 'Links will not work with file names containing any of these characters: ') + '# ^ [ ] |';
    }
    return '';
  }

  submit() {
    const name = this.inputEl.value.trim();
    const error = this.validate(name);
    if (error) {
      this.errorEl.setText(error);
      this.errorEl.show();
      this.inputEl.focus();
      return;
    }
    this.close();
    this.onSubmit(name);
  }
}

export function confirmDialog(app, title, body, options = {}) {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.setTitle(title);
    modal.contentEl.createEl('p', { text: body });
    const buttons = modal.contentEl.createDiv('modal-button-container');
    const cancel = buttons.createEl('button', { text: options.cancelText || tt('dialogue.button-cancel', '取消') });
    cancel.onclick = () => { modal.close(); resolve(false); };
    const cta = buttons.createEl('button', { text: options.cta || tt('dialogue.button-continue', '继续'), cls: options.warning ? 'mod-warning' : 'mod-cta' });
    cta.onclick = () => { resolve(true); modal.close(); };
    modal.onClose = () => resolve(false);
    modal.onOpen = () => setTimeout(() => cta.focus(), 10);
    modal.open();
  });
}
