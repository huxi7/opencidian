/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t/tt；依赖 ../core/setting.js 的 SettingGroup；依赖 ../markdown/reading.js 的 renderMarkdown/stripFrontmatter。
 * [OUTPUT]: 导出 nameKey、create(app)（page-preview 核心插件实例）与 settingTab(app, containerEl)。
 * [POS]: plugins-core/ 的页面预览。对齐原版 p7：悬停内部链接（阅读模式 a.internal-link[data-href]、实时预览 span.cm-wikilink[data-href]）
 *        显示 .popover.hover-popover；五类来源 editor/preview/search/tab-header/graph 各自可配置是否需按住 Mod。
 *        workspace 的 hover-link 事件带 targetEl 时（搜索结果行/出链/大纲等）贴目标元素定位，指针离开即收起，
 *        未按 Mod 时可「先悬停、再按 Mod」补弹；图谱节点无 targetEl，仍按指针坐标定位且不补弹。
 *        未按 Mod 时 DOM 链接只在悬停期间挂临时 keydown/mousemove 监听（原版 onHoverLink 延迟监听），
 *        全局 keydown/keyup 仅在等待 Mod 或 popover 存在时挂载，空闲即拆除。图谱来源无目标元素，
 *        按原版语义必须按住 Mod 才弹，未按 Mod 直接忽略。
 *        未解析链接显示 label-empty-note 提示。设置写 .obsidian/page-preview.json（loadPluginData/savePluginData）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: page-preview — hover popovers for internal links. */
import { t, tt } from '../core/i18n.js';
import { SettingGroup } from '../core/setting.js';
import { renderMarkdown, stripFrontmatter } from '../markdown/reading.js';

export const nameKey = 'plugins.page-preview';

const DATA_FILE = 'page-preview.json';
const SHOW_DELAY = 300;
/* 原版 workspace.registerHoverLinkSource：search/editor/tab-header 为 defaultMod:true，preview 为 false。
   graph 是本复刻的第五来源（原版无），沿用 Mod 门控。 */
const SOURCE_DEFAULT_MOD = { editor: true, preview: false, search: true, 'tab-header': true, graph: true };
const SOURCE_LABEL = {
  editor: ['plugins.page-preview.label-source-editor', '编辑模式'],
  preview: ['plugins.page-preview.label-source-preview', '预览模式'],
  search: ['plugins.page-preview.label-source-search', '搜索页、反向链接列表和出链列表'],
  'tab-header': ['plugins.page-preview.label-source-tab-header', '标签页标题'],
  graph: ['plugins.graph-view.name', '关系图谱'],
};

let overrides = {};
let persist = () => {};

/** 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）。 */
export function settingTab(app: App, containerEl) {
  containerEl.empty();
  overrides = app.settings.loadPluginData(DATA_FILE, {});
  persist = () => app.settings.savePluginData(DATA_FILE, overrides);
  const group = new SettingGroup(containerEl);
  group.setHeading(tt('plugins.page-preview.label-require-mod', '需要按住 {{key}} 来触发页面预览的情景', { key: 'Ctrl/Cmd' }));
  for (const source of Object.keys(SOURCE_DEFAULT_MOD)) {
    const [key, fallback] = SOURCE_LABEL[source];
    const current = Object.prototype.hasOwnProperty.call(overrides, source) ? !!overrides[source] : SOURCE_DEFAULT_MOD[source];
    group.addSetting((setting) => setting
      .setName(tt(key, fallback))
      .addToggle((tog) => tog.setValue(current).onChange((value) => {
        if (value === SOURCE_DEFAULT_MOD[source]) delete overrides[source];
        else overrides[source] = value;
        persist();
      })));
  }
}

export function create(app: App) {
  overrides = app.settings.loadPluginData(DATA_FILE, {});
  persist = () => app.settings.savePluginData(DATA_FILE, overrides);

  let popoverEl = null;
  let targetEl = null;
  let showTimer = null;
  let hideTimer = null;
  let hoverHandle = null;
  let hoverParent = null;
  let lastPointer = null;
  let modWatch = null;           // 悬停但未按 Mod：只在悬停期间挂临时键盘/移动监听
  let keysAttached = false;      // 全局 keydown/keyup 仅在等待 Mod 或 popover 存在时挂载
  let targetWatch = null;        // hover-link 带 targetEl 时：指针离开目标即收起

  const modPressed = (ev) => !!(ev && (ev.metaKey || ev.ctrlKey));

  function modRequired(source) {
    return Object.prototype.hasOwnProperty.call(overrides, source) ? !!overrides[source] : !!SOURCE_DEFAULT_MOD[source];
  }

  function sourceOf(el) {
    if (el.closest('.markdown-source-view')) return 'editor';
    if (el.closest('.markdown-reading-view, .markdown-preview-view')) return 'preview';
    if (el.closest('.workspace-tab-header')) return 'tab-header';
    if (el.closest('.search-result, .tree-item, .backlink-pane, .outgoing-link-pane, .tag-pane, .workspace-leaf-content[data-type="search"], .workspace-leaf-content[data-type="backlink"], .workspace-leaf-content[data-type="outgoing-link"]')) return 'search';
    return 'preview';
  }

  function findSourcePath(el) {
    const leafEl = el.closest('.workspace-leaf');
    const leaf = leafEl && leafEl._leaf;
    const file = leaf && leaf.view && leaf.view.file;
    return file ? file.path : '';
  }

  function linkAnchor(t) {
    if (!t || !t.closest) return null;
    return t.closest('a.internal-link[data-href], span.cm-wikilink[data-href]');
  }

  function hidePopover() {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    showTimer = null; hideTimer = null;
    cleanupModWatch();
    releaseTargetWatch();
    if (popoverEl) { popoverEl.detach(); popoverEl = null; }
    targetEl = null;
    releaseHandle();
    releaseKeysIfIdle();
  }

  /* 原版 onHoverLink 的延迟监听：不把 keydown 常驻在 document 上。
     只有「已悬停但未按 Mod」时才挂一组临时监听；按下 Mod、移出目标、输入字符或 2s 无移动即拆除。 */
  function ensureKeys() {
    if (keysAttached) return;
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    keysAttached = true;
  }

  function releaseKeysIfIdle() {
    if (!keysAttached || modWatch || popoverEl) return;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    keysAttached = false;
  }

  function cleanupModWatch() {
    if (!modWatch) { releaseKeysIfIdle(); return; }
    clearTimeout(modWatch.timer);
    document.removeEventListener('mousemove', modWatch.onMove, true);
    document.removeEventListener('mouseover', modWatch.onOver, true);
    modWatch = null;
    releaseKeysIfIdle();
  }

  function armModWatch(target) {
    cleanupModWatch();
    modWatch = { anchor: target.anchor || null, show: target.show || null, timer: 0 };
    const reset = () => {
      if (!modWatch) return;
      clearTimeout(modWatch.timer);
      modWatch.timer = setTimeout(() => cleanupModWatch(), 2000);
    };
    modWatch.onMove = (ev) => {
      lastPointer = { x: ev.clientX, y: ev.clientY };
      reset();
    };
    modWatch.onOver = (ev) => {
      const anchor = modWatch && modWatch.anchor;
      if (anchor && ev.target !== anchor && !anchor.contains(ev.target)) cleanupModWatch();
    };
    document.addEventListener('mousemove', modWatch.onMove, true);
    document.addEventListener('mouseover', modWatch.onOver, true);
    ensureKeys();
    reset();
  }

  /* hover-link 来源（图谱引擎）持有的句柄，对齐原版 parent.hoverPopover：onTarget/onHover + transition() */
  function attachHandle(parent) {
    if (!parent) return null;
    const handle = {
      onTarget: true,
      /* 原版 detect()：鼠标真的停在 popover 上才算 onHover，避免合成事件下的悬停误判 */
      get onHover() { return pointerOverPopover(); },
      get isShown() { return !!popoverEl && popoverEl.isConnected; },
      transition() { if (this.onTarget || this.onHover) keepAlive(); else scheduleHide(); },
      hide() { if (hoverParent && hoverParent.hoverPopover === this) hidePopover(); },
    };
    hoverHandle = handle;
    hoverParent = parent;
    parent.hoverPopover = handle;
    return handle;
  }

  /* 最后指针位置（原版 JQ）与命中测试（原版 detect 的 elementFromPoint） */
  function pointerOverPopover() {
    if (!popoverEl || !lastPointer) return false;
    const el = document.elementFromPoint(lastPointer.x, lastPointer.y);
    return !!el && (el === popoverEl || popoverEl.contains(el));
  }

  function releaseHandle() {
    if (hoverParent && hoverParent.hoverPopover === hoverHandle) hoverParent.hoverPopover = null;
    hoverHandle = null;
    hoverParent = null;
  }

  function keepAlive() { clearTimeout(hideTimer); hideTimer = null; }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePopover, 200);
  }

  /* 建外壳：popover 自身被悬停时视为仍在目标上（原版 onHover） */
  function createPopover() {
    const el = createDiv('popover hover-popover');
    el.style.opacity = '0';
    document.body.appendChild(el);
    popoverEl = el;
    el.addEventListener('mouseenter', () => keepAlive());
    el.addEventListener('mouseleave', () => scheduleHide());
    return el;
  }

  /* 原版 JZ.show：Gw(hoverEl, 80ms, --anim-motion-swing, opacity 0→1) */
  function fadeIn(el) {
    let easing = 'cubic-bezier(0, 0.55, 0.45, 1)';
    try {
      const token = getComputedStyle(document.body).getPropertyValue('--anim-motion-swing').trim();
      if (token) easing = token;
    } catch (e) {}
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, easing });
    anim.onfinish = () => { el.style.opacity = ''; };
  }

  /* 填充内容：未解析链接显示空态；已创建文件按原版嵌块结构渲染（inline title + 正文）。
     原版 E1.create：hoverEl.createDiv() → embedRegistry.load() → .markdown-embed > .markdown-embed-content，
     预览头部的 .inline-title 是文件名，正文随嵌块滚动（max-height 400）。 */
  async function fillBody(el, href, sourcePath) {
    const dest = app.metadataCache.getFirstLinkpathDest(href, sourcePath);
    const file = dest ? app.vault.getFileByPath(dest) : null;
    if (!file) {
      el.createDiv('mod-empty', (empty) => empty.setText(
        tt('plugins.page-preview.label-empty-note', '“{{linktext}}” 未创建，点击以创建。', { linktext: href })));
      return;
    }
    const embed = el.createDiv('markdown-embed');
    embed.setAttr('data-type', 'markdown');
    const content = embed.createDiv('markdown-embed-content');
    const preview = content.createDiv('markdown-preview-view markdown-rendered');
    const sizer = preview.createDiv('markdown-preview-sizer markdown-preview-section');
    sizer.createDiv('inline-title').setText(file.basename);
    const body = sizer.createDiv('markdown-content');
    try {
      const text = await app.vault.read(file);
      await renderMarkdown(app, stripFrontmatter(text), body, file.path, { preview: true });
    } catch (e) {
      console.error(e);
    }
  }

  function position(el, anchor) {
    const rect = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 300;
    const h = el.offsetHeight || 200;
    let x = Math.min(rect.left, Math.max(8, window.innerWidth - w - 8));
    x = Math.max(8, x);
    let y = rect.bottom + 10;
    if (y + h > window.innerHeight - 8) y = Math.max(8, rect.top - h - 10);
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }

  /* 图谱画布没有逐节点 DOM：按 hover-link 事件携带的鼠标坐标定位（原版 nX.position 的 staticPos 分支） */
  function positionAtPoint(el, x, y) {
    const w = el.offsetWidth || 300;
    const h = el.offsetHeight || 200;
    const left = Math.max(8, Math.min(x, Math.max(8, window.innerWidth - w - 8)));
    let top = y + 10;
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 10);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  async function showFor(anchor) {
    const href = anchor.getAttribute('data-href');
    if (!href) return;
    hidePopover();
    targetEl = anchor;
    const el = createPopover();
    ensureKeys();
    await fillBody(el, href, findSourcePath(anchor));
    position(el, anchor);
    fadeIn(el);
  }

  /* 原版 onHoverLink → onLinkHover：来源默认门控为需按住 Mod 时，不按 Mod 不显示 */
  async function showForHoverLink(info) {
    const parent = info.hoverParent;
    /* 延迟期间悬停已结束（合成事件、快速划过、画布重排）：不再打开预览 */
    if (parent && typeof parent.isHoveringLink === 'function' && !parent.isHoveringLink(info.linktext)) return;
    hidePopover();
    const el = createPopover();
    attachHandle(parent);
    ensureKeys();
    await fillBody(el, info.linktext, info.sourcePath || '');
    /* 原版 E1.create：有 targetEl 时贴目标元素定位（搜索结果行/出链/大纲等），
       没有 targetEl（图谱画布节点）时按指针坐标定位。 */
    const target = info.targetEl;
    if (target && target.isConnected) {
      position(el, target);
      watchTarget(target);
    } else {
      positionAtPoint(el, info.event.clientX, info.event.clientY);
    }
    fadeIn(el);
  }

  /* 原版 hoverPopover 的 onTarget/onHover 语义：指针离开目标元素即收起，
     移进浮层本身不算离开（浮层自身 hover 会 keepAlive）。 */
  function watchTarget(target) {
    releaseTargetWatch();
    const onOut = (ev) => {
      const to = ev.relatedTarget;
      if (to && popoverEl && popoverEl.contains(to)) return;
      if (to && target.contains(to)) return;
      scheduleHide();
    };
    target.addEventListener('pointerout', onOut, true);
    targetWatch = { target, onOut };
  }

  function releaseTargetWatch() {
    if (!targetWatch) return;
    targetWatch.target.removeEventListener('pointerout', targetWatch.onOut, true);
    targetWatch = null;
  }

  const onPointerOver = (ev) => {
    const anchor = linkAnchor(ev.target);
    if (!anchor) return;
    if (anchor === targetEl) return;
    if (popoverEl && popoverEl.contains(ev.target)) { keepAlive(); return; }
    const source = sourceOf(anchor);
    /* 原版：未按 Mod 时先不弹，只挂临时监听；已悬停后再按 Mod 也能补弹 */
    if (modRequired(source) && !modPressed(ev)) { armModWatch({ anchor }); return; }
    cleanupModWatch();
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTimer = null;
      if (anchor.isConnected) showFor(anchor).catch((e) => console.error(e));
    }, SHOW_DELAY);
  };

  /* workspace 的 hover-link 事件：图谱、搜索结果行、出链等非 DOM 链接来源请求预览
     （原版 app.workspace.on('hover-link') → onLinkHover）。
     原版：来源默认门控为需按住 Mod 时，不按 Mod 不显示；有 targetEl 时可「先悬停、再按 Mod」补弹，
     图谱节点没有 targetEl，所以没有补弹路径。 */
  const onHoverLink = (info) => {
    if (!info || !info.event || !info.linktext) return;
    if (modRequired(info.source) && !modPressed(info.event)) {
      if (!info.targetEl) return;
      armModWatch({
        anchor: info.targetEl,
        show: () => {
          clearTimeout(showTimer);
          showTimer = setTimeout(() => {
            showTimer = null;
            showForHoverLink(info).catch((e) => console.error(e));
          }, SHOW_DELAY);
        },
      });
      return;
    }
    cleanupModWatch();
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTimer = null;
      showForHoverLink(info).catch((e) => console.error(e));
    }, SHOW_DELAY);
  };

  const onPointerOut = (ev) => {
    const anchor = linkAnchor(ev.target);
    if (anchor && anchor === targetEl) scheduleHide();
    if (anchor && modWatch && modWatch.anchor === anchor) {
      const intoPopover = popoverEl && ev.relatedTarget && popoverEl.contains(ev.relatedTarget);
      if (!intoPopover) cleanupModWatch();
    }
  };

  const onDocMouseDown = (ev) => {
    cleanupModWatch();
    if (popoverEl && !popoverEl.contains(ev.target)) hidePopover();
  };
  const onScroll = (ev) => {
    cleanupModWatch();
    if (!popoverEl) return;
    // 嵌块自身在 400px 高度内滚动时不能关闭预览
    const target = ev && ev.target;
    if (target && target.nodeType === 1 && popoverEl.contains(target)) return;
    hidePopover();
  };
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') { hidePopover(); return; }
    if (!modWatch) return;
    /* 原版：方向键或普通字符输入立即取消等待；Mod 按下则补弹 */
    if (!modPressed(ev)) {
      if (ev.key.startsWith('Arrow') || ev.key.length === 1) cleanupModWatch();
      return;
    }
    const anchor = modWatch.anchor;
    const show = modWatch.show;
    cleanupModWatch();
    if (show) { show(); return; }
    if (anchor && anchor.isConnected) showFor(anchor).catch((e) => console.error(e));
  };

  /* 松开 Mod：Mod 门控来源的预览随之收起（原版语义） */
  const onKeyUp = (ev) => {
    if (ev.key !== 'Meta' && ev.key !== 'Control') return;
    if (!popoverEl) return;
    if (targetEl && modRequired(sourceOf(targetEl)) && !modPressed(ev)) hidePopover();
    else if (!targetEl && hoverParent) hidePopover();
  };
  const onPointerMove = (ev) => { lastPointer = { x: ev.clientX, y: ev.clientY }; };

  let hoverLinkRef = null;
  return {
    onload() {
      document.addEventListener('pointerover', onPointerOver, true);
      document.addEventListener('pointerout', onPointerOut, true);
      document.addEventListener('mousedown', onDocMouseDown, true);
      window.addEventListener('mousemove', onPointerMove, true);
      window.addEventListener('scroll', onScroll, true);
      hoverLinkRef = app.workspace.on('hover-link', onHoverLink);
    },
    onunload() {
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('mousedown', onDocMouseDown, true);
      window.removeEventListener('mousemove', onPointerMove, true);
      window.removeEventListener('scroll', onScroll, true);
      cleanupModWatch();
      if (keysAttached) {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
        keysAttached = false;
      }
      if (hoverLinkRef) { hoverLinkRef.unregister(); hoverLinkRef = null; }
      hidePopover();
    },
  };
}
