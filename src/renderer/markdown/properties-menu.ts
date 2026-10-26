/**
 * [INPUT]: Menu、Modal、i18n、PropertyTypes 与 Electron 剪贴板；属性值及输入选区。
 * [OUTPUT]: attachPropertyRowMenu、showPropertyTypeMenu；共用属性菜单和显式格式转换确认。
 * [POS]: 属性操作边界。类型赋值不改笔记值；不兼容值只在确认后经 processFrontMatter 改写。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Menu } from '../core/menu.js';
import { Modal } from '../core/modals.js';
import { t } from '../core/i18n.js';
import { getPropertyTypes } from './properties-types.js';
import type { TFile } from '../core/vault.js';
import type { PropertyValue, PropertyWidget } from './reading-types.js';

export function attachPropertyRowMenu(app: App, file: TFile, prop: PropertyValue, row: HTMLElement) {
  row.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu(app);
    menu.addSections(['title', 'action', 'action.changeType', 'selection', 'clipboard', '', 'danger']);
    menu.setSectionSubmenu('action.changeType', { title: t('properties.option-property-type'), icon: 'lucide-info' });
    addTypeItems(app, prop, menu, file);
    addClipboardItems(menu, event);
    menu.addItem(item => item.setSection('danger').setTitle(t('interface.menu.remove')).setWarning(true).setIcon('lucide-trash-2')
      .onClick(() => app.fileManager.processFrontMatter(file, fm => { delete fm[prop.key]; })));
    menu.setParentElement(row).showAtMouseEvent(event);
  });
}

export function showPropertyTypeMenu(app: App, prop: PropertyValue, anchor: HTMLElement, event: MouseEvent, file?: TFile) {
  event.preventDefault();
  event.stopPropagation();
  const menu = new Menu(app);
  addTypeItems(app, prop, menu, file);
  menu.setParentElement(anchor).showAtMouseEvent(event);
}

function addTypeItems(app: App, prop: PropertyValue, menu: Menu, file: TFile|undefined) {
  const types = getPropertyTypes(app);
  const assigned = types.getAssignedWidget(prop.key);
  const inferred = types.getTypeInfo(prop.key, prop.value).inferred;
  const reserved = types.isReserved(prop.key);
  if (!reserved) menu.addItem(item => item.setSection('action.changeType').setIcon('lucide-loader')
    .setTitle(assigned ? t('plugins.properties.opt-automatic') : t('plugins.properties.opt-automatic-with-type', { type: inferred.name() }))
    .setChecked(!assigned).onClick(() => types.unsetType(prop.key)));
  for (const widget of Object.values(types.registeredTypeWidgets)) {
    if (widget.reservedKeys && !widget.reservedKeys.includes(prop.key.toLowerCase())) continue;
    menu.addItem(item => item.setSection('action.changeType').setTitle(widget.name()).setIcon(widget.icon)
      .setChecked(assigned === widget.type).setDisabled(reserved).onClick(async () => {
        await types.setType(prop.key, widget.type);
        if (file && prop.value != null && !widget.validate(prop.value)) promptAdaptation(app, file, prop, widget, inferred);
      }));
  }
}

function promptAdaptation(app: App, file: TFile, prop: PropertyValue, widget: PropertyWidget, inferred: PropertyWidget) {
  const modal = new Modal(app);
  modal.setTitle(t('properties.label-change-property-type', { type: widget.type }));
  modal.contentEl.createEl('p', { text: t('properties.label-change-property-type-desc', { oldType: inferred.type }) });
  const update = modal.buttonContainerEl.createEl('button', { cls: 'mod-cta', text: t('dialogue.button-update') });
  update.onclick = async () => {
    update.disabled = true;
    const cancelled = {};
    try {
      // 只转换打开确认框时仍未变化的值，避免覆盖用户并行编辑。
      await app.fileManager.processFrontMatter(file, fm => {
        if (JSON.stringify(fm[prop.key]) !== JSON.stringify(prop.value)) throw cancelled;
        fm[prop.key] = adaptValue(fm[prop.key], widget.type);
      });
      modal.close();
    } catch (error) { if (error !== cancelled) throw error; else modal.close(); } finally { update.disabled = false; }
  };
  modal.buttonContainerEl.createEl('button', { text: t('dialogue.button-cancel') }).onclick = () => modal.close();
  if (modal.scope) app.keymap.register(modal.scope, [], 'Enter', () => { update.click(); return true; });
  modal.open();
}

function adaptValue(value: unknown, type: string) {
  if (type === 'text') return typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (type === 'multitext') return value == null ? [] : Array.isArray(value) ? value : [value];
  if (type === 'number') return String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === 'checkbox') return value === true || value === 1 || value === 'true';
  if (type === 'date' || type === 'datetime') {
    const moment = require('moment')(value);
    return moment.isValid() ? moment.format(type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD[T]HH:mm') : null;
  }
  return value;
}

function addClipboardItems(menu: Menu, event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const doc = event.target.ownerDocument;
  const input = event.target.closest<HTMLElement>('input,textarea,[contenteditable="true"]');
  const textInput = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input : null;
  const editable = textInput ? !textInput.readOnly && !textInput.disabled : !!input?.isContentEditable;
  const from = textInput?.selectionStart;
  const to = textInput?.selectionEnd;
  const selection = doc.getSelection();
  const range = from == null && input && selection?.rangeCount && input.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
  const selected = textInput && from != null && to != null ? textInput.value.slice(from, to) : range ? range.toString() : String(selection || '');
  const clipboard: typeof import('electron').clipboard = require('electron').clipboard;
  const changeSelection = async (value: string) => {
    if (!input || !editable) return;
    input.focus();
    if (textInput && from != null && to != null) textInput.setRangeText(value, from, to, 'end');
    else if (range) {
      range.deleteContents();
      const inserted = doc.createTextNode(value);
      range.insertNode(inserted);
      range.setStartAfter(inserted); range.collapse(true);
      selection?.removeAllRanges(); selection?.addRange(range);
    } else if (input.isContentEditable) input.textContent += value;
    else if (textInput) textInput.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (input.commitMetadata) await input.commitMetadata();
  };
  menu.addItem(item => item.setSection('clipboard').setTitle(t('interface.menu.cut')).setIcon('lucide-scissors')
    .setDisabled(!editable || !selected).onClick(async () => { clipboard.writeText(selected); await changeSelection(''); }));
  menu.addItem(item => item.setSection('clipboard').setTitle(t('interface.menu.copy')).setIcon('lucide-copy')
    .setDisabled(!selected).onClick(() => clipboard.writeText(selected)));
  menu.addItem(item => item.setSection('clipboard').setTitle(t('interface.menu.paste')).setIcon('lucide-clipboard-check')
    .setDisabled(!editable).onClick(() => changeSelection(clipboard.readText())));
}
