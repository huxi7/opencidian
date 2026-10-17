/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/setting.js 的 SearchComponent/Setting/SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal/confirmDialog；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/keymap.js 的 hotkeyToString/eventToHotkey；依赖 ../core/default-hotkeys.js 的 DEFAULT_HOTKEYS；依赖 ../core/menu.js 的 Menu；依赖 ../core/icons.js 的 setIcon；依赖 ../core/commands.js 的命令注册表
 * [OUTPUT]: 导出 HotkeysTab、CorePluginsTab、CommunityPluginsTab
 * [POS]: views/ 的插件相关设置页签。快捷键页对齐原版 w0：筛选菜单 + hotkey-filter 芯片、按快捷键捕获筛选（window keydown 捕获替代原版 keymap scope，本仓库 Keymap 注册不了通配 handler）、has-conflict 冲突芯片、setting-command-hotkeys 行结构，暴露 setQuery/setHotkeyFilter 供插件跳转。核心插件页对齐 dte：.setting-group-search 裸搜索 + 自动聚焦，行内齿轮/快捷键入口按启用与注册状态显隐。第三方插件页对齐 tte 启用布局并补行内齿轮/快捷键/卸载（confirmDialog 警告后 plugins.uninstallPlugin）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Plugin-related settings tabs: Hotkeys / Core plugins / Community plugins. */
import { tt } from '../core/i18n.js';
import { SearchComponent, Setting, SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Modal, confirmDialog } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';
import { hotkeyToString, eventToHotkey } from '../core/keymap.js';
import { DEFAULT_HOTKEYS } from '../core/default-hotkeys.js';
import { Menu } from '../core/menu.js';
import { setIcon } from '../core/icons.js';

/* --------------------------------------------------------------- shared */

/** 原版 Hk.addSearch 的裸搜索容器：.setting-group-search 直接挂 SearchComponent，无名称行。 */
function addGroupSearch(group, placeholder, onChange) {
  const containerEl = group.groupEl.createDiv('setting-group-search');
  group.groupEl.insertBefore(containerEl, group.listEl);
  const search = new SearchComponent(containerEl);
  search.setPlaceholder(placeholder).onChange(onChange);
  return search;
}

/** 打开快捷键页并按插件 id 前缀过滤（原版核心/社区插件行的 lucide-plus-circle 入口）。 */
function openHotkeysFor(setting, pluginId) {
  const tab = setting.openTabById('hotkeys');
  if (tab && typeof tab.setQuery === 'function') tab.setQuery(pluginId);
}

/** 插件是否注册了命令：id 前缀命中；核心插件实例登记了 deregister/deregisterCommands 也视为有命令。 */
function hasPluginCommands(app, pluginId) {
  if (Object.keys(app.commands.commands).some((cid) => cid.startsWith(pluginId + ':'))) return true;
  const entry = app.plugins.getInternalPlugin(pluginId);
  const instance = entry && entry.instance;
  return !!(instance && (typeof instance.deregisterCommands === 'function' || typeof instance.deregister === 'function'));
}

/** 社区插件的设置页签是否已注册（PluginSettingTab.id 即插件 id）。 */
function hasPluginSettingsTab(setting, pluginId) {
  return setting.pluginTabs.some((tab) => tab.id === pluginId || tab.pluginId === pluginId
    || (tab.plugin && tab.plugin.manifest && tab.plugin.manifest.id === pluginId));
}

/* ----------------------------------------------------------------- Hotkeys */

/** 原版 y0：hotkey-filter 芯片。remove() 先清 value 再出场，避免移除回调读到旧筛选值。 */
class FilterChip {
  constructor(parentEl) {
    this.value = null;
    this.handleRemove = null;
    this.el = createDiv('hotkey-filter', (el) => {
      this.innerEl = el.createDiv('hotkey-filter-inner');
      this.removeEl = el.createDiv('hotkey-filter-remove-button', (removeEl) => {
        setIcon(removeEl, 'lucide-x');
        removeEl.setAttr('aria-label', tt('interface.menu.close', '关闭'));
      });
    });
    if (parentEl) parentEl.appendChild(this.el);
  }

  setValue(value) { this.value = value; return this; }
  setTitle(title) { this.innerEl.setText(title); return this; }
  onRemove(callback) {
    this.handleRemove = callback;
    this.removeEl.addEventListener('click', this.remove.bind(this));
    return this;
  }

  remove() {
    this.value = null;
    if (this.el.isShown()) {
      this.el.detach();
      if (this.handleRemove) this.handleRemove();
    }
  }
}

/** 原版 b0：状态筛选 → 菜单标题。键序即菜单项顺序。 */
const STATUS_FILTER_LABELS = {
  'show-all': () => tt('setting.hotkeys.label-show-all', '全部'),
  'show-assigned': () => tt('setting.hotkeys.label-show-assigned', '已分配'),
  'show-user-assigned': () => tt('setting.hotkeys.label-show-user-assigned', '由我分配'),
  'show-unassigned': () => tt('setting.hotkeys.label-show-unassigned', '未分配'),
};

export class HotkeysTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.hotkeys.name', '快捷键');
    this.id = 'hotkeys';
    this.icon = 'command';
    this.searchComponent = null;
    this.headerComponent = null;
    this.filterContainerEl = null;
    this.hotkeyListContainerEl = null;
    this.statusFilter = null;
    this.hotkeyFilter = null;
    this.filterHotkeyActiveEl = null;
    this._captureHandler = null;
  }

  display() {
    this.containerEl.empty();
    this.finishFilteringByHotkey();
    this.statusFilter = null;
    this.hotkeyFilter = null;

    const group = new SettingGroup(this.containerEl);
    group.addSetting((s) => {
      this.headerComponent = s;
      s.setName(tt('setting.hotkeys.option-search', '搜索快捷键'));
      s.addButton((b) => {
        b.buttonEl.addClass('clickable-icon');
        setIcon(b.buttonEl, 'lucide-filter');
        b.buttonEl.addEventListener('click', (ev) => this.showFilterMenu(ev));
      });
      s.addSearch((search) => {
        this.searchComponent = search;
        search.setPlaceholder(tt('setting.hotkeys.prompt-filter', '搜索…'))
          .onChange(() => this.updateHotkeyVisibility());
        const container = search.containerEl;
        container.addClass('mod-hotkey');
        const filterHotkeyEl = container.createDiv('input-right-decorator clickable-icon');
        setIcon(filterHotkeyEl, 'lucide-keyboard');
        filterHotkeyEl.setAttr('aria-label', tt('setting.hotkeys.tooltip-filter-by-hotkey', '按快捷键筛选'));
        this.filterHotkeyActiveEl = createSpan({
          cls: 'setting-hotkey mod-active input-right-decorator',
          text: tt('setting.hotkeys.label-waiting-for-hotkey-press', '按下快捷键…'),
        });
        filterHotkeyEl.addEventListener('click', () => {
          if (this.filterHotkeyActiveEl.isShown()) { this.finishFilteringByHotkey(); return; }
          container.appendChild(this.filterHotkeyActiveEl);
          this.startFilteringByHotkey();
        });
      });
    });

    this.filterContainerEl = group.listEl.createDiv('setting-filter-container');
    this.statusFilter = new FilterChip()
      .setTitle(tt('setting.hotkeys.label-show-all', '全部'))
      .onRemove(() => this.setStatusFilter('show-all'));
    this.hotkeyListContainerEl = group.listEl.createDiv('hotkey-list-container');
    this.updateHotkeyVisibility();
    this.searchComponent.inputEl.focus();
  }

  hide() { this.finishFilteringByHotkey(); }

  /** 进入按快捷键筛选捕获态：吞掉按键并转成筛选条件；Esc 取消（同时清掉现有快捷键筛选）。 */
  startFilteringByHotkey() {
    if (this._captureHandler) return;
    this._captureHandler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        if (this.hotkeyFilter) this.hotkeyFilter.remove();
        this.finishFilteringByHotkey();
        this.updateHotkeyVisibility();
        return;
      }
      const hotkey = eventToHotkey(ev);
      if (hotkey) this.setHotkeyFilter(hotkey);
    };
    window.addEventListener('keydown', this._captureHandler, true);
  }

  finishFilteringByHotkey() {
    if (this.filterHotkeyActiveEl) this.filterHotkeyActiveEl.detach();
    if (this._captureHandler) {
      window.removeEventListener('keydown', this._captureHandler, true);
      this._captureHandler = null;
    }
  }

  /** 原版 setHotkeyFilter：状态筛选芯片让位给快捷键芯片，列表只留绑定该组合的命令。 */
  setHotkeyFilter(hotkey) {
    if (this.statusFilter) this.statusFilter.remove();
    if (this.hotkeyFilter) this.hotkeyFilter.remove();
    this.hotkeyFilter = new FilterChip(this.filterContainerEl)
      .setValue(hotkey)
      .setTitle(hotkeyToString(hotkey))
      .onRemove(() => { this.hotkeyFilter = null; this.updateHotkeyVisibility(); });
    this.finishFilteringByHotkey();
    this.updateHotkeyVisibility();
  }

  /** 原版 setStatusFilter：选 show-all 时移除芯片，其余模式把芯片挂进筛选容器。 */
  setStatusFilter(mode) {
    if (this.hotkeyFilter) this.hotkeyFilter.remove();
    this.statusFilter.setValue(mode);
    if (mode === 'show-all') {
      this.statusFilter.remove();
    } else {
      if (!this.statusFilter.el.isShown()) this.filterContainerEl.appendChild(this.statusFilter.el);
      const label = STATUS_FILTER_LABELS[mode];
      this.statusFilter.setTitle(label ? label() : mode);
    }
    this.updateHotkeyVisibility();
  }

  /** 原版 showFilterMenu：工具栏 filter 按钮弹出勾选菜单，打开期间按钮带 has-active-menu。 */
  showFilterMenu(ev) {
    ev.preventDefault();
    const target = ev.currentTarget;
    if (target.hasClass('has-active-menu')) return;
    const menu = new Menu(this.app);
    const current = (this.statusFilter && this.statusFilter.value) || 'show-all';
    for (const mode of Object.keys(STATUS_FILTER_LABELS)) {
      menu.addItem((item) => item
        .setTitle(STATUS_FILTER_LABELS[mode]())
        .setChecked(current === mode)
        .onClick(() => this.setStatusFilter(mode)));
    }
    menu.setParentElement(target).showAtMouseEvent(ev);
  }

  /** 原版 setQuery：写入搜索词、聚焦并重筛；核心插件页的快捷键入口按插件 id 前缀过滤。 */
  setQuery(query) {
    if (!this.searchComponent) return;
    this.searchComponent.inputEl.value = query;
    this.searchComponent.inputEl.focus();
    this.updateHotkeyVisibility();
  }

  /** 原版 setDescription：计数与冲突数写入搜索行描述，冲突数为 mod-warning span。 */
  setDescription(count, conflicts) {
    if (!this.headerComponent) return;
    const descEl = this.headerComponent.descEl;
    descEl.empty();
    descEl.createSpan({ text: tt('setting.hotkeys.option-search-desc', '显示 {{count}} 个快捷键。', { count }) });
    if (conflicts) {
      descEl.createSpan({ cls: 'mod-warning', text: tt('setting.hotkeys.option-search-conflict', '有 {{count}} 个冲突命令。', { count: conflicts }) });
    }
  }

  /** 原版 updateHotkeyVisibility：全量命令建冲突表，再按搜索/状态/快捷键三重条件出行。 */
  updateHotkeyVisibility() {
    const app = this.app;
    if (!this.hotkeyListContainerEl) return;
    const listEl = this.hotkeyListContainerEl;
    listEl.empty();
    const hotkeysSetting = app.settings.hotkeys || {};
    const customOf = (commandId) => {
      if (!Object.prototype.hasOwnProperty.call(hotkeysSetting, commandId)) return null;
      const value = hotkeysSetting[commandId];
      return Array.isArray(value) ? value : [];
    };
    const sorted = Object.values(app.commands.commands)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));

    // 原版 oc：快捷键文本 → 绑定者 { id, name } 列表（先全量建表，再逐行判冲突）
    const owners = new Map();
    const addOwner = (text, command) => {
      if (!owners.has(text)) owners.set(text, []);
      owners.get(text).push(command);
    };
    for (const cmd of sorted) {
      const custom = customOf(cmd.id);
      const bound = custom !== null ? custom : (DEFAULT_HOTKEYS[cmd.id] || []);
      for (const hk of bound) addOwner(hotkeyToString(hk), { id: cmd.id, name: cmd.name });
    }

    const query = (this.searchComponent ? this.searchComponent.inputEl.value : '').toLowerCase();
    const statusMode = (this.statusFilter && this.statusFilter.value) || 'show-all';
    const filterText = this.hotkeyFilter ? hotkeyToString(this.hotkeyFilter.value) : '';
    const conflicts = new Set();
    let shown = 0;

    for (const cmd of sorted) {
      const custom = customOf(cmd.id);
      const defaults = DEFAULT_HOTKEYS[cmd.id];
      const hasCustom = custom !== null;
      const hasDefaults = Array.isArray(defaults) && defaults.length > 0;
      if (query && !String(cmd.name).toLowerCase().includes(query) && !cmd.id.toLowerCase().startsWith(query)) continue;
      const bound = hasCustom ? custom : (defaults || []);
      if (filterText && !bound.some((hk) => hotkeyToString(hk) === filterText)) continue;
      if (statusMode === 'show-assigned' && !hasDefaults && !hasCustom) continue;
      if (statusMode === 'show-user-assigned' && !hasCustom) continue;
      if (statusMode === 'show-unassigned' && (hasCustom || hasDefaults)) continue;
      shown++;

      const setting = new Setting(listEl);
      setting.setName(cmd.name);
      const row = setting.controlEl.createDiv('setting-command-hotkeys');
      const buildChip = (hotkey, onDelete) => {
        const text = hotkeyToString(hotkey);
        const others = (owners.get(text) || []).filter((owner) => owner.id !== cmd.id);
        row.createSpan('setting-hotkey', (chip) => {
          if (others.length) {
            chip.addClass('has-conflict');
            // 原版：点冲突芯片 → 清搜索 + 按该快捷键筛选
            chip.addEventListener('click', (ev) => {
              if (ev.defaultPrevented) return;
              this.setQuery('');
              this.setHotkeyFilter(hotkey);
            });
            if (others.length === 1) {
              chip.setAttr('aria-label', tt('setting.hotkeys.tooltip-hotkey-single-conflict', '该快捷键与 “{{command}}” 冲突', { command: others[0].name }));
            } else {
              chip.setAttr('aria-label', tt('setting.hotkeys.tooltip-hotkey-multiple-conflicts', '该快捷键与其他 {{count}} 个快捷键冲突', { count: others.length }));
            }
          }
          chip.appendText(' ' + text + ' ');
          chip.createSpan('setting-hotkey-icon setting-delete-hotkey', (del) => {
            setIcon(del, 'lucide-x');
            del.setAttr('aria-label', tt('setting.hotkeys.tooltip-delete-hotkey', '删除快捷键'));
            del.addEventListener('click', (ev) => { ev.preventDefault(); onDelete(); });
          });
        });
      };

      if (hasCustom) {
        for (const hk of custom) {
          const text = hotkeyToString(hk);
          for (const owner of (owners.get(text) || [])) if (owner.id !== cmd.id) conflicts.add(owner.id);
          buildChip(hk, () => {
            const next = custom.filter((x) => hotkeyToString(x) !== text);
            app.settings.setHotkey(cmd.id, next.length ? next : null);
            app.hotkeyManager.buildCustomKeys();
            this.updateHotkeyVisibility();
          });
        }
      } else if (hasDefaults) {
        for (const hk of defaults) {
          const text = hotkeyToString(hk);
          buildChip(hk, () => {
            const next = defaults.filter((x) => hotkeyToString(x) !== text);
            app.settings.setHotkey(cmd.id, next.length ? next : null);
            app.hotkeyManager.buildCustomKeys();
            this.updateHotkeyVisibility();
          });
        }
      } else {
        row.createSpan({ cls: 'setting-hotkey mod-empty', text: tt('setting.hotkeys.label-blank-hotkey', '未设置') });
      }

      if (hasCustom) {
        setting.controlEl.createSpan('clickable-icon setting-restore-hotkey-button', (el) => {
          setIcon(el, 'lucide-rotate-ccw');
          el.setAttr('aria-label', tt('setting.hotkeys.tooltip-restore-default', '恢复默认'));
          el.addEventListener('click', () => {
            app.settings.setHotkey(cmd.id, null);
            app.hotkeyManager.buildCustomKeys();
            this.updateHotkeyVisibility();
          });
        });
      }
      setting.controlEl.createSpan('clickable-icon setting-add-hotkey-button', (el) => {
        setIcon(el, 'lucide-plus-circle');
        el.setAttr('aria-label', tt('setting.hotkeys.tooltip-customize-command', '自定义快捷键'));
        el.addEventListener('click', () => new HotkeyRecorderModal(app, cmd, () => this.updateHotkeyVisibility()).open());
      });
    }
    this.setDescription(shown, conflicts.size);
  }
}

/** 录制弹窗：按下组合键写入该命令。Escape 取消。 */
class HotkeyRecorderModal extends Modal {
  constructor(app, command, onDone) {
    super(app);
    this.app = app;
    this.command = command;
    this.onDone = onDone;
    this.setTitle(command.name);
  }

  onOpen() {
    this.contentEl.createDiv({
      cls: 'hotkey-recorder',
      text: tt('setting.hotkeys.label-waiting-for-hotkey-press', '按下快捷键…'),
    });
    this._keyHandler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') { this.close(); return; }
      const hk = eventToHotkey(ev);
      if (!hk) return;
      const current = this.app.hotkeyManager.getHotkeys(this.command.id);
      this.app.settings.setHotkey(this.command.id, [...current, hk]);
      this.app.hotkeyManager.buildCustomKeys();
      this.close();
      this.onDone && this.onDone();
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }

  onClose() {
    window.removeEventListener('keydown', this._keyHandler, true);
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------ Core plugins */

export class CorePluginsTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.builtin-plugins', '核心插件');
    this.id = 'plugins';
    this.icon = 'toy-brick';
  }

  display() { this.render(true); }

  /** 原版 dte.render：裸搜索框 + 行内齿轮/快捷键入口 + 开关；入口按启用与注册状态显隐。 */
  render(focusSearch = false) {
    const app = this.app;
    this.containerEl.empty();
    let query = '';
    const group = new SettingGroup(this.containerEl);
    const rowsEl = group.listEl;
    const renderRows = () => {
      rowsEl.empty();
      const entries = Object.entries(app.plugins.internalPlugins)
        .sort((a, b) => String(a[1].manifest.name).localeCompare(String(b[1].manifest.name), 'zh'));
      for (const [id, entry] of entries) {
        const name = entry.manifest.name || id;
        const desc = entry.manifest.description || '';
        if (query && !name.toLowerCase().includes(query) && !desc.toLowerCase().includes(query)) continue;
        const hasSettingTab = !!(entry.manifest.module && entry.manifest.module.settingTab);
        const setting = new Setting(rowsEl);
        setting.setName(name);
        setting.setDesc(desc);
        let gearEl = null;
        let hotkeysEl = null;
        setting.addExtraButton((b) => {
          gearEl = b.extraSettingsEl;
          b.setIcon('lucide-settings')
            .setTooltip(tt('setting.plugin-options', '插件选项'))
            .onClick(() => this.setting.openPluginOptions(id));
        });
        setting.addExtraButton((b) => {
          hotkeysEl = b.extraSettingsEl;
          hotkeysEl.addClass('mod-hotkeys');
          b.setIcon('lucide-plus-circle')
            .setTooltip(tt('setting.hotkeys.name', '快捷键'))
            .onClick(() => openHotkeysFor(this.setting, id));
        });
        setting.addToggle((tog) => tog.setValue(!!entry.enabled).onChange(async (v) => {
          if (v) await app.plugins.enableInternalPlugin(id);
          else await app.plugins.disableInternalPlugin(id);
          renderRows();
        }));
        // 原版 d()：禁用时两个入口都隐藏；齿轮要注册设置页签，快捷键按钮要有命令
        const enabled = !!entry.enabled;
        gearEl.toggle(enabled && hasSettingTab);
        hotkeysEl.toggle(enabled && hasPluginCommands(app, id));
      }
    };
    const search = addGroupSearch(group,
      tt('setting.core-plugin.placeholder-search-plugin', '搜索插件…'),
      (v) => { query = String(v || '').trim().toLowerCase(); renderRows(); });
    if (focusSearch) setTimeout(() => search.inputEl.focus(), 0);
    renderRows();
  }
}

/* ------------------------------------------------------- Community plugins */

export class CommunityPluginsTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.third-party-plugin.name', '第三方插件');
    this.id = 'community-plugins';
    this.icon = 'puzzle';
  }

  display() { this.render(true); }

  /** 原版 tte.render：isEnabled() 为真走"已启用"布局，否则受限布局。 */
  render(focusSearch = false) {
    const plugins = this.app.plugins;
    this.containerEl.empty();
    const group = new SettingGroup(this.containerEl);
    if (plugins.isEnabled()) this.renderEnabled(group, plugins, focusSearch);
    else this.renderRestricted(group, plugins);
  }

  /** 安全模式开（受限布局）：不出示已装插件与开关。 */
  renderRestricted(group, plugins) {
    group.listEl.createEl('p', { text: tt('setting.third-party-plugin.label-exit-restricted-mode-description-1', 'Community plugins, like any other software you install, could potentially cause data integrity and security issues.') });
    group.listEl.createEl('p', { text: tt('setting.third-party-plugin.label-exit-restricted-mode-description-2', "Plugin security is important to us. Here's what we do:") });
    group.addClass('community-plugins-disclaimer');
    const disclaimers = [
      ['label-code-review', 'label-code-review-desc', 'lucide-inspect'],
      ['label-open-source', 'label-open-source-desc', 'lucide-github'],
      ['label-peer-audit', 'label-peer-audit-desc', 'lucide-users'],
      ['label-report-mechanism', 'label-report-mechanism-desc', 'lucide-bug'],
    ];
    for (const [nameKey, descKey, icon] of disclaimers) {
      group.addSetting((s) => s
        .setName(tt('setting.third-party-plugin.' + nameKey, ''))
        .setDesc(tt('setting.third-party-plugin.' + descKey, ''))
        .settingEl.prepend(createDiv('setting-icon', (el) => setIcon(el, icon))));
    }
    group.listEl.createEl('p', { text: tt('setting.third-party-plugin.label-exit-restricted-mode-disable-confirmation', 'Would you like to exit Restricted Mode to enable community plugins?') });
    const turnOn = this.containerEl.createDiv('community-modal-button-container')
      .createEl('button', { cls: 'mod-cta', text: tt('setting.third-party-plugin.button-turn-on-community-plugins', 'Turn on community plugins') });
    turnOn.addEventListener('click', async () => {
      await plugins.setEnable(true);
      this.render(); // 原版：启用后直接重渲染，不 reload
    });
    this.containerEl.createEl('p', {}, (el) => {
      el.createEl('a', {
        text: tt('setting.third-party-plugin.label-learn-more', 'Learn more about plugin security'),
        href: 'https://help.obsidian.md/plugin-security',
        attr: { target: '_blank', rel: 'noopener' },
      });
    });
  }

  /** 安全模式关（已启用布局）：安全模式开关 + 市场入口 + 已装插件列表。 */
  renderEnabled(group, plugins, focusSearch = false) {
    group.addSetting((s) => s
      .setName(tt('setting.third-party-plugin.option-restricted-mode', '安全模式'))
      .setDesc(tt('setting.third-party-plugin.option-restricted-mode-description', '安全模式已关闭。开启以限制第三方插件运行。'))
      .addButton((b) => b
        .setButtonText(tt('setting.third-party-plugin.button-turn-on', 'Turn on and reload'))
        .onClick(async () => {
          await plugins.setEnable(false);
          window.location.reload();
        })));

    group.addSetting((s) => s
      .setName(tt('setting.third-party-plugin.option-browse-community-plugins', '社区插件市场'))
      .setDesc(tt('setting.third-party-plugin.option-browse-community-plugins-description', '浏览、安装社区成员制作的第三方插件。'))
      .addButton((b) => b.setCta().setButtonText(tt('setting.third-party-plugin.button-browse', '浏览')).onClick(() => {
        // 原版打开市场弹窗（C0）；复刻版未接入市场，退化为提示
        new Notice(tt('setting.third-party-plugin.msg-market-unavailable', '复刻版未接入社区插件市场。'));
      })));

    const manifests = plugins.listInstalledManifests()
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh'));

    group.addSetting((s) => s
      .setName(tt('setting.third-party-plugin.label-current-plugins', '插件安装情况'))
      .setDesc(tt('setting.third-party-plugin.label-currently-installed', '你目前已经安装了 {{count}} 个插件。', { count: manifests.length })));

    group.addSetting((s) => s
      .setName(tt('setting.third-party-plugin.option-automatic-update-check', '自动检查插件更新'))
      .setDesc(tt('setting.third-party-plugin.option-automatic-update-check-desc', '定期检查第三方插件的更新。'))
      .addToggle((tog) => tog
        .setValue(!!plugins.autoCheckForUpdates)
        .onChange((v) => plugins.setAutomaticUpdateCheck(v))));

    const listGroup = new SettingGroup(this.containerEl)
      .setHeading(tt('setting.third-party-plugin.label-installed-plugins', '已安装插件'))
      .addClass('installed-plugins-container');
    listGroup.addExtraButton((b) => b
      .setIcon('lucide-refresh-cw')
      .setTooltip(tt('setting.third-party-plugin.button-reload-plugins', '重新加载插件'))
      .onClick(() => {
        // 原版 await loadManifests() 后提示；本实现每次渲染都从磁盘重读清单，故渲染即重载
        new Notice(tt('setting.third-party-plugin.msg-reloaded-third-party-plugins', '已重新加载第三方插件。'));
        this.render();
      }));
    listGroup.addExtraButton((b) => b
      .setIcon('lucide-folder-open')
      .setTooltip(tt('setting.third-party-plugin.button-open-plugins-folder', '打开插件文件夹'))
      .onClick(() => {
        try { Desktop.openPath(plugins.pluginDir()); } catch (e) { console.error(e); }
      }));

    const renderList = (query) => {
      listGroup.listEl.empty();
      const needle = String(query || '').trim().toLowerCase();
      for (const manifest of manifests) {
        const fields = [manifest.name, manifest.author, manifest.description].map((x) => String(x || '').toLowerCase());
        if (needle && !fields.some((text) => text.includes(needle))) continue;
        this.renderInstalledPlugin(listGroup, manifest);
      }
      // 已加载但不在磁盘清单里的插件也列出（原版 h 循环）：关闭即禁用
      for (const id of Object.keys(plugins.plugins)) {
        if (manifests.some((m) => m.id === id)) continue;
        this.renderRunningPlugin(listGroup, id);
      }
    };
    if (manifests.length > 0) {
      const search = addGroupSearch(listGroup,
        tt('setting.third-party-plugin.placeholder-search-installed-plugin', '搜索已安装的插件…'),
        (v) => renderList(v));
      if (focusSearch) setTimeout(() => search.inputEl.focus(), 0);
    }
    renderList('');
  }

  /** 已安装插件行：名称、版本/作者/描述、齿轮/快捷键/卸载入口、启用开关（开着=写入配置）。 */
  renderInstalledPlugin(listGroup, manifest) {
    const plugins = this.app.plugins;
    const id = manifest.id;
    const setting = new Setting(listGroup.listEl);
    setting.setName(manifest.name || id);
    setting.descEl.empty();
    if (manifest.version) setting.descEl.createDiv({ text: tt('setting.third-party-plugin.label-version', '版本: {{version}}', { version: manifest.version }) });
    if (manifest.author) setting.descEl.createDiv({ text: tt('setting.third-party-plugin.label-by-author', '作者：') + manifest.author });
    if (manifest.description) setting.descEl.createDiv({ text: manifest.description });

    let gearEl = null;
    let hotkeysEl = null;
    setting.addExtraButton((b) => {
      gearEl = b.extraSettingsEl;
      b.setIcon('lucide-settings')
        .setTooltip(tt('setting.plugin-options', '插件选项'))
        .onClick(() => this.setting.openTabById(id));
    });
    setting.addExtraButton((b) => {
      hotkeysEl = b.extraSettingsEl;
      hotkeysEl.addClass('mod-hotkeys');
      b.setIcon('lucide-plus-circle')
        .setTooltip(tt('setting.hotkeys.name', '快捷键'))
        .onClick(() => openHotkeysFor(this.setting, id));
    });
    setting.addExtraButton((b) => b
      .setIcon('lucide-trash-2')
      .setTooltip(tt('setting.third-party-plugin.label-uninstall', '卸载'))
      .onClick(() => { void this.uninstallPlugin(manifest); }));
    setting.addToggle((tog) => tog.setValue(!!plugins.plugins[id]).onChange(async (v) => {
      if (v) {
        const ok = await plugins.enableCommunityPlugin(id).catch((e) => { console.error(e); return false; });
        if (!ok) new Notice(tt('setting.third-party-plugin.msg-failed-load-plugins', '无法加载社区插件'));
      } else {
        const ok = await plugins.disableCommunityPlugin(id).catch((e) => { console.error(e); return false; });
        if (!ok) new Notice(tt('setting.third-party-plugin.msg-failed-to-disable-plugin', '无法禁用插件 “{{id}}”', { id }));
      }
      this.render();
    }));
    // 原版 d()：插件已加载才显示齿轮（有设置页签）与快捷键入口（有命令）
    const loaded = !!plugins.plugins[id];
    gearEl.toggle(loaded && hasPluginSettingsTab(this.setting, id));
    hotkeysEl.toggle(loaded && hasPluginCommands(this.app, id));
  }

  /** 原版 uninstallPlugin 入口：confirmDialog 警告 → disablePluginAndSave → 删除插件目录 → 重渲染。 */
  async uninstallPlugin(manifest) {
    const plugins = this.app.plugins;
    const id = manifest.id;
    const confirmed = await confirmDialog(this.app,
      tt('setting.third-party-plugin.label-uninstall-plugin', '卸载插件'),
      tt('setting.third-party-plugin.label-uninstall-plugin-confirmation', '确定要卸载此插件吗？这会删除插件文件夹。'),
      { cta: tt('setting.third-party-plugin.label-uninstall', '卸载'), warning: true });
    if (!confirmed) return;
    if (plugins.plugins[id]) {
      await plugins.disableCommunityPlugin(id).catch((e) => console.error(e));
    } else {
      // 未加载的插件 disableCommunityPlugin 不会落盘：手动从 community-plugins.json 移除（原版 disablePluginAndSave）
      this.app.settings.setCommunityPlugins((this.app.settings.communityPlugins || []).filter((x) => x !== id));
    }
    // 未加载过的插件 registers 里没有清单条目：补一次，让 uninstallPlugin 能定位磁盘目录
    if (!plugins.manifests[id] && manifest.dir) plugins.manifests[id] = manifest;
    plugins.uninstallPlugin(id);
    this.render();
  }

  /** 已加载但无磁盘清单的插件：开关只提供关闭（卸载并按配置移除）。 */
  renderRunningPlugin(listGroup, id) {
    const plugins = this.app.plugins;
    const manifest = (plugins.plugins[id] && plugins.plugins[id].manifest) || plugins.manifests[id] || { id };
    listGroup.addSetting((s) => s
      .setName(manifest.name || id)
      .setDesc(manifest.description || '')
      .addToggle((tog) => tog.setValue(true).onChange(async () => {
        await plugins.disableCommunityPlugin(id).catch((e) => console.error(e));
        this.render();
      })));
  }
}
