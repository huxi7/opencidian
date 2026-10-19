/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/modals.js 的 Modal；依赖 ../core/keymap.js 的 IS_MAC。
 * [OUTPUT]: 导出 CanvasHelpModal（画布帮助弹窗）与 hotkeyLabel（按平台拼组合键文案）。
 * [POS]: views/ 画布帮助弹窗（原版 c3）。左下控件组最后一组的 help 按钮打开本弹窗；
 *        行结构对齐原版 .canvas-help > .canvas-instruction（标签 + .canvas-instruction-desc 里的 .setting-hotkey 组合键），
 *        组合键按平台拼接（macOS 用 ⌘⇧⌥⌃ 且不加分隔符，其他平台用 Ctrl/Shift/Alt + 号连接）。
 *        默认滚轮行为为滚动平移，故「移动白板」是 Space+拖动 与 滚动，「缩放」是 Mod+滚动 与 Space+滚动；
 *        插件选项 defaultWheelBehavior 为 zoom 时两者互换（原版 c3 的分支）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas help modal — original c3: instruction rows with platform hotkey labels. */
import { t } from '../core/i18n.js';
import { Modal } from '../core/modals.js';
import { IS_MAC } from '../core/keymap.js';

const MOD_DISPLAY_MAC = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };

/** 原版 l3：把 ['Mod','Shift','1'] 这样的组合拼成 "⌘⇧1"（macOS）或 "Ctrl+Shift+1"。 */
export function hotkeyLabel(parts) {
  const out = [];
  for (const part of parts) {
    if (IS_MAC) out.push(MOD_DISPLAY_MAC[part] || part);
    else out.push(part === 'Mod' ? 'Ctrl' : part);
  }
  return out.join(IS_MAC ? ' ' : ' + ');
}

export class CanvasHelpModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.modalEl.addClass('mod-canvas-help');
    this.setTitle(t('plugins.canvas.label-canvas-help'));
    this.helpEl = this.contentEl.createDiv('canvas-help');
  }

  /** 原版 o()：一行文案 + 若干组合键；每个组合键一个 .setting-hotkey 片段。 */
  addInstruction(label, hotkeys) {
    const row = this.helpEl.createDiv('canvas-instruction');
    row.createDiv({ cls: 'canvas-instruction-label', text: label });
    const desc = row.createDiv('canvas-instruction-desc');
    for (const combo of hotkeys) desc.createSpan({ cls: 'setting-hotkey', text: hotkeyLabel(combo) });
  }

  onOpen() {
    this.helpEl.empty();
    const wheelIsZoom = this.options.defaultWheelBehavior === 'zoom';
    const scroll = [['Scroll']];
    const variant = [['Mod', 'Scroll'], ['Space', 'Scroll']];
    const panWheel = wheelIsZoom ? variant : scroll;
    const zoom = wheelIsZoom ? scroll : variant;
    const shiftScroll = wheelIsZoom ? [['Mod', 'Shift', 'Scroll'], ['Shift', 'Space', 'Scroll']] : [['Shift', 'Scroll']];

    this.addInstruction(t('plugins.canvas.label-pan'), [['Space', 'Drag'], ...panWheel]);
    this.addInstruction(t('plugins.canvas.label-pan-horizontal'), shiftScroll);
    this.addInstruction(t('plugins.canvas.label-zoom'), zoom);
    this.addInstruction(t('plugins.canvas.action-zoom-to-fit'), [['Shift', '1']]);
    this.addInstruction(t('plugins.canvas.action-zoom-to-selection'), [['Shift', '2']]);
    this.addInstruction(t('plugins.canvas.label-select-all'), [['Mod', 'A']]);
    this.addInstruction(t('plugins.canvas.label-add-remove-selection'), [['Shift', 'Click'], ['Shift', 'Drag to select']]);
    this.addInstruction(t('plugins.canvas.action-create-with-size'), [['Mod', 'Drag to select']]);
    this.addInstruction(t('plugins.canvas.label-clone-card'), [[IS_MAC ? 'Alt' : 'Ctrl', 'Drag']]);
    this.addInstruction(t('plugins.canvas.label-constrain-movement-axis'), [['Shift', 'Drag']]);
    this.addInstruction(t('plugins.canvas.label-disable-drag-snapping'), [[IS_MAC ? 'Ctrl' : 'Alt']]);
    this.addInstruction(t('plugins.canvas.label-remove-card'), [['Backspace'], ['Delete']]);
    this.addInstruction(t('setting.mobile-toolbar.option-undo'), [['Mod', 'Z']]);
    this.addInstruction(t('setting.mobile-toolbar.option-redo'), [['Mod', 'Y'], ['Mod', 'Shift', 'Z']]);
  }
}
