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
  getDisplayText() { return t('interface.empty-state.empty') || 'Empty'; }
  getIcon() { return 'file'; }
  getState() { return this.state; }
  setState(state) { this.state = state || {}; return Promise.resolve(); }

  async onOpen() {
    const root = this.contentEl;
    root.addClass('empty-view');
    const container = root.createDiv('empty-state');
    const missing = this.state && this.state.missing;
    if (missing) {
      container.createDiv('empty-state-title', (el) => el.setText(t('interface.empty-state.unknown-pane-title') || 'Plugin no longer active'));
      container.createDiv('empty-state-description', (el) => el.setText((t('interface.empty-state.unknown-pane-desc') || 'The plugin that created this tab ({{type}}) has gone away.').replace('{{type}}', missing)));
      return;
    }
    container.createDiv('empty-state-title', (el) => el.setText(t('interface.empty-state.no-file-open') || 'No file is open'));
    const actions = container.createDiv('empty-state-action-list');
    const make = (icon, label, cb) => {
      const item = actions.createDiv('empty-state-action');
      const iconEl = item.createDiv('empty-state-action-icon');
      setIcon(iconEl, icon);
      item.createSpan('', (el) => el.setText(label));
      item.onclick = cb;
    };
    make('file-plus', t('interface.empty-state.create-new-file') || 'Create new note', () => {
      this.app.commands.executeCommandById('file-explorer:new-file');
    });
    make('files', t('interface.empty-state.go-to-file') || 'Go to file', () => {
      this.app.commands.executeCommandById('switcher:open');
    });
    make('history', t('interface.empty-state.see-recent-files') || 'See recent files', () => {
      this.app.internalPlugins && this.app.internalPlugins.history;
      this.app.workspace.trigger('recent-files-requested');
    });
    const linksRow = root.createDiv('empty-state-extra');
  }
}
