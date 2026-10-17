/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/suggest.js 的 AbstractInputSuggest；依赖 ../core/modals.js 的 PromptModal；依赖 ../core/menu.js 的 Menu
 * [OUTPUT]: 导出 renderProperties(app, container, file, options)、buildMetadataContainer(app, file, options)
 * [POS]: markdown/ 的属性面板渲染器。live-preview.js 的 PropertiesWidget 与 markdown-view.js 阅读模式共同调用。DOM 逐字对齐原版：error-container → heading → metadata-content(properties + add-button)。写回经 fileManager.processFrontMatter。
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
import { AbstractInputSuggest } from '../core/suggest.js';
import { PromptModal } from '../core/modals.js';
import { Menu } from '../core/menu.js';

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

  const props = [];
  if (fm && Object.keys(fm).length > 0) {
    for (const [key, value] of Object.entries(fm)) {
      props.push({ key, value, type: inferType(key, value) });
    }
  }
  const editable = options.editable !== false;
  const hasFm = props.length > 0;
  if (!hasFm && !editable) return null;
  if (!hasFm && options.showAddButton === false) return null;

  for (const prop of props) {
    renderPropertyRow(app, propertiesEl, file, prop, options);
  }
  if (!editable) addBtn.toggle(false);
  metadataEl.setAttr('data-property-count', String(props.length));
  return metadataEl;
}

function inferType(key, value) {
  if (['tags', 'aliases', 'cssclasses'].includes(key)) return key === 'tags' ? 'tags' : 'multitext';
  if (Array.isArray(value)) return 'multitext';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'date';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
    if (/^\[\[.*\]\]$/.test(value.trim())) return 'text';
    return 'text';
  }
  return 'text';
}

function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function renderPropertyRow(app, container, file, prop, options) {
  const row = container.createDiv('metadata-property');
  row.setAttr('data-property-key', prop.key);
  row.setAttr('data-property-type', prop.type);
  const keyEl = row.createDiv('metadata-property-key');
  keyEl.createSpan({ cls: 'metadata-property-icon' });
  setIcon(keyEl.querySelector('.metadata-property-icon'), typeIcon(prop.type));
  const keyText = keyEl.createSpan({ cls: 'metadata-property-key-input' });
  keyText.setText(displayKey(prop.key));

  const valueEl = row.createDiv('metadata-property-value');
  const valueDisplay = valueEl.createDiv('metadata-property-value-display');
  valueDisplay.setText(displayValue(prop.value));

  if (prop.type === 'checkbox') {
    const cb = valueEl.createDiv('checkbox-container');
    cb.toggleClass('is-enabled', !!prop.value);
    cb.onclick = async () => {
      const next = !cb.hasClass('is-enabled');
      cb.toggleClass('is-enabled', next);
      await app.fileManager.processFrontMatter(file, (fm2) => { fm2[prop.key] = next; });
    };
    valueDisplay.detach();
    valueEl.prepend(cb);
    return;
  }

  if (prop.type === 'tags' || prop.type === 'multitext') {
    valueEl.empty();
    const values = Array.isArray(prop.value) ? prop.value : String(prop.value || '').split(/[,\s]+/).filter(Boolean);
    const pills = valueEl.createDiv('multi-select-container');
    for (const v of values) {
      const pill = pills.createDiv('multi-select-pill');
      const pillText = pill.createSpan({ cls: 'multi-select-pill-content' });
      pillText.setText(String(v));
      if (options.editable !== false) {
        const remove = pill.createDiv('multi-select-pill-remove-button');
        setIcon(remove, 'x');
        remove.onclick = async (ev) => {
          ev.stopPropagation();
          await app.fileManager.processFrontMatter(file, (fm2) => {
            const arr = normalizeArray(fm2[prop.key]);
            fm2[prop.key] = arr.filter((x) => String(x) !== String(v));
          });
        };
      }
    }
    if (options.editable !== false) {
      const input = pills.createEl('input', { type: 'text', cls: 'multi-select-input' });
      input.placeholder = '';
      input.onkeydown = async (ev) => {
        if (ev.key === 'Enter' && input.value.trim()) {
          ev.preventDefault();
          await app.fileManager.processFrontMatter(file, (fm2) => {
            const arr = normalizeArray(fm2[prop.key]);
            arr.push(input.value.trim());
            fm2[prop.key] = arr;
          });
        }
      };
      input.onblur = async () => {
        if (input.value.trim()) {
          await app.fileManager.processFrontMatter(file, (fm2) => {
            const arr = normalizeArray(fm2[prop.key]);
            arr.push(input.value.trim());
            fm2[prop.key] = arr;
          });
        }
      };
    }
    return;
  }

  if (options.editable !== false && !prop.readonly) {
    valueDisplay.setAttr('tabindex', '0');
    valueDisplay.onclick = () => editPropertyValue(app, file, prop, valueDisplay);
    row.setAttr('tabindex', '0');
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const menu = new Menu(app);
      menu.addItem((i) => i.setTitle(t('plugins.properties.opt-delete-properties') || 'Delete property')
        .setIcon('trash')
        .onClick(async () => {
          await app.fileManager.processFrontMatter(file, (fm2) => { delete fm2[prop.key]; });
        }));
      menu.showAtMouseEvent(ev);
    });
  }
}

function normalizeArray(v) {
  if (Array.isArray(v)) return [...v];
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(/[,\s]+/).filter(Boolean);
}

function typeIcon(type) {
  switch (type) {
    case 'tags': return 'tag';
    case 'checkbox': return 'check-square';
    case 'number': return 'hash';
    case 'date': return 'calendar';
    case 'datetime': return 'clock';
    case 'multitext': return 'list';
    default: return 'text';
  }
}

function displayKey(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function editPropertyValue(app, file, prop, valueEl) {
  if (valueEl.querySelector('input')) return;
  const input = createEl('input', { type: 'text', cls: 'metadata-input' });
  input.value = displayValue(prop.value);
  valueEl.setText('');
  valueEl.appendChild(input);
  input.focus();
  input.select();
  const commit = async () => {
    const raw = input.value;
    let value = raw;
    if (prop.type === 'number' && raw !== '' && !isNaN(Number(raw))) value = Number(raw);
    await app.fileManager.processFrontMatter(file, (fm2) => { fm2[prop.key] = value; });
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); valueEl.setText(displayValue(prop.value)); }
  };
  input.onblur = () => commit();

  if (prop.type === 'text' || prop.key === 'tags' || prop.key === 'aliases') {
    attachFileSuggest(app, input);
  }
}

function attachFileSuggest(app, input) {
  const suggest = new AbstractInputSuggest(app, input);
  suggest.getSuggestions = (query) => {
    const q = query.toLowerCase();
    return app.vault.getMarkdownFiles()
      .map((f) => f.basename)
      .filter((b) => b.toLowerCase().includes(q))
      .slice(0, 30);
  };
  suggest.selectSuggestion = () => {};
}

async function promptNewProperty(app, file, container, options) {
  new PromptModal(app, {
    title: 'Property name',
    placeholder: 'key',
    onSubmit: async (key) => {
      if (!key) return;
      await app.fileManager.processFrontMatter(file, (fm) => {
        if (!(key in fm)) fm[key] = '';
      });
    },
  }).open();
}
