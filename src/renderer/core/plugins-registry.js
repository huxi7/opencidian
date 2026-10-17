/*
 * [INPUT]: 依赖 ../plugins-core/*.js 的全部核心插件模块
 * [OUTPUT]: 导出 corePluginModules（id → 模块对象的汇总表）
 * [POS]: core/ 的核心插件注册表。PluginManager.loadInternalPlugins 经 loadCoreModules 消费它；模块 id 必须与 .obsidian/core-plugins.json 的键一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin registry — every internal plugin module keyed by its plugin id.
 * Module shape: { nameKey?, create(app) -> { onload, onunload, deregister? } }
 * The plugin id must match the ids used in settings.corePlugins (the same ids
 * the original app uses in <vault>/.obsidian/core-plugins.json).
 */
import * as fileExplorer from '../plugins-core/file-explorer.js';
import * as commandPalette from '../plugins-core/command-palette.js';
import * as switcher from '../plugins-core/switcher.js';
import * as backlink from '../plugins-core/backlink.js';
import * as outline from '../plugins-core/outline.js';
import * as tagPane from '../plugins-core/tag-pane.js';
import * as globalSearch from '../plugins-core/global-search.js';
import * as editorStatus from '../plugins-core/editor-status.js';
import * as wordCount from '../plugins-core/word-count.js';
import * as graph from '../plugins-core/graph.js';
import * as canvas from '../plugins-core/canvas.js';
import * as bookmarks from '../plugins-core/bookmarks.js';
import * as dailyNotes from '../plugins-core/daily-notes.js';
import * as templates from '../plugins-core/templates.js';
import * as noteComposer from '../plugins-core/note-composer.js';
import * as fileRecovery from '../plugins-core/file-recovery.js';
import * as randomNote from '../plugins-core/random-note.js';
import * as zkPrefixer from '../plugins-core/zk-prefixer.js';
import * as workspaces from '../plugins-core/workspaces.js';
import * as slides from '../plugins-core/slides.js';
import * as pagePreview from '../plugins-core/page-preview.js';

export const corePluginModules = {
  'file-explorer': fileExplorer,
  'command-palette': commandPalette,
  'switcher': switcher,
  'backlink': backlink,
  'outline': outline,
  'tag-pane': tagPane,
  'global-search': globalSearch,
  'editor-status': editorStatus,
  'word-count': wordCount,
  'graph': graph,
  'canvas': canvas,
  'bookmarks': bookmarks,
  'daily-notes': dailyNotes,
  'templates': templates,
  'note-composer': noteComposer,
  'file-recovery': fileRecovery,
  'random-note': randomNote,
  'zk-prefixer': zkPrefixer,
  'workspaces': workspaces,
  'slides': slides,
  'page-preview': pagePreview,
};
