/**
 * [INPUT]: core/dom.js 与 core/tooltip.js(DOM 助手与全局提示层，均靠副作用安装)；App 与各注册模块；core/ipc.js 的设置窗口通道。
 * [OUTPUT]: 无导出。构造 window.app、注册视图与命令、启动 App.initialize 并安装全局错误上报；`#settings-window` 时改为设置独立窗口形态。
 * [POS]: 渲染进程入口。语言在模块作用域即确定，必须先于任何界面模块构造；设置窗口与主窗口共用本文件，以 app.isSettingsWindow 分流。
 *        初始化未找到库时停止后续注册，不访问未就绪服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Renderer entry point — boots the app the same way the original does:
 * DOM helpers first, then view/command registration, then App.initialize()
 * (settings -> vault -> workspace -> plugins -> layout).
 */
import './core/dom.js';
import './core/tooltip.js';
import { App } from './core/app.js';
import { registerBuiltinViews } from './views/index.js';
import { registerEditorCommands } from './editor/editor-commands.js';
import { registerAppCommands } from './core/app-commands.js';
import { Notice } from './core/notices.js';
import { debounce } from './core/events.js';
import { detectLanguage, setLanguage, tt } from './core/i18n.js';
import { Desktop, ipcOn } from './core/ipc.js';

// 语言必须在任何界面模块构造之前确定（设置模态等在此处之后的模块作用域构建）
let systemLocale = null;
try { systemLocale = require('electron').ipcRenderer.sendSync('locale'); } catch (e) {}
setLanguage(detectLanguage(systemLocale));

// ---------------------------------------------------------------------------
// Global error reporting — never let a stray exception freeze the UI silently
// ---------------------------------------------------------------------------
let lastErrorMsg = '';
let lastErrorTime = 0;
function reportError(kind: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  const msg = err instanceof Error ? err.stack || detail : detail;
  console.error(`[${kind}]`, err);
  const now = Date.now();
  if (msg === lastErrorMsg && now - lastErrorTime < 5000) return;
  lastErrorMsg = msg;
  lastErrorTime = now;
  try { new Notice(`An error occurred. Check the developer console for details.\n${detail}`, 8000); } catch (e) {}
}
window.addEventListener('error', (ev) => reportError('error', ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => reportError('unhandledrejection', ev.reason));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const app = new App();
// 设置独立窗口（1.14.4 popout）：主进程以 index.html#settings-window 加载本入口
app.isSettingsWindow = window.location.hash === '#settings-window';
window.app = app;
globalThis.app = app;

registerBuiltinViews(app);
registerEditorCommands(app);

app.initialize().then(async ready => {
  if (!ready) return; // e.g. no vault selected; starter was opened
  registerAppCommands(app);

  if (app.isSettingsWindow) {
    // —— 设置独立窗口：模态铺满窗口（原版 body.is-popout-modal > .modal.mod-settings）——
    document.body.addClass('is-settings-window');
    let frame = 'hidden';
    try { frame = require('electron').ipcRenderer.sendSync('frame') || 'hidden'; } catch (e) {}
    if (frame === 'native') {
      // 原生标题栏由 OS 绘制：隐藏应用自绘标题条并去掉顶部留白（类名保留，避免布局基线漂移）
      document.body.addClass('is-native-frame');
    }
    app.setting.open();
    const pendingTab = Desktop.settingsWindowPendingTab();
    if (pendingTab) app.setting.openTabById(pendingTab);
    // 主窗口请求切换页签（openTab/openTabById 接力）
    ipcOn('settings-window-open-tab', (ev, payload) => {
      const tabId = payload && payload.tabId;
      if (tabId && app.setting) app.setting.openTabById(tabId);
    });
    // 标题格式（原版 getAppTitle(windowTitle)）：设置 - {库名} - {应用名 版本}
    const version = Desktop.version();
    document.title = tt('interface.settings', 'Settings') + ' - ' + app.vault.getName() +
      ' - OpenSidian' + (version ? ' ' + version : '');
    // 自绘标题条文本镜像 document.title（无边框模式可见；原生模式由 OS 读取窗口标题）
    const titlebarText = document.querySelector('.titlebar-text');
    if (titlebarText) titlebarText.textContent = document.title;
    return;
  }

  // persist layout lazily whenever the layout changes
  const saveLayout = debounce(() => { app.saveLayout().catch((e) => console.error(e)); }, 2000);
  app.workspace.on('layout-change', saveLayout);
  app.workspace.on('file-open', saveLayout);
  setInterval(() => app.saveLayout().catch(() => {}), 60000);

  // expose command runner for main-process menu accelerators
  window.__runCommand = (id) => app.commands.executeCommandById(id);

  console.log('OpenSidian ready. Vault:', app.vaultPath);
}).catch((e) => reportError('boot', e));

// 设置窗口「开关切回模态」：主进程请求主窗口以应用内模态重开设置（原版 close→open 的跨窗口等价物）
ipcOn('settings-open-modal', (ev, payload) => {
  if (!app.setting) return;
  // 设置窗口已把配置写盘；同步本窗口内存缓存，避免下一次齿轮再次开窗
  const flag = payload && payload.settingsPopoutWindow;
  if (typeof flag === 'boolean' && app.settings && app.settings.appSettings) {
    app.settings.appSettings.settingsPopoutWindow = flag;
  }
  app.setting.openInApp();
  const tabId = payload && payload.tabId;
  if (tabId) app.setting.openTabById(tabId);
});

window.addEventListener('beforeunload', () => {
  try { app.saveLayout && app.vault && app.saveLayout(); } catch (e) {}
});
