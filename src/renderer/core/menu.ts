/**
 * [INPUT]: 具体菜单项、键鼠事件、图标、DOM 助手与 native-menu 的系统菜单桥。
 * [OUTPUT]: 导出 Menu（addItem/addSeparator/addSections/setSectionSubmenu/setParentElement/showAtMouseEvent/showAtPosition/close）与 MenuItem（title/icon/checked/section/submenu/callback）。
 * macOS 默认使用原生菜单；显式关闭后保留主题 DOM 菜单。
 * [POS]: core/ 的通用菜单层。菜单挂 document.body，外部 mousedown/contextmenu 关闭，键盘上下/Enter/Esc 导航。
 *        分节排序镜像原版 qg.sort：sections 定序、相邻节之间插分隔线、setSectionSubmenu 收编子节。
 *        setParentElement 让触发元素在菜单打开期间带 has-active-menu（原版语义），供画布快速设置按钮防重复打开。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Menu — context menus & dropdown menus with keyboard navigation. */
import { setIcon } from './icons.js';
export type MenuEvent = MouseEvent | KeyboardEvent;
interface SectionConfig { title: string; icon?: string; disabled?: boolean; }
import { usesNativeMenu, showNativeMenu, closeNativeMenu } from './native-menu.js';

export class MenuItem {
  isVault?: boolean;
  isSeparator = false;

  declare menu: Menu;
  declare title: string;
  declare icon: string;
  declare checked: boolean;
  declare disabled: boolean;
  declare section: string;
  declare submenu: Menu | null;
  declare callback: ((event: MenuEvent) => unknown) | null;
  declare warning: boolean;
  declare isLabel: boolean;
  declare dom: HTMLDivElement | null;
  checkIconEl: HTMLElement | null = null;
  _inSubmenu?: Menu | null;
  declare _checkable: boolean | undefined;

  constructor(menu: Menu) {
    this.menu = menu;
    this.title = '';
    this.icon = '';
    this.checked = false;
    this.disabled = false;
    this.section = '';
    this.submenu = null;
    this.callback = null;
    this.warning = false;
    this.isLabel = false;
    this.dom = null;
  }
  setTitle(title: string) { this.title = title; this.update(); return this; }
  setIcon(icon: string) { this.icon = icon; this.update(); return this; }
  setIsLabel(isLabel: boolean) { this.isLabel = isLabel; this.update(); return this; }
  setChecked(checked: boolean) { this.checked = checked; this._checkable = true; this.update(); return this; }
  setDisabled(disabled: boolean) { this.disabled = disabled; this.update(); return this; }
  setSection(section: string) { this.section = section; return this; }
  removeIcon() { this.icon = ''; this.update(); return this; }
  setWarning(warning: boolean) { this.warning = warning; this.update(); return this; }
  onClick(callback: (event: MenuEvent) => unknown) { this.callback = callback; return this; }
  setSubmenu() { this.submenu = new Menu(this.menu.app); return this.submenu; }
  update() { if (this.dom) renderMenuItem(this, this.dom); }
}

export class Menu {
  onShow?: () => void;
  declare _sectioned: boolean;
  onHide?: () => void;

  declare app: App | null;
  declare items: MenuItem[];
  declare sections: string[];
  declare submenuConfigs: Record<string, SectionConfig>;
  declare orderedItems: MenuItem[] | null;
  declare dom: HTMLDivElement | null;
  declare selected: number;
  declare parentMenu: Menu | null;
  declare parentEl: HTMLElement | null;
  _scrollEl: HTMLDivElement | null = null;
  _docMouseDown: ((ev: MouseEvent) => void) | null = null;
  _docKeyDown: ((ev: KeyboardEvent) => void) | undefined;
  _docContext: ((ev: MouseEvent) => void) | undefined;
  _submenuTimer: ReturnType<typeof setTimeout> | null = null;
  _openSubmenuRef: Menu | null = null;
  _selectedEl: HTMLElement | null = null;

  _ownerItem?: MenuItem;
  _nativeToken: number | null = null;
  nativeResult: Promise<void> | null = null;

  constructor(app: App | null) {
    this.app = app;
    this.items = [];
    this.sections = [];
    this.submenuConfigs = {};
    this.orderedItems = null;
    this.dom = null;
    this.selected = -1;
    this.parentMenu = null;
    this.parentEl = null;
  }

  /** 绑定触发元素：菜单打开期间元素带 has-active-menu（原版 setParentElement 语义）。 */
  setParentElement(el: HTMLElement) { this.parentEl = el; return this; }

  /** 原版 qg.addSections：在 "" 之前插入未登记的分节名。 */
  addSections(sections: string[]) {
    const fresh = sections.filter((s) => !this.sections.includes(s));
    const at = this.sections.indexOf('');
    this.sections.splice(at < 0 ? this.sections.length : at, 0, ...fresh);
    return this;
  }

  /** 原版 qg.setSectionSubmenu：把 section 及其子节（section.*）收编为一个子菜单项。 */
  setSectionSubmenu(section: string, config: SectionConfig) {
    this.submenuConfigs[section] = config;
    return this;
  }

  addItem(cb?: (item: MenuItem) => unknown) {
    const item = new MenuItem(this);
    this.items.push(item);
    if (cb) cb(item);
    if (this.dom) this.renderDom();
    return item;
  }
  addSeparator() {
    const item = new MenuItem(this);
    item.isSeparator = true;
    this.items.push(item);
    if (this.dom) this.renderDom();
    return item;
  }
  showAtMouseEvent(ev: MouseEvent) {
    this.showAtPosition({ x: ev.clientX, y: ev.clientY });
  }

  showAtPosition(pos: { x: number; y: number; width?: number; overlap?: boolean; left?: boolean }): HTMLDivElement | null {
    this.close();
    if (usesNativeMenu(this)) return showNativeMenu(this, pos);
    // 原版 qg：.menu > .menu-grabber + .menu-scroll + .suggestion-bg（滚动在 menu-scroll 上）
    const dom = createDiv('menu');
    dom.createDiv('menu-grabber');
    const scrollEl = dom.createDiv('menu-scroll');
    dom.createDiv('suggestion-bg');
    this.dom = dom;
    dom.__menu = this;   // 真实鼠标 mousedown 时沿菜单链判断归属（子菜单 DOM 不在父菜单 dom 内）
    this._scrollEl = scrollEl;
    this.renderDom();
    document.body.appendChild(dom);
    // 原版 Uv：指针位置驱动滚动（无原生滚动条）
    scrollEl.addEventListener('mousemove', (ev) => {
      const h = scrollEl.clientHeight;
      const sh = scrollEl.scrollHeight;
      if (sh <= h) return;
      const ratio = (ev.clientY - scrollEl.getBoundingClientRect().y - 30) / (h - 60);
      scrollEl.scrollTop = (sh - h) * Math.min(1, Math.max(0, ratio));
    });
    // measure & clamp
    const rect = dom.getBoundingClientRect();
    let x = pos.x, y = pos.y;
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    dom.style.left = Math.max(4, x) + 'px';
    dom.style.top = Math.max(4, y) + 'px';
    this._docMouseDown = (ev) => {
      // 子菜单挂在本菜单 dom 之外：真实鼠标按下子菜单项时不能先关父菜单，
      // 否则 mousedown →（菜单被移除）→ click 永远到不了 item.onclick。
      const menuEl = ev.target instanceof Element ? ev.target.closest<HTMLElement>('.menu') : null;
      let owner: Menu | null | undefined = menuEl?.__menu;
      while (owner) {
        if (owner === this) return;
        owner = owner.parentMenu;
      }
      if (!dom.contains(ev.target instanceof Node ? ev.target : null)) this.close();
    };
    this._docKeyDown = (ev) => this.onKeyDown(ev);
    this._docContext = (ev) => {
      if (!dom.contains(ev.target instanceof Node ? ev.target : null)) this.close();
    };
    setTimeout(() => {
      if (this.dom !== dom) return;
      if (this._docMouseDown) document.addEventListener('mousedown', this._docMouseDown, true);
      if (this._docContext) document.addEventListener('contextmenu', this._docContext, true);
      if (this._docKeyDown) document.addEventListener('keydown', this._docKeyDown, true);
    }, 0);
    if (this.parentEl) this.parentEl.addClass('has-active-menu');
    this.onShow && this.onShow();
    return dom;
  }

  renderDom() {
    const dom = this._scrollEl || this.dom;
    if (!dom) return;
    dom.empty();
    // 分节排序为显式声明（addSections / setSectionSubmenu）的菜单启用；未声明分节表的菜单保持插入序，
    // 以保留表格菜单等自行插分隔线的既有结构（它们的插入序本就等于原版分节序）。
    // 由分节排序生成的子菜单（_sectioned）同样按自身子节插分隔线（原版 NV() 的 basic/advanced/danger）。
    const grouped = this._sectioned || this.sections.length > 0 || Object.keys(this.submenuConfigs).length > 0;
    const ordered = grouped ? this._sort() : this.items.slice();
    this.orderedItems = ordered;
    let group: HTMLDivElement | null = null;
    for (const item of ordered) {
      if (item.isSeparator) {
        group = null;
        dom.createDiv('menu-separator');
        continue;
      }
      const itemEl = document.createElement('div');
      itemEl.addClass('menu-item');
      item.dom = itemEl;
      renderMenuItem(item, itemEl);
      if (grouped) {
        if (!group) group = dom.createDiv('menu-group');
        group.appendChild(itemEl);
      } else {
        dom.appendChild(itemEl);
      }
      if (!item.disabled && !item.isLabel) {
        itemEl.onclick = (ev) => {
          if (item.submenu) return;
          if (item.callback) item.callback(ev);
          this._closeRoot();
        };
        itemEl.onmouseenter = () => {
          this._setSelectedDom(itemEl);
          if (item.submenu) this._scheduleSubmenu(item, itemEl);
          else this._closeSubmenu();
        };
        itemEl.onmouseleave = () => {
          if (this._submenuTimer) { clearTimeout(this._submenuTimer); this._submenuTimer = null; }
        };
      }
    }
  }

  /**
   * 原版 qg.sort：按 items 的 section 分组，按 sections 定序展开；相邻不同节之间断言分隔线；
   * setSectionSubmenu 登记的节生成子菜单占位项，其子节（section.*）进入该子菜单。
   * 未登记的分节按首次出现顺序追加；末尾分隔线丢弃。
   */
  _sort() {
    const sections = this.sections;
    const groups: Record<string, MenuItem[]> = { '': [] };
    for (const item of this.items) {
      // 已收编进【本菜单的】子菜单的项不参与二次分组；进入子菜单自身排序时正常参与
      if (item._inSubmenu && item._inSubmenu !== this) continue;
      const section = item.isSeparator ? '' : (item.section || '');
      if (section === '' || !sections.includes(section)) sections.push(section);
      (groups[section] || (groups[section] = [])).push(item);
    }
    const out: MenuItem[] = [];
    const separator = () => { const s = new MenuItem(this); s.isSeparator = true; return s; };
    let current: string | null = null;
    let submenu: Menu | null = null;
    let currentSubmenuKey = '';
    for (const section of sections) {
      if (!Object.prototype.hasOwnProperty.call(groups, section)) continue;
      let owner = '';
      for (const key of Object.keys(this.submenuConfigs)) {
        if (section === key || section.substring(0, key.length + 1) === key + '.') { owner = key; break; }
      }
      const parts = section.split('.');
      const root = parts[0];
      const relative = parts.length > 0 ? parts.slice(1).join('.') : section;
      if (owner) {
        if (submenu && owner === currentSubmenuKey) {
          submenu.items.push(separator());
        } else {
          if (current && current.split('.')[0] !== root) { out.push(separator()); current = section; }
          const config = this.submenuConfigs[owner];
          const placeholder = new MenuItem(this);
          out.push(placeholder);
          placeholder.setTitle(config.title);
          if (config.icon) placeholder.setIcon(config.icon);
          if (config.disabled) placeholder.setDisabled(true);
          submenu = placeholder.setSubmenu();
          submenu._sectioned = true;
          currentSubmenuKey = owner;
        }
        for (const item of groups[section]) {
          if (!item.isSeparator) { item.setSection(relative); item._inSubmenu = submenu; }
          submenu?.items.push(item);
        }
      } else {
        if (current !== root) { if (current !== null) out.push(separator()); current = section; }
        for (const item of groups[section]) out.push(item);
      }
    }
    if (!sections.includes('')) for (const item of groups['']) out.push(item);
    while (out.length && out[out.length - 1].isSeparator) out.pop();
    return out;
  }

  /** 原版 qg.openSubmenuSoon：悬停 250ms 后才展开，移开即取消。 */
  _scheduleSubmenu(item: MenuItem, itemEl: HTMLElement) {
    if (this._openSubmenuRef && this._openSubmenuRef._ownerItem === item) return;
    this._closeSubmenu();
    this._submenuTimer = setTimeout(() => {
      this._submenuTimer = null;
      this._openSubmenu(item, itemEl);
    }, 250);
  }

  _openSubmenu(item: MenuItem, itemEl: HTMLElement, selectFirst?: boolean) {
    this._closeSubmenu();
    const sub = item.submenu;
    if (!sub) return null;
    sub.parentMenu = this;
    sub._ownerItem = item;
    const rect = itemEl.getBoundingClientRect();
    const dom = sub.showAtPosition({ x: rect.right - 4, y: rect.top - 4 });
    this._openSubmenuRef = sub;
    if (selectFirst) sub.select(0);
    return dom;
  }

  _closeSubmenu() {
    if (this._submenuTimer) { clearTimeout(this._submenuTimer); this._submenuTimer = null; }
    if (this._openSubmenuRef) {
      this._openSubmenuRef.close();
      this._openSubmenuRef = null;
    }
  }

  /** 可导航项（跳过分隔线、禁用与 label），按渲染顺序。 */
  _selectableItems() {
    return (this.orderedItems || this.items).filter((i) => !i.isSeparator && !i.disabled && !i.isLabel);
  }

  /** 选中第 index 个可导航项（键盘进入子菜单时选第一项）。 */
  select(index: number) {
    const list = this._selectableItems();
    const item = list[index];
    if (item && item.dom) {
      this._setSelectedDom(item.dom);
      item.dom.scrollIntoView({ block: 'nearest' });
    }
  }

  _setSelectedDom(el: HTMLElement | null) {
    if (this._selectedEl) this._selectedEl.removeClass('is-selected');
    this._selectedEl = el;
    if (el) el.addClass('is-selected');
  }

  onKeyDown(ev: KeyboardEvent) {
    if (!this.dom) return;
    // 子菜单打开时按键归子菜单处理（原版 keymap scope 分层语义）
    if (this._openSubmenuRef && this._openSubmenuRef.dom) return;
    const selectable = this._selectableItems();
    if (!selectable.length) return;
    const currentEl = this._selectedEl;
    let idx = selectable.findIndex((i) => i.dom === currentEl);
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      idx = (idx + 1) % selectable.length;
      this._setSelectedDom(selectable[idx].dom);
      selectable[idx].dom?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      idx = (idx - 1 + selectable.length) % selectable.length;
      this._setSelectedDom(selectable[idx].dom);
      selectable[idx].dom?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      if (idx >= 0) {
        ev.preventDefault();
        const item = selectable[idx];
        if (item.submenu) { item.dom && this._openSubmenu(item, item.dom, true); return; }
        if (item.callback) item.callback(ev);
        this._closeRoot();
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this._closeRoot();
    } else if (ev.key === 'ArrowRight') {
      if (idx >= 0) { const item = selectable[idx]; if (item.submenu && item.dom) this._openSubmenu(item, item.dom, true); }
    } else if (ev.key === 'ArrowLeft') {
      // 原版 onArrowLeft：子菜单收起回到父菜单
      if (this.parentMenu) { ev.preventDefault(); this.close(); }
    }
  }

  /** 原版语义：选中项或 Esc 关闭整条菜单链（含所有上层菜单）。 */
  _closeRoot() {
    let menu: Menu = this;
    while (menu.parentMenu) menu = menu.parentMenu;
    menu.close();
  }

  close() {
    closeNativeMenu(this);
    this._closeSubmenu();
    if (this.dom) {
      this.dom.detach();
      this.dom = null;
      this._scrollEl = null;
    }
    if (this.parentMenu && this.parentMenu._openSubmenuRef === this) this.parentMenu._openSubmenuRef = null;
    if (this._docMouseDown) {
      document.removeEventListener('mousedown', this._docMouseDown, true);
      if (this._docContext) document.removeEventListener('contextmenu', this._docContext, true);
      if (this._docKeyDown) document.removeEventListener('keydown', this._docKeyDown, true);
      this._docMouseDown = null;
    }
    if (this.parentEl) this.parentEl.removeClass('has-active-menu');
    this.onHide && this.onHide();
  }
}

function renderMenuItem(item: MenuItem, el: HTMLElement) {
  el.empty();
  // 原版 Bg：勾选项保留原图标，右侧追加 .menu-item-icon.mod-checked + lucide-check
  el.toggleClass('mod-checked', !!item.checked);
  el.toggleClass('is-warning', !!item.warning);
  el.toggleClass('is-label', !!item.isLabel);
  el.toggleClass('is-disabled', !!item.disabled && !item.isLabel);
  el.toggleClass('tappable', !item.disabled && !item.isLabel);
  el.toggleClass('has-submenu', !!item.submenu);
  const iconEl = el.createDiv('menu-item-icon');
  if (item.icon) {
    const icon = item.icon.startsWith('lucide-') ? item.icon.slice(7) : item.icon;
    setIcon(iconEl, icon);
  }
  const titleEl = el.createDiv('menu-item-title');
  titleEl.setText(typeof item.title === 'string' ? item.title : '');
  item.checkIconEl = null;
  if (item.checked) {
    item.checkIconEl = el.createDiv('menu-item-icon mod-checked');
    setIcon(item.checkIconEl, 'check');
  }
  if (item.submenu) {
    const chevron = el.createDiv('menu-item-chevron');
    setIcon(chevron, 'chevron-right');
  }
}
