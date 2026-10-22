/**
 * [INPUT]: 依赖 ../core/modals.js 的 Modal；依赖 ../core/setting.js 的 Setting；依赖 ../core/i18n.js 的 t。
 * [OUTPUT]: 导出 CanvasExportModal（构造参数 canvas、metrics、onSave）。
 * [POS]: views/ 画布导出图片的设置弹窗（原版 generateHDImage 里的 CanvasExportModal）。DOM 对齐原版：
 *        .modal.mod-narrow > .modal-content 内 p.u-muted（标题描述）+ 四个 Setting（范围下拉/缩放滑杆/显示水印/隐私模式），
 *        确认按钮在 .modal-button-container（mod-cta，文案 dialogue.button-save）。
 *        弹窗不渲染图像、不碰磁盘：数值全经构造参数注入（dimensionsFor 由 canvas-export.js 提供，避免两模块循环依赖），
 *        onSave 回报导出选项；viewport 不回报 scale。范围选「仅当前部分」时隐藏缩放与水印；预计尺寸含取整后的设备密度与 16284 长边限制。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas export options modal — original CanvasExportModal (generateHDImage step 1). */
import { Modal } from '../core/modals.js';
import { Setting } from '../core/setting.js';
import { t } from '../core/i18n.js';

export class CanvasExportModal extends Modal {
  /**
   * @param {CanvasView} canvas
   * @param {{worldWidth:number, worldHeight:number, maxSize:number, maxZoom:number, dimensionsFor:Function, onSave:Function}} metrics
   */
  constructor(canvas, metrics) {
    super(canvas.app);
    this.canvas = canvas;
    this.metrics = metrics;
    this.frame = 'full';
    this.showLogo = true;                       // 原版默认显示 logo
    this.privacyMode = false;                   // 原版默认关闭隐私模式
    this.zoom = Math.log2(Math.min(1, metrics.maxZoom));
    this.setTitle(t('plugins.canvas.action-export-png'));
    this.modalEl.addClass('mod-narrow');
    this.build();
  }

  build() {
    const title = this.canvas.file ? this.canvas.file.basename : '';
    this.contentEl.createEl('p', {
      cls: 'u-muted',
      text: t('plugins.canvas.label-export-png-desc', { title }),
    });
    new Setting(this.contentEl)
      .setName(t('plugins.canvas.option-export-png-frame'))
      .setDesc(t('plugins.canvas.option-export-png-frame-desc'))
      .addDropdown((dropdown) => {
        this.frameDropdown = dropdown;
        dropdown.addOption('full', t('plugins.canvas.option-export-png-frame-full'));
        dropdown.addOption('viewport', t('plugins.canvas.option-export-png-frame-viewport'));
        dropdown.setValue(this.frame);
        dropdown.onChange((value) => { this.frame = value; this.syncFrameSettings(); });
      });
    this.zoomSetting = new Setting(this.contentEl)
      .setName(t('plugins.canvas.option-export-png-zoom'))
      .setDesc('')
      .addSlider((slider) => {
        this.zoomSlider = slider;
        const max = Math.log2(this.metrics.maxZoom);
        slider.setLimits(Math.min(-1, max), max, 'any');
        slider.setValue(this.zoom);
        slider.setDynamicTooltip();
        slider.getValuePretty = () => Math.pow(2, slider.getValue()).toFixed(2);
        slider.onChange((value) => { this.zoom = value; this.syncDimensions(); });
      });
    this.syncDimensions();
    this.logoSetting = new Setting(this.contentEl)
      .setName(t('plugins.canvas.option-export-png-show-logo'))
      .setDesc(t('plugins.canvas.option-export-png-show-logo-desc'))
      .addToggle((toggle) => {
        this.logoToggle = toggle;
        toggle.setValue(this.showLogo);
        toggle.onChange((value) => { this.showLogo = value; });
      });
    this.privacySetting = new Setting(this.contentEl)
      .setName(t('plugins.canvas.option-export-png-privacy-mode'))
      .setDesc(t('plugins.canvas.option-export-png-privacy-mode-desc'))
      .addToggle((toggle) => {
        this.privacyToggle = toggle;
        toggle.setValue(this.privacyMode);
        toggle.onChange((value) => { this.privacyMode = value; });
      });
    const save = this.buttonContainerEl.createEl('button', {
      cls: 'mod-cta',
      text: t('dialogue.button-save'),
    });
    save.onclick = () => this.submit();
  }

  /** 范围切换：仅当前部分时隐藏缩放与水印（原版 setVisibility；无值的控件不参与导出）。 */
  syncFrameSettings() {
    const full = this.frame === 'full';
    this.zoomSetting.settingEl.toggleClass('is-hidden', !full);
    this.logoSetting.settingEl.toggleClass('is-hidden', !full);
  }

  /** 预计图像尺寸：使用原版密度取整与 16284 长边限制，由注入的几何函数返回。 */
  syncDimensions() {
    const size = this.metrics.dimensionsFor(Math.pow(2, this.zoom));
    const dimensions = `${size.width.toLocaleString()}px x ${size.height.toLocaleString()}px`;
    this.zoomSetting.setDesc(t('plugins.canvas.label-export-png-dimensions', { dimensions }));
  }

  submit() {
    const options = {
      frame: this.frame,
      showLogo: this.showLogo,
      privacyMode: this.privacyMode,
    };
    if (this.frame === 'full') options.scale = Math.pow(2, this.zoom);
    this.metrics.onSave(options);
    this.close();
  }
}
