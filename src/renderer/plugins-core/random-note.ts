/**
 * [INPUT]: 依赖 i18n 的 tt；MetadataCache 统一排除规则与 vault 的 Markdown 文件列表。
 * [OUTPUT]: 导出 nameKey、create(app)（命令 random-note + ribbon 图标）
 * [POS]: 漫游笔记从未排除的 Markdown 文件中随机打开一篇。排除规则沿用原版路径前缀和 /正则/ 语义；Mod 点击新标签页，无候选时保持当前页。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: random-note — open a random markdown note. */
import { tt } from '../core/i18n.js';

export const nameKey = 'plugins.random-note';

export function create(app: App) {
  let ribbonEl = null;

  async function openRandomNote(ev) {
    const files = app.vault.getMarkdownFiles().filter(file => !app.metadataCache.isUserIgnored(file.path));
    if (!files.length) return;
    const file = files[Math.floor(Math.random() * files.length)];
    const mod = !!(ev && (ev.metaKey || ev.ctrlKey));
    return app.workspace.openFile(file, { newLeaf: mod });
  }

  return {
    onload() {
      ribbonEl = app.workspace.addRibbonItem(
        'dice-glyph',
        tt('plugins.random-note.action-open', 'Open random note'),
        (ev) => openRandomNote(ev),
      );
      app.commands.addCommand({
        id: 'random-note',
        name: tt('plugins.random-note.action-open', 'Open random note'),
        icon: 'dice-glyph',
        callback: (ev) => openRandomNote(ev),
      });
    },
    onunload() {
      if (ribbonEl) { ribbonEl.detach(); ribbonEl = null; }
      app.commands.removeCommand('random-note');
    },
    deregister() {
      app.commands.removeCommand('random-note');
    },
  };
}
