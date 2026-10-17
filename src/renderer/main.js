/*
 * Renderer entry point — boots the app the same way the original does:
 * DOM helpers first, then view/command registration, then App.initialize()
 * (settings -> vault -> workspace -> plugins -> layout).
 */
import './core/dom.js';
import { App } from './core/app.js';
import { registerBuiltinViews } from './views/index.js';
import { registerEditorCommands } from './editor/editor-commands.js';
import { registerAppCommands } from './core/app-commands.js';
import { Notice } from './core/notices.js';
import { debounce } from './core/events.js';
import { detectLanguage, setLanguage } from './core/i18n.js';

// 语言必须在任何界面模块构造之前确定（设置模态等在此处之后的模块作用域构建）
let systemLocale = null;
try { systemLocale = require('electron').ipcRenderer.sendSync('locale'); } catch (e) {}
setLanguage(detectLanguage(systemLocale));

// ---------------------------------------------------------------------------
// Global error reporting — never let a stray exception freeze the UI silently
// ---------------------------------------------------------------------------
let lastErrorMsg = '';
let lastErrorTime = 0;
function reportError(kind, err) {
  const msg = err && (err.stack || err.message || String(err));
  console.error(`[${kind}]`, err);
  const now = Date.now();
  if (msg === lastErrorMsg && now - lastErrorTime < 5000) return;
  lastErrorMsg = msg;
  lastErrorTime = now;
  try { new Notice(`An error occurred. Check the developer console for details.\n${(err && err.message) || err}`, 8000); } catch (e) {}
}
window.addEventListener('error', (ev) => reportError('error', ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => reportError('unhandledrejection', ev.reason));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const app = new App();
window.app = app;
globalThis.app = app;

registerBuiltinViews(app);
registerEditorCommands(app);

app.initialize().then(async () => {
  if (!app.vault || !app.workspace) return; // e.g. no vault selected; starter was opened
  registerAppCommands(app);

  // persist layout lazily whenever the layout changes
  const saveLayout = debounce(() => { app.saveLayout().catch((e) => console.error(e)); }, 2000);
  app.workspace.on('layout-change', saveLayout);
  app.workspace.on('file-open', saveLayout);
  setInterval(() => app.saveLayout().catch(() => {}), 60000);

  // expose command runner for main-process menu accelerators
  window.__runCommand = (id) => app.commands.executeCommandById(id);

  console.log('OpenSidian ready. Vault:', app.vaultPath);
}).catch((e) => reportError('boot', e));

window.addEventListener('beforeunload', () => {
  try { app.saveLayout && app.vault && app.saveLayout(); } catch (e) {}
});
