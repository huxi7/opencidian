/**
 * [INPUT]: 依赖 ../core/view.js 的 View；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon；
 *          依赖 app.hotkeyManager（printHotkeyForCommand）与 app.commands（命令派发）。
 * [OUTPUT]: 导出 EmptyView（空标签页视图）。
 * [POS]: views/ 的空标签视图。对齐原版 1.14.4 aI：.empty-state > .empty-state-container，
 *        普通空标签不设标题，动作行是 pill（.text-icon-button.mod-pill.empty-state-action）：
 *        图标 + 文案 + 热键后缀；顺序=笔记 → 数据库 → 白板 → 文件。插件启停同步入口。
 *        unknownPane 才显示标题与描述。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Empty view — shown for empty tabs; offers common actions like the original. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';

export class EmptyView extends View {
  constructor(leaf) {
    super(leaf);
    this.state = { type: 'empty' };
  }
  getViewType() { return 'empty'; }
  getDisplayText() { return t('interface.label-new-tab') || 'New tab'; }
  getIcon() { return 'file'; }
  getState() { return this.state; }
  setState(state) { this.state = state || {}; return Promise.resolve(); }

  async onOpen() {
    const root = this.contentEl;
    this._actionsRef?.unregister();
    root.empty();
    root.addClass('empty-view');
    const state = this.state || {};
    const container = root.createDiv('empty-state').createDiv('empty-state-container');
    if (state.missing) {
      container.createDiv('empty-state-title', (el) => el.setText(t('interface.empty-state.unknown-pane-title') || 'Plugin no longer active'));
      container.createDiv('empty-state-description', (el) => el.setText((t('interface.empty-state.unknown-pane-desc') || 'The plugin that created this tab ({{type}}) has gone away.').replace('{{type}}', state.missing)));
      return;
    }
    // 原版 aI.onOpen（app.js:1433129）：每个动作 = text-icon-button.mod-pill.empty-state-action，
    // 内含 .text-button-icon + .text-button-label；有物理键盘时追加 .empty-state-hotkey 后缀。
    const actions = container.createDiv('empty-state-action-list');
    const addAction = (commandId, label, icon) => {
      const button = actions.createDiv({
        cls: 'text-icon-button tappable mod-pill empty-state-action',
        attr: { tabindex: '0', role: 'button' },
      });
      setIcon(button.createSpan('text-button-icon'), icon);
      button.createSpan({ cls: 'text-button-label', text: label });
      button.setAttr('aria-label', label);
      button.setAttr('data-command-id', commandId);
      button.onclick = (ev) => this.app.commands.executeCommandById(commandId, ev);
      button.onkeydown = (ev) => {
        if (!ev.repeat && (ev.key === 'Enter' || ev.key === ' ')) {
          ev.preventDefault(); this.app.commands.executeCommandById(commandId, ev);
        }
      };
      const hotkey = this.app.hotkeyManager ? this.app.hotkeyManager.printHotkeyForCommand(commandId) : '';
      if (hotkey) button.createSpan({ cls: 'empty-state-hotkey', text: ' ' + hotkey });
    };
    const renderActions = () => {
      actions.empty();
      addAction('file-explorer:new-file', t('plugins.file-explorer.action-new-note') || 'New note', 'lucide-square-pen');
      if (this.app.plugins?.getInternalPlugin('bases')?.enabled) {
        addAction('bases:new-file', t('plugins.bases.action-new-base') || 'New base', 'lucide-layout-list');
      }
      const canvasPlugin = this.app.plugins && this.app.plugins.getInternalPlugin
        ? this.app.plugins.getInternalPlugin('canvas')
        : null;
      if (canvasPlugin && canvasPlugin.enabled) {
        addAction('canvas:new-file', t('plugins.canvas.action-new-canvas') || 'New canvas', 'lucide-layout-dashboard');
      }
      // 原版：vault.isEmpty() 时不提供"前往文件"
      if (this.app.vault.getFiles().length > 0) {
        addAction('switcher:open', t('interface.empty-state.go-to-file') || 'Go to file', 'lucide-search');
      }
    };
    renderActions();
    this._actionsRef = this.app.workspace.on('layout-change', renderActions);
  }
  async onClose() { this._actionsRef?.unregister(); this._actionsRef = null; }
}
