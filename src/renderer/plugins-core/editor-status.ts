/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；依赖 ../core/menu.js 的 Menu。
 * [OUTPUT]: 导出 create(app)（editor-status 核心插件实例）。
 * [POS]: plugins-core/ 的视图状态条目。对齐原版：状态栏只显示图标（book-open / code-2 / edit-3），
 *        文案进 tooltip（aria-label + data-tooltip-position），点击与右键都打开模式菜单；mod-clickable 门控 hover。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: editor-status — shows the current editing mode in the status bar. */
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';
import { Menu } from '../core/menu.js';

export const nameKey = 'plugins.editor-status';

export function create(app: App) {
  let itemEl = null;
  let iconEl = null;

  function activeMarkdownView() {
    return app.workspace.getActiveViewOfType('markdown') || null;
  }

  function modeLabel(view) {
    switch (view.getMode()) {
      case 'preview': return t('plugins.editor-status.read') || 'Reading view';
      case 'source': return t('plugins.editor-status.edit-source') || 'Source mode';
      default: return t('plugins.editor-status.edit-live-preview') || 'Live Preview';
    }
  }

  function modeIcon(view) {
    // 原版：lucide-book-open / lucide-code-2 / lucide-edit-3
    switch (view.getMode()) {
      case 'preview': return 'lucide-book-open';
      case 'source': return 'lucide-code-2';
      default: return 'lucide-edit-3';
    }
  }

  function update() {
    if (!itemEl) return;
    const view = activeMarkdownView();
    if (!view || !view.getMode) { itemEl.toggle(false); return; }
    itemEl.toggle(true);
    iconEl.empty();
    setIcon(iconEl, modeIcon(view));
    const label = modeLabel(view);
    itemEl.setAttr('aria-label', label);
    itemEl.setAttr('data-tooltip-position', 'top');
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
    menu.addItem((i) => i.setTitle(t('plugins.editor-status.read') || 'Reading view')
      .setIcon('book-open')
      .setChecked(view.getMode() === 'preview')
      .onClick(() => setMode('preview')));
    menu.addItem((i) => i.setTitle(t('plugins.editor-status.edit-source') || 'Source mode')
      .setIcon('code-2')
      .setChecked(view.getMode() === 'source')
      .onClick(() => setMode('source')));
    menu.addItem((i) => i.setTitle(t('plugins.editor-status.edit-live-preview') || 'Live Preview')
      .setIcon('edit-3')
      .setChecked(view.getMode() === 'live')
      .onClick(() => setMode('live')));
    menu.showAtMouseEvent(ev);
  }

  return {
    onload() {
      itemEl = app.workspace.statusBar.createDiv('status-bar-item plugin-editor-status mod-clickable');
      iconEl = itemEl.createSpan('status-bar-item-icon');
      itemEl.onclick = (ev) => showMenu(ev);
      itemEl.oncontextmenu = (ev) => { ev.preventDefault(); showMenu(ev); };
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
