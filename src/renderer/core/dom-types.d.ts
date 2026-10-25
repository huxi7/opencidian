/**
 * [INPUT]: 标准 DOM 类型与 dom.ts 安装的元素扩展。
 * [OUTPUT]: DOM 创建选项、原型扩展及渲染器全局入口声明。
 * [POS]: 渲染器的 DOM 类型边界；声明不安装运行时能力。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface DomInfo {
  cls?: string | string[];
  text?: string | number;
  title?: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  href?: string;
  attr?: Record<string, string | number | boolean | null | undefined>;
  prepend?: boolean;
  parent?: Node;
}
export type DomOptions = string | DomInfo;
export type DomCallback<T extends Element> = (element: T) => void;
interface DomCreators {
  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, info?: DomOptions, callback?: DomCallback<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K];
  createEl(tag: string, info?: DomOptions, callback?: DomCallback<HTMLElement>): HTMLElement;
  createDiv(info?: DomOptions | DomCallback<HTMLDivElement>, callback?: DomCallback<HTMLDivElement>): HTMLDivElement;
  createSpan(info?: DomOptions | DomCallback<HTMLSpanElement>, callback?: DomCallback<HTMLSpanElement>): HTMLSpanElement;
  createSvg<K extends keyof SVGElementTagNameMap>(tag: K, info?: DomInfo, callback?: DomCallback<SVGElementTagNameMap[K]>): SVGElementTagNameMap[K];
}
declare global {
  type App = import('./app.js').App;
  interface Element extends DomCreators {
    refreshPropertyTypes?: () => void;
    __menu?: import('./menu.js').Menu;
    _leaf?: import('./workspace-model.js').WorkspaceLeaf;
    _split?: import('./workspace-model.js').WorkspaceSplit;
    _tabs?: import('./workspace-model.js').WorkspaceTabs;
    _hideTimer?: ReturnType<typeof setTimeout>;
    _baseEmbedCleanup?: (() => void) & { ready?: Promise<unknown> };
    addClass(...classes: string[]): void;
    addClasses(classes: string[]): void;
    removeClass(...classes: string[]): void;
    removeClasses(classes: string[]): void;
    toggleClass(classes: string | string[], enabled?: boolean): void;
    hasClass(name: string): boolean;
    setText(text: string | number): void;
    getText(): string;
    setAttr(name: string, value: string | number | boolean | null | undefined): void;
    setAttrs(attributes: DomInfo['attr']): void;
    getAttr(name: string): string | null;
    empty(): void;
    detach(): void;
    appendText(text: string): Text;
    insertAfter(node: Node): this;
    indexOf(element: Element): number;
    find<T extends Element = HTMLElement>(selector: string): T | null;
    findAll<T extends Element = HTMLElement>(selector: string): T[];
    findAllSelf<T extends Element = HTMLElement>(selector: string): T[];
    setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
    setCssProps(properties: Record<string, string>): void;
    getCssPropertyValue(property: string): string;
    show(): void;
    hide(): void;
    isShown(): boolean;
    toggle(show?: boolean): void;
    on(type: string, selector: string | EventListener, callback?: EventListener): void;
    onClickEvent(callback: (event: MouseEvent) => void): void;
    setTooltip(text: string, options?: { placement?: string; delay?: number; classes?: string[] }): void;
    setTooltipGenerator(callback: () => string): void;
  }
  interface Document extends Pick<DomCreators, 'createEl' | 'createDiv'> {}
  var createEl: typeof import('./dom.js').createEl;
  var createDiv: typeof import('./dom.js').createDiv;
  var createSpan: typeof import('./dom.js').createSpan;
  var createSvg: typeof import('./dom.js').createSvg;
  var Notice: typeof import('./notices.js').Notice;
  var Menu: typeof import('./menu.js').Menu;
  interface Window {
    __starterTest?: Record<string, unknown>;
    __NATIVE_MENU_TEST__?: boolean;
    __SETTINGS_POPOUT_FORCE__?: boolean;
    __runCommand?: (id: string) => unknown;
    app: import('./app.js').App;
    OBS_ACT?: any;
    MathJax?: unknown;
  }
  interface Error { code?: string; }
}
