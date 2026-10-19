/**
 * [INPUT]: 依赖 core/i18n.js 的 t/tt、core/notices.js 的 Notice、core/ipc.js 的 Desktop、core/vault.js 的 TFolder；
 *          移动弹窗复用 plugins-core/file-explorer-multi.js 的 chooseMoveTarget/moveItemsToFolder。
 * [OUTPUT]: 导出 attachFileMenuHandler(workspace) 与 fillFileMenu/fillFilesMenu。
 * [POS]: core/ 的文件菜单补全层。逐条对应原版 workspace 的 app 级监听：
 *        file-menu → info.copy 子菜单（Obsidian URL/基于库的相对路径/绝对路径）+ system（默认应用打开/在访达中显示）+ action（移动到…）；
 *        files-menu → action（将 N 个文件移动到…）。popout 新窗口项原版由 canPopoutWindow 门控，本项目暂无窗口能力，故意缺失。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t, tt } from './i18n.js';
import { Notice } from './notices.js';
import { Desktop } from './ipc.js';
import { TFolder } from './vault.js';

/** 原版 OI：非根文件夹且非外部文件（本项目无外部文件）。 */
function canMove(file) {
  return !!file && !(file instanceof TFolder && file.isRoot());
}

function copyText(text) {
  try {
    const result = navigator.clipboard.writeText(text);
    if (result && result.catch) result.catch(() => { new Notice(tt('interface.copy_failed', '无法复制到剪贴板')); });
  } catch (error) {
    new Notice(tt('interface.copy_failed', '无法复制到剪贴板'));
  }
}

function copyWithNotice(text, item) {
  copyText(text);
  new Notice(item ? tt('interface.copied', '{{item}} 已复制到你的剪贴板', { item }) : tt('interface.copied_generic', '已复制到剪贴板'));
}

/** 原版 app.copyObsidianUrl。 */
export function copyObsidianUrl(app, file) {
  const vault = encodeURIComponent(app.vault.getName());
  const path = encodeURIComponent(file.path.replace(/\.md$/, ''));
  copyWithNotice('obsidian://open?vault=' + vault + '&file=' + path);
}

/** 原版 file-menu 监听体：复制路径子菜单 + 系统项 + 移动。 */
export function fillFileMenu(workspace, menu, file, source) {
  const app = workspace.app;
  menu.setSectionSubmenu('info.copy', { title: t('interface.menu.copy-path'), icon: 'lucide-clipboard' });
  if (!(file instanceof TFolder)) {
    menu.addItem((i) => i.setSection('info.copy').setTitle(t('interface.menu.copy-obsidian-url'))
      .setIcon('lucide-link').onClick(() => copyObsidianUrl(app, file)));
    menu.addItem((i) => i.setSection('system').setTitle(t('plugins.open-with-default-app.action-open-file'))
      .setIcon('lucide-arrow-up-right').onClick(() => Desktop.openPath(app.vault.adapter.toAbs(file.path))));
  }
  if (canMove(file)) {
    menu.addItem((i) => i.setSection('action')
      .setTitle(file instanceof TFolder ? t('plugins.file-explorer.action-move-folder') : t('plugins.file-explorer.action-move-file'))
      .setIcon('lucide-folder-tree')
      .onClick(async () => {
        const { chooseMoveTarget, moveItemsToFolder } = await import('../plugins-core/file-explorer-multi.js');
        const target = await chooseMoveTarget({ app }, [file]);
        if (target) await moveItemsToFolder({ app }, [file], target);
      }));
  }
  if (!(file instanceof TFolder && file.isRoot())) {
    menu.addItem((i) => i.setSection('info.copy').setTitle(t('interface.menu.copy-vault-path'))
      .setIcon('vault').onClick(() => copyWithNotice(file.path)));
    const abs = app.vault.adapter.toAbs(file.path);
    menu.addItem((i) => i.setSection('info.copy').setTitle(t('interface.menu.copy-full-path'))
      .setIcon('lucide-hard-drive').onClick(() => copyWithNotice(abs)));
    const reveal = navigator.platform.startsWith('Mac')
      ? t('plugins.open-with-default-app.action-show-in-folder-mac')
      : t('plugins.open-with-default-app.action-show-in-folder');
    menu.addItem((i) => i.setSection('system').setTitle(reveal)
      .setIcon('lucide-arrow-up-right').onClick(() => Desktop.showItemInFolder(abs)));
  }
}

/** 原版 files-menu 监听体：多选移动。 */
export function fillFilesMenu(workspace, menu, files) {
  const app = workspace.app;
  menu.addItem((i) => i.setSection('action')
    .setTitle(t('plugins.file-explorer.action-move-items', { count: files.length }))
    .setIcon('lucide-folder-tree')
    .onClick(async () => {
      const { chooseMoveTarget, moveItemsToFolder } = await import('../plugins-core/file-explorer-multi.js');
      const target = await chooseMoveTarget({ app }, files);
      if (target) await moveItemsToFolder({ app }, files, target);
    }));
}

/** 把两个补全器接到 workspace 事件总线上（加载期只注册一次）。 */
export function attachFileMenuHandler(workspace) {
  if (workspace._fileMenuAttached) return;
  workspace._fileMenuAttached = true;
  workspace.on('file-menu', (menu, file, source, leaf) => fillFileMenu(workspace, menu, file, source));
  workspace.on('files-menu', (menu, files) => fillFilesMenu(workspace, menu, files));
}
