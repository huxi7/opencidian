/**
 * [INPUT]: 标准 DOM 与 dom-types 的创建选项。
 * [OUTPUT]: 导出具体元素与事件回调类型的工厂，并安装 DOM 原型与全局工厂。
 * [POS]: 渲染器 DOM 创建入口；不持有工作区状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DomOptions, DomInfo, DomCallback } from './dom-types.js';
/*
 * DOM helpers — mirrors Obsidian's public DOM extension API so plugins and
 * internal code can use the familiar `createEl / addClass / setText` idioms.
 */
(function installDomHelpers() {
  if (Element.prototype.hasOwnProperty('createEl')) return;

  function applyInfo(el: HTMLElement, o?: DomOptions) {
    if (!o) return;
    if (typeof o === 'string') { el.className = o; return; }
    if (o.cls) {
      const cls = Array.isArray(o.cls) ? o.cls : String(o.cls).split(' ');
      for (const c of cls) if (c) el.classList.add(c);
    }
    if (o.text !== undefined && o.text !== null) el.textContent = String(o.text);
    if (o.title !== undefined) el.title = o.title;
    if (o.type !== undefined) el.setAttribute('type', o.type);
    if (o.value !== undefined) (el as HTMLInputElement).value = o.value as string;
    if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
    if (o.href !== undefined) el.setAttribute('href', o.href);
    if (o.attr) {
      for (const k in o.attr) {
        if (o.attr[k] === null || o.attr[k] === undefined) el.removeAttribute(k);
        else el.setAttribute(k, String(o.attr[k]));
      }
    }
    if (o.prepend) { const parent = el; void parent; }
    if (o.parent) o.parent.appendChild(el);
  }

  Object.defineProperties(Element.prototype, {
    createEl: {
      value(this: HTMLElement, tag: string, o?: DomOptions, callback?: DomCallback<HTMLElement>) {
        const el = document.createElement(tag);
        applyInfo(el, o);
        if (callback) callback(el);
        this.appendChild(el);
        return el;
      },
    },
    createDiv: {
      value(this: HTMLElement, o?: DomOptions | DomCallback<HTMLDivElement>, callback?: DomCallback<HTMLDivElement>) {
        if (typeof o === 'function') { callback = o; o = undefined; }
        return this.createEl('div', o, callback);
      },
    },
    createSpan: {
      value(this: HTMLElement, o?: DomOptions | DomCallback<HTMLSpanElement>, callback?: DomCallback<HTMLSpanElement>) {
        if (typeof o === 'function') { callback = o; o = undefined; }
        return this.createEl('span', o, callback);
      },
    },
    createSvg: {
      value(this: Element, tag: string, o?: DomInfo, callback?: DomCallback<SVGElement>) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (o) {
          if (o.cls) el.setAttribute('class', Array.isArray(o.cls) ? o.cls.join(' ') : o.cls);
          if (o.attr) for (const k in o.attr) el.setAttribute(k, String(o.attr[k]));
        }
        if (callback) callback(el);
        this.appendChild(el);
        return el;
      },
    },
    addClass: { value(this: Element, ...classes: string[]) { for (const c of classes) if (c) this.classList.add(c); } },
    addClasses: { value(this: Element, classes: string[]) { for (const c of classes) if (c) this.classList.add(c); } },
    removeClass: { value(this: Element, ...classes: string[]) { for (const c of classes) if (c) this.classList.remove(c); } },
    removeClasses: { value(this: Element, classes: string[]) { for (const c of classes) if (c) this.classList.remove(c); } },
    toggleClass: { value(this: Element, classes: string | string[], value?: boolean) { for (const c of (Array.isArray(classes) ? classes : [classes])) this.classList.toggle(c, value); } },
    hasClass: { value(this: Element, c: string) { return this.classList.contains(c); } },
    setText: { value(this: HTMLElement, text: string | number) { this.textContent = text as string; } },
    getText: { value(this: HTMLElement) { return this.textContent; } },
    setAttr: { value(this: HTMLElement, name: string, value: string | number | boolean | null | undefined) { if (value === null || value === undefined) this.removeAttribute(name); else this.setAttribute(name, String(value)); } },
    setAttrs: { value(this: HTMLElement, obj: DomInfo['attr']) { for (const k in obj) this.setAttr(k, obj[k]); } },
    getAttr: { value(this: Element, name: string) { return this.getAttribute(name); } },
    empty: { value(this: HTMLElement) { while (this.firstChild) this.removeChild(this.firstChild); } },
    detach: { value(this: HTMLElement) { if (this.parentNode) this.parentNode.removeChild(this); } },
    appendText: { value(this: HTMLElement, text: string | number) { const node = document.createTextNode(String(text)); this.appendChild(node); return node; } },
    insertAfter: { value(this: Element, node: Node) { this.parentNode?.insertBefore(node, this.nextSibling); return this; } },
    indexOf: { value(this: Element, el: Element) { return Array.prototype.indexOf.call(this.children, el); } },
    find: { value(this: Element, selector: string) { return this.querySelector(selector); } },
    findAll: { value(this: Element, selector: string) { return Array.from(this.querySelectorAll(selector)); } },
    findAllSelf: { value(this: Element, selector: string) { const arr = Array.from(this.querySelectorAll(selector)); if (this.matches && this.matches(selector)) arr.unshift(this); return arr; } },
    setCssStyles: { value(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) { for (const k of Object.keys(styles) as Array<keyof CSSStyleDeclaration>) this.style.setProperty(String(k).replace(/[A-Z]/g, (m: string) => '-' + m.toLowerCase()), String(styles[k])); } },
    setCssProps: { value(this: HTMLElement, props: Record<string, string>) { for (const k in props) this.style.setProperty(k, props[k]); } },
    getCssPropertyValue: { value(this: Element, prop: string) { return getComputedStyle(this).getPropertyValue(prop).trim(); } },
    show: { value(this: HTMLElement) { this.removeClass('is-hidden'); this.style.display = ''; } },
    hide: { value(this: HTMLElement) { this.style.display = 'none'; } },
    isShown: { value(this: HTMLElement) { return this.style.display !== 'none' && this.offsetParent !== null || this.style.display !== 'none' && getComputedStyle(this).position === 'fixed'; } },
    toggle: { value(this: HTMLElement, show?: boolean) { const visible = this.style.display !== 'none'; const next = show === undefined ? !visible : show; if (next) this.show(); else this.hide(); } },
    on: { value(this: HTMLElement, type: string, selectorOrHandler: string | EventListener, handler?: (this: Element, event: Event, element: Element) => void) {
      if (typeof selectorOrHandler === 'function') {
        this.addEventListener(type, selectorOrHandler);
        return;
      }
      this.addEventListener(type, (ev) => {
        const target = ev.target instanceof Element ? ev.target.closest(selectorOrHandler) : null;
        if (target && this.contains(target)) handler?.call(target, ev, target);
      });
    } },
    onClickEvent: { value(this: HTMLElement, cb: (event: MouseEvent) => void) { this.addEventListener('click', (e) => { if (e.button === 0 && !e.defaultPrevented) cb(e); }); } },
  });

  // Document-level createEl creators used by Obsidian
  if (!Document.prototype.hasOwnProperty('createEl')) {
    Object.defineProperties(Document.prototype, {
      createEl: { value(this: Document, tag: string, o?: DomOptions, callback?: DomCallback<HTMLElement>) { return document.body.createEl(tag, o, callback); } },
      createDiv: { value(this: Document, o?: DomOptions, cb?: DomCallback<HTMLDivElement>) { return document.body.createDiv(o, cb); } },
    });
  }
})();

export function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomOptions, callback?: DomCallback<HTMLElementTagNameMap[K]>) {
  const el = document.createElement(tag);
  if (o) {
    if (typeof o === 'string') el.className = o;
    else {
      if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
      if (o.text !== undefined) el.textContent = String(o.text);
      if (o.title !== undefined) el.title = o.title;
      if (o.type) el.setAttribute('type', o.type);
      if (o.value !== undefined) (el as HTMLInputElement).value = o.value as string;
      if (o.placeholder) el.setAttribute('placeholder', o.placeholder);
      if (o.attr) for (const k in o.attr) el.setAttribute(k, String(o.attr[k]));
      if (o.parent) o.parent.appendChild(el);
    }
  }
  if (callback) callback(el);
  return el;
}

export function createDiv(o?: DomOptions, callback?: DomCallback<HTMLDivElement>) { return createEl('div', o, callback); }
export function createSpan(o?: DomOptions, callback?: DomCallback<HTMLSpanElement>) { return createEl('span', o, callback); }
export function createSvg<K extends keyof SVGElementTagNameMap>(tag: K, o?: DomInfo, callback?: DomCallback<SVGElementTagNameMap[K]>) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (o) {
    if (o.cls) el.setAttribute('class', Array.isArray(o.cls) ? o.cls.join(' ') : o.cls);
    if (o.attr) for (const k in o.attr) el.setAttribute(k, String(o.attr[k]));
  }
  if (callback) callback(el);
  return el;
}

// The original exposes these as renderer globals (plugins call them without
// importing); install them on globalThis in addition to the ESM exports.
globalThis.createEl = createEl;
globalThis.createDiv = createDiv;
globalThis.createSpan = createSpan;
globalThis.createSvg = createSvg;
