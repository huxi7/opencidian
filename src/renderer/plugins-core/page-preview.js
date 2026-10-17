/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t/tt；依赖 ../core/setting.js 的 SettingGroup；依赖 ../markdown/reading.js 的 renderMarkdown/stripFrontmatter。
 * [OUTPUT]: 导出 nameKey、create(app)（page-preview 核心插件实例）与 settingTab(app, containerEl)。
 * [POS]: plugins-core/ 的页面预览。对齐原版 p7：悬停内部链接（阅读模式 a.internal-link[data-href]、实时预览 span.cm-wikilink[data-href]）
 *        显示 .popover.hover-popover；四类来源 editor/preview/search/tab-header 各自可配置是否需按住 Mod。
 *        未解析链接显示 label-empty-note 提示。设置写 .obsidian/page-preview.json（loadPluginData/savePluginData）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: page-preview — hover popovers for internal links. */
import { t, tt } from '../core/i18n.js';
import { SettingGroup } from '../core/setting.js';
import { renderMarkdown, stripFrontmatter } from '../markdown/reading.js';

export const nameKey = 'plugins.page-preview';

const DATA_FILE = 'page-preview.json';
const SOURCE_DEFAULT_MOD = { editor: true, preview: false, search: false, 'tab-header': false };
const SOURCE_LABEL = {
  editor: ['plugins.page-preview.label-source-editor', '编辑模式'],
  preview: ['plugins.page-preview.label-source-preview', '预览模式'],
  search: ['plugins.page-preview.label-source-search', '搜索页、反向链接列表和出链列表'],
  'tab-header': ['plugins.page-preview.label-source-tab-header', '标签页标题'],
};

let overrides = {};
let persist = () => {};

/** 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）。 */
export function settingTab(app, containerEl) {
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

export function create(app) {
  overrides = app.settings.loadPluginData(DATA_FILE, {});
  persist = () => app.settings.savePluginData(DATA_FILE, overrides);

  let popoverEl = null;
  let targetEl = null;
  let showTimer = null;
  let hideTimer = null;

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
    if (popoverEl) { popoverEl.detach(); popoverEl = null; }
    targetEl = null;
  }

  function keepAlive() { clearTimeout(hideTimer); hideTimer = null; }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePopover, 200);
  }

  function position(el, anchor) {
    const rect = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 300;
    const h = el.offsetHeight || 200;
    let x = Math.min(rect.left, Math.max(8, window.innerWidth - w - 8));
    x = Math.max(8, x);
    let y = rect.bottom + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, rect.top - h - 6);
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }

  async function showFor(anchor) {
    const href = anchor.getAttribute('data-href');
    if (!href) return;
    hidePopover();
    targetEl = anchor;
    const el = createDiv('popover hover-popover');
    document.body.appendChild(el);
    popoverEl = el;
    el.addEventListener('mouseenter', keepAlive);
    el.addEventListener('mouseleave', scheduleHide);
    const dest = app.metadataCache.getFirstLinkpathDest(href, findSourcePath(anchor));
    const file = dest ? app.vault.getFileByPath(dest) : null;
    if (!file) {
      el.createDiv('mod-empty', (empty) => empty.setText(
        tt('plugins.page-preview.label-empty-note', '“{{linktext}}” 未创建，点击以创建。', { linktext: href })));
    } else {
      const content = el.createDiv('markdown-preview-view markdown-rendered');
      try {
        const text = await app.vault.read(file);
        await renderMarkdown(app, stripFrontmatter(text), content, file.path, { preview: true });
      } catch (e) {
        console.error(e);
      }
    }
    position(el, anchor);
  }

  const onPointerOver = (ev) => {
    const anchor = linkAnchor(ev.target);
    if (!anchor || anchor === targetEl) return;
    if (popoverEl && popoverEl.contains(ev.target)) { keepAlive(); return; }
    const source = sourceOf(anchor);
    if (modRequired(source) && !(ev.metaKey || ev.ctrlKey)) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTimer = null;
      if (anchor.isConnected) showFor(anchor).catch((e) => console.error(e));
    }, 300);
  };

  const onPointerOut = (ev) => {
    const anchor = linkAnchor(ev.target);
    if (anchor && anchor === targetEl) scheduleHide();
  };

  const onDocMouseDown = (ev) => {
    if (popoverEl && !popoverEl.contains(ev.target)) hidePopover();
  };
  const onScroll = () => { if (popoverEl) hidePopover(); };
  const onKeyDown = (ev) => { if (ev.key === 'Escape') hidePopover(); };

  return {
    onload() {
      document.addEventListener('pointerover', onPointerOver, true);
      document.addEventListener('pointerout', onPointerOut, true);
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('scroll', onScroll, true);
    },
    onunload() {
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      hidePopover();
    },
  };
}
