/**
 * [INPUT]: 依赖 Setting 控件、i18n、图标及 graph-options 默认值。
 * [OUTPUT]: 导出 FilterSection、ColorGroupSection、DisplaySection、ForceSection。
 * [POS]: 图谱控制面板；读取引擎选项，提交筛选、显示与力学变更。
 *        颜色组行数即优先色顺序：颜色圆点上的拖动排序改写顺序并立即重绘。
 *        控件外观逐条对齐原版：滑块不挂动态提示、动画按钮与新建组按钮都是普通按钮。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { GraphOptions, GraphColorQuery } from './graph-types.js';
import type { GraphEngine } from './graph-engine.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Setting, TextComponent, SearchComponent, ColorPickerComponent } from '../core/setting.js';
import { has, hslToHex } from './graph-utils.js';
import { FILTER_DEFAULTS, DISPLAY_DEFAULTS, FORCE_DEFAULTS, strengthFromSlider } from './graph-options.js';

/* 原版 SJ：可折叠树项。optionListeners 同时承担 getOptions/setOptions 的读写 */
class GraphControlSection {
  declare engine: GraphEngine;
  declare optionListeners: Record<string, (value?: unknown) => unknown>;
  declare collapsed: boolean;
  declare el: HTMLDivElement;
  declare selfEl: HTMLDivElement;
  declare innerEl: HTMLDivElement;
  declare childrenEl: HTMLDivElement;
  declare collapseEl: HTMLDivElement;

  constructor(engine: GraphEngine, name: string, label: string) {
    this.engine = engine;
    this.optionListeners = {};
    this.collapsed = false;
    this.el = createDiv(`tree-item graph-control-section mod-${name}`);
    this.selfEl = this.el.createDiv('tree-item-self mod-collapsible');
    this.innerEl = this.selfEl.createDiv('tree-item-inner');
    this.childrenEl = this.el.createDiv('tree-item-children');
    this.innerEl.createEl('header', { cls: 'graph-control-section-header', text: label });
    this.collapseEl = this.selfEl.createDiv('tree-item-icon collapse-icon');
    setIcon(this.collapseEl, 'right-triangle');
    const toggle = () => this.setCollapsed(!this.collapsed);
    this.collapseEl.addEventListener('click', (ev: { button: number; preventDefault: () => void; }) => { if (ev.button === 0) { ev.preventDefault(); toggle(); } });
    this.selfEl.addEventListener('click', (ev) => { if (ev.button === 0 && !ev.defaultPrevented) toggle(); });
    this.setCollapsed(true);
    this.optionListeners[`collapse-${name}`] = (value: unknown) => {
      if (typeof value === 'boolean') this.setCollapsed(value);
      return this.collapsed;
    };
  }
  setCollapsed(collapsed: boolean) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.el.toggleClass('is-collapsed', collapsed);
    this.collapseEl.toggleClass('is-collapsed', collapsed);
    this.engine.onOptionsChange();
  }
  /* 本项目组件 setValue 不回调（原版会回调），载入选项时显式 apply 一次 */
  _listen<T extends number | boolean>(key: string, component: { getValue(): T; setValue(value: T): unknown }, apply: (value: T) => void) {
    this.optionListeners[key] = (value: unknown) => {
      if (typeof value === typeof component.getValue()) { component.setValue(value as T); apply(value as T); }
      return component.getValue();
    };
  }
  setOptions(options: Record<string, unknown>) {
    for (const key in options) if (has(this.optionListeners, key)) this.optionListeners[key](options[key]);
  }
  getOptions(target: Record<string, unknown>) {
    for (const key in this.optionListeners) {
      const value = this.optionListeners[key]();
      if (value !== undefined) target[key] = value;
    }
  }
}

/* 原版 xJ：筛选（搜索框 + 深度 + 链接方向 + 标签/附件/未解析/孤立） */
export class FilterSection extends GraphControlSection {
  declare searchSetting: Setting;
  declare search: SearchComponent;

  constructor(engine: GraphEngine, isLocal: boolean) {
    super(engine, 'filter', t('plugins.graph-view.label-filters'));
    engine.controlsEl.appendChild(this.el);
    const children = this.childrenEl;
    this.searchSetting = new Setting(children).addSearch((component) => {
      component.setPlaceholder(t('plugins.graph-view.prompt-filter-nodes')).setValue('').onChange(() => engine.requestUpdateSearch());
      this.search = component;
      component.clearButtonEl.setAttr('aria-label', t('plugins.search.tooltip-clear-search'));
      this.optionListeners.search = (value: unknown) => {
        if (typeof value === 'string') { component.setValue(value); engine.requestUpdateSearch(); }
        return component.getValue();
      };
      component.inputEl.addEventListener('keydown', (ev) => {
        if (!ev.isComposing && ev.key === 'Enter') engine.updateSearch();
      });
    });
    this.searchSetting.settingEl.addClass('mod-search-setting');
    if (isLocal) {
      new Setting(children).setName(t('plugins.graph-view.option-depth')).setTooltip(t('plugins.graph-view.option-depth-description'))
        .setClass('mod-local-jumps').setClass('mod-slider').addSlider((slider) => {
          const apply = (value: number) => { engine.options.localJumps = value; engine.render(); };
          slider.setLimits(1, 5, 1).setValue(engine.options.localJumps).setInstant(true)
            .onChange((value) => { apply(value); engine.onOptionsChange(); });
          this._listen('localJumps', slider, apply);
        });
    }
    /* 原版构建顺序：反向链接 → 正向链接 → 其他节点间的链接 → 标签 → 附件 → 仅显示已创建的笔记 → 孤立文件 */
    const toggles: Array<[keyof Pick<GraphOptions, 'localBacklinks' | 'localForelinks' | 'localInterlinks' | 'showTags' | 'showAttachments' | 'hideUnresolved' | 'showOrphans'>, string, string, string]> = [
      ['localBacklinks', 'option-backlinks', 'option-backlinks-description', 'local'],
      ['localForelinks', 'option-forelinks', 'option-forelinks-description', 'local'],
      ['localInterlinks', 'option-neighbor-links', 'option-neighbor-links-description', 'local'],
      ['showTags', 'option-show-tags', 'option-show-tags-description', 'all'],
      ['showAttachments', 'option-show-attachments', 'option-show-attachments-description', 'all'],
      ['hideUnresolved', 'option-show-existing-files-only', 'option-show-existing-files-only-description', 'all'],
      ['showOrphans', 'option-show-orphans', 'option-show-orphans-description', 'global'],
    ];
    for (const [key, labelKey, descKey, scope] of toggles) {
      if (scope !== 'all' && (scope === 'local') !== isLocal) continue;
      new Setting(children).setName(t(`plugins.graph-view.${labelKey}`)).setTooltip(t(`plugins.graph-view.${descKey}`))
        .setClass('mod-toggle').addToggle((toggle) => {
          const apply = (value: boolean) => { engine.options[key] = value; engine.render(); };
          toggle.setValue(engine.options[key]).onChange((value) => { apply(value); engine.onOptionsChange(); });
          this._listen(key, toggle, apply);
        });
    }
  }
  startSearch() { this.searchSetting.settingEl.addClass('is-loading'); }
  stopSearch() { this.searchSetting.settingEl.removeClass('is-loading'); }
  setDefaultOptions() { this.setOptions(FILTER_DEFAULTS); }
}

/* 原版 TJ：颜色组（检索式 + 颜色 + 删除 + 新建 + 按住颜色圆点拖动排序）。顺序即优先色顺序 */
interface ColorGroupRecord { el: HTMLDivElement; query: TextComponent; color: ColorPickerComponent; }
function isColorQuery(value: unknown): value is GraphColorQuery {
  if (!value || typeof value !== 'object' || !('query' in value) || typeof value.query !== 'string' || !('color' in value)) return false;
  const color = value.color;
  return color === null || !!color && typeof color === 'object' && 'rgb' in color && typeof color.rgb === 'number' && 'a' in color && typeof color.a === 'number';
}
export class ColorGroupSection extends GraphControlSection {
  declare groups: ColorGroupRecord[];
  declare groupContainer: HTMLDivElement;

  constructor(engine: GraphEngine) {
    super(engine, 'color-groups', t('plugins.graph-view.label-groups'));
    engine.controlsEl.appendChild(this.el);
    this.groups = [];
    this.optionListeners.colorGroups = (value) => {
      if (Array.isArray(value)) { this.setColorQueries(value.filter(isColorQuery)); engine.requestUpdateSearch(); }
      return this.getColoredQueries();
    };
    this.setColorQueries([]);
  }
  getColoredQueries() {
    return this.groups.map((group) => ({
      query: group.query.getValue(),
      color: { a: 1, rgb: group.color.getValueInt() },
    }));
  }
  setColorQueries(queries: GraphColorQuery[]) {
    const children = this.childrenEl;
    children.empty();
    const groups: ColorGroupRecord[] = [];
    this.groups = groups;
    this.groupContainer = children.createDiv('graph-color-groups-container');
    for (const entry of queries) this.appendGroup(entry);
    children.createDiv('graph-color-button-container', (containerEl: { createEl: (arg0: string,arg1: { text: string; },arg2: (button: { addEventListener: (arg0: string,arg1: () => void) => void; }) => void) => void; }) => {
      /* 原版新建组是普通 button（无 mod-cta）：宽度由 .graph-color-button-container button 规则给出 */
      containerEl.createEl('button', { text: t('plugins.graph-view.button-new-group') }, (button: { addEventListener: (arg0: string,arg1: () => void) => void; }) => {
        button.addEventListener('click', () => {
          /* 原版用当前组数算默认色相：h = 40 × 组序（新建行直接追加，不重建整表） */
          const dark = document.body.hasClass('theme-dark');
          const hex = hslToHex(40 * this.groups.length, dark ? 70 : 60, 60);
          this.appendGroup({ query: '', color: { a: 1, rgb: parseInt(hex.slice(1), 16) } });
          this.engine.updateSearch();
        });
      });
    });
  }

  /* 原版 setColorQueries 内的行构造：一行 = 检索式 + 取色器 + 删除按钮 */
  appendGroup(entry: GraphColorQuery) {
    const groups = this.groups;
    const groupEl = this.groupContainer.createDiv('graph-color-group');
    const query = new TextComponent(groupEl).setPlaceholder(t('plugins.graph-view.placeholder-enter-query'))
      .setValue(entry.query).onChange(() => this.engine.requestUpdateSearch());
    const rgb = entry.color ? entry.color.rgb : 0;
    const color = new ColorPickerComponent(groupEl).setValue(`#${rgb.toString(16).padStart(6, '0')}`)
      .onChange(() => this.engine.updateSearch());
    color.colorPickerEl.setAttr('aria-label', t('plugins.graph-view.tooltip-click-to-change-drag-to-reorder'));
    const record = { el: groupEl, query, color };
    /* 原版：拖动排序的落点由颜色圆点上的 mousedown 启动（单击仍是打开取色器） */
    color.colorPickerEl.addEventListener('mousedown', (ev) => this.onDragOption(ev, record));
    groupEl.createDiv('clickable-icon', (el) => {
      setIcon(el, 'x');
      el.setAttr('aria-label', t('plugins.graph-view.tooltip-delete-graph'));
      el.addEventListener('click', () => {
        const index = groups.indexOf(record);
        if (index >= 0) groups.splice(index, 1);
        groupEl.detach();
        this.engine.updateSearch();
      });
    });
    groups.push(record);
    return record;
  }

  /* 原版 onDragOption：移动超过 5px 才进入拖拽；幽灵行跟随光标，其余行让位；松手按落点重排并重绘 */
  onDragOption(ev: MouseEvent, record: ColorGroupRecord) {
    if (ev.button !== 0) return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const el = record.el;
    const rect = el.getBoundingClientRect();
    const offsetX = ev.clientX - rect.x;
    const offsetY = ev.clientY - rect.y;
    let ghost: HTMLDivElement | null = null;
    const onMouseMove = (moveEv: MouseEvent) => {
      moveEv.preventDefault();
      const x = moveEv.clientX;
      const y = moveEv.clientY;
      if (ghost === null) {
        const dx = x - startX;
        const dy = y - startY;
        if (dx * dx + dy * dy < 25) return;
        const index = this.groups.indexOf(record);
        if (index >= 0) this.groups.splice(index, 1);
        ghost = el.cloneNode(true) as HTMLDivElement;
        ghost.addClass('drag-ghost');
        ghost.style.width = el.offsetWidth + 'px';
        const ghostQuery = ghost.querySelector<HTMLInputElement>('input[type="text"]');
        if (ghostQuery) ghostQuery.value = record.query.getValue();
        const ghostColor = ghost.querySelector<HTMLInputElement>('input[type="color"]');
        if (ghostColor) ghostColor.value = record.color.getValue();
        document.body.appendChild(ghost);
        document.body.addClass('is-grabbing');
        this.childrenEl.addClass('is-grabbing');
      }
      const dropIndex = this.getDropIndex(y);
      el.detach();
      ghost.style.left = (x - offsetX) + 'px';
      ghost.style.top = (y - offsetY) + 'px';
      for (let i = 0; i < this.groups.length; i++) {
        const sibling = this.groups[i];
        sibling.el.style.top = i < dropIndex ? '0' : `${sibling.el.offsetHeight}px`;
      }
    };
    const onMouseUp = (upEv: { clientY: number; }) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!ghost) return;
      ghost.detach();
      document.body.removeClass('is-grabbing');
      this.childrenEl.removeClass('is-grabbing');
      this.groups.splice(this.getDropIndex(upEv.clientY), 0, record);
      this.setColorQueries(this.getColoredQueries());
      this.engine.updateSearch();
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  /* 原版 getDropIndex：落点高于某行垂直中点时插到该行之前 */
  getDropIndex(clientY: number) {
    let index = 0;
    for (index = 0; index < this.groups.length; index++) {
      const rect = this.groups[index].el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return index;
  }
}

/* 原版 AJ：外观（箭头 / 文本透明度 / 节点大小 / 连线粗细 / 播放动画） */
export class DisplaySection extends GraphControlSection {
  constructor(engine: GraphEngine, isLocal: boolean) {
    super(engine, 'display', t('plugins.graph-view.label-display'));
    engine.controlsEl.appendChild(this.el);
    const children = this.childrenEl;
    new Setting(children).setName(t('plugins.graph-view.option-show-arrows')).setTooltip(t('plugins.graph-view.option-show-arrows-description'))
      .setClass('mod-toggle').addToggle((toggle) => {
        const apply = (value: boolean) => { engine.options.showArrow = value; engine.renderer.setRenderOptions({ showArrow: value }); };
        toggle.onChange((value) => { apply(value); engine.onOptionsChange(); });
        this._listen('showArrow', toggle, apply);
      });
    const sliders: Array<['textFadeMultiplier' | 'nodeSizeMultiplier' | 'lineSizeMultiplier', string, [number, number, number | 'any']]> = [
      ['textFadeMultiplier', 'option-text-fade', [-3, 3, 0.1]],
      ['nodeSizeMultiplier', 'option-node-size', [0.1, 5, 'any']],
      ['lineSizeMultiplier', 'option-link-thickness', [0.1, 5, 'any']],
    ];
    for (const [key, labelKey, limits] of sliders) {
      new Setting(children).setName(t(`plugins.graph-view.${labelKey}`)).setClass('mod-slider').addSlider((slider) => {
        const apply = (value: number) => { engine.options[key] = value; engine.renderer.setRenderOptions({ [key]: value }); };
        slider.setLimits(limits[0], limits[1], limits[2]).setInstant(true)
          .onChange((value) => { apply(value); engine.onOptionsChange(); });
        this._listen(key, slider, apply);
      });
    }
    if (!isLocal) {
      /* 原版 addButton 不带 setCta：按钮是普通按钮，不是主按钮 */
      new Setting(children).addButton((button) => {
        button.setButtonText(t('plugins.graph-view.button-animate-timelapse')).onClick(() => engine.renderProgression());
      });
    }
  }
  setDefaultOptions() { this.setOptions(DISPLAY_DEFAULTS); }
}

/* 原版 LJ：力度（向心力 / 排斥力 / 吸引力 / 连线长度），滑块值 ⇄ 力学强度换算 */
export class ForceSection extends GraphControlSection {
  constructor(engine: GraphEngine) {
    super(engine, 'forces', t('plugins.graph-view.label-forces'));
    engine.controlsEl.appendChild(this.el);
    const children = this.childrenEl;
    const sliders: Array<['centerStrength' | 'repelStrength' | 'linkStrength' | 'linkDistance', string, [number, number, number | 'any'], ((value: number) => number)?]> = [
      ['centerStrength', 'option-center-force', [0, 1, 'any'], (value) => strengthFromSlider(value, 0.01)],
      ['repelStrength', 'option-repel-force', [0, 20, 'any'], (value) => value * value * value],
      ['linkStrength', 'option-link-force', [0, 1, 'any'], (value) => strengthFromSlider(value, 0.01)],
      ['linkDistance', 'option-link-distance', [30, 500, 1], (value) => value],
    ];
    for (const [key, labelKey, limits, transform] of sliders) {
      new Setting(children).setName(t(`plugins.graph-view.${labelKey}`)).setClass('mod-slider').addSlider((slider) => {
        const apply = (value: number) => { engine.options[key] = value; engine.renderer.setForces({ [key]: (transform ? transform(value) : value) }); };
        slider.setLimits(limits[0], limits[1], limits[2]).setInstant(true)
          .onChange((value) => { apply(value); engine.onOptionsChange(); });
        this._listen(key, slider, apply);
      });
    }
  }
  setDefaultOptions() { this.setOptions(FORCE_DEFAULTS); }
}
