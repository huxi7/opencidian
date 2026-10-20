/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasNode（基类）与 ./canvas-utils.js 的 bboxOf（经基类使用）；依赖 ./canvas-menu.js 的 FileSuggestModal；
 *          依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon。
 * [OUTPUT]: 导出 CanvasGroupNode（分组节点）。
 * [POS]: views/ 画布节点层的分组节点（从 canvas-node.js 拆出，保持单文件 ≤800 行）。分组是圆角矩形 + 顶部 contenteditable 标签，
 *        永远铺在底层：z 取 -宽*高（原版 F5），面积越大越靠后，且不参与单选的临时置顶；isGroup 为真时参与对齐与包含判定。
 *        标签编辑只改标签，几何与写盘由 canvas-view 调度。
 *        背景图按原版 F5：background 存文件路径，backgroundStyle 取 cover（默认）/ratio/repeat；cover 与 repeat 直接写 contentEl 的内联背景，
 *        ratio 读取图片真实宽高比后把分组收成同一比例。菜单「设置背景 / 编辑背景」提供换图、移除与三种样式。
 *        标签前景色按分组色亮度切 mod-foreground-light/dark（亮度阈值 150，对齐原版 iT）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas group node — label editing, themed label colors, background images. */
import { CanvasNode } from './canvas-node.js';
import { FileSuggestModal } from './canvas-menu.js';
import { t } from '../core/i18n.js';

/** 原版 iT：亮度 >= 150 用深色文字，否则用浅色文字。 */
function isLightColor(r, g, b) {
  return (299 * r + 587 * g + 114 * b) / 1000 >= 150;
}

/* --------------------------------------------------------------------------
 * 分组 — 圆角矩形 + 顶部 label（contenteditable），永远铺在底层
 * ------------------------------------------------------------------------ */
export class CanvasGroupNode extends CanvasNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.isGroup = true;
    this.label = '';
    this.bgPath = '';
    this.bgFile = null;
    this.bgStyle = '';
    this.nodeEl.addClass('canvas-node-group');
  }

  initialize() {
    super.initialize();
    this.contentEl = this.containerEl.createDiv('canvas-node-content');
    const labelEl = this.labelEl = this.nodeEl.createDiv('canvas-group-label');
    labelEl.spellcheck = false;
    labelEl.addEventListener('pointerdown', (e) => this.onPointerdown(e));
    labelEl.addEventListener('dblclick', () => this.focusLabel());
    labelEl.addEventListener('keypress', (e) => {
      if (!e.isComposing && e.key === 'Enter') { e.preventDefault(); this.blurLabel(); }
    });
    labelEl.addEventListener('blur', () => this.blurLabel());
    this.isContentMounted = true;
  }

  setLabel(label) {
    if (this.label === label) return;
    this.label = label;
    this.canvas.markDirty(this);
  }

  focusLabel() {
    const labelEl = this.labelEl;
    if (!labelEl || this.canvas.readonly) return;
    labelEl.show();
    labelEl.setAttr('contenteditable', 'true');
    labelEl.focus();
  }

  blurLabel() {
    const labelEl = this.labelEl;
    if (!labelEl) return;
    labelEl.setAttr('contenteditable', 'false');
    labelEl.blur();
    const text = labelEl.getText();
    if (this.label !== text) {
      this.setLabel(text);
      this.canvas.requestSave();
    } else {
      labelEl.toggle(!!text);
      labelEl.setText(text);
    }
  }

  blur() {
    super.blur();
    this.blurLabel();
  }

  /* ------------------------------------------------------------- 背景图 */

  setBackgroundFile(file) {
    const path = file ? file.path : '';
    if (this.bgPath === path && this.bgFile === file) return;
    this.bgPath = path;
    this.bgFile = file || null;
    if (!file) this.bgStyle = '';
    this.updateAspectRatio();
    this.canvas.markDirty(this);
  }

  setBackgroundStyle(style) {
    if (!this.bgPath) style = '';
    if (this.bgStyle === style) return;
    this.bgStyle = style;
    this.updateAspectRatio();
    this.canvas.markDirty(this);
  }

  /** 原版 F5.updateAspectRatio：ratio 样式读取图片宽高比，把分组收成同一比例。 */
  async updateAspectRatio() {
    if (this.bgStyle !== 'ratio' || !this.bgFile) { this.aspectRatio = 0; return; }
    const file = this.bgFile;
    const img = new Image();
    img.src = this.app.vault.adapter.getResourcePath(file.path);
    try {
      if (img.decode) await img.decode();
      else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    } catch (e) {
      return;
    }
    if (this.destroyed || this.bgFile !== file || this.bgStyle !== 'ratio') return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return;
    const ratio = width / height;
    this.aspectRatio = ratio;
    const w = this.width;
    const h = this.height;
    if (w / h === ratio) return;
    this.resize({ width: Math.min(w, h * ratio), height: Math.min(h, w / ratio) });
    this.canvas.overrideHistory();
  }

  /** 把背景写到 contentEl：cover 居中裁切（ratio 同样 cover），repeat 平铺。 */
  renderBackground() {
    const el = this.contentEl;
    if (!el) return;
    const file = this.bgFile;
    if (!file) {
      el.style.backgroundImage = '';
      el.style.backgroundRepeat = '';
      el.style.backgroundPosition = '';
      el.style.backgroundSize = '';
      return;
    }
    const url = this.app.vault.adapter.getResourcePath(file.path).replace(/"/g, '\\"');
    const repeat = this.bgStyle === 'repeat';
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundRepeat = repeat ? 'repeat' : 'no-repeat';
    el.style.backgroundPosition = repeat ? 'top left' : 'center center';
    el.style.backgroundSize = repeat ? 'auto' : 'cover';
  }

  /** 原版 I9 等价的图片选择弹窗；选中的非图片文件不写入背景。 */
  openBackgroundPicker() {
    const picker = new FileSuggestModal(this.app, (file) => {
      if (!file) return;
      const ext = (file.extension || '').toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return;
      this.setBackgroundFile(file);
      this.canvas.requestSave();
      this.canvas.markDirty(this);
    }, { media: true });
    picker.open();
  }

  /* ------------------------------------------------------------- 层级 */
  /* 分组永远铺在普通卡片下面：z 取 -宽*高（原版 F5），面积越大越靠后，且不参与单选置顶。 */

  updateZIndex() { this.renderZIndex(); }

  renderZIndex() {
    const z = this.zIndex = Math.round(-this.width * this.height);
    if (z !== this.renderedZIndex) {
      this.nodeEl.style.zIndex = String(z);
      this.renderedZIndex = z;
    }
  }

  render() {
    super.render();
    if (!this.initialized) return;
    const labelEl = this.labelEl;
    if (document.activeElement !== labelEl) {
      labelEl.toggle(!!this.label);
      labelEl.setText(this.label);
    }
    // 主题色明暗：原版 iT 以亮度 150 为界，亮色配深色文字，暗色配浅色文字
    let light = false;
    let dark = false;
    if (this.color) {
      const raw = getComputedStyle(this.nodeEl).getPropertyValue('--canvas-color').trim();
      const m = raw.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
      if (m) {
        if (isLightColor(Number(m[1]), Number(m[2]), Number(m[3]))) dark = true;
        else light = true;
      }
    }
    labelEl.toggleClass('mod-foreground-light', light);
    labelEl.toggleClass('mod-foreground-dark', dark);
    this.renderBackground();
  }

  /** 分组菜单：编辑文字（原版 F5.showMenu）与背景图操作。 */
  showMenu(menu) {
    super.showMenu(menu);
    if (this.canvas.readonly) return;
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-edit-label')).setIcon('lucide-edit')
      .onClick(() => this.focusLabel()));
    if (!this.bgPath) {
      menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-set-background')).setIcon('lucide-image')
        .onClick(() => this.openBackgroundPicker()));
      return;
    }
    const editItem = menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-edit-background')).setIcon('lucide-image'));
    const sub = editItem.setSubmenu();
    sub.addItem((item) => item.setSection('image').setTitle(t('plugins.canvas.action-replace-background')).setIcon('lucide-repeat')
      .onClick(() => this.openBackgroundPicker()));
    sub.addItem((item) => item.setSection('image').setTitle(t('plugins.canvas.action-remove-background')).setIcon('lucide-image-off')
      .onClick(() => {
        this.setBackgroundFile(null);
        this.canvas.requestSave();
        this.canvas.markDirty(this);
      }));
    const setStyle = (style) => {
      this.setBackgroundStyle(style);
      this.canvas.requestSave();
      this.canvas.markDirty(this);
    };
    sub.addItem((item) => item.setSection('style').setTitle(t('plugins.canvas.option-background-cover')).setIcon('lucide-scaling')
      .setChecked(!this.bgStyle || this.bgStyle === 'cover').onClick(() => setStyle('cover')));
    sub.addItem((item) => item.setSection('style').setTitle(t('plugins.canvas.option-background-ratio')).setIcon('aspect-ratio')
      .setChecked(this.bgStyle === 'ratio').onClick(() => setStyle('ratio')));
    sub.addItem((item) => item.setSection('style').setTitle(t('plugins.canvas.option-background-repeat')).setIcon('lucide-layout-grid')
      .setChecked(this.bgStyle === 'repeat').onClick(() => setStyle('repeat')));
  }

  getData() {
    const data = { ...super.getData(), type: 'group' };
    if (this.label) data.label = this.label;
    if (this.bgPath) {
      data.background = this.bgFile ? this.bgFile.path : this.bgPath;
      if (this.bgStyle && this.bgStyle !== 'cover') data.backgroundStyle = this.bgStyle;
    }
    return data;
  }

  setData(data) {
    const { label, background, backgroundStyle, ...rest } = data;
    super.setData(rest);
    if (label && typeof label === 'string') this.setLabel(label);
    if (background && typeof background === 'string') {
      if (this.bgPath !== background || (this.bgFile && this.bgFile.path !== background)) {
        this.bgPath = background;
        const file = this.app.vault.getAbstractFileByPath(background);
        this.bgFile = file && file.extension !== undefined ? file : null;
        this.canvas.markDirty(this);
      }
      if ((backgroundStyle || '') !== this.bgStyle) {
        this.bgStyle = backgroundStyle || '';
        this.canvas.markDirty(this);
      }
    } else if (this.bgPath) {
      this.bgPath = '';
      this.bgFile = null;
      this.bgStyle = '';
      this.canvas.markDirty(this);
    }
    this.updateAspectRatio();
  }
}

