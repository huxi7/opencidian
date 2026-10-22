# OpenSidian - 开源 Obsidian 桌面复刻

OpenSidian 是 Obsidian 桌面版 1.14.4 的独立开源复刻（1:1 目标），兼容 `.obsidian` 库格式。不加载第三方插件：仅内置核心插件。

Electron 33 + esbuild + CodeMirror 6 + markdown-it + MathJax 3.2.2 CHTML + 原生 CSS 变量主题

<directory>
src/ - 全部源码 (2 子目录)
  main/ - Electron 主进程：窗口、app:// 协议、IPC、原生菜单、同库文档窗口与原子写回；dev-hooks 承接验收
  renderer/ - 渲染进程：应用主体 (6 子目录: core, editor, markdown, views, plugins-core, styles)
scripts/ - esbuild 构建与隔离 Electron 验收 (acceptance/)
assets/ - 图标表、字体与官方 MathJax 离线资源
_analysis/ - 原版解包产物 (obsidian-114/ 为 1.14.4 提取源)，只读参考资料；bases-114/ 与 small-gaps-114/、properties-114/ 保存静态事实
dist/ - esbuild 输出 (renderer.js, starter.js, graph-sim-worker.js)
</directory>

<config>
AGENT-STATE.md - 项目事实、阶段记录与当前交接安排
README.md - 项目介绍、构建运行方式与兼容性说明
package.json - 依赖与脚本 (build/watch/start/dev)
electron-builder.yml - 目录包与分发配置；ASAR 包含运行文件和许可证原文
scripts/build.mjs - 打包入口: src/renderer/main.js → dist/renderer.js
scripts/dev.mjs - 开发模式 (watch + electron 热重启)
src/renderer/index.html - 主窗口 HTML，链接 styles/*.css 与 dist/renderer.js；画布和变量样式按序导入分片
src/renderer/starter.html - 仓库选择窗口 HTML
</config>

<rules>
1. 复刻原则：只依据观察到的行为与设计事实重建，不搬运原版专有代码。可复用的"事实型资产"：图标表、locale、CSS 设计变量 tokens、快捷键表。
2. 不劫持系统 obsidian:// 协议；不读写真实 Obsidian 的 userData。
3. CSS class 命名与 DOM 结构对齐原版 (app.css 为对照源)：.workspace-split/.workspace-leaf/.nav-file/.markdown-source-view 等。
4. 分割方向语义：.mod-vertical = 横向排列 (row)，.mod-horizontal = 纵向堆叠 (column)。
5. 视图生命周期：setViewState → view._rootEl=createDiv('view-content') → load() → setState(state) → _ensureLeafDom。
6. 插件 id 与 .obsidian/core-plugins.json 一致 (file-explorer, global-search, switcher...)。
7. 单文件 ≤800 行；超出即重构。
8. 侧栏工具固定，文档标签属于中心。左下角库信息栏独立于标签树；功能区入口随所属插件启停。
</rules>

[PROTOCOL]: 变更时更新此头部，然后检查 src/CLAUDE.md 与本文件

> 逆向证据与工具选择见 AGENT-STATE.md“REA 自动使用政策”。
