/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt
 * [OUTPUT]: 导出 nameKey、create(app)（命令 random-note + ribbon 图标）
 * [POS]: plugins-core/ 的漫游笔记插件，原版 random-note 的 1:1 移植：ribbon 与命令都打开 vault.getMarkdownFiles() 中随机一篇。ribbon/命令图标用自有图标 dice-glyph（原版写 "dice"，本地 Lucide 表缺该名，dice-glyph 是同一枚骰子图形）。Mod 键点击在新标签页打开（原版 isModEvent 语义）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: random-note — open a random markdown note. */
import { tt } from '../core/i18n.js';

export const nameKey = 'plugins.random-note';

export function create(app) {
  let ribbonEl = null;

  function openRandomNote(ev) {
    const files = app.vault.getMarkdownFiles();
    if (!files.length) return;
    const file = files[Math.floor(Math.random() * files.length)];
    const mod = !!(ev && (ev.metaKey || ev.ctrlKey));
    app.workspace.openFile(file, { newLeaf: mod });
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
    deregister(app2) {
      app2.commands.removeCommand('random-note');
    },
  };
}
