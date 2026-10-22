/**
 * [INPUT]: i18n、图标、PromptModal、properties-types 库级类型与 properties-menu 属性操作。
 * [OUTPUT]: 导出 renderProperties(app, container, file, options)、buildMetadataContainer(app, file, options)
 * [POS]: markdown/ 的属性面板渲染器。live-preview.js 的 PropertiesWidget 与 markdown-view.js 阅读模式共同调用。DOM 逐字对齐原版：error-container → heading → metadata-content(properties + add-button)。写回经 fileManager.processFrontMatter。
 *        阅读、实时预览与侧栏共用类型和写回路径；保留不兼容值并显示类型警告，修改只写用户编辑的键。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Properties (frontmatter) UI — live preview, source and reading modes.
 * DOM follows the original app.js structure:
 *   .metadata-container[data-property-count]
 *     > .metadata-error-container          (invalid YAML only)
 *     > .metadata-properties-heading > .collapse-indicator + .metadata-properties-title
 *     > .metadata-content > .metadata-properties + .metadata-add-button.text-icon-button
 * Edits write back through fileManager.processFrontMatter.
 */
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { PromptModal } from '../core/modals.js';
import { getPropertyTypes } from './properties-types.js';
import { attachPropertyRowMenu, showPropertyTypeMenu } from './properties-menu.js';

export function renderProperties(app, container, file, options = {}) {
  container.empty();
  const metadataEl = buildMetadataContainer(app, file, options);
  if (metadataEl) container.appendChild(metadataEl);
}

export function buildMetadataContainer(app, file, options = {}) {
  const cache = app.metadataCache.getFileCache(file);
  const fm = options.frontmatter !== undefined ? options.frontmatter : ((cache && cache.frontmatter) || null);

  const metadataEl = createDiv('metadata-container');
  metadataEl.setAttr('tabindex', '-1');
  const errorEl = metadataEl.createDiv('metadata-error-container');

  const headingEl = metadataEl.createDiv({ cls: 'metadata-properties-heading', attr: { tabindex: '0' } });
  const foldEl = headingEl.createDiv('collapse-indicator collapse-icon');
  setIcon(foldEl, 'right-triangle');
  headingEl.createDiv({ cls: 'metadata-properties-title', text: t('properties.label-heading') || 'Properties' });
  headingEl.onclick = (ev) => {
    ev.preventDefault();
    const collapsed = !metadataEl.hasClass('is-collapsed');
    metadataEl.toggleClass('is-collapsed', collapsed);
    headingEl.toggleClass('is-collapsed', collapsed);
    foldEl.toggleClass('is-collapsed', collapsed);
  };

  const contentEl = metadataEl.createDiv('metadata-content');
  const propertiesEl = contentEl.createDiv('metadata-properties');
  const addBtn = contentEl.createDiv({ cls: 'metadata-add-button text-icon-button', attr: { tabindex: '0' } });
  const addIcon = addBtn.createSpan('text-button-icon');
  setIcon(addIcon, 'plus');
  addBtn.createSpan({ cls: 'text-button-label', text: t('properties.label-add-property-button') || 'Add property' });
  addBtn.onclick = () => promptNewProperty(app, file, metadataEl, options);

  // invalid YAML: show the error container with a "show source" escape hatch
  if (options.fmError) {
    metadataEl.addClass('mod-error');
    headingEl.toggle(false);
    addBtn.toggle(false);
    errorEl.toggle(true);
    errorEl.createDiv({ cls: 'metadata-error-title', text: t('properties.label-invalid-heading') || 'Invalid properties' });
    const srcBtn = errorEl.createDiv('text-icon-button metadata-show-source-button');
    srcBtn.createSpan({ cls: 'text-button-label', text: t('properties.label-show-source') || 'Show source' });
    srcBtn.onclick = () => { if (options.onShowSource) options.onShowSource(); };
    metadataEl.setAttr('data-property-count', '0');
    return metadataEl;
  }
  errorEl.toggle(false);

  const types = getPropertyTypes(app);
  const props = [];
  if (fm && Object.keys(fm).length > 0) {
    for (const [key, value] of Object.entries(fm)) {
      props.push({ key, value });
    }
  }
  const editable = options.editable !== false;
  const hasFm = props.length > 0;
  if (!hasFm && !editable) return null;
  if (!hasFm && options.showAddButton === false) return null;

  metadataEl.refreshPropertyTypes = () => {
    propertiesEl.empty();
    for (const prop of props) {
      const info = types.getTypeInfo(prop.key, prop.value);
      renderPropertyRow(app, propertiesEl, file, { ...prop, type: info.inferred.type, typeInfo: info }, options);
    }
  };
  metadataEl.refreshPropertyTypes();
  types.registerPanel(metadataEl);
  if (!editable) addBtn.toggle(false);
  metadataEl.setAttr('data-property-count', String(props.length));
  return metadataEl;
}

function displayValue(value, type) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, type === 'datetime' ? 16 : 10);
  return String(value);
}

function renderPropertyRow(app, container, file, prop, options) {
  const editable = options.editable !== false;
  const row = container.createDiv('metadata-property');
  row.setAttr('data-property-key', prop.key);
  row.setAttr('data-property-type', prop.type);
  if (editable) attachPropertyRowMenu(app, file, prop, row);
  const keyEl = row.createDiv('metadata-property-key');
  const icon = keyEl.createSpan({ cls: 'metadata-property-icon', attr: { tabindex: editable ? '0' : '-1' } });
  setIcon(icon, prop.typeInfo.expected.icon);
  if (editable) {
    icon.setAttr('aria-label', t('properties.option-property-type'));
    icon.onclick = event => showPropertyTypeMenu(app, prop, icon, event, file);
    icon.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') icon.onclick(event); };
  }
  const keyInput = keyEl.createEl('input', { cls: 'metadata-property-key-input', type: 'text' });
  keyInput.value = prop.key;
  keyInput.readOnly = !editable;
  keyInput.setAttr('aria-label', prop.key);
  if (editable) bindKeyInput(app, file, prop, keyInput);
  if (prop.typeInfo.expected !== prop.typeInfo.inferred) {
    const warning = keyEl.createSpan('metadata-property-warning-icon');
    setIcon(warning, 'lucide-alert-triangle');
    warning.setAttr('aria-label', t('properties.label-type-mismatch-warning', { type: prop.typeInfo.expected.name() }));
  }
  const valueEl = row.createDiv('metadata-property-value');
  valueEl.setAttr('data-property-type', prop.type);
  if (prop.type === 'checkbox') {
    const cb = valueEl.createEl('input', { type: 'checkbox', cls: 'metadata-input-checkbox' });
    cb.checked = !!prop.value;
    cb.disabled = !editable;
    cb.setAttr('data-indeterminate', String(prop.value == null));
    cb.setAttr('aria-label', prop.key);
    if (editable) cb.onchange = async () => {
      cb.setAttr('data-indeterminate', 'false');
      await app.fileManager.processFrontMatter(file, fm => { fm[prop.key] = cb.checked; });
    };
    return;
  }
  if (['tags', 'aliases', 'multitext'].includes(prop.type)) {
    renderList(app, file, prop, valueEl, editable);
    return;
  }
  if (prop.type === 'unknown') {
    valueEl.createDiv({ cls: 'metadata-property-value-display', text: JSON.stringify(prop.value) });
    return;
  }
  const text = prop.type === 'text';
  const input = text
    ? valueEl.createDiv({ cls: 'metadata-input-longtext', attr: { contenteditable: editable ? 'true' : 'false', role: 'textbox', tabindex: editable ? '0' : '-1' } })
    : valueEl.createEl('input', { cls: 'metadata-input metadata-input-text' + (prop.type === 'number' ? ' metadata-input-number' : ' mod-' + prop.type), type: prop.type === 'number' ? 'number' : prop.type === 'datetime' ? 'datetime-local' : 'date' });
  const getValue = () => text ? input.textContent : input.value;
  const setValue = value => { if (text) input.textContent = value; else input.value = value; };
  setValue(displayValue(prop.value, prop.type));
  input.setAttr('placeholder', t('properties.label-no-value'));
  input.readOnly = !editable;
  if (prop.type === 'number') { input.step = 'any'; input.inputMode = 'decimal'; }
  if (!editable) return;
  let last = getValue();
  const commit = async () => {
    if (getValue() === last) return;
    const raw = getValue();
    let value = raw === '' && (prop.type === 'date' || prop.type === 'datetime') ? null : raw;
    if (prop.type === 'number') {
      if (!input.validity.valid || (raw !== '' && !Number.isFinite(Number(raw)))) { input.setAttr('aria-invalid', 'true'); return; }
      value = raw === '' ? null : Number(raw);
    }
    if ((prop.type === 'date' || prop.type === 'datetime') && (!input.validity.valid || (raw && !getPropertyTypes(app).getWidget(prop.type).validate(raw)))) {
      input.setAttr('aria-invalid', 'true'); return;
    }
    input.removeAttribute('aria-invalid');
    last = raw;
    try { await app.fileManager.processFrontMatter(file, fm => { fm[prop.key] = value; }); }
    catch (error) { last = displayValue(prop.value, prop.type); throw error; }
  };
  input.commitMetadata = commit;
  input.onblur = commit;
  input.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); setValue(last); input.blur(); }
  };
  if (text) {
    input.onpaste = event => {
      const plain = event.clipboardData?.getData('text/plain');
      if (plain !== undefined) { event.preventDefault(); input.ownerDocument.execCommand('insertText', false, plain); }
    };
  }
}

function bindKeyInput(app, file, prop, input) {
  let last = prop.key;
  const commit = async () => {
    const next = input.value.trim();
    if (next === last) return;
    if (!next) { input.setAttr('aria-invalid', 'true'); input.title = t('properties.msg-empty-property-name'); return; }
    let changed = false;
    const cancelled = {};
    try { await app.fileManager.processFrontMatter(file, fm => {
      const duplicate = Object.keys(fm).some(key => key !== last && key.toLowerCase() === next.toLowerCase());
      if (duplicate || !Object.hasOwn(fm, last)) throw cancelled;
      const entries = Object.entries(fm).map(([key, value]) => [key === last ? next : key, value]);
      for (const key of Object.keys(fm)) delete fm[key];
      Object.assign(fm, Object.fromEntries(entries));
      changed = true;
    }); } catch (error) { if (error !== cancelled) throw error; }
    if (changed) { last = next; input.removeAttribute('aria-invalid'); }
    else { input.setAttr('aria-invalid', 'true'); input.title = t('properties.msg-duplicate-property-name'); }
  };
  input.commitMetadata = commit;
  input.onblur = commit;
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = last; input.blur(); }
  };
}

function renderList(app, file, prop, valueEl, editable) {
  const values = Array.isArray(prop.value) ? prop.value : prop.value == null || prop.value === '' ? [] : [prop.value];
  const pills = valueEl.createDiv('multi-select-container');
  for (const value of values) {
    const pill = pills.createDiv('multi-select-pill');
    pill.createSpan({ cls: 'multi-select-pill-content', text: String(value) });
    if (editable) {
      const remove = pill.createDiv('multi-select-pill-remove-button');
      setIcon(remove, 'lucide-x');
      remove.onclick = async event => {
        event.stopPropagation();
        await app.fileManager.processFrontMatter(file, fm => {
          const current = Array.isArray(fm[prop.key]) ? fm[prop.key] : fm[prop.key] == null ? [] : [fm[prop.key]];
          fm[prop.key] = current.filter(item => String(item) !== String(value));
        });
      };
    }
  }
  if (!editable) return;
  const input = pills.createEl('input', { type: 'text', cls: 'multi-select-input' });
  const commit = async () => {
    const raw = input.value.trim();
    if (!raw) return;
    if (prop.type === 'tags' && /\s/.test(raw)) { input.setAttr('aria-invalid', 'true'); input.title = t('properties.msg-invalid-tag'); return; }
    input.value = '';
    await app.fileManager.processFrontMatter(file, fm => {
      const current = Array.isArray(fm[prop.key]) ? [...fm[prop.key]] : fm[prop.key] == null || fm[prop.key] === '' ? [] : [fm[prop.key]];
      if (!current.some(value => String(value) === raw)) current.push(raw);
      fm[prop.key] = current;
    });
  };
  input.commitMetadata = commit;
  input.onblur = commit;
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = ''; input.blur(); }
  };
}

async function promptNewProperty(app, file, container, options) {
  new PromptModal(app, {
    title: t('properties.label-add-property-button'),
    placeholder: 'key',
    onSubmit: async (key) => {
      key = key.trim();
      if (!key) return;
      await app.fileManager.processFrontMatter(file, (fm) => {
        if (!Object.keys(fm).some(name => name.toLowerCase() === key.toLowerCase())) fm[key] = '';
      });
    },
  }).open();
}
