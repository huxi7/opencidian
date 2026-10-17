/* Modal base class + prompt helpers. */
import { Events } from './events.js';
import { setIcon } from './icons.js';

const openModals = [];

export class Modal extends Events {
  constructor(app) {
    super();
    this.app = app;
    this.containerEl = createDiv('modal-container');
    this.bgEl = this.containerEl.createDiv('modal-bg');
    this.modalEl = this.containerEl.createDiv('modal');
    this.closeButtonEl = this.modalEl.createDiv('modal-close-button mod-raised clickable-icon');
    setIcon(this.closeButtonEl, 'x');
    this.closeButtonEl.setAttr('aria-label', 'Close');
    this.headerEl = this.modalEl.createDiv('modal-header');
    this.titleEl = this.headerEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
    this.buttonContainerEl = this.modalEl.createDiv('modal-button-container');
    this.closeButtonEl.onclick = () => this.close();
    this.bgEl.onclick = () => { if (this.shouldCloseOnBgClick() !== false) this.close(); };
    this.scope = app.keymap ? app.keymap.createScope() : null;
  }
  shouldCloseOnBgClick() { return true; }
  setTitle(title) { this.titleEl.setText(title); return this; }
  setContent(content) {
    this.contentEl.empty();
    if (typeof content === 'string') this.contentEl.setText(content);
    else if (Array.isArray(content)) for (const c of content) this.contentEl.appendChild(c);
    else this.contentEl.appendChild(content);
    return this;
  }
  open() {
    document.body.appendChild(this.containerEl);
    openModals.push(this);
    this.onOpen && this.onOpen();
    this.containerEl.addClass('is-open');
    if (this.scope && this.app.keymap) this.app.keymap.pushScope(this.scope);
    this._onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this._onKeyDown, true);
    return this;
  }
  close() {
    const i = openModals.indexOf(this);
    if (i >= 0) openModals.splice(i, 1);
    if (this.scope && this.app.keymap) this.app.keymap.popScope(this.scope);
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown, true);
    this.bgEl.addClass('is-hidden');
    this.modalEl.addClass('is-hidden');
    setTimeout(() => this.containerEl.detach(), 150);
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
    const cancelBtn = buttons.createEl('button', { text: options.cancelText || 'Cancel' });
    cancelBtn.onclick = () => { this.close(); options.onCancel && options.onCancel(); };
    const ok = buttons.createEl('button', { text: options.okText || 'Submit', cls: 'mod-cta' });
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
    this.close();
    this.options.onSubmit && this.options.onSubmit(value);
  }
}

export function prompt(app, title, options = {}) {
  return new Promise((resolve) => {
    new PromptModal(app, {
      title,
      placeholder: options.placeholder,
      value: options.value || '',
      cls: options.cls,
      onSubmit: (v) => resolve(v),
      onCancel: () => resolve(null),
    }).open();
  });
}

export function confirmDialog(app, title, body, options = {}) {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.setTitle(title);
    modal.contentEl.createEl('p', { text: body });
    const buttons = modal.contentEl.createDiv('modal-button-container');
    const cancel = buttons.createEl('button', { text: options.cancelText || 'Cancel' });
    cancel.onclick = () => { modal.close(); resolve(false); };
    const cta = buttons.createEl('button', { text: options.cta || 'Continue', cls: options.warning ? 'mod-warning' : 'mod-cta' });
    cta.onclick = () => { modal.close(); resolve(true); };
    modal.onClose = () => resolve(false);
    modal.onOpen = () => setTimeout(() => cta.focus(), 10);
    modal.open();
  });
}
