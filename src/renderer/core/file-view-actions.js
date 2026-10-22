/**
 * [INPUT]: 文件视图、视图头容器与 Desktop.openPath。
 * [OUTPUT]: 导出 addDefaultAppAction，添加默认应用动作。
 * [POS]: 文件视图共用动作。非文件视图无入口；点击走受保护 IPC。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop } from './ipc.js';
import { t } from './i18n.js';
import { setIcon } from './icons.js';

export function addDefaultAppAction(app, view, actions) {
  if (!view.file || actions.querySelector('.mod-open-default-app')) return;
  const button = actions.createDiv('clickable-icon view-action mod-open-default-app');
  button.setAttr('aria-label', t('plugins.open-with-default-app.action-open-file'));
  setIcon(button, 'lucide-arrow-up-right');
  button.onclick = () => Desktop.openPath(app.vault.adapter.toAbs(view.file.path));
  const more = actions.querySelector('.mod-more-options');
  if (more) actions.insertBefore(button, more);
}
