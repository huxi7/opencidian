/**
 * [INPUT]: 依赖 core/icons.js 的 setIcon；使用 dom.js 安装的元素助手。
 * [OUTPUT]: 导出 Menu（addItem/addSeparator/setParentElement/showAtMouseEvent/showAtPosition/close）与 MenuItem（title/icon/checked/section/submenu/callback）。
 * [POS]: core/ 的通用菜单层。菜单挂 document.body，外部 mousedown/contextmenu 关闭，键盘上下/Enter/Esc 导航。
 *        setParentElement 让触发元素在菜单打开期间带 has-active-menu（原版语义），供画布快速设置按钮防重复打开。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Menu — context menus & dropdown menus with keyboard navigation. */
import { setIcon } from './icons.js';

export class MenuItem {
  constructor(menu) {
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
  setTitle(title) { this.title = title; this.update(); return this; }
  setIcon(icon) { this.icon = icon; this.update(); return this; }
  setIsLabel(isLabel) { this.isLabel = isLabel; this.update(); return this; }
  setChecked(checked) { this.checked = checked; this.update(); return this; }
  setDisabled(disabled) { this.disabled = disabled; this.update(); return this; }
  setSection(section) { this.section = section; return this; }
  setWarning(warning) { this.warning = warning; this.update(); return this; }
  onClick(callback) { this.callback = callback; return this; }
  setSubmenu() { this.submenu = new Menu(this.menu.app); return this.submenu; }
  update() { if (this.dom) renderMenuItem(this, this.dom); }
}

export class Menu {
  constructor(app) {
    this.app = app;
    this.items = [];
    this.dom = null;
    this.selected = -1;
    this.parentMenu = null;
    this.parentEl = null;
  }

  /** 绑定触发元素：菜单打开期间元素带 has-active-menu（原版 setParentElement 语义）。 */
  setParentElement(el) { this.parentEl = el; return this; }

  addItem(cb) {
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
  showAtMouseEvent(ev) {
    this.showAtPosition({ x: ev.clientX, y: ev.clientY });
  }

  showAtPosition(pos) {
    this.close();
    const dom = createDiv('menu');
    this.dom = dom;
    this.renderDom();
    document.body.appendChild(dom);
    // measure & clamp
    const rect = dom.getBoundingClientRect();
    let x = pos.x, y = pos.y;
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    dom.style.left = Math.max(4, x) + 'px';
    dom.style.top = Math.max(4, y) + 'px';
    this._docMouseDown = (ev) => {
      if (!dom.contains(ev.target)) this.close();
    };
    this._docKeyDown = (ev) => this.onKeyDown(ev);
    this._docContext = (ev) => {
      if (!dom.contains(ev.target)) this.close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this._docMouseDown, true);
      document.addEventListener('contextmenu', this._docContext, true);
      document.addEventListener('keydown', this._docKeyDown, true);
    }, 0);
    if (this.parentEl) this.parentEl.addClass('has-active-menu');
    this.onShow && this.onShow();
    return dom;
  }

  renderDom() {
    const dom = this.dom;
    if (!dom) return;
    dom.empty();
    for (const item of this.items) {
      if (item.isSeparator) {
        dom.createDiv('menu-separator');
        continue;
      }
      const itemEl = dom.createDiv('menu-item');
      item.dom = itemEl;
      renderMenuItem(item, itemEl);
      if (!item.disabled && !item.isLabel) {
        itemEl.onclick = (ev) => {
          if (item.submenu) return;
          if (item.callback) item.callback(ev);
          this.close();
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

  /** 原版 qg.openSubmenuSoon：悬停 250ms 后才展开，移开即取消。 */
  _scheduleSubmenu(item, itemEl) {
    if (this._openSubmenuRef && this._openSubmenuRef._ownerItem === item) return;
    this._closeSubmenu();
    this._submenuTimer = setTimeout(() => {
      this._submenuTimer = null;
      this._openSubmenu(item, itemEl);
    }, 250);
  }

  _openSubmenu(item, itemEl, selectFirst) {
    this._closeSubmenu();
    const sub = item.submenu;
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

  /** 可导航项（跳过分隔线、禁用与 label）。 */
  _selectableItems() {
    return this.items.filter((i) => !i.isSeparator && !i.disabled && !i.isLabel);
  }

  /** 选中第 index 个可导航项（键盘进入子菜单时选第一项）。 */
  select(index) {
    const list = this._selectableItems();
    const item = list[index];
    if (item && item.dom) {
      this._setSelectedDom(item.dom);
      item.dom.scrollIntoView({ block: 'nearest' });
    }
  }

  _setSelectedDom(el) {
    if (this._selectedEl) this._selectedEl.removeClass('is-selected');
    this._selectedEl = el;
    if (el) el.addClass('is-selected');
  }

  onKeyDown(ev) {
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
      selectable[idx].dom.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      idx = (idx - 1 + selectable.length) % selectable.length;
      this._setSelectedDom(selectable[idx].dom);
      selectable[idx].dom.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      if (idx >= 0) {
        ev.preventDefault();
        const item = selectable[idx];
        if (item.submenu) { this._openSubmenu(item, item.dom, true); return; }
        if (item.callback) item.callback(ev);
        this.close();
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.close();
    } else if (ev.key === 'ArrowRight') {
      if (idx >= 0 && selectable[idx].submenu) this._openSubmenu(selectable[idx], selectable[idx].dom, true);
    } else if (ev.key === 'ArrowLeft') {
      // 原版 onArrowLeft：子菜单收起回到父菜单
      if (this.parentMenu) { ev.preventDefault(); this.close(); }
    }
  }

  close() {
    this._closeSubmenu();
    if (this.dom) {
      this.dom.detach();
      this.dom = null;
    }
    if (this.parentMenu && this.parentMenu._openSubmenuRef === this) this.parentMenu._openSubmenuRef = null;
    if (this._docMouseDown) {
      document.removeEventListener('mousedown', this._docMouseDown, true);
      document.removeEventListener('contextmenu', this._docContext, true);
      document.removeEventListener('keydown', this._docKeyDown, true);
      this._docMouseDown = null;
    }
    if (this.parentEl) this.parentEl.removeClass('has-active-menu');
    this.onHide && this.onHide();
  }
}

function renderMenuItem(item, el) {
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
