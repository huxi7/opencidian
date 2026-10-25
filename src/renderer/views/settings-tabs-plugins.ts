/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/setting.js 的 Setting/SettingGroup/SettingTab；依赖 ../core/keymap.js 的 hotkeyToString/eventToHotkey/hotkeysEqual；依赖 ../core/default-hotkeys.js 的 DEFAULT_HOTKEYS；依赖 ../core/icons.js 的 setIcon；依赖 ../core/commands.js 的命令注册表
 * 核心插件拒绝停用时，开关回显真实启用状态。
 * [OUTPUT]: 导出 HotkeysTab、CorePluginsTab
 * [POS]: views/ 的插件相关设置页签。快捷键页对齐原版 f3：.setting-group-search 裸搜索框 + setting-group-search-control 状态芯片（冲突 chip 带计数）、按快捷键捕获筛选（window keydown 捕获替代原版 keymap scope，本仓库 Keymap 注册不了通配 handler）、搜索框右缘 mod-active-hotkey-filter 组合键芯片、has-conflict 冲突芯片、行内录制态 setting-hotkey.mod-active、setting-command-hotkeys 行结构，暴露 setQuery/setHotkeyFilter 供插件跳转。核心插件页对齐 dte：.setting-group.mod-list 裸搜索 + 自动聚焦，搜索按词全匹配，行内齿轮/快捷键入口按启用与注册状态显隐，开关不重建行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Plugin-related settings tabs: Hotkeys / Core plugins. */
import { tt } from '../core/i18n.js';
import { Setting, SettingGroup, SettingTab } from '../core/setting.js';
import { hotkeyToString, eventToHotkey, hotkeysEqual } from '../core/keymap.js';
import { DEFAULT_HOTKEYS } from '../core/default-hotkeys.js';
import { setIcon } from '../core/icons.js';

/* --------------------------------------------------------------- shared */

/** 打开快捷键页并按插件 id 前缀过滤（原版核心/社区插件行的 lucide-plus-circle 入口）。 */
function openHotkeysFor(setting, pluginId) {
  const tab = setting.openTabById('hotkeys');
  if (tab && typeof tab.setQuery === 'function') tab.setQuery(pluginId);
}

/** 插件是否注册了命令：id 前缀命中；核心插件实例登记了 deregister/deregisterCommands 也视为有命令。 */
function hasPluginCommands(app: App, pluginId) {
  if (Object.keys(app.commands.commands).some((cid) => cid.startsWith(pluginId + ':'))) return true;
  const entry = app.plugins.getInternalPlugin(pluginId);
  const instance = entry && entry.instance;
  return !!(instance && (typeof instance.deregisterCommands === 'function' || typeof instance.deregister === 'function'));
}

/* ----------------------------------------------------------------- Hotkeys */

/** 原版 d3：状态筛选顺序与文案。冲突项按当前冲突数动态显示。 */
const STATUS_FILTERS: Array<[string, () => string]> = [
  ['show-conflicts', () => tt('setting.hotkeys.label-show-conflicts', '显示冲突')],
  ['show-all', () => tt('setting.hotkeys.label-show-all', '全部')],
  ['show-assigned', () => tt('setting.hotkeys.label-show-assigned', '已分配')],
  ['show-user-assigned', () => tt('setting.hotkeys.label-show-user-assigned', '由我分配')],
  ['show-unassigned', () => tt('setting.hotkeys.label-show-unassigned', '未分配')],
];

export class HotkeysTab extends SettingTab {
  declare name: any;
  declare id: string;
  declare icon: string;
  declare searchComponent: any;
  declare filterContainerEl: any;
  declare filterEls: any;
  declare activeStatusFilterEl: any;
  declare hotkeyListEl: any;
  declare statusFilter: string;
  declare hotkeyFilter: any;
  declare hotkeyFilterDecoratorEl: any;
  declare filterHotkeyActiveEl: any;
  declare commandBeingCustomized: any;
  declare _captureHandler: any;
  declare _customizeHandler: any;

  constructor(app: App, setting) {
    super(app, setting);
    this.name = tt('setting.hotkeys.name', '快捷键');
    this.id = 'hotkeys';
    this.icon = 'command';
    this.searchComponent = null;
    this.filterContainerEl = null;
    this.filterEls = {};
    this.activeStatusFilterEl = null;
    this.hotkeyListEl = null;
    this.statusFilter = 'show-all';
    this.hotkeyFilter = null;
    this.hotkeyFilterDecoratorEl = null;
    this.filterHotkeyActiveEl = null;
    this.commandBeingCustomized = null;
    this._captureHandler = null;
    this._customizeHandler = null;
  }

  display() {
    this.containerEl.empty();
    this.finishFilteringByHotkey();
    this.finishCustomizingHotkey();
    this.statusFilter = 'show-all';
    this.hotkeyFilter = null;
    this.filterEls = {};
    this.activeStatusFilterEl = null;

    const group = new SettingGroup(this.containerEl).addClass('mod-list').addClass('mod-hotkeys');
    group.addSearch((search) => {
      this.searchComponent = search;
      search.setPlaceholder(tt('setting.hotkeys.prompt-filter', '搜索…'))
        .onChange(() => this.updateHotkeyVisibility());
      search.containerEl.addClass('mod-hotkey');
      this.hotkeyFilterDecoratorEl = search.containerEl.createDiv('input-right-decorator clickable-icon');
      this.renderHotkeyFilterDecorator();
      this.hotkeyFilterDecoratorEl.addEventListener('click', (ev) => {
        if (ev.defaultPrevented || this.hotkeyFilter) return;
        search.containerEl.appendChild(this.filterHotkeyActiveEl);
        this.startFilteringByHotkey();
      });
      this.filterHotkeyActiveEl = createSpan({
        cls: 'setting-hotkey mod-active input-right-decorator',
        text: tt('setting.hotkeys.label-waiting-for-hotkey-press', '按下快捷键…'),
      });
      this.filterHotkeyActiveEl.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.finishFilteringByHotkey();
      });
    });

    // 原版 addSearchControl：筛选芯片独占搜索行下一行。
    group.addSearchControl((control) => {
      this.filterContainerEl = control.createDiv('setting-group-filters');
      for (const [mode, label] of STATUS_FILTERS) {
        const chip = this.filterContainerEl.createDiv({ cls: 'setting-group-filter', text: label() });
        if (mode === 'show-conflicts') chip.addClass('mod-error');
        chip.setAttr('tabIndex', '0');
        chip.addEventListener('click', () => this.setStatusFilter(mode));
        chip.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') this.setStatusFilter(mode);
        });
        this.filterEls[mode] = chip;
      }
      this.filterEls['show-conflicts'].hide();
      this.activeStatusFilterEl = this.filterEls['show-all'];
      this.activeStatusFilterEl.addClass('is-active');
    });

    this.hotkeyListEl = group.listEl;
    this.updateHotkeyVisibility();
    this.searchComponent.inputEl.focus();
  }

  hide() {
    this.finishFilteringByHotkey();
    this.finishCustomizingHotkey();
  }

  /** 进入按快捷键筛选捕获态：吞掉按键并转成筛选条件；Esc 取消（同时清掉现有快捷键筛选）。 */
  startFilteringByHotkey() {
    if (this._captureHandler) return;
    this._captureHandler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        this.finishFilteringByHotkey();
        this.setHotkeyFilter(null);
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

  /** 原版 commandBeingCustomized：行内进入录制态，按键直接写入该命令；Esc 取消。 */
  startCustomizingHotkey(command) {
    this.finishFilteringByHotkey();
    this.finishCustomizingHotkey();
    this.commandBeingCustomized = command;
    this._customizeHandler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        this.finishCustomizingHotkey();
        this.updateHotkeyVisibility();
        return;
      }
      const hk = eventToHotkey(ev);
      if (!hk) return;
      const current = this.app.hotkeyManager.getHotkeys(command.id);
      if (!current.some((existing) => hotkeysEqual(existing, hk))) {
        this.app.settings.setHotkey(command.id, [...current, hk]);
      }
      this.app.hotkeyManager.buildCustomKeys();
      this.finishCustomizingHotkey();
      this.updateHotkeyVisibility();
    };
    window.addEventListener('keydown', this._customizeHandler, true);
    this.updateHotkeyVisibility();
  }

  finishCustomizingHotkey() {
    if (this._customizeHandler) {
      window.removeEventListener('keydown', this._customizeHandler, true);
      this._customizeHandler = null;
    }
    this.commandBeingCustomized = null;
  }

  /** 原版 renderHotkeyFilterDecorator：无筛选显示键盘图标；有筛选显示组合键 + 清除钮。 */
  renderHotkeyFilterDecorator() {
    const el = this.hotkeyFilterDecoratorEl;
    if (!el) return;
    el.empty();
    el.toggleClass('mod-active-hotkey-filter', !!this.hotkeyFilter);
    el.toggleClass('clickable-icon', !this.hotkeyFilter);
    if (this.hotkeyFilter) {
      el.createSpan({ text: hotkeyToString(this.hotkeyFilter) });
      const clear = el.createSpan('hotkey-filter-clear');
      setIcon(clear, 'lucide-x');
      clear.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.setHotkeyFilter(null);
      });
    } else {
      setIcon(el, 'lucide-keyboard');
      el.setAttr('aria-label', tt('setting.hotkeys.tooltip-filter-by-hotkey', '按快捷键筛选'));
    }
  }

  /** 原版 setActiveHotkeyFilter：清空值即移除装饰器芯片并重筛。 */
  setHotkeyFilter(hotkey) {
    this.hotkeyFilter = hotkey || null;
    this.finishFilteringByHotkey();
    this.renderHotkeyFilterDecorator();
    this.updateHotkeyVisibility();
  }

  /** 原版 setActiveStatusFilter：只移动 is-active，不清除快捷键筛选。 */
  setStatusFilter(mode) {
    if (this.statusFilter === mode) return;
    this.statusFilter = mode;
    this.updateActiveFilterClass();
    this.updateHotkeyVisibility();
  }

  updateActiveFilterClass() {
    if (this.activeStatusFilterEl) this.activeStatusFilterEl.removeClass('is-active');
    this.activeStatusFilterEl = this.filterEls[this.statusFilter] || this.filterEls['show-all'];
    if (this.activeStatusFilterEl) this.activeStatusFilterEl.addClass('is-active');
  }

  /** 原版 setQuery：写入搜索词、聚焦并重筛；核心插件页的快捷键入口按插件 id 前缀过滤。 */
  setQuery(query) {
    if (!this.searchComponent) return;
    this.searchComponent.inputEl.value = query;
    this.searchComponent.inputEl.focus();
    this.updateHotkeyVisibility();
  }

  /** 原版 updateHotkeyVisibility：全量命令建冲突表，再按搜索/状态/快捷键三重条件出行。 */
  updateHotkeyVisibility() {
    const app = this.app;
    if (!this.hotkeyListEl) return;
    const listEl = this.hotkeyListEl;
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
    const conflicts = new Set();
    for (const bound of owners.values()) {
      if (bound.length > 1) for (const owner of bound) conflicts.add(owner.id);
    }
    if (!conflicts.size && this.statusFilter === 'show-conflicts') {
      this.statusFilter = 'show-all';
      this.updateActiveFilterClass();
    }
    const conflictFilterEl = this.filterEls['show-conflicts'];
    if (conflictFilterEl) {
      conflictFilterEl.toggle(conflicts.size > 0);
      conflictFilterEl.empty();
      conflictFilterEl.createSpan({ text: tt('setting.hotkeys.label-show-conflicts', '显示冲突') });
      conflictFilterEl.createSpan({ cls: 'setting-group-filter-badge', text: String(conflicts.size) });
    }

    const query = (this.searchComponent ? this.searchComponent.inputEl.value : '').toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const statusMode = this.statusFilter || 'show-all';
    const filterText = this.hotkeyFilter ? hotkeyToString(this.hotkeyFilter) : '';
    let shown = 0;

    for (const cmd of sorted) {
      const custom = customOf(cmd.id);
      const defaults = DEFAULT_HOTKEYS[cmd.id];
      const hasCustom = custom !== null;
      const hasDefaults = Array.isArray(defaults) && defaults.length > 0;
      if (terms.length) {
        const haystack = (String(cmd.name) + ' ' + cmd.id).toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) continue;
      }
      const bound = hasCustom ? custom : (defaults || []);
      if (filterText && !bound.some((hk) => hotkeyToString(hk) === filterText)) continue;
      if (statusMode === 'show-conflicts' && !conflicts.has(cmd.id)) continue;
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

      const customizing = !!(this.commandBeingCustomized && this.commandBeingCustomized.id === cmd.id);
      if (hasCustom) {
        for (const hk of custom) {
          const text = hotkeyToString(hk);
          buildChip(hk, () => {
            const next = custom.filter((x) => hotkeyToString(x) !== text);
            app.settings.setHotkey(cmd.id, next);
            app.hotkeyManager.buildCustomKeys();
            this.updateHotkeyVisibility();
          });
        }
        if (!custom.length && !customizing) {
          row.createSpan({ cls: 'setting-hotkey mod-empty', text: tt('setting.hotkeys.label-blank-hotkey', '未设置') });
        }
      } else if (hasDefaults) {
        for (const hk of defaults) {
          const text = hotkeyToString(hk);
          buildChip(hk, () => {
            const next = defaults.filter((x) => hotkeyToString(x) !== text);
            app.settings.setHotkey(cmd.id, next);
            app.hotkeyManager.buildCustomKeys();
            this.updateHotkeyVisibility();
          });
        }
      } else if (!customizing) {
        row.createSpan({ cls: 'setting-hotkey mod-empty', text: tt('setting.hotkeys.label-blank-hotkey', '未设置') });
      }
      if (customizing) {
        row.createSpan({ cls: 'setting-hotkey mod-active', text: tt('setting.hotkeys.label-waiting-for-hotkey-press', '按下快捷键…') });
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
      const addBtn = setting.controlEl.createSpan('clickable-icon setting-add-hotkey-button', (el) => {
        setIcon(el, 'lucide-plus-circle');
        el.setAttr('aria-label', tt('setting.hotkeys.tooltip-customize-command', '自定义快捷键'));
        el.addEventListener('click', () => this.startCustomizingHotkey(cmd));
      });
      if (customizing) addBtn.addClass('mod-active');
    }
    if (!shown) {
      const empty = new Setting(listEl);
      empty.setName(tt('setting.hotkeys.label-no-results-found', '没有找到结果'));
      empty.setClass('mod-empty-state');
    }
  }
}

/* ------------------------------------------------------------ Core plugins */

export class CorePluginsTab extends SettingTab {
  declare name: any;
  declare id: string;
  declare icon: string;

  constructor(app: App, setting) {
    super(app, setting);
    this.name = tt('setting.builtin-plugins', '核心插件');
    this.id = 'plugins';
    this.icon = 'toy-brick';
  }

  display() { this.render(true); }

  /** 原版 dte.render：.setting-group.mod-list 裸搜索 + 行内齿轮/快捷键入口 + 开关；入口按启用与注册状态显隐。 */
  render(focusSearch = false) {
    const app = this.app;
    this.containerEl.empty();
    let query = '';
    const group = new SettingGroup(this.containerEl).addClass('mod-list');
    const rowsEl = group.listEl;
    const renderRows = () => {
      rowsEl.empty();
      const terms = query.split(/\s+/).filter(Boolean);
      const entries = Object.entries(app.plugins.internalPlugins)
        .sort((a, b) => String(a[1].manifest.name).localeCompare(String(b[1].manifest.name), 'zh'));
      let rendered = 0;
      for (const [id, entry] of entries) {
        const name = entry.manifest.name || id;
        const desc = entry.manifest.description || '';
        const haystack = (name + ' ' + desc).toLowerCase();
        if (terms.length && !terms.every((term) => haystack.includes(term))) continue;
        rendered++;
        const hasSettingTab = !!(entry.manifest.module && entry.manifest.module.settingTab);
        const setting = new Setting(rowsEl);
        setting.setName(name);
        setting.setDesc(desc);
        let gearEl = null;
        let hotkeysEl = null;
        setting.addExtraButton((b) => {
          gearEl = b.extraSettingsEl;
          b.setIcon('lucide-settings')
            .setTooltip(tt('setting.options', '选项'))
            .onClick(() => this.setting.openPluginOptions(id));
        });
        setting.addExtraButton((b) => {
          hotkeysEl = b.extraSettingsEl;
          hotkeysEl.addClass('mod-hotkeys');
          b.setIcon('lucide-plus-circle')
            .setTooltip(tt('setting.hotkeys.name', '快捷键'))
            .onClick(() => openHotkeysFor(this.setting, id));
        });
        const refreshVisibility = () => {
          const enabled = !!entry.enabled;
          gearEl.toggle(enabled && hasSettingTab);
          hotkeysEl.toggle(enabled && hasPluginCommands(app, id));
        };
        setting.addToggle((tog) => tog.setValue(!!entry.enabled).onChange(async (v) => {
          if (v) await app.plugins.enableInternalPlugin(id);
          else await app.plugins.disableInternalPlugin(id);
          tog.setValue(!!entry.enabled);
          // 原版：插件启停会增删左栏「核心插件」分组里的设置条目。
          if (this.setting && typeof this.setting.registerCorePluginTabs === 'function') this.setting.registerCorePluginTabs();
          refreshVisibility();
        }));
        refreshVisibility();
      }
      if (!rendered) {
        const empty = new Setting(rowsEl);
        empty.setName(tt('setting.hotkeys.label-no-results-found', '没有找到结果'));
        empty.setClass('mod-empty-state');
      }
    };
    let search = null;
    group.addSearch((component) => {
      search = component;
      component.setPlaceholder(tt('setting.core-plugin.placeholder-search-plugin', '搜索插件…'))
        .onChange((v) => { query = String(v || '').trim().toLowerCase(); renderRows(); });
    });
    if (focusSearch) setTimeout(() => search.inputEl.focus(), 0);
    renderRows();
  }
}
