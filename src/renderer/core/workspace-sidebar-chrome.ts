/**
 * [INPUT]: 依赖 ./workspace-model.js 的 WorkspaceTabs；依赖 ./dom.js 的 createDiv；依赖 ./icons.js 的 setIcon；依赖 ./i18n.js 的 tt；依赖 ./ipc.js 的 Desktop。
 * [OUTPUT]: 导出 updateSidebarChrome；统一侧栏折叠态外观（mod-top 落位、开关迁移、分隔条、功能区底色）。
 * [POS]: core/ 的侧栏 chrome 控制器。workspace-renderer 首次渲染后调用，Workspace.toggleSidebar 也调用；不持有模型状态，只读写 DOM 与 workspace 上的 toggle 缓存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WorkspaceTabs } from './workspace-model.js';
import { createDiv } from './dom.js';
import { setIcon } from './icons.js';
import { tt } from './i18n.js';
import { Desktop } from './ipc.js';

/** 原版 DD：{duration:140, fn:--anim-motion-swing}（cubic-bezier(0,0.55,0.45,1)）。 */
const TOGGLE_ANIM = { duration: 140, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' };

const togglePadLeft = (el) => {
  try { const v = parseInt(getComputedStyle(el).paddingLeft, 10); return Number.isFinite(v) ? v : 0; }
  catch (e) { return 0; }
};

/**
 * 原版 y()：toggle 迁移的 FLIP 动画。
 * oldStyle='offset' → 克隆幽灵从 newPad 滑到 -w（并补 left 偏移）；'none' → 直接消失；'' → 不动画。
 * newStyle='offset' → 新位置的按钮从 -(w+oldPad) 滑入；'' → 不动画。
 */
function moveToggle(toggle, target, opts: Record<string, any> = {}) {
  if (!toggle || !target || toggle.parentElement === target) return;
  const { prepend = false, oldStyle = '', newStyle = '' } = opts;
  const parent = toggle.parentElement;
  const width = toggle.offsetWidth;
  const oldPad = parent ? togglePadLeft(parent) : 0;
  const newPad = togglePadLeft(target);
  const drop = (el) => { try { el.remove(); } catch (e) { /* ignore */ } };
  // 宿主可能没有动画/克隆能力（内存 DOM 回归）：退化为纯迁移
  const canAnimate = typeof toggle.animate === 'function' && typeof toggle.cloneNode === 'function';
  if (parent && oldStyle !== '' && canAnimate) {
    const ghost = toggle.cloneNode(true);
    toggle.replaceWith(ghost);
    if (oldStyle === 'offset') {
      ghost.animate(
        [{ marginLeft: newPad + 'px', left: '0px' }, { marginLeft: -width + 'px', left: -oldPad + 'px' }],
        TOGGLE_ANIM,
      ).finished.then(() => drop(ghost)).catch(() => drop(ghost));
    } else if (oldStyle !== 'none') {
      ghost.style.overflow = 'hidden';
      ghost.animate([{ width: width + 'px' }, { width: '0px' }], TOGGLE_ANIM)
        .finished.then(() => drop(ghost)).catch(() => drop(ghost));
    } else {
      drop(ghost);   // 原版 'none'：幽灵配空动画立即完成并移除
    }
  }
  if (prepend) target.prepend(toggle); else target.appendChild(toggle);
  if (parent && newStyle !== '' && typeof toggle.animate === 'function') {
    if (newStyle === 'offset') {
      toggle.animate(
        [{ marginLeft: -(width + oldPad) + 'px', left: -oldPad + 'px' }, { marginLeft: '0px', left: '0px' }],
        TOGGLE_ANIM,
      );
    } else if (newStyle !== 'none') {
      toggle.style.overflow = 'hidden';
      toggle.animate([{ width: '0px' }, { width: width + 'px' }], TOGGLE_ANIM)
        .finished.then(() => { toggle.style.overflow = ''; }).catch(() => { toggle.style.overflow = ''; });
    }
  }
}

/**
 * 原版 updateFrameless：把 mod-top 归位到每个分支的上排标签组。
 * 顶栏底色变量（--tab-container-background）只挂在这些组上，因此焦点态
 * 整条顶栏（含功能区左上角）与中心标签栏必须由同一个变量驱动。
 * 顺带清掉平台留白类，避免折叠/展开后残留（原版每轮先 remove 再 add）。
 */
function syncTopTabs(workspace) {
  const groups = [];
  const collect = (node) => {
    if (node instanceof WorkspaceTabs) { groups.push(node); return; }
    for (const child of node.children || []) collect(child);
  };
  collect(workspace.rootSplit);
  for (const tabs of groups) {
    if (tabs.containerEl) tabs.containerEl.removeClass('mod-top', 'mod-top-left-space', 'mod-top-right-space');
  }
  const walk = (node) => {
    if (node instanceof WorkspaceTabs) { if (node.containerEl) node.containerEl.addClass('mod-top'); return; }
    if (!node.children || !node.children.length) return;
    // 横排（vertical）的每个孩子在同一个上排；纵排（horizontal）只有首个孩子在顶部
    if (node.direction === 'vertical') for (const child of node.children) walk(child);
    else walk(node.children[0]);
  };
  walk(workspace.rootSplit);
}

/** 左栏收起后开关移至中心标题栏，底部操作保留在功能区。 */
export function updateSidebarChrome(workspace) {
  syncTopTabs(workspace);
  const centerTabs = [];
  const collect = node => {
    if (node instanceof WorkspaceTabs) centerTabs.push(node);
    else for (const child of node.children || []) collect(child);
  };
  collect(workspace.centerSplit);
  const leftTabs = workspace._firstTabsIn(workspace.leftSplit);
  const rightTabs = workspace._firstTabsIn(workspace.rightSplit);
  const left = !workspace.leftSplit.collapsed && leftTabs ? leftTabs : centerTabs[0];
  const right = !workspace.rightSplit.collapsed && rightTabs ? rightTabs : centerTabs.at(-1);
  for (const side of ['left', 'right']) {
    const split = side === 'left' ? workspace.leftSplit : workspace.rightSplit;
    workspace.containerEl.toggleClass(`is-${side}-sidedock-open`, !split.collapsed);
    const key = side === 'left' ? 'leftSidebarToggleEl' : 'rightSidebarToggleEl';
    if (!workspace[key]) {
      const toggle = workspace[key] = createDiv(`sidebar-toggle-button mod-${side} mod-${side === 'left' ? 'primary' : 'secondary'}`);
      toggle.setAttr('role', 'button'); toggle.setAttr('tabindex', '0');
      setIcon(toggle.createDiv('clickable-icon'), 'sidebar-toggle-button-icon');
      toggle.onclick = () => workspace.toggleSidebar(side);
      toggle.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); workspace.toggleSidebar(side); }
      };
    }
    const toggle = workspace[key];
    const target = side === 'left' ? left : right;
    const title = split.collapsed ? tt('interface.sidebar-expand', '展开') : tt('interface.sidebar-collapse', '收起');
    toggle.setAttr('aria-label', title); toggle.setAttr('title', title);
    toggle.setAttr('aria-expanded', String(!split.collapsed));
    if (side === 'left') {
      // 原版：macOS hidden 标题栏或 ribbon 隐藏时走 FLIP 迁移；否则开关常驻功能区顶部
      const body = document.body;
      const macHidden = body.hasClass('mod-macos') && body.hasClass('is-hidden-frameless');
      const useFlip = !body.hasClass('show-ribbon') || macHidden;
      if (!useFlip && workspace.ribbonEl) {
        moveToggle(toggle, workspace.ribbonEl, { prepend: true });
      } else if (target?._headersOuter) {
        if (workspace.leftSplit.collapsed) moveToggle(toggle, target._headersOuter, { prepend: true, oldStyle: 'none', newStyle: 'offset' });
        else moveToggle(toggle, target._headersOuter, { oldStyle: 'offset', newStyle: '' });
      }
    } else if (target?._headersOuter) {
      if (workspace.rightSplit.collapsed) moveToggle(toggle, target._headersOuter, { oldStyle: 'none', newStyle: '' });
      else moveToggle(toggle, target._headersOuter, { newStyle: '' });
    }
  }
  // 折叠侧的分隔条淡出（原版 r.style.opacity：0/1；否则 1px 线会横穿标题栏红绿灯区）。
  // 原版折叠时整个 split 连分隔条一起隐藏，不再占位；我们挂在根分割上，宽度一并归零，
  // 否则功能区与编辑区之间会多出 1px 竖缝，并打断顶栏底边那条 1px 横线。
  const dividers = workspace._dividerHandles || {};
  const applyDivider = (el, collapsed) => {
    if (!el) return;
    el.style.opacity = collapsed ? '0' : '1';
    el.style.pointerEvents = collapsed ? 'none' : '';   // 折叠后不可交互
    if (el.hasClass('mod-vertical')) {
      el.style.width = collapsed ? '0px' : '';
      // 展开时用负右外边距把 1px 手柄覆盖到中心区首像素；折叠时归零，避免偷走 1px 编辑区宽度
      el.style.marginInlineEnd = collapsed ? '0px' : '';
    }
  };
  applyDivider(dividers.left, workspace.leftSplit.collapsed);
  applyDivider(dividers.right, workspace.rightSplit.collapsed);
  // 原版 updateFrameless：开关宿主与折叠侧首组都带平台留白类（红绿灯净空）
  for (const [group, key] of [[leftTabs, 'mod-top-left-space'], [rightTabs, 'mod-top-right-space']]) {
    if (group && group.containerEl) group.containerEl.addClass(key);
  }
  if (left?.containerEl) left.containerEl.addClass('mod-top-left-space');
  if (right?.containerEl) right.containerEl.addClass('mod-top-right-space');
  // 原版 Ribbon.setCollapsedState：收起只换功能区底色（--ribbon-background-collapsed），不隐藏
  if (workspace.ribbonEl) workspace.ribbonEl.toggleClass('is-collapsed', workspace.leftSplit.collapsed);
  if (!workspace._ribbonSettingsFallback) {
    workspace._ribbonSettingsFallback = createDiv('sidebar-profile-fallback');
    const actions = [
      ['open-vault', '切换仓库', () => Desktop.openStarter()],
      ['lucide-settings', tt('interface.settings', '设置'), () => workspace.app.setting.open()],
    ];
    for (const [icon, label, action] of actions) {
      const button = workspace._ribbonSettingsFallback.createDiv('clickable-icon side-dock-ribbon-action');
      button.setAttr('role', 'button'); button.setAttr('tabindex', '0');
      button.setAttr('aria-label', label); button.setAttr('title', label);
      setIcon(button, icon); button.onclick = action;
      button.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
      };
    }
    workspace.ribbonSettingsEl.appendChild(workspace._ribbonSettingsFallback);
  }
  workspace._ribbonSettingsFallback.toggle(workspace.leftSplit.collapsed);
}
