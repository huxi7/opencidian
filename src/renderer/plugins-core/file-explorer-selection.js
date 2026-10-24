/**
 * [INPUT]: 依赖 ../core/keymap.js 的 IS_MAC；依赖 ../core/vault.js 的 TFile/parentPathOf
 * [OUTPUT]: 导出 FileTreeSelection（选择集 / 焦点 / 范围选择 / 键盘分派）与 isModEvent
 * [POS]: plugins-core/file-explorer 的选择层。原版 a2 用 selectedDoms / focusedItem / activeDom 三个 DOM 引用维护状态；
 *        本复刻的树每次重绘都重建 DOM，故状态按 path 保存（paths 集合 + focusPath + anchorPath），重绘后由 apply() 重贴类。
 *        键控动作（打开 / 折叠 / 重命名 / 删除）回落到视图方法，本类只管选择语义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { IS_MAC } from '../core/keymap.js';
import { TFile, parentPathOf } from '../core/vault.js';

/**
 * 原版 Ng.isModEvent：中键与 Mod 命中，Mod+Alt 为 split，Mod+Alt+Shift 为 window。
 * mac 上 Mod = Cmd；mac 的 Ctrl 是独立修饰键（原版 compileModifiers 下不参与 Mod 匹配）。
 */
export function isModEvent(ev) {
  if (!ev) return false;
  if (ev instanceof MouseEvent && ev.button === 1) return 'tab';
  const mod = IS_MAC ? ev.metaKey : ev.ctrlKey;
  if (!mod) return false;
  if (!ev.altKey) return 'tab';
  return ev.shiftKey ? 'window' : 'split';
}

export class FileTreeSelection {
  constructor(view) {
    this.view = view;
    this.paths = new Set();
    this.focusPath = null;
    this.anchorPath = null; // 原版 tree.activeDom：Shift 范围选择的锚点
  }

  get size() { return this.paths.size; }

  has(path) { return this.paths.has(path); }

  /** 可见行（原版 KH/QH 的可见顺序展开）；排除 mod-root 的仓库名标题行，原版不渲染根节点。 */
  rows() {
    const tree = this.view.treeEl;
    if (!tree) return [];
    return [...tree.querySelectorAll('.nav-file-title[data-path], .nav-folder-title[data-path]')]
      .filter((el) => el.getAttribute('data-path') !== '/');
  }

  /** 原版 S8.selectItem：showUnsupportedFiles 关闭时不可选中不受支持的文件。 */
  select(path) {
    if (!this.view._isSelectablePath(path)) return;
    this.paths.add(path);
    const el = this.view._titleEl(path);
    if (el) el.addClass('is-selected');
  }

  deselect(path) {
    this.paths.delete(path);
    const el = this.view._titleEl(path);
    if (el) el.removeClass('is-selected');
  }

  /** 原版 clearSelectedDoms。 */
  clear() {
    const tree = this.view.treeEl;
    if (tree) {
      for (const el of tree.findAll('.nav-file-title.is-selected, .nav-folder-title.is-selected')) {
        el.removeClass('is-selected');
      }
    }
    this.paths.clear();
  }

  /** 原版 setFocusedItem：has-focus 单例，可选滚动进视口。 */
  setFocus(path, scroll = true) {
    this.focusPath = path;
    const tree = this.view.treeEl;
    if (!tree) return;
    for (const el of tree.findAll('.nav-file-title.has-focus, .nav-folder-title.has-focus')) el.removeClass('has-focus');
    if (!path) return;
    const el = this.view._titleEl(path);
    if (!el) return;
    el.addClass('has-focus');
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  /** 原版 getSelectedItems：可见顺序优先，被折叠隐藏的选中项补齐在后。 */
  items() {
    const seen = new Set();
    const out = [];
    for (const el of this.rows()) {
      const path = el.getAttribute('data-path');
      if (!this.paths.has(path) || seen.has(path)) continue;
      seen.add(path);
      const item = this.view._itemByPath(path);
      if (item) out.push(item);
    }
    for (const path of this.paths) {
      if (seen.has(path)) continue;
      const item = this.view._itemByPath(path);
      if (item) out.push(item);
    }
    return out;
  }

  /** 视图重绘后调用：剔除已删除项，重贴 is-selected / has-focus。 */
  apply() {
    for (const path of [...this.paths]) if (!this.view._itemByPath(path)) this.paths.delete(path);
    for (const path of this.paths) {
      const el = this.view._titleEl(path);
      if (el) el.addClass('is-selected');
    }
    this.setFocus(this.focusPath, false);
  }

  /** 原版 _H：按可见顺序取 [anchor, target] 闭区间；锚点缺失时只取目标项。 */
  rangePaths(fromPath, toPath) {
    const rows = this.rows();
    const target = rows.findIndex((el) => el.getAttribute('data-path') === toPath);
    const anchor = fromPath ? rows.findIndex((el) => el.getAttribute('data-path') === fromPath) : -1;
    if (target < 0 || anchor < 0) return [toPath];
    const lo = Math.min(anchor, target);
    const hi = Math.max(anchor, target);
    const out = [];
    for (let i = lo; i <= hi; i++) {
      const path = rows[i].getAttribute('data-path');
      if (this.view._isSelectablePath(path)) out.push(path);
    }
    return out;
  }

  /**
   * 原版 handleItemSelection：返回 true 表示点击已消费（调用方不再打开文件 / 折叠文件夹）。
   * Alt 切换、Shift 范围、点击已打开项只聚焦；Mod 与普通点击都落到清空选择集 + 更新锚点。
   */
  handleItemSelection(ev, item) {
    const mod = isModEvent(ev);
    if (!mod) {
      if (ev.altKey && !ev.shiftKey) {
        this.view._focusContainer();
        if (this.paths.has(item.path)) {
          this.deselect(item.path);
        } else {
          if (this.anchorPath) this.select(this.anchorPath);
          this.select(item.path);
          this.setFocus(item.path, false);
          this.anchorPath = item.path;
        }
        return true;
      }
      if (ev.shiftKey) {
        this.view._focusContainer();
        for (const path of this.rangePaths(this.anchorPath, item.path)) this.select(path);
        return true;
      }
      if (item.path === this.view._activePath) {
        this.view._focusContainer();
        this.setFocus(item.path, false);
        return true;
      }
    }
    if (ev instanceof MouseEvent) {
      this.clear();
      this.setFocus(null, false);
    }
    this.anchorPath = item.path;
    return false;
  }

  /** 原版 changeFocusedItem：焦点 / 锚点 / 选择集依次回退；越过首尾时不动。 */
  changeFocus(direction) {
    const rows = this.rows();
    if (!rows.length) return null;
    const indexOf = (path) => (path ? rows.findIndex((el) => el.getAttribute('data-path') === path) : -1);
    let index = indexOf(this.focusPath);
    if (index < 0) index = indexOf(this.anchorPath);
    if (index < 0) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (this.paths.has(rows[i].getAttribute('data-path'))) { index = i; break; }
      }
    }
    let next;
    if (index < 0) {
      next = direction === 'forwards' ? 0 : rows.length - 1;
    } else {
      next = index + (direction === 'forwards' ? 1 : -1);
      if (next < 0 || next >= rows.length) return null;
    }
    const path = rows[next].getAttribute('data-path');
    this.setFocus(path, true);
    return path;
  }

  /**
   * 原版 initializeKeyboardNav 的 DOM 版。原版 isMatch 精确比较修饰键集合：
   * ArrowUp/Down 注册为 []、Shift、Mod；ArrowLeft/Right 为 []、Mod；Enter / Space / F2 / Delete 为 []；mac 另有 Mod+Enter 与 Mod+Backspace。
   * mac 的 Enter 走重命名（Finder 惯例），Mod+Enter / Space 打开。
   */
  handleKeyDown(ev) {
    const target = ev.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return false;
    if (ev.altKey) return false;
    const mod = IS_MAC ? ev.metaKey : ev.ctrlKey;
    if (IS_MAC ? ev.ctrlKey : ev.metaKey) return false;
    const exact = (shift, modDown) => ev.shiftKey === shift && mod === modDown;
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!(exact(false, false) || exact(true, false) || exact(false, true))) return false;
        const previous = this.focusPath;
        this.changeFocus(ev.key === 'ArrowDown' ? 'forwards' : 'backwards');
        if (mod) this.view._openFocusedFile();
        if (ev.shiftKey) {
          if (previous) this.select(previous);
          if (this.focusPath) this.select(this.focusPath);
        }
        return true;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!(exact(false, false) || exact(false, true))) return false;
        if (ev.key === 'ArrowLeft') this._arrowLeft();
        else this._arrowRight();
        return true;
      }
      case 'Enter': {
        if (exact(false, true)) { this.view._openFocusedFile(); return true; }
        if (!exact(false, false)) return false;
        if (IS_MAC) this.view._renameFocused();
        else this.view._activateFocused();
        return true;
      }
      case ' ': {
        if (!exact(false, false)) return false;
        this.view._activateFocused();
        return true;
      }
      case 'F2': {
        if (!exact(false, false)) return false;
        this.view._renameFocused();
        return true;
      }
      case 'Delete': {
        if (!exact(false, false)) return false;
        this.view._deleteSelected();
        return true;
      }
      case 'Backspace': {
        if (!IS_MAC || !exact(false, true)) return false;
        this.view._deleteSelected();
        return true;
      }
      default:
        return false;
    }
  }

  /** 原版 onKeyArrowLeft：文件夹折叠 / 焦点上移到最外层已折叠祖先；根下文件按左 = 全部折叠。 */
  _arrowLeft() {
    const item = this.focusPath ? this.view._itemByPath(this.focusPath) : null;
    if (!item) return;
    const parent = parentPathOf(item.path);
    if (item instanceof TFile) {
      if (parent === '/') {
        this.view._setCollapsedAll(true);
        return;
      }
      this.view._setCollapsed(parent, true);
    } else if (this.view._collapsed.has(item.path)) {
      if (parent !== '/') this.setFocus(parent, true);
    } else {
      this.view._setCollapsed(item.path, true);
    }
    this._focusOutermostCollapsed();
  }

  /** 原版 onKeyArrowRight：展开文件夹 / 下钻；文件交给 onSelfClick（S8 覆写）。 */
  _arrowRight() {
    const item = this.focusPath ? this.view._itemByPath(this.focusPath) : null;
    if (!item) return;
    if (item instanceof TFile) {
      this.view._activateFocused();
    } else if (this.view._collapsed.has(item.path)) {
      this.view._setCollapsed(item.path, false);
    } else if (item.children && item.children.length) {
      this.changeFocus('forwards');
    }
  }

  _focusOutermostCollapsed() {
    let path = this.focusPath;
    while (path) {
      const parent = parentPathOf(path);
      if (parent === '/' || !this.view._collapsed.has(parent)) break;
      path = parent;
    }
    if (path && path !== this.focusPath) this.setFocus(path, true);
  }
}
