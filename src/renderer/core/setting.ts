/**
 * [INPUT]: 依赖 ./dom.js 注入的全局 createDiv/createEl 助手；依赖 ./icons.js 的 setIcon
 * [OUTPUT]: 导出 Setting、SettingGroup 与组件类 ToggleComponent/DropdownComponent/SliderComponent/TextComponent/TextAreaComponent/SearchComponent/ButtonComponent/ExtraButtonComponent/ColorPickerComponent/ProgressBarComponent/MomentFormatComponent
 * [POS]: core/ 的设置控件层，逐字对齐原版组件 DOM（.setting-item/.checkbox-container/.dropdown/.slider）。SettingGroup 持有 .setting-group-search（裸 SearchComponent）与 .setting-group-search-control（筛选芯片行），settings-view.js 的标签页与插件设置页用它构建界面，行为与 Obsidian 公开 API 一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Setting controls — DOM 1:1 with the original components. */
import { setIcon } from './icons.js';

/* ------------------------------------------------------------------ base */
class BaseComponent {
  declare disabled: boolean;

  constructor() {
    this.disabled = false;
  }
  then(cb) { cb(this); return this; }
  setDisabled(disabled) { this.disabled = disabled; return this; }
}

abstract class ValueComponent extends BaseComponent {
  abstract setValue(value: any): this;
  abstract getValue(): unknown;

  registerOptionListener(target, key) {
    target[key] = (value) => {
      if (value !== undefined) this.setValue(value);
      return this.getValue();
    };
    return this;
  }
}

/* -------------------------------------------------------------- components */

export class ToggleComponent extends ValueComponent {
  declare on: boolean;
  declare toggleEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.on = false;
    this.toggleEl = containerEl.createEl('label', { cls: 'checkbox-container', attr: { tabIndex: 0 } }, (el) => {
      el.createEl('input', { attr: { type: 'checkbox', tabIndex: 0 } });
      el.addEventListener('change', this.onClick.bind(this));
    });
  }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.toggleEl.toggleClass('is-disabled', disabled);
    return this;
  }
  getValue() { return this.on; }
  setValue(value) {
    if (this.on !== value) {
      this.on = value;
      this.toggleEl.toggleClass('is-enabled', value);
      if (this.changeCallback) this.changeCallback(value);
    }
    return this;
  }
  setSmall() { this.toggleEl.addClass('mod-small'); return this; }
  setTooltip(tooltip) { this.toggleEl.setAttr('aria-label', tooltip); return this; }
  onClick() {
    if (!this.disabled) this.setValue(!this.getValue());
  }
  onChange(cb) { this.changeCallback = cb; return this; }
}

export class DropdownComponent extends ValueComponent {
  declare selectEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.selectEl = containerEl.createEl('select', { cls: 'dropdown' });
    this.selectEl.addEventListener('change', () => {
      if (this.changeCallback) this.changeCallback(this.selectEl.value);
    });
  }
  addOption(value, display) {
    this.selectEl.createEl('option', { value, text: display });
    return this;
  }
  addOptions(options) {
    for (const [value, display] of Object.entries(options)) this.addOption(value, display);
    return this;
  }
  getValue() { return this.selectEl.value; }
  setValue(value) {
    this.selectEl.value = value;
    return this;
  }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.selectEl.disabled = disabled;
    return this;
  }
  onChange(cb) { this.changeCallback = cb; return this; }
}

export class SliderComponent extends ValueComponent {
  declare dynamicTooltip: boolean;
  declare instant: boolean;
  declare sliderEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.dynamicTooltip = false;
    this.instant = false;
    this.sliderEl = containerEl.createEl('input', { type: 'range', cls: 'slider' });
    this.sliderEl.dataset.ignoreSwipe = 'true';
    this.sliderEl.addEventListener('input', () => {
      if (this.dynamicTooltip) this.showTooltip();
      if (this.instant && this.changeCallback) this.changeCallback(this.getValue());
    });
    this.sliderEl.addEventListener('change', () => {
      if (!this.instant && this.changeCallback) this.changeCallback(this.getValue());
    });
    this.sliderEl.addEventListener('click', (ev) => ev.stopPropagation());
  }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.sliderEl.disabled = disabled;
    return this;
  }
  setInstant(instant) { this.instant = instant; return this; }
  setLimits(min, max, step) {
    this.sliderEl.setAttrs({ min, max, step });
    return this;
  }
  getValue() { return this.sliderEl.valueAsNumber; }
  getValuePretty() { return String(this.getValue()); }
  setValue(value) {
    this.sliderEl.value = value;
    return this;
  }
  setDynamicTooltip() { this.dynamicTooltip = true; return this; }
  showTooltip() { showSliderTooltip(this.sliderEl, this.getValuePretty()); }
  onChange(cb) { this.changeCallback = cb; return this; }
}

export class TextComponent extends ValueComponent {
  declare inputEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.inputEl = containerEl.createEl('input', { type: 'text' });
    this.inputEl.addEventListener('input', () => this.onChanged());
    this.inputEl.addEventListener('blur', () => this.onChanged());
  }
  getValue() { return this.inputEl.value; }
  setValue(value) {
    this.inputEl.value = value;
    return this;
  }
  setPlaceholder(placeholder) {
    this.inputEl.setAttribute('placeholder', placeholder);
    return this;
  }
  onChanged() {
    if (this.changeCallback) this.changeCallback(this.inputEl.value);
  }
  onChange(cb) { this.changeCallback = cb; return this; }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.inputEl.disabled = disabled;
    return this;
  }
  autoSelect(selectAll = false) {
    const el = this.inputEl;
    setTimeout(() => { el.focus(); selectAll ? el.select() : null; }, 0);
    return this;
  }
}

export class TextAreaComponent extends ValueComponent {
  declare inputEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.inputEl = containerEl.createEl('textarea');
    this.inputEl.addEventListener('input', () => this.onChanged());
    this.inputEl.addEventListener('blur', () => this.onChanged());
  }
  getValue() { return this.inputEl.value; }
  setValue(value) { this.inputEl.value = value; return this; }
  setPlaceholder(placeholder) { this.inputEl.setAttribute('placeholder', placeholder); return this; }
  onChanged() { if (this.changeCallback) this.changeCallback(this.inputEl.value); }
  onChange(cb) { this.changeCallback = cb; return this; }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.inputEl.disabled = disabled;
    return this;
  }
}

export class SearchComponent extends ValueComponent {
  declare containerEl: any;
  declare inputEl: any;
  declare clearButtonEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.containerEl = containerEl.createDiv('search-input-container');
    this.inputEl = this.containerEl.createEl('input', { type: 'search', attr: { enterkeyhint: 'search' } });
    this.inputEl.addEventListener('input', () => this.onChanged());
    this.clearButtonEl = this.containerEl.createDiv('search-input-clear-button', (el) => {
      el.addEventListener('mousedown', (ev) => ev.preventDefault());
      el.addEventListener('click', () => {
        if (this.disabled) return;
        this.inputEl.value = '';
        this.onChanged();
        this.inputEl.focus();
      });
    });
  }
  getValue() { return this.inputEl.value; }
  setValue(value) { this.inputEl.value = value; return this; }
  setPlaceholder(placeholder) { this.inputEl.setAttribute('placeholder', placeholder); return this; }
  onChanged() { if (this.changeCallback) this.changeCallback(this.inputEl.value); }
  onChange(cb) { this.changeCallback = cb; return this; }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.inputEl.disabled = disabled;
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  declare buttonEl: any;
  declare clickCallback: any;

  constructor(containerEl) {
    super();
    this.buttonEl = containerEl.createEl('button');
    this.buttonEl.addEventListener('click', async () => {
      const cb = this.clickCallback;
      if (this.disabled || !cb) return;
      this.buttonEl.addClass('mod-loading');
      await cb();
      this.buttonEl.removeClass('mod-loading');
    });
  }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.buttonEl.disabled = disabled;
    return this;
  }
  setCta() { this.buttonEl.addClass('mod-cta'); return this; }
  removeCta() { this.buttonEl.removeClass('mod-cta'); return this; }
  setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
  setTooltip(tooltip) { this.buttonEl.setAttr('aria-label', tooltip); return this; }
  setButtonText(text) { this.buttonEl.setText(text); return this; }
  setIcon(icon) { setIcon(this.buttonEl, icon); return this; }
  setClass(cls) { this.buttonEl.addClass(cls); return this; }
  onClick(cb) { this.clickCallback = cb; return this; }
}

export class ExtraButtonComponent extends BaseComponent {
  declare extraSettingsEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.extraSettingsEl = containerEl.createDiv('clickable-icon extra-setting-button', (el) => {
      setIcon(el, 'lucide-settings');
      el.addEventListener('click', () => {
        if (!this.disabled && this.changeCallback) this.changeCallback();
      });
    });
  }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.extraSettingsEl.toggleClass('is-disabled', disabled);
    return this;
  }
  setTooltip(tooltip) { this.extraSettingsEl.setAttr('aria-label', tooltip); return this; }
  setIcon(icon) { setIcon(this.extraSettingsEl, icon); return this; }
  onClick(cb) { this.changeCallback = cb; return this; }
}

export class ColorPickerComponent extends ValueComponent {
  declare colorPickerEl: any;
  declare changeCallback: any;

  constructor(containerEl) {
    super();
    this.colorPickerEl = containerEl.createEl('input', { type: 'color' });
    this.colorPickerEl.addEventListener('change', () => {
      if (this.changeCallback) this.changeCallback(this.getValue());
    });
  }
  setDisabled(disabled) {
    super.setDisabled(disabled);
    this.colorPickerEl.disabled = disabled;
    return this;
  }
  getValue() { return this.colorPickerEl.value; }
  getValueRgb() { return hexToRgb(this.getValue()); }
  getValueHsl() { return rgbToHsl(this.getValueRgb()); }
  getValueInt() { return parseInt(this.getValue().slice(1), 16); }
  setValue(value) {
    if (this.colorPickerEl.value !== value) {
      this.colorPickerEl.value = value;
      if (this.changeCallback) this.changeCallback(this.getValue());
    }
    return this;
  }
  onChange(cb) { this.changeCallback = cb; return this; }
}

export class ProgressBarComponent extends ValueComponent {
  declare progressBar: any;
  declare innerEl: any;

  constructor(containerEl) {
    super();
    this.progressBar = containerEl.createDiv('setting-progress-bar');
    this.innerEl = this.progressBar.createDiv('setting-progress-bar-inner');
  }
  getValue() { return parseFloat(this.innerEl.style.width) / 100; }
  setValue(value) { this.innerEl.style.width = (value * 100) + '%'; return this; }
  setVisibility(visible) { this.progressBar.hidden = !visible; return this; }
}

export class MomentFormatComponent extends TextComponent {
  declare sampleEl: any;
  declare defaultFormat: string;

  constructor(containerEl) {
    super(containerEl);
    this.sampleEl = null;
    this.defaultFormat = '';
  }
  setSampleEl(sampleEl) { this.sampleEl = sampleEl; this.updateSample(); return this; }
  setDefaultFormat(format) { this.defaultFormat = format; return this; }
  updateSample() {
    if (!this.sampleEl) return;
    try {
      const moment = require('moment');
      this.sampleEl.setText(moment().format(this.inputEl.value || this.defaultFormat));
    } catch (e) {
      this.sampleEl.setText(this.inputEl.value || this.defaultFormat);
    }
  }
}

/* ----------------------------------------------------------------- helpers */

function showSliderTooltip(sliderEl, text) {
  let tip = document.body.querySelector<HTMLElement>('.tooltip.mod-slider-tooltip');
  if (!tip) {
    tip = createDiv('tooltip mod-slider-tooltip');
    document.body.appendChild(tip);
  }
  const rect = sliderEl.getBoundingClientRect();
  tip.setText(text);
  tip.style.left = (rect.left + rect.width / 2) + 'px';
  tip.style.top = (rect.top - 8) + 'px';
  tip.style.transform = 'translate(-50%, -100%)';
  tip.style.display = 'block';
  clearTimeout(tip._hideTimer);
  tip._hideTimer = setTimeout(() => tip.remove(), 1200);
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* ------------------------------------------------------------------ Setting */

export class Setting {
  declare components: any[];
  declare settingEl: any;
  declare infoEl: any;
  declare nameEl: any;
  declare descEl: any;
  declare controlEl: any;

  constructor(containerEl) {
    this.components = [];
    this.settingEl = containerEl.createDiv('setting-item');
    this.infoEl = this.settingEl.createDiv('setting-item-info');
    this.nameEl = this.infoEl.createDiv('setting-item-name');
    this.descEl = this.infoEl.createDiv('setting-item-description');
    this.controlEl = this.settingEl.createDiv('setting-item-control');
  }
  setName(name) { this.nameEl.setText(name); return this; }
  setDesc(desc) { this.descEl.setText(desc); return this; }
  setClass(cls) { this.settingEl.addClass(cls); return this; }
  setTooltip(tooltip) { this.settingEl.setAttr('aria-label', tooltip); return this; }
  setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
  setDisabled(disabled) {
    this.settingEl.toggleClass('is-disabled', disabled);
    for (const c of this.components) c.setDisabled(disabled);
    return this;
  }
  setControlEl() { return this; }
  addButton(cb) { const c = new ButtonComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addExtraButton(cb) { const c = new ExtraButtonComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addToggle(cb) { const c = new ToggleComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addDropdown(cb) { const c = new DropdownComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addSlider(cb) { const c = new SliderComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addText(cb) { const c = new TextComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addTextArea(cb) { const c = new TextAreaComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addSearch(cb) { const c = new SearchComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addColorPicker(cb) { const c = new ColorPickerComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addProgressBar(cb) { const c = new ProgressBarComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addMomentFormat(cb) { const c = new MomentFormatComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  then(cb) { cb(this); return this; }
}

/* --------------------------------------------------------------- SettingTab */

/**
 * 原版 U1：设置页签基类。containerEl 即 .vertical-tab-content；
 * 宿主 openTab() 时把它 append 进 .vertical-tab-content-container。
 * 核心插件导出 settingTab(app, containerEl) 的函数式页签不经由此类。
 */
export class SettingTab {
  declare id: string;
  declare name: string;
  declare icon: string;
  declare group: string;
  declare pluginId: string;

  declare app: App;
  declare setting: any;
  declare containerEl: any;

  constructor(app: App, setting) {
    this.app = app;
    this.setting = setting;
    this.containerEl = createDiv('vertical-tab-content');
  }
  hide() {}
  display() {}
}

/* ------------------------------------------------------------- SettingGroup */

/**
 * 原版 Hk 的内部设置组构建器：.setting-group > (.setting-item.setting-item-heading + .setting-group-search? + .setting-items)
 * 标签页用它组织“显示/行为/高级”等分组。
 */
export class SettingGroup {
  declare components: any[];
  declare groupEl: any;
  declare headerEl: any;
  declare headerInnerEl: any;
  declare controlEl: any;
  declare searchContainerEl: any;
  declare listEl: any;

  constructor(containerEl) {
    this.components = [];
    this.groupEl = containerEl.createDiv('setting-group');
    this.headerEl = createDiv('setting-item setting-item-heading');
    this.headerInnerEl = this.headerEl.createDiv('setting-item-name');
    this.controlEl = this.headerEl.createDiv('setting-item-control');
    this.searchContainerEl = this.groupEl.createDiv({ cls: 'setting-group-search', attr: { tabIndex: -1 } });
    this.listEl = this.groupEl.createDiv('setting-items');
  }
  setHeading(text) {
    this.headerInnerEl.setText(text);
    const shown = this.headerEl.isShown ? this.headerEl.isShown() : this.headerEl.isConnected;
    if (text && !shown) this.groupEl.prepend(this.headerEl);
    else if (!text && shown) this.headerEl.detach();
    return this;
  }
  addClass(cls) { this.groupEl.addClass(cls); return this; }
  addSetting(cb) {
    const setting = new Setting(this.listEl);
    this.components.push(setting);
    cb(setting);
    return this;
  }
  addSearch(cb) {
    const search = new SearchComponent(this.searchContainerEl);
    this.components.push(search);
    cb(search);
    return this;
  }
  addSearchControl(cb) {
    cb(this.searchContainerEl.createDiv('setting-group-search-control'));
    return this;
  }
  addExtraButton(cb) {
    const c = new ExtraButtonComponent(this.controlEl);
    this.components.push(c);
    cb(c);
    return this;
  }
  then(cb) { cb(this); return this; }
}
