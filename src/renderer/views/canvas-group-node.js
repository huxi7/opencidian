/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasNode（基类）与 ./canvas-utils.js 的 bboxOf（经基类使用）；依赖 ../core/i18n.js 的 t。
 * [OUTPUT]: 导出 CanvasGroupNode（分组节点）。
 * [POS]: views/ 画布节点层的分组节点（从 canvas-node.js 拆出，保持单文件 ≤800 行）。分组是圆角矩形 + 顶部 contenteditable 标签，
 *        永远铺在底层：z 取 -宽*高（原版 F5），面积越大越靠后，且不参与单选的临时置顶；isGroup 为真时参与对齐与包含判定。
 *        标签编辑只改标签，几何与写盘由 canvas-view 调度。
 *        标签前景色按分组色（--canvas-color）亮度切 mod-foreground-light/dark。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas group node — label editing and theme-aware label colors. */
import { CanvasNode } from './canvas-node.js';
import { t } from '../core/i18n.js';

/* --------------------------------------------------------------------------
 * 分组 — 圆角矩形 + 顶部 label（contenteditable），永远铺在底层
 * ------------------------------------------------------------------------ */
export class CanvasGroupNode extends CanvasNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.isGroup = true;
    this.label = '';
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
    // 主题色明暗：从 CSS 变量读回 rgb 值，浅色文字配深底
    let light = false;
    let dark = false;
    if (this.color) {
      const raw = getComputedStyle(this.nodeEl).getPropertyValue('--canvas-color').trim();
      const m = raw.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
      if (m) {
        const l = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
        if (l > 0.7) dark = true;
        else if (l < 0.4) light = true;
      }
    }
    labelEl.toggleClass('mod-foreground-light', light);
    labelEl.toggleClass('mod-foreground-dark', dark);
  }

  /** 分组菜单在原版基础上追加「编辑文字」（原版 F5.showMenu）。 */
  showMenu(menu) {
    super.showMenu(menu);
    if (this.canvas.readonly) return;
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-edit-label')).setIcon('lucide-edit')
      .onClick(() => this.focusLabel()));
  }

  getData() {
    const data = { ...super.getData(), type: 'group' };
    if (this.label) data.label = this.label;
    return data;
  }

  setData(data) {
    super.setData(data);
    if (data.label && typeof data.label === 'string') this.setLabel(data.label);
  }
}

