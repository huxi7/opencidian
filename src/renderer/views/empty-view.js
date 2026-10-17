/**
 * [INPUT]: 依赖 ../core/view.js 的 View；依赖 ../core/i18n.js 的 t；依赖 ../core/commands.js 的命令表（间接）。
 * [OUTPUT]: 导出 EmptyView（空标签页视图）。
 * [POS]: views/ 的空标签视图。对齐原版 JT：.empty-state > .empty-state-container，无图标；
 *        普通空标签不设标题，提供"创建新笔记 / 打开文件 / 关闭"三行；unknownPane 才显示标题与描述。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Empty view — shown for empty tabs; offers common actions like the original. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';

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
    root.addClass('empty-view');
    const state = this.state || {};
    const container = root.createDiv('empty-state').createDiv('empty-state-container');
    if (state.missing) {
      container.createDiv('empty-state-title', (el) => el.setText(t('interface.empty-state.unknown-pane-title') || 'Plugin no longer active'));
      container.createDiv('empty-state-description', (el) => el.setText((t('interface.empty-state.unknown-pane-desc') || 'The plugin that created this tab ({{type}}) has gone away.').replace('{{type}}', state.missing)));
      return;
    }
    // 原版普通空标签：无标题，三行动作（创建新笔记 / 打开文件 / 关闭）
    const actions = container.createDiv('empty-state-action-list');
    const make = (label, cb) => {
      const item = actions.createDiv('empty-state-action');
      item.setText(label);
      item.onclick = cb;
    };
    make(t('interface.empty-state.create-new-file') || 'Create new note', () => {
      this.app.commands.executeCommandById('file-explorer:new-file');
    });
    make(t('interface.empty-state.go-to-file') || 'Go to file', () => {
      this.app.commands.executeCommandById('switcher:open');
    });
    make(t('interface.empty-state.close') || 'Close', () => {
      if (this.leaf) this.leaf.detach();
    });
  }
}
