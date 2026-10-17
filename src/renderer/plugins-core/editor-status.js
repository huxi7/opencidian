/* Core plugin: editor-status — shows the current editing mode in the status bar. */
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';

export const nameKey = 'plugins.editor-status';

export function create(app) {
  let itemEl = null;

  function activeMarkdownView() {
    return app.workspace.getActiveViewOfType('markdown') || null;
  }

  function modeLabel(view) {
    switch (view.getMode()) {
      case 'preview': return t('plugins.editor-status.read') || 'Reading';
      case 'source': return t('plugins.editor-status.edit-source') || 'Source mode';
      default: return t('plugins.editor-status.edit-live-preview') || 'Live Preview';
    }
  }

  function modeIcon(view) {
    switch (view.getMode()) {
      case 'preview': return 'book-open';
      case 'source': return 'code';
      default: return 'pencil';
    }
  }

  function update() {
    if (!itemEl) return;
    const view = activeMarkdownView();
    if (!view || !view.getMode) { itemEl.toggle(false); return; }
    itemEl.toggle(true);
    itemEl.empty();
    const iconEl = itemEl.createSpan('status-bar-item-icon');
    setIcon(iconEl, modeIcon(view));
    itemEl.createSpan('status-bar-item-segment').setText(modeLabel(view));
    itemEl.setAttr('aria-label', t('plugins.editor-status.name') || 'Editing mode');
  }

  function showMenu(ev) {
    const view = activeMarkdownView();
    if (!view) return;
    const menu = new Menu(app);
    const setMode = (mode) => {
      view.mode = mode;
      if (mode !== 'preview') view._lastEditMode = mode;
      view._applyMode();
      update();
    };
    menu.addItem((i) => i.setTitle(t('plugins.editor-status.read') || 'Reading')
      .setIcon('book-open')
      .setChecked(view.getMode() === 'preview')
      .onClick(() => setMode('preview')));
    menu.addItem((i) => i.setTitle(t('plugins.editor-status.edit-source') || 'Source mode')
      .setIcon('code')
      .setChecked(view.getMode() === 'source')
      .onClick(() => setMode('source')));
    menu.addItem((i) => i.setTitle(t('plugins.editor-status.edit-live-preview') || 'Live Preview')
      .setIcon('pencil')
      .setChecked(view.getMode() === 'live')
      .onClick(() => setMode('live')));
    menu.showAtMouseEvent(ev);
  }

  return {
    onload() {
      itemEl = app.workspace.statusBar.createDiv('status-bar-item plugin-editor-status');
      itemEl.onclick = (ev) => showMenu(ev);
      app.workspace.on('markdown-view-mode-change', update);
      app.workspace.on('active-leaf-change', update);
      app.workspace.on('file-open', update);
      update();
    },
    onunload() {
      if (itemEl) itemEl.detach();
    },
  };
}
