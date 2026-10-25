/**
 * [INPUT]: 依赖 ../core/modals.js 的 Modal；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/icons.js 的 setIcon；依赖 ../core/i18n.js 的 tt；依赖 ../core/suggest.js 的 renderHighlightedText；依赖 ./settings-tabs.js 的 AboutTab/EditorTab/FileTab；依赖 ./settings-tabs-appearance.js 的 AppearanceTab/InterfaceTab；依赖 ./settings-tabs-plugins.js 的 HotkeysTab/CorePluginsTab
 * [OUTPUT]: 导出 SettingTab（页签基类）、SettingsHost（设置模态宿主）、installSettingsHost(app)
 * [POS]: views/ 的设置模态宿主。核心插件页签在设置窗口打开时按「已启用 + 导出 settingTab」全量登记进侧栏「核心插件」分组（原版 1.14.4 行为：未点齿轮也可见）；插件启停时 registerCorePluginTabs/removePluginTabs 增删条目。DOM 逐字对齐原版 fte 类：modal.mod-settings.mod-sidebar-layout > .modal-content.vertical-tabs-container > .vertical-tab-header + .vertical-tab-content-container。app.setting 即本类实例；内置页签注册顺序为 关于 → 外观 → 界面 → 编辑器 → 文件与链接 → 快捷键 → 核心插件，第三方插件页不注册。1.14.4 popout：shouldUsePopout 读 vault 配置 settingsPopoutWindow，开启时主进程开独立窗口，窗口内 modalEl 直接挂 body（is-popout-modal）。子页面机制 openPage/closePage 对齐原版 openPage/closePage：.setting-page.vertical-tab-content > .setting-page-titlebar（返回钮 + 标题）+ .setting-page-content，栈顶页面标题写入弹窗标题。侧栏顶部是全局搜索（.setting-search-container + .setting-search-results），跨页签三路匹配设置项名、描述与别名（原版 loe.search：name/desc/aliases 取最高分），命中项高亮并可跳转到对应设置行。别名由 setSettingAliases 挂在设置行的 data-aliases 上（原版定义树的 aliases 字段），搜索索引从 DOM 采集它。匹配器与原版一致：查询按空格切词，每个词都必须是文本的子串（createSettingMatcher），故只有名称命中才高亮，描述或别名命中的行显示不带高亮的名称。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Settings host — modal shell + tab management, DOM 1:1 with the original. */
import { Modal } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';
import { syncTrafficLightPosition } from '../core/window-chrome.js';
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { SettingTab } from '../core/setting.js';
import { renderHighlightedText } from '../core/suggest.js';
import { AboutTab, EditorTab, FileTab } from './settings-tabs.js';
import { AppearanceTab, InterfaceTab } from './settings-tabs-appearance.js';
import { HotkeysTab, CorePluginsTab } from './settings-tabs-plugins.js';

export { SettingTab };

/** 核心插件设置页在左栏的图标：与各插件功能区入口保持同一图标。 */
const CORE_PLUGIN_ICONS = {
  'file-explorer': 'lucide-folder-closed',
  'global-search': 'lucide-search',
  'switcher': 'lucide-file-search',
  graph: 'lucide-git-fork',
  backlink: 'lucide-arrow-left-to-line',
  'outgoing-link': 'lucide-arrow-right-to-line',
  'tag-pane': 'lucide-tags',
  properties: 'lucide-list',
  'page-preview': 'lucide-eye',
  'daily-notes': 'lucide-calendar',
  templates: 'lucide-files',
  'note-composer': 'lucide-combine',
  'command-palette': 'lucide-terminal',
  'editor-status': 'lucide-edit-3',
  bookmarks: 'lucide-bookmark',
  outline: 'lucide-list-tree',
  'word-count': 'lucide-type',
  'file-recovery': 'lucide-history',
  'random-note': 'lucide-dices',
  'zk-prefixer': 'lucide-sheets-in-box',
  workspaces: 'lucide-layout',
  slides: 'lucide-presentation',
  'audio-recorder': 'lucide-mic',
  canvas: 'lucide-layout-dashboard',
};

/** 别名载体：设置行的 data-aliases（JSON 字符串数组），对应原版定义树的 aliases 字段。 */
function readSettingAliases(el) {
  const raw = el.getAttribute('data-aliases');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a === 'string' && a) : [];
  } catch (e) {
    return [];
  }
}

/**
 * 原版 gx/vx/fx：查询按空格切词，每个词都必须是文本的子串（AND），命中区间合并后返回。
 * 设置搜索的名称、描述、别名三路与页签名共用它，原版即用这一套。
 */
function createSettingMatcher(query) {
  const tokens = String(query || '').toLowerCase().split(' ').filter(Boolean);
  return (text) => {
    if (!text) return null;
    const lower = text.toLowerCase();
    const ranges = [];
    for (const token of tokens) {
      let from = 0;
      let hit = false;
      for (;;) {
        const at = lower.indexOf(token, from);
        if (at === -1) break;
        hit = true;
        ranges.push([at, at + token.length]);
        from = at + token.length + 1;
      }
      if (!hit) return null;
    }
    if (!ranges.length) return null;
    const matches = mergeMatchRanges(ranges);
    return { score: scoreMatchRanges(matches, query.length, text.length), matches };
  };
}

/** 原版 ix：按起点排序，合并相交或相接的命中区间。 */
function mergeMatchRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (last[1] < sorted[i][0]) merged.push(sorted[i].slice());
    else if (last[1] < sorted[i][1]) last[1] = sorted[i][1];
  }
  return merged;
}

/** 原版 cx：区间数、命中跨度、命中起点与文本长度的加权惩罚（分数越高越靠前）。 */
function scoreMatchRanges(ranges, queryLength, textLength) {
  if (!ranges.length) return 0;
  let score = 0;
  score -= Math.max(0, ranges.length - 1);
  const first = ranges[0][0];
  const last = ranges[ranges.length - 1][1];
  score -= (last - first + 1 - queryLength) / 100;
  score -= first / 1000;
  score -= textLength / 10000;
  return score;
}

/** 原版：别名逐条比对，取分数最高的一条作为该项的别名命中。 */
function matchAliases(match, aliases) {
  let best = null;
  for (const alias of aliases || []) {
    const hit = match(alias);
    if (hit && (!best || hit.score > best.score)) best = hit;
  }
  return best;
}

export class SettingsHost extends Modal {
  declare settingTabs: any[];
  declare pluginTabs: any[];
  declare activeTab: any;
  declare lastTabId: string;
  declare pageStack: any[];
  declare searchItemCache: any;
  declare isSearchActive: boolean;
  declare tabHeadersEl: any;
  declare searchContainerEl: any;
  declare searchResultsEl: any;
  declare tabGroupContainerEl: any;
  declare tabContainer: any;
  declare corePluginTabHeaderGroup: any;
  declare corePluginTabContainer: any;
  declare tabContentContainer: any;
  declare titleTextEl: any;
  declare searchInputEl: any;
  declare searchClearEl: any;

  constructor(app: App) {
    super(app);
    this.settingTabs = [];
    this.pluginTabs = [];       // 插件页签：{ id, name, icon, group: 'core', ... }
    this.activeTab = null;
    this.lastTabId = '';
    this.pageStack = [];        // 子页面栈：{ el, title }（对齐原版 openPage/closePage）
    this.searchItemCache = new Map();  // 页签 id → 离屏采集的搜索条目
    this.isSearchActive = false;
    this.modalEl.addClass('mod-settings', 'mod-sidebar-layout');
    this.updateModalTitle();
    this.contentEl.addClass('vertical-tabs-container');

    this.tabHeadersEl = this.contentEl.createDiv('vertical-tab-header', (header) => {
      // 原版：侧栏顶部是全局搜索，下面才是页签分组（两组都在 group-container 里）
      this.searchContainerEl = header.createDiv('setting-search-container');
      this.searchResultsEl = header.createDiv('setting-search-results');
      this.searchResultsEl.hide();
      this.tabGroupContainerEl = header.createDiv('vertical-tab-header-group-container', (groups) => {
        groups.createDiv('vertical-tab-header-group', (group) => {
          group.createDiv({ cls: 'vertical-tab-header-group-title', text: tt('setting.options', 'Options') });
          this.tabContainer = group.createDiv('vertical-tab-header-group-items');
          this.tabContainer.setAttr('data-section', 'options');
        });
        groups.createDiv('vertical-tab-header-group', (group) => {
          this.corePluginTabHeaderGroup = group.createDiv({ cls: 'vertical-tab-header-group-title', text: tt('setting.builtin-plugins', 'Core plugins') });
          this.corePluginTabHeaderGroup.hide();
          this.corePluginTabContainer = group.createDiv('vertical-tab-header-group-items');
          this.corePluginTabContainer.setAttr('data-section', 'core-plugins');
        });
      });
    });
    this.tabContentContainer = createDiv('vertical-tab-content-container');
    this.buildSearchInput();

    // 内置页签顺序对齐原版 1.14.4：关于 → 外观 → 界面 → 编辑器 → 文件与链接 → 快捷键 → 核心插件
    this.addSettingTab(new AboutTab(app, this));
    this.addSettingTab(new AppearanceTab(app, this));
    this.addSettingTab(new InterfaceTab(app, this));
    this.addSettingTab(new EditorTab(app, this));
    this.addSettingTab(new FileTab(app, this));
    this.addSettingTab(new HotkeysTab(app, this));
    this.addSettingTab(new CorePluginsTab(app, this));
    // 原版 1.14.4：核心插件在 onload 里注册设置页签，设置窗口一打开左栏就有
    // “核心插件”分组与全部已启用插件的条目，不需要先点齿轮。
    this.registerCorePluginTabs();
  }

  /** 已启用且导出 settingTab 的核心插件：全部登记为侧栏页签（幂等）。 */
  registerCorePluginTabs() {
    const entries = (this.app.plugins && this.app.plugins.internalPlugins) || {};
    for (const [id, entry] of Object.entries(entries)) {
      if (!entry || !entry.enabled) continue;
      this.ensureCorePluginTab(id, entry);
    }
    this.updatePluginSection();
  }

  /** 取得（必要时创建）某个核心插件的设置页签，并挂进侧栏“核心插件”分组。 */
  ensureCorePluginTab(pluginId, entry) {
    if (!entry) entry = this.app.plugins && this.app.plugins.getInternalPlugin(pluginId);
    const module = entry && entry.manifest && entry.manifest.module;
    if (!module || typeof module.settingTab !== 'function') return null;
    const existing = this.pluginTabs.find((x) => x.pluginId === pluginId);
    if (existing) return existing;
    const tab = new SettingTab(this.app, this);
    tab.id = pluginId;
    tab.name = entry.manifest.name;
    tab.icon = CORE_PLUGIN_ICONS[pluginId] || 'lucide-settings';
    tab.group = 'core';
    tab.pluginId = pluginId;
    tab.display = () => {
      tab.containerEl.empty();
      module.settingTab(this.app, tab.containerEl);
    };
    this.addSettingTab(tab);
    return tab;
  }

  updateModalTitle(tab?) {
    this.titleEl.empty();
    // 原版 titleTextEl：.modal-title 内的裸 div，返回按钮作为它的前一个兄弟
    this.titleTextEl = this.titleEl.createDiv();
    this.titleTextEl.setText(tab ? tab.name : tt('interface.settings', 'Settings'));
  }

  // -------------------------------------------------------------------------
  // 子页面（原版 openPage/closePage）：.setting-page 覆盖页签内容
  // -------------------------------------------------------------------------
  /**
   * 打开设置子页面。
   * @param {{title: string, build?: (contentEl: HTMLElement) => void}} options
   * @returns {HTMLElement} 页面根元素
   */
  openPage(options) {
    const { title, build } = options || {};
    this.closePage(true);
    const pageEl = createDiv('setting-page vertical-tab-content');
    const titlebar = pageEl.createDiv('setting-page-titlebar');
    const back = titlebar.createDiv('clickable-icon setting-page-back-button');
    setIcon(back, 'lucide-chevron-left');
    back.addEventListener('click', () => this.closePage());
    titlebar.createDiv('setting-page-title').setText(title || '');
    const contentEl = pageEl.createDiv('setting-page-content');
    const tab = this.activeTab;
    if (tab && tab.containerEl && tab.containerEl.parentElement === this.tabContentContainer) {
      tab.containerEl.detach();
    }
    this.tabContentContainer.appendChild(pageEl);
    this.pageStack.push({ el: pageEl, title: title || '' });
    this.updatePageTitle();
    if (typeof build === 'function') build(contentEl);
    this.markToggleRows(contentEl);
    return pageEl;
  }

  /** 关闭子页面：移除页面并把页签内容放回内容容器。 */
  closePage(silent?) {
    const page = this.pageStack.pop();
    if (!page) return false;
    page.el.remove();
    const tab = this.activeTab;
    if (tab && tab.containerEl && !tab.containerEl.parentElement) {
      this.tabContentContainer.appendChild(tab.containerEl);
    }
    if (!silent) this.updatePageTitle();
    return true;
  }

  /** 标题栏文案：栈顶页面优先，其次当前页签（对齐原版 updatePageTitle）。 */
  updatePageTitle() {
    if (!this.titleTextEl) return;
    if (this.pageStack.length) {
      this.titleTextEl.setText(this.pageStack[this.pageStack.length - 1].title);
      return;
    }
    if (this.activeTab) this.titleTextEl.setText(this.activeTab.name);
  }

  // -------------------------------------------------------------------------
  // 侧栏全局搜索（原版 searchIndex + onSearchChanged）
  // -------------------------------------------------------------------------
  /** 搜索框：.search-input-container.mod-raised > input[type=search] + 清除钮。 */
  buildSearchInput() {
    const wrap = this.searchContainerEl.createDiv('search-input-container mod-raised');
    this.searchInputEl = wrap.createEl('input', { type: 'search', attr: { enterkeyhint: 'search', spellcheck: 'false' } });
    this.searchInputEl.setAttribute('placeholder', tt('setting.search-settings', '搜索设置...'));
    this.searchClearEl = wrap.createDiv('search-input-clear-button');
    this.searchClearEl.addEventListener('mousedown', (ev) => ev.preventDefault());
    this.searchClearEl.addEventListener('click', () => {
      this.searchInputEl.value = '';
      this.onSearchChanged();
      this.searchInputEl.focus();
    });
    this.searchInputEl.addEventListener('input', () => this.onSearchChanged());
  }

  /**
   * 采集页签的可搜索条目（名称 + 描述 + 别名）。
   * 原版从页签定义树取值；本仓库页签直接建 DOM，故从已渲染的 DOM 采集；
   * 从未渲染过的页签离屏渲染一次并缓存，保证搜索跨页签。
   */
  collectSearchItems() {
    const items = [];
    for (const tab of this.settingTabs.concat(this.pluginTabs)) {
      for (const item of this.harvestTabItems(tab)) {
        items.push({ tab, name: item.name, desc: item.desc, aliases: item.aliases });
      }
    }
    return items;
  }

  /** 采集单个页签的条目；页签未渲染过时离屏渲染一次（结果缓存）。 */
  harvestTabItems(tab) {
    const container = tab.containerEl;
    if (container && container.childElementCount) return this.harvestItemsFrom(container);
    if (this.searchItemCache.has(tab.id)) return this.searchItemCache.get(tab.id);
    const probe = createDiv('vertical-tab-content');
    const original = tab.containerEl;
    tab.containerEl = probe;
    let items = [];
    try {
      tab.display();
      items = this.harvestItemsFrom(probe);
    } catch (e) {
      console.error('Settings search index failed', tab.id, (e && e.stack) || e);
    }
    tab.containerEl = original;
    this.searchItemCache.set(tab.id, items);
    return items;
  }

  /** 从渲染结果里取“名称 + 描述 + 别名”（跳过标题行）。 */
  harvestItemsFrom(root) {
    const out = [];
    for (const el of root.querySelectorAll('.setting-item:not(.setting-item-heading)')) {
      const nameEl = el.querySelector('.setting-item-name');
      if (!nameEl) continue;
      const descEl = el.querySelector('.setting-item-description');
      out.push({
        name: (nameEl.textContent || '').trim(),
        desc: descEl ? (descEl.textContent || '').trim() : '',
        aliases: readSettingAliases(el),
      });
    }
    return out;
  }

  /**
   * 原版 aliases：设置定义可带别名数组，搜索时与名称、描述同权重参与匹配。
   * 本仓库的搜索索引从 DOM 采集，故别名挂在设置行的 data-aliases 上（JSON 字符串数组）。
   */
  setSettingAliases(setting, aliases) {
    const list = (aliases || []).filter((a) => typeof a === 'string' && a.trim());
    if (!list.length) return setting;
    setting.settingEl.setAttr('data-aliases', JSON.stringify(list));
    return setting;
  }

  /** 原版 onSearchChanged：空查询恢复页签分组；有查询则渲染结果并隐藏分组。 */
  onSearchChanged() {
    const query = (this.searchInputEl.value || '').trim();
    if (!query) {
      this.isSearchActive = false;
      this.searchResultsEl.hide();
      this.searchResultsEl.empty();
      this.tabGroupContainerEl.show();
      return;
    }
    this.isSearchActive = true;
    this.tabGroupContainerEl.hide();
    this.searchResultsEl.show();
    this.searchResultsEl.empty();
    const groups = this.searchGroups(query);
    if (!groups.length) {
      this.searchResultsEl.createDiv({ cls: 'setting-search-empty', text: tt('setting.no-search-results', '未找到设置。') });
      return;
    }
    for (const group of groups) this.renderSearchGroup(group);
  }

  /**
   * 按页签分组：匹配设置项名、描述与别名（原版 loe.search 三路取最高分），
   * 组内按分数降序，组间按最高分降序。匹配器与原版一致：查询按空格切词，
   * 每个词都必须是文本的子串。
   */
  searchGroups(query) {
    const match = createSettingMatcher(query);
    const byTab = new Map();
    for (const item of this.collectSearchItems()) {
      const nameMatch = match(item.name);
      const descMatch = item.desc ? match(item.desc) : null;
      const aliasMatch = matchAliases(match, item.aliases);
      if (!nameMatch && !descMatch && !aliasMatch) continue;
      const score = Math.max(
        nameMatch ? nameMatch.score : -Infinity,
        descMatch ? descMatch.score : -Infinity,
        aliasMatch ? aliasMatch.score : -Infinity,
      );
      let group = byTab.get(item.tab);
      if (!group) {
        group = { tab: item.tab, tabNameMatch: match(item.tab.name), results: [], best: -Infinity };
        byTab.set(item.tab, group);
      }
      group.results.push({ name: item.name, desc: item.desc, nameMatch, descMatch, aliasMatch, score });
      group.best = Math.max(group.best, score);
    }
    const groups = [...byTab.values()].filter((g) => g.results.length || g.tabNameMatch);
    for (const group of groups) {
      group.best = Math.max(group.best, group.tabNameMatch ? group.tabNameMatch.score : -Infinity);
      group.results.sort((a, b) => b.score - a.score);
    }
    groups.sort((a, b) => b.best - a.best);
    return groups;
  }

  /** 渲染一组结果：页签行 + 设置项行（最多显示 3 条，其余收进“还有 N 个”）。 */
  renderSearchGroup(group) {
    const groupEl = this.searchResultsEl.createDiv('setting-search-result-group');
    const tabRow = groupEl.createDiv('vertical-tab-nav-item setting-search-result-tab tappable');
    tabRow.setAttr('tabindex', '-1');
    if (group.tab.icon) tabRow.createDiv('vertical-tab-nav-item-icon', (el) => setIcon(el, group.tab.icon));
    const textEl = tabRow.createDiv('setting-search-result-tab-text');
    const labelEl = textEl.createDiv('setting-search-result-tab-label');
    renderHighlightedText(labelEl, group.tab.name, group.tabNameMatch ? group.tabNameMatch.matches : null);
    tabRow.createDiv('vertical-tab-nav-item-chevron', (el) => setIcon(el, 'lucide-chevron-right'));
    tabRow.addEventListener('click', () => this.openSearchResult(group, null));

    const itemsEl = groupEl.createDiv('setting-search-result-group-items');
    const hidden = [];
    group.results.forEach((result, index) => {
      const row = itemsEl.createDiv('vertical-tab-nav-item setting-search-result-item tappable');
      row.setAttr('tabindex', '-1');
      if (index >= 3) { row.hide(); hidden.push(row); }
      const titleEl = row.createDiv('vertical-tab-nav-item-title');
      // 原版 hoe：只有名称命中才高亮；描述或别名命中的行显示不带高亮的名称
      renderHighlightedText(titleEl, result.name, result.nameMatch ? result.nameMatch.matches : null);
      row.createDiv('vertical-tab-nav-item-chevron', (el) => setIcon(el, 'lucide-chevron-right'));
      row.addEventListener('click', () => this.openSearchResult(group, result));
    });
    if (hidden.length) {
      const more = itemsEl.createDiv('vertical-tab-nav-item setting-search-result-item setting-search-result-show-more tappable');
      more.setAttr('tabindex', '-1');
      more.setText(tt('setting.search-show-more', '还有 {{count}} 个', { count: hidden.length }));
      more.addEventListener('click', () => {
        for (const el of hidden) el.show();
        more.detach();
        if (hidden[0]) hidden[0].focus();
      });
    }
  }

  /** 打开搜索结果所在页签，并滚动/闪烁高亮对应设置行（原版 scrollToDefinition）。 */
  openSearchResult(group, result) {
    this.openTab(group.tab);
    if (!result) return;
    const el = this.findSettingRow(group.tab, result.name);
    if (!el) return;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    el.addClass('is-flashing');
    setTimeout(() => el.removeClass('is-flashing'), 750);
  }

  /** 在页签内容里找名称匹配的行。 */
  findSettingRow(tab, name) {
    if (!tab || !tab.containerEl) return null;
    for (const el of tab.containerEl.querySelectorAll('.setting-item')) {
      const nameEl = el.querySelector('.setting-item-name');
      if (nameEl && (nameEl.textContent || '').trim() === name) return el;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 独立窗口（1.14.4 popout）：shouldUsePopout/getPopoutOptions/getRootEl 与原版同名同行
  // -------------------------------------------------------------------------
  /** 原版：vault 配置 settingsPopoutWindow（默认 true）；设置窗口自身永不嵌套 popout。 */
  shouldUsePopout() {
    if (this.app.isSettingsWindow) return false;
    if (this.app.settings.appSettings.settingsPopoutWindow === false) return false;
    // E2E 验收默认走应用内模态（单窗口断言）；settings-window 场景以 __SETTINGS_POPOUT_FORCE__ 显式开窗
    if (!window.__SETTINGS_POPOUT_FORCE__) {
      try { if (process.env.E2E === '1') return false; } catch (e) {}
    }
    return true;
  }
  /** 原版 getPopoutOptions：900x700，min 600x400。 */
  getPopoutOptions() { return { width: 900, height: 700, minWidth: 600, minHeight: 400 }; }
  /** 原版：popout 文档里 modalEl 直接挂 body（body > .modal.mod-settings）；应用内仍是 modal-container。 */
  getRootEl() { return this.app.isSettingsWindow ? this.modalEl : this.containerEl; }

  /** 向主进程请求开窗/聚焦，并接力目标页签。 */
  _openPopoutWindow(tabId) {
    let background = '';
    try { background = getComputedStyle(document.body).backgroundColor; } catch (e) {}
    try {
      Desktop.settingsWindowOpen({
        vaultId: this.app.vaultId,
        tabId: tabId || '',
        ...this.getPopoutOptions(),
        background,
      });
    } catch (e) { /* 主进程不可用时保持静默（测试宿主） */ }
  }

  open() {
    if (this.shouldUsePopout()) { this._openPopoutWindow(this.lastTabId); return this; }
    return this.openInApp();
  }

  /** 主进程已裁决回退应用内模态：绕过本地配置缓存（设置窗口写的配置尚未同步到本渲染器）。 */
  openInApp() {
    if (this.app.isSettingsWindow) document.body.addClass('is-popout-modal');
    this.registerCorePluginTabs();
    const result = super.open();
    // popout 的 --traffic-lights-offset 变为 32px；必须在类生效后重算，否则沿用主窗 (14,12)
    if (this.app.isSettingsWindow) syncTrafficLightPosition();
    return result;
  }

  close() {
    // 设置窗口自身：只关本模态并通知主进程销毁窗口（配置为 popout 时也走这里）
    if (this.app.isSettingsWindow) {
      const r = super.close();
      try { Desktop.settingsWindowClose(); } catch (e) {}
      return r;
    }
    // 应用内模态正在显示：先按模态关闭。否则开关写入 true 后再关，会因 shouldUsePopout() 成真而滞留。
    if (this.containerEl.isConnected) return super.close();
    if (this.shouldUsePopout()) { try { Desktop.settingsWindowClose(); } catch (e) {} return this; }
    return super.close();
  }

  addSettingTab(tab) {
    if (!tab || !tab.id) return;
    if (!tab.containerEl) tab.containerEl = createDiv('vertical-tab-content');
    if (!tab.navEl) {
      tab.navEl = createDiv('vertical-tab-nav-item tappable', (nav) => {
        nav.setAttr('data-setting-id', tab.id);
        if (tab.icon) nav.createDiv('vertical-tab-nav-item-icon', (iconEl) => setIcon(iconEl, tab.icon));
        nav.createDiv({ cls: 'vertical-tab-nav-item-title', text: tab.name });
        nav.createDiv('vertical-tab-nav-item-chevron', (chev) => setIcon(chev, 'lucide-chevron-right'));
        nav.addEventListener('click', () => this.openTab(tab));
      });
    }
    if (this.isPluginSettingTab(tab)) {
      this.pluginTabs.push(tab);
    } else {
      this.settingTabs.push(tab);
      this.tabContainer.appendChild(tab.navEl);
    }
    this.updatePluginSection();
  }

  removeSettingTab(tab) {
    const id = typeof tab === 'string' ? tab : tab && tab.id;
    this.pluginTabs = this.pluginTabs.filter((x) => x.id !== id);
    this.settingTabs = this.settingTabs.filter((x) => x.id !== id);
    if (this.activeTab && this.activeTab.id === id) this.closeActiveTab();
    this.updatePluginSection();
  }

  /** 核心插件在禁用时移除其设置页签（plugins.js 调用）。 */
  removePluginTabs(pluginId) {
    for (const tab of [...this.pluginTabs]) {
      if (tab.pluginId === pluginId) this.removeSettingTab(tab);
    }
  }

  isPluginSettingTab(tab) {
    return !!(tab.group === 'core' || tab.plugin);
  }

  updatePluginSection() {
    const core = this.pluginTabs.filter((tab) => tab.group === 'core');
    core.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    core.length ? this.corePluginTabHeaderGroup.show() : this.corePluginTabHeaderGroup.hide();
    this.corePluginTabContainer.empty();
    for (const tab of core) this.corePluginTabContainer.appendChild(tab.navEl);
  }

  openTab(tab) {
    if (!tab || !tab.containerEl) return;
    if (this.shouldUsePopout()) { this.lastTabId = tab.id; this._openPopoutWindow(tab.id); return; }
    this.pageStack = [];
    this.tabContentContainer.empty();
    this.updateModalTitle(tab);
    if (this.activeTab) {
      this.activeTab.navEl.removeClass('is-active');
      this.activeTab.hide();
    }
    this.activeTab = tab;
    this.lastTabId = tab.id;
    tab.navEl.addClass('is-active');
    this.tabContentContainer.appendChild(tab.containerEl);
    const backButton = createDiv('clickable-icon modal-setting-back-button mod-raised', (el) => {
      el.addEventListener('click', () => this.closeActiveTab());
      setIcon(el, 'lucide-arrow-left');
    });
    this.titleEl.prepend(backButton);
    this.contentEl.appendChild(this.tabContentContainer);
    try {
      tab.display();
      this.markToggleRows(tab.containerEl);
      this.searchItemCache.set(tab.id, this.harvestItemsFrom(tab.containerEl));
    } catch (e) {
      console.error('Settings tab failed', tab.id, (e && e.stack) || e);
    }
  }

  /**
   * 原版：带开关控件的设置行带 mod-toggle 类（决定 info/control 的对齐与宽度）。
   * core/setting.js 只读，这里在渲染后统一补齐。
   */
  markToggleRows(containerEl) {
    if (!containerEl) return;
    for (const row of containerEl.querySelectorAll('.setting-item')) {
      const control = row.querySelector(':scope > .setting-item-control');
      if (control && control.querySelector(':scope > .checkbox-container')) row.addClass('mod-toggle');
    }
  }

  closeActiveTab() {
    const tab = this.activeTab;
    if (tab) {
      this.pageStack = [];
      this.tabContentContainer.empty();
      tab.navEl.removeClass('is-active');
      tab.hide();
      this.updateModalTitle();
      this.activeTab = null;
    }
  }

  openTabById(id) {
    for (const tab of this.settingTabs) {
      if (tab.id === id) { this.openTab(tab); return tab; }
    }
    for (const tab of this.pluginTabs) {
      if (tab.id === id) { this.openTab(tab); return tab; }
    }
    return null;
  }

  /**
   * 核心插件的齿轮入口：为导出 settingTab(app, containerEl) 的插件生成设置页签，
   * 归入侧栏“核心插件”分组（对齐原版 G0 页签行为）。
   */
  openPluginOptions(pluginId) {
    const entry = this.app.plugins && this.app.plugins.getInternalPlugin(pluginId);
    if (!entry || !entry.manifest.module.settingTab) return;
    const tab = this.ensureCorePluginTab(pluginId, entry);
    if (tab) this.openTab(tab);
  }

  onOpen() {
    if (!this.openTabById(this.lastTabId)) this.openTab(this.settingTabs[0]);
  }

  onClose() {
    this.closeActiveTab();
  }
}

/** Installs the settings host on the app (idempotent). */
export function installSettingsHost(app: App) {
  if (app.setting) return app.setting;
  app.setting = new SettingsHost(app);
  return app.setting;
}
